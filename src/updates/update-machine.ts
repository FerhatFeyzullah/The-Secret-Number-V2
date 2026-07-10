/**
 * OTA güncelleme akışının SAF durum makinesi (expo-updates'ten bağımsız).
 *
 * Akış (kullanıcı kararlarına göre):
 *   idle → checking → (available → downloading → ready → [reload])
 *                   \→ none  (güncelleme yok / kontrol başarısız → fail-open, menü açılır)
 *   downloading → error (indirme koptu) → downloading (tekrar dene) | none (şimdilik geç)
 *
 * Yan etki YOK → jest ile doğrudan test edilebilir. Hook (use-update-gate) bu
 * makineyi expo-updates çağrılarına bağlar.
 */

export type UpdatePhase =
  | 'idle' // henüz başlamadı
  | 'checking' // checkForUpdateAsync sürüyor (kullanıcı bir şey görmez, menü açık)
  | 'available' // güncelleme bulundu, kullanıcı "Güncelle"ye basmayı bekliyor
  | 'downloading' // fetchUpdateAsync sürüyor
  | 'ready' // indirildi, "Yeniden Başlat" bekleniyor
  | 'error' // indirme başarısız → Tekrar Dene / Şimdilik Geç
  | 'none'; // güncelleme yok ya da atlandı → overlay yok, menü açılır

export type UpdateState = { phase: UpdatePhase };

export type UpdateEvent =
  | { type: 'CHECK_STARTED' }
  | { type: 'UPDATE_AVAILABLE' }
  | { type: 'NO_UPDATE' } // güncelleme yok VEYA kontrol başarısız (fail-open)
  | { type: 'DOWNLOAD_STARTED' }
  | { type: 'DOWNLOAD_DONE' }
  | { type: 'DOWNLOAD_FAILED' }
  | { type: 'SKIP' }; // hata ekranında "Şimdilik Geç"

export const initialState: UpdateState = { phase: 'idle' };

export function reducer(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'CHECK_STARTED':
      return { phase: 'checking' };
    case 'UPDATE_AVAILABLE':
      return { phase: 'available' };
    case 'NO_UPDATE':
      return { phase: 'none' };
    case 'DOWNLOAD_STARTED':
      return { phase: 'downloading' };
    case 'DOWNLOAD_DONE':
      return { phase: 'ready' };
    case 'DOWNLOAD_FAILED':
      return { phase: 'error' };
    case 'SKIP':
      return { phase: 'none' };
    default:
      return state;
  }
}

/**
 * Overlay YALNIZCA kullanıcının bir şey görmesi/karar vermesi gereken fazlarda
 * görünür. idle/checking/none → overlay yok → menü açık kalır, yani güncellemesi
 * olmayan kullanıcı hiçbir yükleme ekranı/spinner görmez.
 */
export function shouldShowOverlay(phase: UpdatePhase): boolean {
  return (
    phase === 'available' ||
    phase === 'downloading' ||
    phase === 'ready' ||
    phase === 'error'
  );
}
