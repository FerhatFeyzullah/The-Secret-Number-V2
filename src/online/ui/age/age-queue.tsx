import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import type { AgePlayer } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';

const DISPLAY = 'Comfortaa-SemiBold';
const SOFT = 'Comfortaa';

/** Dönen kuşatma mührü (matchmaking göstergesi — artifact stili). */
function SiegeSeal({ count }: { count: number }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 26000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.seal}>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width="100%" height="100%" viewBox="0 0 214 214">
          <Circle cx={107} cy={107} r={98} fill="none" stroke="rgba(208,138,82,0.5)" strokeWidth={1.5} strokeDasharray="2 8" />
          <Circle cx={107} cy={107} r={90} fill="none" stroke="rgba(255,200,87,0.28)" strokeWidth={6} strokeDasharray="1 15" strokeLinecap="round" />
        </Svg>
      </Animated.View>
      <Svg width="100%" height="100%" viewBox="0 0 214 214" style={StyleSheet.absoluteFill}>
        <Circle cx={107} cy={107} r={74} fill="none" stroke="rgba(47,168,224,0.35)" strokeWidth={1} strokeDasharray="10 6" />
        <Circle cx={107} cy={107} r={66} fill="rgba(9,17,35,0.55)" stroke="rgba(214,244,255,0.10)" strokeWidth={1} />
      </Svg>
      <View style={styles.sealCenter}>
        <Text style={styles.count}>
          {count}
          <Text style={styles.of}>/3</Text>
        </Text>
        <Text style={styles.sealLabel}>SAVAŞÇI{'\n'}TOPLANIYOR</Text>
      </View>
    </View>
  );
}

/** Gizem Çağı bekleme ekranı: dönen mühür + 3 hükümdar sancağı (artifact stili). */
export function AgeQueue({ players, onCancel }: { players: AgePlayer[]; onCancel: () => void }) {
  const count = players.length;
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.kicker}>İLK ÇAĞLARIN KUŞATMASI</Text>
        <Text style={styles.title}>GİZEM ÇAĞI</Text>
        <Text style={styles.tag}>Üç hükümdar, tek zafer.</Text>
      </View>

      <SiegeSeal count={count} />

      <View style={styles.banners}>
        {[0, 1, 2].map((i) => {
          const p = players[i];
          return (
            <View key={i} style={[styles.banner, p ? styles.bannerFilled : styles.bannerEmpty]}>
              <View style={[styles.sigil, p ? styles.sigilFilled : null]}>
                <Text style={[styles.sigilText, p ? styles.sigilTextFilled : null]}>
                  {p ? (p.username?.charAt(0) || '?').toLocaleUpperCase('tr') : '?'}
                </Text>
              </View>
              <Text style={styles.bname} numberOfLines={1}>{p ? p.username ?? 'Oyuncu' : 'Meçhul'}</Text>
              <Text style={[styles.chip, p ? styles.chipFilled : null]}>{p ? 'Katıldı' : 'bekleniyor'}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.lore}>Kuleler sayı, kaleler kelime ile korunur. Üç savaşçı toplanınca harita açılır.</Text>

      <Pressable onPress={onCancel} style={styles.cancel}>
        <Feather name="x" size={15} color={colors.danger} />
        <Text style={styles.cancelText}>Vazgeç</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20, paddingHorizontal: 24 },
  head: { alignItems: 'center', gap: 8 },
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 4, color: colors.amber },
  title: {
    fontFamily: DISPLAY, fontSize: 34, letterSpacing: 3, color: colors.ice,
    textShadowColor: colors.violet, textShadowRadius: 18,
  },
  tag: { fontFamily: SOFT, fontSize: 13, color: '#e8d5a8', letterSpacing: 1 },
  seal: { width: 214, height: 214, alignItems: 'center', justifyContent: 'center' },
  sealCenter: { alignItems: 'center', gap: 4, width: 120 },
  count: { fontFamily: mono, fontSize: 42, fontWeight: '900', color: colors.ice, fontVariant: ['tabular-nums'] },
  of: { fontSize: 20, color: colors.dim },
  sealLabel: { fontFamily: mono, fontSize: 9, letterSpacing: 1.5, color: colors.amber, textAlign: 'center', lineHeight: 13 },
  banners: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  banner: {
    flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1, minHeight: 138, justifyContent: 'center',
  },
  bannerEmpty: { borderStyle: 'dashed', borderColor: withAlpha(colors.ice, 0.18), backgroundColor: colors.glass },
  bannerFilled: { borderColor: colors.violet, backgroundColor: withAlpha(colors.violet, 0.1) },
  sigil: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: withAlpha(colors.ice, 0.2),
  },
  sigilFilled: { borderColor: colors.violet, backgroundColor: withAlpha(colors.violet, 0.18) },
  sigilText: { fontFamily: DISPLAY, fontSize: 20, color: colors.dim },
  sigilTextFilled: { color: colors.ice },
  bname: { fontFamily: SOFT, fontSize: 13, fontWeight: '700', color: colors.text },
  chip: { fontFamily: mono, fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', color: colors.dim },
  chipFilled: { color: colors.violet },
  lore: { textAlign: 'center', color: colors.dim, fontSize: 12.5, lineHeight: 18, maxWidth: 300, fontFamily: SOFT },
  cancel: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 26,
    borderRadius: 12, borderWidth: 1, borderColor: withAlpha(colors.danger, 0.4),
    backgroundColor: withAlpha(colors.danger, 0.1),
  },
  cancelText: { color: colors.danger, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
});
