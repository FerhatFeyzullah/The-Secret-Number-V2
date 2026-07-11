import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { colors, mono } from '@/ui/theme';

const SIZE = 128;
const R = 58;
const CIRC = 2 * Math.PI * R;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `00:${String(s).padStart(2, '0')}`;
};

const clampRemaining = (deadline: number, totalMs: number) =>
  Math.max(0, Math.min(totalMs, deadline - Date.now()));

/** Geri sayım halkası (SVG). Kendi içinde 250 ms'de bir tikler → saat ekranın
 *  geri kalanını değil yalnız halkayı yeniler. low (kalan ≤ lowMs) → kırmızı +
 *  "urgent" nabzı. deadline null → tam dolu halka, tik yok. Yalnız gösterim;
 *  gerçek karar sunucuda. */
export function CountdownRing({
  deadline,
  totalMs,
  lowMs = 5_000,
}: {
  /** Epoch ms (Date.parse sonucu) ya da null. */
  deadline: number | null;
  totalMs: number;
  lowMs?: number;
}) {
  const [remainingMs, setRemainingMs] = useState(() =>
    deadline == null ? totalMs : clampRemaining(deadline, totalMs),
  );
  useEffect(() => {
    if (deadline == null) {
      setRemainingMs(totalMs);
      return;
    }
    const tick = () => setRemainingMs(clampRemaining(deadline, totalMs));
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
  }, [deadline, totalMs]);

  const low = remainingMs <= lowMs;
  const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const offset = CIRC * (1 - ratio);
  const color = low ? colors.danger : colors.cyan;

  // urgent @keyframes: süre azken zaman metni nabız atar (native driver).
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!low) {
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
  }, [low, pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <View style={styles.wrap}>
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle cx={64} cy={64} r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={6} />
        <G rotation={-90} originX={64} originY={64}>
          <Circle
            cx={64}
            cy={64}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={offset}
          />
        </G>
      </Svg>
      <Animated.Text
        style={[
          styles.time,
          { color: low ? '#fca5a5' : colors.ice, transform: [{ scale }] },
          { textShadowColor: low ? colors.danger : colors.cyan },
        ]}>
        {fmt(remainingMs)}
      </Animated.Text>
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
  time: {
    position: 'absolute',
    fontSize: 34,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1,
    textShadowRadius: 14,
  },
});
