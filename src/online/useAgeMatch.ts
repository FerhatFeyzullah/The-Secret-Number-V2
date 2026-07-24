import type { RealtimeChannel } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '../supabase';
import { ageClaimPhase, ageGetState, type AgeState } from './ageService';

/** Emniyet poll aralığı (realtime kaçaklarına karşı). */
const POLL_MS = 3_000;
/** Faz/süre denetim aralığı (deadline geçince claim). */
const WATCH_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type UseAgeMatchResult = {
  state: AgeState | null;
  loading: boolean;
  error: string | null;
  /** Durumu sunucudan yeniden çeker. */
  refresh: () => Promise<void>;
};

/**
 * Bir Gizem Çağı maçını canlı izler: age_matches/territories/attacks realtime
 * aboneliği + emniyet poll + faz-geçiş tetikleyici. Tüm otorite sunucuda; hook
 * yalnız güvenli durumu (age_get_state) çeker. Heartbeat YOK — yarım maç reap'i
 * cron'da (prep/war deadline). Kopunca exponential backoff ile yeniden abone olur.
 */
export function useAgeMatch(matchId: string | null): UseAgeMatchResult {
  const [state, setState] = useState<AgeState | null>(null);
  const [loading, setLoading] = useState(matchId != null);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const stateRef = useRef<AgeState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventAtRef = useRef(0);
  // Her abonelik denemesine benzersiz topic (removeChannel async; remount'ta eski
  // kanal henüz kaldırılmadan aynı topic'le çağrılınca abone-sonrası .on() patlıyor).
  const subSeqRef = useRef(0);
  // Faz başına bir kez claim (deadline+phase anahtarıyla; yeni faz yeniden tetikler).
  const claimedRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!matchId) return;
    try {
      const s = await ageGetState(matchId);
      if (!mountedRef.current) return;
      setState(s);
      stateRef.current = s;
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Bağlantı hatası, lütfen tekrar dene.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [matchId]);

  // Realtime abonelik + yeniden bağlanma.
  useEffect(() => {
    mountedRef.current = true;
    if (!matchId) {
      setState(null);
      setLoading(false);
      return;
    }
    if (!supabase) {
      setError('Online mod yapılandırılmamış.');
      setLoading(false);
      return;
    }
    const client = supabase;
    let disposed = false;

    const teardown = () => {
      if (channelRef.current) {
        void client.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimerRef.current) return;
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1_000 * 2 ** reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        subscribe();
      }, delay);
    };

    const onChange = () => {
      lastEventAtRef.current = Date.now();
      void refresh();
    };

    const subscribe = () => {
      if (disposed) return;
      teardown();
      const filter = `match_id=eq.${matchId}`;
      subSeqRef.current += 1;
      const channel = client
        .channel(`age-match-${matchId}-${subSeqRef.current}`, { config: { broadcast: { self: false } } })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'age_matches', filter: `id=eq.${matchId}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'age_territories', filter }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'age_attacks', filter }, onChange)
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            reconnectAttemptRef.current = 0;
            void refresh();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            scheduleReconnect();
          }
        });
      channelRef.current = channel;
    };

    subscribe();
    return () => {
      disposed = true;
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      teardown();
    };
  }, [matchId, refresh]);

  // Emniyet poll (realtime taze değilse) — AppState kapılı.
  useEffect(() => {
    if (!matchId) return;
    const phase = state?.phase ?? null;
    if (phase === 'finished' || phase === 'cancelled') return;
    let iv: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (iv) return;
      iv = setInterval(() => {
        if (Date.now() - lastEventAtRef.current < POLL_MS) return; // realtime taze → atla
        void refresh();
      }, POLL_MS);
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
        void refresh();
        start();
      } else stop();
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [matchId, state?.phase, refresh]);

  // Faz/süre geçişi: prep/war deadline geçince claim (bir kez), sonra refresh.
  useEffect(() => {
    if (!matchId) return;
    const iv = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      const deadline =
        s.phase === 'prep' ? s.prepEndsAt : s.phase === 'war' ? s.warEndsAt : null;
      if (!deadline) return;
      if (Date.now() <= Date.parse(deadline)) return;
      const key = `${s.phase}:${deadline}`;
      if (claimedRef.current === key) return;
      claimedRef.current = key;
      void ageClaimPhase(matchId)
        .then(() => refresh())
        .catch(() => {
          claimedRef.current = null; // tekrar denenebilir
        });
    }, WATCH_MS);
    return () => clearInterval(iv);
  }, [matchId, refresh]);

  return { state, loading, error, refresh };
}
