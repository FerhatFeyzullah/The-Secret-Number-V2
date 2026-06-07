import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { isEliteLevel, levelTitle } from '@/online';
import { getToggle } from '@/storage';
import { colors, mono, withAlpha } from '@/ui/theme';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

/** Seviye atlama kutlaması: maç sonrası seviye arttıysa kısa overlay.
 *  Elit seviyelerde (8-10) daha büyük/parlak (altın) + güçlü haptik. */
export function LevelUpOverlay({
  visible,
  level,
  onClose,
}: {
  visible: boolean;
  level: number;
  onClose: () => void;
}) {
  const elite = isEliteLevel(level);
  const accent = elite ? colors.gold : colors.cyan;

  const pop = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    spin.setValue(0);
    Animated.spring(pop, {
      toValue: 1,
      friction: elite ? 4 : 6,
      tension: elite ? 80 : 60,
      useNativeDriver: true,
    }).start();
    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: elite ? 6000 : 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    // Haptik: elit seviyelerde daha güçlü (başarı + ağır darbe).
    void (async () => {
      if (!canHaptics || !(await getToggle('haptics'))) return;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (elite) {
        setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 140);
      }
    })();
  }, [visible, elite, pop, spin]);

  const medalSize = elite ? 108 : 88;
  const rayStyle = {
    opacity: pop.interpolate({ inputRange: [0, 1], outputRange: [0, elite ? 0.5 : 0.32] }),
    transform: [
      { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
    ],
  };
  const medalStyle = {
    opacity: pop,
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  };
  const textStyle = {
    opacity: pop,
    transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.root} onPress={onClose}>
        <Animated.Text style={[styles.banner, { color: accent, textShadowColor: accent }, textStyle]}>
          SEVİYE ATLADIN!
        </Animated.Text>

        <View style={styles.medalWrap}>
          {/* Dönen ışın halkası */}
          <Animated.View
            style={[
              styles.rays,
              {
                width: medalSize * 2,
                height: medalSize * 2,
                borderRadius: medalSize,
                borderColor: withAlpha(accent, 0.6),
              },
              rayStyle,
            ]}
          />
          <Animated.View
            style={[
              styles.medal,
              {
                width: medalSize,
                height: medalSize,
                borderRadius: medalSize / 2,
                borderColor: accent,
                backgroundColor: withAlpha(accent, 0.18),
                boxShadow: `0 0 ${elite ? 40 : 26}px ${withAlpha(accent, elite ? 0.8 : 0.55)}`,
              },
              medalStyle,
            ]}>
            <Feather name="award" size={elite ? 44 : 36} color={accent} />
            <Text style={[styles.medalLevel, { color: accent }]}>{level}</Text>
          </Animated.View>
        </View>

        <Animated.View style={[styles.info, textStyle]}>
          <Text style={styles.levelLine}>SEVİYE {level}</Text>
          <Text style={[styles.titleLine, { color: accent, textShadowColor: withAlpha(accent, 0.7) }]}>
            {levelTitle(level)}
          </Text>
        </Animated.View>

        <Animated.View style={textStyle}>
          <Pressable
            onPress={onClose}
            style={[styles.cta, { borderColor: withAlpha(accent, 0.5), backgroundColor: withAlpha(accent, 0.18) }]}>
            <Text style={[styles.ctaText, { color: colors.ice }]}>Devam</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 32,
    backgroundColor: 'rgba(5,8,15,0.86)',
  },
  banner: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 4,
    fontFamily: mono,
    textShadowRadius: 16,
  },
  medalWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  rays: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  medal: {
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  medalLevel: {
    fontSize: 18,
    fontWeight: '800',
    fontFamily: mono,
  },
  info: {
    alignItems: 'center',
    gap: 6,
  },
  levelLine: {
    fontSize: 12,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
  },
  titleLine: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: mono,
    textShadowRadius: 18,
  },
  cta: {
    paddingVertical: 13,
    paddingHorizontal: 40,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: mono,
  },
});
