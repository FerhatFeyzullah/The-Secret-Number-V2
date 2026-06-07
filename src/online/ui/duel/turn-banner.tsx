import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from '@/ui/theme';

/** Sıra banner'ı: senin sıran (camgöbeği) / rakip düşünüyor (amber + nokta). */
export function TurnBanner({ mine }: { mine: boolean }) {
  const accent = mine ? colors.cyan : colors.amber;

  // fastPulse: nokta nabzı (native driver).
  const pulse = useRef(new Animated.Value(0)).current;
  // dots: "..." sönüp yanması (yalnız rakip sırasında).
  const dots = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (mine) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dots, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(dots, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mine, dots]);

  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.7] });
  const dotsOpacity = dots.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <View
      style={[
        styles.root,
        {
          borderColor: withAlpha(accent, mine ? 0.4 : 0.32),
          backgroundColor: withAlpha(accent, mine ? 0.16 : 0.12),
        },
      ]}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: accent,
            boxShadow: `0 0 8px ${accent}`,
            opacity: dotOpacity,
            transform: [{ scale: dotScale }],
          },
        ]}
      />
      <Text
        style={[
          styles.label,
          { color: mine ? colors.ice : colors.amber, textShadowColor: withAlpha(accent, 0.7) },
        ]}>
        {mine ? 'SENİN SIRAN' : 'RAKİP DÜŞÜNÜYOR'}
      </Text>
      {!mine ? (
        <Animated.Text style={[styles.label, { color: colors.amber, opacity: dotsOpacity }]}>
          …
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 12,
  },
});
