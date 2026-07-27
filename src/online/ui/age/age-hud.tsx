import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors, display, mono, withAlpha } from '@/ui/theme';
import { AGE, palette, tone } from './age-colors';
import { AgeCrown, AgeFlag, AgeShield, AgeSiege } from './age-icons';
import { useAgeClock } from './use-age-clock';

/** Faz süreleri (sunucu `_age_const`: prep_ms/war_ms) — YALNIZ sayaç halkasının
 *  dolu oranı için. Sunucu değeri değişirse halka eksik başlar, sayı yine doğru
 *  (oran 0..1 aralığına kırpılır) → kozmetik, kırılmaz. */
const PREP_MS = 300_000;
const WAR_MS = 600_000;

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Faz sayacı ──────────────────────────────────────────────────────────────

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;

/** Faz süresi rozeti: dairesel geri sayım halkası + MM:SS. Saat sayacı BURADA
 *  yaşar → tik geldiğinde yalnız bu minik bileşen yeniden çizilir; ağır harita
 *  (20 düğüm + SVG çizgiler) her yarım saniye yeniden render OLMAZ. */
export function PhaseTimer({
  phase,
  deadline,
  active,
}: {
  phase: 'prep' | 'war' | 'coach';
  deadline: string | null;
  active: boolean;
}) {
  const now = useAgeClock(active);
  const remaining = deadline ? Math.max(0, Date.parse(deadline) - now) : 0;
  const total = phase === 'prep' ? PREP_MS : WAR_MS;
  const frac = phase === 'coach' ? 1 : Math.max(0, Math.min(1, remaining / total));
  const urgent = phase !== 'coach' && remaining <= 10_000 && remaining > 0;

  const accent = urgent ? AGE.red : phase === 'prep' ? AGE.prep : phase === 'war' ? AGE.red : colors.dim;
  const label = phase === 'prep' ? 'HAZIRLIK' : phase === 'war' ? 'SAVAŞ' : 'ÖĞRETİCİ';

  // Son 10 sn: her saniye bir "nabız" (native driver → JS'i yormaz).
  const beat = useRef(new Animated.Value(0)).current;
  const secs = Math.ceil(remaining / 1000);
  useEffect(() => {
    if (!urgent) return;
    beat.setValue(0);
    Animated.sequence([
      Animated.timing(beat, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(beat, { toValue: 0, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [secs, urgent, beat]);
  const scale = beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });

  return (
    <Animated.View
      style={[
        styles.timerBox,
        { borderColor: withAlpha(accent, urgent ? 0.85 : 0.4), backgroundColor: withAlpha(accent, urgent ? 0.16 : 0.08) },
        { transform: [{ scale }] },
      ]}>
      <View style={styles.ringWrap}>
        <Svg width={36} height={36} viewBox="0 0 36 36">
          <Circle cx={18} cy={18} r={RING_R} stroke="rgba(255,255,255,0.09)" strokeWidth={3.4} fill="none" />
          <Circle
            cx={18}
            cy={18}
            r={RING_R}
            stroke={accent}
            strokeWidth={3.4}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${RING_C} ${RING_C}`}
            strokeDashoffset={RING_C * (1 - frac)}
            transform="rotate(-90 18 18)"
          />
        </Svg>
        <View style={styles.ringIcon}>
          {phase === 'war' ? <AgeSiege size={16} color={accent} /> : <AgeFlag size={17} color={accent} />}
        </View>
      </View>
      <View>
        <Text style={[styles.timerLabel, { color: accent }]}>{label}</Text>
        <Text style={[styles.timerTime, urgent && { color: '#ffd2d2' }]}>
          {phase === 'coach' ? '—' : fmt(remaining)}
        </Text>
      </View>
    </Animated.View>
  );
}

// ── Sefer Verisi çipi ───────────────────────────────────────────────────────

export function VeriChip({ value }: { value: number }) {
  const pop = usePop(value);
  return (
    <Animated.View style={[styles.veriChip, { transform: [{ scale: pop.scale }] }]}>
      <Svg width={14} height={14} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={9} fill={withAlpha(colors.teal, 0.25)} />
        <Circle cx={12} cy={12} r={4.6} fill={colors.teal} />
      </Svg>
      <Text style={styles.veriText}>{value}</Text>
    </Animated.View>
  );
}

// ── Oyuncu kartları ─────────────────────────────────────────────────────────

export type HudPlayer = {
  id: string;
  name: string;
  color: string;
  points: number;
  /** Toplam puanın yüzdesi (hakimiyet çubuğu). */ share: number;
  isMe: boolean;
  isLeader: boolean;
  eliminated: boolean;
};

export const PlayerCards = memo(function PlayerCards({ players }: { players: HudPlayer[] }) {
  return (
    <View style={styles.cards}>
      {players.map((p) => (
        <PlayerCard key={p.id} p={p} />
      ))}
    </View>
  );
});

function PlayerCard({ p }: { p: HudPlayer }) {
  const pal = palette(p.color);
  const pop = usePop(p.points);
  return (
    <View
      style={[
        styles.card,
        { borderColor: withAlpha(p.color, p.isMe ? 0.9 : 0.34), backgroundColor: withAlpha(p.color, p.isMe ? 0.16 : 0.07) },
        p.isMe && styles.cardMe,
        p.eliminated && styles.cardOut,
      ]}>
      {p.isMe ? (
        <View style={[styles.youBadge, { backgroundColor: p.color }]}>
          <Text style={styles.youText}>SEN</Text>
        </View>
      ) : null}

      <View style={styles.cardTop}>
        <View style={[styles.pennant, { backgroundColor: p.color, borderColor: pal.light }]} />
        <Text style={[styles.cardName, p.isMe && { color: pal.light }]} numberOfLines={1}>
          {p.name}
        </Text>
        {p.isLeader && !p.eliminated ? <AgeCrown size={17} /> : null}
      </View>

      <View style={styles.cardBottom}>
        <Text style={styles.cardKicker}>PUAN</Text>
        <Animated.Text style={[styles.cardScore, { transform: [{ scale: pop.scale }] }]}>
          {p.eliminated ? '✕' : p.points}
        </Animated.Text>
      </View>

      <View style={styles.shareTrack}>
        <View style={[styles.shareFill, { width: `${Math.round(p.share * 100)}%`, backgroundColor: p.color }]} />
      </View>

      {pop.delta ? (
        <Animated.Text
          style={[
            styles.delta,
            { color: pop.delta > 0 ? AGE.green : AGE.red, opacity: pop.floatOpacity, transform: [{ translateY: pop.floatY }] },
          ]}>
          {pop.delta > 0 ? `+${pop.delta}` : pop.delta}
        </Animated.Text>
      ) : null}
    </View>
  );
}

/** Sayı değişince: kısa "pop" (ölçek) + yukarı süzülen ±fark etiketi. */
function usePop(value: number) {
  const scale = useRef(new Animated.Value(1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const prev = useRef(value);
  const deltaRef = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const d = value - prev.current;
    prev.current = value;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (d === 0) return;
    deltaRef.current = d;
    float.setValue(0);
    Animated.parallel([
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.22, useNativeDriver: true, speed: 40, bounciness: 14 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }),
      ]),
      Animated.timing(float, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start(() => {
      deltaRef.current = 0;
    });
  }, [value, scale, float]);

  return {
    scale,
    delta: deltaRef.current,
    floatY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -22] }),
    floatOpacity: float.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 0] }),
  };
}

// ── Savunma alarm barı ──────────────────────────────────────────────────────

/** Kalene/kulene saldırı barı. Kale → aktif SAVUN (chunky 3B buton), kule →
 *  yalnız bildirim (İZLE). Kırmızı nabız yalnız kale saldırısında. */
export function AlarmBar({
  kind,
  guessCount,
  onPress,
}: {
  kind: 'castle' | 'tower';
  guessCount: number;
  onPress: () => void;
}) {
  const critical = kind === 'castle';
  const accent = critical ? AGE.red : colors.amber;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!critical) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [critical, pulse]);

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.95] });
  const iconScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Pressable style={styles.alarmWrap} disabled={!critical} onPress={onPress}>
      <Animated.View style={[styles.alarmGlow, { backgroundColor: accent, opacity: critical ? glow : 0.3 }]} />
      <LinearGradient
        colors={[withAlpha(accent, 0.32), 'rgba(10,18,36,0.92)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.alarm, { borderColor: withAlpha(accent, 0.75) }]}>
        <Animated.View style={[styles.alarmIcon, { borderColor: accent, transform: [{ scale: critical ? iconScale : 1 }] }]}>
          <AgeShield size={17} color={accent} />
        </Animated.View>
        <View style={styles.alarmTexts}>
          <Text style={[styles.alarmTitle, { color: tone(accent, 0.5) }]} numberOfLines={1}>
            {critical ? 'KALENE SALDIRI VAR!' : 'KULENE SALDIRI'}
          </Text>
          <Text style={styles.alarmSub} numberOfLines={1}>
            Saldırgan {guessCount} tahmin yaptı
          </Text>
        </View>
        <ChunkyButton label={critical ? 'SAVUN' : 'İZLE'} color={accent} disabled={!critical} onPress={onPress} />
      </LinearGradient>
    </Pressable>
  );
}

/** Clash tarzı 3B buton: üstü açık gradyan, altında kalın koyu kenar; basınca
 *  2 px aşağı iner ve kenar incelir (dokunsal his). */
export function ChunkyButton({
  label,
  color,
  disabled,
  onPress,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const pal = palette(color);
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6}>
      {({ pressed }) => (
        <View
          style={[
            styles.btn,
            { borderBottomColor: pal.deep, borderBottomWidth: pressed ? 1 : 3, transform: [{ translateY: pressed ? 2 : 0 }] },
            disabled && { opacity: 0.55 },
          ]}>
          <LinearGradient colors={[pal.light, pal.shade]} style={styles.btnFill}>
            <Text style={styles.btnText}>{label}</Text>
          </LinearGradient>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // sayaç
  timerBox: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 5, paddingHorizontal: 9,
    borderRadius: 16, borderWidth: 1.5,
  },
  ringWrap: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  ringIcon: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  timerLabel: { fontFamily: display, fontSize: 9.5, letterSpacing: 1.6, lineHeight: 12 },
  timerTime: { fontFamily: mono, fontSize: 17, fontWeight: '800', color: colors.ice, lineHeight: 20 },

  // veri
  veriChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 14, borderWidth: 1.5, borderColor: withAlpha(colors.teal, 0.45), backgroundColor: withAlpha(colors.teal, 0.12),
  },
  veriText: { fontFamily: mono, fontSize: 13, fontWeight: '800', color: colors.teal },

  // oyuncu kartları
  cards: { flexDirection: 'row', gap: 6 },
  card: { flex: 1, minWidth: 0, paddingTop: 6, paddingHorizontal: 7, paddingBottom: 5, borderRadius: 13, borderWidth: 1.5, gap: 3 },
  cardMe: { boxShadow: '0 3px 12px rgba(245,196,81,0.28)' },
  cardOut: { opacity: 0.45 },
  youBadge: { position: 'absolute', top: -7, left: 8, paddingHorizontal: 5, paddingVertical: 1, borderRadius: 999, zIndex: 2 },
  youText: { fontFamily: display, fontSize: 8, letterSpacing: 0.8, color: '#0a1526' },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pennant: { width: 7, height: 11, borderRadius: 2, borderWidth: 1 },
  cardName: { flex: 1, fontFamily: display, fontSize: 12.5, color: colors.text, lineHeight: 16 },
  cardBottom: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cardKicker: { fontFamily: display, fontSize: 8.5, letterSpacing: 1, color: colors.dim },
  cardScore: { fontFamily: mono, fontSize: 14, fontWeight: '800', color: colors.ice },
  shareTrack: { height: 3.5, borderRadius: 2, backgroundColor: 'rgba(0,0,0,0.45)', overflow: 'hidden' },
  shareFill: { height: '100%', borderRadius: 2 },
  delta: { position: 'absolute', right: 8, bottom: 14, fontFamily: mono, fontSize: 12, fontWeight: '800' },

  // alarm
  alarmWrap: { marginBottom: 6 },
  alarmGlow: { position: 'absolute', left: 10, right: 10, top: 4, bottom: 4, borderRadius: 16, opacity: 0.4 },
  alarm: {
    flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 7, paddingHorizontal: 10,
    borderRadius: 15, borderWidth: 1.5,
  },
  alarmIcon: {
    width: 30, height: 30, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  alarmTexts: { flex: 1, minWidth: 0 },
  alarmTitle: { fontFamily: display, fontSize: 12.5, letterSpacing: 0.6, lineHeight: 16 },
  alarmSub: { fontFamily: 'Comfortaa', fontSize: 10, color: 'rgba(232,236,255,0.82)' },

  // chunky buton
  btn: { borderRadius: 12, overflow: 'hidden' },
  btnFill: { paddingVertical: 6, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: display, fontSize: 12, letterSpacing: 1, color: '#0a1526' },
});
