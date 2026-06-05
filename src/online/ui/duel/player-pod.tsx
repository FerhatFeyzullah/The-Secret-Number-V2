import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from '@/ui/theme';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Arena oyuncu kapsülü: avatar + ad + satranç saati.
 *  Aktif (sırası gelen) parlak akar; diğeri sönük. ≤10 sn'de kırmızı + nabız. */
export function PlayerPod({
  initial,
  name,
  ms,
  active,
  side,
}: {
  initial: string;
  name: string;
  ms: number;
  active: boolean;
  side: 'left' | 'right';
}) {
  const accent = side === 'left' ? colors.cyan : colors.amber;
  const isLow = ms <= 10_000;
  const urgent = active && isLow;
  const clockColor = urgent ? colors.danger : active ? accent : colors.dim;

  // urgentPulse @keyframes → glow opacity nabzı (native driver).
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!urgent) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, pulse]);
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View style={[styles.root, { alignItems: side === 'left' ? 'flex-start' : 'flex-end', opacity: active ? 1 : 0.42 }]}>
      <View style={[styles.idRow, { flexDirection: side === 'left' ? 'row' : 'row-reverse' }]}>
        <View
          style={[
            styles.avatar,
            {
              borderColor: active ? accent : withAlpha('#ffffff', 0.12),
              backgroundColor: withAlpha(accent, active ? 0.2 : 0.06),
              boxShadow: active ? `0 0 12px ${withAlpha(accent, 0.4)}` : undefined,
            },
          ]}>
          <Text style={[styles.avatarText, { color: active ? accent : colors.dim }]}>
            {(initial || '?').toUpperCase()}
          </Text>
        </View>
        <Text
          style={[styles.name, { color: active ? colors.text : colors.dim }]}
          numberOfLines={1}>
          {name}
        </Text>
      </View>

      <View
        style={[
          styles.clock,
          {
            borderColor: active ? withAlpha(clockColor, 0.5) : withAlpha('#ffffff', 0.08),
            backgroundColor: active ? withAlpha(clockColor, 0.12) : 'rgba(255,255,255,0.03)',
          },
        ]}>
        {urgent ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.urgentGlow,
              { opacity: glowOpacity, boxShadow: `0 0 22px ${withAlpha(colors.danger, 0.6)}` },
            ]}
          />
        ) : null}
        <Text
          style={[
            styles.clockText,
            {
              color: clockColor,
              textShadowColor: active ? clockColor : 'transparent',
            },
          ]}>
          {fmt(ms)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    gap: 6,
  },
  idRow: {
    alignItems: 'center',
    gap: 8,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: mono,
  },
  name: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.5,
    maxWidth: 96,
  },
  clock: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 8,
    paddingHorizontal: 14,
    overflow: 'hidden',
  },
  urgentGlow: {
    borderRadius: 12,
  },
  clockText: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1,
    textShadowRadius: 12,
  },
});
