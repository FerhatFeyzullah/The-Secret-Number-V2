import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { getSignal } from '@/signals/catalog';
import { colors, mono, withAlpha } from '@/ui/theme';

/* ── Göz rozeti ─────────────────────────────────────────────────────────────
 * "Kaç kişi izliyor" — YALNIZ izlenen oyuncunun (ve tribündeki seyircilerin)
 * ekranında görünür. Rakip bu rozeti görmez (kendi perspektifi hedef değildir).
 * Tezahürat akışı bu rozetin altından doğar → kaynağı söze gerek kalmadan belli.
 */
export function TribuneBadge({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  // Sayı değişince kısa bir nabız (biri katıldı/ayrıldı hissi).
  useEffect(() => {
    if (count <= 0) return;
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [count, pulse]);

  if (count <= 0) return null;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  return (
    <Animated.View style={[styles.badge, { transform: [{ scale }] }]}>
      <Feather name="eye" size={12} color={colors.violet} />
      <Text style={styles.badgeText}>{count}</Text>
    </Animated.View>
  );
}

/* ── Tezahürat akışı ────────────────────────────────────────────────────────
 * Rakibin tek büyük baloncuğundan (IncomingReaction) TAMAMEN ayrı bir kanal:
 * küçük (26px), çoklu, aşağıdan yukarı süzülen, hafif savrulan emojiler.
 * pointerEvents="none" → oyunu/ekranı hiç engellemez.
 */
const RISE_MS = 2200;
const RISE_PX = 150;
/** Aynı anda ekranda duran en fazla emoji (spam koruması). */
const MAX_LIVE = 8;

type Floater = { key: number; id: string; drift: number; anim: Animated.Value };

export function CheerStream({ cheer }: { cheer: { id: string; nonce: number } | null }) {
  const [items, setItems] = useState<Floater[]>([]);
  const keyRef = useRef(0);

  useEffect(() => {
    if (!cheer) return;
    keyRef.current += 1;
    const key = keyRef.current;
    const anim = new Animated.Value(0);
    // Savrulma: -22..+22 px, her emoji farklı → sütun gibi durmaz.
    const drift = Math.round((Math.random() - 0.5) * 44);
    setItems((prev) => [...prev, { key, id: cheer.id, drift, anim }].slice(-MAX_LIVE));
    Animated.timing(anim, {
      toValue: 1,
      duration: RISE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setItems((prev) => prev.filter((it) => it.key !== key));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheer?.nonce]);

  if (!items.length) return null;
  return (
    <View style={styles.streamWrap} pointerEvents="none">
      {items.map((it) => {
        const sig = getSignal(it.id);
        if (!sig) return null;
        const Icon = sig.component;
        return (
          <Animated.View
            key={it.key}
            style={[
              styles.floater,
              {
                opacity: it.anim.interpolate({
                  inputRange: [0, 0.15, 0.7, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateY: it.anim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -RISE_PX],
                    }),
                  },
                  {
                    translateX: it.anim.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0, it.drift, it.drift * 0.4],
                    }),
                  },
                  {
                    scale: it.anim.interpolate({
                      inputRange: [0, 0.2, 1],
                      outputRange: [0.6, 1, 0.85],
                    }),
                  },
                ],
              },
            ]}>
            <Icon size={26} animated={false} />
          </Animated.View>
        );
      })}
    </View>
  );
}

/* ── Tezahürat barı (yalnız seyircide) ──────────────────────────────────────
 * Sinyal destesinden tek dokunuşla gönderim (tepsi/modal yok — seyircinin
 * yapacak başka işi yok). Maç-içi EmoteBar ile aynı cooldown mantığı.
 */
const COOLDOWN_MS = 2500;

export function CheerBar({
  deck,
  onCheer,
}: {
  /** Seyircinin kendi sinyal destesi (≤6, sahip oldukları). */
  deck: string[];
  onCheer: (signalId: string) => void;
}) {
  const [cooling, setCooling] = useState(false);
  const coolRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (coolRef.current != null) clearTimeout(coolRef.current);
    },
    [],
  );

  const fire = useCallback(
    (id: string) => {
      if (coolRef.current != null) return;
      onCheer(id);
      setCooling(true);
      coolRef.current = setTimeout(() => {
        coolRef.current = null;
        setCooling(false);
      }, COOLDOWN_MS);
    },
    [onCheer],
  );

  if (!deck.length) return null;
  return (
    <View style={[styles.bar, cooling && styles.barCooling]}>
      {deck.map((id) => {
        const sig = getSignal(id);
        if (!sig) return null;
        const Icon = sig.component;
        return (
          <Pressable
            key={id}
            onPress={() => fire(id)}
            disabled={cooling}
            accessibilityLabel={`${sig.name} gönder`}
            style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
            <Icon size={30} animated={false} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.violet, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.4),
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.violet,
    fontFamily: mono,
  },
  // Akış: rozetin hizasından (sağ üst bölge) başlayıp yukarı süzülür. Rakip
  // baloncuğu (belowRight / kart ortası) ile çakışmaması için sağ-alt bant.
  streamWrap: {
    position: 'absolute',
    right: 10,
    bottom: 90,
    width: 90,
    height: RISE_PX + 40,
    zIndex: 40,
  },
  floater: {
    position: 'absolute',
    bottom: 0,
    right: 18,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: withAlpha(colors.violet, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.3),
  },
  barCooling: { opacity: 0.5 },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  cellPressed: { backgroundColor: 'rgba(255,255,255,0.08)' },
});
