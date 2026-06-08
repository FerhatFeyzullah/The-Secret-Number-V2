import { useId } from 'react';
import { Defs, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';

import { Glow, Layer, Shell } from '../signals/icons/anim';
import { leagueByKey, type LeagueKey } from './catalog';

/** Lig rozeti — sinyal ikon konvansiyonu (Shell + Glow + Layer, 256 viewBox,
 *  {size, animated}). Ortak altıgen kalkan + kademe gradyanı + glow; merkez
 *  amblem kademe ilerlemesini gösterir: yıldız (Bronz→Altın) → mücevher
 *  (Platin/Elmas) → taç (Usta/Efsane). Renk + ad birlikte ligi belli eder. */

// Açık→koyu gradyan çiftleri (kademe renginin tepe/dip tonları).
const GRAD: Record<LeagueKey, [string, string]> = {
  bronze: ['#E8A86A', '#9E5A24'],
  silver: ['#EEF3F9', '#8A95A3'],
  gold: ['#FCE08A', '#C8920A'],
  platinum: ['#9CF3E5', '#2BB8A4'],
  diamond: ['#A9DEFF', '#2A93D8'],
  master: ['#CDBCFB', '#7C53E6'],
  legend: ['#FFB3C4', '#E23E63'],
};

const rid = (s: string) => s.replace(/:/g, '');

// 5 köşeli yıldız (cx128, cy124, R50/r20).
const STAR =
  '128,74 139.8,107.8 175.6,108.6 147,130.2 157.4,164.5 128,144 98.6,164.5 109,130.2 80.4,108.6 116.2,107.8';

function Emblem({ tier, dark }: { tier: number; dark: string }) {
  const fill = '#FFFFFF';
  if (tier <= 3) {
    // Yıldız.
    return <Polygon points={STAR} fill={fill} fillOpacity={0.92} />;
  }
  if (tier <= 5) {
    // Mücevher (brilliant) + faset çizgileri.
    return (
      <>
        <Polygon points="128,80 172,114 128,176 84,114" fill={fill} fillOpacity={0.92} />
        <Path
          d="M84,114 H172 M128,80 L110,114 L128,176 M128,80 L146,114 L128,176"
          stroke={dark}
          strokeOpacity={0.5}
          strokeWidth={4}
          fill="none"
          strokeLinejoin="round"
        />
      </>
    );
  }
  // Taç (3 tepe).
  return (
    <Path
      d="M80 172 L72 104 L104 132 L128 88 L152 132 L184 104 L176 172 Z"
      fill={fill}
      fillOpacity={0.92}
      stroke={dark}
      strokeOpacity={0.35}
      strokeWidth={4}
      strokeLinejoin="round"
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
  const grad = GRAD[league];
  const id = `lg${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={lg.color} animated={animated} />
      <Layer size={size} animated={animated} motion={animated ? 'breathe' : 'none'}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={grad[0]} />
            <Stop offset="1" stopColor={grad[1]} />
          </LinearGradient>
        </Defs>
        {/* Altıgen kalkan. */}
        <Path
          d="M128 26 L212 78 V178 L128 230 L44 178 V78 Z"
          fill={`url(#${id})`}
          fillOpacity={0.96}
          stroke={lg.color}
          strokeWidth={12}
          strokeLinejoin="round"
        />
        {/* Üst sheen. */}
        <Path
          d="M70 80 L128 44 L186 80"
          stroke="#FFFFFF"
          strokeOpacity={0.32}
          strokeWidth={7}
          strokeLinecap="round"
          fill="none"
        />
        <Emblem tier={lg.tier} dark={grad[1]} />
      </Layer>
    </Shell>
  );
}
