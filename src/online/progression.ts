// Seviye → unvan eşlemesi (salt istemci; sunucuya gerek yok).
// Seviye 1-10; aralık dışı değerler uçlara sıkıştırılır.
const LEVEL_TITLES = [
  'Çırak', //        1
  'Çözücü', //       2
  'Gözcü', //        3
  'Dedektif', //     4
  'Şifreci', //      5
  'Kod Kırıcı', //   6
  'Sır Avcısı', //   7
  'Zihin Okuyucu', //8
  'Gizem Ustası', // 9
  'Efsane', //       10
] as const;

/** En yüksek seviye (eşik tablosuyla aynı: 10). */
export const MAX_LEVEL = LEVEL_TITLES.length;

/** Son-seviye cilası eşiği: 8-10 görsel olarak ayrışır (altın tonu + güçlü parıltı). */
export const ELITE_LEVEL = 8;

/** Verilen seviyenin unvanı (1-10 arası sıkıştırılır). */
export function levelTitle(level: number): string {
  const i = Math.min(MAX_LEVEL, Math.max(1, Math.floor(level))) - 1;
  return LEVEL_TITLES[i];
}

/** Seviye elit aralıkta mı (8-10) — son-seviye cilası için. */
export function isEliteLevel(level: number): boolean {
  return level >= ELITE_LEVEL;
}
