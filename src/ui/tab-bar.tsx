import { Ionicons } from '@expo/vector-icons';
import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Fragment, useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getToggle } from '@/storage';
import { colors, cyanAlpha, mono } from './theme';

type IoniconName = keyof typeof Ionicons.glyphMap;

/** Alt sekme meta: route adı → etiket + ikon tabanı. Dolgulu ikon aktif,
 *  `-outline` varyantı pasif durumda kullanılır (modern dolgu/çizgi çifti). */
const TAB_META: Record<string, { label: string; icon: IoniconName }> = {
  store: { label: 'Mağaza', icon: 'bag-handle' },
  gear: { label: 'Donanım', icon: 'hardware-chip' },
  index: { label: 'Ana Ekran', icon: 'home' },
  clan: { label: 'Klan', icon: 'shield' },
  cup: { label: 'Turnuva', icon: 'trophy' },
};

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

/** Clash Royale tarzı özel alt sekme çubuğu. Aktif sekme neon camgöbeği renk +
 *  dolgulu ikon + hafif büyüme; pasifler sönük çizgi ikon. Dokununca sekme
 *  hafifçe sallanır (yukarı kalkmaz) ve — ayarda açıksa — haptik verir. */
export function TabBar({ state, navigation }: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets();
  // Odak animasyonu (aktiflik): glow opaklığı + hafif büyüme.
  const anims = useRef(
    state.routes.map((_, i) => new Animated.Value(i === state.index ? 1 : 0)),
  ).current;
  // Dokunma anındaki tek seferlik sallanma (rotasyon).
  const shakes = useRef(state.routes.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel(
      state.routes.map((_, i) =>
        Animated.spring(anims[i], {
          toValue: i === state.index ? 1 : 0,
          useNativeDriver: true,
          speed: 16,
          bounciness: 8,
        }),
      ),
    ).start();
  }, [state.index, state.routes, anims]);

  const wiggle = (i: number) => {
    shakes[i].setValue(0);
    Animated.sequence([
      Animated.timing(shakes[i], { toValue: 1, duration: 55, useNativeDriver: true }),
      Animated.timing(shakes[i], { toValue: -1, duration: 55, useNativeDriver: true }),
      Animated.timing(shakes[i], { toValue: 0.55, duration: 45, useNativeDriver: true }),
      Animated.timing(shakes[i], { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  };

  // Home-indicator payı (makul sınırla), üste ve alta EŞİT verilir → ikonlar
  // renkli şeritte tam ortalı görünür; inset'i tamamen alta yığmayız.
  const safe = Math.min(insets.bottom, 14);

  return (
    <View style={[styles.wrap, { paddingTop: 8 + safe, paddingBottom: 8 + safe }]}>
      <LinearGradient
        colors={['rgba(6, 11, 24, 0.98)', 'rgba(10, 20, 40, 0.88)']}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.topLine} pointerEvents="none" />
      <View style={styles.row}>
        {state.routes.map((route, i) => {
          const meta =
            TAB_META[route.name] ?? { label: route.name, icon: 'ellipse' as IoniconName };
          const focused = state.index === i;
          const a = anims[i];
          const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
          const rotate = shakes[i].interpolate({ inputRange: [-1, 1], outputRange: ['-9deg', '9deg'] });

          const onPress = async () => {
            wiggle(i);
            if (canHaptics && (await getToggle('haptics'))) {
              Haptics.selectionAsync().catch(() => {});
            }
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          return (
            <Fragment key={route.key}>
              {i > 0 ? <View style={styles.divider} pointerEvents="none" /> : null}
              <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={meta.label}
                style={styles.tab}>
                <Animated.View style={[styles.item, { transform: [{ scale }, { rotate }] }]}>
                  <Ionicons
                    name={focused ? meta.icon : (`${meta.icon}-outline` as IoniconName)}
                    size={23}
                    color={focused ? colors.cyan : colors.dim}
                  />
                  <Text style={[styles.label, focused && styles.labelOn]} numberOfLines={1}>
                    {meta.label}
                  </Text>
                </Animated.View>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    // Büyüme animasyonu kırpılmasın; paddingBottom (safe-area) inline verilir.
    overflow: 'visible',
  },
  topLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: cyanAlpha(0.2),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Butonlar arası çok ince, kısa dikey ayraç.
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 26,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: {
    alignItems: 'center',
    gap: 4,
  },
  label: {
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.dim,
  },
  labelOn: {
    color: colors.ice,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 8,
  },
});
