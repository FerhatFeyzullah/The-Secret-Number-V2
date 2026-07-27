import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';

import { AGE, palette, tone, type AgePalette } from './age-colors';

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

/** "Kuşatma altında" işareti — düğüm köşesine rozet olarak konur. Çapraz kılıç:
 *  kalın namlu + belirgin balçak, iki tonlu (ışık alan yüz açık) → 14–20 px'te
 *  bile "kılıç" okunur. Referanstan esinlenilmiş ÖZGÜN çizim. */
export function AgeSiege({ size = 18, color }: { size?: number; color: string }) {
  const lit = tone(color, 0.45);
  const sword = (
    <>
      {/* namlu */}
      <Path d="M12 1.4 L10.2 4.6 L13.8 4.6 Z" fill={lit} />
      <Rect x={10.6} y={4.3} width={2.8} height={10.6} fill={color} />
      <Rect x={10.6} y={4.3} width={1.1} height={10.6} fill={lit} />
      {/* balçak */}
      <Rect x={7.6} y={14.4} width={8.8} height={2.2} rx={0.9} fill={lit} />
      {/* kabza + topuz */}
      <Rect x={10.9} y={16.4} width={2.2} height={3.3} fill={color} />
      <Circle cx={12} cy={20.6} r={1.7} fill={lit} />
    </>
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G transform="rotate(45 12 12)">{sword}</G>
      <G transform="rotate(-45 12 12)">{sword}</G>
    </Svg>
  );
}

/** Savunma kalkanı — alarm barı ve savunma başarılı geri bildirimi. */
export function AgeShield({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 1.6 L21 4.8 V12 C21 17.4 16.6 21 12 22.4 C7.4 21 3 17.4 3 12 V4.8 Z" fill={color} />
      <Path d="M12 1.6 L21 4.8 V12 C21 17.4 16.6 21 12 22.4 Z" fill="#050c18" opacity={0.2} />
      <Path d="M12 5.4 L17.6 7.4 V12 C17.6 15.3 15 17.8 12 18.9 C9 17.8 6.4 15.3 6.4 12 V7.4 Z" fill="#050c18" opacity={0.35} />
    </Svg>
  );
}

/** Sancak — hazırlık fazı duyurusu / fetih işareti. */
export function AgeFlag({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* kalın direk + geniş flama: 14–16 px'te bile "bayrak" okunur.
          Direk AÇIK tonda — koyu zeminde kaybolmasın. */}
      <Rect x={3.6} y={1.6} width={3.2} height={20.8} rx={1.5} fill={tone(color, 0.25)} />
      {/* kırlangıç kuyruklu flama — düz üçgen "oynat" ikonuna benzemesin */}
      <Path d="M6.8 2.6 L21.8 5.2 L17.2 8.6 L21.8 12 L6.8 14.6 Z" fill={color} />
      <Path d="M6.8 2.6 L21.8 5.2 L17.2 8.6 L6.8 8.6 Z" fill="#fff" opacity={0.22} />
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

// ── Yapı çizim yardımcıları ─────────────────────────────────────────────────
// Ortak dil: her blok ÜÇ tonda boyanır — ön yüz gövde, sağ yan koyu, sol kenar
// ışık şeridi; tepedeki mazgal bandı en açık ton (üst yüz ışığı yakalar). Bu
// üçlü, düz siluetleri düz renk kalmadan "hacimli oyuncak" gibi gösterir.

/** Kale ikonunun çizim çerçevesi. Taç/sancak için tepede bol pay var; `base`
 *  yapının oturduğu zemin çizgisi. */
export const CASTLE_VB = { w: 72, h: 90, top: -52, base: 30 };

/** Kale ikonu haritada dikey olarak nereye oturur: taban çizgisi, düğüm
 *  noktasının `0.4722 × size` kadar ALTINA gelir. Bu oran eski (-40..34)
 *  çerçevesinin merkezleme davranışından gelir — çerçeve büyüse de düğümler
 *  yerinden oynamasın diye sabit tutulur. */
const BASE_BELOW_CENTER = 0.4722;

/** Haritada kale düğümünün `marginTop` değeri (çerçeve yüksekliğinden bağımsız
 *  olarak taban çizgisini aynı yerde tutar). */
export function castleMarginTop(size: number): number {
  return -size * ((CASTLE_VB.base - CASTLE_VB.top) / CASTLE_VB.w - BASE_BELOW_CENTER);
}

/** Mazgal (crenellation) yol üreteci — [x0,x1] arası n eşit diş. */
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

/** Mazgallı duvar bloğu (kale gövdesi / yan burç). */
function Wall({
  x0,
  x1,
  top,
  base,
  p,
  teeth,
  toothH = 7,
}: {
  x0: number;
  x1: number;
  top: number;
  base: number;
  p: AgePalette;
  teeth: number;
  toothH?: number;
}) {
  const w = x1 - x0;
  const rightW = Math.min(w * 0.36, 13);
  const leftW = Math.min(w * 0.14, 2.6);
  return (
    <>
      {/* ön yüz */}
      <Path d={`M${x0} ${base} L${x0} ${top} L${x1} ${top} L${x1} ${base} Z`} fill={p.body} />
      {/* sağ yan gölge */}
      <Path d={`M${x1 - rightW} ${base} L${x1 - rightW} ${top} L${x1} ${top} L${x1} ${base} Z`} fill={p.shade} />
      {/* sol kenar ışığı */}
      <Path d={`M${x0} ${base} L${x0} ${top} L${x0 + leftW} ${top} L${x0 + leftW} ${base} Z`} fill={p.light} />
      {/* taş bantları */}
      <G stroke={p.deep} strokeWidth={0.9} opacity={0.45}>
        {[0.34, 0.62, 0.86].map((f) => {
          const y = top + (base - top) * f;
          return <Line key={f} x1={x0} y1={y} x2={x1} y2={y} />;
        })}
      </G>
      {/* mazgal bandı (üst yüz ışığı) + altındaki koyu ayrım */}
      <Path d={cren(x0, x1, top, top - toothH, top - toothH * 0.44, teeth)} fill={p.light} />
      <Path d={`M${x0} ${top} L${x1} ${top} L${x1} ${top + 1.4} L${x0} ${top + 1.4} Z`} fill={p.deep} opacity={0.55} />
    </>
  );
}

/** Kemerli kapı (koyu boşluk + çerçeve). */
function Gate({ cx, base, w, h, p }: { cx: number; base: number; w: number; h: number; p: AgePalette }) {
  const hw = w / 2;
  const top = base - h;
  return (
    <>
      <Path
        d={`M${cx - hw - 1.3} ${base} L${cx - hw - 1.3} ${top + 1.5} Q${cx} ${top - 3.4} ${cx + hw + 1.3} ${top + 1.5} L${cx + hw + 1.3} ${base} Z`}
        fill={p.light}
      />
      <Path
        d={`M${cx - hw} ${base} L${cx - hw} ${top + 1.5} Q${cx} ${top - 1.6} ${cx + hw} ${top + 1.5} L${cx + hw} ${base} Z`}
        fill="#050c18"
        opacity={0.94}
      />
    </>
  );
}

/** Meşale (yalnız sahiplenilmiş yapılarda) — sıcak amber nokta + halesi. */
function Torch({ x, y, r = 1.5 }: { x: number; y: number; r?: number }) {
  return (
    <>
      <Circle cx={x} cy={y} r={r * 2.6} fill="#ffb545" opacity={0.22} />
      <Circle cx={x} cy={y} r={r} fill="#ffd98a" />
    </>
  );
}

/** Direkli sancak (kademe 4/5). */
function Pennant({ x, yTop, yPole, p }: { x: number; yTop: number; yPole: number; p: AgePalette }) {
  return (
    <>
      {/* direk açık taş tonunda — koyu harita zemininde silueti kaybolmasın */}
      <Line x1={x} y1={yPole} x2={x} y2={yTop} stroke="#c3cee0" strokeWidth={1.9} strokeLinecap="round" />
      <Path d={`M${x} ${yTop + 1} L${x + 13} ${yTop + 4.6} L${x} ${yTop + 8.2} Z`} fill={p.body} />
      <Path d={`M${x} ${yTop + 1} L${x + 13} ${yTop + 4.6} L${x} ${yTop + 4.6} Z`} fill={p.light} />
    </>
  );
}

/** Harita düğümü — KADEMELİ KALE. `level` (şifre harf sayısı 4/5/6) dış görünümü
 *  belirler: 4 = karakol (dar, tek sancak); 5 = hisar (yayvan + burç kulesi +
 *  meşaleler); 6 = kale-i sultani (en geniş, taç + taş platform). color = sahip
 *  rengi; nötr gri → meşale/pencere ışığı sönük, sancak yırtık. */
export function AgeCastle({ size = 56, color, level = 4 }: { size?: number; color: string; level?: number }) {
  const p = palette(color);
  const neutral = color === AGE.gray;
  const tier = level >= 6 ? 3 : level >= 5 ? 2 : 1;
  // Kademe geometrisi (taban y = CASTLE_VB.base).
  const G_ = {
    1: { outer: 29, inner: 15, keepTop: -15, sideTop: -3, turret: 0, poleTop: -42 },
    2: { outer: 32, inner: 17, keepTop: -19, sideTop: -6, turret: 8, poleTop: -46 },
    3: { outer: 35, inner: 18, keepTop: -21, sideTop: -8, turret: 9, poleTop: -46 },
  }[tier]!;
  const base = CASTLE_VB.base;

  return (
    <Svg
      width={size}
      height={(size * CASTLE_VB.h) / CASTLE_VB.w}
      viewBox={`${-CASTLE_VB.w / 2} ${CASTLE_VB.top} ${CASTLE_VB.w} ${CASTLE_VB.h}`}>
      {/* sahiplik halesi + zemin gölgesi */}
      <Ellipse cx={0} cy={base} rx={G_.outer + 5} ry={9} fill={p.body} opacity={neutral ? 0.1 : 0.24} />
      <Ellipse cx={0} cy={base + 1} rx={G_.outer - 4} ry={5.5} fill="#040812" opacity={0.55} />

      {/* kademe 3: taş platform (merkez ödülü havada duruyor hissi) */}
      {tier === 3 ? (
        <>
          <Path d={`M${-G_.outer - 3} ${base} L${-G_.outer + 3} ${base + 7} L${G_.outer - 3} ${base + 7} L${G_.outer + 3} ${base} Z`} fill={p.deep} />
          <Path d={`M${-G_.outer - 3} ${base} L${G_.outer + 3} ${base} L${G_.outer + 3} ${base + 2} L${-G_.outer - 3} ${base + 2} Z`} fill={p.shade} />
        </>
      ) : null}

      {/* yan burçlar */}
      <Wall x0={-G_.outer} x1={-G_.inner} top={G_.sideTop} base={base} p={p} teeth={3} toothH={6} />
      <Wall x0={G_.inner} x1={G_.outer} top={G_.sideTop} base={base} p={p} teeth={3} toothH={6} />

      {/* ana keep */}
      <Wall x0={-G_.inner + 2} x1={G_.inner - 2} top={G_.keepTop} base={base} p={p} teeth={tier === 1 ? 4 : 5} toothH={8} />

      {/* kapı + pencere */}
      <Gate cx={0} base={base} w={12} h={tier === 1 ? 24 : 26} p={p} />
      <Path
        d={`M-3 ${G_.keepTop + 9} L-3 ${G_.keepTop + 5} Q0 ${G_.keepTop + 1.6} 3 ${G_.keepTop + 5} L3 ${G_.keepTop + 9} Z`}
        fill={neutral ? '#050c18' : '#ffd98a'}
        opacity={neutral ? 0.85 : 0.9}
      />

      {/* tepe burç kulesi (kademe 2/3) */}
      {G_.turret ? (
        <Wall x0={-G_.turret} x1={G_.turret} top={G_.keepTop - 13} base={G_.keepTop} p={p} teeth={3} toothH={5.5} />
      ) : null}

      {/* tepe süsü: 1-2 → sancak · 3 → burcun taşıdığı TAÇ */}
      {tier === 3 ? (
        <G transform={`translate(0 ${G_.keepTop - 21})`}>
          <Path d="M-9 4 L-11 -7 L-4.5 -1.5 L0 -9 L4.5 -1.5 L11 -7 L9 4 Z" fill="#f5c451" stroke="#8a6a1e" strokeWidth={1.1} />
          <Rect x={-9.5} y={4} width={19} height={3.2} rx={1.2} fill="#f5c451" stroke="#8a6a1e" strokeWidth={0.9} />
          <Circle cx={0} cy={-9} r={1.5} fill="#ffe9a8" />
          <Circle cx={-11} cy={-7} r={1.2} fill="#ffe9a8" />
          <Circle cx={11} cy={-7} r={1.2} fill="#ffe9a8" />
        </G>
      ) : (
        <Pennant x={0} yTop={G_.poleTop} yPole={(G_.turret ? G_.keepTop - 13 : G_.keepTop) - 7} p={p} />
      )}

      {/* meşaleler (yalnız sahipli) */}
      {neutral ? null : (
        <>
          <Torch x={-G_.inner - 3.5} y={G_.sideTop + 9} />
          <Torch x={G_.inner + 3.5} y={G_.sideTop + 9} />
        </>
      )}
    </Svg>
  );
}

/** Harita düğümü — NÖBET KULESİ. Kalenin küçük kardeşi: aynı üç tonlu gövde,
 *  mazgallı tepe, konik çatı ve sahiplenilince yanan fener. */
export function AgeTower({ size = 34, color }: { size?: number; color: string }) {
  const p = palette(color);
  const neutral = color === AGE.gray;
  return (
    <Svg width={size} height={(size * 44) / 40} viewBox="-20 -24 40 44">
      <Ellipse cx={0} cy={20} rx={15} ry={5.5} fill={p.body} opacity={neutral ? 0.1 : 0.24} />
      <Ellipse cx={0} cy={20.5} rx={10.5} ry={3.4} fill="#040812" opacity={0.55} />

      {/* gövde (hafif konik) */}
      <Path d="M-10 20 L-8.6 -7 L8.6 -7 L10 20 Z" fill={p.body} />
      <Path d="M3 -7 L8.6 -7 L10 20 L3.6 20 Z" fill={p.shade} />
      <Path d="M-8.6 -7 L-7.2 -7 L-8.6 20 L-10 20 Z" fill={p.light} />
      <G stroke={p.deep} strokeWidth={0.85} opacity={0.4}>
        <Line x1={-9.1} y1={3} x2={9.1} y2={3} />
        <Line x1={-9.6} y1={12} x2={9.6} y2={12} />
      </G>

      {/* mazgallı tepe */}
      <Path d={cren(-9.6, 9.6, -7, -13.5, -9.8, 3)} fill={p.light} />
      <Path d="M-9.6 -7 L9.6 -7 L9.6 -5.8 L-9.6 -5.8 Z" fill={p.deep} opacity={0.5} />

      {/* konik çatı */}
      <Path d="M-7.6 -13.5 L0 -22.5 L7.6 -13.5 Z" fill={p.light} />
      <Path d="M0 -22.5 L7.6 -13.5 L0 -13.5 Z" fill={p.shade} />
      <Circle cx={0} cy={-22.8} r={1.6} fill={neutral ? p.shade : '#ffd98a'} />

      {/* fener + kapı */}
      <Rect x={-2} y={-3.6} width={4} height={5} rx={1.6} fill={neutral ? '#050c18' : '#ffd98a'} opacity={neutral ? 0.8 : 0.95} />
      <Path d="M-3.4 20 L-3.4 8 Q0 4.4 3.4 8 L3.4 20 Z" fill="#050c18" opacity={0.9} />
    </Svg>
  );
}
