import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from '@/ui/theme';

import type { FeatherName } from '../parts';

/** Üst-orta, kısa süreli, kendiliğinden kaybolan protokol bildirimi. */
export type DuelNotice = {
  id: number;
  text: string;
  /** Kategori/olay vurgu rengi (ikon + kenar). */
  accent?: string;
  icon?: FeatherName;
};

const SHOW_MS = 2500;
const IN_MS = 200;
const OUT_MS = 200;

/** Camsı/neon, üstte beliren tek bir bildirim kartı (kuyruğun başını gösterir).
 *  Gösterim süresi dolunca onDone(id) ile sıradakine geçilir. pointerEvents yok
 *  → oyun alanını/tuş takımını engellemez. */
export function ProtocolNotice({
  notice,
  onDone,
}: {
  notice: DuelNotice | null;
  onDone: (id: number) => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const id = notice?.id;

  useEffect(() => {
    if (!notice) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: IN_MS, useNativeDriver: true }).start();
    const t = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: OUT_MS, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) onDone(notice.id);
        },
      );
    }, SHOW_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!notice) return null;
  const accent = notice.accent ?? colors.cyan;
  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] });

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        style={[
          styles.card,
          {
            borderColor: withAlpha(accent, 0.5),
            boxShadow: `0 0 18px ${withAlpha(accent, 0.28)}`,
            opacity: anim,
            transform: [{ translateY }],
          },
        ]}>
        <View
          style={[
            styles.iconWrap,
            { borderColor: withAlpha(accent, 0.5), backgroundColor: withAlpha(accent, 0.16) },
          ]}>
          <Feather name={notice.icon ?? 'zap'} size={13} color={accent} />
        </View>
        <Text style={styles.text} numberOfLines={2}>
          {notice.text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 44,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 30,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: 330,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: 'rgba(8,15,30,0.92)',
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flexShrink: 1,
    color: colors.ice,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.3,
    lineHeight: 15,
  },
});
