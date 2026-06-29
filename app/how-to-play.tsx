import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

const numberRules = [
  'Gizli sayı; 1-9 arası, birbirinden farklı 3 rakamdan oluşur. Sıfır yoktur.',
  'Her tahminde kaç rakamın doğru olduğu söylenir — ama hangileri ve hangi pozisyonda olduğu asla söylenmez.',
  'Üç rakamın üçü de doğru ama sıra yanlışsa: "3 rakam da doğru, yerleri yanlış" denir. Kaçının yerinde olduğu söylenmez.',
  'Rakamları doğru sıraya koyduğunda kazanırsın!',
];

const numberExample = [
  { guess: '125', feedback: '1 rakam doğru' },
  { guess: '347', feedback: '2 rakam doğru' },
  { guess: '274', feedback: '3 rakam da doğru, yerleri yanlış' },
  { guess: '472', feedback: 'Kazandın! 🎉' },
];

const wordRules = [
  'Gizli kelime; 4, 5 ya da 6 harfli yaygın bir Türkçe kelimedir. Uzunluk her turda yeniden belirlenir (ikinize de aynı).',
  'Her tahmin geçerli bir Türkçe kelime olmalı ve gizli kelimeyle aynı uzunlukta olur.',
  'Doğru harf doğru yerdeyse yeşil, kelimede var ama yeri yanlışsa sarı gösterilir; hiç olmayan harf gri kalır.',
  'Rakibin kelimesini önce çözen turu kazanır. En çok 3 tur oynanır; 2 tur kazanan maçı alır.',
];

const wordExample = [
  { guess: 'KİTAP', feedback: 'K yeşil (yerinde); A sarı (var, yeri yanlış)' },
  { guess: 'KALEM', feedback: 'Kazandın! 🎉' },
];

export default function HowToPlayScreen() {
  return (
    <Screen>
      <ScreenHeader title="Nasıl Oynanır" />
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.intro}>
          İki mod var: rakibinin gizli SAYISINI ya da gizli KELİMESİNİ ondan önce çöz.
        </Text>

        {/* ── Sayı Modu ── */}
        <GlassCard>
          <Text style={styles.modeTitle}>🔢 Sayı Modu</Text>
          {numberRules.map((rule, i) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.bullet}>{i + 1}</Text>
              <Text style={styles.rule}>{rule}</Text>
            </View>
          ))}
          <Text style={styles.exampleTitle}>Örnek — gizli sayı 472 olsun:</Text>
          {numberExample.map((row) => (
            <View key={row.guess} style={styles.exampleRow}>
              <Text style={styles.exampleGuess}>{row.guess}</Text>
              <Text style={styles.exampleFeedback}>{row.feedback}</Text>
            </View>
          ))}
        </GlassCard>

        {/* ── Kelime Modu ── */}
        <GlassCard>
          <Text style={styles.modeTitle}>🔤 Kelime Modu</Text>
          {wordRules.map((rule, i) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.bullet}>{i + 1}</Text>
              <Text style={styles.rule}>{rule}</Text>
            </View>
          ))}
          <Text style={styles.exampleTitle}>Örnek — gizli kelime KALEM olsun:</Text>
          {wordExample.map((row) => (
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
  intro: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
  },
  modeTitle: {
    color: colors.cyan,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.5,
    marginBottom: 14,
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
    marginTop: 4,
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
