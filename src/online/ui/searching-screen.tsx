import { StyleSheet, Text, View } from 'react-native';

import { GlassButton } from '@/ui/glass';
import { colors, mono } from '@/ui/theme';
import { LobbyHeader } from './parts';
import { Radar } from './radar';

const fmt = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** "Rakip aranıyor" — radar + GERÇEK geçen süre (mock ilerleme yok). */
export function SearchingScreen({
  initial,
  elapsedSec,
  error,
  onCancel,
}: {
  initial: string;
  elapsedSec: number;
  error?: string | null;
  onCancel: () => void;
}) {
  return (
    <View style={styles.root}>
      <LobbyHeader title="HIZLI MAÇ" onBack={onCancel} />
      <View style={styles.body}>
        <View style={styles.radar}>
          <Radar initial={initial} />
        </View>

        <Text style={styles.title}>Rakip aranıyor…</Text>
        <Text style={styles.timer}>{fmt(elapsedSec)}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.action}>
          <GlassButton label="İptal" accent={colors.dim} onPress={onCancel} />
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
  radar: {
    marginBottom: 40,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 1,
    textShadowColor: colors.cyan,
    textShadowRadius: 14,
    marginBottom: 10,
  },
  timer: {
    fontSize: 14,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
    marginBottom: 44,
  },
  error: {
    color: colors.danger,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 12,
  },
  action: {
    width: '100%',
    paddingHorizontal: 16,
  },
});
