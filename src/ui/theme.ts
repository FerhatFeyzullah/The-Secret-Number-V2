import { Platform } from 'react-native';

/** Ana neon vurgunun (elektrik mavisi #2fa8e0) RGB bileşenleri — alpha türevleri tek yerden. */
const PRIMARY_RGB = '47, 168, 224';

/** Primary'nin istenen opaklıkta yarı saydam hali. */
export const cyanAlpha = (alpha: number) => `rgba(${PRIMARY_RGB}, ${alpha})`;

/** Herhangi bir #rrggbb vurgu rengini istenen opaklıkta rgba'ya çevirir
 *  (lobide cyan/amber gibi dinamik aksanlarda dolgu/glow üretmek için). */
export const withAlpha = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/** Köşe vinyetinin (koyu #060c1a) RGB bileşenleri — saydam ucu aynı tondan olsun. */
const VIGNETTE_RGB = '6, 12, 26';

/** "Şifre kırma / gizem" teması: koyu teknolojik mavi zemin, neon vurgular. */
export const colors = {
  bgTop: '#0a1428',
  bgMid: '#0e1d3e', // ortası hafifçe açık: kenarlara koyulaşan vinyet hissi
  bgBottom: '#0d1b3a',
  cyan: '#2fa8e0',
  cyanDeep: '#1e7fc4', // glow / koyu varyant
  cyanDim: cyanAlpha(0.4),
  ice: '#d6f4ff', // beyazımsı buz mavisi — "ışıldayan beyaz neon" başlık metni
  vignette: `rgba(${VIGNETTE_RGB}, 0.5)`, // kenar/köşe koyulaşması
  vignetteClear: `rgba(${VIGNETTE_RGB}, 0)`, // vinyetin saydam merkezi

  amber: '#ffc857',
  text: '#e8ecff',
  dim: '#8e97c9',
  faintDigit: cyanAlpha(0.14),
  glass: 'rgba(255, 255, 255, 0.07)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  danger: '#ff7b7b',
  success: '#4ade80', // doğru tahmin / kazanç yeşili (düello geri bildirim çipi)
  // Lider tablosu podyum madalyaları (tema ile uyumlu tonlar).
  gold: '#f5c451',
  silver: '#c8d2e0',
  bronze: '#d08a52',
};

/** Sayılar için monospace his. */
export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, Menlo, monospace',
});
