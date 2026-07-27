import { useEffect, useState } from 'react';

/** Gizem Çağı için güvenilir saat: aktifken her `ms`'de bir (varsayılan 500)
 *  yeniden render tetikler ve güncel zamanı döner. Süre sayaçları buradan
 *  beslenince ekranda takılmadan akar (tek kaynak).
 *
 *  DİKKAT — zaman STATE'te tutulur, render sırasında `Date.now()` OKUNMAZ.
 *  Projede React Compiler açık (app.json → experiments.reactCompiler). Derleyici
 *  reaktif girdisi olmayan ifadeleri bileşen örneği başına bir kez hesaplayıp
 *  önbelleğe alır; render gövdesinde `return Date.now()` yazıldığında saat İLK
 *  render'daki değerde sonsuza dek donuyordu (tik atıyor, sayı değişmiyordu).
 *  useState değeri reaktif girdi olduğu için önbelleğe alınamaz → burayı tekrar
 *  "sadeleştirip" render'da Date.now() okumaya DÖNMEYİN. */
export function useAgeClock(active = true, ms = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now()); // aktifleşince (ör. arka plandan dönüşte) hemen tazele
    const iv = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(iv);
  }, [active, ms]);
  return now;
}
