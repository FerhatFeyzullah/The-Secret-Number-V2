import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors } from './theme';

/** Camsı / yarı saydam kart. */
export function GlassCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Neon vurgulu camsı buton; isteğe bağlı rozet (ör. "Çok Yakında"). */
export function GlassButton({
  label,
  onPress,
  accent = colors.cyan,
  badge,
  small,
}: {
  label: string;
  onPress: () => void;
  accent?: string;
  badge?: string;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { borderColor: accent },
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.label, small && styles.labelSmall, { color: accent }]}>{label}</Text>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  button: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  buttonSmall: {
    paddingVertical: 10,
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  label: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  labelSmall: {
    fontSize: 15,
  },
  badge: {
    position: 'absolute',
    top: -10,
    right: 12,
    backgroundColor: colors.amber,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#3a2b00',
    fontSize: 11,
    fontWeight: '800',
  },
});
