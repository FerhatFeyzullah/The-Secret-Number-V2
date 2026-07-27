import type { AgePlayer } from '@/online';

/** Gizem Çağı takım renkleri. "SEN" her zaman ALTIN; diğer iki oyuncu slot
 *  sırasına göre KIRMIZI ve YEŞİL (mavi harita zeminiyle karışmasın). Böylece
 *  kendini her zaman altın görürsün, rakiplerin sabit kırmızı/yeşil kalır; "sen"
 *  ayrımı ayrıca ad/kenarlıkla da yapılır. Nötr (bot) gri. Gizem Çağı'nda seyirci
 *  olmadığı için izleyici-göreli renk sorun değil. blue = modun genel aksanı
 *  (paneller/butonlar), oyuncu rengi DEĞİL.
 *  NOT: sunucu slot'u 1-TABANLI (1/2/3). Burada ham indeks değil slot SIRASI
 *  kullanılır → 0/1 taban farkından (off-by-one) etkilenmez. */
export const AGE = { blue: '#4a90ff', you: '#f5c451', red: '#ff5b5b', green: '#46cf7c', gray: '#6b7690', prep: '#d08a52' };

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

// ── Hacim paleti (Clash tarzı 3 ton) ────────────────────────────────────────
// Kale/kule gövdeleri düz tek renk değil: üst yüz AÇIK, ön yüz GÖVDE, sağ yan
// KOYU. Üç ton tek bir sahip renginden türetilir → yeni oyuncu rengi eklemek
// için ekstra sabit gerekmez.

/** #rrggbb → [r,g,b]. */
function toRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0');

/** Rengi aydınlat (f > 0 → beyaza) / karart (f < 0 → koyu lacivert zemine).
 *  Karartma saf siyaha değil #050c18'e gider → gölgeler oyunun mavi zeminiyle
 *  aynı ailede kalır, "kirli gri" görünmez. */
export function tone(hex: string, f: number): string {
  const [r, g, b] = toRgb(hex);
  const [tr, tg, tb] = f >= 0 ? [255, 255, 255] : [5, 12, 24];
  const k = Math.abs(f);
  return `#${hex2(r + (tr - r) * k)}${hex2(g + (tg - g) * k)}${hex2(b + (tb - b) * k)}`;
}

export type AgePalette = {
  /** Üst yüz / kenar ışığı. */ light: string;
  /** Ön yüz (ana gövde). */ body: string;
  /** Sağ yan gölge. */ shade: string;
  /** Kontur / en koyu detay. */ deep: string;
};

const paletteCache = new Map<string, AgePalette>();

/** Sahip renginden 4 katmanlı hacim paleti (render başına yeniden hesaplanmasın
 *  diye önbellekli — haritada 20 düğüm var). */
export function palette(color: string): AgePalette {
  const hit = paletteCache.get(color);
  if (hit) return hit;
  const p: AgePalette = {
    light: tone(color, 0.34),
    body: color,
    shade: tone(color, -0.34),
    deep: tone(color, -0.62),
  };
  paletteCache.set(color, p);
  return p;
}
