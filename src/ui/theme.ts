import { Platform } from 'react-native';

/** "Şifre kırma / gizem" teması: koyu lacivert-indigo zemin, neon vurgular. */
export const colors = {
  bgTop: '#070b24',
  bgMid: '#0d1340',
  bgBottom: '#161d52',
  cyan: '#34e0ff',
  cyanDim: 'rgba(52, 224, 255, 0.35)',
  amber: '#ffc857',
  text: '#e8ecff',
  dim: '#8e97c9',
  faintDigit: 'rgba(130, 150, 255, 0.13)',
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
