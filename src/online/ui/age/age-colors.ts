import type { AgePlayer } from '@/online';

/** Gizem Çağı takım renkleri. "SEN" her zaman ALTIN; diğer iki oyuncu slot
 *  sırasına göre KIRMIZI ve YEŞİL (mavi harita zeminiyle karışmasın). Böylece
 *  kendini her zaman altın görürsün, rakiplerin sabit kırmızı/yeşil kalır; "sen"
 *  ayrımı ayrıca ad/kenarlıkla da yapılır. Nötr (bot) gri. Gizem Çağı'nda seyirci
 *  olmadığı için izleyici-göreli renk sorun değil. blue = modun genel aksanı
 *  (paneller/butonlar), oyuncu rengi DEĞİL.
 *  NOT: sunucu slot'u 1-TABANLI (1/2/3). Burada ham indeks değil slot SIRASI
 *  kullanılır → 0/1 taban farkından (off-by-one) etkilenmez. */
export const AGE = { blue: '#4a90ff', you: '#f5c451', red: '#ff5b5b', green: '#46cf7c', gray: '#6b7690' };

/** Slot sırasına göre sabit palet (izleyici/edge yedeği): altın → kırmızı → yeşil. */
export const AGE_SLOT_COLORS = [AGE.you, AGE.red, AGE.green];

/** playerId → renk. `me` verilir ve oyunculardan biriyse: SEN=altın, diğer ikisi
 *  slot sırasına göre kırmızı/yeşil. `me` yoksa (edge): slot sırasına göre sabit
 *  altın/kırmızı/yeşil. Slot SIRASI kullanılır → 1-tabanlı sunucu slot'larıyla
 *  uyumlu (eski `[p.slot]` ham indeksi slot 3'ü GRİ bırakıyordu — düzeltildi). */
export function ageColors(players: AgePlayer[], me?: string): Record<string, string> {
  const map: Record<string, string> = {};
  const ordered = [...players].sort((a, b) => a.slot - b.slot);
  const meIsPlayer = me != null && players.some((p) => p.player === me);
  if (meIsPlayer) {
    map[me] = AGE.you; // sen her zaman altın
    ordered
      .filter((p) => p.player !== me)
      .forEach((p, i) => {
        map[p.player] = [AGE.red, AGE.green][i] ?? AGE.gray;
      });
  } else {
    ordered.forEach((p, i) => {
      map[p.player] = AGE_SLOT_COLORS[i] ?? AGE.gray;
    });
  }
  return map;
}

/** Sahip rengi (owner null → gri). */
export function ownerColor(owner: string | null, colorMap: Record<string, string>): string {
  return owner ? colorMap[owner] ?? AGE.gray : AGE.gray;
}
