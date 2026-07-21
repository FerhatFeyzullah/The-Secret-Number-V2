import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/auth';

import { getMyRank } from './matchService';
import type { MyRank } from './types';

type RankContextValue = {
  /** Sunucudaki güncel rank/Veri/sahiplik; oturum yoksa null. */
  rank: MyRank | null;
  /** SON fetch başarısız oldu mu. Yalnız `rank` henüz null iken hata UI'ı tetikler
   *  (veri varsa arka-plan tazeleme hatası yutulur → ekran boşalmaz). Başlangıçta
   *  false → ilk render'da spinner gösterilir, sahte "yüklenemedi" flaşı olmaz. */
  error: boolean;
  /** Sunucudan yeniden çek (maçtan/ayardan dönüş, pull-to-refresh…). Getirilen
   *  değeri döndürür → çağıran seviye-atlama/sezon tespiti için kullanabilir. */
  refresh: () => Promise<MyRank | null>;
  /** İyimser kısmi güncelleme (ör. satın alma sonrası { veri, ownedSignals }).
   *  Sunucu-otoriter yanıt zaten geldiği için tekrar fetch gerektirmez. */
  patch: (partial: Partial<MyRank>) => void;
};

const RankContext = createContext<RankContextValue | null>(null);

/**
 * Oyuncunun rank / Veri / sahiplik durumu için TEK doğruluk kaynağı. Tüm sekmeler
 * (Ana Ekran, Mağaza, Donanım) ve modallar (Leaderboard) buradan okur; satın alma
 * ve maç sonu tek `refresh()` / `patch()` ile tüm yüzeyleri AYNI ANDA günceller.
 *
 * Neden gerekli: 5 sekme tek route'ta pager çocuğu olarak birlikte mount olduğundan
 * sekmeler arası KAYDIRMA focus/tazeleme getirmiyordu; her ekran kendi kopyasını
 * tutunca bir ekrandaki mutasyon (ör. mağazada satın alma) diğerlerine yansımıyor,
 * Ana Ekran'daki Veri/Kupa bayat kalıyordu. Ortak store bunu kökten çözer:
 * `patch` context'i günceller → context'i okuyan her yüzey ANINDA yeniden render olur
 * (focus olayı gerekmez).
 */
export function RankProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [rank, setRank] = useState<MyRank | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(async (): Promise<MyRank | null> => {
    if (!session) {
      setRank(null);
      setError(false);
      return null;
    }
    setError(false);
    try {
      const r = await getMyRank();
      setRank(r);
      return r;
    } catch {
      // Mevcut değeri KORU (offline/geçici hata) → ekran boşalmasın; rank hiç
      // yoksa (ilk yükleme başarısız) hata bayrağı tekrar-dene UI'ını gösterir.
      setError(true);
      return null;
    }
  }, [session]);

  // Oturum değişince: girişte ilk çek, çıkışta temizle.
  useEffect(() => {
    if (!session) {
      setRank(null);
      setError(false);
      return;
    }
    void refresh();
  }, [session, refresh]);

  const patch = useCallback((partial: Partial<MyRank>) => {
    setRank((r) => (r ? { ...r, ...partial } : r));
  }, []);

  const value = useMemo(
    () => ({ rank, error, refresh, patch }),
    [rank, error, refresh, patch],
  );
  return <RankContext.Provider value={value}>{children}</RankContext.Provider>;
}

export function useRank(): RankContextValue {
  const ctx = useContext(RankContext);
  if (!ctx) throw new Error('useRank must be used within RankProvider');
  return ctx;
}
