import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import type { AgeState, AgeTerritory } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AGE, ageColors, ownerColor } from './age-colors';
import { AgeCastle, AgeTower } from './age-icons';

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

function useNow(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(iv);
  }, [active]);
  return Date.now();
}

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Gizem Çağı harita ekranı (hazırlık + savaş): HUD + düğüm haritası + savunma
 *  alarmı. Etkileşim callback'lerle üst akışa (orkestratör) taşınır. */
export function AgeMap({
  state,
  onTapNode,
  onDefend,
}: {
  state: AgeState;
  onTapNode: (t: AgeTerritory) => void;
  onDefend: (attackId: string, territoryId: string) => void;
}) {
  const now = useNow(state.phase === 'prep' || state.phase === 'war');
  const colorMap = ageColors(state.players, state.me);
  const byId = Object.fromEntries(state.territories.map((t) => [t.id, t]));
  // Herkesin aktif saldırısı: territory → saldıran rengi (harita işareti).
  const attackerColor: Record<string, string> = {};
  for (const pa of state.attacksPublic) attackerColor[pa.territoryId] = colorMap[pa.attacker] ?? AGE.gray;
  const incoming = state.incoming[0] ?? null;
  const incKind = incoming ? byId[incoming.territoryId]?.kind : null;

  const deadline =
    state.phase === 'prep' ? state.prepEndsAt : state.phase === 'war' ? state.warEndsAt : null;
  const remaining = deadline ? Date.parse(deadline) - now : 0;

  return (
    <View style={styles.wrap}>
      {/* HUD */}
      <View style={styles.hud}>
        <View style={styles.phaseBox}>
          <Text style={styles.phaseLabel}>{state.phase === 'prep' ? 'HAZIRLIK' : 'SAVAŞ'}</Text>
          <Text style={styles.phaseTime}>{fmt(remaining)}</Text>
        </View>
        <View style={styles.standings}>
          {state.players.map((p) => {
            const c = colorMap[p.player] ?? AGE.gray;
            const me = p.player === state.me;
            return (
              <View key={p.player} style={[styles.team, me && { borderColor: withAlpha(c, 0.6) }]}>
                <View style={[styles.crest, { backgroundColor: c }]}>
                  <Text style={styles.crestText}>{(p.username?.charAt(0) || '?').toUpperCase()}</Text>
                </View>
                <Text style={styles.teamCount} numberOfLines={1}>
                  {p.eliminated ? 'elendi' : p.territories}
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
      <View style={styles.mapArea}>
        {/* bağlantılar */}
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none">
          {state.territories
            .filter((t) => t.kind === 'tower' && t.castleId)
            .map((t) => {
              const [tx, ty] = nodePos(t);
              const castle = byId[t.castleId!];
              if (!castle) return null;
              const [cx, cy] = nodePos(castle);
              const mine = t.owner === state.me;
              return (
                <Line
                  key={t.id}
                  x1={tx}
                  y1={ty}
                  x2={cx}
                  y2={cy}
                  stroke={mine ? AGE.blue : 'rgba(214,244,255,0.14)'}
                  strokeWidth={mine ? 2 : 1.2}
                  strokeDasharray={mine ? undefined : '3 5'}
                  opacity={mine ? 0.8 : 0.6}
                />
              );
            })}
        </Svg>

        {/* düğümler (yüzde konumlu Pressable) */}
        {state.territories.map((t) => {
          const [x, y] = nodePos(t);
          const c = ownerColor(t.owner, colorMap);
          const atkC = attackerColor[t.id];
          const size = t.kind === 'castle' ? 50 : 32;
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
              {atkC ? <View style={[styles.ring, { borderColor: atkC }]} /> : null}
              {t.kind === 'castle' ? <AgeCastle size={size} color={c} /> : <AgeTower size={size} color={c} />}
            </Pressable>
          );
        })}

        <View style={styles.legend}>
          {state.players.map((p) => (
            <View key={p.player} style={styles.legRow}>
              <View style={[styles.legDot, { backgroundColor: colorMap[p.player] ?? AGE.gray }]} />
              <Text style={styles.legText} numberOfLines={1}>
                {p.player === state.me ? 'Sen' : p.username ?? 'Oyuncu'}
              </Text>
            </View>
          ))}
          <View style={styles.legRow}>
            <View style={[styles.legDot, { backgroundColor: AGE.gray }]} />
            <Text style={styles.legText}>Fethedilmemiş</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  hud: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingBottom: 8 },
  phaseBox: { alignItems: 'center', paddingHorizontal: 6 },
  phaseLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 2, color: '#d08a52' },
  phaseTime: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: colors.ice },
  standings: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  team: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 8,
    borderRadius: 11, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  crest: { width: 20, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  crestText: { fontFamily: mono, fontSize: 10, fontWeight: '800', color: '#0a1526' },
  teamCount: { fontFamily: mono, fontSize: 12, fontWeight: '800', color: colors.ice, minWidth: 14, textAlign: 'center' },
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
  ring: {
    position: 'absolute', width: '150%', height: '150%', borderRadius: 999, borderWidth: 2, opacity: 0.7,
  },
  legend: {
    position: 'absolute', left: 6, bottom: 6, gap: 4, padding: 8, borderRadius: 10,
    backgroundColor: 'rgba(7,15,34,0.55)', borderWidth: 1, borderColor: colors.glassBorder,
  },
  legRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legDot: { width: 8, height: 8, borderRadius: 2 },
  legText: { fontFamily: mono, fontSize: 9, color: colors.dim },
});
