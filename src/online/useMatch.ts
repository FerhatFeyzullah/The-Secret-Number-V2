import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../supabase';
import {
  guessRowToGuess,
  displayClocks,
  matchRowToState,
  presenceRowToInfo,
  protocolUseRowToUse,
  type GuessRow,
  type MatchRow,
  type PresenceRow,
  type ProtocolUseRow,
} from './mapping';
import {
  claimTimeout,
  fetchGuesses,
  fetchMatchState,
  fetchPresence,
  fetchProtocolUses,
  heartbeat,
  OnlineError,
} from './matchService';
import type { MatchState, OnlineGuess, PresenceInfo, ProtocolUse } from './types';

/** Heartbeat aralığı (maç setup/active iken). */
const HEARTBEAT_MS = 5_000;
/** Görsel saat/presence tazeleme aralığı. */
const TICK_MS = 250;
/** Rakipten bu kadar süre sinyal yoksa "bağlantısı koptu" göstergesi. */
const UNSTABLE_AFTER_MS = 10_000;
/** Bu süreden sonra rakip "gitti" sayılır; sunucu heartbeat-reap eşiğiyle (15 sn)
 *  hizalı. opponentGone true olunca istemci hızlandırıcı heartbeat atar → sunucu
 *  reap'i hemen tetiklenir (karar yine sunucuda, _reap_if_opponent_stale). */
const GONE_AFTER_MS = 15_000;
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
  /** Maçın protokol kullanım kayıtları (iki oyuncununki; sır içermez),
   *  realtime güncel. Şerit "kullanıldı" durumu buradan türetilir. */
  protocolUses: ProtocolUse[];
  /** Az önce düşen protokol olayı (yalnız realtime INSERT'ten; geçmiş kayıtlar
   *  tetiklemez): rakibin kullanımı (her outcome) YA DA kendi protokolünün
   *  Zorla Harca ile tüketilmesi (outcome='wasted', satır sana ait). nonce
   *  her gelişte artar — kısa bildirim için. */
  incomingProtocolUse: {
    player: string;
    protocolId: string;
    outcome: ProtocolUse['outcome'];
    nonce: number;
  } | null;
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
  // Protokol kullanım kayıtları (realtime + refresh) ve canlı olay sinyali.
  const [protocolUses, setProtocolUses] = useState<ProtocolUse[]>([]);
  const [incomingProtocolUse, setIncomingProtocolUse] = useState<{
    player: string;
    protocolId: string;
    outcome: ProtocolUse['outcome'];
    nonce: number;
  } | null>(null);
  const protoNonceRef = useRef(0);

  const myIdRef = useRef<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  // id → username cache'i: realtime payload'ında ad gelmez; bilinen adlar
  // buradan doldurulur, bilinmeyenler backfillUsernames ile bir kez çekilir.
  const usernamesRef = useRef<Record<string, string>>({});
  const pendingNamesRef = useRef<Set<string>>(new Set());

  /** State'teki adı null kalan oyuncular için tek hafif profiles sorgusu. */
  const backfillUsernames = useCallback((ids: (string | null | undefined)[]) => {
    const client = supabase;
    if (!client) return;
    const missing = ids.filter(
      (id): id is string =>
        Boolean(id) && !usernamesRef.current[id!] && !pendingNamesRef.current.has(id!),
    );
    if (!missing.length) return;
    missing.forEach((id) => pendingNamesRef.current.add(id));
    void client
      .from('profiles')
      .select('id, username')
      .in('id', missing)
      .then(({ data }) => {
        missing.forEach((id) => pendingNamesRef.current.delete(id));
        if (!mountedRef.current || !data?.length) return;
        for (const p of data) {
          if (p.username) usernamesRef.current[p.id] = p.username;
        }
        setMatch((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            player1: {
              ...prev.player1,
              username: prev.player1.username ?? usernamesRef.current[prev.player1.id] ?? null,
            },
            player2: prev.player2
              ? {
                  ...prev.player2,
                  username:
                    prev.player2.username ?? usernamesRef.current[prev.player2.id] ?? null,
                }
              : null,
          };
        });
      });
  }, []);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      const [state, guessList, presenceList, useList] = await Promise.all([
        fetchMatchState(matchId),
        fetchGuesses(matchId),
        fetchPresence(matchId),
        fetchProtocolUses(matchId),
      ]);
      if (!mountedRef.current) return;
      // Tam fetch'le gelen adları cache'e işle (realtime birleşmeleri kullanır).
      if (state) {
        for (const pl of [state.player1, state.player2]) {
          if (pl?.username) usernamesRef.current[pl.id] = pl.username;
        }
      }
      setMatch(state);
      setGuesses(guessList);
      setPresence(Object.fromEntries(presenceList.map((p) => [p.player, p])));
      setProtocolUses(useList);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId]);

  // Realtime kaçaklarına karşı EMNİYET AĞI: ön-oyun fazlarında (waiting /
  // protocol_select / setup) maç durumunu periyodik tazele. Bir matches UPDATE'i
  // realtime'da düşse bile (ör. eşleşme → protocol_select, seçim → setup, belirleme
  // → active) faz geçişi yine de yakalanır; oyuncu "rakip aranıyor"da ya da
  // belirleme/seçim ekranında takılı kalmaz. Aktif/bitmiş fazda kapalı (gereksiz yük).
  useEffect(() => {
    if (!matchId) return;
    const s = match?.status ?? null;
    const pregame = s === null || s === 'waiting' || s === 'protocol_select' || s === 'setup';
    if (!pregame) return;
    const iv = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(iv);
  }, [matchId, match?.status, refresh]);

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
            const row = payload.new as MatchRow;
            setMatch((prev) => {
              const next = matchRowToState(row, myId);
              if (!next) return prev;
              // Realtime satırında profil adları yok; eldekinden/cache'ten doldur.
              return {
                ...next,
                player1: {
                  ...next.player1,
                  username:
                    prev?.player1.username ?? usernamesRef.current[next.player1.id] ?? null,
                },
                player2: next.player2
                  ? {
                      ...next.player2,
                      username:
                        prev?.player2?.username ??
                        usernamesRef.current[next.player2.id] ??
                        null,
                    }
                  : null,
              };
            });
            // Adı hâlâ bilinmeyen oyuncu varsa (ör. rakip yeni katıldı) bir kez çek.
            backfillUsernames([row.player1, row.player2]);
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
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'match_protocol_uses',
            filter: `match_id=eq.${matchId}`,
          },
          (payload) => {
            const use = protocolUseRowToUse(payload.new as ProtocolUseRow);
            setProtocolUses((prev) =>
              prev.some((u) => u.id === use.id) ? prev : [...prev, use],
            );
            // Bildirim: rakibin canlı kullanımı (her outcome) YA DA kendi
            // protokolünün harcanması (wasted satırı kurbana yazılır). Kendi
            // normal kullanımın RPC dönüşüyle zaten onaylanır.
            if (use.player !== myIdRef.current || use.outcome === 'wasted') {
              protoNonceRef.current += 1;
              setIncomingProtocolUse({
                player: use.player,
                protocolId: use.protocolId,
                outcome: use.outcome,
                nonce: protoNonceRef.current,
              });
            }
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
  }, [matchId, refresh, backfillUsernames]);

  const phase = match?.status ?? null;
  const inPlay = phase === 'setup' || phase === 'active';
  // Heartbeat TÜM canlı maç fazlarını kapsar (seçim dahil) → sunucu reap'i her
  // fazda çalışır. (Tur arası status='setup' zaten dahil.)
  const inMatch = phase === 'protocol_select' || phase === 'setup' || phase === 'active';

  // Görsel saat + presence yaşı için yerel tik.
  useEffect(() => {
    if (!inPlay) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [inPlay]);

  // Heartbeat: maç CANLI (protocol_select/setup/active) iken ve uygulama öndeyken
  // periyodik gönder. Heartbeat aynı zamanda sunucu reap'ini tetikler (hayatta
  // olan, 15 sn+ sessiz rakibi kapatır). Arka plana geçerken SON bir heartbeat
  // atılır → backgrounded oyuncuya ~15 sn tolerans (kısa bildirim/uygulama
  // değişiminde haksız forfeit olmaz).
  useEffect(() => {
    if (!matchId || !inMatch) return;
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
        void heartbeat(matchId).catch(() => {}); // arka plana geçerken son sinyal (tolerans)
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [matchId, inMatch, refresh]);

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

  // Hızlandırıcı: rakip "gitti" eşiğine (15 sn) ulaşınca hemen bir heartbeat at →
  // sunucu reap'i (hayatta olan lehine forfeit) periyodik 5 sn tikini beklemeden
  // tetiklenir. Karar yine sunucuda (_reap_if_opponent_stale); idempotent.
  useEffect(() => {
    if (opponentGone && matchId) void heartbeat(matchId).catch(() => {});
  }, [opponentGone, matchId]);

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
    protocolUses,
    incomingProtocolUse,
  };
}
