import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { useProfile } from '@/auth';
import { parseGuess } from '@/game';
import {
  activateProtocol,
  getMatchReveal,
  getMyHand,
  leaveMatch,
  makeGuess,
  OnlineError,
  useMatch,
  type MatchReveal,
  type ProtocolHint,
} from '@/online';
import { getProtocol } from '@/protocols/catalog';
import { useSfx, type SfxName } from '@/sfx';
import { getToggle } from '@/storage';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

import { DigitPad } from './duel/digit-pad';
import { GuessHistory } from './duel/guess-history';
import { HintsBar } from './duel/hints-bar';
import { PlayerChip } from './duel/player-pod';
import { PostestPrompt } from './duel/postest-prompt';
import { ProtocolStrip, type ProtocolTileState } from './duel/protocol-strip';
import { ResultOverlay } from './duel/result-overlay';
import { RoundSetup } from './duel/round-setup';
import { TurnBanner } from './duel/turn-banner';
import { OPPONENT_VISIBLE_PROTOCOLS } from './protocol-visuals';

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
  const {
    match,
    guesses,
    clocks,
    loading,
    error,
    sendEmoji,
    incomingEmoji,
    protocolUses,
    incomingProtocolUse,
  } = useMatch(matchId);

  const [entry, setEntry] = useState<string[]>([]);
  const [reveal, setReveal] = useState<MatchReveal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Son biten turun sonucu (Best of 3 tur arası ekranı için): kim + neden.
  // Gizli sayı SIZDIRMAZ — yalnızca "kazanan + neden (doğru tahmin / süre)".
  const [lastRound, setLastRound] = useState<{ winnerIsMe: boolean; reason: 'win' | 'timeout' } | null>(
    null,
  );

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
  // Best of 3 tur bilgisi (quick'te winTarget=1 → tek tur).
  const isProtocol = !!match && match.winTarget > 1;
  const round = match?.currentRound ?? 1;
  const myWins = match ? (p1 ? match.p1RoundWins : match.p2RoundWins) : 0;
  const oppWins = match ? (p1 ? match.p2RoundWins : match.p1RoundWins) : 0;
  // Tahmin geçmişi yalnız o turun (kendi) tahminleri.
  const myGuesses = guesses.filter((g) => g.guesser === myId && g.round === round);
  const win = finished && !!match?.winner && match.winner === myId;

  // Sıra rakibe geçince yarım kalan girişi temizle.
  useEffect(() => {
    if (!isMine) setEntry([]);
  }, [isMine]);

  // Bir tur bitip yeni tur belirlemesine geçince, biten turun sonucunu sapta:
  // kazanan = "win" feedback'li tahminin sahibi (yoksa süre → skor deltası);
  // neden = doğru tahmin mi süre mi. Yalnızca kim/neden — sayı değil.
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

  // Not: süre bitince otomatik zaman aşımı artık useMatch içinde merkezî olarak
  // ele alınıyor (her iki istemci de claim eder, idempotent). Burada tetikleme yok.

  // ── Protokol şeridi (yalnız Protokol Maçı) ────────────────────
  // Kendi seçili protokollerin + elenen rakamların/ipuçlarının (get_my_hand).
  // Seçim maç başında kilitlenir → bir kez çekilir. Rakibinkiler zaten gelmez.
  const [myProtocols, setMyProtocols] = useState<string[] | null>(null);
  // Eleme'nin "sayıda yok" rakamları + bilgi protokolü ipuçları, tur bazlı
  // (kalıcı gösterge; yeniden bağlanınca get_my_hand'den, kullanım anında RPC
  // dönüşünden dolar).
  const [eliminations, setEliminations] = useState<Record<string, number[]>>({});
  const [hints, setHints] = useState<Record<string, ProtocolHint[]>>({});
  // Kurulu savunmalar (Kalkan/Yansıtma): get_my_hand + kurma RPC'sinden;
  // rakibin engeli bloklanınca/yansıyınca (realtime kayıt) söner.
  const [shieldArmed, setShieldArmed] = useState(false);
  const [reflectArmed, setReflectArmed] = useState(false);
  useEffect(() => {
    if (!isProtocol || myProtocols !== null) return;
    let alive = true;
    (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const h = await getMyHand(matchId);
          if (!alive) return;
          setMyProtocols(h.selected);
          setEliminations(h.eliminations);
          setHints(h.hints);
          setShieldArmed(h.shieldArmed);
          setReflectArmed(h.reflectArmed);
          return;
        } catch {
          if (!alive) return;
          await new Promise((r) => setTimeout(r, 700));
        }
      }
      if (alive) setMyProtocols([]); // çekilemedi → şerit gizli
    })();
    return () => {
      alive = false;
    };
  }, [isProtocol, matchId, myProtocols]);

  // Susturulduysan (rakibin Susturma'sı) sıradaki turun bitene kadar hiçbir
  // protokol kullanamazsın — sunucu zaten reddeder, UI tile'ları pasifler.
  const silencedMe = !!match && (p1 ? match.silencedP1 : match.silencedP2);

  const appendHint = useCallback((forRound: number, hint: ProtocolHint) => {
    setHints((prev) => ({
      ...prev,
      [String(forRound)]: [...(prev[String(forRound)] ?? []), hint],
    }));
  }, []);

  // Kısa bilgi toast'u (kullanım onayı / hata / rakip bildirimi).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // Kendi kullanımların: sunucu kayıtları (realtime) + RPC dönüşü anlık işareti.
  // Hak maç başına 1 → kullanılan tile tekrar basılamaz (turlar arası sıfırlanmaz).
  const [localUsedIds, setLocalUsedIds] = useState<Set<string>>(() => new Set());
  const myUsedIds = useMemo(() => {
    const ids = new Set(localUsedIds);
    for (const u of protocolUses) if (u.player === myId) ids.add(u.protocolId);
    return ids;
  }, [protocolUses, myId, localUsedIds]);

  // Tile durumları: kurulu savunma → armed (kullanım kaydından ÖNCE bakılır —
  // kurulum hakkı zaten işlenmiştir); kullanıldı/harcandı → cooldown;
  // susturuldun ya da zamanlama uymuyor → blocked; aksi halde ready.
  const protocolTiles = useMemo<ProtocolTileState[]>(() => {
    if (!isProtocol) return [];
    return (myProtocols ?? []).map((id) => {
      if ((id === 'def_shield' && shieldArmed) || (id === 'def_reflect' && reflectArmed)) {
        return { id, status: 'armed' as const, note: 'AKTİF' };
      }
      if (myUsedIds.has(id)) return { id, status: 'cooldown' as const, note: 'KULLANILDI' };
      if (silencedMe) return { id, status: 'blocked' as const, note: 'SUSTURULDUN' };
      const timing = getProtocol(id)?.usageTiming ?? 'own_turn';
      const available = status === 'active' && (timing !== 'own_turn' || isMine);
      return available
        ? { id, status: 'ready' as const }
        : { id, status: 'blocked' as const, note: 'SIRAN DEĞİL' };
    });
  }, [isProtocol, myProtocols, myUsedIds, status, isMine, shieldArmed, reflectArmed, silencedMe]);

  // Protokol kullan: TÜM doğrulama + etki sunucuda (use_protocol RPC); burada
  // yalnız sonuç gösterimi. Çifte dokunuş busy kilidiyle engellenir (sunucu da
  // idempotent — ikinci çağrı protocol_already_used döner).
  const [protoBusy, setProtoBusy] = useState(false);
  const [postestOpen, setPostestOpen] = useState(false);
  const runProtocol = useCallback(
    async (id: string, payload?: Record<string, unknown>) => {
      if (protoBusy) return;
      setProtoBusy(true);
      buzz('tap');
      try {
        const res = await activateProtocol(matchId, id, payload);
        // consumed=false → etki boşa gitti, hak HARCANMADI (tile açık kalır).
        if (res.consumed !== false) setLocalUsedIds((prev) => new Set(prev).add(id));
        play('good');
        buzz('feedback');
        switch (id) {
          case 'time_add':
            showToast('Süre Enjeksiyonu: +12 sn');
            break;
          case 'info_eliminate': {
            const key = String(res.round);
            setEliminations((prev) => ({
              ...prev,
              [key]: res.eliminated ?? [...(prev[key] ?? []), res.eliminatedDigit!],
            }));
            showToast(`Eleme: sayıda ${res.eliminatedDigit} yok`);
            break;
          }
          case 'info_readlast':
            if (res.consumed === false) {
              showToast('Rakip bu turda henüz tahmin yapmadı — hak harcanmadı');
            } else {
              appendHint(res.round, {
                t: 'readlast',
                digits: res.digits!,
                feedback: res.feedback!,
              });
              showToast(`Rakip Okuması: ${res.digits} dedi`);
            }
            break;
          case 'info_postest':
            appendHint(res.round, {
              t: 'postest',
              digit: res.digit!,
              pos: res.position!,
              match: !!res.match,
            });
            showToast(
              `Konum Testi: ${res.digit}, ${res.position}. pozisyonda — ${res.match ? 'EVET' : 'HAYIR'}`,
            );
            break;
          case 'info_reveal':
            appendHint(res.round, { t: 'reveal', digit: res.revealedDigit! });
            showToast(`Sayı İşareti: sayıda ${res.revealedDigit} var`);
            break;
          case 'time_steal':
            showToast(
              res.stolenMs
                ? `Saat Çalma: rakipten +${Math.round(res.stolenMs / 1000)} sn`
                : 'Saat Çalma: rakipte çalınacak süre yok (5 sn tabanı)',
            );
            break;
          case 'time_freeze':
            showToast('Dondur: bu turda saatin işlemiyor');
            break;
          case 'time_slow':
            showToast('Yavaşlat: rakibin sıradaki turu 1.5× hızlı akacak');
            break;
          case 'def_shield':
            setShieldArmed(true);
            showToast('Kalkan kuruldu — gelen ilk engeli bloklar');
            break;
          case 'def_reflect':
            setReflectArmed(true);
            showToast('Yansıtma kuruldu — gelen ilk engel sahibine döner');
            break;
          case 'disrupt_fog':
          case 'disrupt_silence':
          case 'disrupt_waste':
          case 'disrupt_deceive': {
            // Engel sınıfı: counter zinciri sonucu (sunucu kararı).
            const name = getProtocol(id)?.name ?? 'Engel';
            if (res.blocked) {
              showToast(`${name} bloklandı — rakibin Kalkanı tüketti`);
            } else if (res.reflected) {
              buzz('lose');
              showToast(`${name} yansıtıldı — etkisi sana döndü!`);
            } else if (id === 'disrupt_fog') {
              showToast('Sis Perdesi: rakibin sonraki geri bildirimi gecikecek');
            } else if (id === 'disrupt_silence') {
              showToast('Susturma: rakip sıradaki turunda protokol kullanamaz');
            } else if (id === 'disrupt_deceive') {
              showToast('Yanıltma: rakibin sonraki geri bildirimi şişirilecek');
            } else if (res.noTargetProtocol) {
              showToast('Rakibin harcanacak protokolü yok — hak harcanmadı');
            } else {
              const wastedName = res.wastedProtocol
                ? getProtocol(res.wastedProtocol)?.name ?? res.wastedProtocol
                : 'protokol';
              showToast(`Zorla Harca: rakibin ${wastedName} protokolü tüketildi`);
            }
            break;
          }
          default:
            showToast('Protokol kullanıldı');
        }
      } catch (e) {
        // Sunucu reddi (sıra geçti / hak dolu vb.) — durumu kullanıcıya söyle.
        showToast(errMsg(e));
        if (e instanceof OnlineError && e.code === 'protocol_already_used') {
          setLocalUsedIds((prev) => new Set(prev).add(id));
        }
      } finally {
        setProtoBusy(false);
      }
    },
    [protoBusy, matchId, play, buzz, showToast, appendHint],
  );

  // Şerit dokunuşu: Konum Testi önce rakam+pozisyon girişi ister; gerisi
  // doğrudan RPC. (Etki her durumda sunucuda.)
  const onUseProtocol = useCallback(
    (id: string) => {
      if (id === 'info_postest') {
        buzz('tap');
        setPostestOpen(true);
        return;
      }
      void runProtocol(id);
    },
    [runProtocol, buzz],
  );

  // Canlı protokol olayı bildirimi (realtime kayıttan; sır içermez):
  // rakip kullandı / kalkanın blokladı / yansıttın / protokolün harcandı.
  useEffect(() => {
    if (!incomingProtocolUse) return;
    const { player, protocolId, outcome } = incomingProtocolUse;
    const name = getProtocol(protocolId)?.name ?? 'protokol';
    if (player === myId) {
      // wasted satırı kurbana yazılır → rakip senin protokolünü harcattı
      // (Zorla Harca gözlemlenebilir; bu KENDİ bilgin).
      if (outcome === 'wasted') showToast(`Rakip ${name} protokolünü harcattı!`);
    } else if (outcome === 'blocked') {
      // Counter: rakibin (gözlemlenebilir) engelini Kalkanın blokladı — kendi onayın.
      setShieldArmed(false);
      showToast(`Kalkanın rakibin ${name} engelini blokladı`);
    } else if (outcome === 'reflected') {
      setReflectArmed(false);
      showToast(`${name} engelini rakibe geri yansıttın!`);
    } else if (OPPONENT_VISIBLE_PROTOCOLS.has(protocolId)) {
      // Yalnız GÖZLEMLENEBİLİR protokoller bildirilir (gizliler sunucu RLS'i ile
      // zaten gelmez; bu istemci-içi savunma katmanı). Yanıltma/Kalkan/Eleme vb.
      // hiçbir şekilde duyurulmaz.
      if (protocolId === 'disrupt_silence') {
        showToast('Rakip seni susturdu — bu sıra protokol kullanamazsın');
      } else if (protocolId === 'disrupt_fog') {
        showToast('Rakip Sis Perdesi kullandı — sonraki geri bildirimin gecikecek');
      } else {
        showToast(`Rakip ${name} kullandı`);
      }
    } else {
      // Gizli protokol (beklenmedik şekilde geldiyse) → SESSİZ; ifşa etme.
      return;
    }
    buzz('feedback');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingProtocolUse?.nonce]);

  // Bu turun kalıcı bilgileri: elenenler + bilgi protokolü ipuçları.
  const eliminatedNow = eliminations[String(round)] ?? [];
  const hintsNow = hints[String(round)] ?? [];

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

  // Turlar arası belirleme (Best of 3, round ≥ 2): düello ekranı içinde.
  if (status === 'setup') {
    return (
      <Screen>
        <View style={styles.content}>
          <View style={styles.topRow}>{exitButton}</View>
          <RoundSetup matchId={matchId} match={match} lastRound={lastRound} />
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

      {/* Kompakt yerleşim (yukarıdan aşağı): rakip + rakip saati + tur skoru →
          sıra banner'ı → tahmin geçmişi (kayar) → mevcut giriş → tuş takımı +
          kendi saatin → en altta protokol şeridi (yalnız Protokol Maçı). */}
      <View style={styles.content}>
        <View style={styles.topRow}>
          {exitButton}
          <PlayerChip
            initial={opponentName.charAt(0)}
            name={opponentName}
            ms={oppClockMs}
            active={!isMine && status === 'active'}
            accent={colors.amber}
          />
          {isProtocol ? (
            <View style={styles.roundChip}>
              <Text style={styles.roundChipText}>
                TUR {round} · <Text style={{ color: colors.cyan }}>{myWins}</Text>
                <Text style={{ color: colors.dim }}>–</Text>
                <Text style={{ color: colors.amber }}>{oppWins}</Text>
              </Text>
            </View>
          ) : null}
        </View>

        <TurnBanner mine={isMine} />

        <GuessHistory guesses={myGuesses} />

        {/* Bilgi protokollerinin verdiği kalıcı ipuçları (bu turun; unutma). */}
        <HintsBar eliminated={eliminatedNow} hints={hintsNow} />

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        <DigitPad
          guess={entry}
          locked={locked}
          onDigit={addDigit}
          onDelete={deleteDigit}
          onSubmit={submit}
          accessory={
            <PlayerChip
              stack
              initial={myName.charAt(0)}
              name={myName}
              ms={myClockMs}
              active={isMine}
              accent={colors.cyan}
            />
          }
        />

        {/* Protokol şeridi: yalnız Protokol Maçı'nda ve seçim varsa yer kaplar
            (quick/offline'da render edilmez → alt boşluk oluşmaz). */}
        {protocolTiles.length > 0 ? (
          <ProtocolStrip tiles={protocolTiles} onUse={onUseProtocol} silenced={silencedMe} />
        ) : null}

        {toast ? (
          <View style={styles.toastWrap} pointerEvents="none">
            <Text style={styles.toast}>{toast}</Text>
          </View>
        ) : null}
      </View>

      {/* Konum Testi girişi (info_postest): rakam + pozisyon → use_protocol. */}
      <PostestPrompt
        visible={postestOpen}
        busy={protoBusy}
        onClose={() => setPostestOpen(false)}
        onSubmit={(digit, position) => {
          setPostestOpen(false);
          void runProtocol('info_postest', { digit, position });
        }}
      />

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
    gap: 8,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  roundChip: {
    marginLeft: 'auto',
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.violet, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.35),
  },
  roundChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 0.5,
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
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 96, // şeridin hemen üstü
    alignItems: 'center',
    zIndex: 10,
  },
  toast: {
    color: colors.text,
    fontSize: 11,
    fontFamily: mono,
    letterSpacing: 0.5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(6,12,26,0.92)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
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

// Düello ekranı dikey boşlukları: üst bar/banner/giriş/pad arasında nefes payı.
// (GuessHistory flex:1 ile ortadaki kalan alanı doldurur ve kendi içinde kayar;
//  protokol şeridi yalnız Protokol Maçı'nda en altta yer kaplar.)
