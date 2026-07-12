import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';

import { normalizeTr, parseWord, upperTr, wordMarks, type LetterMark } from '@/game';
import { isOnline } from '@/net';
import { fetchWordPool } from '@/online/word-pool';
import { WordOrbs } from '@/online/ui/word/orbs';
import { TrKeyboard } from '@/online/ui/word/tr-keyboard';
import { WordConfirmButton } from '@/online/ui/word/word-parts';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';
// Kalan süre bu eşiğin altına düşünce: saat kırmızılaşır + belirgin uzun titreşim.
const LOW_SEC = 30;
// Süre-azaldı titreşimi: normal kısa darbeden AYRIŞSIN diye uzun + çift-darbeli
// desen ([bekle, titret, bekle, titret]). Android'de gerçek süre, iOS'ta iki darbe.
const LOW_TIME_VIBRATION = [0, 500, 160, 500];

function formatTime(sec: number) {
  const s = Math.max(0, sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Phase = 'loading' | 'playing' | 'won' | 'lost' | 'error';
type HistoryRow = { word: string; marks: LetterMark[] };

/** Tek oyunculu KELİME modu — tek turluk, süreye karşı Wordle. Telefon havuzdan
 *  rastgele bir kelime tutar; oyuncu süre bitene kadar SINIRSIZ tahminle bulmaya
 *  çalışır. Motor (wordMarks/parseWord) ve UI parçaları (TrKeyboard, WordConfirmButton,
 *  WordOrbs) çok oyunculudan yeniden kullanılır; ağ/satranç saati yerine tek yerel
 *  geri sayım + yerel state. Kelime havuzu maç başında Supabase'ten bir kez çekilir. */
export default function OfflineWordScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ length?: string; seconds?: string }>();

  // Uzunluk: 'random'/geçersiz → 4-6 arası rastgele; aksi halde 4/5/6.
  const wordLength = useMemo(() => {
    const n = Number(params.length);
    if (n === 4 || n === 5 || n === 6) return n;
    return 4 + Math.floor(Math.random() * 3);
  }, [params.length]);
  const limitSec = useMemo(() => {
    const n = Number(params.seconds);
    return Number.isInteger(n) && n > 0 ? n : 90;
  }, [params.seconds]);

  const [phase, setPhase] = useState<Phase>('loading');
  const [secret, setSecret] = useState('');
  const [entry, setEntry] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [timeLeft, setTimeLeft] = useState(limitSec);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);

  // Havuz: Set (anında doğrulama) + dizi (yeni tur için rastgele seçim). Ref'te
  // tutulur → yeniden çekilmeden "Tekrar Oyna" yeni kelime verir.
  const poolSetRef = useRef<Set<string>>(new Set());
  const poolWordsRef = useRef<string[]>([]);
  const winScale = useRef(new Animated.Value(0.6)).current;
  const lowBuzzedRef = useRef(false);
  const boardRef = useRef<ScrollView>(null);
  const playSfx = useSfx();

  useEffect(() => {
    getToggle('sound').then(setSoundOn);
    getToggle('haptics').then(setHapticsOn);
  }, []);

  const play = useCallback(
    (name: SfxName) => {
      if (soundOn) playSfx(name);
    },
    [soundOn, playSfx],
  );
  const buzz = useCallback(
    (kind: 'tap' | 'feedback' | 'win' | 'lose' | 'warn') => {
      if (!hapticsOn || !canHaptics) return;
      if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (kind === 'feedback') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (kind === 'warn') Vibration.vibrate(LOW_TIME_VIBRATION);
      else if (kind === 'win') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    [hapticsOn],
  );

  // Yeni tur: yüklü havuzdan rastgele gizli kelime + reset (yeniden çekim YOK).
  const newRound = useCallback(
    (words: string[]) => {
      const pick = words[Math.floor(Math.random() * words.length)];
      setSecret(pick);
      setEntry([]);
      setHistory([]);
      setInvalidMsg(null);
      setTimeLeft(limitSec);
      lowBuzzedRef.current = false;
      setPhase('playing');
    },
    [limitSec],
  );

  // İlk yükleme / hata sonrası: havuzu çek → Set + dizi kur → tur başlat.
  const loadAndStart = useCallback(async () => {
    setPhase('loading');
    // Proaktif: çevrimdışıysa fetch'in patlamasını bekleme, hemen hata durumu.
    if (!(await isOnline())) {
      setPhase('error');
      return;
    }
    try {
      const words = await fetchWordPool(wordLength);
      poolWordsRef.current = words;
      poolSetRef.current = new Set(words);
      newRound(words);
    } catch {
      setPhase('error');
    }
  }, [wordLength, newRound]);

  useEffect(() => {
    void loadAndStart();
  }, [loadAndStart]);

  const playAgain = useCallback(() => {
    if (poolWordsRef.current.length) newRound(poolWordsRef.current);
    else void loadAndStart();
  }, [newRound, loadAndStart]);

  // Geri sayım (yalnız oynanırken).
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Süre dolunca kaybet.
  useEffect(() => {
    if (phase === 'playing' && timeLeft <= 0) {
      setPhase('lost');
      play('lose');
      buzz('lose');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase]);

  // Kalan süre 30 sn altına İLK düştüğünde bir kez haptik.
  const low = phase === 'playing' && timeLeft > 0 && timeLeft < LOW_SEC;
  useEffect(() => {
    if (low && !lowBuzzedRef.current) {
      buzz('warn');
      lowBuzzedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [low]);

  // Klavye harf renkleri: tahminlerimin per-harf işaretlerinden (öncelik G>Y>X).
  const keyStates = useMemo(() => {
    const rank: Record<LetterMark, number> = { X: 0, Y: 1, G: 2 };
    const map: Record<string, LetterMark> = {};
    for (const row of history) {
      const letters = Array.from(row.word);
      for (let i = 0; i < letters.length; i++) {
        const mk = row.marks[i];
        const ch = letters[i];
        if (!mk) continue;
        const cur = map[ch];
        if (cur === undefined || rank[mk] > rank[cur]) map[ch] = mk;
      }
    }
    return map;
  }, [history]);

  const addLetter = useCallback(
    (k: string) => {
      if (phase !== 'playing') return;
      setInvalidMsg(null);
      setEntry((g) => (g.length >= wordLength ? g : [...g, k]));
      play('blip');
      buzz('tap');
    },
    [phase, wordLength, play, buzz],
  );
  const deleteLetter = useCallback(() => {
    setEntry((g) => {
      if (g.length === 0) return g;
      buzz('tap');
      return g.slice(0, -1);
    });
  }, [buzz]);

  const submit = useCallback(() => {
    if (phase !== 'playing' || entry.length !== wordLength) return;
    const parsed = parseWord(entry.join(''));
    if (!parsed.ok) return; // klavye yalnız TR harf verir; uzunluk zaten tam
    const word = parsed.word;
    if (!poolSetRef.current.has(word)) {
      setInvalidMsg('Bu kelime sözlükte yok.');
      buzz('warn');
      return;
    }
    const marks = wordMarks(secret, word);
    setEntry([]);
    setInvalidMsg(null);
    setHistory((h) => [...h, { word, marks }]);
    if (word === normalizeTr(secret)) {
      setPhase('won');
      play('win');
      buzz('win');
      winScale.setValue(0.6);
      Animated.spring(winScale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
    } else {
      play('good');
      buzz('feedback');
    }
  }, [phase, entry, wordLength, secret, play, buzz, winScale]);

  // ── Yükleme / hata durumları ──────────────────────────────────
  if (phase === 'loading') {
    return (
      <Screen float="letters">
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
          <Text style={styles.note}>Kelime hazırlanıyor…</Text>
        </View>
      </Screen>
    );
  }
  if (phase === 'error') {
    return (
      <Screen float="letters">
        <WordOrbs />
        <View style={styles.centered}>
          <Feather name="wifi-off" size={30} color={colors.danger} />
          <Text style={styles.note}>
            Kelime havuzu yüklenemedi.{'\n'}İnternet bağlantını kontrol edip tekrar dene.
          </Text>
          <View style={styles.endButtons}>
            <GlassButton small label="Tekrar Dene" onPress={() => void loadAndStart()} />
            <GlassButton
              small
              label="Ana Menü"
              accent={colors.amber}
              onPress={() => router.dismissTo('/')}
            />
          </View>
        </View>
      </Screen>
    );
  }

  // ── Oyun ──────────────────────────────────────────────────────
  const histTileW = Math.min(34, Math.floor((width - 80) / wordLength) - 4);
  const entryTileW = Math.min(44, Math.floor((width - 60 - (wordLength - 1) * 6) / wordLength));
  const finished = phase === 'won' || phase === 'lost';

  return (
    <Screen float="letters">
      <WordOrbs amberBottom={200} />
      <View style={styles.content}>
        {/* ÜST: çıkış + rozet + saat */}
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.exit}>
            <Feather name="chevron-left" size={18} color={colors.text} />
          </Pressable>
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>{wordLength} harf</Text>
          </View>
          <View style={[styles.clock, low && styles.clockLow]}>
            <Feather name="clock" size={14} color={low ? '#ff7b7b' : colors.cyan} />
            <Text style={[styles.clockText, low && styles.clockTextLow]}>
              {formatTime(timeLeft)}
            </Text>
          </View>
        </View>

        {/* ORTA: tahmin tahtası (kaydırılır) */}
        <View style={styles.middle}>
          <Text style={styles.sectionLabel}>tahminlerin</Text>
          <ScrollView
            ref={boardRef}
            style={styles.board}
            contentContainerStyle={styles.boardBody}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => boardRef.current?.scrollToEnd({ animated: true })}>
            {history.length === 0 ? (
              <Text style={styles.histEmpty}>İlk tahminini yap</Text>
            ) : (
              history.map((row, ri) => (
                <View key={ri} style={styles.histRow}>
                  {Array.from(row.word).map((ch, ci) => {
                    const mk = row.marks[ci];
                    const colored = mk === 'G' || mk === 'Y';
                    return (
                      <View
                        key={ci}
                        style={[
                          styles.histTile,
                          { width: histTileW },
                          mk === 'G' && styles.histTileGreen,
                          mk === 'Y' && styles.histTileYellow,
                        ]}>
                        <Text style={[styles.histTileText, colored && styles.histTileTextOn]}>
                          {upperTr(ch)}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          {/* Aktif tahmin tile'ları */}
          <View style={styles.entryRow}>
            {Array.from({ length: wordLength }).map((_, i) => {
              const letter = entry[i];
              const filled = letter !== undefined;
              return (
                <View
                  key={i}
                  style={[
                    styles.entryTile,
                    { width: entryTileW, height: Math.round(entryTileW * (50 / 44)) },
                    filled && styles.entryTileFilled,
                  ]}>
                  {filled ? <Text style={styles.entryTileText}>{upperTr(letter)}</Text> : null}
                </View>
              );
            })}
          </View>
          {invalidMsg ? <Text style={styles.invalid}>{invalidMsg}</Text> : null}
        </View>

        {/* KLAVYE + ONAY BUTONU (çok oyunculu düello ile aynı desen) */}
        <View style={styles.kbWrap}>
          <WordConfirmButton
            label="Kelimeyi Onayla"
            enabled={entry.length === wordLength && phase === 'playing'}
            busy={false}
            onPress={submit}
          />
          <TrKeyboard
            large
            onKey={addLetter}
            onDelete={deleteLetter}
            locked={phase !== 'playing'}
            letterStates={keyStates}
          />
        </View>
      </View>

      {/* Sonuç katmanı */}
      {finished ? (
        <View style={styles.endOverlay}>
          <Animated.View style={phase === 'won' ? { transform: [{ scale: winScale }] } : undefined}>
            <GlassCard style={styles.endCard}>
              {phase === 'won' ? (
                <>
                  <Text style={styles.winTitle}>🎉 KAZANDIN!</Text>
                  <Text style={styles.endDetail}>
                    Kelimeyi {history.length}. tahminde buldun.
                  </Text>
                  <Text style={styles.revealed}>{upperTr(secret)}</Text>
                </>
              ) : (
                <>
                  <Text style={styles.loseTitle}>⏱ Süre Doldu!</Text>
                  <Text style={styles.endDetail}>Gizli kelime:</Text>
                  <Text style={styles.revealed}>{upperTr(secret)}</Text>
                </>
              )}
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
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  exit: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  badgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
    boxShadow: `0 0 8px ${colors.success}`,
  },
  badgeText: {
    color: colors.success,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  clock: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(47,168,224,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(47,168,224,0.4)',
  },
  clockLow: {
    backgroundColor: 'rgba(255,123,123,0.12)',
    borderColor: 'rgba(255,123,123,0.55)',
    boxShadow: '0 0 14px rgba(255,123,123,0.22)',
  },
  clockText: {
    color: colors.cyan,
    fontSize: 17,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
  clockTextLow: {
    color: '#ff7b7b',
  },
  middle: {
    flex: 1,
  },
  sectionLabel: {
    color: '#6B8CAE',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  board: {
    flex: 1,
  },
  boardBody: {
    gap: 6,
    paddingBottom: 6,
  },
  histRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
  },
  histTile: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  histTileGreen: {
    backgroundColor: 'rgba(34,197,94,0.9)',
    borderColor: 'rgba(34,197,94,1)',
  },
  histTileYellow: {
    backgroundColor: 'rgba(234,179,8,0.92)',
    borderColor: 'rgba(234,179,8,1)',
  },
  histTileText: {
    color: '#A8C0D8',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: mono,
  },
  histTileTextOn: {
    color: '#0A1018',
    fontWeight: '800',
  },
  histEmpty: {
    color: '#4B6B8A',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 10,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  entryTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  entryTileFilled: {
    backgroundColor: 'rgba(47,168,224,0.18)',
    borderColor: 'rgba(47,168,224,0.8)',
    boxShadow: '0 0 14px rgba(47,168,224,0.35)',
  },
  entryTileText: {
    color: '#E8F0FF',
    fontSize: 21,
    fontWeight: '700',
    fontFamily: mono,
  },
  invalid: {
    color: colors.danger,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  kbWrap: {
    marginHorizontal: -20,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: 'rgba(6,12,26,0.7)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    gap: 10,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  note: {
    color: colors.dim,
    fontSize: 14,
    fontFamily: mono,
    textAlign: 'center',
    lineHeight: 21,
  },
  endOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,9,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  endCard: {
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 360,
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
    fontSize: 30,
    fontWeight: 'bold',
    fontFamily: mono,
    letterSpacing: 6,
  },
  endButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
});
