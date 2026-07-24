import { useEffect, useState } from 'react';

/** Gizem Çağı için güvenilir saat: aktifken her `ms`'de bir (varsayılan 500)
 *  yeniden render tetikler ve güncel `Date.now()` döner. Süre sayaçları buradan
 *  beslenince ekranda takılmadan akar (tek kaynak). */
export function useAgeClock(active = true, ms = 500): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setTick((x) => (x + 1) % 1_000_000), ms);
    return () => clearInterval(iv);
  }, [active, ms]);
  return Date.now();
}
