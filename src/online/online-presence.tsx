import type { RealtimeChannel } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth';

import { supabase } from '../supabase';
import type { ContentTypeId } from '../game';

/** Tek paylaşımlı lobi presence kanalı. Mevcut realtime websocket'i üzerinden
 *  multiplex olur → ek soket açmaz. */
const PRESENCE_CHANNEL = 'online-presence';

/** Oyuncunun ŞU AN izlenebilir maçı (klan maç izleme girişi için). Yalnız
 *  eşleşmeli (mode <> 'private') ve canlı fazdaki maçlar yayınlanır. */
export type LiveMatchInfo = { matchId: string; content: ContentTypeId };

const OnlineCountContext = createContext<number | null>(null);
const OnlineIdsContext = createContext<Set<string>>(new Set());
const LiveMatchesContext = createContext<Map<string, LiveMatchInfo>>(new Map());
/** Kendi canlı maçını presence'a yazan setter (sağlayıcı yoksa no-op). */
const PublishMatchContext = createContext<(m: LiveMatchInfo | null) => void>(() => {});

/**
 * Uygulama-geneli "aktif online oyuncu" sayacı (Realtime Presence).
 *
 * Kanal her ekranda katılır (kullanıcı nerede olursa olsun "online" sayılır);
 * sayı yalnızca lobi ekranında GÖSTERİLİR. Presence key = userId → aynı kullanıcının
 * birden çok cihazı tek sayılır. KENDİ anahtarı sayımdan HARİÇ tutulur → yalnızsan 0
 * (başka oyuncu yoksa 1 yerine 0). Uygulama arka plana alınınca `untrack` ("şu an
 * açık" olanı yansıtır); öne gelince yeniden `track`. Çıkış/unmount'ta tam temizlik.
 *
 * Ayrıca payload'da oyuncunun CANLI MAÇI taşınır (klan maç izleme "göz" ikonu
 * bunu okur) — ekstra DB sorgusu yok, anlık. Sahte payload riski yoktur: asıl
 * erişim kapısı sunucudaki can_spectate_match RLS'idir.
 */
export function OnlinePresenceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [count, setCount] = useState<number | null>(null);
  // Çevrimiçi tüm oyuncu id'leri (KENDİ dahil) — üye/klan kartlarında yeşil
  // gösterge + çevrimiçi sayımı için.
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  // playerId → izlenebilir canlı maç (klan üye kartındaki göz ikonu).
  const [liveMatches, setLiveMatches] = useState<Map<string, LiveMatchInfo>>(new Map());

  // Kendi canlı maçım — kanal effect'ini yeniden kurmadan payload'a yazılır.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const myMatchRef = useRef<LiveMatchInfo | null>(null);
  const [myMatch, setMyMatch] = useState<LiveMatchInfo | null>(null);
  myMatchRef.current = myMatch;

  const publishMatch = useCallback((m: LiveMatchInfo | null) => {
    // Aynı değerse state'e dokunma (gereksiz re-render/track yok).
    setMyMatch((prev) => {
      if (prev?.matchId === m?.matchId && prev?.content === m?.content) return prev;
      return m;
    });
  }, []);

  useEffect(() => {
    const client = supabase;
    // Supabase yapılandırılmamış (offline) ya da oturum yok → sayaç gizli.
    if (!client || !userId) {
      setCount(null);
      setOnlineIds(new Set());
      setLiveMatches(new Map());
      return;
    }
    let disposed = false;

    const channel: RealtimeChannel = client.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    });
    channelRef.current = channel;

    const payload = () => ({
      online_at: Date.now(),
      match_id: myMatchRef.current?.matchId ?? null,
      match_content: myMatchRef.current?.content ?? null,
    });

    channel.on('presence', { event: 'sync' }, () => {
      if (disposed) return;
      const state = channel.presenceState();
      const keys = Object.keys(state);
      setOnlineIds(new Set(keys));
      // Kendi presence anahtarını (userId) hariç tut → yalnızsan 0.
      setCount(keys.filter((key) => key !== userId).length);
      const live = new Map<string, LiveMatchInfo>();
      for (const [key, entries] of Object.entries(state)) {
        for (const e of entries as { match_id?: string | null; match_content?: string | null }[]) {
          if (e.match_id) {
            live.set(key, {
              matchId: e.match_id,
              content: (e.match_content as ContentTypeId) ?? 'number',
            });
          }
        }
      }
      setLiveMatches(live);
    });

    channel.subscribe((status) => {
      if (!disposed && status === 'SUBSCRIBED') {
        void channel.track(payload());
      }
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (disposed) return;
      if (state === 'active') void channel.track(payload());
      else void channel.untrack();
    });

    return () => {
      disposed = true;
      sub.remove();
      void channel.untrack();
      void client.removeChannel(channel);
      channelRef.current = null;
      setCount(null);
      setOnlineIds(new Set());
      setLiveMatches(new Map());
    };
  }, [userId]);

  // Canlı maç değişince payload'ı tazele (kanalı yeniden kurmadan).
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    void ch.track({
      online_at: Date.now(),
      match_id: myMatch?.matchId ?? null,
      match_content: myMatch?.content ?? null,
    });
  }, [myMatch]);

  return (
    <OnlineCountContext.Provider value={count}>
      <OnlineIdsContext.Provider value={onlineIds}>
        <LiveMatchesContext.Provider value={liveMatches}>
          <PublishMatchContext.Provider value={publishMatch}>{children}</PublishMatchContext.Provider>
        </LiveMatchesContext.Provider>
      </OnlineIdsContext.Provider>
    </OnlineCountContext.Provider>
  );
}

/** Şu an uygulaması açık (canlı) oyuncu sayısı; abonelik yok/çevrimdışıysa null. */
export function useOnlineCount(): number | null {
  return useContext(OnlineCountContext);
}

/** Şu an çevrimiçi tüm oyuncu id'leri (kendi dahil). Üye/klan çevrimiçi göstergesi. */
export function useOnlineIds(): Set<string> {
  return useContext(OnlineIdsContext);
}

/** playerId → izlenebilir canlı maç. Klan üye kartındaki "göz" ikonu bunu okur. */
export function useLiveMatches(): Map<string, LiveMatchInfo> {
  return useContext(LiveMatchesContext);
}

/** Kendi canlı maçını presence'a yazan setter (useMatch kullanır). */
export function usePublishMyMatch(): (m: LiveMatchInfo | null) => void {
  return useContext(PublishMatchContext);
}
