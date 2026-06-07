import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ProtocolSelectScreen } from '@/online/ui';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

/** Destiny's Hand seçim route'u: Protokol Maçı eşleşince (belirleme öncesi)
 *  matchId ile buraya gelinir. Tüm seçim/realtime mantığı ProtocolSelectScreen'de. */
export default function ProtocolSelectRoute() {
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
  return <ProtocolSelectScreen matchId={matchId} />;
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
