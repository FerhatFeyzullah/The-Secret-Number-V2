import * as Haptics from 'expo-haptics';
import { useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useSfx } from '../sfx';
import { getToggle, type GameMode } from '../storage';
import { colors, cyanAlpha, mono } from './theme';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

/** Yüz katmanının basılınca indiği derinlik (tabanın görünen kalınlığı). */
const DEPTH = 7;

/** Moda göre arcade tuş paleti. */
const PALETTES: Record<GameMode, { accent: string; face: string; base: string; glowBg: string }> = {
  solo: {
    accent: colors.cyan,
    face: '#0c2c47', // koyu elektrik mavisi yüzey
    base: '#071e33', // daha koyu taban
    glowBg: cyanAlpha(0.14),
  },
  online: {
    accent: colors.amber,
    face: '#3a2c10',
    base: '#241a08',
    glowBg: 'rgba(255, 200, 87, 0.14)',
  },
};

/** Arcade/kabarık büyük OYNA tuşu: altta koyu taban, üstte basılınca
 *  taban derinliği kadar inen yüz katmanı (translateY, native driver),
 *  üst kenarda highlight şeridi, moda göre neon glow.
 *  Press'te haptik + (ses açıksa) blip. */
export function PlayButton({ mode, onPress }: { mode: GameMode; onPress: () => void }) {
  const palette = PALETTES[mode];
  const translateY = useRef(new Animated.Value(0)).current;
  const playSfx = useSfx();

  const pressIn = () =>
    Animated.timing(translateY, { toValue: DEPTH, duration: 70, useNativeDriver: true }).start();
  const pressOut = () =>
    Animated.spring(translateY, {
      toValue: 0,
      speed: 30,
      bounciness: 9,
      useNativeDriver: true,
    }).start();

  const handlePress = async () => {
    if (canHaptics && (await getToggle('haptics'))) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (await getToggle('sound')) playSfx('blip');
    onPress();
  };

  return (
    <Pressable onPressIn={pressIn} onPressOut={pressOut} onPress={handlePress}>
      <View style={styles.wrap}>
        {/* taban: yüzün indiği koyu katman */}
        <View style={[styles.layer, styles.baseLayer, { backgroundColor: palette.base }]} />
        <Animated.View
          style={[
            styles.layer,
            styles.face,
            {
              backgroundColor: palette.face,
              borderColor: palette.accent,
              shadowColor: palette.accent,
              transform: [{ translateY }],
            },
          ]}>
          <View style={[styles.glowFill, { backgroundColor: palette.glowBg }]} />
          {/* üst parlak highlight şeridi */}
          <View style={styles.highlight} />
          <Text style={[styles.label, { color: palette.accent, textShadowColor: palette.accent }]}>
            OYNA
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const FACE_HEIGHT = 68;

const styles = StyleSheet.create({
  wrap: {
    height: FACE_HEIGHT + DEPTH,
  },
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FACE_HEIGHT,
    borderRadius: 18,
  },
  baseLayer: {
    top: DEPTH,
  },
  face: {
    top: 0,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowOpacity: 0.55,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  glowFill: {
    ...StyleSheet.absoluteFillObject,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 14,
    right: 14,
    height: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  label: {
    fontSize: 27,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 10,
    textShadowRadius: 12,
  },
});
