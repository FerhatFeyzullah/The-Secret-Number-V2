import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const nextDigit = (d: number) => (d % 9) + 1; // 1..9 döngü, sıfır yok
const prevDigit = (d: number) => ((d + 7) % 9) + 1;

/** Tek kasa kadranı: yukarı/aşağı ok + (bonus) dikey swipe ile 1-9 seçimi.
 *  Aktif rakam büyük+parlak, komşular soluk. Çakışmada (aynı rakam) kırmızı. */
function Dial({
  value,
  conflict,
  locked,
  onChange,
}: {
  value: number;
  conflict: boolean;
  locked: boolean;
  onChange: (next: number) => void;
}) {
  // Swipe: dikey sürüklemede tek adım değiştir (yukarı→artar, aşağı→azalır).
  // PanResponder bir kez kurulur; güncel value/locked/onChange'i ref'ten okur.
  const latest = useRef({ value, locked, onChange });
  useEffect(() => {
    latest.current = { value, locked, onChange };
  });
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => !latest.current.locked && Math.abs(g.dy) > 10,
      onPanResponderRelease: (_e, g) => {
        const { value: v, locked: lk, onChange: cb } = latest.current;
        if (lk) return;
        if (g.dy <= -16) cb(nextDigit(v));
        else if (g.dy >= 16) cb(prevDigit(v));
      },
    }),
  ).current;

  return (
    <View style={styles.dial}>
      <Pressable
        onPress={() => onChange(nextDigit(value))}
        disabled={locked}
        style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed, locked && styles.dim]}>
        <Feather name="chevron-up" size={16} color={colors.dim} />
      </Pressable>

      <View
        {...pan.panHandlers}
        style={[styles.reel, conflict ? styles.reelConflict : styles.reelOk, locked && styles.dim]}>
        <View style={styles.guideTop} />
        <View style={styles.guideBottom} />
        <Text style={styles.ghost}>{prevDigit(value)}</Text>
        <Text style={[styles.main, conflict && styles.mainConflict]}>{value}</Text>
        <Text style={styles.ghost}>{nextDigit(value)}</Text>
      </View>

      <Pressable
        onPress={() => onChange(prevDigit(value))}
        disabled={locked}
        style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed, locked && styles.dim]}>
        <Feather name="chevron-down" size={16} color={colors.dim} />
      </Pressable>
    </View>
  );
}

/** Üç kadran. Aynı rakamı taşıyan kadranlar kırmızı (çakışma). */
export function VaultDials({
  values,
  locked,
  onChange,
}: {
  values: number[];
  locked: boolean;
  onChange: (index: number, next: number) => void;
}) {
  const counts: Record<number, number> = {};
  values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));

  return (
    <View style={styles.row}>
      {values.map((v, i) => (
        <Dial
          key={i}
          value={v}
          conflict={counts[v] > 1}
          locked={locked}
          onChange={(next) => onChange(i, next)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
  },
  dial: {
    alignItems: 'center',
    gap: 6,
  },
  arrow: {
    width: 64,
    height: 30,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowPressed: {
    backgroundColor: cyanAlpha(0.12),
    borderColor: cyanAlpha(0.4),
    transform: [{ translateY: 2 }],
  },
  dim: {
    opacity: 0.4,
  },
  reel: {
    width: 64,
    height: 132,
    borderRadius: 16,
    borderWidth: 2,
    backgroundColor: cyanAlpha(0.08),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  reelOk: {
    borderColor: cyanAlpha(0.45),
    boxShadow: `0 0 18px ${cyanAlpha(0.22)}`,
  },
  reelConflict: {
    borderColor: colors.danger,
    boxShadow: `0 0 18px ${withAlpha(colors.danger, 0.4)}`,
  },
  guideTop: {
    position: 'absolute',
    top: 38,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: cyanAlpha(0.25),
  },
  guideBottom: {
    position: 'absolute',
    bottom: 38,
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: cyanAlpha(0.25),
  },
  ghost: {
    fontSize: 20,
    fontWeight: '700',
    color: withAlpha(colors.ice, 0.18),
    fontFamily: mono,
    height: 30,
    lineHeight: 30,
  },
  main: {
    fontSize: 46,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    lineHeight: 54,
    textShadowColor: colors.cyan,
    textShadowRadius: 18,
  },
  mainConflict: {
    color: '#fca5a5',
    textShadowColor: colors.danger,
  },
});
