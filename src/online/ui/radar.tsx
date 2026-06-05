import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors, cyanAlpha, mono } from '@/ui/theme';

const SIZE = 220;
const CENTER = SIZE / 2;

/** Tek bir genişleyip sönen halka (radarPulse @keyframes karşılığı). */
function PulseRing({ delay }: { delay: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: 2400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [delay, progress]);

  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1.15] });
  const opacity = progress.interpolate({ inputRange: [0, 0.75, 1], outputRange: [0.7, 0.12, 0] });

  return (
    <Animated.View
      style={[styles.ring, styles.pulseRing, { opacity, transform: [{ scale }] }]}
    />
  );
}

/** Aktif "rakip aranıyor" radarı: nabız atan halkalar + dönen süpürme ışını
 *  + ortada baş harf. (Web @keyframes radarPulse/radarSweep RN Animated.) */
export function Radar({ initial }: { initial: string }) {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const rotate = sweep.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.wrap}>
      {/* Statik referans halkaları */}
      <View style={[styles.ring, styles.staticOuter]} />
      <View style={[styles.ring, styles.staticInner]} />

      {/* Nabız atan halkalar */}
      {[0, 800, 1600].map((d) => (
        <PulseRing key={d} delay={d} />
      ))}

      {/* Dönen süpürme ışını */}
      <Animated.View style={[styles.sweep, { transform: [{ rotate }] }]}>
        <LinearGradient
          colors={[cyanAlpha(0), cyanAlpha(0.35)]}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={styles.beam}
        />
      </Animated.View>

      {/* Merkez avatar */}
      <View style={styles.center}>
        <Animated.Text style={styles.centerText}>{(initial || '?').toUpperCase()}</Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: SIZE,
    borderWidth: 1.5,
    borderColor: colors.cyan,
  },
  pulseRing: {
    width: SIZE,
    height: SIZE,
  },
  staticOuter: {
    width: 180,
    height: 180,
    borderWidth: 1,
    borderColor: cyanAlpha(0.18),
  },
  staticInner: {
    width: 120,
    height: 120,
    borderWidth: 1,
    borderColor: cyanAlpha(0.22),
  },
  sweep: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
  },
  // Merkezden yukarı uzanan ince ışın; wrapper döndükçe merkez etrafında süpürür.
  beam: {
    position: 'absolute',
    top: 0,
    width: 3,
    height: CENTER,
  },
  center: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: cyanAlpha(0.18),
    borderWidth: 2,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 16px ${cyanAlpha(0.55)}`,
  },
  centerText: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
  },
});
