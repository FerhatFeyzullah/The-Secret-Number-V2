import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../supabase';
import {
  guessRowToGuess,
  displayClocks,
  matchRowToState,
  presenceRowToInfo,
  type GuessRow,
  type MatchRow,
  type PresenceRow,
} from './mapping';
import {
  claimTimeout,
  fetchGuesses,
  fetchMatchState,
  fetchPresence,
  heartbeat,
  OnlineError,
} from './matchService';
import type { MatchState, OnlineGuess, PresenceInfo } from './types';

/** Heartbeat aralığı (maç setup/active iken). */
const HEARTBEAT_MS = 5_000;
/** Görsel saat/presence tazeleme aralığı. */
const TICK_MS = 250;
/** Rakipten bu kadar süre sinyal yoksa "bağlantısı koptu" göstergesi. */
const UNSTABLE_AFTER_MS = 10_000;
/** Bu süreden sonra claimTimeout/forfeitDisconnect çağrılabilir (karar sunucuda). */
const GONE_AFTER_MS = 30_000;
/** Yeniden bağlanma backoff üst sınırı. */
const MAX_RECONNECT_DELAY_MS = 10_000;

export type UseMatchResult = {
  /** Güvenli maç durumu; yüklenmeden/maç yokken null. */
  match: MatchState | null;
  /** Tahmin geçmişi (kendi + rakip), eskiden yeniye, realtime güncel. */
  guesses: OnlineGuess[];
  /** Görsel geri sayım — yalnızca gösterim, gerçek karar sunucuda. */
  clocks: { clock1Ms: number; clock2Ms: number };
  /** Rakipten ~10 sn'dir sinyal yok (gösterim seviyesi uyarı). */
  opponentUnstable: boolean;
  /** 30 sn penceresi doldu; claimTimeout/forfeitDisconnect denenebilir. */
  opponentGone: boolean;
  loading: boolean;
  error: string | null;
  /** Tüm durumu sunucudan yeniden çeker (ör. ekrana dönünce). */
  refresh: () => Promise<void>;
  /** Maç kanalına efemeral emoji yayınlar (realtime broadcast; DB'ye YAZMAZ). */
  sendEmoji: (emoji: string) => void;
  /** Rakipten gelen son emoji (kendi yayınların filtrelenir). nonce her gelişte
   *  artar; tüketici aynı emoji tekrarında bile pop animasyonunu yenileyebilir. */
  incomingEmoji: { emoji: string; nonce: number } | null;
};

/**
 * Bir maçı canlı izler: matches/guesses/presence realtime aboneliği kurar,
 * istemci-taraflı saat geri sayımını ve heartbeat'i yönetir.
 *
 * - Sunucudan her yeni state geldiğinde saatler yeniden senkronlanır
 *   (drift düzeltme); aradaki geri sayım yalnızca gösterimdir.
 * - Kanal koptuğunda exponential backoff ile yeniden abone olur ve kaçan
 *   olayları tam refresh ile kapatır.
 * - Unmount'ta kanal/zamanlayıcılar temizlenir; çift abonelik oluşmaz.
 */
export function useMatch(matchId: string | null): UseMatchResult {
  const [match, setMatch] = useState<MatchState | null>(null);
  const [guesses, setGuesses] = useState<OnlineGuess[]>([]);
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});
  const [loading, setLoading] = useState(matchId != null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Rakipten gelen efemeral emoji (broadcast); nonce ile her geliş ayrışır.
  const [incomingEmoji, setIncomingEmoji] = useState<{ emoji: string; nonce: number } | null>(null);
  const emojiNonceRef = useRef(0);

  const myIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      const [state, guessList, presenceList] = await Promise.all([
        fetchMatchState(matchId),
        fetchGuesses(matchId),
        fetchPresence(matchId),
      ]);
      if (!mountedRef.current) return;
      setMatch(state);
      setGuesses(guessList);
      setPresence(Object.fromEntries(presenceList.map((p) => [p.player, p])));
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId]);

  // Realtime abonelik + kopunca yeniden bağlanma.
  useEffect(() => {
    mountedRef.current = true;
    if (!matchId) return;
    if (!supabase) {
      setError('Online mod yapılandırılmamış.');
      setLoading(false);
      return;
    }
    const client = supabase;
    let disposed = false;

    const teardownChannel = () => {
      if (channelRef.current) {
        void client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current) return;
      const delay = Math.min(
        MAX_RECONNECT_DELAY_MS,
        1_000 * 2 ** reconnectAttemptRef.current,
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        subscribe();
      }, delay);
    };

    const subscribe = () => {
      if (disposed) return;
      teardownChannel(); // çift abonelik olmasın
      const channel = client
        .channel(`match-${matchId}`, { config: { broadcast: { self: false } } })
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
          (payload) => {
            const myId = myIdRef.current;
            if (!myId) return;
            setMatch((prev) => {
              const next = matchRowToState(payload.new as MatchRow, myId);
              if (!next) return prev;
              // Realtime satırında profil adları yok; eldekini koru.
              return {
                ...next,
                player1: { ...next.player1, username: prev?.player1.username ?? null },
                player2: next.player2
                  ? { ...next.player2, username: prev?.player2?.username ?? null }
                  : null,
              };
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'guesses', filter: `match_id=eq.${matchId}` },
          (payload) => {
            const guess = guessRowToGuess(payload.new as GuessRow);
            setGuesses((prev) =>
              prev.some((g) => g.id === guess.id) ? prev : [...prev, guess],
            );
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'presence', filter: `match_id=eq.${matchId}` },
          (payload) => {
            const row = payload.new as PresenceRow;
            if (!row?.player) return;
            const info = presenceRowToInfo(row);
            setPresence((prev) => ({ ...prev, [info.player]: info }));
          },
        )
        .on('broadcast', { event: 'emoji' }, ({ payload }) => {
          // Efemeral emoji: yalnızca rakibinkini göster (kendi yayınını filtrele).
          const p = payload as { emoji?: string; from?: string } | undefined;
          if (!p?.emoji || p.from === myIdRef.current) return;
          emojiNonceRef.current += 1;
          setIncomingEmoji({ emoji: p.emoji, nonce: emojiNonceRef.current });
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            reconnectAttemptRef.current = 0;
            // Abonelik (yeniden) kuruldu: kaçmış olabilecek olayları kapat.
            void refresh();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            scheduleReconnect();
          }
        });
      channelRef.current = channel;
    };

    void (async () => {
      const { data } = await client.auth.getSession();
      myIdRef.current = data.session?.user.id ?? null;
      if (!disposed) subscribe();
    })();

    return () => {
      disposed = true;
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      teardownChannel();
    };
  }, [matchId, refresh]);

  const phase = match?.status ?? null;
  const inPlay = phase === 'setup' || phase === 'active';

  // Görsel saat + presence yaşı için yerel tik.
  useEffect(() => {
    if (!inPlay) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [inPlay]);

  // Heartbeat: maç setup/active iken ve uygulama öndeyken periyodik gönder.
  useEffect(() => {
    if (!matchId || !inPlay) return;
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) return;
      void heartbeat(matchId).catch(() => {}); // tek atımlık kayıp önemli değil
      timer = setInterval(() => {
        void heartbeat(matchId).catch(() => {});
      }, HEARTBEAT_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        start();
        void refresh(); // arkadayken kaçan state'i yakala
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [matchId, inPlay, refresh]);

  // Otomatik zaman aşımı: sıradaki oyuncunun görsel saati 0'a inince HER iki
  // istemci de claim eder. Karar sunucuda (now() ile doğrular); kaybeden =
  // current_turn, kazanan = diğeri (çağıran kim olursa olsun). Idempotent.
  const claimedTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || !match || match.status !== 'active') return;
    if (!match.currentTurn || !match.turnStartedAt) return;
    const live = displayClocks(match, now);
    const runningMs =
      match.currentTurn === match.player1.id ? live.clock1Ms : live.clock2Ms;
    if (runningMs > 0) return;
    // Bu tur için zaten denendi/devam ediyor — tekrar tetikleme.
    if (claimedTurnRef.current === match.turnStartedAt) return;
    claimedTurnRef.current = match.turnStartedAt;
    void claimTimeout(matchId).catch((e) => {
      // Drift: sunucu "henüz dolmadı" derse kilidi aç, sonraki tikte tekrar dene.
      if (e instanceof OnlineError && e.code === 'clock_not_expired') {
        claimedTurnRef.current = null;
      }
    });
  }, [matchId, match, now]);

  // Türetilmiş gösterim değerleri.
  const clocks = match
    ? displayClocks(match, now)
    : { clock1Ms: 0, clock2Ms: 0 };

  let opponentUnstable = false;
  let opponentGone = false;
  if (match && phase === 'active') {
    const opponentId =
      match.myRole === 'player1' ? (match.player2?.id ?? null) : match.player1.id;
    const info = opponentId ? presence[opponentId] : undefined;
    if (info) {
      // Sunucudaki forfeit_disconnect ile aynı mantık: kopuş bildirildiyse o
      // andan, bildirilmediyse son heartbeat'ten bu yana geçen süre.
      const goneSinceMs =
        now -
        Date.parse(info.disconnectedAt ?? info.lastSeen);
      opponentUnstable = goneSinceMs >= UNSTABLE_AFTER_MS;
      opponentGone = goneSinceMs >= GONE_AFTER_MS;
    }
  }

  // Efemeral emoji yayını: kanal üzerinden broadcast (DB'ye yazmaz).
  const sendEmoji = useCallback((emoji: string) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({ type: 'broadcast', event: 'emoji', payload: { emoji, from: myIdRef.current } });
  }, []);

  return {
    match,
    guesses,
    clocks,
    opponentUnstable,
    opponentGone,
    loading,
    error,
    refresh,
    sendEmoji,
    incomingEmoji,
  };
}
