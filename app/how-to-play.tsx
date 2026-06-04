import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

const rules = [
  'Gizli sayı; 1-9 arası, birbirinden farklı 3 rakamdan oluşur. Sıfır yoktur.',
  'Her tahminde kaç rakamın doğru olduğu söylenir — ama hangileri ve hangi pozisyonda olduğu asla söylenmez.',
  'Üç rakamın üçü de doğru ama sıra yanlışsa: "3 rakam da doğru, yerleri yanlış" denir. Kaçının yerinde olduğu söylenmez.',
  'Rakamları doğru sıraya koyduğunda kazanırsın!',
];

const example = [
  { guess: '125', feedback: '1 rakam doğru' },
  { guess: '347', feedback: '2 rakam doğru' },
  { guess: '274', feedback: '3 rakam da doğru, yerleri yanlış' },
  { guess: '472', feedback: 'Kazandın! 🎉' },
];

export default function HowToPlayScreen() {
  return (
    <Screen>
      <ScreenHeader title="Nasıl Oynanır" />
      <ScrollView contentContainerStyle={styles.list}>
        <GlassCard>
          {rules.map((rule, i) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.bullet}>{i + 1}</Text>
              <Text style={styles.rule}>{rule}</Text>
            </View>
          ))}
        </GlassCard>

        <GlassCard>
          <Text style={styles.exampleTitle}>Örnek — gizli sayı 472 olsun:</Text>
          {example.map((row) => (
            <View key={row.guess} style={styles.exampleRow}>
              <Text style={styles.exampleGuess}>{row.guess}</Text>
              <Text style={styles.exampleFeedback}>{row.feedback}</Text>
            </View>
          ))}
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
    paddingBottom: 24,
  },
  ruleRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  bullet: {
    color: colors.amber,
    fontFamily: mono,
    fontWeight: 'bold',
    fontSize: 16,
  },
  rule: {
    flex: 1,
    color: colors.text,
    lineHeight: 21,
  },
  exampleTitle: {
    color: colors.amber,
    fontWeight: '700',
    marginBottom: 12,
  },
  exampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.glassBorder,
  },
  exampleGuess: {
    color: colors.cyan,
    fontFamily: mono,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 4,
    width: 70,
  },
  exampleFeedback: {
    flex: 1,
    color: colors.dim,
  },
});
