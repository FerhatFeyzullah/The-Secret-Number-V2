import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions } from 'react-native';

import { colors, mono } from './theme';

const DIGIT_COUNT = 14;
/** Kelime modunda süzülen glifler: Türkçe alfabe (TR karakterler dahil). */
const TR_LETTERS = 'abcçdefgğhıijklmnoöprsştuüvyz';

const FloatingGlyph = memo(function FloatingGlyph({
  index,
  letters,
  paused,
}: {
  index: number;
  letters: boolean;
  paused: boolean;
}) {
  const { width, height } = useWindowDimensions();
  // Her glif için mount'ta bir kez seçilen sabit rastgele parametreler.
  const cfg = useRef({
    glyph: letters
      ? TR_LETTERS[Math.floor(Math.random() * TR_LETTERS.length)]
      : String(1 + Math.floor(Math.random() * 9)),
    x: Math.random() * (width - 40),
    y: Math.random() * height,
    drift: 60 + Math.random() * 90,
    duration: 9000 + Math.random() * 9000,
    delay: (index / DIGIT_COUNT) * 6000,
    size: 22 + Math.random() * 34,
  }).current;
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (paused) return; // odak dışı: yeni sonsuz loop kurma (glif mount kalır, donar)
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
  }, [cfg, progress, paused]);

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
      {cfg.glyph}
    </Animated.Text>
  );
});

/** Arka planda hafifçe süzülen soluk rakamlar (kelime modunda: TR harfler).
 *  Odak dışındaki ekranlarda (stack'te altta / üstte modal) 14 sonsuz native loop
 *  boşuna GPU/kompozit işi yapmasın diye odak kaybında duraklar; glifler unmount
 *  EDİLMEZ (geri-kaydırma geçişinde ekran boş yanıp sönmesin). */
export const FloatingDigits = memo(function FloatingDigits({
  letters = false,
}: {
  letters?: boolean;
}) {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <>
      {Array.from({ length: DIGIT_COUNT }, (_, i) => (
        <FloatingGlyph key={i} index={i} letters={letters} paused={!focused} />
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  digit: {
    position: 'absolute',
    color: colors.faintDigit,
    fontFamily: mono,
    fontWeight: 'bold',
  },
});
