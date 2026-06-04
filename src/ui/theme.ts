import { Platform } from 'react-native';

/** Ana neon vurgunun (elektrik mavisi #2fa8e0) RGB bileşenleri — alpha türevleri tek yerden. */
const PRIMARY_RGB = '47, 168, 224';

/** Primary'nin istenen opaklıkta yarı saydam hali. */
export const cyanAlpha = (alpha: number) => `rgba(${PRIMARY_RGB}, ${alpha})`;

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
};

/** Sayılar için monospace his. */
export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'ui-monospace, Menlo, monospace',
});
