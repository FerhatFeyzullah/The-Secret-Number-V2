/** Oyunda geçerli rakamlar: 1-9, sıfır yok. */
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Gizli sayı: 3 farklı rakamdan oluşan salt-okunur üçlü. */
export type Secret = readonly [Digit, Digit, Digit];

/** Tahminin neden geçersiz sayıldığı.
 *  'nonLetter' kelime tipine özgüdür (Türkçe alfabe dışı karakter). */
export type InvalidReason = 'length' | 'nonDigit' | 'zero' | 'duplicate' | 'nonLetter';

/**
 * Tek değerlendirme sonucu tipi.
 *
 * Dikkat: 'win' ve 'digitsCorrectWrongOrder' yalnızca `status` taşır —
 * kaç rakamın yerinde olduğu bilgisi tip seviyesinde hiç var olmadığı
 * için dışarı sızması imkânsızdır.
 *
 * correctCount: sayı tipinde 0-2; kelime tipinde 0-(uzunluk-1).
 */
export type GuessResult =
  | { status: 'invalid'; reason: InvalidReason }
  | { status: 'partial'; correctCount: number }
  | { status: 'digitsCorrectWrongOrder' }
  | { status: 'win' };
