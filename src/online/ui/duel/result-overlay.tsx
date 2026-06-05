import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from '@/ui/theme';

const EMOJIS = ['😎', '😂', '🔥', '🤯', '😭', '👏'];
const spaced = (s: string | null) => (s ? s.split('').join(' ') : '—');

/** Kazan/kaybet ekranı: verdict (popIn) + iki gizli sayı ifşası + emoji + CTA. */
export function ResultOverlay({
  win,
  mySecret,
  theirSecret,
  onMenu,
}: {
  win: boolean;
  mySecret: string | null;
  theirSecret: string | null;
  onMenu: () => void;
}) {
  const v = useRef(new Animated.Value(0)).current;
  // TODO(ileri adım): emoji'yi ağ üzerinden rakibe gönder; şimdilik yerel reaksiyon.
  const [tapped, setTapped] = useState<string | null>(null);

  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }).start();
  }, [v]);

  const accent = win ? colors.cyan : colors.danger;
  const enter = { opacity: v };
  const pop = {
    opacity: v,
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
  };

  return (
    <Animated.View style={[styles.root, enter]}>
      <View style={[styles.glow, { backgroundColor: withAlpha(accent, 0.18), boxShadow: `0 0 120px 60px ${withAlpha(accent, 0.18)}` }]} />

      <Animated.Text
        style={[
          styles.verdict,
          { color: win ? colors.ice : '#fca5a5', textShadowColor: accent },
          pop,
        ]}>
        {win ? 'KAZANDIN!' : 'KAYBETTİN'}
      </Animated.Text>
      <Text style={styles.subtitle}>{win ? 'RAKİBİN KODUNU KIRDIN' : 'RAKİP KODUNU KIRDI'}</Text>

      <View style={styles.reveal}>
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>SENİN SAYIN</Text>
          <Text style={[styles.revealNum, { color: colors.cyan, textShadowColor: colors.cyan }]}>
            {spaced(mySecret)}
          </Text>
        </View>
        <View style={styles.revealDivider} />
        <View style={styles.revealCol}>
          <Text style={styles.revealLabel}>RAKİBİN SAYISI</Text>
          <Text style={[styles.revealNum, { color: colors.amber, textShadowColor: colors.amber }]}>
            {spaced(theirSecret)}
          </Text>
        </View>
      </View>

      <View style={styles.emojiRow}>
        {EMOJIS.map((e) => (
          <Pressable
            key={e}
            onPress={() => setTapped(e)}
            style={[styles.emoji, tapped === e && styles.emojiActive]}>
            <Text style={styles.emojiText}>{e}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={onMenu}
        style={[
          styles.cta,
          win
            ? { backgroundColor: withAlpha(colors.cyan, 0.24), borderColor: withAlpha(colors.cyan, 0.47), boxShadow: `0 0 18px ${withAlpha(colors.cyan, 0.3)}` }
            : { backgroundColor: colors.glass, borderColor: colors.glassBorder },
        ]}>
        <Feather name="home" size={14} color={win ? colors.ice : colors.text} />
        <Text style={[styles.ctaText, { color: win ? colors.ice : colors.text }]}>Ana Menü</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(6,12,26,0.92)',
  },
  glow: {
    position: 'absolute',
    top: '32%',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  verdict: {
    fontSize: 44,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 28,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 10,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 2,
    marginBottom: 32,
  },
  reveal: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  revealCol: {
    alignItems: 'center',
    flex: 1,
  },
  revealLabel: {
    fontSize: 8,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    marginBottom: 6,
  },
  revealNum: {
    fontSize: 34,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 3,
    textShadowRadius: 14,
  },
  revealDivider: {
    width: 1,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  emojiRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 32,
  },
  emoji: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderColor: 'rgba(255,255,255,0.28)',
    transform: [{ scale: 1.18 }],
  },
  emojiText: {
    fontSize: 18,
  },
  cta: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  ctaText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 2,
  },
});
