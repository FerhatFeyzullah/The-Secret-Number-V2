import { Feather } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import type { AgePhase } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';
import { AGE } from './age-colors';

type Cfg = { kicker: string; title: string; sub: string; color: string; icon: React.ComponentProps<typeof Feather>['name'] };
const CFG: Partial<Record<AgePhase, Cfg>> = {
  prep: { kicker: 'FAZ', title: 'HAZIRLIK BAŞLADI', sub: 'Boş bölgeleri fethet, topraklarını genişlet.', color: '#d08a52', icon: 'flag' },
  war: { kicker: 'FAZ', title: 'SAVAŞ BAŞLADI', sub: 'Rakiplerin topraklarına saldır, kaleni savun.', color: AGE.red, icon: 'zap' },
};

/** Faz değişince (hazırlık/savaş) ekranın ortasına kayıp gelen, ~1.6 sn sonra
 *  yukarı süzülüp kaybolan duyuru. pointerEvents yok → altındaki harita tıklanır. */
export function AgePhaseAnnounce({ phase }: { phase: AgePhase }) {
  const anim = useRef(new Animated.Value(0)).current;
  const prevRef = useRef<AgePhase | null>(null);
  const keyRef = useRef(0);
  const [shown, setShown] = useState<{ key: number; cfg: Cfg } | null>(null);

  // Faz değişimini yakala (ilk mount dahil: prev=null → duyur).
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = phase;
    const cfg = CFG[phase];
    if (!cfg || prev === phase) return;
    keyRef.current += 1;
    setShown({ key: keyRef.current, cfg });
  }, [phase]);

  // Kayan animasyon (aşağıdan ortaya → bekle → yukarı süzül).
  useEffect(() => {
    if (!shown) return;
    anim.setValue(0);
    const seq = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(anim, { toValue: 2, duration: 360, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]);
    seq.start(({ finished }) => {
      if (finished) setShown(null);
    });
    return () => seq.stop();
  }, [shown, anim]);

  if (!shown) return null;
  const { cfg } = shown;
  const translateY = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [70, 0, -34] });
  const opacity = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const scale = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.86, 1, 1] });

  return (
    <View pointerEvents="none" style={styles.overlay}>
      <Animated.View
        style={[
          styles.card,
          { borderColor: withAlpha(cfg.color, 0.65), transform: [{ translateY }, { scale }], opacity },
        ]}>
        <View style={[styles.iconRing, { borderColor: withAlpha(cfg.color, 0.6), backgroundColor: withAlpha(cfg.color, 0.15) }]}>
          <Feather name={cfg.icon} size={22} color={cfg.color} />
        </View>
        <Text style={[styles.kicker, { color: cfg.color }]}>{cfg.kicker}</Text>
        <Text style={styles.title}>{cfg.title}</Text>
        <Text style={styles.sub}>{cfg.sub}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  card: {
    alignItems: 'center', gap: 6, maxWidth: 320, paddingVertical: 20, paddingHorizontal: 26,
    borderRadius: 20, borderWidth: 1.5, backgroundColor: 'rgba(9,16,32,0.96)',
    boxShadow: '0 20px 50px rgba(0,0,0,0.6)',
  },
  iconRing: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, marginBottom: 2,
  },
  kicker: { fontFamily: mono, fontSize: 10, letterSpacing: 4, fontWeight: '800' },
  title: { fontFamily: mono, fontSize: 20, fontWeight: '900', letterSpacing: 2, color: colors.ice, textAlign: 'center' },
  sub: { fontFamily: 'Comfortaa', fontSize: 12.5, color: colors.dim, textAlign: 'center', lineHeight: 18, maxWidth: 260 },
});
