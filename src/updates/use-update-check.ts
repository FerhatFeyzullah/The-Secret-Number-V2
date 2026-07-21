import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';

export type ManualUpdateStatus =
  | 'idle' // "Güncellemeleri Denetle"
  | 'unsupported' // dev client / Expo Go → OTA devre dışı
  | 'checking' // checkForUpdateAsync sürüyor
  | 'downloading' // fetchUpdateAsync sürüyor
  | 'restarting' // reloadAsync çağrıldı (uygulama yeniden başlıyor)
  | 'uptodate' // güncelleme yok
  | 'error'; // denetim/indirme başarısız

/**
 * Ayarlardaki "Güncellemeleri Denetle" butonunun TAM OTOMATİK akışı:
 *   denetle → varsa indir → reloadAsync ile yeni sürümü yükleyerek yeniden başlat.
 *
 * Açılıştaki sessiz kapıdan (use-update-gate) farkı: kullanıcı BİLEREK tetikler,
 * sonucu görür (güncel / indiriliyor / hata) ve güncelleme bulununca onay beklemeden
 * uygulanır. `reloadAsync` uygulamayı taze başlatır → çağrıdan sonrası çalışmaz.
 *
 * Bu buton JS → OTA ile mevcut kullanıcılara gider; `checkAutomatically`
 * ON_ERROR_RECOVERY olduğundan normal açılışta oto-denetim olmayan kullanıcılara
 * güncellemeyi elle çekme yolu verir (fail-open kapının kaçırdığı durumları kapatır).
 */
export function useUpdateCheck(): {
  status: ManualUpdateStatus;
  /** İndirme ilerlemesi 0..1 (yalnız `downloading` fazında ve native olay gelirse). */
  progress: number | undefined;
  check: () => void;
} {
  const [status, setStatus] = useState<ManualUpdateStatus>('idle');
  const busyRef = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Native indirme ilerlemesi (fetchUpdateAsync sırasında güncellenir).
  const { downloadProgress, isDownloading } = Updates.useUpdates();

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  // Terminal bilgi durumları (güncel / hata) birkaç saniye sonra idle'a döner →
  // buton yeniden kullanılabilir ve "takılı" görünmez.
  const settle = useCallback((next: ManualUpdateStatus) => {
    busyRef.current = false;
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 4000);
  }, []);

  const check = useCallback(async () => {
    if (busyRef.current) return;
    // Dev client / Expo Go: OTA yok → kullanıcıyı bilgilendir, işlem yapma.
    if (!Updates.isEnabled) {
      setStatus('unsupported');
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    busyRef.current = true;
    setStatus('checking');
    try {
      const res = await Updates.checkForUpdateAsync();
      if (!res.isAvailable) {
        settle('uptodate');
        return;
      }
      setStatus('downloading');
      await Updates.fetchUpdateAsync();
      setStatus('restarting');
      await Updates.reloadAsync(); // uygulama yeniden başlar; buradan sonrası çalışmaz
    } catch {
      settle('error');
    }
  }, [settle]);

  const progress =
    status === 'downloading' && isDownloading ? downloadProgress : undefined;

  return { status, progress, check };
}
