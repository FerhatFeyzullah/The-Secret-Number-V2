import * as Updates from 'expo-updates';
import { useCallback, useEffect, useReducer, useRef } from 'react';

import { initialState, reducer, type UpdatePhase } from './update-machine';

export type UpdateGate = {
  phase: UpdatePhase;
  /** İndirme ilerlemesi 0..1 (yalnızca `downloading`/`ready` fazında anlamlı;
   *  native ilerleme olayı gelmezse `undefined` → UI belirsiz çubuk gösterir). */
  progress: number | undefined;
  /** "Güncelle" → indirmeyi başlatır. */
  startDownload: () => void;
  /** Hata ekranında "Tekrar Dene" → indirmeyi yeniden dener. */
  retry: () => void;
  /** Hata ekranında "Şimdilik Geç" → overlay kapanır, menü açılır. */
  skip: () => void;
  /** "Yeniden Başlat" → yeni sürümü yükleyip uygulamayı taze başlatır. */
  restart: () => void;
};

/**
 * Açılışta OTA güncellemesini kontrol eden ve akışı süren kapı (gate).
 *
 * - Mount'ta (intro ile eşzamanlı) arka planda `checkForUpdateAsync` çalışır.
 * - Güncelleme yoksa VEYA kontrol başarısızsa → `none` (fail-open, menü açılır).
 * - Dev / Expo Go'da (`Updates.isEnabled` false) hiç devreye girmez → `none`.
 * - İndirme kullanıcı "Güncelle"ye basınca başlar; ilerleme `useUpdates()`ten okunur.
 * - Bitince `ready`; kullanıcı "Yeniden Başlat"a basınca `reloadAsync()`.
 */
export function useUpdateGate(): UpdateGate {
  const [state, dispatch] = useReducer(reducer, initialState);
  const startedRef = useRef(false);

  // Native indirme ilerlemesi (expo-updates olaylarından) — imperatif
  // fetchUpdateAsync sırasında güncellenir.
  const { downloadProgress, isDownloading } = Updates.useUpdates();

  // Açılışta tek sefer kontrol.
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
      .then((res) =>
        dispatch(res.isAvailable ? { type: 'UPDATE_AVAILABLE' } : { type: 'NO_UPDATE' }),
      )
      // Ağ yok / sunucuya ulaşılamadı → fail-open: kilitleme, menüye al.
      .catch(() => dispatch({ type: 'NO_UPDATE' }));
  }, []);

  const startDownload = useCallback(() => {
    dispatch({ type: 'DOWNLOAD_STARTED' });
    Updates.fetchUpdateAsync()
      .then(() => dispatch({ type: 'DOWNLOAD_DONE' }))
      // İndirme yarıda koptu → error (Tekrar Dene / Şimdilik Geç).
      .catch(() => dispatch({ type: 'DOWNLOAD_FAILED' }));
  }, []);

  const skip = useCallback(() => dispatch({ type: 'SKIP' }), []);

  const restart = useCallback(() => {
    // reloadAsync başarısız olursa (nadiren) kullanıcı elle yeniden açar.
    Updates.reloadAsync().catch(() => {});
  }, []);

  return {
    phase: state.phase,
    progress:
      state.phase === 'ready'
        ? 1
        : isDownloading
          ? downloadProgress
          : undefined,
    startDownload,
    retry: startDownload,
    skip,
    restart,
  };
}
