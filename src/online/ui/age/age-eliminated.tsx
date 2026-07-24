import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AgeState } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AGE, ageColors } from './age-colors';

/** Elenen oyuncunun ekranı: doğrudan sonuç — kendisi SONUNCU (3.), 1. ve 2.
 *  maç sürdüğü için belirsiz. Oyuncu maçtan çıkmıştır (etkileşim yok). */
export function AgeEliminated({ state, onMenu }: { state: AgeState; onMenu: () => void }) {
  const colorMap = ageColors(state.players, state.me);
  const meName = state.players.find((p) => p.player === state.me)?.username ?? 'Sen';
  const others = state.players.filter((p) => p.player !== state.me);

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={styles.badge}>
          <Feather name="flag" size={22} color="#d08a52" />
        </View>
        <Text style={[styles.name, { color: colorMap[state.me] ?? AGE.blue }]} numberOfLines={1}>
          {meName}
        </Text>
        <Text style={styles.verdict}>ELENDİN · SONUNCU</Text>
        <Text style={styles.sub}>Toprakların düştü. Bu maçta 3. oldun.</Text>
        <View style={styles.rewardChip}>
          <Feather name="award" size={13} color={colors.danger} />
          <Text style={styles.rewardText}>−15 kupa</Text>
        </View>
      </View>

      <Text style={styles.lab}>MAÇ SÜRÜYOR</Text>
      <View style={styles.rows}>
        {others.map((p) => (
          <View key={p.player} style={styles.row}>
            <Text style={styles.q}>?</Text>
            <View style={[styles.crest, { backgroundColor: colorMap[p.player] ?? AGE.gray }]}>
              <Text style={styles.crestText}>{(p.username?.charAt(0) || '?').toLocaleUpperCase('tr')}</Text>
            </View>
            <Text style={styles.rname} numberOfLines={1}>{p.username ?? 'Oyuncu'}</Text>
            <Text style={styles.pending}>belirsiz</Text>
          </View>
        ))}
      </View>
      <Text style={styles.note}>1. ve 2. sıra, kalan iki hükümdar arasında belirlenecek.</Text>

      <Pressable onPress={onMenu} style={styles.btn}>
        <Feather name="home" size={14} color={colors.text} />
        <Text style={styles.btnText}>Ana Menü</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 22, paddingVertical: 26, justifyContent: 'center', gap: 8 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 12 },
  badge: {
    width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: withAlpha('#d08a52', 0.5), backgroundColor: withAlpha('#d08a52', 0.12),
  },
  name: { fontFamily: 'Comfortaa-SemiBold', fontSize: 30 },
  verdict: { fontFamily: mono, fontSize: 12, letterSpacing: 3, fontWeight: '800', color: '#d08a52' },
  sub: { color: colors.dim, fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 300, fontFamily: 'Comfortaa' },
  rewardChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1, borderColor: withAlpha(colors.danger, 0.4), backgroundColor: colors.glass, marginTop: 6,
  },
  rewardText: { fontFamily: mono, fontSize: 13, fontWeight: '800', color: colors.danger },
  lab: { fontFamily: mono, fontSize: 10, letterSpacing: 2.5, color: colors.dim, marginTop: 14, marginBottom: 8, textAlign: 'center' },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  q: { width: 30, textAlign: 'center', fontFamily: mono, fontSize: 18, fontWeight: '900', color: colors.dim },
  crest: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  crestText: { fontFamily: mono, fontSize: 15, fontWeight: '800', color: '#0a1526' },
  rname: { flex: 1, fontFamily: mono, fontSize: 14, fontWeight: '700', color: colors.ice },
  pending: { fontFamily: mono, fontSize: 11, color: colors.dim, fontStyle: 'italic' },
  note: { color: colors.dim, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 10, fontFamily: 'Comfortaa' },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
    borderColor: colors.glassBorder, backgroundColor: colors.glass,
  },
  btnText: { fontFamily: mono, fontSize: 12.5, fontWeight: '800', color: colors.text, letterSpacing: 0.5, textTransform: 'uppercase' },
});
