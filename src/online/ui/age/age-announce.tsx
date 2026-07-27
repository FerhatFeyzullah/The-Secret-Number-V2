import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { AgePhase } from '@/online';
import { colors, display, withAlpha } from '@/ui/theme';
import { AGE, palette } from './age-colors';
import { AgeFlag, AgeSiege } from './age-icons';

type Cfg = { kicker: string; title: string; sub: string; color: string; kind: 'prep' | 'war' };
const CFG: Partial<Record<AgePhase, Cfg>> = {
  prep: {
    kicker: 'FAZ 1',
    title: 'HAZIRLIK BAŞLADI',
    sub: 'Boş bölgeleri fethet, topraklarını genişlet.',
    color: AGE.prep,
    kind: 'prep',
  },
  war: {
    kicker: 'FAZ 2',
    title: 'SAVAŞ BAŞLADI!',
    sub: 'Rakiplerin topraklarına saldır, kaleni savun.',
    color: AGE.red,
    kind: 'war',
  },
};

const BANNER_W = 300;
const BANNER_H = 104;

/** Kurdele şerit zemini — iki yanda kırlangıç kuyruklu bayrak, üstte açık ton
 *  bandı (ışık), altta koyu gölge. Tek renk parametresinden türetilir. */
function Ribbon({ color }: { color: string }) {
  const p = palette(color);
  return (
    <Svg width={BANNER_W} height={BANNER_H} viewBox={`0 0 ${BANNER_W} ${BANNER_H}`} style={StyleSheet.absoluteFill}>
      {/* yan kuyruklar (gövdenin arkasında, biraz aşağıda) */}
      <Path d={`M4 26 L54 26 L54 86 L4 86 L20 56 Z`} fill={p.deep} />
      <Path d={`M${BANNER_W - 4} 26 L${BANNER_W - 54} 26 L${BANNER_W - 54} 86 L${BANNER_W - 4} 86 L${BANNER_W - 20} 56 Z`} fill={p.deep} />
      {/* ana gövde */}
      <Path d={`M22 14 L${BANNER_W - 22} 14 L${BANNER_W - 22} 92 L22 92 Z`} fill="#0b1428" />
      <Path d={`M22 14 L${BANNER_W - 22} 14 L${BANNER_W - 22} 21 L22 21 Z`} fill={p.body} />
      <Path d={`M22 85 L${BANNER_W - 22} 85 L${BANNER_W - 22} 92 L22 92 Z`} fill={p.shade} />
      {/* kenar çizgileri */}
      <Path
        d={`M22 14 L${BANNER_W - 22} 14 L${BANNER_W - 22} 92 L22 92 Z`}
        fill="none"
        stroke={p.body}
        strokeWidth={2}
        opacity={0.85}
      />
    </Svg>
  );
}

/** Faz değişince (hazırlık/savaş) ekranın ortasına oturan kurdele duyurusu:
 *  yaylanarak girer → üzerinden ışık süpürmesi geçer → ~1.6 sn sonra yukarı
 *  süzülüp kaybolur. Savaşta ek olarak kısa ekran sarsıntısı.
 *  pointerEvents yok → altındaki harita tıklanır. */
export function AgePhaseAnnounce({ phase }: { phase: AgePhase }) {
  const anim = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
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

  // Giriş → bekle → çıkış; paralelde ışık süpürmesi ve (savaşsa) sarsıntı.
  useEffect(() => {
    if (!shown) return;
    anim.setValue(0);
    shine.setValue(0);
    shake.setValue(0);

    const main = Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 420, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }),
      Animated.delay(1400),
      Animated.timing(anim, { toValue: 2, duration: 360, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]);
    const sweep = Animated.sequence([
      Animated.delay(380),
      Animated.timing(shine, { toValue: 1, duration: 640, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]);
    const quake =
      shown.cfg.kind === 'war'
        ? Animated.sequence([
            Animated.delay(380),
            ...[6, -5, 4, -3, 2, 0].map((to) =>
              Animated.timing(shake, { toValue: to, duration: 48, easing: Easing.linear, useNativeDriver: true }),
            ),
          ])
        : null;

    const all = Animated.parallel([main, sweep, ...(quake ? [quake] : [])]);
    all.start(({ finished }) => {
      if (finished) setShown(null);
    });
    return () => all.stop();
  }, [shown, anim, shine, shake]);

  if (!shown) return null;
  const { cfg } = shown;
  const p = palette(cfg.color);

  const translateY = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [64, 0, -40] });
  const opacity = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] });
  const scale = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0.8, 1, 1] });
  const dim = anim.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 0.35, 0] });
  const shineX = shine.interpolate({ inputRange: [0, 1], outputRange: [-BANNER_W * 0.7, BANNER_W * 0.9] });

  return (
    <View pointerEvents="none" style={styles.overlay}>
      {/* haritayı hafifçe karart (tamamen kapatma — oyun görünür kalsın) */}
      <Animated.View style={[styles.dim, { opacity: dim, backgroundColor: cfg.kind === 'war' ? '#2a0709' : '#060c1a' }]} />

      <Animated.View style={{ transform: [{ translateY }, { translateX: shake }, { scale }], opacity }}>
        <View style={styles.banner}>
          <Ribbon color={cfg.color} />

          <View style={styles.content}>
            <View style={[styles.iconRing, { borderColor: withAlpha(cfg.color, 0.75), backgroundColor: withAlpha(cfg.color, 0.18) }]}>
              {cfg.kind === 'war' ? <AgeSiege size={19} color={p.light} /> : <AgeFlag size={18} color={p.light} />}
            </View>
            <View style={styles.texts}>
              <Text style={[styles.kicker, { color: p.light }]}>{cfg.kicker}</Text>
              <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit>
                {cfg.title}
              </Text>
            </View>
          </View>

          {/* ışık süpürmesi */}
          <Animated.View
            pointerEvents="none"
            style={[styles.shine, { transform: [{ translateX: shineX }, { rotate: '18deg' }] }]}
          />
        </View>

        {/* alt yazı kendi koyu şeridinde — altındaki harita ne olursa olsun okunur */}
        <View style={styles.subWrap}>
          <Text style={styles.sub}>{cfg.sub}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', zIndex: 300 },
  dim: { ...StyleSheet.absoluteFillObject },
  banner: { width: BANNER_W, height: BANNER_H, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 34 },
  iconRing: { width: 38, height: 38, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  texts: { flexShrink: 1 },
  kicker: { fontFamily: display, fontSize: 10, letterSpacing: 2.6, lineHeight: 13 },
  title: { fontFamily: display, fontSize: 22, letterSpacing: 0.6, color: colors.ice, lineHeight: 27 },
  shine: { position: 'absolute', top: -30, bottom: -30, width: 46, backgroundColor: 'rgba(255,255,255,0.16)' },
  subWrap: {
    alignSelf: 'center', marginTop: 10, maxWidth: 286, paddingVertical: 7, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: 'rgba(6,12,26,0.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  sub: { fontFamily: 'Comfortaa', fontSize: 12.5, color: colors.text, textAlign: 'center', lineHeight: 18 },
});
