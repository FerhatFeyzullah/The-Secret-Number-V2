import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { useProfile } from '@/auth';
import {
  createPrivateRoom,
  findOrCreateQuickMatch,
  joinPrivateRoom,
  leaveMatch,
  markReady,
  OnlineError,
  useMatch,
  type MatchMode,
} from '@/online';
import {
  CreateRoomScreen,
  JoinRoomScreen,
  LobbyHub,
  MatchFoundScreen,
  NoOpponentScreen,
  PrivateChoiceScreen,
  SearchingScreen,
} from '@/online/ui';
import { Screen } from '@/ui/screen';

/** Lobi/eşleşme akışının iç durumları (ayrı route yerine tek route + makine). */
type Phase =
  | 'lobby'
  | 'searching'
  | 'no-opponent'
  | 'private-choice'
  | 'create-room'
  | 'join-room'
  | 'match-found';

/** Rakip bulunamadan önce beklenecek üst sınır. */
const SEARCH_TIMEOUT_SEC = 60;

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

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

  // Canlı maç durumu: rakip katılınca status 'waiting' → 'setup' olur.
  const { match } = useMatch(matchId);

  // Lobi akışında sahiplenilen CANLI (waiting/setup) maçı izle: ekran
  // beklenmedik şekilde terk edilirse (donanım geri tuşu vb.) kapatılır.
  // leave_match her fazı doğru kapattığı için setup'a geçmiş maç da sızmaz.
  const liveMatchRef = useRef<string | null>(null);
  // Kendi çıkışımız: realtime'dan gelen cancelled'ı "rakip ayrıldı" sanma.
  const leavingRef = useRef(false);
  useEffect(() => {
    const inFlow = phase === 'searching' || phase === 'create-room' || phase === 'match-found';
    const dead =
      match &&
      (match.status === 'finished' ||
        match.status === 'cancelled' ||
        match.status === 'abandoned');
    liveMatchRef.current = inFlow && !dead ? matchId : null;
  }, [phase, match, matchId]);

  useEffect(() => {
    return () => {
      if (liveMatchRef.current) void leaveMatch(liveMatchRef.current).catch(() => {});
    };
  }, []);

  const resetToLobby = useCallback(() => {
    setPhase('lobby');
    setMatchId(null);
    setRoomCode(null);
    setError(null);
  }, []);

  // Rakip katıldı (status setup/active) → kutlama anına geç.
  useEffect(() => {
    if (phase !== 'searching' && phase !== 'create-room') return;
    if (match && (match.status === 'setup' || match.status === 'active')) {
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
      resetToLobby();
    }
  }, [match, phase, resetToLobby]);

  // Arama: gerçek geçen süre + 60 sn'de rakip yoksa "bulunamadı".
  const matchIdRef = useRef<string | null>(null);
  matchIdRef.current = matchId;
  useEffect(() => {
    if (phase !== 'searching') return;
    const start = Date.now();
    setElapsedSec(0);
    const iv = setInterval(() => {
      const sec = Math.floor((Date.now() - start) / 1000);
      setElapsedSec(sec);
      if (sec >= SEARCH_TIMEOUT_SEC) {
        clearInterval(iv);
        const id = matchIdRef.current;
        if (id) void leaveMatch(id).catch(() => {});
        setMatchId(null);
        setPhase('no-opponent');
      }
    }, 500);
    return () => clearInterval(iv);
  }, [phase]);

  // ── Aksiyonlar ────────────────────────────────────────────────
  const startQuick = useCallback(async () => {
    setError(null);
    setNotice(null);
    leavingRef.current = false;
    setMatchId(null);
    setPhase('searching');
    try {
      const ticket = await findOrCreateQuickMatch();
      setMatchId(ticket.matchId);
      // Bekleyen bir maça katıldıysak zaten eşleştik.
      if (ticket.status !== 'waiting') setPhase('match-found');
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const cancelSearch = useCallback(async () => {
    const id = matchIdRef.current;
    leavingRef.current = true;
    if (id) await leaveMatch(id).catch(() => {});
    resetToLobby();
  }, [resetToLobby]);

  const createRoom = useCallback(async () => {
    setError(null);
    setNotice(null);
    leavingRef.current = false;
    setRoomCode(null);
    setMatchId(null);
    setPhase('create-room');
    try {
      const ticket = await createPrivateRoom();
      setMatchId(ticket.matchId);
      setRoomCode(ticket.roomCode ?? null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const cancelRoom = useCallback(async () => {
    const id = matchIdRef.current;
    leavingRef.current = true;
    if (id) await leaveMatch(id).catch(() => {});
    setPhase('private-choice');
    setMatchId(null);
    setRoomCode(null);
    setError(null);
  }, []);

  // Eşleşme ekranındaki İptal: ASIL sızıntı buradaydı — setup'a geçmiş maç
  // artık sunucuda da kapatılıyor; rakip realtime ile "maç iptal" görür.
  const cancelMatchFound = useCallback(async () => {
    const id = matchIdRef.current;
    leavingRef.current = true;
    if (id) await leaveMatch(id).catch(() => {});
    resetToLobby();
  }, [resetToLobby]);

  const joinRoom = useCallback(async (code: string) => {
    setJoinError(null);
    setNotice(null);
    leavingRef.current = false;
    setJoinBusy(true);
    try {
      const ticket = await joinPrivateRoom(code);
      setMatchId(ticket.matchId);
      setPhase('match-found');
    } catch (e) {
      setJoinError(errMsg(e));
    } finally {
      setJoinBusy(false);
    }
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

  const goSetup = useCallback(() => {
    const id = matchId;
    if (!id) return;
    // "Hazır": present işaretini gönder (iki taraf present olunca sunucu 30 sn'lik
    // belirleme sayacını başlatır). Karar/zaman sunucuda; sonuç realtime ile gelir.
    void markReady(id).catch(() => {});
    // Maçın sahipliği belirleme ekranına geçiyor; unmount temizliği yapma.
    liveMatchRef.current = null;
    resetToLobby();
    router.push({ pathname: '/match-setup', params: { matchId: id } });
  }, [matchId, resetToLobby, router]);

  // ── Türetilmiş gösterim ───────────────────────────────────────
  const opp = match ? (match.myRole === 'player1' ? match.player2 : match.player1) : null;
  const opponentName = opp?.username || 'Rakip';
  const mode: MatchMode = match?.mode ?? (roomCode ? 'private' : 'quick');

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
          onRetry={startQuick}
          onCreateRoom={createRoom}
          onBack={resetToLobby}
        />
      );
      break;
    case 'private-choice':
      content = (
        <PrivateChoiceScreen onCreate={createRoom} onJoin={() => setPhase('join-room')} onBack={resetToLobby} />
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
          onBack={() => {
            setJoinError(null);
            setPhase('private-choice');
          }}
        />
      );
      break;
    case 'match-found':
      content = (
        <MatchFoundScreen
          myName={name}
          opponentName={opponentName}
          mode={mode}
          onReady={goSetup}
          onCancel={cancelMatchFound}
        />
      );
      break;
    case 'lobby':
    default:
      content = (
        <LobbyHub
          notice={notice}
          onQuick={startQuick}
          onPrivate={() => setPhase('private-choice')}
          onHowTo={() => router.push('/how-to-play')}
          onBack={() => router.back()}
        />
      );
  }

  return <Screen>{content}</Screen>;
}
