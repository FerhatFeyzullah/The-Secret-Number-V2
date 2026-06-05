import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassButton } from '@/ui/glass';
import { colors, mono, withAlpha } from '@/ui/theme';
import { LobbyHeader } from './parts';

/** 60 sn içinde rakip gelmeyince: soluk radar + tekrar dene / özel oda. */
export function NoOpponentScreen({
  onRetry,
  onCreateRoom,
  onBack,
}: {
  onRetry: () => void;
  onCreateRoom: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.root}>
      <LobbyHeader title="HIZLI MAÇ" onBack={onBack} />
      <View style={styles.body}>
        <View style={styles.emblem}>
          {[50, 92, 134].map((d) => (
            <View
              key={d}
              style={[styles.ring, { width: d, height: d, borderRadius: d / 2 }]}
            />
          ))}
          <View style={styles.center}>
            <Feather name="search" size={22} color={withAlpha(colors.dim, 0.5)} />
          </View>
        </View>

        <Text style={styles.title}>Şu an çevrimiçi rakip yok</Text>
        <Text style={styles.subtitle}>Tekrar dene ya da özel oda kur</Text>

        <View style={styles.actions}>
          <GlassButton label="Tekrar Dene" accent={colors.cyan} variant="fill" onPress={onRetry} />
          <GlassButton label="Özel Oda Kur" accent={colors.amber} onPress={onCreateRoom} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblem: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 36,
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: withAlpha(colors.dim, 0.18),
  },
  center: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: withAlpha(colors.dim, 0.22),
    backgroundColor: withAlpha(colors.dim, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    fontFamily: mono,
    textAlign: 'center',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    color: colors.dim,
    textAlign: 'center',
    marginBottom: 40,
  },
  actions: {
    width: '100%',
    paddingHorizontal: 16,
    gap: 12,
  },
});
