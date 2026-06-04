import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

import { colors, mono } from './theme';

const DIGIT_COUNT = 14;

function FloatingDigit({ index }: { index: number }) {
  const { width, height } = useWindowDimensions();
  // Her rakam için mount'ta bir kez seçilen sabit rastgele parametreler.
  const cfg = useRef({
    digit: 1 + Math.floor(Math.random() * 9),
    x: Math.random() * (width - 40),
    y: Math.random() * height,
    drift: 60 + Math.random() * 90,
    duration: 9000 + Math.random() * 9000,
    delay: (index / DIGIT_COUNT) * 6000,
    size: 22 + Math.random() * 34,
  }).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(cfg.delay),
        Animated.timing(progress, {
          toValue: 1,
          duration: cfg.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: cfg.duration,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [cfg, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -cfg.drift],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.25, 1, 0.25],
  });

  return (
    <Animated.Text
      style={[
        styles.digit,
        {
          left: cfg.x,
          top: cfg.y,
          fontSize: cfg.size,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      {cfg.digit}
    </Animated.Text>
  );
}

/** Arka planda hafifçe süzülen soluk rakamlar. */
export function FloatingDigits() {
  return (
    <>
      {Array.from({ length: DIGIT_COUNT }, (_, i) => (
        <FloatingDigit key={i} index={i} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  digit: {
    position: 'absolute',
    color: colors.faintDigit,
    fontFamily: mono,
    fontWeight: 'bold',
  },
});
