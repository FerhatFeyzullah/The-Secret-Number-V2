import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import type { AgeState, AgeTerritory } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AgePhaseAnnounce } from './age-announce';
import { AGE, ageColors, ownerColor } from './age-colors';
import { AgeCastle, AgeSiege, AgeTower } from './age-icons';
import { useAgeClock } from './use-age-clock';

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

function nodePos(t: AgeTerritory): [number, number] {
  if (t.kind === 'castle') return CASTLE_POS[t.slotIndex] ?? [180, 275];
  const ci = Math.floor((t.slotIndex - 100) / 10);
  const j = ((t.slotIndex - 100) % 10) - 1;
  const base = CASTLE_POS[ci] ?? [180, 275];
  const off = (TOWER_OFFSET[ci] ?? [[0, 0], [0, 0], [0, 0]])[j] ?? [0, 0];
  return [base[0] + off[0], base[1] + off[1]];
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Faz süresi (HAZIRLIK/SAVAŞ MM:SS). Saat sayacı BURADA yaşar → tik geldiğinde
 *  yalnız bu minik bileşen yeniden çizilir; ağır harita (20 düğüm + SVG çizgiler)
 *  her saniye yeniden render OLMAZ (eski donma/tutukluk buradan geliyordu). */
function PhaseTimer({ label, deadline, active }: { label: string; deadline: string | null; active: boolean }) {
  const now = useAgeClock(active);
  const remaining = deadline ? Date.parse(deadline) - now : 0;
  return (
    <>
      <Text style={styles.phaseLabel}>{label}</Text>
      <Text style={styles.phaseTime}>{fmt(remaining)}</Text>
    </>
  );
}

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
  const colorMap = ageColors(state.players, state.me);
  const byId = Object.fromEntries(state.territories.map((t) => [t.id, t]));
  // Toplam prestij puanı (kule 2 · kale seviye×5 — _age_finish ile aynı).
  const pointsOf = (pid: string) =>
    state.territories
      .filter((t) => t.owner === pid)
      .reduce((sum, t) => sum + (t.kind === 'castle' ? t.level * 5 : 2), 0);
  // Herkesin aktif saldırısı: territory → saldıran rengi (harita işareti).
  const attackerColor: Record<string, string> = {};
  for (const pa of state.attacksPublic) attackerColor[pa.territoryId] = colorMap[pa.attacker] ?? AGE.gray;
  const incoming = state.incoming[0] ?? null;
  const incKind = incoming ? byId[incoming.territoryId]?.kind : null;

  const timerActive = state.phase === 'prep' || state.phase === 'war';
  const timerDeadline =
    state.phase === 'prep' ? state.prepEndsAt : state.phase === 'war' ? state.warEndsAt : null;

  return (
    <View style={styles.wrap}>
      {/* HUD */}
      <View style={styles.hud}>
        <View style={styles.phaseBox}>
          {coach ? (
            <>
              <Text style={styles.phaseLabel}>ÖĞRETİCİ</Text>
              <Text style={styles.phaseTime}>—</Text>
            </>
          ) : (
            <PhaseTimer
              label={state.phase === 'prep' ? 'HAZIRLIK' : 'SAVAŞ'}
              deadline={timerDeadline}
              active={timerActive}
            />
          )}
          {veri != null ? (
            <View style={styles.veriChip}>
              <Feather name="hexagon" size={9} color={colors.teal} />
              <Text style={styles.veriText}>{veri}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.standings}>
          {state.players.map((p) => {
            const c = colorMap[p.player] ?? AGE.gray;
            const me = p.player === state.me;
            return (
              <View key={p.player} style={[styles.team, me && { borderColor: withAlpha(c, 0.6) }]}>
                <View style={[styles.dot, { backgroundColor: c }]} />
                <Text style={styles.teamName} numberOfLines={1}>
                  {me ? 'Sen' : p.username ?? 'Oyuncu'}
                </Text>
                <Text style={[styles.teamCount, p.eliminated && { color: colors.dim }]}>
                  {p.eliminated ? '✕' : pointsOf(p.player)}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      {/* alarm — kale: aktif savunma (SAVUN); kule: yalnız bildirim */}
      {incoming ? (
        <Pressable
          style={styles.alarm}
          disabled={incKind !== 'castle'}
          onPress={() => incKind === 'castle' && onDefend(incoming.attackId, incoming.territoryId)}>
          <View style={styles.alarmDot} />
          <Feather name="alert-triangle" size={15} color={AGE.red} />
          <Text style={styles.alarmText} numberOfLines={1}>
            {incKind === 'castle' ? 'Kalene' : 'Kulene'} saldırı · {incoming.guessCount} tahmin
          </Text>
          <Text style={styles.alarmGo}>{incKind === 'castle' ? 'SAVUN' : 'İZLE'}</Text>
        </Pressable>
      ) : null}

      {/* HARİTA */}
      <View style={styles.mapArea} onLayout={onMapLayout}>
        {/* bağlantılar */}
        {mapSize.w > 0 && mapSize.h > 0 ? (
        <Svg
          style={StyleSheet.absoluteFill}
          width={mapSize.w}
          height={mapSize.h}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none">
          {state.territories
            .filter((t) => t.kind === 'tower' && t.castleId)
            .map((t) => {
              const castle = byId[t.castleId!];
              if (!castle) return null;
              const [tx, ty] = nodePos(t);
              const [cx, cy] = nodePos(castle);
              // Kule kalesiyle AYNI kişideyse (bağlı): düz, kale sahibinin renginde.
              // Değilse (boş/başkası): kesik gri çizgi (yapı görünsün).
              const bound = !!castle.owner && t.owner === castle.owner;
              return bound ? (
                <Line
                  key={t.id}
                  x1={tx}
                  y1={ty}
                  x2={cx}
                  y2={cy}
                  stroke={colorMap[castle.owner!] ?? AGE.gray}
                  strokeWidth={2}
                  opacity={0.85}
                />
              ) : (
                <Line
                  key={t.id}
                  x1={tx}
                  y1={ty}
                  x2={cx}
                  y2={cy}
                  stroke={AGE.gray}
                  strokeWidth={1.2}
                  strokeDasharray="3 6"
                  opacity={0.5}
                />
              );
            })}
        </Svg>
        ) : null}

        {/* düğümler (yüzde konumlu Pressable) */}
        {state.territories.map((t) => {
          const [x, y] = nodePos(t);
          const c = ownerColor(t.owner, colorMap);
          const atkC = attackerColor[t.id];
          const size = t.kind === 'castle' ? 50 : 32;
          const badge = Math.round(size * 0.62);
          return (
            <Pressable
              key={t.id}
              onPress={() => onTapNode(t)}
              style={[
                styles.node,
                {
                  left: `${(x / VB_W) * 100}%`,
                  top: `${(y / VB_H) * 100}%`,
                  marginLeft: -size / 2,
                  marginTop: -size / 2,
                },
              ]}>
              {t.kind === 'castle' ? <AgeCastle size={size} color={c} level={t.level} /> : <AgeTower size={size} color={c} />}
              {atkC ? (
                <View
                  style={[
                    styles.siege,
                    { width: badge, height: badge, borderRadius: badge / 2, top: -badge * 0.3, right: -badge * 0.3, borderColor: atkC },
                  ]}>
                  <AgeSiege size={Math.round(badge * 0.72)} color={atkC} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {coach ? null : <AgePhaseAnnounce phase={state.phase} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  hud: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingBottom: 8 },
  phaseBox: { alignItems: 'center', paddingHorizontal: 6, gap: 3 },
  phaseLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 2, color: '#d08a52' },
  phaseTime: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: colors.ice },
  veriChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 7,
    borderRadius: 999, borderWidth: 1, borderColor: withAlpha(colors.teal, 0.4), backgroundColor: withAlpha(colors.teal, 0.1),
  },
  veriText: { fontFamily: mono, fontSize: 11, fontWeight: '800', color: colors.teal },
  standings: { flex: 1, flexDirection: 'row', gap: 6 },
  team: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 8,
    borderRadius: 11, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  teamName: { flexShrink: 1, fontFamily: mono, fontSize: 11, fontWeight: '700', color: colors.text },
  teamCount: { fontFamily: mono, fontSize: 12, fontWeight: '800', color: colors.ice, minWidth: 12, textAlign: 'center' },
  alarm: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6,
    borderRadius: 12, borderWidth: 1, borderColor: withAlpha(AGE.red, 0.45), backgroundColor: withAlpha(AGE.red, 0.1),
  },
  alarmDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: AGE.red },
  alarmText: { flex: 1, fontFamily: mono, fontSize: 11, color: colors.ice },
  alarmGo: {
    fontFamily: mono, fontSize: 9, letterSpacing: 1, color: AGE.red,
    borderWidth: 1, borderColor: withAlpha(AGE.red, 0.4), borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  mapArea: { flex: 1, position: 'relative' },
  node: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  siege: {
    position: 'absolute', alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,20,40,0.92)', borderWidth: 1.5,
  },
});
