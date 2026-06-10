import type { ContentTypeDef } from './content';
import type { Digit, GuessResult, InvalidReason, Secret } from './types';

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

type ParsedGuess =
  | { ok: true; digits: Secret }
  | { ok: false; reason: InvalidReason };

/** Ham tahmin girdisini doğrular: tam 3 hane, 1-9, sıfırsız, tekrarsız. */
export function parseGuess(input: string): ParsedGuess {
  if (input.length !== 3) {
    return { ok: false, reason: 'length' };
  }
  const digits: Digit[] = [];
  for (const ch of input) {
    if (ch === '0') {
      return { ok: false, reason: 'zero' };
    }
    if (ch < '1' || ch > '9') {
      return { ok: false, reason: 'nonDigit' };
    }
    digits.push(Number(ch) as Digit);
  }
  if (new Set(digits).size !== digits.length) {
    return { ok: false, reason: 'duplicate' };
  }
  // Uzunluk yukarıda 3 olarak doğrulandı.
  return { ok: true, digits: digits as unknown as Secret };
}

/**
 * Tahmini deterministik olarak değerlendirir.
 *
 * valueMatch < 3 iken yalnızca kaç rakamın doğru olduğu söylenir;
 * valueMatch === 3 iken yalnızca kazanıp kazanmadığı söylenir.
 * Pozisyon eşleşme sayısı hiçbir dalda hesaplanıp dışarı verilmez.
 */
export function evaluateGuess(secret: Secret, guess: string): GuessResult {
  const parsed = parseGuess(guess);
  if (!parsed.ok) {
    return { status: 'invalid', reason: parsed.reason };
  }

  const valueMatch = parsed.digits.filter((d) => secret.includes(d)).length;
  if (valueMatch < 3) {
    return { status: 'partial', correctCount: valueMatch as 0 | 1 | 2 };
  }

  const isWin = parsed.digits.every((d, i) => d === secret[i]);
  return isWin ? { status: 'win' } : { status: 'digitsCorrectWrongOrder' };
}

/**
 * "Sayı" içerik tipi tanımı. Digit/Secret tuple'ları bu modülün iç
 * detayıdır; ContentTypeDef sınırında her şey string taşınır (DB/RPC
 * sınırıyla aynı format).
 */
export const numberContent: ContentTypeDef = {
  id: 'number',
  secretLength: 3,
  generate(rng = Math.random) {
    return generateSecret(rng).join('');
  },
  parse(input) {
    const parsed = parseGuess(input);
    return parsed.ok ? { ok: true, value: input } : { ok: false, reason: parsed.reason };
  },
  evaluate(secret, guess) {
    const parsed = parseGuess(secret);
    if (!parsed.ok) {
      // Secret güvenilir kaynaktan gelir (generate/sunucu); buraya düşmek programlama hatasıdır.
      throw new Error(`geçersiz gizli içerik: ${secret}`);
    }
    return evaluateGuess(parsed.digits, guess);
  },
};
