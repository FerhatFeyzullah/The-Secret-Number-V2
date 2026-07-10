import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ChoiceCard, LobbyHeader } from '@/online/ui/parts';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

/** Tek oyunculu mod seçim hub'ı: çok oyunculu lobideki (lobby-hub) kart tarzıyla
 *  alt alta iki seçim — Sayı Modu (mevcut) ve Kelime Modu (yeni). Menüde OYNA
 *  (Tek Kişilik) buraya gelir; kartlar ilgili kurulum ekranlarına dallanır. */
export default function SoloScreen() {
  const router = useRouter();
  return (
    <Screen>
      <LobbyHeader title="TEK KİŞİLİK" onBack={() => router.back()} />

      <View style={styles.heading}>
        <Text style={styles.headingLabel}>MOD SEÇ</Text>
        <View style={styles.headingRule} />
      </View>

      <View style={styles.cards}>
        <ChoiceCard
          icon="hash"
          accent={colors.cyan}
          title="Sayı Modu"
          subtitle="Gizli 3 haneli sayıyı bul"
          onPress={() => router.push('/offline-setup')}>
          <View style={styles.tags}>
            <Text style={styles.tag}>🔢 Süreli veya tahmin hakkı</Text>
          </View>
        </ChoiceCard>

        <ChoiceCard
          icon="type"
          accent={colors.success}
          title="Kelime Modu"
          subtitle="Gizli kelimeyi süreye karşı bul"
          onPress={() => router.push('/offline-word-setup')}>
          <View style={styles.tags}>
            <Text style={styles.tag}>🔤 4-6 harf · süreli · sınırsız tahmin</Text>
          </View>
        </ChoiceCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: {
    marginTop: 12,
    marginBottom: 22,
    gap: 6,
  },
  headingLabel: {
    fontSize: 10,
    color: colors.dim,
    letterSpacing: 3,
    fontFamily: mono,
  },
  headingRule: {
    width: 32,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.cyan,
  },
  cards: {
    gap: 14,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  tag: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
  },
});
