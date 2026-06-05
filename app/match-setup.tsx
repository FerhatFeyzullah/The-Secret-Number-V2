import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

/** Geçici yer tutucu: gerçek sayı belirleme ekranı 4. adımda gelecek.
 *  Eşleşme akışının buraya kadar test edilebilmesi için matchId'yi gösterir. */
export default function MatchSetupScreen() {
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  return (
    <Screen>
      <ScreenHeader title="Belirleme" />
      <View style={styles.center}>
        <GlassCard style={styles.card}>
          <Feather name="target" size={44} color={colors.cyan} />
          <Text style={styles.title}>Belirleme ekranı — yakında</Text>
          <Text style={styles.detail}>
            Eşleşme tamam! Gizli sayını belirleyeceğin ekran bir sonraki adımda eklenecek.
          </Text>
          <Text style={styles.matchLabel}>MATCH ID</Text>
          <Text style={styles.matchId} selectable>
            {matchId ?? '—'}
          </Text>
        </GlassCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  title: {
    color: colors.ice,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  detail: {
    color: colors.dim,
    textAlign: 'center',
    lineHeight: 21,
  },
  matchLabel: {
    color: colors.dim,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: mono,
    marginTop: 8,
  },
  matchId: {
    color: colors.cyan,
    fontSize: 13,
    fontFamily: mono,
  },
});
