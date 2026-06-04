import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors } from '@/ui/theme';

export default function OnlineScreen() {
  return (
    <Screen>
      <ScreenHeader title="Çok Oyunculu" />
      <View style={styles.center}>
        <GlassCard style={styles.card}>
          <Ionicons name="globe-outline" size={48} color={colors.amber} />
          <Text style={styles.title}>Çok Yakında!</Text>
          <Text style={styles.detail}>
            Arkadaşlarınla kapışacağın çevrim içi mod üzerinde çalışıyoruz.
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
    color: colors.amber,
    fontSize: 24,
    fontWeight: 'bold',
  },
  detail: {
    color: colors.dim,
    textAlign: 'center',
    lineHeight: 21,
  },
});
