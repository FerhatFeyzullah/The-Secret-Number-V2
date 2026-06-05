import { StyleSheet, Text, View } from 'react-native';

import { colors, mono } from '@/ui/theme';
import { ChoiceCard, LobbyHeader } from './parts';

/** Özel oyun seçimi: Oda Kur / Oda Bul. */
export function PrivateChoiceScreen({
  onCreate,
  onJoin,
  onBack,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.root}>
      <LobbyHeader title="ÖZEL OYUN" onBack={onBack} />

      <View style={styles.heading}>
        <Text style={styles.headingLabel}>NE YAPMAK İSTERSİN?</Text>
        <View style={styles.headingRule} />
      </View>

      <View style={styles.cards}>
        <ChoiceCard
          icon="plus"
          accent={colors.cyan}
          title="Oda Kur"
          subtitle="Oda kodu oluştur, arkadaşını davet et"
          onPress={onCreate}
        />
        <ChoiceCard
          icon="log-in"
          accent={colors.amber}
          title="Oda Bul"
          subtitle="Oda kodunu girerek katıl"
          onPress={onJoin}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
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
    width: 28,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.amber,
  },
  cards: {
    gap: 14,
  },
});
