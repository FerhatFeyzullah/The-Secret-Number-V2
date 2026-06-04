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
import { DEFAULT_NAME, getProfileName, setProfileName } from './storage';
import { supabase } from './supabase';

type AuthContextValue = {
  session: Session | null;
  /** İlk oturum kontrolü tamamlanana kadar true. */
  initializing: boolean;
  /** Oturum açıkken remote profil adı, kapalıyken yerel (offline) ad. */
  displayName: string;
  /** Başarıda null, hatada Türkçe mesaj döner. */
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<string | null>;
  signOut(): Promise<void>;
  /** Yerel adı her zaman, oturum açıksa remote profili de günceller. */
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
   *  oturum açık → remote profil (yoksa e-posta kullanıcı adı), kapalı → yerel ad. */
  const loadDisplayName = useCallback(async (current: Session | null) => {
    if (current) {
      const profile = await fetchProfile();
      if (profile?.name) {
        setDisplayName(profile.name);
        return;
      }
      // profiles tablosu henüz kurulmadıysa hesaba özgü makul bir ada düş.
      setDisplayName(current.user.email?.split('@')[0] || DEFAULT_NAME);
    } else {
      setDisplayName(await getProfileName());
    }
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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      lastUserId.current = data.session?.user.id ?? null;
      loadDisplayName(data.session).finally(() => setInitializing(false));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
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

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      await setProfileName(name); // yerel ad oturumdan bağımsız her zaman saklanır
      setDisplayName(name.trim() || DEFAULT_NAME);
      if (session) await upsertProfile(name);
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
