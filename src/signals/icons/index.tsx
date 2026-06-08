import { useId } from 'react';
import { Circle, Defs, Ellipse, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Glow, Layer, Shell } from './anim';

/** Sinyal ikonu — zenginleştirilmiş (gradyan + neon glow + parlak vurgu) ve
 *  `animated` ile hafif/döngüsel hareketli (reanimated, View seviyesi). 256
 *  viewBox, `size` ile ölçeklenir (varsayılan 64). 48px'te tanınırlık korunur. */
export type SignalIconProps = { size?: number; animated?: boolean };

const C = {
  blue: '#2FA8E0',
  amber: '#FBBF24',
  teal: '#2DD4BF',
  green: '#4ADE80',
  red: '#EF4444',
  violet: '#A78BFA',
  ink: '#0A1428',
  ice: '#EAF8FF',
};

// Derinlik için açık→koyu gradyan çiftleri (tepe açık, dip koyu).
const GRAD: Record<string, [string, string]> = {
  blue: ['#86D3F2', '#1B6FA8'],
  amber: ['#FDE68A', '#D9920B'],
  teal: ['#86ECDD', '#149B8C'],
  green: ['#AEF4CC', '#22B455'],
  red: ['#FCA5A5', '#D32F2F'],
  violet: ['#C9BBFD', '#7A56E8'],
};

const SW = 12;
const rid = (s: string) => s.replace(/:/g, '');

/** Ortak yüz zemini: küresel radyal gradyan + üst-sol parlak sheen. */
function faceDefs(id: string, pair: [string, string]) {
  return (
    <Defs>
      <RadialGradient id={id} cx="38%" cy="32%" r="74%">
        <Stop offset="0" stopColor={pair[0]} stopOpacity="0.55" />
        <Stop offset="1" stopColor={pair[1]} stopOpacity="0.28" />
      </RadialGradient>
    </Defs>
  );
}

/** 1 — Zafer: kupa (altın gradyan) + parlama nabzı. */
export function VictoryIcon({ size = 64, animated = false }: SignalIconProps) {
  const cup = `cup${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.amber} animated={animated} />
      <Layer size={size} animated={animated} motion="pulse">
        <Defs>
          <LinearGradient id={cup} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={GRAD.amber[0]} />
            <Stop offset="1" stopColor={GRAD.amber[1]} />
          </LinearGradient>
        </Defs>
        <Path d="M74 54 H182 L171 100 C162 134 148 152 128 152 C108 152 94 134 85 100 Z" fill={`url(#${cup})`} fillOpacity={0.92} stroke={C.amber} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M76 66 C46 66 46 114 86 122" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M180 66 C210 66 210 114 170 122" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M128 152 V180" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M98 198 H158 L148 180 H108 Z" fill={`url(#${cup})`} fillOpacity={0.92} stroke={C.amber} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M84 208 H172" stroke={C.amber} strokeWidth={14} strokeLinecap="round" />
        <Path d="M101 70 C96 94 104 118 116 132" stroke={C.ice} strokeOpacity={0.6} strokeWidth={7} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 2 — Mağlubiyet: üzgün surat (mat mavi) + yumuşak nefes. */
export function DefeatIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.blue} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        {faceDefs(f, GRAD.blue)}
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.blue} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Path d="M86 104 L118 112" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M170 104 L138 112" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
        <Circle cx={102} cy={132} r={9} fill={C.blue} />
        <Circle cx={154} cy={132} r={9} fill={C.blue} />
        <Path d="M92 184 Q128 152 164 184" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 3 — Düşünüyor: düşünce balonu + belirip kaybolan "?" (mavi). */
export function ThinkingIcon({ size = 64, animated = false }: SignalIconProps) {
  const b = `b${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.blue} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        <Defs>
          <RadialGradient id={b} cx="40%" cy="35%" r="75%">
            <Stop offset="0" stopColor={GRAD.blue[0]} stopOpacity="0.5" />
            <Stop offset="1" stopColor={GRAD.blue[1]} stopOpacity="0.25" />
          </RadialGradient>
        </Defs>
        <Ellipse cx={136} cy={104} rx={80} ry={58} fill={`url(#${b})`} stroke={C.blue} strokeWidth={SW} />
        <Circle cx={80} cy={178} r={15} fill={C.blue} fillOpacity={0.18} stroke={C.blue} strokeWidth={9} />
        <Circle cx={52} cy={210} r={8} fill={C.blue} />
      </Layer>
      <Layer size={size} animated={animated} motion="blink">
        <Path d="M112 88 C112 70 160 70 160 94 C160 114 136 110 136 130" stroke={C.ice} strokeWidth={SW} strokeLinecap="round" />
        <Circle cx={136} cy={150} r={7} fill={C.ice} />
      </Layer>
    </Shell>
  );
}

/** 4 — İnanamıyorum: iri gözler + ışın (teal) + titreşim. */
export function DisbeliefIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.teal} animated={animated} />
      <Layer size={size} animated={animated} motion="shake">
        {faceDefs(f, GRAD.teal)}
        <Path d="M128 14 V42 M102 22 L114 46 M154 22 L142 46" stroke={C.teal} strokeWidth={10} strokeLinecap="round" />
        <Circle cx={128} cy={142} r={78} fill={`url(#${f})`} stroke={C.teal} strokeWidth={SW} />
        <Circle cx={100} cy={132} r={16} fill={C.ice} fillOpacity={0.9} stroke={C.teal} strokeWidth={8} />
        <Circle cx={100} cy={135} r={6} fill={C.ink} />
        <Circle cx={156} cy={132} r={16} fill={C.ice} fillOpacity={0.9} stroke={C.teal} strokeWidth={8} />
        <Circle cx={156} cy={135} r={6} fill={C.ink} />
        <Circle cx={128} cy={182} r={13} fill={C.teal} fillOpacity={0.2} stroke={C.teal} strokeWidth={8} />
      </Layer>
    </Shell>
  );
}

/** 5 — Kendinden Emin: güneş gözlüğü + sırıtış (mavi) + nefes. */
export function ConfidentIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  const gl = `gl${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.blue} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        {faceDefs(f, GRAD.blue)}
        <Defs>
          <LinearGradient id={gl} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1B6FA8" />
            <Stop offset="1" stopColor="#0A1428" />
          </LinearGradient>
        </Defs>
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.blue} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Path d="M70 106 H122 V122 A26 26 0 0 1 70 122 Z" fill={`url(#${gl})`} stroke={C.blue} strokeWidth={4} />
        <Path d="M134 106 H186 V122 A26 26 0 0 1 134 122 Z" fill={`url(#${gl})`} stroke={C.blue} strokeWidth={4} />
        <Path d="M122 110 H134" stroke={C.blue} strokeWidth={8} strokeLinecap="round" />
        <Path d="M102 170 Q132 190 160 166" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 6 — Şoke: iri yuvarlak gözler + "O" ağız (violet) + titreşim. */
export function ShockIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.violet} animated={animated} />
      <Layer size={size} animated={animated} motion="shake">
        {faceDefs(f, GRAD.violet)}
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.violet} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Circle cx={100} cy={110} r={16} fill={C.ice} fillOpacity={0.9} stroke={C.violet} strokeWidth={8} />
        <Circle cx={100} cy={110} r={6} fill={C.ink} />
        <Circle cx={156} cy={110} r={16} fill={C.ice} fillOpacity={0.9} stroke={C.violet} strokeWidth={8} />
        <Circle cx={156} cy={110} r={6} fill={C.ink} />
        <Ellipse cx={128} cy={178} rx={18} ry={24} fill={C.ink} fillOpacity={0.55} stroke={C.violet} strokeWidth={10} />
      </Layer>
    </Shell>
  );
}

/** 7 — Kahkaha: kısık gözler + kocaman gülüş + gözyaşı (amber) + sallanma. */
export function LaughIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  const m = `m${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.amber} animated={animated} />
      <Layer size={size} animated={animated} motion="sway">
        {faceDefs(f, GRAD.amber)}
        <Defs>
          <LinearGradient id={m} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#D9920B" />
            <Stop offset="1" stopColor="#8a5d05" />
          </LinearGradient>
        </Defs>
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.amber} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Path d="M82 124 Q100 100 118 124" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M138 124 Q156 100 174 124" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M80 150 A50 50 0 0 0 176 150 Z" fill={`url(#${m})`} fillOpacity={0.85} stroke={C.amber} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M70 130 q-11 17 0 26 q11 -9 0 -26 z" fill={C.teal} />
        <Path d="M186 130 q11 17 0 26 q-11 -9 0 -26 z" fill={C.teal} />
      </Layer>
    </Shell>
  );
}

/** 8 — Sinirli: V kaşlar + çatık ağız (kırmızı) + titreme. */
export function AngerIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.red} animated={animated} />
      <Layer size={size} animated={animated} motion="shake">
        {faceDefs(f, GRAD.red)}
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.red} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.35} strokeWidth={7} strokeLinecap="round" />
        <Path d="M84 102 L120 122" stroke={C.red} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M172 102 L136 122" stroke={C.red} strokeWidth={SW} strokeLinecap="round" />
        <Circle cx={104} cy={142} r={8} fill={C.red} />
        <Circle cx={152} cy={142} r={8} fill={C.red} />
        <Path d="M98 186 Q128 164 158 186" stroke={C.red} strokeWidth={SW} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 9 — İyi Oyun: el sıkışma (yeşil) + nefes. */
export function GgIcon({ size = 64, animated = false }: SignalIconProps) {
  const g = `g${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.green} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        <Defs>
          <LinearGradient id={g} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={GRAD.green[0]} />
            <Stop offset="1" stopColor={GRAD.green[1]} />
          </LinearGradient>
        </Defs>
        <Path d="M30 200 L112 150" stroke={C.green} strokeWidth={30} strokeLinecap="round" />
        <Path d="M226 200 L144 150" stroke={C.green} strokeWidth={30} strokeLinecap="round" />
        <Rect x={88} y={116} width={80} height={56} rx={24} fill={`url(#${g})`} fillOpacity={0.92} stroke={C.green} strokeWidth={SW} />
        <Path d="M110 118 Q128 96 146 118" stroke={C.green} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M100 138 H156" stroke={C.ice} strokeOpacity={0.5} strokeWidth={6} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 10 — Şanslı Tahmin: zar + parıltı (yeşil) + sallanma. */
export function LuckyIcon({ size = 64, animated = false }: SignalIconProps) {
  const d = `d${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.green} animated={animated} />
      <Layer size={size} animated={animated} motion="sway">
        <Defs>
          <LinearGradient id={d} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={GRAD.green[0]} stopOpacity="0.6" />
            <Stop offset="1" stopColor={GRAD.green[1]} stopOpacity="0.35" />
          </LinearGradient>
        </Defs>
        <Rect x={62} y={74} width={128} height={128} rx={28} fill={`url(#${d})`} stroke={C.green} strokeWidth={SW} />
        <Circle cx={98} cy={108} r={10} fill={C.green} />
        <Circle cx={154} cy={108} r={10} fill={C.green} />
        <Circle cx={126} cy={138} r={10} fill={C.green} />
        <Circle cx={98} cy={168} r={10} fill={C.green} />
        <Circle cx={154} cy={168} r={10} fill={C.green} />
        <Path d="M76 92 H120" stroke={C.ice} strokeOpacity={0.45} strokeWidth={6} strokeLinecap="round" />
      </Layer>
      <Layer size={size} animated={animated} motion="blink">
        <Path d="M198 40 l7 19 19 7 -19 7 -7 19 -7 -19 -19 -7 19 -7 z" fill={C.amber} />
      </Layer>
    </Shell>
  );
}

/** 11 — Buldum!: ampul (amber) + açılıp kapanan ışınlar (fikir anı). */
export function EurekaIcon({ size = 64, animated = false }: SignalIconProps) {
  const b = `b${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.amber} animated={animated} />
      <Layer size={size} animated={animated} motion="blink">
        <Path d="M128 16 V36 M58 46 L72 60 M198 46 L184 60" stroke={C.amber} strokeWidth={10} strokeLinecap="round" />
      </Layer>
      <Layer size={size} animated={animated} motion="breathe">
        <Defs>
          <RadialGradient id={b} cx="42%" cy="36%" r="70%">
            <Stop offset="0" stopColor={GRAD.amber[0]} />
            <Stop offset="1" stopColor={GRAD.amber[1]} />
          </RadialGradient>
        </Defs>
        <Circle cx={128} cy={110} r={56} fill={`url(#${b})`} fillOpacity={0.92} stroke={C.amber} strokeWidth={SW} />
        <Path d="M110 108 L122 130 L134 108 L146 130" stroke={C.ink} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M104 170 H152 M110 188 H146 M118 204 H138" stroke={C.amber} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M104 90 A40 40 0 0 1 122 70" stroke={C.ice} strokeOpacity={0.65} strokeWidth={7} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 12 — Üzgün (Ağlama): ağlayan surat + yavaşça düşen damlalar (mavi). */
export function CryingIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.blue} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        {faceDefs(f, GRAD.blue)}
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.blue} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Path d="M82 116 Q100 132 118 116" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M138 116 Q156 132 174 116" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M102 186 Q128 166 154 186" stroke={C.blue} strokeWidth={SW} strokeLinecap="round" />
      </Layer>
      <Layer size={size} animated={animated} motion="tear">
        <Path d="M96 132 q-13 26 0 36 q13 -10 0 -36 z" fill={C.teal} />
        <Path d="M160 132 q13 26 0 36 q-13 -10 0 -36 z" fill={C.teal} />
      </Layer>
    </Shell>
  );
}

/** 13 — Ateşli/Seri: alev (kırmızı→amber gradyan) + titreşim. */
export function FireIcon({ size = 64, animated = false }: SignalIconProps) {
  const fl = `fl${rid(useId())}`;
  const co = `co${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.amber} animated={animated} />
      <Layer size={size} animated={animated} motion="flicker">
        <Defs>
          <LinearGradient id={fl} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FDE68A" />
            <Stop offset="0.55" stopColor="#FB923C" />
            <Stop offset="1" stopColor="#EF4444" />
          </LinearGradient>
          <LinearGradient id={co} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFF3C4" />
            <Stop offset="1" stopColor="#FB923C" />
          </LinearGradient>
        </Defs>
        <Path
          d="M128 22 C166 74 188 108 188 150 A60 60 0 0 1 68 150 C68 116 90 104 102 78 C110 102 126 98 128 74 C130 100 128 50 128 22 Z"
          fill={`url(#${fl})`}
          fillOpacity={0.92}
          stroke={C.amber}
          strokeWidth={10}
          strokeLinejoin="round"
        />
        <Path d="M128 104 C148 130 158 144 158 162 A30 30 0 0 1 98 162 C98 142 116 134 128 104 Z" fill={`url(#${co})`} />
      </Layer>
    </Shell>
  );
}

/** 14 — Buz Gibi: kar tanesi (teal) + yavaş dönme. */
export function IceIcon({ size = 64, animated = false }: SignalIconProps) {
  const s = `s${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.teal} animated={animated} />
      <Layer size={size} animated={animated} motion="rotate">
        <Defs>
          <LinearGradient id={s} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={GRAD.teal[0]} />
            <Stop offset="1" stopColor={GRAD.teal[1]} />
          </LinearGradient>
        </Defs>
        <Path d="M128 26 V230 M48 80 L208 176 M48 176 L208 80" stroke={`url(#${s})`} strokeWidth={SW} strokeLinecap="round" />
        <Path d="M128 54 L110 40 M128 54 L146 40 M128 202 L110 216 M128 202 L146 216" stroke={C.teal} strokeWidth={10} strokeLinecap="round" />
        <Path d="M72 90 L52 88 M72 90 L74 70 M184 166 L204 168 M184 166 L182 186" stroke={C.teal} strokeWidth={10} strokeLinecap="round" />
        <Path d="M72 166 L52 168 M72 166 L74 186 M184 90 L204 88 M184 90 L182 70" stroke={C.teal} strokeWidth={10} strokeLinecap="round" />
        <Circle cx={128} cy={128} r={11} fill={C.ice} />
      </Layer>
    </Shell>
  );
}

/** 15 — Saygı: birleşik (şükran) eller (violet) + nefes. */
export function RespectIcon({ size = 64, animated = false }: SignalIconProps) {
  const h = `h${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.violet} animated={animated} />
      <Layer size={size} animated={animated} motion="breathe">
        <Defs>
          <LinearGradient id={h} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={GRAD.violet[0]} stopOpacity="0.65" />
            <Stop offset="1" stopColor={GRAD.violet[1]} stopOpacity="0.35" />
          </LinearGradient>
        </Defs>
        <Path d="M128 38 C112 70 96 116 92 158 L120 174 C126 124 128 78 128 38 Z" fill={`url(#${h})`} stroke={C.violet} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M128 38 C144 70 160 116 164 158 L136 174 C130 124 128 78 128 38 Z" fill={`url(#${h})`} stroke={C.violet} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M92 158 L74 200 H182 L164 158" fill={`url(#${h})`} stroke={C.violet} strokeWidth={SW} strokeLinejoin="round" />
        <Path d="M128 56 V190" stroke={C.violet} strokeWidth={8} strokeLinecap="round" />
        <Path d="M120 56 C110 96 104 130 102 156" stroke={C.ice} strokeOpacity={0.5} strokeWidth={6} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 16 — Sinsi: hırsız maskesi + sinsi gülüş (teal) + hafif sallanma. */
export function SneakyIcon({ size = 64, animated = false }: SignalIconProps) {
  const f = `f${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.teal} animated={animated} />
      <Layer size={size} animated={animated} motion="sway">
        {faceDefs(f, GRAD.teal)}
        <Circle cx={128} cy={128} r={92} fill={`url(#${f})`} stroke={C.teal} strokeWidth={SW} />
        <Path d="M84 64 A78 78 0 0 1 150 54" stroke={C.ice} strokeOpacity={0.4} strokeWidth={7} strokeLinecap="round" />
        <Path d="M58 102 Q128 84 198 102 L198 126 Q128 144 58 126 Z" fill={C.ink} fillOpacity={0.92} />
        <Ellipse cx={100} cy={114} rx={10} ry={7} fill={C.teal} />
        <Ellipse cx={156} cy={114} rx={10} ry={7} fill={C.teal} />
        <Path d="M98 172 Q132 188 166 168" stroke={C.teal} strokeWidth={SW} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 17 — Alkış: iki el çarpışır + parıltı nabzı (amber). */
export function ClapIcon({ size = 64, animated = false }: SignalIconProps) {
  const l = `l${rid(useId())}`;
  const r = `r${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.amber} animated={animated} />
      <Layer size={size} animated={animated} motion="clapL">
        <Defs>
          <LinearGradient id={l} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={GRAD.amber[1]} />
            <Stop offset="1" stopColor={GRAD.amber[0]} />
          </LinearGradient>
        </Defs>
        <Rect x={64} y={112} width={52} height={94} rx={22} fill={`url(#${l})`} fillOpacity={0.9} stroke={C.amber} strokeWidth={SW} rotation={-16} originX={90} originY={159} />
      </Layer>
      <Layer size={size} animated={animated} motion="clapR">
        <Defs>
          <LinearGradient id={r} x1="1" y1="0" x2="0" y2="0">
            <Stop offset="0" stopColor={GRAD.amber[1]} />
            <Stop offset="1" stopColor={GRAD.amber[0]} />
          </LinearGradient>
        </Defs>
        <Rect x={140} y={112} width={52} height={94} rx={22} fill={`url(#${r})`} fillOpacity={0.9} stroke={C.amber} strokeWidth={SW} rotation={16} originX={166} originY={159} />
      </Layer>
      <Layer size={size} animated={animated} motion="blink">
        <Path d="M128 58 V82 M100 68 L114 86 M156 68 L142 86" stroke={C.ice} strokeWidth={10} strokeLinecap="round" />
      </Layer>
    </Shell>
  );
}

/** 18 — Hedef Kilitlendi: nişangah + nabız (kırmızı). */
export function LockedIcon({ size = 64, animated = false }: SignalIconProps) {
  const t = `t${rid(useId())}`;
  return (
    <Shell size={size}>
      <Glow size={size} color={C.red} animated={animated} />
      <Layer size={size} animated={animated} motion="pulse">
        <Defs>
          <RadialGradient id={t} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={GRAD.red[0]} stopOpacity="0.35" />
            <Stop offset="1" stopColor={GRAD.red[1]} stopOpacity="0.12" />
          </RadialGradient>
        </Defs>
        <Circle cx={128} cy={128} r={72} fill={`url(#${t})`} stroke={C.red} strokeWidth={SW} />
        <Path d="M128 26 V74 M128 182 V230 M26 128 H74 M182 128 H230" stroke={C.red} strokeWidth={SW} strokeLinecap="round" />
        <Circle cx={128} cy={128} r={12} fill={C.red} />
      </Layer>
    </Shell>
  );
}
