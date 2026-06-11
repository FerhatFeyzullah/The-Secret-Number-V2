import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Redirect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { parseWord } from '@/game';
import {
  activateProtocol,
  getMatchReveal,
  getMyHand,
  getMyRank,
  makeGuess,
  OnlineError,
  feedbackToGuessResult,
  useMatch,
  useMatchSession,
  type GuessFeedback,
  type MatchReveal,
  type OnlineGuess,
} from '@/online';
import { getProtocol } from '@/protocols/catalog';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, mono, withAlpha } from '@/ui/theme';

import { ProtocolNotice, type DuelNotice } from '../duel/protocol-notice';
import { ResultOverlay } from '../duel/result-overlay';
import type { FeatherName } from '../parts';
import { PILLAR_COLOR, OPPONENT_VISIBLE_PROTOCOLS, protocolIcon } from '../protocol-visuals';
import { WordOrbs } from './orbs';
import { recallMySecret } from './secret-memory';
import { TrKeyboard } from './tr-keyboard';
import { WordSetupPanel } from './word-setup-panel';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';
/** Sis Perdesi: işaretli tahminin feedback'i bu kadar geç gösterilir. */
const FOG_MS = 4000;

const errMsg = (e: unknown) => {
  if (e instanceof OnlineError) {
    if (e.code === 'invalid_digits') return 'Bu kelime sözlükte yok ya da uzunluk yanlış.';
    return e.message;
  }
  return 'Bağlantı hatası, lütfen tekrar dene.';
};

/** Protokol çubuğu kısa etiketleri (tasarım: "+ süre" gibi minik ad).
 *  Kelime elinde yalnız içerik-bağımsız protokoller bulunur (info Faz 4). */
const SHORT_LABEL: Record<string, string> = {
  time_add: '+ süre',
  time_freeze: 'dondur',
  time_slow: 'yavaşlat',
  time_steal: 'saat çal',
  def_shield: 'kalkan',
  def_reflect: 'yansıt',
  disrupt_fog: 'sis',
  disrupt_silence: 'sustur',
  disrupt_waste: 'harcat',
  disrupt_deceive: 'yanılt',
};

const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Feedback → "kaç harf doğru" sayısı (yakınlık/rozet için). */
function correctOf(feedback: GuessFeedback, wordLength: number): number {
  const r = feedbackToGuessResult(feedback);
  if (r.status === 'partial') return r.correctCount;
  return wordLength; // dcwo/win: tüm harfler doğru
}

/** Tahmin satırı feedback çipi: "N doğru" / "yer yanlış" / "buldu!".
 *  HARF RENKLENDİRME YOK — pozisyon sızmaz; sisli tahmin kısa süre maskelenir. */
function FeedbackBadge({ entry, wordLength }: { entry: OnlineGuess; wordLength: number }) {
  const [, force] = useState(0);
  const age = Date.now() - Date.parse(entry.createdAt);
  const masked = !!entry.fogged && age < FOG_MS;
  useEffect(() => {
    if (!masked) return;
    const t = setTimeout(() => force((x) => x + 1), FOG_MS - age + 60);
    return () => clearTimeout(t);
  }, [masked, age]);

  let label: string;
  let bg: string;
  let color: string;
  if (masked) {
    label = '···';
    bg = 'rgba(255,255,255,0.06)';
    color = '#8FA9C4';
  } else if (entry.feedback === 'win') {
    label = 'buldu!';
    bg = withAlpha(colors.success, 0.18);
    color = colors.success;
  } else if (entry.feedback === 'digits_correct_wrong_order') {
    label = 'yer yanlış';
    bg = 'rgba(251,191,36,0.18)';
    color = '#FBBF24';
  } else {
    const n = correctOf(entry.feedback, wordLength);
    label = `${n} doğru`;
    if (n >= wordLength - 1) {
      bg = 'rgba(251,191,36,0.18)';
      color = '#FBBF24';
    } else if (n >= wordLength - 2) {
      bg = 'rgba(251,191,36,0.12)';
      color = '#FBBF24';
    } else {
      bg = 'rgba(255,255,255,0.06)';
      color = '#8FA9C4';
    }
  }
  return (
    <View style={[styles.fbChip, { backgroundColor: bg }]}>
      <Text style={[styles.fbChipText, { color }]}>{label}</Text>
    </View>
  );
}

/** Kelime düello ekranı — duello-ekrani-v2 tasarımı birebir. Mantık katmanı
 *  sayı düellosuyla (duel-screen) aynı desen: useMatch realtime + sunucu RPC,
 *  protokol kullanımı/bildirimi, merkezi sahiplik, çıkış onayı, sonuç overlay'i.
 *  Rakibin TAHMİNLERİ asla gösterilmez; yalnız ilerleme/yakınlık. */
export function WordDuelScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const session = useMatchSession();
  const { width } = useWindowDimensions();
  const {
    match,
    guesses,
    clocks,
    loading,
    error,
    sendSignal,
    incomingSignal,
    protocolUses,
    incomingProtocolUse,
  } = useMatch(matchId);

  const [entry, setEntry] = useState<string[]>([]);
  const [reveal, setReveal] = useState<MatchReveal | null>(null);
  const [signalDeck, setSignalDeck] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastRound, setLastRound] = useState<{ winnerIsMe: boolean; reason: 'win' | 'timeout' } | null>(
    null,
  );

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
  const wordLength = match?.wordLength ?? 5;

  const p1 = match?.myRole === 'player1';
  const myClockMs = p1 ? clocks.clock1Ms : clocks.clock2Ms;
  const oppClockMs = p1 ? clocks.clock2Ms : clocks.clock1Ms;
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

  // Rakip ilerlemesi: tahmin sayısı + en iyi yakınlık (tahminleri GÖSTERME).
  const oppBest = useMemo(
    () => oppGuesses.reduce((b, g) => Math.max(b, correctOf(g.feedback, wordLength)), 0),
    [oppGuesses, wordLength],
  );
  const closeness = wordLength > 0 ? oppBest / wordLength : 0;

  useEffect(() => {
    if (!isMine) setEntry([]);
  }, [isMine]);

  useEffect(() => {
    session.claim(matchId, 'match');
  }, [matchId, session]);

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
    }
  }, [match, guesses, p1, myId]);

  // ── Protokoller (kelime elinde yalnız içerik-bağımsız olanlar) ──
  const [myProtocols, setMyProtocols] = useState<string[] | null>(null);
  const [shieldArmed, setShieldArmed] = useState(false);
  const [reflectArmed, setReflectArmed] = useState(false);
  useEffect(() => {
    if (myProtocols !== null) return;
    let alive = true;
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const h = await getMyHand(matchId);
          if (!alive) return;
          setMyProtocols(h.selected);
          setShieldArmed(h.shieldArmed);
          setReflectArmed(h.reflectArmed);
          return;
        } catch {
          if (!alive) return;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      if (alive) setMyProtocols([]);
    })();
    return () => {
      alive = false;
    };
  }, [matchId, myProtocols]);

  const silencedMe = !!match && (p1 ? match.silencedP1 : match.silencedP2);

  // Bildirimler (sayı modundaki sistemin AYNISI — ProtocolNotice yeniden kullanım).
  const [notices, setNotices] = useState<DuelNotice[]>([]);
  const noticeIdRef = useRef(0);
  const showToast = useCallback(
    (text: string, opts?: { accent?: string; icon?: FeatherName }) => {
      noticeIdRef.current += 1;
      const n: DuelNotice = { id: noticeIdRef.current, text, accent: opts?.accent, icon: opts?.icon };
      setNotices((q) => [...q, n].slice(-4));
    },
    [],
  );
  const dismissNotice = useCallback((nid: number) => {
    setNotices((q) => q.filter((x) => x.id !== nid));
  }, []);

  const [localUsedIds, setLocalUsedIds] = useState<Set<string>>(() => new Set());
  const myUsedIds = useMemo(() => {
    const ids = new Set(localUsedIds);
    for (const u of protocolUses) if (u.player === myId) ids.add(u.protocolId);
    return ids;
  }, [protocolUses, myId, localUsedIds]);

  type TileStatus = 'ready' | 'armed' | 'cooldown' | 'blocked';
  const protocolTiles = useMemo(
    () =>
      (myProtocols ?? []).map((id) => {
        let st: TileStatus;
        if ((id === 'def_shield' && shieldArmed) || (id === 'def_reflect' && reflectArmed)) st = 'armed';
        else if (myUsedIds.has(id)) st = 'cooldown';
        else if (silencedMe) st = 'blocked';
        else {
          const timing = getProtocol(id)?.usageTiming ?? 'own_turn';
          st = status === 'active' && (timing !== 'own_turn' || isMine) ? 'ready' : 'blocked';
        }
        return { id, status: st };
      }),
    [myProtocols, myUsedIds, status, isMine, shieldArmed, reflectArmed, silencedMe],
  );

  // Protokol kullan — sayı düellosundaki akışın içerik-bağımsız alt kümesi.
  const [protoBusy, setProtoBusy] = useState(false);
  const runProtocol = useCallback(
    async (id: string) => {
      if (protoBusy) return;
      setProtoBusy(true);
      buzz('tap');
      try {
        const res = await activateProtocol(matchId, id);
        if (res.consumed !== false) setLocalUsedIds((prev) => new Set(prev).add(id));
        play('good');
        buzz('feedback');
        const protoSelf = getProtocol(id);
        const meta = protoSelf
          ? { accent: PILLAR_COLOR[protoSelf.pillar], icon: protocolIcon(id) }
          : undefined;
        switch (id) {
          case 'time_add':
            showToast('Süre Enjeksiyonu · +12 sn', meta);
            break;
          case 'time_steal':
            showToast(
              res.stolenMs
                ? `Saat Çalma · rakipten +${Math.round(res.stolenMs / 1000)} sn`
                : 'Saat Çalma · rakipte çalınacak süre yok',
              meta,
            );
            break;
          case 'time_freeze':
            showToast('Dondur · saatin bu tur işlemiyor', meta);
            break;
          case 'time_slow':
            showToast('Yavaşlat · rakip saati 1.5× akacak', meta);
            break;
          case 'def_shield':
            setShieldArmed(true);
            showToast('Kalkan kuruldu · gelen ilk engeli bloklar', meta);
            break;
          case 'def_reflect':
            setReflectArmed(true);
            showToast('Yansıtma kuruldu · ilk engeli sahibine döner', meta);
            break;
          case 'disrupt_fog':
          case 'disrupt_silence':
          case 'disrupt_waste':
          case 'disrupt_deceive': {
            const protoName = getProtocol(id)?.name ?? 'Engel';
            if (res.blocked) {
              showToast(`${protoName} bloklandı`, { accent: colors.dim, icon: 'shield' });
            } else if (res.reflected) {
              buzz('lose');
              showToast(`${protoName} yansıdı · etkisi sana döndü`, {
                accent: colors.danger,
                icon: 'corner-up-left',
              });
            } else if (id === 'disrupt_fog') {
              showToast('Sis Perdesi · rakibin geri bildirimi gecikecek', meta);
            } else if (id === 'disrupt_silence') {
              showToast('Susturma · rakip sıradaki turunda protokol kullanamaz', meta);
            } else if (id === 'disrupt_deceive') {
              showToast('Yanıltma · rakibin sonraki geri bildirimi şişecek', meta);
            } else if (res.noTargetProtocol) {
              showToast('Rakibin harcanacak protokolü yok — hak harcanmadı', meta);
            } else {
              const wastedName = res.wastedProtocol
                ? getProtocol(res.wastedProtocol)?.name ?? res.wastedProtocol
                : 'protokol';
              showToast(`Zorla Harca · rakibin ${wastedName} tüketildi`, meta);
            }
            break;
          }
          default:
            showToast('Protokol kullanıldı', meta);
        }
      } catch (e) {
        showToast(errMsg(e), { accent: colors.danger, icon: 'alert-triangle' });
        if (e instanceof OnlineError && e.code === 'protocol_already_used') {
          setLocalUsedIds((prev) => new Set(prev).add(id));
        }
      } finally {
        setProtoBusy(false);
      }
    },
    [protoBusy, matchId, play, buzz, showToast],
  );

  // Canlı protokol olayı bildirimi (sayı düellosuyla aynı kurallar).
  useEffect(() => {
    if (!incomingProtocolUse) return;
    const { player, protocolId, outcome } = incomingProtocolUse;
    const proto = getProtocol(protocolId);
    const protoName = proto?.name ?? 'protokol';
    const meta = proto ? { accent: PILLAR_COLOR[proto.pillar], icon: protocolIcon(protocolId) } : undefined;
    if (player === myId) {
      if (outcome === 'wasted') {
        showToast(`Rakip ${protoName} protokolünü harcattı`, { accent: colors.danger, icon: 'alert-triangle' });
      }
    } else if (outcome === 'blocked') {
      setShieldArmed(false);
      showToast(`Engel bloklandı · ${protoName} durduruldu`, { accent: colors.success, icon: 'shield' });
    } else if (outcome === 'reflected') {
      setReflectArmed(false);
      showToast(`Engel yansıdı · ${protoName} rakibe döndü`, { accent: colors.success, icon: 'corner-up-left' });
    } else if (OPPONENT_VISIBLE_PROTOCOLS.has(protocolId)) {
      if (protocolId === 'disrupt_silence') {
        showToast('Rakip seni susturdu · bu sıra protokol kullanamazsın', meta);
      } else if (protocolId === 'disrupt_fog') {
        showToast('Rakip Sis Perdesi kullandı · geri bildirimin gecikecek', meta);
      } else if (protocolId === 'time_steal') {
        showToast('Rakip saatinden süre çaldı', meta);
      } else {
        showToast(`Rakip ${protoName} kullandı`, meta);
      }
    } else {
      return;
    }
    buzz('feedback');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingProtocolUse?.nonce]);

  // Maç bitince reveal + sinyal destesi (sayı düellosuyla aynı).
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    getMatchReveal(matchId)
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
  }, [finished, matchId]);
  useEffect(() => {
    if (!finished) return;
    let alive = true;
    getMyRank()
      .then((r) => alive && setSignalDeck(r.signalDeck))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [finished]);

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
    session.release();
    router.dismissTo('/');
  }, [router, session]);
  const goRematch = useCallback(() => {
    leavingRef.current = true;
    session.release();
    router.replace({ pathname: '/online', params: { word: '1' } });
  }, [router, session]);

  useEffect(() => {
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
  }, [navigation, match?.status, session]);

  // ── Giriş ─────────────────────────────────────────────────────
  const addLetter = useCallback(
    (k: string) => {
      if (locked) return;
      setEntry((g) => (g.length >= wordLength ? g : [...g, k]));
      play('blip');
      buzz('tap');
    },
    [locked, wordLength, play, buzz],
  );
  const deleteLetter = useCallback(() => {
    setEntry((g) => {
      if (g.length === 0) return g;
      buzz('tap');
      return g.slice(0, -1);
    });
  }, [buzz]);

  const submit = useCallback(async () => {
    if (locked || submitting || entry.length < wordLength) return;
    const word = entry.join('');
    const parsed = parseWord(word);
    if (!parsed.ok) return; // istemci ön-doğrulaması; nihai otorite sunucu
    setSubmitting(true);
    setActionError(null);
    try {
      const outcome = await makeGuess(matchId, parsed.word);
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
  }, [locked, submitting, entry, wordLength, matchId, play, buzz]);

  // ── Render ────────────────────────────────────────────────────
  const exitButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
      <Feather name="chevron-left" size={18} color={colors.text} />
    </Pressable>
  );

  if (!match) {
    if (!loading && !error) return <Redirect href="/" />;
    return (
      <Screen>
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
  if (status === 'setup') {
    return (
      <Screen>
        <WordOrbs />
        <View style={styles.content}>
          <View style={styles.headerRow}>{exitButton}</View>
          <WordSetupPanel matchId={matchId} match={match} active lastRound={lastRound} />
        </View>
      </Screen>
    );
  }

  if (status !== 'active' && status !== 'finished') {
    return (
      <Screen>
        <View style={styles.headerRow}>{exitButton}</View>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
          <Text style={styles.note}>Oyun başlıyor…</Text>
        </View>
      </Screen>
    );
  }

  // Geçmiş: son 4 tahmin, eskiler soluk (tasarım: 0.55 → 0.8 → 1).
  const visibleHistory = myGuesses.slice(-4);
  const historyOpacity = (i: number, n: number) => {
    const fromEnd = n - 1 - i;
    return fromEnd === 0 ? 1 : fromEnd === 1 ? 0.8 : 0.55;
  };
  const histTileW = Math.min(30, Math.floor((width - 140) / wordLength) - 4);
  const entryTileW = Math.min(44, Math.floor((width - 60 - (wordLength - 1) * 6) / wordLength));

  return (
    <Screen>
      <WordOrbs amberBottom={200} />
      <View style={styles.content}>
        {/* ÜST: rozet + Bo3 tur noktaları */}
        <View style={styles.headerRow}>
          {exitButton}
          <View style={styles.badge}>
            <View style={styles.badgeDot} />
            <Text style={styles.badgeText}>düello · {wordLength} harf</Text>
          </View>
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
          <Text style={styles.secretWord}>{mySecret ?? '—'}</Text>
        </View>

        {/* Rakip ilerleme kartı (Model 2): tahmin sayısı + yakınlık çubuğu */}
        <View style={styles.oppCard}>
          <View style={styles.oppLeft}>
            <View style={styles.oppAvatar}>
              <Text style={styles.oppAvatarText}>{opponentName.charAt(0).toUpperCase()}</Text>
            </View>
            <View>
              <Text style={styles.oppName}>{opponentName}</Text>
              <Text style={styles.oppStat}>
                {oppGuesses.length} tahmin{oppBest > 0 ? ` · en iyi ${oppBest}` : ''}
              </Text>
            </View>
          </View>
          <View style={styles.closeWrap}>
            <Text style={styles.closeLabel}>yakınlık</Text>
            <View style={styles.closeTrack}>
              <View
                style={[
                  styles.closeFill,
                  {
                    width: `${Math.round(closeness * 100)}%` as `${number}%`,
                    backgroundColor: closeness >= 0.75 ? '#F87171' : '#FBBF24',
                    boxShadow:
                      closeness >= 0.75
                        ? '0 0 8px rgba(248,113,113,0.5)'
                        : '0 0 8px rgba(251,191,36,0.4)',
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Satranç saati */}
        <View style={styles.clockRow}>
          <View style={[styles.clockCard, !isMine && styles.clockCardActive]}>
            <Text style={[styles.clockName, !isMine && styles.clockNameActive]}>rakip</Text>
            <Text style={[styles.clockTime, !isMine && styles.clockTimeActive]}>{fmtClock(oppClockMs)}</Text>
            {!isMine ? <View style={styles.clockDot} /> : null}
          </View>
          <View style={[styles.clockCard, isMine && styles.clockCardActive]}>
            <Text style={[styles.clockName, isMine && styles.clockNameActive]}>sen</Text>
            <Text style={[styles.clockTime, isMine && styles.clockTimeActive]}>{fmtClock(myClockMs)}</Text>
            {isMine ? <View style={styles.clockDot} /> : null}
          </View>
        </View>

        {/* ORTA: tahmin geçmişi (son 3-4, eskiler soluk) */}
        <View style={styles.middle}>
          <Text style={styles.sectionLabel}>tahminlerin</Text>
          <View style={styles.history}>
            {visibleHistory.map((g, i) => (
              <View key={g.id} style={[styles.histRow, { opacity: historyOpacity(i, visibleHistory.length) }]}>
                <View style={styles.histTiles}>
                  {Array.from(g.digits).map((ch, ci) => (
                    <View key={ci} style={[styles.histTile, { width: histTileW }]}>
                      <Text style={styles.histTileText}>{ch}</Text>
                    </View>
                  ))}
                </View>
                <FeedbackBadge entry={g} wordLength={wordLength} />
              </View>
            ))}
            {visibleHistory.length === 0 ? (
              <Text style={styles.histEmpty}>
                {isMine ? 'İlk tahminini yap' : 'Rakibin sırası…'}
              </Text>
            ) : null}
          </View>

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
                    locked && styles.entryTileLocked,
                  ]}>
                  {filled ? <Text style={styles.entryTileText}>{letter}</Text> : null}
                </View>
              );
            })}
          </View>
          {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        </View>

        {/* PROTOKOL ÇUBUĞU (sayı modundaki kullanım mantığı; tasarım görünümü) */}
        {protocolTiles.length > 0 ? (
          <View style={styles.protoRow}>
            {protocolTiles.map((t) => {
              const proto = getProtocol(t.id);
              const accent = proto ? PILLAR_COLOR[proto.pillar] : colors.teal;
              const usable = t.status === 'ready';
              const dimmed = t.status === 'cooldown' || t.status === 'blocked';
              return (
                <Pressable
                  key={t.id}
                  disabled={!usable || protoBusy}
                  onPress={() => void runProtocol(t.id)}
                  style={({ pressed }) => [
                    styles.protoTile,
                    {
                      backgroundColor: withAlpha(accent, dimmed ? 0.04 : 0.1),
                      borderColor: withAlpha(accent, dimmed ? 0.12 : 0.35),
                    },
                    dimmed && styles.protoTileDim,
                    pressed && usable && styles.protoTilePressed,
                  ]}>
                  <Feather
                    name={protocolIcon(t.id)}
                    size={17}
                    color={dimmed ? '#5A7898' : accent}
                  />
                  <Text style={[styles.protoLabel, { color: dimmed ? '#5A7898' : accent }]}>
                    {t.status === 'cooldown'
                      ? 'kullanıldı'
                      : t.status === 'armed'
                        ? 'aktif'
                        : SHORT_LABEL[t.id] ?? proto?.name ?? t.id}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* KLAVYE (büyük) */}
        <View style={styles.kbWrap}>
          <TrKeyboard
            large
            onKey={addLetter}
            onDelete={deleteLetter}
            onSubmit={submit}
            locked={locked || submitting}
            submitEnabled={entry.length === wordLength}
          />
        </View>

        <ProtocolNotice notice={notices[0] ?? null} onDone={dismissNotice} />
      </View>

      {finished ? (
        <ResultOverlay
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
          onSendSignal={sendSignal}
          onRematch={goRematch}
          onMenu={goMenu}
        />
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
    textTransform: 'uppercase',
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
  histTileText: {
    color: '#A8C0D8',
    fontSize: 15,
    fontWeight: '600',
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  histEmpty: {
    color: '#4B6B8A',
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 10,
  },
  fbChip: {
    minWidth: 58,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 20,
    alignItems: 'center',
  },
  fbChipText: {
    fontSize: 12,
    fontFamily: mono,
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
    textTransform: 'uppercase',
    fontFamily: mono,
  },
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
  },
  protoRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  protoTile: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1,
  },
  protoTileDim: {
    opacity: 0.4,
  },
  protoTilePressed: {
    transform: [{ scale: 0.96 }],
  },
  protoLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  kbWrap: {
    marginHorizontal: -8,
    paddingHorizontal: 2,
    paddingTop: 10,
    paddingBottom: 6,
    backgroundColor: 'rgba(6,12,26,0.7)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
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
