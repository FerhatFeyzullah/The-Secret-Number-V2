import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { evaluateGuess, generateSecret, type Digit, type GuessResult } from '@/game';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle, recordLoss, recordWin } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

function feedbackFor(result: Exclude<GuessResult, { status: 'invalid' }>) {
  switch (result.status) {
    case 'partial':
      return `${result.correctCount} rakam doğru`;
    case 'digitsCorrectWrongOrder':
      return 'rakamlar doğru, yerleri yanlış';
    case 'win':
      return 'Kazandın! 🎉';
  }
}

function toneFor(feedback: string) {
  if (feedback.startsWith('Kazandın')) return colors.amber;
  if (feedback.startsWith('rakamlar doğru')) return colors.amber;
  if (feedback.startsWith('0')) return colors.dim;
  return colors.cyan;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';
const KEYS: Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export default function OfflineScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; limit?: string }>();
  const mode = params.mode === 'timed' ? 'timed' : 'guesses';
  const limit = (() => {
    const n = Number(params.limit);
    if (Number.isInteger(n) && n > 0) return n;
    return mode === 'timed' ? 60 : 7;
  })();

  const [secret, setSecret] = useState(() => generateSecret());
  const [entry, setEntry] = useState<Digit[]>([]);
  const [history, setHistory] = useState<{ guess: string; feedback: string }[]>([]);
  const [phase, setPhase] = useState<'playing' | 'won' | 'lost'>('playing');
  const [timeLeft, setTimeLeft] = useState(limit);
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const winScale = useRef(new Animated.Value(0.6)).current;
  const playSfx = useSfx();

  useEffect(() => {
    getToggle('sound').then(setSoundOn);
    getToggle('haptics').then(setHapticsOn);
  }, []);

  const play = (name: SfxName) => {
    if (!soundOn) return;
    playSfx(name);
  };
  const buzz = (kind: 'tap' | 'feedback' | 'win' | 'lose') => {
    if (!hapticsOn || !canHaptics) return;
    if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    else if (kind === 'feedback') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (kind === 'win') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  // Süreli mod: geri sayım.
  useEffect(() => {
    if (mode !== 'timed' || phase !== 'playing') return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [mode, phase]);

  // Süre dolunca kaybet.
  useEffect(() => {
    if (mode === 'timed' && phase === 'playing' && timeLeft <= 0) {
      setPhase('lost');
      play('lose');
      buzz('lose');
      recordLoss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, mode, phase]);

  const lose = () => {
    setPhase('lost');
    play('lose');
    buzz('lose');
    recordLoss();
  };

  const win = (guessCount: number) => {
    setPhase('won');
    play('win');
    buzz('win');
    recordWin(guessCount);
    winScale.setValue(0.6);
    Animated.spring(winScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  };

  const pressKey = (d: Digit) => {
    if (phase !== 'playing' || entry.length >= 3 || entry.includes(d)) return;
    play('blip');
    buzz('tap');
    setEntry([...entry, d]);
  };

  const erase = () => {
    if (entry.length === 0) return;
    buzz('tap');
    setEntry(entry.slice(0, -1));
  };

  const clearEntry = () => {
    if (entry.length === 0) return;
    buzz('tap');
    setEntry([]);
  };

  const submit = () => {
    if (phase !== 'playing' || entry.length !== 3) return;
    const guess = entry.join('');
    const result = evaluateGuess(secret, guess);
    if (result.status === 'invalid') return; // tuş takımı geçersiz girişe izin vermez
    setEntry([]);
    setHistory((h) => [{ guess, feedback: feedbackFor(result) }, ...h]);
    const guessCount = history.length + 1;
    if (result.status === 'win') {
      win(guessCount);
    } else if (mode === 'guesses' && guessCount >= limit) {
      lose();
    } else {
      play('good');
      buzz('feedback');
    }
  };

  const playAgain = () => {
    setSecret(generateSecret());
    setEntry([]);
    setHistory([]);
    setTimeLeft(limit);
    setPhase('playing');
  };

  const remaining = limit - history.length;
  const timerColor =
    timeLeft > limit * 0.5 ? colors.cyan : timeLeft > limit * 0.2 ? colors.amber : colors.danger;

  return (
    <Screen>
      <ScreenHeader title="Tek Kişilik" />

      {/* Mod göstergesi */}
      {mode === 'guesses' ? (
        <View style={styles.modeRow}>
          <Ionicons name="keypad-outline" size={18} color={colors.amber} />
          <Text style={styles.modeText}>
            Kalan hak: <Text style={[styles.modeValue, remaining <= 2 && styles.modeDanger]}>
              {phase === 'playing' ? remaining : 0}
            </Text>{' '}
            / {limit}
          </Text>
        </View>
      ) : (
        <View style={styles.modeRow}>
          <Ionicons name="timer-outline" size={20} color={timerColor} />
          <Text style={[styles.timer, { color: timerColor }]}>
            {formatTime(Math.max(0, timeLeft))}
          </Text>
        </View>
      )}

      {phase === 'playing' && (
        <>
          {/* 3 hane kutusu */}
          <View style={styles.slots}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.slot, entry[i] !== undefined && styles.slotFilled]}>
                <Text style={styles.slotText}>{entry[i] ?? ''}</Text>
              </View>
            ))}
          </View>

          {/* Tuş takımı */}
          <View style={styles.keypad}>
            {KEYS.map((d) => {
              const disabled = entry.includes(d) || entry.length >= 3;
              return (
                <Pressable
                  key={d}
                  onPress={() => pressKey(d)}
                  style={({ pressed }) => [
                    styles.key,
                    disabled && styles.keyDisabled,
                    pressed && !disabled && styles.keyPressed,
                  ]}>
                  <Text style={[styles.keyText, disabled && styles.keyTextDisabled]}>{d}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.actionRow}>
            <Pressable onPress={erase} style={styles.sideKey} hitSlop={8}>
              <Ionicons name="backspace-outline" size={24} color={colors.dim} />
            </Pressable>
            <Pressable
              onPress={submit}
              style={[styles.submit, entry.length !== 3 && styles.submitDisabled]}>
              <Text style={[styles.submitText, entry.length !== 3 && styles.submitTextDisabled]}>
                TAHMİN ET
              </Text>
            </Pressable>
            <Pressable onPress={clearEntry} style={styles.sideKey} hitSlop={8}>
              <Ionicons name="trash-outline" size={22} color={colors.dim} />
            </Pressable>
          </View>
        </>
      )}

      {phase === 'won' && (
        <Animated.View style={{ transform: [{ scale: winScale }] }}>
          <GlassCard style={styles.endBox}>
            <Text style={styles.winTitle}>🎉 KAZANDIN!</Text>
            <Text style={styles.endDetail}>
              Gizli sayıyı {history.length}. tahminde çözdün.
            </Text>
            <View style={styles.endButtons}>
              <GlassButton small label="Tekrar Oyna" onPress={playAgain} />
              <GlassButton
                small
                label="Ana Menü"
                accent={colors.amber}
                onPress={() => router.dismissTo('/')}
              />
            </View>
          </GlassCard>
        </Animated.View>
      )}

      {phase === 'lost' && (
        <GlassCard style={styles.endBox}>
          <Text style={styles.loseTitle}>
            {mode === 'timed' ? '⏱ Süre Doldu!' : '🔒 Hakkın Bitti!'}
          </Text>
          <Text style={styles.endDetail}>Gizli sayı:</Text>
          <Text style={styles.revealed}>{secret.join(' ')}</Text>
          <View style={styles.endButtons}>
            <GlassButton small label="Tekrar Oyna" onPress={playAgain} />
            <GlassButton
              small
              label="Ana Menü"
              accent={colors.amber}
              onPress={() => router.dismissTo('/')}
            />
          </View>
        </GlassCard>
      )}

      {/* Tahmin geçmişi */}
      <FlatList
        style={styles.history}
        data={history}
        keyExtractor={(_, index) => String(history.length - index)}
        renderItem={({ item, index }) => (
          <View style={[styles.historyCard, { borderLeftColor: toneFor(item.feedback) }]}>
            <Text style={styles.historyIndex}>#{history.length - index}</Text>
            <Text style={styles.historyGuess}>{item.guess}</Text>
            <Text style={[styles.historyFeedback, { color: toneFor(item.feedback) }]}>
              {item.feedback}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          phase === 'playing' ? (
            <Text style={styles.empty}>Şifreyi kırmaya başla — ilk tahminini gir!</Text>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  modeText: {
    color: colors.dim,
    fontSize: 15,
  },
  modeValue: {
    color: colors.amber,
    fontWeight: 'bold',
    fontFamily: mono,
    fontSize: 17,
  },
  modeDanger: {
    color: colors.danger,
  },
  timer: {
    fontSize: 34,
    fontWeight: 'bold',
    fontFamily: mono,
    letterSpacing: 2,
  },
  slots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 14,
  },
  slot: {
    width: 58,
    height: 68,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFilled: {
    borderColor: colors.cyan,
  },
  slotText: {
    color: colors.cyan,
    fontSize: 36,
    fontWeight: 'bold',
    fontFamily: mono,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    maxWidth: 280,
    alignSelf: 'center',
  },
  key: {
    width: 80,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: 'rgba(52, 224, 255, 0.18)',
    borderColor: colors.cyan,
  },
  keyDisabled: {
    opacity: 0.25,
  },
  keyText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: mono,
  },
  keyTextDisabled: {
    color: colors.dim,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginTop: 12,
  },
  sideKey: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submit: {
    borderWidth: 1,
    borderColor: colors.amber,
    backgroundColor: 'rgba(255, 200, 87, 0.12)',
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 13,
  },
  submitDisabled: {
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  submitText: {
    color: colors.amber,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 2,
  },
  submitTextDisabled: {
    color: colors.dim,
  },
  endBox: {
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  winTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: colors.amber,
    letterSpacing: 2,
  },
  loseTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.danger,
  },
  endDetail: {
    color: colors.dim,
  },
  revealed: {
    color: colors.cyan,
    fontSize: 38,
    fontWeight: 'bold',
    fontFamily: mono,
    letterSpacing: 8,
  },
  endButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  history: {
    flex: 1,
    marginTop: 16,
  },
  historyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderLeftWidth: 4,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  historyIndex: {
    color: colors.dim,
    width: 30,
    fontFamily: mono,
    fontSize: 13,
  },
  historyGuess: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 6,
    width: 80,
    color: colors.text,
    fontFamily: mono,
  },
  historyFeedback: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  empty: {
    textAlign: 'center',
    color: colors.dim,
    marginTop: 20,
  },
});
