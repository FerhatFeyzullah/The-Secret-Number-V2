import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useProfile } from '@/auth';
import { parseGuess } from '@/game';
import {
  getMatchReveal,
  leaveMatch,
  makeGuess,
  OnlineError,
  useMatch,
  type MatchReveal,
} from '@/online';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono } from '@/ui/theme';

import { DigitPad } from './duel/digit-pad';
import { GuessHistory } from './duel/guess-history';
import { PlayerPod } from './duel/player-pod';
import { ResultOverlay } from './duel/result-overlay';
import { TurnBanner } from './duel/turn-banner';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';
const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

/** Online düello ekranı: useMatch realtime + sunucu RPC'leri (makeGuess /
 *  claimTimeout / leaveMatch / get_match_reveal). Görsel saat sadece gösterim;
 *  her karar sunucuda. Rakip gizli sayısı YALNIZCA maç bitince (overlay) gelir. */
export function DuelScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { name } = useProfile();
  const { match, guesses, clocks, loading, error, sendEmoji, incomingEmoji } = useMatch(matchId);

  const [entry, setEntry] = useState<string[]>([]);
  const [reveal, setReveal] = useState<MatchReveal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Ses/haptik tercihleri (offline ekranıyla aynı kaynak).
  const [soundOn, setSoundOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const playSfx = useSfx();
  useEffect(() => {
    getToggle('sound').then(setSoundOn);
    getToggle('haptics').then(setHapticsOn);
  }, []);
  const play = useCallback(
    (n: SfxName) => {
      if (soundOn) playSfx(n);
    },
    [soundOn, playSfx],
  );
  const buzz = useCallback(
    (kind: 'tap' | 'feedback' | 'win' | 'lose') => {
      if (!hapticsOn || !canHaptics) return;
      if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (kind === 'feedback') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (kind === 'win') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    [hapticsOn],
  );

  // ── Türetilmiş durum ──────────────────────────────────────────
  const status = match?.status ?? null;
  const finished = status === 'finished';
  const myId = match ? (match.myRole === 'player1' ? match.player1.id : match.player2?.id ?? '') : '';
  const isMine = !!match && status === 'active' && match.currentTurn === myId;
  const locked = !isMine;

  const p1 = match?.myRole === 'player1';
  const myClockMs = p1 ? clocks.clock1Ms : clocks.clock2Ms;
  const oppClockMs = p1 ? clocks.clock2Ms : clocks.clock1Ms;
  const myName = name || 'Sen';
  const opponentName =
    (match ? (match.myRole === 'player1' ? match.player2?.username : match.player1.username) : null) ??
    'Rakip';
  const myGuesses = guesses.filter((g) => g.guesser === myId);
  const win = finished && !!match?.winner && match.winner === myId;

  // Sıra rakibe geçince yarım kalan girişi temizle.
  useEffect(() => {
    if (!isMine) setEntry([]);
  }, [isMine]);

  // Not: süre bitince otomatik zaman aşımı artık useMatch içinde merkezî olarak
  // ele alınıyor (her iki istemci de claim eder, idempotent). Burada tetikleme yok.

  // Maç bitince iki gizli sayıyı çek (yalnızca finished'te sunucu döndürür).
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    getMatchReveal(matchId)
      .then((r) => alive && setReveal(r))
      .catch(() => alive && setReveal({ mine: null, opponent: null }));
    return () => {
      alive = false;
    };
  }, [finished, matchId]);

  // Bitiş sesi/haptiği (bir kez).
  const finishFxRef = useRef(false);
  useEffect(() => {
    if (!finished || finishFxRef.current) return;
    finishFxRef.current = true;
    if (win) {
      play('win');
      buzz('win');
    } else {
      play('lose');
      buzz('lose');
    }
  }, [finished, win, play, buzz]);

  // ── Çıkış (active → hükmen kaybetme) onayı ─────────────────────
  const leavingRef = useRef(false);
  const goMenu = useCallback(() => {
    leavingRef.current = true;
    router.dismissTo('/');
  }, [router]);

  // Tekrar Oyna: doğrudan Hızlı Maç arama akışına (lobiye değil). Bu maçın
  // aboneliği/kanalı unmount'ta temizlenir; online ekranı quick paramıyla
  // aramayı otomatik başlatır.
  const goRematch = useCallback(() => {
    leavingRef.current = true;
    router.replace({ pathname: '/online', params: { quick: '1' } });
  }, [router]);

  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      // Maç bitti ya da çıkışı zaten onayladıysak engelleme.
      if (leavingRef.current || match?.status === 'finished') return;
      e.preventDefault();
      Alert.alert(
        'Maçtan çık',
        'Maçtan çıkarsan hükmen kaybedersin. Çıkmak istiyor musun?',
        [
          { text: 'Vazgeç', style: 'cancel' },
          {
            text: 'Çık',
            style: 'destructive',
            onPress: () => {
              leavingRef.current = true;
              void leaveMatch(matchId).catch(() => {});
              navigation.dispatch(e.data.action);
            },
          },
        ],
      );
    });
    return sub;
  }, [navigation, match?.status, matchId]);

  // ── Giriş aksiyonları ─────────────────────────────────────────
  const addDigit = useCallback(
    (d: string) => {
      if (locked) return;
      setEntry((g) => (g.length >= 3 || g.includes(d) ? g : [...g, d]));
      play('blip');
      buzz('tap');
    },
    [locked, play, buzz],
  );

  const deleteDigit = useCallback(() => {
    setEntry((g) => {
      if (g.length === 0) return g;
      buzz('tap');
      return g.slice(0, -1);
    });
  }, [buzz]);

  const submit = useCallback(async () => {
    if (locked || submitting || entry.length < 3) return;
    const digits = entry.join('');
    if (!parseGuess(digits).ok) return; // istemci ön-doğrulaması; nihai otorite sunucu
    setSubmitting(true);
    setActionError(null);
    try {
      const outcome = await makeGuess(matchId, digits);
      setEntry([]);
      if (outcome.feedback === 'win') {
        play('win');
        buzz('win');
      } else {
        play('good');
        buzz('feedback');
      }
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setSubmitting(false);
    }
  }, [locked, submitting, entry, matchId, play, buzz]);

  // ── Render ────────────────────────────────────────────────────
  const exitButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
      <Feather name="chevron-left" size={20} color={colors.text} />
    </Pressable>
  );

  // Yüklenme / hata / oyun-dışı fazlar.
  if (!match) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>
          )}
          <Pressable onPress={goMenu} hitSlop={8} style={styles.noteExit}>
            <Text style={styles.noteExitText}>Ana Menü</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  if (status !== 'active' && status !== 'finished') {
    return (
      <Screen>
        <View style={styles.topRow}>{exitButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
          <Text style={styles.note}>Oyun başlıyor…</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Aktif sıra ışını (üst kenar) */}
      <View
        style={[
          styles.beam,
          isMine ? styles.beamLeft : styles.beamRight,
          { backgroundColor: isMine ? colors.cyan : colors.amber, boxShadow: `0 0 20px ${isMine ? colors.cyan : colors.amber}` },
        ]}
      />

      <View style={styles.content}>
        <View style={styles.topRow}>{exitButton}</View>

        {/* Arena: çift saat */}
        <View style={styles.arena}>
          <PlayerPod initial={myName.charAt(0)} name={myName} ms={myClockMs} active={isMine} side="left" />
          <View style={styles.vs}>
            <View style={styles.vsLine} />
            <Text style={styles.vsText}>VS</Text>
            <View style={styles.vsLine} />
          </View>
          <PlayerPod
            initial={opponentName.charAt(0)}
            name={opponentName}
            ms={oppClockMs}
            active={!isMine && status === 'active'}
            side="right"
          />
        </View>

        <TurnBanner mine={isMine} />

        <DigitPad
          guess={entry}
          locked={locked}
          onDigit={addDigit}
          onDelete={deleteDigit}
          onSubmit={submit}
        />

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        <GuessHistory guesses={myGuesses} />
      </View>

      {finished ? (
        <ResultOverlay
          win={win}
          mySecret={reveal?.mine ?? null}
          theirSecret={reveal?.opponent ?? null}
          opponentName={opponentName}
          opponentInitial={opponentName.charAt(0)}
          incomingEmoji={incomingEmoji}
          onSendEmoji={sendEmoji}
          onRematch={goRematch}
          onMenu={goMenu}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  beam: {
    position: 'absolute',
    top: 0,
    height: 3,
    width: '50%',
    zIndex: 3,
  },
  beamLeft: {
    left: 0,
  },
  beamRight: {
    right: 0,
  },
  content: {
    flex: 1,
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  exit: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arena: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 18,
    padding: 14,
  },
  vs: {
    alignItems: 'center',
    gap: 4,
  },
  vsLine: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  vsText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
  },
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
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
  },
  noteExit: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  noteExitText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
});

// Düello ekranı dikey boşlukları: arena/banner/pad arasında nefes payı.
// (GuessHistory flex:1 ile kalan alanı doldurur ve kendi içinde kayar.)
