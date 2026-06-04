import type { Digit, Secret } from './types';

const ALL_DIGITS: readonly Digit[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * 1-9 arasından 3 farklı rakamlı gizli sayı üretir.
 * `rng` enjekte edilebilir (testlerde determinizm için), varsayılan Math.random.
 */
export function generateSecret(rng: () => number = Math.random): Secret {
  // Kısmi Fisher-Yates: havuzun ilk 3 pozisyonunu rastgele doldur.
  const pool = [...ALL_DIGITS];
  for (let i = 0; i < 3; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return [pool[0], pool[1], pool[2]];
}
