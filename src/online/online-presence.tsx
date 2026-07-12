import type { RealtimeChannel } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/auth';

import { supabase } from '../supabase';

/** Tek paylaşımlı lobi presence kanalı. Mevcut realtime websocket'i üzerinden
 *  multiplex olur → ek soket açmaz. */
const PRESENCE_CHANNEL = 'online-presence';

const OnlineCountContext = createContext<number | null>(null);

/**
 * Uygulama-geneli "aktif online oyuncu" sayacı (Realtime Presence).
 *
 * Kanal her ekranda katılır (kullanıcı nerede olursa olsun "online" sayılır);
 * sayı yalnızca lobi ekranında GÖSTERİLİR. Presence key = userId → aynı kullanıcının
 * birden çok cihazı tek sayılır. KENDİ anahtarı sayımdan HARİÇ tutulur → yalnızsan 0
 * (başka oyuncu yoksa 1 yerine 0). Uygulama arka plana alınınca `untrack` ("şu an
 * açık" olanı yansıtır); öne gelince yeniden `track`. Çıkış/unmount'ta tam temizlik.
 */
export function OnlinePresenceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const client = supabase;
    // Supabase yapılandırılmamış (offline) ya da oturum yok → sayaç gizli.
    if (!client || !userId) {
      setCount(null);
      return;
    }
    let disposed = false;

    const channel: RealtimeChannel = client.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: userId } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      // Kendi presence anahtarını (userId) hariç tut → yalnızsan 0.
      if (!disposed) {
        setCount(Object.keys(channel.presenceState()).filter((key) => key !== userId).length);
      }
    });

    channel.subscribe((status) => {
      if (!disposed && status === 'SUBSCRIBED') {
        void channel.track({ online_at: Date.now() });
      }
    });

    const sub = AppState.addEventListener('change', (state) => {
      if (disposed) return;
      if (state === 'active') void channel.track({ online_at: Date.now() });
      else void channel.untrack();
    });

    return () => {
      disposed = true;
      sub.remove();
      void channel.untrack();
      void client.removeChannel(channel);
      setCount(null);
    };
  }, [userId]);

  return <OnlineCountContext.Provider value={count}>{children}</OnlineCountContext.Provider>;
}

/** Şu an uygulaması açık (canlı) oyuncu sayısı; abonelik yok/çevrimdışıysa null. */
export function useOnlineCount(): number | null {
  return useContext(OnlineCountContext);
}
