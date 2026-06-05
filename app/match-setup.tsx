import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { SecretSetupScreen } from '@/online/ui';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

/** Gizli kod belirleme route'u: eşleşme bulununca matchId ile buraya gelinir.
 *  Tüm belirleme/realtime mantığı SecretSetupScreen'de. */
export default function MatchSetupRoute() {
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  if (!matchId) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.note}>Maç bulunamadı.</Text>
        </View>
      </Screen>
    );
  }
  return <SecretSetupScreen matchId={matchId} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    color: colors.dim,
    fontSize: 14,
    fontFamily: mono,
  },
});
