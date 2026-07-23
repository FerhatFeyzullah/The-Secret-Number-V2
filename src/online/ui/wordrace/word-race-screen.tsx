import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';

import { knownGreenLetters, parseWord, upperTr, type LetterMark } from '@/game';
import {
  claimWordRaceTimeout,
  getMatchReveal,
  getMyRank,
  OnlineError,
  useMatch,
  useMatchSession,
  wordRaceGuess,
  wordRaceReveal,
  type MatchReveal,
  type MatchState,
} from '@/online';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

import { ResultOverlay } from '../duel/result-overlay';
import { CheerBar, CheerStream, TribuneBadge } from '../spectate/tribune';
import { EmoteBar, IncomingReaction } from '../word/emote-bar';
import { WordOrbs } from '../word/orbs';
import { RequestWordButton } from '../word/request-word-button';
import { TrKeyboard } from '../word/tr-keyboard';
import { WordConfirmButton } from '../word/word-parts';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

const errMsg = (e: unknown) => {
  if (e instanceof OnlineError) return e.message;
  return 'Bağlantı hatası, lütfen tekrar dene.';
};

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Ortak geri sayımdan kalan süre (ms) — sunucu-otoriter turn_started_at + clock_ms
 *  üzerinden türetilir; SADECE gösterim/tetik içindir (karar sunucuda). */
function raceRemaining(match: MatchState): number {
  if (match.status !== 'active' || !match.turnStartedAt) return match.clockMs;
  const elapsed = Math.max(0, Date.now() - Date.parse(match.turnStartedAt));
  return Math.max(0, match.clockMs - elapsed);
}

// Kalan süre bu eşiğin altına düşünce: saat kırmızılaşır + belirgin uyarı titreşimi.
const LOW_MS = 30_000;
const LOW_TIME_VIBRATION = [0, 500, 160, 500];
// Tur-sonu "reveal" ara ekranının gösterim süresi (yeni tur başlamadan önce).
const ROUND_BREAK_MS = 2800;

/** Kelime Yarışı ekranı — kelime düellosunun bir varyantı. FARK: sunucu TEK gizli
 *  kelime seçer, iki oyuncu AYNI kelimeyi EŞZAMANLI yarışır (SIRA YOK). Belirleme
 *  fazı yoktur; tur başına ORTAK 180 sn geri sayım. İlk çözen turu anında alır;
 *  süre dolarsa "en çok ilerleyen" alır. Best-of-3. Rakip ilerlemesi yalnız
 *  toplu yeşil/sarı SAYI olarak iner (harf/pozisyon sızmaz). */
export function WordRaceScreen({
  matchId,
  spectateAs = null,
}: {
  matchId: string;
  /** KLAN MAÇ İZLEME: verilirse ekran bu oyuncunun gözünden salt-okunur açılır. */
  spectateAs?: string | null;
}) {
  const spectator = spectateAs != null;
  const router = useRouter();
  const navigation = useNavigation();
  const session = useMatchSession();
  const { width } = useWindowDimensions();
  const {
    match,
    guesses,
    loading,
    error,
    sendSignal,
    incomingSignal,
    sendText,
    incomingText,
    spectatorCount,
    sendCheer,
    incomingCheer,
  } = useMatch(matchId, { spectateAs });

  const [entry, setEntry] = useState<string[]>([]);
  const historyRef = useRef<ScrollView>(null);
  const [reveal, setReveal] = useState<MatchReveal | null>(null);
  // Bitmiş maçta son turun gizli kelimesi (iki oyuncu için ORTAK; tek sütun).
  const [finalSecret, setFinalSecret] = useState<string | null>(null);
  const [signalDeck, setSignalDeck] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notInPoolWord, setNotInPoolWord] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Tur-sonu ara ekranı: hangi tur bitti + kazandım mı + o turun gizlisi.
  const [roundEnd, setRoundEnd] = useState<{ round: number; winnerIsMe: boolean } | null>(null);
  const [roundEndSecret, setRoundEndSecret] = useState<string | null>(null);

  // Ses/haptik tercihleri.
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
  const buzzWarn = useCallback(() => buzz('warn'), [buzz]);

  // ── Türetilmiş durum ──────────────────────────────────────────
  const status = match?.status ?? null;
  const finished = status === 'finished';
  const myId = match ? (match.myRole === 'player1' ? match.player1.id : match.player2?.id ?? '') : '';
  const wordLength = match?.wordLength ?? 5;
  const p1 = match?.myRole === 'player1';
  const opponentName =
    (match ? (match.myRole === 'player1' ? match.player2?.username : match.player1.username) : null) ??
    'Rakip';
  const round = match?.currentRound ?? 1;
  const myWins = match ? (p1 ? match.p1RoundWins : match.p2RoundWins) : 0;
  const oppWins = match ? (p1 ? match.p2RoundWins : match.p1RoundWins) : 0;
  const win = finished && !!match?.winner && match.winner === myId;

  // KENDİ tahtam: yalnız KENDİ tahmin satırlarım (wordrace RLS ile rakibinki gelmez).
  // feedback sütunu ZATEN marks dizisi ('GYXXX') — doğrudan tile rengine map edilir.
  const myGuesses = guesses.filter((g) => g.guesser === myId && g.round === round);

  // Rakip ilerlemesi: yalnız sunucudan İNEN toplu yeşil/sarı SAYI (harf sızmaz).
  const oppBestGreen = match ? (p1 ? match.p2BestGreen : match.p1BestGreen) : 0;
  const oppBestYellow = match ? (p1 ? match.p2BestYellow : match.p1BestYellow) : 0;
  const hasOppProgress = oppBestGreen > 0 || oppBestYellow > 0;
  const greenPct = wordLength > 0 ? oppBestGreen / wordLength : 0;
  const yellowPct = wordLength > 0 ? oppBestYellow / wordLength : 0;

  // Klavye harf renkleri: KENDİ tahminlerimin marks'ından (öncelik G > Y > X).
  const keyStates = useMemo(() => {
    const rank: Record<LetterMark, number> = { X: 0, Y: 1, G: 2 };
    const map: Record<string, LetterMark> = {};
    for (const g of myGuesses) {
      const marks = Array.from(g.feedback as string) as LetterMark[];
      const letters = Array.from(g.digits);
      for (let i = 0; i < letters.length; i++) {
        const mk = marks[i];
        const ch = letters[i];
        if (mk !== 'G' && mk !== 'Y' && mk !== 'X') continue;
        const cur = map[ch];
        if (cur === undefined || rank[mk] > rank[cur]) map[ch] = mk;
      }
    }
    return map;
    // myGuesses referansı her render değişir → içerik özeti ile tetikle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myGuesses.map((g) => `${g.id}:${g.feedback}`).join(',')]);

  // Bilinen yeşiller: input'ta boş pozisyonlara silik ipucu (KENDİ feedback'imden).
  const knownGreens = useMemo(
    () => knownGreenLetters(myGuesses.map((g) => ({ word: g.digits, marks: g.feedback as string })), wordLength),
    // Yukarıdaki gibi içerik özeti ile tetikle (myGuesses referansı her render değişir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [myGuesses.map((g) => `${g.id}:${g.feedback}`).join(','), wordLength],
  );

  // Merkezi maç sahibi (çıkış temizliği için). Seyirci SAHİPLENMEZ.
  useEffect(() => {
    if (spectator) return;
    session.claim(matchId, 'match');
  }, [matchId, session, spectator]);

  // Yeni tur → giriş kutularını temizle (tahta zaten yeni turu filtreler).
  useEffect(() => {
    setEntry([]);
  }, [round]);

  // Ayna ref: zaman aşımı denetimi güncel maçı okusun (render'a bağlı olmadan).
  const matchRef = useRef<MatchState | null>(null);
  useEffect(() => {
    matchRef.current = match;
  }, [match]);

  // Ortak geri sayım 0'a inince claim_word_race_timeout (karar sunucuda; idempotent).
  // useMatch'in satranç-saati claim'i wordrace'te İNERT (current_turn null) → burada.
  const claimedRoundRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'active') return;
    const iv = setInterval(() => {
      const m = matchRef.current;
      if (!m || m.status !== 'active' || !m.turnStartedAt) return;
      if (raceRemaining(m) > 0) return;
      if (claimedRoundRef.current === m.turnStartedAt) return;
      claimedRoundRef.current = m.turnStartedAt;
      void claimWordRaceTimeout(matchId).catch((e) => {
        // Drift/ağ: sunucu "henüz dolmadı" ya da timeout → kilidi aç, tekrar dene.
        if (e instanceof OnlineError && (e.code === 'clock_not_expired' || e.code === 'timeout')) {
          claimedRoundRef.current = null;
        }
      });
    }, 500);
    return () => clearInterval(iv);
  }, [status, matchId]);

  // ── Tur geçişi: kararlaşan turu yakala + reveal getir ──────────
  // Turu ÇÖZEN oyuncu (submit) roundEnd'i doğrudan kurar; DİĞER oyuncu (ve süre
  // dolumu) realtime maç-satırı değişiminden (current_round++, round_wins) öğrenir.
  const roundMetaRef = useRef({ round: 1, p1: 0, p2: 0 });
  const handledRoundRef = useRef(0);
  const roundInitedRef = useRef(false);
  useEffect(() => {
    if (!match || match.status !== 'active') return;
    // İlk aktif snapshot (yeniden bağlanma dahil): geçmiş turları "işlendi" say →
    // maçın ortasına girince sahte tur-sonu ara ekranı AÇILMASIN.
    if (!roundInitedRef.current) {
      roundInitedRef.current = true;
      roundMetaRef.current = {
        round: match.currentRound,
        p1: match.p1RoundWins,
        p2: match.p2RoundWins,
      };
      handledRoundRef.current = match.currentRound - 1;
      return;
    }
    const decided = match.currentRound - 1;
    if (match.currentRound > roundMetaRef.current.round && handledRoundRef.current < decided) {
      handledRoundRef.current = decided;
      const winnerIsP1 = match.p1RoundWins - roundMetaRef.current.p1 > 0;
      const winnerIsMe = winnerIsP1 === (match.myRole === 'player1');
      setRoundEnd({ round: decided, winnerIsMe });
      setRoundEndSecret(null);
      wordRaceReveal(matchId, decided)
        .then((r) => setRoundEndSecret(r.secret))
        .catch(() => {});
    }
    roundMetaRef.current = {
      round: match.currentRound,
      p1: match.p1RoundWins,
      p2: match.p2RoundWins,
    };
  }, [match, matchId]);

  // Tur-sonu ara ekranı otomatik kapanır (identity yalnız yeni turda değişir →
  // reveal geç gelse bile zamanlayıcı sıfırlanmaz).
  useEffect(() => {
    if (!roundEnd) return;
    const t = setTimeout(() => {
      setRoundEnd(null);
      setRoundEndSecret(null);
    }, ROUND_BREAK_MS);
    return () => clearTimeout(t);
  }, [roundEnd]);

  // Tur-sonu ses/haptik (tur başına bir kez; maç sonu ayrı ele alınır).
  const roundEndFxRef = useRef(0);
  useEffect(() => {
    if (!roundEnd || roundEndFxRef.current === roundEnd.round) return;
    roundEndFxRef.current = roundEnd.round;
    if (roundEnd.winnerIsMe) {
      play('good');
      buzz('feedback');
    } else {
      play('lose');
      buzz('lose');
    }
  }, [roundEnd, play, buzz]);

  // Maç bitince: kazanım (getMatchReveal) + ORTAK son tur gizlisi (wordRaceReveal).
  const finishedRound = match?.currentRound;
  useEffect(() => {
    if (!finished || finishedRound == null) return;
    let alive = true;
    getMatchReveal(matchId, spectateAs)
      .then((r) => alive && setReveal(r))
      .catch(
        () =>
          alive &&
          setReveal({
            mine: null,
            opponent: null,
            scored: false,
            ratingDelta: null,
            xpDelta: null,
            veriDelta: null,
          }),
      );
    wordRaceReveal(matchId, finishedRound, spectateAs)
      .then((r) => alive && setFinalSecret(r.secret))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [finished, matchId, finishedRound, spectateAs]);

  // Sinyal destesi (maç-içi emote + maç-sonu reaksiyon).
  useEffect(() => {
    let alive = true;
    getMyRank()
      .then((r) => alive && setSignalDeck(r.signalDeck))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

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

  // Yeni tahmin gelince tahtayı en alta kaydır.
  useEffect(() => {
    historyRef.current?.scrollToEnd({ animated: true });
  }, [myGuesses.length]);

  // ── Çıkış ─────────────────────────────────────────────────────
  const leavingRef = useRef(false);
  const goMenu = useCallback(() => {
    leavingRef.current = true;
    if (spectator) {
      router.back(); // tribünden ayrıl → klan ekranına dön
      return;
    }
    session.release();
    router.dismissTo('/');
  }, [router, session, spectator]);
  const goRematch = useCallback(() => {
    leavingRef.current = true;
    session.release();
    router.replace({ pathname: '/online', params: { wordrace: '1' } });
  }, [router, session]);

  useEffect(() => {
    if (spectator) return; // seyirci serbestçe çıkar
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leavingRef.current || match?.status === 'finished') return;
      e.preventDefault();
      Alert.alert('Maçtan çık', 'Maçtan çıkarsan hükmen kaybedersin. Çıkmak istiyor musun?', [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çık',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            session.leave();
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return sub;
  }, [navigation, match?.status, session, spectator]);

  // ── Giriş ─────────────────────────────────────────────────────
  // Tur geçişinde/roundEnd sırasında ANINDA kilitle (geç tahmin sızmasın).
  // Seyircide klavye HER ZAMAN kilitli.
  const locked = spectator || !match || status !== 'active' || !!roundEnd || submitting;

  const addLetter = useCallback(
    (k: string) => {
      if (locked) return;
      setActionError(null);
      setNotInPoolWord(null);
      setEntry((g) => (g.length >= wordLength ? g : [...g, k]));
      play('blip');
      buzz('tap');
    },
    [locked, wordLength, play, buzz],
  );
  const deleteLetter = useCallback(() => {
    setActionError(null);
    setNotInPoolWord(null);
    setEntry((g) => {
      if (g.length === 0) return g;
      buzz('tap');
      return g.slice(0, -1);
    });
  }, [buzz]);

  const submitLatchRef = useRef(false);
  const submit = useCallback(async () => {
    if (locked || submitLatchRef.current || entry.length < wordLength) return;
    const word = entry.join('');
    const parsed = parseWord(word);
    if (!parsed.ok) return; // istemci ön-doğrulaması; nihai otorite sunucu
    submitLatchRef.current = true;
    setSubmitting(true);
    setActionError(null);
    setNotInPoolWord(null);
    try {
      const outcome = await wordRaceGuess(matchId, parsed.word, round);
      setEntry([]);
      if (outcome.status === 'match_won') {
        // Maç bitişi: realtime status='finished' → ResultOverlay. Ses finishFx'te.
      } else if (outcome.status === 'round_won') {
        // Turu ÇÖZDÜM: reveal + winner elimde → ara ekranı doğrudan kur (realtime
        // aynı turu tekrar işlemesin diye handled işaretle).
        const decided = outcome.currentRound - 1;
        handledRoundRef.current = decided;
        setRoundEnd({ round: decided, winnerIsMe: true });
        setRoundEndSecret(outcome.reveal);
      } else {
        // 'playing': kendi tahmin satırım realtime echo ile tahtaya düşer.
        play('good');
        buzz('feedback');
      }
    } catch (e) {
      const code = e instanceof OnlineError ? e.code : null;
      if (code === 'stale_round') {
        // Rakip turu az önce çözdü; tur zaten ilerledi → sessizce yut (hata gösterme).
        // Realtime tur-sonu ekranı gizli kelimeyi zaten gösterir. Girişi temizle.
        setEntry([]);
      } else {
        setActionError(errMsg(e));
        // Havuz-dışı tam kelime → "Sözlüğe öner".
        if (code === 'word_not_in_pool') setNotInPoolWord(parsed.word);
        // Süre az önce doldu → zaman aşımını tetikle (tur ilerlemeye göre bölünür).
        else if (code === 'round_over') void claimWordRaceTimeout(matchId).catch(() => {});
      }
    } finally {
      submitLatchRef.current = false;
      setSubmitting(false);
    }
  }, [locked, entry, wordLength, matchId, round, play, buzz]);

  // ── Render ────────────────────────────────────────────────────
  const exitButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
      <Feather name="chevron-left" size={18} color={colors.text} />
    </Pressable>
  );

  if (!match) {
    // Seyircide ana menüye fırlatma YOK: izleme yetkisi yoksa (klan arkadaşı
    // değil / maç özel oda / maç kayboldu) bilgilendir ve geldiği yere döndür.
    if (spectator) {
      if (!loading) {
        return (
          <Screen float="letters">
            <View style={styles.centered}>
              <Text style={styles.note}>{error ?? 'Bu maç artık izlenemiyor.'}</Text>
              <Pressable onPress={goMenu} hitSlop={8} style={styles.noteExit}>
                <Text style={styles.noteExitText}>Geri Dön</Text>
              </Pressable>
            </View>
          </Screen>
        );
      }
    } else if (!loading && !error) return <Redirect href="/" />;
    return (
      <Screen float="letters">
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

  // Rakip henüz katılmadı (savunmacı: normal akışta buraya 'active' gelinir).
  if (status === 'waiting') {
    return (
      <Screen float="letters">
        <WordOrbs />
        <View style={styles.headerRow}>{exitButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.success} />
          <Text style={styles.note}>Rakip bekleniyor…</Text>
        </View>
      </Screen>
    );
  }

  if (status !== 'active' && status !== 'finished') {
    return (
      <Screen float="letters">
        <View style={styles.headerRow}>{exitButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
          <Text style={styles.note}>Yarış başlıyor…</Text>
        </View>
      </Screen>
    );
  }

  const histTileW = Math.min(30, Math.floor((width - 140) / wordLength) - 4);
  const entryTileW = Math.min(44, Math.floor((width - 60 - (wordLength - 1) * 6) / wordLength));

  return (
    <Screen float="letters">
      <WordOrbs amberBottom={200} />
      <View style={styles.content}>
        {/* ÜST: rozet + Bo3 tur noktaları + tribün sayacı */}
        <View style={styles.headerRow}>
          {exitButton}
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>yarış · {wordLength} harf</Text>
          </View>
          <TribuneBadge count={spectatorCount} />
          <View style={styles.roundDots}>
            <Text style={styles.roundDotsLabel}>tur</Text>
            {[0, 1, 2].map((i) => {
              const mineWon = i < myWins;
              const theirsWon = !mineWon && i < myWins + oppWins;
              return (
                <View
                  key={i}
                  style={[
                    styles.roundDot,
                    mineWon && styles.roundDotMine,
                    theirsWon && styles.roundDotTheirs,
                  ]}
                />
              );
            })}
          </View>
        </View>

        {/* Bilgi: bot bir kelime tuttu (gizli asla gösterilmez). */}
        <View style={styles.secretRow}>
          <Feather name="cpu" size={12} color="#3A5878" />
          <Text style={styles.secretLabel}>bot bir kelime tuttu — ilk bulan turu alır</Text>
        </View>

        {/* Rakip ilerleme kartı: yalnız toplu yeşil/sarı SAYI (harf sızmaz). */}
        <View style={styles.oppCard}>
          <View style={styles.oppLeft}>
            <View style={styles.oppAvatar}>
              <Text style={styles.oppAvatarText}>{opponentName.charAt(0).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.oppName}>{opponentName}</Text>
              <Text style={styles.oppStat}>rakip</Text>
            </View>
          </View>
          <View style={styles.closeWrap}>
            {hasOppProgress ? (
              <>
                <View style={styles.closeStat}>
                  <Text style={styles.closeLabel}>
                    {oppBestGreen}/{wordLength} yeşil
                  </Text>
                  <View style={styles.closeTrack}>
                    <View
                      style={[
                        styles.closeFill,
                        {
                          width: `${Math.round(greenPct * 100)}%` as `${number}%`,
                          backgroundColor: '#22C55E',
                          boxShadow: '0 0 8px rgba(34,197,94,0.5)',
                        },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.closeStat}>
                  <Text style={styles.closeLabel}>
                    {oppBestYellow}/{wordLength} sarı
                  </Text>
                  <View style={styles.closeTrack}>
                    <View
                      style={[
                        styles.closeFill,
                        {
                          width: `${Math.round(yellowPct * 100)}%` as `${number}%`,
                          backgroundColor: '#EAB308',
                          boxShadow: '0 0 8px rgba(234,179,8,0.5)',
                        },
                      ]}
                    />
                  </View>
                </View>
              </>
            ) : (
              <Text style={styles.closeLabel}>henüz ilerleme yok</Text>
            )}
          </View>
          <IncomingReaction signal={incomingSignal} text={incomingText} />
        </View>

        {/* ORTAK geri sayım — kendi içinde tikler (ekranı 250 ms'de yenilemez) */}
        <RaceClock match={match} onLowWarn={buzzWarn} />

        {/* ORTA: KENDİ tahminlerim (marks doğrudan tile rengine) */}
        <View style={styles.middle}>
          <Text style={styles.sectionLabel}>tahminlerin</Text>
          <ScrollView
            ref={historyRef}
            style={styles.history}
            contentContainerStyle={styles.historyBody}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => historyRef.current?.scrollToEnd({ animated: true })}>
            {myGuesses.map((g) => {
              const marks = Array.from(g.feedback as string) as LetterMark[];
              return (
                <View key={g.id} style={styles.histRow}>
                  <View style={styles.histTiles}>
                    {Array.from(g.digits).map((ch, ci) => {
                      const mk = marks[ci];
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
                </View>
              );
            })}
            {myGuesses.length === 0 ? (
              <Text style={styles.histEmpty}>İlk tahminini yap — kelimeyi ilk bulan turu alır!</Text>
            ) : null}
          </ScrollView>

          {/* Aktif tahmin tile'ları */}
          <View style={styles.entryRow}>
            {Array.from({ length: wordLength }).map((_, i) => {
              const letter = entry[i];
              const filled = letter !== undefined;
              const ghost = !filled ? knownGreens[i] : undefined;
              return (
                <View
                  key={i}
                  style={[
                    styles.entryTile,
                    { width: entryTileW, height: Math.round(entryTileW * (50 / 44)) },
                    filled && styles.entryTileFilled,
                    locked && styles.entryTileLocked,
                  ]}>
                  {filled ? (
                    <Text style={styles.entryTileText}>{upperTr(letter)}</Text>
                  ) : ghost ? (
                    <Text style={[styles.entryTileText, styles.entryTileGhost]}>{upperTr(ghost)}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
          {notInPoolWord ? (
            <View style={styles.requestRow}>
              <RequestWordButton
                word={notInPoolWord}
                onSent={() => {
                  setEntry([]);
                  setNotInPoolWord(null);
                }}
              />
            </View>
          ) : null}
        </View>

        {/* KLAVYE + ONAY (seyircide yok — yerine tribün barı) */}
        {spectator ? (
          <View style={styles.kbWrap}>
            <CheerBar deck={signalDeck} onCheer={sendCheer} />
          </View>
        ) : (
          <View style={styles.kbWrap}>
            <View style={styles.confirmRow}>
              <EmoteBar
                deck={signalDeck}
                onSendSignal={sendSignal}
                onSendText={sendText}
                disabled={finished}
              />
              <View style={styles.confirmFill}>
                <WordConfirmButton
                  label="Kelimeyi Onayla"
                  enabled={entry.length === wordLength && !locked}
                  busy={submitting}
                  onPress={submit}
                />
              </View>
            </View>
            <TrKeyboard
              large
              onKey={addLetter}
              onDelete={deleteLetter}
              locked={locked}
              letterStates={keyStates}
            />
          </View>
        )}
      </View>

      {/* Tur-sonu ara ekranı (maç bitmediyse) */}
      {roundEnd && !finished ? (
        <View style={styles.breakOverlay} pointerEvents="none">
          <Text
            style={[
              styles.breakVerdict,
              { color: roundEnd.winnerIsMe ? colors.success : colors.danger },
            ]}>
            {roundEnd.winnerIsMe ? 'TURU KAZANDIN' : 'TURU KAYBETTİN'}
          </Text>
          <Text style={styles.breakLabel}>gizli kelime</Text>
          <Text style={styles.breakWord}>{roundEndSecret ? upperTr(roundEndSecret) : '—'}</Text>
          <Text style={styles.breakScore}>
            Maç skoru <Text style={{ color: colors.success }}>{myWins}</Text>
            <Text style={{ color: colors.dim }}> – </Text>
            <Text style={{ color: colors.amber }}>{oppWins}</Text>
          </Text>
        </View>
      ) : null}

      {finished ? (
        <ResultOverlay
          contentType="word"
          single
          win={win}
          result={match.result ?? null}
          bestOf
          myWins={myWins}
          oppWins={oppWins}
          reward={
            reveal == null
              ? undefined
              : reveal.scored && reveal.ratingDelta != null
                ? { rating: reveal.ratingDelta, xp: reveal.xpDelta ?? 0, veri: reveal.veriDelta ?? 0 }
                : null
          }
          mySecret={finalSecret}
          theirSecret={null}
          opponentName={opponentName}
          opponentInitial={opponentName.charAt(0)}
          deck={signalDeck}
          incomingSignal={incomingSignal}
          onSendSignal={spectator ? sendCheer : sendSignal}
          onRematch={goRematch}
          onMenu={goMenu}
          spectator={spectator}
        />
      ) : null}

      {/* Tribün tezahürat akışı — rakip baloncuğundan bağımsız kanal. */}
      <CheerStream cheer={incomingCheer} />
    </Screen>
  );
}

/** Tek ORTAK geri sayım — kendi içinde 250 ms'de tikler (ekranı yenilemez). Düşük
 *  süre (<30 sn) uyarısı tur başına bir kez (onLowWarn geri çağrısıyla). */
function RaceClock({ match, onLowWarn }: { match: MatchState; onLowWarn: () => void }) {
  const [remaining, setRemaining] = useState(() => raceRemaining(match));
  useEffect(() => {
    setRemaining(raceRemaining(match));
    if (match.status !== 'active' || !match.turnStartedAt) return;
    const iv = setInterval(() => setRemaining(raceRemaining(match)), 250);
    return () => clearInterval(iv);
  }, [match]);

  const low = remaining > 0 && remaining < LOW_MS;
  const lowBuzzedRef = useRef(false);
  useEffect(() => {
    if (low && !lowBuzzedRef.current) {
      onLowWarn();
      lowBuzzedRef.current = true;
    } else if (!low) {
      lowBuzzedRef.current = false;
    }
  }, [low, onLowWarn]);

  return (
    <View style={styles.clockRow}>
      <View style={[styles.clockCard, !low && styles.clockCardActive, low && styles.clockCardLow]}>
        <Feather name="clock" size={13} color={low ? '#ff7b7b' : '#2FA8E0'} />
        <Text style={[styles.clockName, low && styles.clockNameLow]}>ortak süre</Text>
        <Text style={[styles.clockTime, styles.clockTimeActive, low && styles.clockTimeLow]}>
          {fmtClock(remaining)}
        </Text>
      </View>
    </View>
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
    backgroundColor: '#4ADE80',
    boxShadow: '0 0 8px #4ADE80',
  },
  badgeText: {
    color: '#4ADE80',
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  roundDots: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  roundDotsLabel: {
    color: '#6B8CAE',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 2,
  },
  roundDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  roundDotMine: {
    backgroundColor: '#4ADE80',
    boxShadow: '0 0 6px #4ADE80',
  },
  roundDotTheirs: {
    backgroundColor: '#F87171',
    boxShadow: '0 0 6px rgba(248,113,113,0.6)',
  },
  secretRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secretLabel: {
    color: '#3A5878',
    fontSize: 11,
  },
  oppCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 13,
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  oppLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  oppAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(47,168,224,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(47,168,224,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  oppAvatarText: {
    color: '#2FA8E0',
    fontSize: 13,
    fontWeight: '600',
  },
  oppName: {
    color: '#C8DCF0',
    fontSize: 13,
    fontWeight: '600',
  },
  oppStat: {
    color: '#6B8CAE',
    fontSize: 11,
    fontFamily: mono,
  },
  closeWrap: {
    alignItems: 'flex-end',
    gap: 5,
  },
  closeStat: {
    alignItems: 'flex-end',
  },
  closeLabel: {
    color: '#6B8CAE',
    fontSize: 9,
    marginBottom: 3,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  closeTrack: {
    width: 54,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  closeFill: {
    height: '100%',
    borderRadius: 3,
  },
  clockRow: {
    flexDirection: 'row',
    gap: 8,
  },
  clockCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  clockCardActive: {
    backgroundColor: 'rgba(47,168,224,0.12)',
    borderColor: 'rgba(47,168,224,0.45)',
    boxShadow: '0 0 14px rgba(47,168,224,0.2)',
  },
  clockName: {
    color: '#6B8CAE',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  clockNameLow: {
    color: '#ff9a9a',
  },
  clockTime: {
    color: '#8FA9C4',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: mono,
  },
  clockTimeActive: {
    color: '#2FA8E0',
  },
  clockTimeLow: {
    color: '#ff7b7b',
  },
  clockCardLow: {
    backgroundColor: 'rgba(255,123,123,0.12)',
    borderColor: 'rgba(255,123,123,0.55)',
    boxShadow: '0 0 14px rgba(255,123,123,0.22)',
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
  history: {
    maxHeight: 168,
    flexGrow: 0,
  },
  historyBody: {
    gap: 6,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  histTiles: {
    flex: 1,
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
  entryTileLocked: {
    opacity: 0.5,
  },
  entryTileText: {
    color: '#E8F0FF',
    fontSize: 21,
    fontWeight: '700',
    fontFamily: mono,
  },
  // Bilinen yeşil harfin silik ipucu — dikkat dağıtmayacak kadar soluk.
  entryTileGhost: {
    color: colors.success,
    opacity: 0.32,
  },
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  requestRow: {
    alignItems: 'center',
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
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  confirmFill: {
    flex: 1,
  },
  breakOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 28,
    backgroundColor: 'rgba(6,12,26,0.9)',
  },
  breakVerdict: {
    fontSize: 26,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 2,
    textShadowRadius: 18,
    marginBottom: 6,
  },
  breakLabel: {
    color: colors.dim,
    fontSize: 10,
    fontFamily: mono,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  breakWord: {
    color: colors.ice,
    fontSize: 30,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 3,
    textShadowColor: colors.cyan,
    textShadowRadius: 16,
  },
  breakScore: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    color: colors.ice,
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
    borderColor: 'rgba(47,168,224,0.4)',
    backgroundColor: 'rgba(47,168,224,0.12)',
  },
  noteExitText: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
});
