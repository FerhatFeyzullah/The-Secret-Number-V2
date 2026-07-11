import { useEffect, useState } from 'react';

import { displayClocks } from './mapping';
import type { MatchState } from './types';

/**
 * Görsel satranç saati: yalnız BU hook'u çağıran (yaprak) bileşen 250 ms'de bir
 * render olur. Böylece saat tiki koca düello ekranını değil sadece saat çipini
 * yeniler. Karar sunucuda; bu değerler yalnız gösterimdir (displayClocks modeli).
 *
 * Interval SADECE tur işlerken (status='active', turnStartedAt var, donmamış)
 * çalışır; diğer fazlarda saat statiktir → interval kurulmaz. Her yeni maç
 * snapshot'ında değerler anında yeniden senkronlanır (drift düzeltme).
 */
export function useLiveClocks(match: MatchState | null): { clock1Ms: number; clock2Ms: number } {
  const [clocks, setClocks] = useState(() =>
    match ? displayClocks(match, Date.now()) : { clock1Ms: 0, clock2Ms: 0 },
  );

  useEffect(() => {
    if (!match) {
      setClocks({ clock1Ms: 0, clock2Ms: 0 });
      return;
    }
    // Yeni snapshot → anında senkronla (sunucu state'i esas).
    setClocks(displayClocks(match, Date.now()));
    const ticking = match.status === 'active' && !!match.turnStartedAt && !match.turnFrozen;
    if (!ticking) return;
    const iv = setInterval(() => setClocks(displayClocks(match, Date.now())), 250);
    return () => clearInterval(iv);
  }, [match]);

  return clocks;
}
