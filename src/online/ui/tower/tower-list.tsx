import { Feather } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TowerState } from '@/online';
import { AgeEmblem } from '../age/age-icons';
import { ChoiceCard } from '../parts';
import { colors, mono, withAlpha } from '@/ui/theme';
import { TowerLogo } from '@/ui/tower-logo';
import { useCountdown } from './tower-ladder';

const TEAM = { blue: '#4a90ff', red: '#ff5b5b', green: '#46cf7c' };

/** Turnuva seçim ekranı — çok oyunculu mod seçimi gibi kartlar (Gizemli Kule +
 *  Gizem Çağı). Karta basınca o turnuvanın ekranı açılır. */
export function TowerList({
  state,
  onSelect,
  onSelectAge,
}: {
  state: TowerState;
  onSelect: () => void;
  onSelectAge: () => void;
}) {
  const countdown = useCountdown(state.period.endsAt);
  const run = state.run;

  let status: { text: string; color: string };
  if (run?.status === 'active') {
    status = { text: `Sürüyor · Kat ${run.currentFloor} · ${run.lives}♥`, color: colors.cyan };
  } else if (run?.status === 'cleared') {
    status = { text: '🏆 Tamamlandı', color: colors.gold };
  } else if (run?.status === 'eliminated') {
    status = { text: 'Elendin', color: colors.danger };
  } else {
    status = { text: 'Giriş · 300 Veri', color: colors.amber };
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>TURNUVALAR</Text>
        <Text style={styles.heroSub}>Bir turnuva seç ve tırmanmaya başla.</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <ChoiceCard
          iconNode={<TowerLogo size={30} color={colors.gold} />}
          accent={colors.gold}
          title="Gizemli Kule"
          subtitle="10 kat · 3 can · süreye karşı kelime"
          onPress={onSelect}>
          <View style={styles.badges}>
            <View style={[styles.badge, { borderColor: withAlpha(status.color, 0.4) }]}>
              <Text style={[styles.badgeText, { color: status.color }]}>{status.text}</Text>
            </View>
            {countdown ? (
              <View style={styles.badge}>
                <Feather name="clock" size={11} color={colors.cyan} />
                <Text style={[styles.badgeText, { color: colors.dim }]}>{countdown} kaldı</Text>
              </View>
            ) : null}
          </View>
        </ChoiceCard>

        {/* Gizem Çağı — 3 oyunculu harita fethi (mor "gizem" aksanı). */}
        <ChoiceCard
          iconNode={<AgeEmblem size={32} color={colors.violet} />}
          accent={colors.violet}
          title="Gizem Çağı"
          subtitle="3 hükümdar · harita fethi · sayı + kelime"
          onPress={onSelectAge}>
          <View style={styles.badges}>
            <View style={styles.badge}>
              <View style={styles.triRow}>
                <View style={[styles.tri, { backgroundColor: TEAM.blue }]} />
                <View style={[styles.tri, { backgroundColor: TEAM.red }]} />
                <View style={[styles.tri, { backgroundColor: TEAM.green }]} />
              </View>
              <Text style={[styles.badgeText, { color: colors.text }]}>1v1v1</Text>
            </View>
            <View style={[styles.badge, { borderColor: withAlpha(colors.violet, 0.4) }]}>
              <Text style={[styles.badgeText, { color: colors.violet }]}>Kuyruğa Gir</Text>
            </View>
          </View>
        </ChoiceCard>

        <View style={styles.soon}>
          <Feather name="plus-circle" size={16} color={withAlpha(colors.dim, 0.5)} />
          <Text style={styles.soonText}>Yeni turnuvalar yakında</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: 12 },
  hero: { alignItems: 'center', gap: 6, paddingTop: 12 },
  heroTitle: {
    fontFamily: mono, fontSize: 22, fontWeight: '900', letterSpacing: 3, color: colors.ice,
    textShadowColor: colors.gold, textShadowRadius: 14,
  },
  heroSub: { textAlign: 'center', color: colors.dim, fontSize: 12.5, lineHeight: 18, maxWidth: 290 },
  scroll: { paddingBottom: 24, gap: 12 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingHorizontal: 9,
    borderRadius: 999, borderWidth: 1, borderColor: colors.glassBorder,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  badgeText: { fontFamily: mono, fontSize: 11, fontWeight: '700' },
  triRow: { flexDirection: 'row', gap: 3 },
  tri: { width: 7, height: 7, borderRadius: 2 },
  soon: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 18, opacity: 0.6,
  },
  soonText: { color: colors.dim, fontSize: 12, fontStyle: 'italic' },
});
