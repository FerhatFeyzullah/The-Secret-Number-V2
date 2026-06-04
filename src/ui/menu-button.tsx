import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getToggle } from '../storage';
import { colors } from './theme';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

/** Ayar açıksa hafif dokunsal tepki verir. */
async function tapHaptic() {
  if (!canHaptics) return;
  if (await getToggle('haptics')) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

type Variant = 'primary' | 'secondary' | 'outline';

/** Oyun menüsü butonu: solda ikon, sağda başlık + alt metin.
 *  Basınca hafif ölçek küçülme (native driver) + ayara bağlı haptik.
 *  Hiyerarşi: primary (büyük, camgöbeği) > secondary (amber) > outline (sade). */
export function MenuButton({
  icon,
  title,
  subtitle,
  onPress,
  variant = 'primary',
  badge,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  variant?: Variant;
  badge?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () =>
    Animated.spring(scale, { toValue: 0.96, speed: 40, bounciness: 4, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(scale, { toValue: 1, speed: 40, bounciness: 6, useNativeDriver: true }).start();

  const handlePress = () => {
    tapHaptic();
    onPress();
  };

  const v = VARIANTS[variant];

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={handlePress}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.base,
            v.container,
            { transform: [{ scale }] },
            pressed && styles.pressed,
          ]}>
          <View style={[styles.iconWrap, v.iconWrap]}>
            <Ionicons name={icon} size={v.iconSize} color={v.accent} />
          </View>
          <View style={styles.textCol}>
            <Text style={[styles.title, v.title, { color: v.accent }]}>{title}</Text>
            <Text style={[styles.subtitle, v.subtitle]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.dim} />
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </Animated.View>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: {
    accent: colors.cyan,
    container: {
      paddingVertical: 18,
      borderColor: colors.cyan,
      backgroundColor: 'rgba(52, 224, 255, 0.08)',
      shadowColor: colors.cyan,
      shadowOpacity: 0.45,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
    },
    iconWrap: {
      width: 54,
      height: 54,
      borderColor: colors.cyanDim,
      backgroundColor: 'rgba(52, 224, 255, 0.10)',
    },
    iconSize: 28,
    title: { fontSize: 19 },
    subtitle: { fontSize: 13 },
  },
  secondary: {
    accent: colors.amber,
    container: {
      paddingVertical: 14,
      borderColor: 'rgba(255, 200, 87, 0.65)',
      backgroundColor: 'rgba(255, 200, 87, 0.06)',
      shadowColor: colors.amber,
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 3,
    },
    iconWrap: {
      width: 46,
      height: 46,
      borderColor: 'rgba(255, 200, 87, 0.35)',
      backgroundColor: 'rgba(255, 200, 87, 0.08)',
    },
    iconSize: 24,
    title: { fontSize: 17 },
    subtitle: { fontSize: 12 },
  },
  outline: {
    accent: colors.text,
    container: {
      paddingVertical: 10,
      borderColor: colors.glassBorder,
      backgroundColor: 'transparent',
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderColor: colors.glassBorder,
      backgroundColor: colors.glass,
    },
    iconSize: 19,
    title: { fontSize: 15 },
    subtitle: { fontSize: 11 },
  },
} as const;

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
  },
  pressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  iconWrap: {
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '800',
    letterSpacing: 1,
  },
  subtitle: {
    color: colors.dim,
  },
  badge: {
    position: 'absolute',
    top: -9,
    right: 14,
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
