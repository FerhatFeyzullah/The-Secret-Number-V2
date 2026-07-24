import type { AgePlayer } from '@/online';

/** Gizem Çağı takım renkleri. Üç oyuncunun rengi SABİT: slot sırasına göre
 *  altın / kırmızı / yeşil (mavi harita zeminiyle karışmasın). Renk izleyiciden
 *  BAĞIMSIZ — herkes aynı oyuncuyu aynı renkte görür; "sen" ayrımı ad/kenarlıkla
 *  yapılır (herkes kendini sarı görmez). Nötr (bot) gri. blue = modun genel
 *  aksan rengi (paneller/butonlar), oyuncu rengi DEĞİL. */
export const AGE = { blue: '#4a90ff', you: '#f5c451', red: '#ff5b5b', green: '#46cf7c', gray: '#6b7690' };

/** Slot → sabit oyuncu rengi (0: altın, 1: kırmızı, 2: yeşil). */
export const AGE_SLOT_COLORS = [AGE.you, AGE.red, AGE.green];

/** playerId → renk. Slot sırasına göre sabit (izleyiciden bağımsız). */
export function ageColors(players: AgePlayer[], _me?: string): Record<string, string> {
  const map: Record<string, string> = {};
  players.forEach((p) => {
    map[p.player] = AGE_SLOT_COLORS[p.slot] ?? AGE.gray;
  });
  return map;
}

/** Sahip rengi (owner null → gri). */
export function ownerColor(owner: string | null, colorMap: Record<string, string>): string {
  return owner ? colorMap[owner] ?? AGE.gray : AGE.gray;
}
