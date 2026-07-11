import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from '@/ui/theme';

import type { MatchState } from '../../types';
import { useLiveClocks } from '../../useLiveClocks';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Kompakt satranç saati: aktifken vurgu renginde parlar, ≤10 sn'de kırmızı + nabız. */
function ChipClock({ ms, active, accent }: { ms: number; active: boolean; accent: string }) {
  const isLow = ms <= 10_000;
  const urgent = active && isLow;
  const clockColor = urgent ? colors.danger : active ? accent : colors.dim;

  // urgentPulse @keyframes → glow opacity nabzı (native driver).
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!urgent) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [urgent, pulse]);
  const glowOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] });

  return (
    <View
      style={[
        styles.clock,
        {
          borderColor: active ? withAlpha(clockColor, 0.5) : withAlpha('#ffffff', 0.08),
          backgroundColor: active ? withAlpha(clockColor, 0.12) : 'rgba(255,255,255,0.03)',
        },
      ]}>
      {urgent ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            styles.urgentGlow,
            { opacity: glowOpacity, boxShadow: `0 0 22px ${withAlpha(colors.danger, 0.6)}` },
          ]}
        />
      ) : null}
      <Text
        style={[
          styles.clockText,
          { color: clockColor, textShadowColor: active ? clockColor : 'transparent' },
        ]}>
        {fmt(ms)}
      </Text>
    </View>
  );
}

/** Kompakt oyuncu çipi: avatar + ad + satranç saati.
 *  stack=false → tek satır (üst barda rakip); stack=true → dikey cam kapsül
 *  (tuş takımının yanında kendi saatin). Sırası olmayan taraf sönük. */
export function PlayerChip({
  initial,
  name,
  ms,
  active,
  accent,
  stack = false,
}: {
  initial: string;
  name: string;
  ms: number;
  active: boolean;
  accent: string;
  stack?: boolean;
}) {
  const idRow = (
    <View style={styles.idRow}>
      <View
        style={[
          styles.avatar,
          {
            borderColor: active ? accent : withAlpha('#ffffff', 0.12),
            backgroundColor: withAlpha(accent, active ? 0.2 : 0.06),
            boxShadow: active ? `0 0 10px ${withAlpha(accent, 0.4)}` : undefined,
          },
        ]}>
        <Text style={[styles.avatarText, { color: active ? accent : colors.dim }]}>
          {(initial || '?').toUpperCase()}
        </Text>
      </View>
      <Text style={[styles.name, { color: active ? colors.text : colors.dim }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );

  if (stack) {
    return (
      <View style={[styles.stackRoot, { opacity: active ? 1 : 0.42 }]}>
        {idRow}
        <ChipClock ms={ms} active={active} accent={accent} />
      </View>
    );
  }
  return (
    <View style={[styles.rowRoot, { opacity: active ? 1 : 0.42 }]}>
      {idRow}
      <ChipClock ms={ms} active={active} accent={accent} />
    </View>
  );
}

/** Kendi içinde tikleyen oyuncu çipi: saatin 250 ms tiki YALNIZ bu çipi yeniler,
 *  koca düello ekranını değil. self=true → benim tarafım, false → rakip.
 *  ms/active değerleri match'ten türetilir (useLiveClocks görsel geri sayım). */
export function LivePlayerChip({
  match,
  self,
  name,
  accent,
  stack = false,
}: {
  match: MatchState;
  self: boolean;
  name: string;
  accent: string;
  stack?: boolean;
}) {
  const clocks = useLiveClocks(match);
  const iAmP1 = match.myRole === 'player1';
  const myMs = iAmP1 ? clocks.clock1Ms : clocks.clock2Ms;
  const oppMs = iAmP1 ? clocks.clock2Ms : clocks.clock1Ms;
  const myId = iAmP1 ? match.player1.id : match.player2?.id ?? '';
  const oppId = iAmP1 ? match.player2?.id ?? '' : match.player1.id;
  const sideId = self ? myId : oppId;
  const active = match.status === 'active' && !!match.currentTurn && match.currentTurn === sideId;
  return (
    <PlayerChip
      stack={stack}
      initial={name.charAt(0)}
      name={name}
      ms={self ? myMs : oppMs}
      active={active}
      accent={accent}
    />
  );
}

const styles = StyleSheet.create({
  rowRoot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  stackRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  idRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    minWidth: 0,
  },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  name: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.5,
    flexShrink: 1,
    maxWidth: 96,
  },
  clock: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    overflow: 'hidden',
  },
  urgentGlow: {
    borderRadius: 10,
  },
  clockText: {
    fontSize: 17,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1,
    textShadowRadius: 10,
  },
});
