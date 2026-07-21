import { Circle, G, Line, Polygon } from 'react-native-svg';

import { Glow, Layer, Shell } from '../signals/icons/anim';
import { leagueByKey, type LeagueKey } from './catalog';

/** Lig rozeti — "Sigil": HUD tikli DÖNEN dış halka + kademeye özgü sabit glif +
 *  ortak ice merkez-düğüm + neon glow. Kademe (tier 1→7) glifi büyüyen bir ağ
 *  anlatır: nokta → bağ → üçlü düğüm → 4/5/6 kafes → yıldız patlaması. Renk kademe
 *  kimliği; ad + renk birlikte ligi belli eder.
 *
 *  Geometri artifact'takiyle BİREBİR aynı 120-uzayında yazılır; `Layer` 256 viewBox
 *  kullandığı için hepsi `<G scale={K}>` ile 256'ya oturtulur (60→128). Dönen halka
 *  `motion="rotate"` (View seviyesi reanimated, native thread → performanslı). */

const ICE = '#d6f4ff';
const K = 256 / 120; // 120-uzayı → 256 viewBox

/** Ortak merkez-düğüm (tüm gliflerde aynı → tutarlı aile). */
function CenterNode() {
  return (
    <>
      <Circle cx={60} cy={60} r={6} fill="none" stroke={ICE} strokeOpacity={0.9} strokeWidth={1.8} />
      <Circle cx={60} cy={60} r={2.4} fill={ICE} />
    </>
  );
}

/** Çokgen kabuk + merkeze spoke'lar + köşe düğümleri (T4/T5/T6 kafesleri). */
function Lattice({
  points,
  verts,
  c,
}: {
  points: string;
  verts: readonly (readonly [number, number])[];
  c: string;
}) {
  return (
    <>
      <Polygon points={points} fill="none" stroke={c} strokeWidth={2.4} strokeLinejoin="round" />
      {verts.map(([x, y], i) => (
        <Line key={`s${i}`} x1={60} y1={60} x2={x} y2={y} stroke={c} strokeOpacity={0.45} strokeWidth={1.4} />
      ))}
      {verts.map(([x, y], i) => (
        <Circle key={`d${i}`} cx={x} cy={y} r={2.2} fill={c} />
      ))}
      <CenterNode />
    </>
  );
}

/** Kademeye özgü merkez glif (120-uzayı, merkez 60,60). */
function Glyph({ tier, c }: { tier: number; c: string }) {
  switch (tier) {
    case 1: // Yörünge — iç içe halka + çekirdek
      return (
        <>
          <Circle cx={60} cy={60} r={16} fill="none" stroke={c} strokeOpacity={0.4} strokeWidth={1.4} />
          <Circle cx={60} cy={60} r={10} fill="none" stroke={c} strokeWidth={2.6} />
          <CenterNode />
        </>
      );
    case 2: // Bağ — 2 kollu eksen
      return (
        <>
          <Line x1={40} y1={60} x2={80} y2={60} stroke={c} strokeWidth={2.6} strokeLinecap="round" />
          <Circle cx={40} cy={60} r={3.2} fill={c} />
          <Circle cx={80} cy={60} r={3.2} fill={c} />
          <CenterNode />
        </>
      );
    case 3: {
      // Üçlü düğüm — 3 spoke + düğüm
      const a = [
        [60, 40],
        [77.3, 70],
        [42.7, 70],
      ] as const;
      return (
        <>
          {a.map(([x, y], i) => (
            <Line key={`s${i}`} x1={60} y1={60} x2={x} y2={y} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
          ))}
          {a.map(([x, y], i) => (
            <Circle key={`d${i}`} cx={x} cy={y} r={3} fill={c} />
          ))}
          <CenterNode />
        </>
      );
    }
    case 4: // Elmas kafes (4 düğüm)
      return (
        <Lattice
          points="60,40 80,60 60,80 40,60"
          verts={[
            [60, 40],
            [80, 60],
            [60, 80],
            [40, 60],
          ]}
          c={c}
        />
      );
    case 5: // Beşgen kafes (5 düğüm)
      return (
        <Lattice
          points="60,40 79,53.8 71.8,76.2 48.2,76.2 41,53.8"
          verts={[
            [60, 40],
            [79, 53.8],
            [71.8, 76.2],
            [48.2, 76.2],
            [41, 53.8],
          ]}
          c={c}
        />
      );
    case 6: // Altıgen kafes (6 düğüm)
      return (
        <Lattice
          points="80,60 70,77.3 50,77.3 40,60 50,42.7 70,42.7"
          verts={[
            [80, 60],
            [70, 77.3],
            [50, 77.3],
            [40, 60],
            [50, 42.7],
            [70, 42.7],
          ]}
          c={c}
        />
      );
    default: {
      // 7 — Yıldız patlaması (8 kol) + halka
      const rays = [
        [60, 40, 60, 80],
        [40, 60, 80, 60],
        [46, 46, 74, 74],
        [74, 46, 46, 74],
      ] as const;
      return (
        <>
          {rays.map(([x1, y1, x2, y2], i) => (
            <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
          ))}
          <Circle cx={60} cy={60} r={6.5} fill="none" stroke={ICE} strokeWidth={2} />
          <Circle cx={60} cy={60} r={2.4} fill={ICE} />
        </>
      );
    }
  }
}

/** Statik iç halka + 3 sabit HUD düğümü (dış tik halkasının içinde). */
function InnerRing({ c }: { c: string }) {
  const R = 45;
  const nodes = [0, 1, 2].map((k) => {
    const a = (k / 3) * 2 * Math.PI - Math.PI / 2;
    return [60 + R * Math.cos(a), 60 + R * Math.sin(a)] as const;
  });
  return (
    <>
      <Circle cx={60} cy={60} r={34} fill="none" stroke={c} strokeOpacity={0.3} strokeWidth={1} />
      {nodes.map(([x, y], i) => (
        <Circle key={i} cx={x} cy={y} r={2.6} fill={ICE} />
      ))}
    </>
  );
}

/** Dönen dış tik halkası — tik sayısı kademeyle artar. */
function TickRing({ tier, c }: { tier: number; c: string }) {
  const R = 45;
  const ticks = 10 + tier * 2;
  const gap = (2 * Math.PI * R) / ticks - 2;
  return (
    <Circle
      cx={60}
      cy={60}
      r={R}
      fill="none"
      stroke={c}
      strokeOpacity={0.75}
      strokeWidth={2.2}
      strokeDasharray={[2, gap]}
      strokeLinecap="round"
    />
  );
}

export function LeagueIcon({
  league,
  size = 64,
  animated = false,
}: {
  league: LeagueKey;
  size?: number;
  animated?: boolean;
}) {
  const lg = leagueByKey(league);
  const c = lg.color;
  return (
    <Shell size={size}>
      <Glow size={size} color={c} animated={animated} />
      {/* Dış tik halkası — animated iken yavaş döner (artifact'taki gibi). */}
      <Layer size={size} animated={animated} motion="rotate">
        <G scale={K}>
          <TickRing tier={lg.tier} c={c} />
        </G>
      </Layer>
      {/* Sabit: iç halka + HUD düğümleri + kademe glifi. */}
      <Layer size={size} animated={animated} motion="none">
        <G scale={K}>
          <InnerRing c={c} />
          <Glyph tier={lg.tier} c={c} />
        </G>
      </Layer>
    </Shell>
  );
}
