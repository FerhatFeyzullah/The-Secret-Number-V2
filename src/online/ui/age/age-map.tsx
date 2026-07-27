import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Reanimated, { Easing as REasing, useAnimatedProps, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Line, Path, Pattern, Rect } from 'react-native-svg';

import type { AgeState, AgeTerritory } from '@/online';
import { AgePhaseAnnounce } from './age-announce';
import { AGE, ageColors, ownerColor } from './age-colors';
import { AlarmBar, type HudPlayer, PhaseTimer, PlayerCards, VeriChip } from './age-hud';
import { AgeCastle, AgeSiege, AgeTower, castleMarginTop } from './age-icons';
import { AgeTicker, useAgeEvents } from './age-ticker';

/** Harita mantıksal boyutu (düğümler yüzde, bağlantılar bu viewBox). */
const VB_W = 360;
const VB_H = 560;
const CASTLE_POS: Record<number, [number, number]> = {
  0: [75, 120],
  1: [285, 120],
  2: [75, 430],
  3: [285, 430],
  4: [180, 275],
};
const TOWER_OFFSET: Record<number, [number, number][]> = {
  0: [[-50, 25], [5, -55], [50, 20]],
  1: [[-50, 20], [-5, -55], [50, 25]],
  2: [[-50, -20], [0, 55], [52, -15]],
  3: [[-52, -15], [0, 55], [50, -20]],
  4: [[-58, 45], [0, 62], [58, 45]],
};

/** Kademeye göre kale boyutu — merkez ödülü (6 harf) en görkemli durur. */
const CASTLE_SIZE: Record<number, number> = { 4: 50, 5: 54, 6: 58 };
const TOWER_SIZE = 34;

function nodePos(t: AgeTerritory): [number, number] {
  if (t.kind === 'castle') return CASTLE_POS[t.slotIndex] ?? [180, 275];
  const ci = Math.floor((t.slotIndex - 100) / 10);
  const j = ((t.slotIndex - 100) % 10) - 1;
  const base = CASTLE_POS[ci] ?? [180, 275];
  const off = (TOWER_OFFSET[ci] ?? [[0, 0], [0, 0], [0, 0]])[j] ?? [0, 0];
  return [base[0] + off[0], base[1] + off[1]];
}

const AnimatedLine = Reanimated.createAnimatedComponent(Line);
/** Enerji akışının bir "tur" uzunluğu (kesik + boşluk) — dashoffset bu kadar
 *  kayınca desen başa döner, yani dikişsiz döngü. */
const DASH_PERIOD = 12;

/** Altıgen hücre genişliği (köşeden köşeye) ve düzgün altıgen yüksekliği. */
const HEX_W = 44;
const HEX_H = HEX_W * (Math.sqrt(3) / 2);

/** Harita zemininin taktik altıgen dokusu. Bağlantı/düğüm katmanının ALTINDA,
 *  gerçek piksel boyutunda (1:1 viewBox) çizilir → hücreler bozulmaz; bağlantı
 *  SVG'si `preserveAspectRatio="none"` ile esnediği için oraya konamaz.
 *  Desen id'si arka plandakinden (`ageHex`) ayrı — çakışma olmasın. */
function MapGrid({ w, h }: { w: number; h: number }) {
  // Düz-tepeli altıgen: genişlik HEX_W, yükseklik HEX_W·(√3/2). Petek ancak
  // komşu sütun yarım hücre KAYDIRILIRSA kapanır → desen karesi 1.5·HEX_W
  // genişliğinde ve iki (+ taşan kopya) altıgen içerir. Kaydırma olmadan
  // hücreler üst üste binip "zincir" görüntüsü veriyordu.
  const hex = (dx: number, dy: number) =>
    `M${HEX_W * 0.25 + dx} ${dy} L${HEX_W * 0.75 + dx} ${dy} L${HEX_W + dx} ${HEX_H / 2 + dy} ` +
    `L${HEX_W * 0.75 + dx} ${HEX_H + dy} L${HEX_W * 0.25 + dx} ${HEX_H + dy} L${dx} ${HEX_H / 2 + dy} Z`;
  const stroke = 'rgba(122,170,235,0.11)';
  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} viewBox={`0 0 ${w} ${h}`} pointerEvents="none">
      <Defs>
        <Pattern id="ageMapHex" width={HEX_W * 1.5} height={HEX_H} patternUnits="userSpaceOnUse">
          <Path d={hex(0, 0)} fill="none" stroke={stroke} strokeWidth={1} />
          {/* yarım hücre kaydırılmış komşu sütun (üstte/altta taşan kopyalarıyla) */}
          <Path d={hex(HEX_W * 0.75, HEX_H / 2)} fill="none" stroke={stroke} strokeWidth={1} />
          <Path d={hex(HEX_W * 0.75, -HEX_H / 2)} fill="none" stroke={stroke} strokeWidth={1} />
        </Pattern>
      </Defs>
      <Rect x={0} y={0} width={w} height={h} fill="url(#ageMapHex)" />
    </Svg>
  );
}

type Conn = { id: string; x1: number; y1: number; x2: number; y2: number; color: string | null };

/** Kule ↔ kale bağlantıları. Aynı sahipteyse sahibin renginde AKAN enerji
 *  (kaleye doğru), değilse soluk kesik gri. Akış UI thread'inde (reanimated)
 *  çalışır → her karede JS köprüsü kullanılmaz, harita takılmaz. */
function Connections({ conns, w, h }: { conns: Conn[]; w: number; h: number }) {
  const flow = useSharedValue(0);
  useEffect(() => {
    flow.value = withRepeat(withTiming(-DASH_PERIOD, { duration: 850, easing: REasing.linear }), -1, false);
  }, [flow]);
  const flowProps = useAnimatedProps(() => ({ strokeDashoffset: flow.value }));

  return (
    <Svg style={StyleSheet.absoluteFill} width={w} height={h} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
      {conns.map((c) =>
        c.color ? (
          <AnimatedLine
            key={c.id}
            x1={c.x1}
            y1={c.y1}
            x2={c.x2}
            y2={c.y2}
            stroke={c.color}
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeDasharray="7 5"
            opacity={0.9}
            animatedProps={flowProps}
          />
        ) : (
          <Line
            key={c.id}
            x1={c.x1}
            y1={c.y1}
            x2={c.x2}
            y2={c.y2}
            stroke={AGE.gray}
            strokeWidth={1.3}
            strokeDasharray="3 6"
            opacity={0.42}
          />
        ),
      )}
    </Svg>
  );
}

/** Kuşatma rozeti — saldıranın renginde çapraz kılıç; dışa yayılan halka nabzı
 *  ve hafif salınımla "burası şu an dövülüyor" der. */
function SiegeBadge({ size, color }: { size: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const ringScale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 2.1] });
  const ringOpacity = anim.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] });
  const tilt = anim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['-7deg', '7deg', '-7deg'] });

  return (
    <View style={[styles.badgeWrap, { width: size, height: size, top: -size * 0.32, right: -size * 0.32 }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.badgeRing,
          { borderRadius: size / 2, borderColor: color, opacity: ringOpacity, transform: [{ scale: ringScale }] },
        ]}
      />
      <Animated.View
        style={[
          styles.badge,
          { borderRadius: size / 2, borderColor: color, backgroundColor: 'rgba(8,14,30,0.95)', transform: [{ rotate: tilt }] },
        ]}>
        <AgeSiege size={Math.round(size * 0.7)} color={color} />
      </Animated.View>
    </View>
  );
}

/** Sahip değişince (fetih) tetiklenen kısa kutlama: yukarı sıçrama + ışık
 *  halkası. İlk render'da çalışmaz (harita açılışında 20 düğüm patlamasın). */
function useCaptureFlash(owner: string | null) {
  const anim = useRef(new Animated.Value(0)).current;
  const prev = useRef(owner);
  const first = useRef(true);

  useEffect(() => {
    const changed = prev.current !== owner;
    prev.current = owner;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!changed || owner == null) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 720, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [owner, anim]);

  return {
    scale: anim.interpolate({ inputRange: [0, 0.35, 0.7, 1], outputRange: [1, 1.24, 0.97, 1] }),
    ringScale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }),
    ringOpacity: anim.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.7, 0] }),
  };
}

/** Tek harita düğümü (kale/kule) — kendi fetih animasyonunu taşır. `memo` →
 *  yalnız kendi verisi değişince yeniden çizilir. */
const MapNode = memo(function MapNode({
  t,
  color,
  attackerColor,
  onPress,
}: {
  t: AgeTerritory;
  color: string;
  attackerColor?: string;
  onPress: (t: AgeTerritory) => void;
}) {
  const [x, y] = nodePos(t);
  const isCastle = t.kind === 'castle';
  const size = isCastle ? CASTLE_SIZE[t.level] ?? 50 : TOWER_SIZE;
  const flash = useCaptureFlash(t.owner);
  const badge = Math.round(size * (isCastle ? 0.46 : 0.56));

  return (
    <Pressable
      onPress={() => onPress(t)}
      hitSlop={isCastle ? 6 : 10}
      style={[
        styles.node,
        {
          left: `${(x / VB_W) * 100}%`,
          top: `${(y / VB_H) * 100}%`,
          marginLeft: -size / 2,
          marginTop: isCastle ? castleMarginTop(size) : -size / 2,
        },
      ]}>
      {({ pressed }) => (
        <Animated.View style={{ transform: [{ scale: flash.scale }, { scale: pressed ? 0.9 : 1 }] }}>
          {/* fetih ışık halkası */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.captureRing,
              { borderColor: color, opacity: flash.ringOpacity, transform: [{ scale: flash.ringScale }] },
            ]}
          />
          {isCastle ? (
            <AgeCastle size={size} color={color} level={t.level} />
          ) : (
            <AgeTower size={size} color={color} />
          )}

          {attackerColor ? <SiegeBadge size={badge} color={attackerColor} /> : null}
        </Animated.View>
      )}
    </Pressable>
  );
});

/** Gizem Çağı harita ekranı (hazırlık + savaş): HUD + düğüm haritası + savunma
 *  alarmı. Etkileşim callback'lerle üst akışa (orkestratör) taşınır. */
export function AgeMap({
  state,
  veri,
  coach = false,
  onTapNode,
  onDefend,
}: {
  state: AgeState;
  /** Kalan maç‑içi Sefer Verisi (undefined → sayaç gizli). */
  veri?: number;
  /** Öğretici (örnek harita) modu: canlı sayaç/faz duyurusu yok, "ÖĞRETİCİ" etiketi. */
  coach?: boolean;
  onTapNode: (t: AgeTerritory) => void;
  onDefend: (attackId: string, territoryId: string) => void;
}) {
  // Bağlantı SVG'sine sayısal boyut (absoluteFill stil-only Android'de çizmiyor).
  const [mapSize, setMapSize] = useState({ w: 0, h: 0 });
  const onMapLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setMapSize((prev) => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
  };

  const colorMap = useMemo(() => ageColors(state.players, state.me), [state.players, state.me]);
  const byId = useMemo(() => Object.fromEntries(state.territories.map((t) => [t.id, t])), [state.territories]);

  // Toplam prestij puanı (kule 2 · kale seviye×5 — _age_finish ile aynı).
  const hudPlayers: HudPlayer[] = useMemo(() => {
    const pointsOf = (pid: string) =>
      state.territories
        .filter((t) => t.owner === pid)
        .reduce((sum, t) => sum + (t.kind === 'castle' ? t.level * 5 : 2), 0);
    const rows = state.players.map((p) => ({ p, points: pointsOf(p.player) }));
    const total = rows.reduce((s, r) => s + r.points, 0) || 1;
    const best = Math.max(...rows.map((r) => (r.p.eliminated ? -1 : r.points)));
    return rows.map(({ p, points }) => ({
      id: p.player,
      name: p.player === state.me ? 'Sen' : p.username ?? 'Oyuncu',
      color: colorMap[p.player] ?? AGE.gray,
      points,
      share: points / total,
      isMe: p.player === state.me,
      isLeader: !p.eliminated && points === best && points > 0,
      eliminated: !!p.eliminated,
    }));
  }, [state.players, state.territories, state.me, colorMap]);

  // Herkesin aktif saldırısı: territory → saldıran rengi (harita işareti).
  const attackerColor = useMemo(() => {
    const m: Record<string, string> = {};
    for (const pa of state.attacksPublic) m[pa.territoryId] = colorMap[pa.attacker] ?? AGE.gray;
    return m;
  }, [state.attacksPublic, colorMap]);

  const conns: Conn[] = useMemo(
    () =>
      state.territories
        .filter((t) => t.kind === 'tower' && t.castleId)
        .map((t) => {
          const castle = byId[t.castleId!];
          if (!castle) return null;
          const [tx, ty] = nodePos(t);
          const [cx, cy] = nodePos(castle);
          const bound = !!castle.owner && t.owner === castle.owner;
          return {
            id: t.id,
            x1: tx,
            y1: ty,
            x2: cx,
            y2: cy,
            color: bound ? colorMap[castle.owner!] ?? AGE.gray : null,
          };
        })
        .filter((c): c is Conn => c !== null),
    [state.territories, byId, colorMap],
  );

  // Fetih / el değiştirme / eleme olayları — harita üstünde akan çipler.
  const { events, dismiss } = useAgeEvents(state, colorMap);

  const incoming = state.incoming[0] ?? null;
  const incKind = incoming ? byId[incoming.territoryId]?.kind : null;
  const timerActive = state.phase === 'prep' || state.phase === 'war';

  return (
    <View style={styles.wrap}>
      {/* HUD — üst şerit: faz sayacı + Sefer Verisi */}
      <View style={styles.hudTop}>
        <PhaseTimer
          phase={coach ? 'coach' : state.phase === 'prep' ? 'prep' : 'war'}
          deadline={state.phase === 'prep' ? state.prepEndsAt : state.warEndsAt}
          active={!coach && timerActive}
        />
        {veri != null ? <VeriChip value={veri} /> : null}
      </View>

      {/* HUD — oyuncu kartları */}
      <View style={styles.hudCards}>
        <PlayerCards players={hudPlayers} />
      </View>

      {/* alarm — kale: aktif savunma (SAVUN); kule: yalnız bildirim */}
      {incoming ? (
        <AlarmBar
          kind={incKind === 'castle' ? 'castle' : 'tower'}
          guessCount={incoming.guessCount}
          onPress={() => incKind === 'castle' && onDefend(incoming.attackId, incoming.territoryId)}
        />
      ) : null}

      {/* HARİTA */}
      <View style={styles.mapArea} onLayout={onMapLayout}>
        {mapSize.w > 0 && mapSize.h > 0 ? (
          <>
            <MapGrid w={mapSize.w} h={mapSize.h} />
            <Connections conns={conns} w={mapSize.w} h={mapSize.h} />
          </>
        ) : null}

        {state.territories.map((t) => (
          <MapNode
            key={t.id}
            t={t}
            color={ownerColor(t.owner, colorMap)}
            attackerColor={attackerColor[t.id]}
            onPress={onTapNode}
          />
        ))}

        <AgeTicker events={events} onDone={dismiss} />
      </View>

      {coach ? null : <AgePhaseAnnounce phase={state.phase} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  hudTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 2, paddingBottom: 7 },
  hudCards: { paddingHorizontal: 2, paddingBottom: 8 },
  mapArea: { flex: 1, position: 'relative' },
  node: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  captureRing: { ...StyleSheet.absoluteFillObject, borderWidth: 2.5, borderRadius: 999 },
  badgeWrap: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  badgeRing: { ...StyleSheet.absoluteFillObject, borderWidth: 2 },
  badge: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', borderWidth: 1.8 },
});
