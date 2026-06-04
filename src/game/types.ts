/** Oyunda geçerli rakamlar: 1-9, sıfır yok. */
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Gizli sayı: 3 farklı rakamdan oluşan salt-okunur üçlü. */
export type Secret = readonly [Digit, Digit, Digit];

/** Tahminin neden geçersiz sayıldığı. */
export type InvalidReason = 'length' | 'nonDigit' | 'zero' | 'duplicate';

/**
 * Tek değerlendirme sonucu tipi.
 *
 * Dikkat: 'win' ve 'digitsCorrectWrongOrder' yalnızca `status` taşır —
 * kaç rakamın yerinde olduğu bilgisi tip seviyesinde hiç var olmadığı
 * için dışarı sızması imkânsızdır.
 */
export type GuessResult =
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'partial'; correctCount: 0 | 1 | 2 }
  | { status: 'digitsCorrectWrongOrder' }
  | { status: 'win' };
