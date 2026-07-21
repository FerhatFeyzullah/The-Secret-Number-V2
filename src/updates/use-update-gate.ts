import * as Updates from 'expo-updates';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { initialState, reducer, type UpdatePhase } from './update-machine';

export type UpdateGate = {
  phase: UpdatePhase;
  /** İndirme ilerlemesi 0..1 (yalnızca `downloading`/`ready` fazında anlamlı;
   *  native ilerleme olayı gelmezse `undefined` → UI belirsiz çubuk gösterir). */
  progress: number | undefined;
  /** Hata ekranında "Tekrar Dene" → indirmeyi yeniden dener (otomatik akış hata
   *  verdiyse elle yeniden başlatmak için). */
  retry: () => void;
  /** Hata ekranında "Şimdilik Geç" → overlay kapanır, menü açılır (fail-open). */
  skip: () => void;
};

/**
 * Açılışta OTA güncellemesini kontrol eden ve akışı OTOMATİK süren kapı (gate).
 *
 * - Mount'ta (intro ile eşzamanlı) arka planda `checkForUpdateAsync` çalışır.
 * - Güncelleme VARSA: kullanıcı "Güncelle" beklemeden OTOMATİK indirilir; indirme
 *   bitince OTOMATİK `reloadAsync()` ile yeni sürüme geçilir. Kullanıcı yalnızca
 *   bilgilendirme ekranını (indiriliyor → yeniden başlatılıyor) görür.
 * - Güncelleme YOKSA VEYA kontrol başarısızsa → `none` (fail-open, menü açılır).
 * - İndirme koparsa → `error` (elle Tekrar Dene / Şimdilik Geç → fail-open).
 * - Dev / Expo Go'da (`Updates.isEnabled` false) hiç devreye girmez → `none`.
 */
export function useUpdateGate(): UpdateGate {
  const [state, dispatch] = useReducer(reducer, initialState);
  const startedRef = useRef(false);
  const restartedRef = useRef(false);

  // Native indirme ilerlemesi (expo-updates olaylarından) — otomatik
  // fetchUpdateAsync sırasında güncellenir.
  const { downloadProgress, isDownloading } = Updates.useUpdates();

  const startDownload = useCallback(() => {
    dispatch({ type: 'DOWNLOAD_STARTED' });
    Updates.fetchUpdateAsync()
      .then(() => dispatch({ type: 'DOWNLOAD_DONE' }))
      // İndirme yarıda koptu → error (Tekrar Dene / Şimdilik Geç).
      .catch(() => dispatch({ type: 'DOWNLOAD_FAILED' }));
  }, []);

  const restart = useCallback(() => {
    // reloadAsync başarısız olursa (nadiren) kullanıcı elle yeniden açar.
    Updates.reloadAsync().catch(() => {});
  }, []);

  // Açılışta tek sefer kontrol → güncelleme varsa OTOMATİK indirmeyi başlat.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Dev client / Expo Go: güncelleme devre dışı → kullanıcıyı hiç oyalama.
    if (!Updates.isEnabled) {
      dispatch({ type: 'NO_UPDATE' });
      return;
    }

    dispatch({ type: 'CHECK_STARTED' });
    Updates.checkForUpdateAsync()
      .then((res) => {
        // Güncelleme varsa "Güncelle" beklemeden HEMEN indir.
        if (res.isAvailable) startDownload();
        else dispatch({ type: 'NO_UPDATE' });
      })
      // Ağ yok / sunucuya ulaşılamadı → fail-open: kilitleme, menüye al.
      .catch(() => dispatch({ type: 'NO_UPDATE' }));
  }, [startDownload]);

  // İndirme bitince (ready) OTOMATİK yeniden başlat → yeni sürüme geç. Tek sefer.
  useEffect(() => {
    if (state.phase === 'ready' && !restartedRef.current) {
      restartedRef.current = true;
      restart();
    }
  }, [state.phase, restart]);

  const skip = useCallback(() => dispatch({ type: 'SKIP' }), []);

  return {
    phase: state.phase,
    progress:
      state.phase === 'ready'
        ? 1
        : isDownloading
          ? downloadProgress
          : undefined,
    retry: startDownload,
    skip,
  };
}
