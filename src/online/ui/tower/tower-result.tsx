import { StyleSheet, Text, View } from 'react-native';

import type { TowerGuessOutcome, TowerState } from '@/online';
import { Emblem } from '../parts';
import { GlassButton, GlassCard } from '@/ui/glass';
import { upperTr } from '@/game';
import { colors, mono, withAlpha } from '@/ui/theme';
import { TowerLogo } from '@/ui/tower-logo';
import { towerItemLabel } from './twists';

/** Kule sonucu: kule fethedildi (10/10) ya da elendi. Kalıcı ödül özeti +
 *  elenmede gizli kelime ifşası. Ödüller zaten sunucuda hesaba işlendi. */
export function TowerResult({
  outcome,
  state,
  onDone,
}: {
  outcome: TowerGuessOutcome;
  state: TowerState;
  onDone: () => void;
}) {
  const won = outcome.status === 'tower_cleared';
  const reached = state.run?.floorsCleared ?? 0;
  const accent = won ? colors.gold : colors.danger;

  return (
    <View style={styles.wrap}>
      <GlassCard style={styles.card}>
        <Emblem
          iconNode={won ? <TowerLogo size={40} color={accent} /> : undefined}
          icon={won ? undefined : 'x-circle'}
          accent={accent}
          size={72}
          iconSize={34}
          fillIcon
        />
        <Text style={[styles.title, { color: accent }]}>
          {won ? '🏆 KULE FETHEDİLDİ' : 'ELENDİN'}
        </Text>

        {won ? (
          <Text style={styles.detail}>10 katın hepsini geçtin. Efsanesin!</Text>
        ) : (
          <>
            <Text style={styles.detail}>{reached}/10 kata ulaştın.</Text>
            {outcome.reveal?.secret ? (
              <>
                <Text style={styles.revealLabel}>Son gizli kelime:</Text>
                <Text style={styles.revealed}>{upperTr(outcome.reveal.secret)}</Text>
              </>
            ) : null}
          </>
        )}

        {outcome.reward ? (
          <View style={styles.rewardBox}>
            <Text style={styles.rewardVeri}>+{outcome.reward.veri} Veri</Text>
            <Text style={styles.rewardKupa}>+{outcome.reward.kupa} 🏆 Kupa</Text>
            {outcome.reward.itemKind && outcome.reward.itemId ? (
              <Text style={styles.rewardItem}>
                🎁 {towerItemLabel(outcome.reward.itemKind, outcome.reward.itemId)}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.balanceRow}>
          <Text style={styles.balanceText}>Bakiye: {state.veri} Veri</Text>
        </View>

        {!won ? <Text style={styles.note}>Yeni dönemde yeni kule, yeni şans.</Text> : null}

        <GlassButton small label="Merdivene Dön" accent={won ? colors.gold : colors.cyan} onPress={onDone} />
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: { alignItems: 'center', gap: 12, width: '100%', maxWidth: 360 },
  title: { fontSize: 22, fontWeight: '900', fontFamily: mono, letterSpacing: 2, textAlign: 'center' },
  detail: { color: colors.dim, fontSize: 14, textAlign: 'center' },
  revealLabel: { color: colors.dim, fontSize: 12, marginTop: 2 },
  revealed: { color: colors.cyan, fontSize: 26, fontWeight: 'bold', fontFamily: mono, letterSpacing: 5 },
  rewardBox: {
    alignItems: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 18, borderRadius: 12,
    backgroundColor: withAlpha(colors.amber, 0.1), borderWidth: 1, borderColor: withAlpha(colors.amber, 0.3),
  },
  rewardVeri: { color: colors.amber, fontSize: 18, fontWeight: '900', fontFamily: mono },
  rewardKupa: { color: colors.gold, fontSize: 15, fontWeight: '900', fontFamily: mono },
  rewardItem: { color: colors.gold, fontSize: 13, textAlign: 'center' },
  balanceRow: { marginTop: 2 },
  balanceText: { color: colors.text, fontSize: 13, fontFamily: mono },
  note: { color: colors.dim, fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
});
