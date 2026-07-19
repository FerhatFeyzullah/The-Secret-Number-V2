import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useProfile } from '@/auth';
import {
  createPrivateRoom,
  findOrCreateProtocolMatch,
  findOrCreateQuickMatch,
  getLobbyCounts,
  joinPrivateRoom,
  leaveMatch,
  markReady,
  OnlineError,
  useMatch,
  useMatchSession,
  useOnlineCount,
  type FirstTurnMode,
  type LobbyCounts,
  type MatchMode,
  type PrivateRoomMode,
} from '@/online';
import {
  CreateRoomScreen,
  JoinRoomScreen,
  LobbyHub,
  MatchFoundScreen,
  NoOpponentScreen,
  PrivateChoiceScreen,
  PrivateRoomSetupScreen,
  SearchingScreen,
} from '@/online/ui';
import { Screen } from '@/ui/screen';

/** Lobi/eşleşme akışının iç durumları (ayrı route yerine tek route + makine). */
type Phase =
  | 'lobby'
  | 'searching'
  | 'no-opponent'
  | 'private-choice'
  | 'private-setup'
  | 'create-room'
  | 'join-room'
  | 'match-found';

/** Rakip bulunamadan önce beklenecek üst sınır. */
const SEARCH_TIMEOUT_SEC = 60;

/** Eşleşme (VS) ekranının gösterim süresi: el sıkışması otomatik, manuel onay yok.
 *  Sunucu mark_ready pencerelerine aynı tamponu ekler (20260607000010). */
const MATCH_FOUND_HOLD_MS = 7000;

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

/** Matchmaking RPC'si için istemci-taraflı zaman aşımı. Free-tier yük altında
 *  sunucu yanıtı gecikirse kullanıcı sonsuz "yükleniyor"da TAKILMASIN: süre
 *  aşılınca isteği eskitip lobiye net hatayla döneriz (silent stall yerine). */
const MATCHMAKE_TIMEOUT_MS = 15000;
const BUSY_MSG = 'Sunucu şu an yoğun, lütfen tekrar dene.';
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('matchmake_timeout')), ms)),
  ]);
}
const isTimeout = (e: unknown) => e instanceof Error && e.message === 'matchmake_timeout';

export default function OnlineScreen() {
  const router = useRouter();
  const { name } = useProfile();

  const [phase, setPhase] = useState<Phase>('lobby');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Aranan/katılınan mod: maç satırı yüklenmeden önce VS ekranında YANLIŞ
  // ("Hızlı Maç") etiket görünmesin diye akışı başlatan aksiyondan türetilir.
  const [pendingMode, setPendingMode] = useState<MatchMode>('quick');
  // Dostluk maçı mı (özel oda akışı) — maç satırı yüklenmeden VS etiketinde
  // doğru "Dostluk" göstergesi için (özellikle protokol özel odası mode=
  // 'protocol' olduğundan ranked protokolden ayırt edilemezdi).
  const [pendingFriendly, setPendingFriendly] = useState(false);
  // VS ekranı en az MATCH_FOUND_HOLD_MS gösterildi mi (otomatik geçiş kapısı).
  const [vsHoldDone, setVsHoldDone] = useState(false);

  // Lobi göstergeleri: uygulama-geneli canlı online oyuncu sayısı (presence) +
  // moda göre rakip bekleyen sayısı (yalnız lobi fazında ~5sn poll; kuyruğa giren
  // 'searching' fazına geçtiği için kendini saymaz).
  const onlineCount = useOnlineCount();
  const [waiting, setWaiting] = useState<LobbyCounts | null>(null);
  useEffect(() => {
    if (phase !== 'lobby') return;
    let cancelled = false;
    let iv: ReturnType<typeof setInterval> | null = null;
    const poll = () =>
      getLobbyCounts()
        .then((c) => {
          if (!cancelled) setWaiting(c);
        })
        .catch(() => {});
    const start = () => {
      if (!iv) {
        void poll();
        iv = setInterval(() => void poll(), 5000);
      }
    };
    const stop = () => {
      if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };
    start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, [phase]);

  // Canlı maç durumu: rakip katılınca status 'waiting' → 'setup' olur.
  const { match } = useMatch(matchId);

  // Merkezi maç sahibi: lobi maçı (arama/VS) 'lobby' olarak claim edilir. Çıkış
  // temizliğini (geri/swipe/unmount → /online dışına çıkış) provider'ın navigasyon
  // izleyicisi yapar; kendi optimistik iptallerimiz session.leave()'i çağırır.
  // (Eski liveMatchRef unmount net'i merkezi sahibe devredildi.)
  const session = useMatchSession();
  // Kendi çıkışımız: realtime'dan gelen cancelled'ı "rakip ayrıldı" sanma.
  const leavingRef = useRef(false);

  const resetToLobby = useCallback(() => {
    setPhase('lobby');
    setMatchId(null);
    setRoomCode(null);
    setError(null);
  }, []);

  // Rakip katıldı (status protocol_select/setup/active) → kutlama anına geç.
  useEffect(() => {
    if (phase !== 'searching' && phase !== 'create-room') return;
    if (
      match &&
      (match.status === 'protocol_select' ||
        match.status === 'setup' ||
        match.status === 'active')
    ) {
      setPhase('match-found');
    }
  }, [match, phase]);

  // Maç öldü izleyicisi: rakip ayrılır/maç iptal olursa (realtime UPDATE)
  // lobiye bilgiyle dön. Kendi çıkışımızda (leavingRef) mesaj gösterilmez.
  useEffect(() => {
    if (phase !== 'searching' && phase !== 'create-room' && phase !== 'match-found') return;
    if (!match) return;
    if (
      match.status === 'cancelled' ||
      match.status === 'finished' ||
      match.status === 'abandoned'
    ) {
      if (!leavingRef.current) setNotice('Rakip ayrıldı, maç iptal edildi.');
      session.release(); // maç zaten kapandı → izleyici gereksiz leave atmasın
      resetToLobby();
    }
  }, [match, phase, resetToLobby, session]);

  // Arama: gerçek geçen süre + 60 sn'de rakip yoksa "bulunamadı".
  const matchIdRef = useRef<string | null>(null);
  matchIdRef.current = matchId;
  // İstek jetonu: iptal/yeni istek sayacı artırır; uçuştaki RPC çözüldüğünde
  // jeton eskimişse sonuç state'e YAZILMAZ (kullanıcı lobiden geri çekilmez)
  // ve dönen maç arka planda kapatılır (sunucuda sahipsiz kayıt kalmaz).
  const searchSeqRef = useRef(0);
  useEffect(() => {
    if (phase !== 'searching') return;
    const start = Date.now();
    setElapsedSec(0);
    const iv = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setElapsedSec(sec);
      if (sec >= SEARCH_TIMEOUT_SEC) {
        clearInterval(iv);
        searchSeqRef.current += 1; // uçuşta kalmış istek varsa eskit
        session.leave(); // bekleyen lobi maçını kapat (idempotent)
        setMatchId(null);
        setPhase('no-opponent');
      }
    }, 500);
    return () => clearInterval(iv);
  }, [phase, session]);

  // ── Aksiyonlar ────────────────────────────────────────────────
  // Hızlı Maç (quick, tek tur), Protokol Maçı (protocol, Best of 3) ve Kelime
  // Modu (word kuyruğu; sunucuda PROTOKOLSÜZ Bo3) aynı arama akışını paylaşır;
  // yalnızca eşleşme RPC'si/parametresi değişir.
  const lastModeRef = useRef<'quick' | 'protocol' | 'word' | 'wordrace'>('quick');
  // Kelime içerikli mi (word/wordrace) — ekran seçimi + VS etiketi + zemin glifi
  // için (maç satırı gelmeden de doğru).
  const [pendingWord, setPendingWord] = useState(false);
  const startSearch = useCallback(async (m: 'quick' | 'protocol' | 'word' | 'wordrace') => {
    lastModeRef.current = m;
    const seq = ++searchSeqRef.current;
    setError(null);
    setNotice(null);
    leavingRef.current = false;
    setMatchId(null);
    // Kelime maçı/yarışı sunucuda mode='quick' + win_target=2 doğar (PROTOKOLSÜZ
    // Bo3); yalnız sayı protokol maçı mode='protocol'. Bo3 rozeti win_target'tan.
    setPendingMode(m === 'protocol' ? 'protocol' : 'quick');
    setPendingWord(m === 'word' || m === 'wordrace');
    setPendingFriendly(false);
    setPhase('searching');
    try {
      const ticket = await withTimeout(
        m === 'protocol'
          ? findOrCreateProtocolMatch()
          : m === 'word'
            ? findOrCreateQuickMatch('word')
            : m === 'wordrace'
              ? findOrCreateQuickMatch('wordrace')
              : findOrCreateQuickMatch(),
        MATCHMAKE_TIMEOUT_MS,
      );
      if (seq !== searchSeqRef.current) {
        // Bu arama iptal edildi/yenilendi: dönen maçı sessizce kapat.
        void leaveMatch(ticket.matchId).catch(() => {});
        return;
      }
      setMatchId(ticket.matchId);
      session.claim(ticket.matchId, 'lobby'); // merkezi sahibe kaydet
      // Bekleyen bir maça katıldıysak zaten eşleştik.
      if (ticket.status !== 'waiting') setPhase('match-found');
    } catch (e) {
      if (seq !== searchSeqRef.current) return;
      if (isTimeout(e)) {
        // Sunucu yanıtı gecikti: takılma yerine lobiye net hatayla dön (olası
        // sahipsiz waiting sonraki aramada _cancel_unstarted_matchmade ile temizlenir).
        searchSeqRef.current += 1;
        setMatchId(null);
        setNotice(BUSY_MSG);
        setPhase('lobby');
      } else {
        setError(errMsg(e));
      }
    }
  }, [session]);
  const startQuick = useCallback(() => startSearch('quick'), [startSearch]);
  const startProtocol = useCallback(() => startSearch('protocol'), [startSearch]);
  const startWord = useCallback(() => startSearch('word'), [startSearch]);
  const startWordRace = useCallback(() => startSearch('wordrace'), [startSearch]);
  const retrySearch = useCallback(() => startSearch(lastModeRef.current), [startSearch]);

  // Eşzamanlı yeniden-kuyruk uzlaştırması: iki taraf aynı anda "Tekrar Oyna"
  // yapınca ikisi de 'waiting' açıp birbirini kaçırabilir (find_or_create yalnız
  // ÖNCEDEN var olan waiting'e katılır, iki yeni waiting'i uzlaştırmaz). Bekleyen
  // kalırsak ~4 sn (jitter ile, lockstep kırılır) sonra BİR KEZ yeniden ara:
  // kendi waiting'imiz iptal edilip karşının waiting'ine katılırız.
  const requeuedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'searching') {
      requeuedRef.current = false;
      return;
    }
    if (match?.status !== 'waiting' || requeuedRef.current) return;
    const delay = 4000 + Math.floor(Math.random() * 1500);
    const t = setTimeout(() => {
      requeuedRef.current = true;
      void startSearch(lastModeRef.current);
    }, delay);
    return () => clearTimeout(t);
  }, [phase, match?.status, startSearch]);

  // "Tekrar Oyna" ile gelindiğinde (quick=1 / word=1 / wordrace=1) aramayı bir kez
  // otomatik başlat.
  const { quick, word, wordrace } = useLocalSearchParams<{
    quick?: string;
    word?: string;
    wordrace?: string;
  }>();
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if ((quick === '1' || word === '1' || wordrace === '1') && !autoStartedRef.current) {
      autoStartedRef.current = true;
      void (wordrace === '1' ? startWordRace() : word === '1' ? startWord() : startQuick());
    }
  }, [quick, word, wordrace, startQuick, startWord, startWordRace]);

  // Optimistik çıkış: UI ANINDA döner, leave_match arka planda koşar (ağ
  // gecikmesi donma hissi vermez); leavingRef ikinci basışı no-op yapar.
  const cancelSearch = useCallback(() => {
    if (leavingRef.current) return; // tek atış
    leavingRef.current = true;
    searchSeqRef.current += 1; // uçuştaki isteği eskit
    resetToLobby();
    session.leave(); // /online'da kalıyoruz → leave'i açıkça çağır (izleyici tetiklenmez)
  }, [resetToLobby, session]);

  const createRoom = useCallback(
    async (
      clockMs: number,
      firstTurnMode: FirstTurnMode,
      roomMode: PrivateRoomMode,
      wordLength: number | null = null,
    ) => {
    const seq = ++searchSeqRef.current;
    setError(null);
    setNotice(null);
    leavingRef.current = false;
    setRoomCode(null);
    setMatchId(null);
    // VS/etiket + zemin glifi için: protokol→'protocol', diğerleri 'private';
    // kelime odasında zemin harf akışı (pendingWord). Maç satırı gelince düzelir.
    setPendingMode(roomMode === 'protocol' ? 'protocol' : 'private');
    setPendingWord(roomMode === 'word');
    setPendingFriendly(true);
    setPhase('create-room');
    try {
      const ticket = await withTimeout(
        createPrivateRoom(clockMs, firstTurnMode, roomMode, wordLength),
        MATCHMAKE_TIMEOUT_MS,
      );
      if (seq !== searchSeqRef.current) {
        void leaveMatch(ticket.matchId).catch(() => {});
        return;
      }
      setMatchId(ticket.matchId);
      session.claim(ticket.matchId, 'lobby');
      setRoomCode(ticket.roomCode ?? null);
    } catch (e) {
      if (seq !== searchSeqRef.current) return;
      if (isTimeout(e)) {
        searchSeqRef.current += 1;
        setMatchId(null);
        setNotice(BUSY_MSG);
        setPhase('lobby');
      } else {
        setError(errMsg(e));
      }
    }
  }, [session]);

  const cancelRoom = useCallback(() => {
    if (leavingRef.current) return; // tek atış
    leavingRef.current = true;
    searchSeqRef.current += 1;
    setPhase('private-choice');
    setMatchId(null);
    setRoomCode(null);
    setError(null);
    session.leave();
  }, [session]);

  // Eşleşme (VS) ekranı: el sıkışması OTOMATİK — ekrana girer girmez mark_ready
  // gönderilir (idempotent boolean; sayı içermez) ve 7 sn'lik hazırlık penceresi
  // başlar. Manuel "Hazır"/"İptal" yok; rakip ayrılırsa yukarıdaki maç-öldü
  // izleyicisi lobiye döndürür, ekrandan çıkılırsa unmount temizliği maçı kapatır.
  useEffect(() => {
    if (phase !== 'match-found') {
      setVsHoldDone(false);
      return;
    }
    const id = matchIdRef.current;
    if (id) void markReady(id).catch(() => {});
    const t = setTimeout(() => setVsHoldDone(true), MATCH_FOUND_HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const joinRoom = useCallback(async (code: string) => {
    const seq = ++searchSeqRef.current;
    setJoinError(null);
    setNotice(null);
    leavingRef.current = false;
    setPendingMode('private');
    setPendingFriendly(true);
    setJoinBusy(true);
    try {
      const ticket = await withTimeout(joinPrivateRoom(code), MATCHMAKE_TIMEOUT_MS);
      if (seq !== searchSeqRef.current) {
        // Kullanıcı beklerken vazgeçti: katıldığımız maçı sessizce kapat.
        void leaveMatch(ticket.matchId).catch(() => {});
        return;
      }
      setMatchId(ticket.matchId);
      session.claim(ticket.matchId, 'lobby');
      setPhase('match-found');
    } catch (e) {
      if (seq === searchSeqRef.current) setJoinError(isTimeout(e) ? BUSY_MSG : errMsg(e));
    } finally {
      setJoinBusy(false);
    }
  }, [session]);

  const backFromJoin = useCallback(() => {
    searchSeqRef.current += 1; // uçuştaki katılım isteğini eskit
    setJoinError(null);
    setPhase('private-choice');
  }, []);

  const copyCode = useCallback(async () => {
    if (roomCode) await Clipboard.setStringAsync(roomCode);
  }, [roomCode]);

  const shareCode = useCallback(() => {
    if (!roomCode) return;
    void Share.share({
      message: `Gizemli Sayılar'da bana karşı oyna! Oda kodu: ${roomCode}`,
    }).catch(() => {});
  }, [roomCode]);

  // 7 sn doldu + maç canlı → sonraki ekrana OTOMATİK geç (protokolde seçim,
  // diğerlerinde belirleme). Maç bu sırada iptal olduysa yukarıdaki izleyici
  // önce lobiye döndürür (status cancelled bu efekte hiç uğramaz).
  useEffect(() => {
    if (phase !== 'match-found' || !vsHoldDone || !matchId || !match) return;
    // KELİME YARIŞI: belirleme fazı YOK — sunucu gizliyi seçer, maç doğrudan
    // 'active' doğar. VS ekranından sonra doğrudan yarış ekranına geç.
    if (match.contentType === 'wordrace') {
      if (match.status !== 'active') return;
      resetToLobby();
      router.push({ pathname: '/match/[id]', params: { id: matchId, content: 'wordrace' } });
      return;
    }
    if (match.status !== 'protocol_select' && match.status !== 'setup') return;
    const content = match.contentType; // kelime maçında setup ekranı kelime olur
    // Kelime maçı PROTOKOLSÜZ → asla protocol_select'e gitmez (savunmacı: sunucu
    // zaten word'ü 'setup' doğurur). Yalnız sayı protokol maçı seçim ekranına gider.
    const toSelect = match.status === 'protocol_select' && content !== 'word';
    // Sahiplik bir sonraki maç ekranına geçiyor (o ekran 'match' olarak claim eder);
    // route maç kümesi içinde kaldığından izleyici leave TETİKLEMEZ.
    resetToLobby();
    router.push(
      toSelect
        ? { pathname: '/protocol-select', params: { matchId } }
        : { pathname: '/match-setup', params: { matchId, content } },
    );
  }, [phase, vsHoldDone, matchId, match, resetToLobby, router]);

  // ── Türetilmiş gösterim ───────────────────────────────────────
  const opp = match ? (match.myRole === 'player1' ? match.player2 : match.player1) : null;
  // null = ad henüz yüklenmedi; MatchFoundScreen "…" gösterir (titreşim yok).
  const opponentName = opp?.username ?? null;
  // Maç satırı yüklenmeden önce de DOĞRU etiket: akışı başlatan moddan düş.
  const mode: MatchMode = match?.mode ?? pendingMode;

  let content;
  switch (phase) {
    case 'searching':
      content = (
        <SearchingScreen
          initial={name.charAt(0)}
          elapsedSec={elapsedSec}
          error={error}
          onCancel={cancelSearch}
        />
      );
      break;
    case 'no-opponent':
      content = (
        <NoOpponentScreen
          onRetry={retrySearch}
          onCreateRoom={() => setPhase('private-setup')}
          onBack={resetToLobby}
        />
      );
      break;
    case 'private-choice':
      content = (
        <PrivateChoiceScreen
          onCreate={() => setPhase('private-setup')}
          onJoin={() => setPhase('join-room')}
          onBack={resetToLobby}
        />
      );
      break;
    case 'private-setup':
      content = (
        <PrivateRoomSetupScreen
          onConfirm={createRoom}
          onBack={() => setPhase('private-choice')}
        />
      );
      break;
    case 'create-room':
      content = (
        <CreateRoomScreen
          roomCode={roomCode}
          error={error}
          onCopy={copyCode}
          onShare={shareCode}
          onCancel={cancelRoom}
        />
      );
      break;
    case 'join-room':
      content = (
        <JoinRoomScreen
          error={joinError}
          busy={joinBusy}
          onJoin={joinRoom}
          onBack={backFromJoin}
        />
      );
      break;
    case 'match-found':
      content = (
        <MatchFoundScreen
          myName={name}
          opponentName={opponentName}
          mode={mode}
          isFriendly={match?.isFriendly ?? pendingFriendly}
          word={
            match ? match.contentType === 'word' || match.contentType === 'wordrace' : pendingWord
          }
          wordRace={
            match ? match.contentType === 'wordrace' : lastModeRef.current === 'wordrace'
          }
          winTarget={match?.winTarget ?? (pendingWord || pendingMode === 'protocol' ? 2 : 1)}
          clockMs={match?.clockMs ?? 60000}
          firstTurnMode={match?.firstTurnMode ?? 'random'}
          iAmCreator={match?.myRole === 'player1'}
        />
      );
      break;
    case 'lobby':
    default:
      content = (
        <LobbyHub
          notice={notice}
          onlineCount={onlineCount}
          waiting={waiting}
          onQuick={startQuick}
          onProtocol={startProtocol}
          onWord={startWord}
          onWordRace={startWordRace}
          onPrivate={() => setPhase('private-choice')}
          onHowTo={() => router.push('/how-to-play')}
          onBack={() => router.back()}
        />
      );
  }

  // Kelime akışında (arama/VS) süzülen zemin glifleri harf olur (word + wordrace).
  const wordFlow = match
    ? match.contentType === 'word' || match.contentType === 'wordrace'
    : pendingWord;
  return <Screen float={wordFlow ? 'letters' : 'digits'}>{content}</Screen>;
}
