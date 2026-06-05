import { useLocalSearchParams } from 'expo-router';

import { DuelScreen } from '@/online/ui';
import { Screen } from '@/ui/screen';
import { StyleSheet, Text, View } from 'react-native';
import { colors, mono } from '@/ui/theme';

/** Online düello route'u: /match/[id]. matchId'yi DuelScreen'e geçirir
 *  (tüm realtime/oyun mantığı orada). Geçersiz id'de kısa bir uyarı. */
export default function MatchRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!id) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.note}>Maç bulunamadı.</Text>
        </View>
      </Screen>
    );
  }
  return <DuelScreen matchId={id} />;
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
