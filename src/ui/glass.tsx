import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { colors, withAlpha } from './theme';

/** Camsı / yarı saydam kart. */
export function GlassCard({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/**
 * Neon vurgulu camsı buton; isteğe bağlı rozet (ör. "Çok Yakında").
 *
 * `variant`:
 *  - 'outline' (varsayılan): camsı zemin + neon kenar (mevcut tüm çağrıların görünümü).
 *  - 'fill': vurgu renginde hafif dolgu + glow (lobideki birincil aksiyonlar).
 */
export function GlassButton({
  label,
  onPress,
  accent = colors.cyan,
  badge,
  small,
  variant = 'outline',
  icon,
  disabled = false,
  fullWidth = true,
}: {
  label: string;
  onPress: () => void;
  accent?: string;
  badge?: string;
  small?: boolean;
  variant?: 'fill' | 'outline';
  icon?: ReactNode;
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const fill = variant === 'fill';
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { borderColor: accent },
        fill && {
          backgroundColor: withAlpha(accent, 0.16),
          boxShadow: `0 0 18px ${withAlpha(accent, 0.32)}`,
        },
        !fullWidth && styles.inline,
        disabled && styles.disabled,
        pressed && !disabled && (fill ? styles.pressedFill : styles.pressed),
      ]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text
        style={[
          styles.label,
          small && styles.labelSmall,
          { color: disabled ? colors.dim : accent },
        ]}>
        {label}
      </Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonSmall: {
    paddingVertical: 10,
  },
  inline: {
    alignSelf: 'center',
    paddingHorizontal: 28,
  },
  disabled: {
    opacity: 0.45,
  },
  icon: {
    marginRight: 2,
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  pressedFill: {
    transform: [{ scale: 0.985 }],
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
