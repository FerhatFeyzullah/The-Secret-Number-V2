import type { Digit, GuessResult, InvalidReason, Secret } from './types';

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
