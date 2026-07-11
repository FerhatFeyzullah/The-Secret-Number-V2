import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { fetchProfile, upsertProfile } from './profile';
import { DEFAULT_NAME, getProfileName, getRawProfileName, setProfileName } from './storage';
import { supabase } from './supabase';

type AuthContextValue = {
  session: Session | null;
  /** İlk oturum kontrolü tamamlanana kadar true. */
  initializing: boolean;
  /** Oturum açıkken HER ZAMAN profiles.username, kapalıyken yerel (offline) ad. */
  displayName: string;
  /** Başarıda null, hatada Türkçe mesaj döner. */
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<string | null>;
  /** Şifre sıfırlama için 6 haneli OTP kodunu e-postayla gönderir. */
  requestPasswordReset(email: string): Promise<string | null>;
  /** OTP kodunu doğrular ve yeni şifreyi kaydeder (kullanıcıyı giriş yapmış duruma getirir). */
  confirmPasswordReset(email: string, code: string, newPassword: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Oturum açıkken yalnızca DB'yi, kapalıyken yalnızca yerel adı günceller. */
  updateName(name: string): Promise<void>;
  /** Görünen adı doğru kaynaktan yeniden yükler (ör. ekrana dönünce). */
  refreshDisplayName(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Supabase hata mesajlarını sade Türkçe'ye çevirir. */
function turkishAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-posta veya şifre hatalı.';
  if (m.includes('already registered')) return 'Bu e-posta ile zaten bir hesap var.';
  if (m.includes('at least 6 characters')) return 'Şifre en az 6 karakter olmalı.';
  if (m.includes('valid email') || m.includes('invalid format')) return 'Geçerli bir e-posta adresi gir.';
  if (m.includes('too many') || m.includes('rate limit')) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
  if (m.includes('expired')) return 'Kodun süresi dolmuş. Yeni bir kod iste.';
  if ((m.includes('invalid') || m.includes('not found')) && (m.includes('token') || m.includes('otp')))
    return 'Kod hatalı. Tekrar dene ya da yeni kod iste.';
  if (m.includes('should be different') || m.includes('same as the old'))
    return 'Yeni şifre eskisinden farklı olmalı.';
  if (m.includes('network') || m.includes('fetch')) return 'Bağlantı kurulamadı. İnternet bağlantını kontrol et.';
  return 'Bir şeyler ters gitti. Tekrar dene.';
}

const NOT_CONFIGURED =
  'Online mod henüz yapılandırılmamış. (.env dosyasına Supabase anahtarlarını ekleyin.)';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [displayName, setDisplayName] = useState(DEFAULT_NAME);
  // Farklı kullanıcıya geçildiğini yakalamak için son kullanıcı id'si.
  const lastUserId = useRef<string | null>(null);

  /** Görünen adı oturum durumuna göre TEK yerden besler:
   *  oturum açık → profiles.username (DB esas), kapalı → yerel ad.
   *  İlk girişte remote ad hâlâ varsayılansa eldeki offline adı bir
   *  defalığına DB'ye taşır; sonrasında DB tek doğruluk kaynağıdır. */
  const loadDisplayName = useCallback(async (current: Session | null) => {
    if (!current) {
      setDisplayName(await getProfileName());
      return;
    }
    let profile = await fetchProfile();
    const emailPrefix = current.user.email?.split('@')[0] ?? '';
    const localName = await getRawProfileName();
    const isDefaultUsername = !profile?.username || profile.username === emailPrefix;
    if (profile && isDefaultUsername && localName && localName !== profile.username) {
      if (await upsertProfile(localName)) profile = await fetchProfile();
    }
    setDisplayName(profile?.username || emailPrefix || DEFAULT_NAME);
  }, []);

  /** Hesap değişti / kapandı: online'a özel önbelleği sıfırla.
   *  Şimdilik profil adı; ileride oda/oyun verileri de buraya eklenecek. */
  const clearOnlineCache = useCallback(() => {
    setDisplayName(DEFAULT_NAME);
  }, []);

  useEffect(() => {
    if (!supabase) {
      // Online yapılandırılmamış: yerel adla devam et.
      getProfileName().then(setDisplayName).finally(() => setInitializing(false));
      return;
    }
    const client = supabase;
    // Saklı oturumu cihaz state'inden temizleyip "çıkış yapılmış" duruma geç.
    // Geçersiz/bulunamayan refresh token (eski ya da sunucuda iptal edilmiş oturum)
    // durumunda kullanılır: hata gösterme, takılma, çökme yok → giriş ekranı.
    const resetToSignedOut = async () => {
      // scope:'local' → ağ çağrısı yok; yalnız cihazdaki bayat token'ı siler ki
      // sonraki açılışlarda tekrar yenilenmeye çalışılıp aynı hatayı vermesin.
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
      setSession(null);
      lastUserId.current = null;
      await loadDisplayName(null);
    };

    // Açılışta saklı oturumu yükle. getSession süresi dolmuş access token'ı
    // yenilemeyi dener; refresh token geçersiz/yoksa hata döner → sessizce temizle.
    // Geçerli oturum normal şekilde yüklenir (akış bozulmaz).
    client.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (error) {
          await resetToSignedOut();
          return;
        }
        setSession(data.session);
        lastUserId.current = data.session?.user.id ?? null;
        await loadDisplayName(data.session);
      })
      // getSession beklenmedik şekilde reddederse de temiz duruma düş.
      .catch(() => resetToSignedOut())
      .finally(() => setInitializing(false));

    const { data: sub } = client.auth.onAuthStateChange((_event, next) => {
      // Arka planda token yenileme başarısız olursa supabase SIGNED_OUT yayar →
      // next null gelir → temiz "çıkış" durumu (giriş ekranı), hata gösterilmez.
      setSession(next);
      const nextUserId = next?.user.id ?? null;
      if (nextUserId !== lastUserId.current) {
        lastUserId.current = nextUserId;
        clearOnlineCache();
      }
      // Callback içinde doğrudan supabase çağrısı kilitlenebilir; bir tick ertele.
      setTimeout(() => loadDisplayName(next), 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [clearOnlineCache, loadDisplayName]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return NOT_CONFIGURED;
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? turkishAuthError(error.message) : null;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) return NOT_CONFIGURED;
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return turkishAuthError(error.message);
    // Doğrulama akışı yok: oturum dönmediyse projede e-posta doğrulaması açık demektir.
    if (!data.session) {
      return 'Kayıt alındı ama oturum açılamadı. (Supabase projesinde e-posta doğrulaması kapalı olmalı.)';
    }
    return null;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!supabase) return NOT_CONFIGURED;
    // Recovery e-postası gönderir. Şablonda {{ .Token }} varsa 6 haneli kod içerir.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    return error ? turkishAuthError(error.message) : null;
  }, []);

  const confirmPasswordReset = useCallback(
    async (email: string, code: string, newPassword: string) => {
      if (!supabase) return NOT_CONFIGURED;
      // OTP doğrulaması recovery tipinde bir oturum kurar → kullanıcı giriş yapmış olur.
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: 'recovery',
      });
      if (verifyError) return turkishAuthError(verifyError.message);
      // Oturum açıldı; artık yeni şifre kaydedilebilir.
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) return turkishAuthError(updateError.message);
      return null;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (session) {
        // Oturum açık: tek kaynak DB. Optimistic göster, sunucu teyidiyle tazele.
        // AsyncStorage'daki offline ada DOKUNULMAZ.
        setDisplayName(trimmed || DEFAULT_NAME);
        if (await upsertProfile(trimmed)) {
          const profile = await fetchProfile();
          if (profile?.username) setDisplayName(profile.username);
        }
      } else {
        await setProfileName(name);
        setDisplayName(trimmed || DEFAULT_NAME);
      }
    },
    [session],
  );

  const refreshDisplayName = useCallback(() => loadDisplayName(session), [loadDisplayName, session]);

  return (
    <AuthContext.Provider
      value={{
        session,
        initializing,
        displayName,
        signIn,
        signUp,
        requestPasswordReset,
        confirmPasswordReset,
        signOut,
        updateName,
        refreshDisplayName,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalı');
  return ctx;
}

/** Profil adının TEK doğruluk kaynağı: oturum açıkken profiles.username,
 *  kapalıyken yerel ad. Ana ekran ve ayarlar İKİSİ DE bunu kullanır. */
export function useProfile() {
  const { displayName, updateName, refreshDisplayName, session } = useAuth();
  return {
    name: displayName,
    updateName,
    refresh: refreshDisplayName,
    /** true → ad DB'den geliyor (oturum açık). */
    isRemote: session !== null,
  };
}
