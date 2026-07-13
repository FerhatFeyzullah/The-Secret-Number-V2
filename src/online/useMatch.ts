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
  resolveSetupTimeout,
} from './matchService';
import type { MatchState, OnlineGuess, PresenceInfo, ProtocolUse } from './types';

/** Heartbeat aralığı (maç setup/active iken). */
const HEARTBEAT_MS = 5_000;
/** Zaman aşımı/rakip-kopuş tespiti için ref-okuyan denetim aralığı (görsel saat
 *  DEĞİL — o artık useLiveClocks'ta yaprak seviyesinde). */
const WATCH_MS = 500;
/** Bu süreden sonra rakip "gitti" sayılır; sunucu heartbeat-reap eşiğiyle (15 sn)
 *  hizalı. Eşiğe ulaşınca istemci hızlandırıcı heartbeat atar → sunucu reap'i
 *  hemen tetiklenir (karar yine sunucuda, _reap_if_opponent_stale). */
const GONE_AFTER_MS = 15_000;
/** Yeniden bağlanma backoff üst sınırı. */
const MAX_RECONNECT_DELAY_MS = 10_000;

export type UseMatchResult = {
  /** Güvenli maç durumu; yüklenmeden/maç yokken null. */
  match: MatchState | null;
  /** Tahmin geçmişi (kendi + rakip), eskiden yeniye, realtime güncel. */
  guesses: OnlineGuess[];
  loading: boolean;
  error: string | null;
  /** Tüm durumu sunucudan yeniden çeker (ör. ekrana dönünce). */
  refresh: () => Promise<void>;
  /** Maç kanalına efemeral SİNYAL id'si yayınlar (maç sonu reaksiyonu; realtime
   *  broadcast; DB'ye YAZMAZ). Kullanılabilir set oyuncunun sinyal destesidir. */
  sendSignal: (signalId: string) => void;
  /** Rakipten gelen son sinyal id'si (kendi yayınların filtrelenir). nonce her
   *  gelişte artar; tüketici aynı sinyal tekrarında bile pop'u yenileyebilir. */
  incomingSignal: { id: string; nonce: number } | null;
  /** Maç kanalına efemeral METİN (hazır mesaj) yayınlar (realtime broadcast;
   *  DB'ye YAZMAZ). Sabit 6 hazır mesajdan biri (bkz. quick-texts). */
  sendText: (text: string) => void;
  /** Rakipten gelen son metin mesajı (kendi yayınların filtrelenir); nonce artar. */
  incomingText: { text: string; nonce: number } | null;
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
  // Rakipten gelen efemeral sinyal (broadcast); nonce ile her geliş ayrışır.
  const [incomingSignal, setIncomingSignal] = useState<{ id: string; nonce: number } | null>(null);
  const signalNonceRef = useRef(0);
  const [incomingText, setIncomingText] = useState<{ text: string; nonce: number } | null>(null);
  const textNonceRef = useRef(0);
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
  // refresh()'in faz/moda göre gereksiz sorgu atlaması için son maç meta'sı
  // (free-tier yükünü azaltır: ön-oyunda guesses/uses, protokol-dışı maçta uses yok).
  const matchMetaRef = useRef<{ status: MatchState['status'] | null; isProtocol: boolean }>({
    status: null,
    isProtocol: false,
  });
  // id → username cache'i: realtime payload'ında ad gelmez; bilinen adlar
  // buradan doldurulur, bilinmeyenler backfillUsernames ile bir kez çekilir.
  const usernamesRef = useRef<Record<string, string>>({});
  const pendingNamesRef = useRef<Set<string>>(new Set());
  // Interval callback'leri render'a bağlı olmadan güncel state okusun diye
  // ayna ref'ler (zaman aşımı/kopuş denetimi artık ref-okur, now state'i yok).
  const matchRef = useRef<MatchState | null>(null);
  const presenceRef = useRef<Record<string, PresenceInfo>>({});
  // A3: son realtime olay anı — emniyet poll'u realtime tazeyse turu atlar.
  const lastEventAtRef = useRef(0);
  // A4: realtime maç-satırı olay sırası — refresh() fetch'i sürerken daha yeni
  // bir realtime UPDATE geldiyse bayat snapshot maçı ezmesin.
  const matchEventSeqRef = useRef(0);

  /** Boş adlı (skipProfiles ya da realtime) MatchState'e cache'ten adları işler. */
  const withNames = useCallback((state: MatchState): MatchState => {
    const cache = usernamesRef.current;
    return {
      ...state,
      player1: {
        ...state.player1,
        username: state.player1.username ?? cache[state.player1.id] ?? null,
      },
      player2: state.player2
        ? {
            ...state.player2,
            username: state.player2.username ?? cache[state.player2.id] ?? null,
          }
        : null,
    };
  }, []);

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
      // Free-tier yükünü azalt: yalnız o fazda/moda ANLAMLI sorguları çalıştır.
      //  • guesses: sadece 'active' iken değişir (ön-oyunda tur boş). İlk yüklemede
      //    (status null) çek — mevcut geçmişi doldurmak için.
      //  • protokol kullanımları: yalnız protokol maçında ve seçim/aktif fazda.
      // Atlanan sorgu null döner → ilgili state'e DOKUNULMAZ (mevcut veri silinmez).
      const { status: metaStatus, isProtocol } = matchMetaRef.current;
      const firstLoad = metaStatus === null;
      const needGuesses = firstLoad || metaStatus === 'active';
      const needUses =
        firstLoad || (isProtocol && (metaStatus === 'active' || metaStatus === 'protocol_select'));
      // A5: iki oyuncunun adı da cache'te ise profiles sorgusunu atla (emniyet
      // poll'u her turda profiles'ı yeniden çekmesin — en sıcak döngü ~ikiye iner).
      const cached = usernamesRef.current;
      const m = matchRef.current;
      const skipProfiles =
        !firstLoad && !!m && !!cached[m.player1.id] && (!m.player2 || !!cached[m.player2.id]);
      // A4: fetch başlamadan realtime olay sırasını yakala.
      const seqAtStart = matchEventSeqRef.current;
      const [state, guessList, presenceList, useList] = await Promise.all([
        fetchMatchState(matchId, { skipProfiles }),
        needGuesses ? fetchGuesses(matchId) : Promise.resolve(null),
        fetchPresence(matchId),
        needUses ? fetchProtocolUses(matchId) : Promise.resolve(null),
      ]);
      if (!mountedRef.current) return;
      // Tam fetch'le gelen adları cache'e işle (realtime birleşmeleri kullanır).
      if (state) {
        for (const pl of [state.player1, state.player2]) {
          if (pl?.username) usernamesRef.current[pl.id] = pl.username;
        }
      }
      // A4: fetch sürerken daha YENİ realtime maç satırı geldiyse (seq değişti)
      // bayat snapshot'la ezme — sıra/faz geri-dönme titremesini önler. guesses/
      // presence/uses id-anahtarlı olduğundan koşulsuz uygulanır (kayıp olmaz).
      if (state && matchEventSeqRef.current === seqAtStart) {
        setMatch(withNames(state));
      } else if (!state) {
        setMatch(state);
      }
      if (guessList !== null) setGuesses(guessList);
      setPresence(Object.fromEntries(presenceList.map((p) => [p.player, p])));
      if (useList !== null) setProtocolUses(useList);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId, withNames]);

  // matchMetaRef'i güncel tut — refresh() faz/moda göre gereksiz sorguları atlar.
  useEffect(() => {
    matchMetaRef.current = {
      status: match?.status ?? null,
      isProtocol: match?.mode === 'protocol',
    };
  }, [match?.status, match?.mode]);

  // Ayna ref'ler: interval callback'leri (zaman aşımı/kopuş denetimi) güncel
  // match/presence okusun; bunun için render'a bağlı state yerine ref kullanılır.
  useEffect(() => {
    matchRef.current = match;
  }, [match]);
  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);

  // Realtime kaçaklarına karşı EMNİYET AĞI (poll). Gerçek cihazda postgres_changes
  // gecikebilir/düşebilir (hücresel ağ, arka plan throttle, sessiz websocket ölümü);
  // poll faz geçişlerini ve aktif maç güncellemelerini yine de yakalar.
  //  • Ön-oyun (waiting / protocol_select / setup): HIZLI (~2.5 sn) → belirleme→active
  //    geçişinde "rakip belirliyor"da takılma ve eşleşme→setup gecikmesi kısa kalır
  //    (setup/select ekranlarında iki-taraf-hazır hızlandırıcı refresh'ler de var).
  //  • Aktif: DÜŞÜK frekanslı (~5 sn) emniyet → realtime sessizce düşse bile rakibin
  //    tahmini/sıra/kazanması gelir, maç ortada DONMAZ.
  //  • Bitmiş/iptal: kapalı (gereksiz yük yok).
  // AppState kapılı (heartbeat gibi): arka planda poll durur (pil/free-tier);
  // öne dönünce anında bir refresh + interval yeniden başlar. Ayrıca realtime az
  // önce olay getirdiyse (lastEventAtRef) o tur atlanır → çift-çekim yok.
  useEffect(() => {
    if (!matchId) return;
    const s = match?.status ?? null;
    const pregame = s === null || s === 'waiting' || s === 'protocol_select' || s === 'setup';
    const active = s === 'active';
    if (!pregame && !active) return;
    const period = pregame ? 2500 : 5000;
    let iv: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (iv) return;
      iv = setInterval(() => {
        if (Date.now() - lastEventAtRef.current < period) return; // realtime taze → atla
        void refresh();
      }, period);
    };
    const stop = () => {
      if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };
    start();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') {
        void refresh(); // arkadayken kaçan state'i hemen yakala
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
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
            lastEventAtRef.current = Date.now(); // A3: realtime canlı
            matchEventSeqRef.current += 1; // A4: bayat refresh'i geçersizle
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
            lastEventAtRef.current = Date.now(); // A3
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
            lastEventAtRef.current = Date.now(); // A3
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
            lastEventAtRef.current = Date.now(); // A3
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
        .on('broadcast', { event: 'signal' }, ({ payload }) => {
          // Efemeral sinyal: yalnızca rakibinkini göster (kendi yayınını filtrele).
          const p = payload as { signal?: string; from?: string } | undefined;
          if (!p?.signal || p.from === myIdRef.current) return;
          signalNonceRef.current += 1;
          setIncomingSignal({ id: p.signal, nonce: signalNonceRef.current });
        })
        .on('broadcast', { event: 'text' }, ({ payload }) => {
          // Efemeral hazır mesaj: yalnızca rakibinkini göster (kendi yayınını filtrele).
          const p = payload as { text?: string; from?: string } | undefined;
          if (!p?.text || p.from === myIdRef.current) return;
          textNonceRef.current += 1;
          setIncomingText({ text: p.text, nonce: textNonceRef.current });
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
  // Heartbeat TÜM canlı maç fazlarını kapsar (seçim dahil) → sunucu reap'i her
  // fazda çalışır. (Tur arası status='setup' zaten dahil.)
  const inMatch = phase === 'protocol_select' || phase === 'setup' || phase === 'active';

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
  // now state'i yerine matchRef okuyan interval → ekran her tikte render OLMAZ.
  const claimedTurnRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || phase !== 'active') return;
    const iv = setInterval(() => {
      const m = matchRef.current;
      if (!m || m.status !== 'active' || !m.currentTurn || !m.turnStartedAt) return;
      const live = displayClocks(m, Date.now());
      const runningMs = m.currentTurn === m.player1.id ? live.clock1Ms : live.clock2Ms;
      if (runningMs > 0) return;
      // Bu tur için zaten denendi/devam ediyor — tekrar tetikleme.
      if (claimedTurnRef.current === m.turnStartedAt) return;
      claimedTurnRef.current = m.turnStartedAt;
      void claimTimeout(matchId).catch((e) => {
        // Drift/timeout: sunucu "henüz dolmadı" ya da ağ zaman aşımı → kilidi aç,
        // sonraki tikte tekrar dene.
        if (e instanceof OnlineError && (e.code === 'clock_not_expired' || e.code === 'timeout')) {
          claimedTurnRef.current = null;
        }
      });
    }, WATCH_MS);
    return () => clearInterval(iv);
  }, [matchId, phase]);

  // Tur-arası (Bo3, round ≥ 2) belirleme zaman aşımı: setup_deadline geçince
  // HER iki istemci de resolve eder (idempotent, karar sunucuda). Sırrını giren
  // turu kazanır; iki taraf da girmediyse maç iptal → oyalama ile lider'i
  // sonsuz beklemeye/forfeit'e zorlama açığı kapanır. 1. tur (current_round=1)
  // BURADA ELE ALINMAZ: route ekranı cancel_setup_timeout ile iptal eder
  // (sunucu da round=1'i not_inter_round ile reddeder — çift güvence).
  // now state'i yerine matchRef okuyan interval → render tetiklemez.
  const resolvedSetupRef = useRef<string | null>(null);
  useEffect(() => {
    if (!matchId || phase !== 'setup') return;
    const iv = setInterval(() => {
      const m = matchRef.current;
      if (!m || m.status !== 'setup') return;
      if (m.currentRound <= 1 || !m.setupDeadline) return;
      if (Date.now() <= Date.parse(m.setupDeadline)) return;
      // Tur + deadline başına bir kez (yeni tur taze deadline'la yeniden tetikler).
      const key = `${m.currentRound}:${m.setupDeadline}`;
      if (resolvedSetupRef.current === key) return;
      resolvedSetupRef.current = key;
      void resolveSetupTimeout(matchId).catch((e) => {
        // Drift/timeout: kilidi aç, sonraki tikte tekrar dene.
        if (e instanceof OnlineError && (e.code === 'setup_not_expired' || e.code === 'timeout')) {
          resolvedSetupRef.current = null;
        }
      });
    }, WATCH_MS);
    return () => clearInterval(iv);
  }, [matchId, phase]);

  // Hızlandırıcı: rakip "gitti" eşiğine (15 sn) ulaşınca hemen bir heartbeat at →
  // sunucu reap'i (hayatta olan lehine forfeit) periyodik 5 sn tikini beklemeden
  // tetiklenir. Karar yine sunucuda (_reap_if_opponent_stale); idempotent.
  // presenceRef/matchRef okuyan interval (now state'i kaldırıldı); eşik başına
  // bir kez ateşler, rakip dönünce yeniden tetiklenebilir.
  const goneFiredRef = useRef(false);
  useEffect(() => {
    if (!matchId || phase !== 'active') return;
    const iv = setInterval(() => {
      const m = matchRef.current;
      if (!m || m.status !== 'active') return;
      const opponentId =
        m.myRole === 'player1' ? (m.player2?.id ?? null) : m.player1.id;
      const info = opponentId ? presenceRef.current[opponentId] : undefined;
      if (!info) return;
      // Sunucudaki forfeit_disconnect ile aynı mantık: kopuş bildirildiyse o
      // andan, bildirilmediyse son heartbeat'ten bu yana geçen süre.
      const goneSinceMs = Date.now() - Date.parse(info.disconnectedAt ?? info.lastSeen);
      if (goneSinceMs >= GONE_AFTER_MS) {
        if (!goneFiredRef.current) {
          goneFiredRef.current = true;
          void heartbeat(matchId).catch(() => {});
        }
      } else {
        goneFiredRef.current = false; // rakip döndü → tekrar tetiklenebilir
      }
    }, WATCH_MS);
    return () => clearInterval(iv);
  }, [matchId, phase]);

  // Efemeral sinyal yayını: kanal üzerinden broadcast (DB'ye yazmaz).
  const sendSignal = useCallback((signalId: string) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: 'broadcast',
      event: 'signal',
      payload: { signal: signalId, from: myIdRef.current },
    });
  }, []);

  // Efemeral hazır-mesaj yayını: kanal üzerinden broadcast (DB'ye yazmaz).
  const sendText = useCallback((text: string) => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.send({
      type: 'broadcast',
      event: 'text',
      payload: { text, from: myIdRef.current },
    });
  }, []);

  return {
    match,
    guesses,
    loading,
    error,
    refresh,
    sendSignal,
    incomingSignal,
    sendText,
    incomingText,
    protocolUses,
    incomingProtocolUse,
  };
}
