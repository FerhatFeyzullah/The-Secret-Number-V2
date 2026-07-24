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

/** "Kuşatma altında" işareti — düğüm köşesine rozet olarak konur. Çapraz kılıç
 *  (flaticon 861908 tarzı, dolu/solid) — referanstan esinlenilmiş ÖZGÜN çizim
 *  (asset gömülmedi → lisans/atıf gerekmez). Tek renk. */
export function AgeSiege({ size = 18, color }: { size?: number; color: string }) {
  const sword = (
    <>
      <Path d="M12 1 L10.4 4.2 L13.6 4.2 Z" fill={color} />
      <Rect x={10.9} y={4} width={2.2} height={11} fill={color} />
      <Rect x={8} y={14.6} width={8} height={1.9} rx={0.6} fill={color} />
      <Rect x={11} y={16.4} width={2} height={3.4} fill={color} />
      <Circle cx={12} cy={20.7} r={1.5} fill={color} />
    </>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G transform="rotate(45 12 12)">{sword}</G>
      <G transform="rotate(-45 12 12)">{sword}</G>
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

/** Mazgal (crenellation) yol üreteci — [x0,x1] arası n eşit diş. Mevcut keep
 *  mazgalını birebir üretir (n=4, taban / taban-8 / taban-3). */
function cren(x0: number, x1: number, yBase: number, yTooth: number, yNotch: number, n: number): string {
  const seg = (x1 - x0) / (2 * n - 1);
  let x = x0;
  let d = `M${x0} ${yBase} L${x0} ${yTooth}`;
  for (let i = 0; i < 2 * n - 1; i++) {
    const nx = x + seg;
    if (i % 2 === 0) d += ` L${nx.toFixed(2)} ${yTooth}`;
    else d += ` L${x.toFixed(2)} ${yNotch} L${nx.toFixed(2)} ${yNotch} L${nx.toFixed(2)} ${yTooth}`;
    x = nx;
  }
  return d + ` L${x1} ${yBase} Z`;
}

/** Harita düğümü — detaylı KALE. `level` (harf sayısı, 4/5/6) dış görünümü
 *  belirler: 4 = mevcut (dar, tek sancak); 5 = yayvan + yüksek + burç kulesi;
 *  6 = en geniş + en yüksek + taç (taht). color = sahip rengi (nötr için gri). */
export function AgeCastle({ size = 56, color, level = 4 }: { size?: number; color: string; level?: number }) {
  // 4 (veya belirsiz) → mevcut ikon (birebir).
  if (level < 5) {
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

  // 5 / 6 → hem yukarı hem yana büyür (artifact ile aynı ölçüler).
  const P =
    level === 5
      ? { outer: 32, inner: 17, kh: 16, kTop: -19, tTop: -6, tuH: 8, tuBase: -27, tuTop: -33 }
      : { outer: 35, inner: 18, kh: 18, kTop: -22, tTop: -8, tuH: 9, tuBase: -30, tuTop: -35 };
  return (
    <Svg width={size} height={(size * 74) / 72} viewBox="-36 -40 72 74">
      <Ellipse cx={0} cy={30} rx={P.outer} ry={8} fill={color} opacity={0.16} />
      {/* yan kuleler (dışa yayvan) */}
      <Path d={`M${-P.outer} 30 L${-P.outer} ${P.tTop} L${-P.inner} ${P.tTop} L${-P.inner} 30 Z`} fill={color} />
      <Path d={cren(-P.outer, -P.inner, P.tTop, P.tTop - 7, P.tTop - 3, 3)} fill={color} />
      <Path d={`M${P.inner} 30 L${P.inner} ${P.tTop} L${P.outer} ${P.tTop} L${P.outer} 30 Z`} fill={color} />
      <Path d={cren(P.inner, P.outer, P.tTop, P.tTop - 7, P.tTop - 3, 3)} fill={color} />
      {/* keep (geniş) */}
      <Path d={`M${-P.kh} 30 L${-P.kh} ${P.kTop} L${P.kh} ${P.kTop} L${P.kh} 30 Z`} fill={color} />
      <Path d={cren(-P.kh, P.kh, P.kTop, P.kTop - 8, P.kTop - 3, 5)} fill={color} />
      {/* gölge katmanları */}
      <Path d={`M0 ${P.kTop} L${P.kh} ${P.kTop} L${P.kh} 30 L0 30 Z`} fill="#000" opacity={0.16} />
      <Path d={`M${P.inner} ${P.tTop} L${P.outer} ${P.tTop} L${P.outer} 30 L${P.inner} 30 Z`} fill="#000" opacity={0.14} />
      {/* banding */}
      <G stroke="#000" strokeWidth={1} opacity={0.12}>
        <Line x1={-P.kh} y1={P.kTop + 12} x2={P.kh} y2={P.kTop + 12} />
        <Line x1={-P.kh} y1={P.kTop + 22} x2={P.kh} y2={P.kTop + 22} />
        <Line x1={-P.kh} y1={P.kTop + 32} x2={P.kh} y2={P.kTop + 32} />
      </G>
      {/* kapı + pencere */}
      <Path d="M-7 30 L-7 5 Q0 -3 7 5 L7 30 Z" fill="#050c18" opacity={0.92} />
      <Path d={`M-3 ${P.kTop + 7} L-3 ${P.kTop + 3} Q0 ${P.kTop} 3 ${P.kTop + 3} L3 ${P.kTop + 7} Z`} fill="#050c18" opacity={0.9} />
      {/* tepe burç kulesi */}
      <Path d={`M${-P.tuH} ${P.tuBase} L${-P.tuH} ${P.tuTop} L${P.tuH} ${P.tuTop} L${P.tuH} ${P.tuBase} Z`} fill={color} />
      <Path d={`M0 ${P.tuBase} L${P.tuH} ${P.tuBase} L${P.tuH} ${P.tuTop} L0 ${P.tuTop} Z`} fill="#000" opacity={0.13} />
      {/* tepe süsü: 5 → sancak · 6 → taç */}
      {level === 5 ? (
        <>
          <Line x1={0} y1={P.tuTop} x2={0} y2={-40} stroke={color} strokeWidth={1.6} />
          <Path d="M0 -39 L11 -36 L0 -33 Z" fill={color} />
          <Path d="M0 -39 L11 -36 L0 -33 Z" fill="#fff" opacity={0.18} />
        </>
      ) : (
        <>
          <Path d={`M-6 ${P.tuTop} L-6 -38 L-3 -36 L0 -40 L3 -36 L6 -38 L6 ${P.tuTop} Z`} fill={color} />
          <Circle cx={-3.6} cy={-37} r={0.9} fill="#fff" opacity={0.55} />
          <Circle cx={0} cy={-38.6} r={1.1} fill="#fff" opacity={0.65} />
          <Circle cx={3.6} cy={-37} r={0.9} fill="#fff" opacity={0.55} />
        </>
      )}
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
