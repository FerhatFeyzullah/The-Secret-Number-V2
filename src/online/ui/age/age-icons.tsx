import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

/** Zafer tacı (sonuç ekranı 1. sıra). Altın. */
export function AgeCrown({ size = 46 }: { size?: number }) {
  return (
    <Svg width={size} height={(size * 40) / 60} viewBox="-30 -26 60 40">
      <Path d="M-24 6 L-28 -16 L-14 -4 L0 -22 L14 -4 L28 -16 L24 6 Z" fill="#f5c451" stroke="#8a6a1e" strokeWidth={1} />
      <Rect x={-25} y={6} width={50} height={7} rx={2} fill="#f5c451" stroke="#8a6a1e" strokeWidth={1} />
      <Circle cx={0} cy={-22} r={3} fill="#ffe9a8" />
      <Circle cx={-28} cy={-16} r={2.4} fill="#ffe9a8" />
      <Circle cx={28} cy={-16} r={2.4} fill="#ffe9a8" />
    </Svg>
  );
}

/** Gizem Çağı turnuva ikonu — Gizemli Kule diliyle tek-renk SANCAKLI HİSAR
 *  (mazgallı iki yan kule + keep + kemerli kapı/pencere + arrow-slit + pennant).
 *  evenodd oyuklar; tek fill accent. 24 viewBox. */
export function AgeEmblem({ size = 32, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d={
          'M3 21 L3 7.8 L4.4 7.8 L4.4 9.6 L5.6 9.6 L5.6 7.8 L7 7.8 L7 9.6 L8.5 9.6 ' +
          'L8.5 3.8 L10 3.8 L10 5.6 L11.2 5.6 L11.2 3.8 L12.8 3.8 L12.8 5.6 L14 5.6 L14 3.8 L15.5 3.8 ' +
          'L15.5 9.6 L17 9.6 L17 7.8 L18.4 7.8 L18.4 9.6 L19.6 9.6 L19.6 7.8 L21 7.8 L21 21 Z ' +
          'M10.2 21 L10.2 15 Q12 12.8 13.8 15 L13.8 21 Z ' +
          'M11.2 11.4 L11.2 9.9 Q12 9 12.8 9.9 L12.8 11.4 Z ' +
          'M5.15 15 L5.15 13 Q5.8 12.4 6.45 13 L6.45 15 Z ' +
          'M17.55 15 L17.55 13 Q18.2 12.4 18.85 13 L18.85 15 Z'
        }
      />
      <Path fill={color} d="M11.75 3.9 L11.75 0.6 L12.4 0.6 L12.4 3.9 Z M12.4 0.9 L16.4 2.05 L12.4 3.2 Z" />
    </Svg>
  );
}

/** Harita düğümü — detaylı KALE (yan kuleler + keep + kapı/pencere + sancak +
 *  gölge/banding). color = sahip rengi (nötr için gri). */
export function AgeCastle({ size = 56, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={(size * 74) / 72} viewBox="-36 -40 72 74">
      <Ellipse cx={0} cy={30} rx={34} ry={8} fill={color} opacity={0.16} />
      <Path d="M-30 30 L-30 -4 L-18 -4 L-18 30 Z" fill={color} />
      <Path d="M-30 -4 L-30 -11 L-27 -11 L-27 -7 L-24 -7 L-24 -11 L-21 -11 L-21 -7 L-18 -7 L-18 -4 Z" fill={color} />
      <Path d="M18 30 L18 -4 L30 -4 L30 30 Z" fill={color} />
      <Path d="M18 -4 L18 -11 L21 -11 L21 -7 L24 -7 L24 -11 L27 -11 L27 -7 L30 -7 L30 -11 L30 -4 Z" fill={color} />
      <Path d="M-14 30 L-14 -16 L14 -16 L14 30 Z" fill={color} />
      <Path d="M-14 -16 L-14 -24 L-10 -24 L-10 -19 L-6 -19 L-6 -24 L-2 -24 L-2 -19 L2 -19 L2 -24 L6 -24 L6 -19 L10 -19 L10 -24 L14 -24 L14 -16 Z" fill={color} />
      <Path d="M0 -16 L14 -16 L14 30 L0 30 Z" fill="#000" opacity={0.16} />
      <Path d="M18 -4 L30 -4 L30 30 L18 30 Z" fill="#000" opacity={0.14} />
      <G stroke="#000" strokeWidth={1} opacity={0.12}>
        <Line x1={-14} y1={-4} x2={14} y2={-4} />
        <Line x1={-14} y1={8} x2={14} y2={8} />
        <Line x1={-14} y1={20} x2={14} y2={20} />
      </G>
      <Path d="M-6 30 L-6 4 Q0 -3 6 4 L6 30 Z" fill="#050c18" opacity={0.92} />
      <Path d="M-3 -9 L-3 -13 Q0 -16 3 -13 L3 -9 Z" fill="#050c18" opacity={0.9} />
      <Line x1={0} y1={-24} x2={0} y2={-38} stroke={color} strokeWidth={1.6} />
      <Path d="M0 -37 L13 -33 L0 -29 Z" fill={color} />
      <Path d="M0 -37 L13 -33 L0 -29 Z" fill="#fff" opacity={0.18} />
    </Svg>
  );
}

/** Harita düğümü — detaylı NÖBET KULESİ (mazgallı, kemerli kapı, banding, fener). */
export function AgeTower({ size = 34, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={(size * 44) / 40} viewBox="-20 -24 40 44">
      <Ellipse cx={0} cy={20} rx={17} ry={5} fill={color} opacity={0.16} />
      <Path d="M-10 20 L-8.5 -8 L8.5 -8 L10 20 Z" fill={color} />
      <Path d="M-9 -8 L-9 -15 L-6 -15 L-6 -11 L-3 -11 L-3 -15 L-1.5 -15 L-1.5 -11 L1.5 -11 L1.5 -15 L3 -15 L3 -11 L6 -11 L6 -15 L9 -15 L9 -8 Z" fill={color} />
      <Path d="M0 -8 L8.5 -8 L10 20 L0 20 Z" fill="#000" opacity={0.16} />
      <G stroke="#000" strokeWidth={0.9} opacity={0.13}>
        <Line x1={-9} y1={0} x2={9} y2={0} />
        <Line x1={-9.6} y1={10} x2={9.6} y2={10} />
      </G>
      <Path d="M-3.5 20 L-3.5 6 Q0 2 3.5 6 L3.5 20 Z" fill="#050c18" opacity={0.9} />
    </Svg>
  );
}
