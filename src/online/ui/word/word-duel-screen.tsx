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

import { knownGreenLetters, opponentKnowledge, parseWord, upperTr, type LetterMark } from '@/game';
import {
  getMatchReveal,
  getMyMarks,
  getMyRank,
  getRoundReveal,
  makeGuess,
  OnlineError,
  useLiveClocks,
  useMatch,
  useMatchSession,
  type MatchReveal,
  type MatchState,
  type RoundReveal,
} from '@/online';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

import { ResultOverlay } from '../duel/result-overlay';
import { CheerBar, CheerStream, TribuneBadge } from '../spectate/tribune';
import { WordOrbs } from './orbs';
import { EmoteBar, IncomingReaction } from './emote-bar';
import { RequestWordButton } from './request-word-button';
import { recallMySecret } from './secret-memory';
import { TrKeyboard } from './tr-keyboard';
import { WordConfirmButton } from './word-parts';
import { WordSetupPanel } from './word-setup-panel';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

const errMsg = (e: unknown) => {
  if (e instanceof OnlineError) {
    if (e.code === 'invalid_digits') return 'Bu kelime sözlükte yok ya da uzunluk yanlış.';
    return e.message;
  }
  return 'Bağlantı hatası, lütfen tekrar dene.';
};

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Kendi süre bu eşiğin altına düşünce: saat kırmızılaşır + belirgin uzun titreşim.
const LOW_MS = 30_000;
// Süre-azaldı titreşimi: SIRA DEĞİŞİMİNDEKİ tek kısa darbeden (turn=Heavy) ayrışsın
// diye uzun + çift-darbeli desen. Android'de gerçek süre, iOS'ta iki ayrı darbe.
const LOW_TIME_VIBRATION = [0, 500, 160, 500];

/** Kelime düello ekranı — duello-ekrani-v2 tasarımı birebir. Mantık katmanı
 *  sayı düellosuyla (duel-screen) aynı desen: useMatch realtime + sunucu RPC,
 *  merkezi sahiplik, çıkış onayı, sonuç overlay'i. Kelime modu PROTOKOLSÜZ
 *  (protokoller yalnız sayı modunda). Rakibin TAHMİNLERİ asla gösterilmez;
 *  yalnız ilerleme/yakınlık. */
export function WordDuelScreen({
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
  // KENDİ tahminlerimin per-harf renkleri (tahmin id → 'GYX'). Sunucudan
  // YALNIZ çağırana gelir (make_guess dönüşü + getMyMarks); rakibinki ASLA.
  const [myMarks, setMyMarks] = useState<Record<number, string>>({});
  const [reveal, setReveal] = useState<MatchReveal | null>(null);
  const [signalDeck, setSignalDeck] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  // Havuz-dışı (tam) tahmin → "Sözlüğe öner" için tutulan kelime; harf değişince temizlenir.
  const [notInPoolWord, setNotInPoolWord] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastRound, setLastRound] = useState<{ winnerIsMe: boolean; reason: 'win' | 'timeout' } | null>(
    null,
  );
  // Biten turun iki gizli kelimesi (tur-arası break ekranında gösterilir).
  // round ile eşlenir → bayat turun ifşası gösterilmez.
  const [roundReveal, setRoundReveal] = useState<({ round: number } & RoundReveal) | null>(null);

  // Ses/haptik tercihleri (sayı düellosuyla aynı kaynak).
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
    (kind: 'tap' | 'feedback' | 'win' | 'lose' | 'turn' | 'warn') => {
      if (!hapticsOn || !canHaptics) return;
      if (kind === 'tap') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      else if (kind === 'feedback') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      else if (kind === 'turn') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      else if (kind === 'warn') Vibration.vibrate(LOW_TIME_VIBRATION);
      else if (kind === 'win') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
    [hapticsOn],
  );
  // Kararlı referans: WordClockRow'un düşük-süre effect'i her render'da tetiklenmesin.
  const buzzWarn = useCallback(() => buzz('warn'), [buzz]);

  // ── Türetilmiş durum ──────────────────────────────────────────
  const status = match?.status ?? null;
  const finished = status === 'finished';
  const myId = match ? (match.myRole === 'player1' ? match.player1.id : match.player2?.id ?? '') : '';
  const isMine = !!match && status === 'active' && match.currentTurn === myId;
  // Seyircide klavye/onay HER ZAMAN kilitli.
  const locked = spectator || !isMine;
  const wordLength = match?.wordLength ?? 5;

  const p1 = match?.myRole === 'player1';
  const opponentName =
    (match ? (match.myRole === 'player1' ? match.player2?.username : match.player1.username) : null) ??
    'Rakip';
  const round = match?.currentRound ?? 1;
  const myWins = match ? (p1 ? match.p1RoundWins : match.p2RoundWins) : 0;
  const oppWins = match ? (p1 ? match.p2RoundWins : match.p1RoundWins) : 0;
  const myGuesses = guesses.filter((g) => g.guesser === myId && g.round === round);
  const oppGuesses = guesses.filter((g) => g.guesser !== myId && g.round === round);
  const win = finished && !!match?.winner && match.winner === myId;
  const mySecret = recallMySecret(matchId, round);

  // Rakip ilerlemesi (Wordle): BİRİKİMLİ bilgi durumu — tur boyunca rakibin
  // gizli kelimemden öğrendiği tutarlı yeşil/sarı (bkz. opponentKnowledge). Bir
  // sarı yeşile oturunca sarı−1/yeşil+1; yeni yeşilde sarı sabit; bilgi düşmez.
  // Kendi gizlim elimde (recallMySecret) → rakip tahminlerinin işaretlerini
  // istemcide hesaplarız (rakibin digits'i RLS ile zaten gelir; sunucu değişmez).
  // Gizli yerelde yoksa (nadir: farklı cihaz/temiz depo) sunucu sayılarının
  // bağımsız-max'ına düşeriz — asla çökmez. Hiç rakip tahmini yoksa 0.
  const hasOppGuess = oppGuesses.length > 0;
  const oppGuessKey = oppGuesses.map((g) => g.digits).join('|');
  const oppKnow = useMemo(
    () => (mySecret ? opponentKnowledge(mySecret, oppGuesses.map((g) => g.digits)) : null),
    // oppGuessKey tahmin kümesini özetler (oppGuesses referansı her render değişir).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mySecret, oppGuessKey],
  );
  const oppBestGreen = oppKnow
    ? oppKnow.green
    : oppGuesses.reduce((mx, g) => Math.max(mx, g.greenCount ?? 0), 0);
  const oppBestYellow = oppKnow
    ? oppKnow.yellow
    : oppGuesses.reduce((mx, g) => Math.max(mx, g.yellowCount ?? 0), 0);
  const greenPct = wordLength > 0 ? oppBestGreen / wordLength : 0;
  const yellowPct = wordLength > 0 ? oppBestYellow / wordLength : 0;

  // Klavye harf renkleri: KENDİ tahminlerimin (myMarks) per-harf renklerinden.
  // Öncelik G > Y > X; bir kez yeşil olan yeşil kalır. Denenmemiş harf nötr.
  const keyStates = useMemo(() => {
    const rank: Record<LetterMark, number> = { X: 0, Y: 1, G: 2 };
    const map: Record<string, LetterMark> = {};
    for (const g of myGuesses) {
      const ms = myMarks[g.id];
      if (!ms) continue;
      const letters = Array.from(g.digits);
      const marks = Array.from(ms) as LetterMark[];
      for (let i = 0; i < letters.length; i++) {
        const mk = marks[i];
        const ch = letters[i];
        if (!mk) continue;
        const cur = map[ch];
        if (cur === undefined || rank[mk] > rank[cur]) map[ch] = mk;
      }
    }
    return map;
  }, [myGuesses, myMarks]);

  // Bilinen yeşiller: input'ta boş pozisyonlara silik ipucu (KENDİ marks'ımdan).
  const knownGreens = useMemo(
    () => knownGreenLetters(myGuesses.map((g) => ({ word: g.digits, marks: myMarks[g.id] ?? '' })), wordLength),
    [myGuesses, myMarks, wordLength],
  );

  // Yeniden bağlanma/ekrana giriş: eksik kalan KENDİ tahminlerimin renklerini
  // sunucudan çek (get_my_marks guesser=auth.uid() ile filtreli → rakibinki
  // ASLA gelmez). myGuessKey değişince (yeni kendi tahminim) eksik varsa çağrılır.
  const myGuessKey = myGuesses.map((g) => g.id).join(',');
  useEffect(() => {
    if (match?.contentType !== 'word' || !myGuessKey) return;
    const ids = myGuessKey.split(',').map(Number);
    if (!ids.some((id) => myMarks[id] === undefined)) return;
    let alive = true;
    getMyMarks(matchId, spectateAs)
      .then((m) => alive && setMyMarks((prev) => ({ ...prev, ...m })))
      .catch(() => {});
    return () => {
      alive = false;
    };
    // myMarks kasıtlı dep değil (functional update); tetikleyici myGuessKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myGuessKey, matchId, match?.contentType, spectateAs]);

  useEffect(() => {
    if (!isMine) setEntry([]);
  }, [isMine]);

  // Sıra BANA geçince (false→true) haptik "senin sıran" darbesi (ayar açıksa;
  // buzz zaten hapticsOn+canHaptics kapılı). Rakibe devredince titremez.
  const prevIsMineRef = useRef(false);
  useEffect(() => {
    if (isMine && !prevIsMineRef.current) buzz('turn');
    prevIsMineRef.current = isMine;
  }, [isMine, buzz]);

  // Seyirci maçı SAHİPLENMEZ (leave/forfeit yolu ona hiç açılmaz).
  useEffect(() => {
    if (spectator) return;
    session.claim(matchId, 'match');
  }, [matchId, session, spectator]);

  // Biten turun sonucu (Best of 3 tur arası için) — sayı düellosuyla aynı.
  const prevScoreRef = useRef({ p1: 0, p2: 0 });
  const processedRoundRef = useRef(1);
  useEffect(() => {
    if (!match) return;
    if (match.status === 'active') {
      prevScoreRef.current = { p1: match.p1RoundWins, p2: match.p2RoundWins };
      return;
    }
    if (
      match.status === 'setup' &&
      match.currentRound > 1 &&
      processedRoundRef.current !== match.currentRound
    ) {
      processedRoundRef.current = match.currentRound;
      const prevRound = match.currentRound - 1;
      const winGuess = guesses.find((g) => g.round === prevRound && g.feedback === 'win');
      if (winGuess) {
        setLastRound({ winnerIsMe: winGuess.guesser === myId, reason: 'win' });
      } else {
        const winnerIsP1 = match.p1RoundWins - prevScoreRef.current.p1 > 0;
        setLastRound({ winnerIsMe: winnerIsP1 === p1, reason: 'timeout' });
      }
      prevScoreRef.current = { p1: match.p1RoundWins, p2: match.p2RoundWins };
      // Biten turun İKİ kelimesini çek (break ekranı için). Kendi kelimem yerelde
      // varsa anında göster; rakibinki (ve otoriteli kendi) RPC ile gelir.
      // Seyircide yerel hafıza YOKTUR (kelime izlenen oyuncunun cihazında) →
      // ifşa yalnız sunucudan gelir; gelene dek "—".
      setRoundReveal({
        round: prevRound,
        mine: spectator ? null : recallMySecret(matchId, prevRound),
        opponent: null,
      });
      getRoundReveal(matchId, prevRound, spectateAs)
        .then((r) => setRoundReveal({ round: prevRound, ...r }))
        .catch(() => {});
    }
  }, [match, guesses, p1, myId, matchId, spectateAs, spectator]);

  // Maç bitince reveal + sinyal destesi (sayı düellosuyla aynı).
  useEffect(() => {
    if (!finished) return;
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
    return () => {
      alive = false;
    };
  }, [finished, matchId, spectateAs]);
  // Sinyal destesini maç BAŞINDA yükle (maç-içi emote + maç-sonu reaksiyon için).
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
    router.replace({ pathname: '/online', params: { word: '1' } });
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
    setNotInPoolWord(null); // harf silinince "Sözlüğe öner" kaybolur (kısa kelime önerilemez)
    setEntry((g) => {
      if (g.length === 0) return g;
      buzz('tap');
      return g.slice(0, -1);
    });
  }, [buzz]);

  // Çift-gönderim kilidi: `submitting` STATE'i asenkron → aynı frame'de iki dokunuş
  // ikisi de geçebilir (sunucu ikincisini reddedip sahte toast doğurur). Ref senkron
  // kapatır.
  const submitLatchRef = useRef(false);
  const submit = useCallback(async () => {
    if (locked || submitting || submitLatchRef.current || entry.length < wordLength) return;
    const word = entry.join('');
    const parsed = parseWord(word);
    if (!parsed.ok) return; // istemci ön-doğrulaması; nihai otorite sunucu
    submitLatchRef.current = true;
    setSubmitting(true);
    setActionError(null);
    setNotInPoolWord(null);
    try {
      const outcome = await makeGuess(matchId, parsed.word, 'word');
      setEntry([]);
      // Per-harf renkler ANINDA (kendi tahtam): make_guess dönüşünden id+marks.
      if (outcome.guessId != null && outcome.marks) {
        const { guessId, marks } = outcome;
        setMyMarks((prev) => ({ ...prev, [guessId]: marks }));
      }
      if (outcome.feedback === 'win') {
        play('win');
        buzz('win');
      } else {
        play('good');
        buzz('feedback');
      }
    } catch (e) {
      setActionError(errMsg(e));
      // invalid_digits + entry uzunluğu tam (parseWord geçti) → havuz-dışı: öner.
      if (e instanceof OnlineError && e.code === 'invalid_digits') setNotInPoolWord(parsed.word);
    } finally {
      submitLatchRef.current = false;
      setSubmitting(false);
    }
  }, [locked, submitting, entry, wordLength, matchId, play, buzz]);

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
          {loading ? <ActivityIndicator color={colors.cyan} /> : <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>}
          <Pressable onPress={goMenu} hitSlop={8} style={styles.noteExit}>
            <Text style={styles.noteExitText}>Ana Menü</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // Turlar arası belirleme (Best of 3): kelime paneli düello ekranı içinde.
  // Seyircide gizli kelime girişi yoktur → sade bekleme paneli.
  if (status === 'setup') {
    if (spectator) {
      return (
        <Screen float="letters">
          <WordOrbs />
          <View style={styles.content}>
            <View style={styles.headerRow}>
              {exitButton}
              <View style={styles.tribuneSlot}>
                <TribuneBadge count={spectatorCount} />
              </View>
            </View>
            <View style={styles.centered}>
              <ActivityIndicator color={colors.violet} />
              <Text style={styles.note}>
                {`Tur ${match.currentRound} · oyuncular gizli kelimelerini belirliyor…`}
              </Text>
            </View>
            <CheerBar deck={signalDeck} onCheer={sendCheer} />
          </View>
          <CheerStream cheer={incomingCheer} />
        </Screen>
      );
    }
    return (
      <Screen float="letters">
        <WordOrbs />
        <View style={styles.content}>
          <View style={styles.headerRow}>{exitButton}</View>
          <WordSetupPanel
            matchId={matchId}
            match={match}
            active
            lastRound={lastRound}
            reveal={roundReveal && roundReveal.round === match.currentRound - 1 ? roundReveal : null}
          />
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
          <Text style={styles.note}>Oyun başlıyor…</Text>
        </View>
      </Screen>
    );
  }

  // Geçmiş: tüm tur tahminleri kaydırılabilir listede (yeni en altta); ~4 satır
  // görünür, öncekiler scroll ile görülür.
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
            <Text style={styles.badgeText}>düello · {wordLength} harf</Text>
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

        {/* gizli kelimem (küçük, soluk — göz ikonu yok) */}
        <View style={styles.secretRow}>
          <Text style={styles.secretLabel}>gizli kelimen:</Text>
          <Text style={styles.secretWord}>{mySecret ? upperTr(mySecret) : '—'}</Text>
        </View>

        {/* Rakip ilerleme kartı: tahmin sayısı + EN İYİ yeşil/sarı (korunur, düşmez).
            Sunucu yalnız rakip-güvenli SAYI gönderir (per-harf dizi/pozisyon gelmez). */}
        <View style={styles.oppCard}>
          <View style={styles.oppLeft}>
            <View style={styles.oppAvatar}>
              <Text style={styles.oppAvatarText}>{opponentName.charAt(0).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.oppName}>{opponentName}</Text>
              <Text style={styles.oppStat}>{oppGuesses.length} tahmin</Text>
            </View>
          </View>
          <View style={styles.closeWrap}>
            {hasOppGuess ? (
              <>
                <View style={styles.closeStat}>
                  <Text style={styles.closeLabel}>{oppBestGreen}/{wordLength} yeşil</Text>
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
                  <Text style={styles.closeLabel}>{oppBestYellow}/{wordLength} sarı</Text>
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
              <Text style={styles.closeLabel}>henüz tahmin yok</Text>
            )}
          </View>
          {/* Gelen emote/mesaj — rakip kartının tam ortasında pop'lar, ~2.6 sn */}
          <IncomingReaction signal={incomingSignal} text={incomingText} />
        </View>

        {/* Satranç saati — kendi içinde tikler (ekranı 250 ms'de bir yenilemez) */}
        {match ? <WordClockRow match={match} onLowWarn={buzzWarn} /> : null}

        {/* ORTA: tahmin geçmişi — kaydırılabilir (yeni en altta, otomatik kayar) */}
        <View style={styles.middle}>
          <Text style={styles.sectionLabel}>tahminlerin</Text>
          <ScrollView
            ref={historyRef}
            style={styles.history}
            contentContainerStyle={styles.historyBody}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => historyRef.current?.scrollToEnd({ animated: true })}>
            {myGuesses.map((g) => {
              // KENDİ tahminimin per-harf renkleri (sunucudan, yalnız bana).
              const rowMarks = myMarks[g.id];
              return (
              <View key={g.id} style={styles.histRow}>
                <View style={styles.histTiles}>
                  {Array.from(g.digits).map((ch, ci) => {
                    // 'X'/yok ya da renk henüz gelmedi → şeffaf (varsayılan hücre).
                    const mk = rowMarks?.[ci] as LetterMark | undefined;
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
                        <Text style={[styles.histTileText, colored && styles.histTileTextOn]}>{upperTr(ch)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
              );
            })}
            {myGuesses.length === 0 ? (
              <Text style={styles.histEmpty}>
                {isMine ? 'İlk tahminini yap' : 'Rakibin sırası…'}
              </Text>
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

        {/* KLAVYE + ONAY BUTONU (belirleme ekranıyla aynı desen): onay tuşu
            klavyeden çıktı; tek aksiyon butonu klavyenin ÜSTÜNDE. */}
        {spectator ? (
          /* Seyircide klavye/onay YOK — yerine tribün barı. */
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
                  enabled={entry.length === wordLength && !locked && !submitting}
                  busy={submitting}
                  onPress={submit}
                />
              </View>
            </View>
            <TrKeyboard
              large
              onKey={addLetter}
              onDelete={deleteLetter}
              locked={locked || submitting}
              letterStates={keyStates}
            />
          </View>
        )}
      </View>

      {finished ? (
        <ResultOverlay
          contentType="word"
          win={win}
          result={match?.result ?? null}
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
          mySecret={reveal?.mine ?? null}
          theirSecret={reveal?.opponent ?? null}
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

/** Satranç saati satırı — kendi içinde useLiveClocks ile tikler; saat tiki koca
 *  kelime düellosu ekranını değil YALNIZ bu satırı yeniler. Düşük-süre (<30 sn)
 *  uyarı haptiği de round başına bir kez burada (onLowWarn geri çağrısıyla). */
function WordClockRow({ match, onLowWarn }: { match: MatchState; onLowWarn: () => void }) {
  const clocks = useLiveClocks(match);
  const iAmP1 = match.myRole === 'player1';
  const myClockMs = iAmP1 ? clocks.clock1Ms : clocks.clock2Ms;
  const oppClockMs = iAmP1 ? clocks.clock2Ms : clocks.clock1Ms;
  const myId = iAmP1 ? match.player1.id : match.player2?.id ?? '';
  const isMine = match.status === 'active' && match.currentTurn === myId;
  const myLow = myClockMs > 0 && myClockMs < LOW_MS; // kendi kalan süre <30 sn

  // Kendi süre 30 sn altına İLK düştüğünde bir kez haptik (round başına). Tekrar
  // yok; saat >30 olunca (yeni tur) yeniden silahlanır.
  const lowBuzzedRef = useRef(false);
  useEffect(() => {
    if (myLow && !lowBuzzedRef.current) {
      onLowWarn();
      lowBuzzedRef.current = true;
    } else if (!myLow) {
      lowBuzzedRef.current = false;
    }
  }, [myLow, onLowWarn]);

  return (
    <View style={styles.clockRow}>
      <View style={[styles.clockCard, !isMine && styles.clockCardActive]}>
        <Text style={[styles.clockName, !isMine && styles.clockNameActive]}>rakip</Text>
        <Text style={[styles.clockTime, !isMine && styles.clockTimeActive]}>{fmtClock(oppClockMs)}</Text>
        {!isMine ? <View style={styles.clockDot} /> : null}
      </View>
      <View
        style={[
          styles.clockCard,
          isMine && !myLow && styles.clockCardActive,
          myLow && styles.clockCardLow,
        ]}>
        <Text style={[styles.clockName, isMine && !myLow && styles.clockNameActive, myLow && styles.clockNameLow]}>
          sen
        </Text>
        <Text style={[styles.clockTime, isMine && !myLow && styles.clockTimeActive, myLow && styles.clockTimeLow]}>
          {fmtClock(myClockMs)}
        </Text>
        {isMine ? <View style={[styles.clockDot, myLow && styles.clockDotLow]} /> : null}
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
  tribuneSlot: {
    marginLeft: 'auto',
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
    gap: 7,
  },
  secretLabel: {
    color: '#3A5878',
    fontSize: 11,
  },
  secretWord: {
    color: '#6A88A8',
    fontSize: 13,
    letterSpacing: 2,
    fontFamily: mono,
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
    color: '#FBBF24',
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
    gap: 6,
    paddingVertical: 7,
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
    fontSize: 10,
  },
  clockNameActive: {
    color: '#2FA8E0',
  },
  clockTime: {
    color: '#8FA9C4',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: mono,
  },
  clockTimeActive: {
    color: '#2FA8E0',
    fontWeight: '700',
  },
  clockDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#2FA8E0',
    boxShadow: '0 0 6px #2FA8E0',
  },
  // Süre <30 sn — kendi saat kartı kırmızı (aktif-cyan'ı ezer).
  clockCardLow: {
    backgroundColor: 'rgba(255,123,123,0.12)',
    borderColor: 'rgba(255,123,123,0.55)',
    boxShadow: '0 0 14px rgba(255,123,123,0.22)',
  },
  clockNameLow: {
    color: '#ff9a9a',
  },
  clockTimeLow: {
    color: '#ff7b7b',
    fontWeight: '700',
  },
  clockDotLow: {
    backgroundColor: '#ff7b7b',
    boxShadow: '0 0 6px #ff7b7b',
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
    // ~4 satır görünür (satır 34 + boşluk 6); fazlası scroll ile. flexGrow:0 →
    // flex sütununda büyümez, içerik kadar (maxHeight'e kadar) yer kaplar.
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
  // Wordle yeşil/sarı — kelime modu pozisyon sızdırır (bilinçli). 'X' = şeffaf
  // (varsayılan histTile). Klavyedeki "denenmiş ama yok"=gri ondan AYRI.
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
    // Screen yatay padding'i 20 — backdrop kenarlara KADAR uzanır (tam genişlik).
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
