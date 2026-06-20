import type { ContentTypeDef } from './content';
import type { GuessResult, InvalidReason } from './types';

/** Türkçe alfabe (29 harf). q/w/x yok — kelime havuzları da bu alfabeyle sınırlı. */
const TR_ALPHABET = 'abcçdefgğhıijklmnoöprsştuüvyz';
const TR_LETTER_SET: ReadonlySet<string> = new Set(TR_ALPHABET);

/** Kelime tipinde geçerli uzunluklar. */
export const WORD_LENGTHS: readonly number[] = [4, 5, 6];

/**
 * Türkçe locale ile küçük harfe çevirir. KRİTİK: İngilizce lower'da
 * 'İ' → 'i̇' (i + combining dot) ve 'I' → 'i' olur; Türkçe'de 'İ' → 'i',
 * 'I' → 'ı' olmalı. Tüm karşılaştırmalar bu normalizasyondan geçer.
 */
export function normalizeTr(input: string): string {
  return input.toLocaleLowerCase('tr-TR');
}

type ParsedWord =
  | { ok: true; word: string }
  | { ok: false; reason: InvalidReason };

/**
 * Format kontrolü: 4-6 harf + yalnız Türkçe harf (rakam/sembol/q-w-x yok).
 * Havuz üyeliği ("gerçek kelime mi") SUNUCUDA doğrulanır (valid_words /
 * secret_words lookup) — istemci yalnız biçim bakar.
 * Harf sayımı karakter bazındadır (Array.from; byte değil).
 */
export function parseWord(input: string): ParsedWord {
  const word = normalizeTr(input);
  const chars = Array.from(word);
  if (chars.length < 4 || chars.length > 6) {
    return { ok: false, reason: 'length' };
  }
  for (const ch of chars) {
    if (!TR_LETTER_SET.has(ch)) {
      return { ok: false, reason: 'nonLetter' };
    }
  }
  return { ok: true, word };
}

/** Karakter bazında harf sayımı (multiset). */
function letterCounts(chars: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of chars) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/**
 * Kelime tahminini değerlendirir — sayı modeliyle aynı sözleşme:
 * pozisyon bilgisi HİÇBİR dalda hesaplanıp dışarı verilmez.
 *
 * Ortak harf sayısı MULTISET kesişimidir: her harf için
 * min(tahmindeki adet, gizlideki adet) toplanır. Basit küme kesişimi
 * tekrarlı harflerde ("kelle", "anne") YANLIŞ sayar — kullanılmaz.
 */
export function evaluateWordGuess(secret: string, guess: string): GuessResult {
  const parsed = parseWord(guess);
  if (!parsed.ok) {
    return { status: 'invalid', reason: parsed.reason };
  }
  const secretChars = Array.from(normalizeTr(secret));
  const guessChars = Array.from(parsed.word);
  if (guessChars.length !== secretChars.length) {
    return { status: 'invalid', reason: 'length' };
  }

  const secretCounts = letterCounts(secretChars);
  let valueMatch = 0;
  for (const [ch, cnt] of letterCounts(guessChars)) {
    valueMatch += Math.min(cnt, secretCounts.get(ch) ?? 0);
  }

  if (valueMatch < secretChars.length) {
    return { status: 'partial', correctCount: valueMatch };
  }
  const isWin = parsed.word === secretChars.join('');
  return isWin ? { status: 'win' } : { status: 'digitsCorrectWrongOrder' };
}

/**
 * Per-harf Wordle işareti. KELİME MODUNA ÖZGÜ — sayı modunda KULLANILMAZ.
 * 'G' (green)  → doğru harf, doğru pozisyon
 * 'Y' (yellow) → harf kelimede var ama yanlış pozisyon
 * 'X'          → harf kelimede yok (şeffaf hücre)
 *
 * ⚠️ BİLİNÇLİ KURAL DEĞİŞİKLİĞİ: Kelime modu artık POZİSYON SIZDIRIR (Wordle).
 * Sayı modu eski sözleşmeyi korur: pozisyon asla sızmaz, yalnız "kaç rakam
 * doğru" (bkz. evaluateWordGuess / evaluate_guess — onlar pozisyonsuz kalır).
 */
export type LetterMark = 'G' | 'Y' | 'X';

/**
 * Standart Wordle iki-geçişli işaretleme (tekrarlı harf doğru sayılır):
 *  1. Pozisyon birebir tutanları YEŞİL yap, gizlideki o harfi "tüketildi" say.
 *  2. Kalan harfleri SOLDAN SAĞA gez; harf gizlide kalan sayıda varsa SARI yap
 *     ve sayacı azalt; yoksa RENKSİZ (X).
 *
 * Örn. gizli "halı", tahmin "arpa" → [Y,X,X,X] (soldaki 'a' sarı, sağ 'a' yok).
 *      gizli "halı", tahmin "kapı" → [X,G,X,G] ('a','ı' yeşil; k,p yok).
 *
 * Harf eşitliği normalizeTr ile (ı≠i, ç≠c, …). Sunucudaki _word_marks bu
 * algoritmanın birebir SQL aynısıdır (otorite sunucu; bu kopya offline/test).
 */
export function wordMarks(secret: string, guess: string): LetterMark[] {
  const s = Array.from(normalizeTr(secret));
  const g = Array.from(normalizeTr(guess));
  const n = g.length;
  const marks: LetterMark[] = new Array(n).fill('X');
  // 1. geçiş: yeşiller + tüketilmeyen gizli harflerin sayacı.
  const remaining = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (i < s.length && g[i] === s[i]) {
      marks[i] = 'G';
    } else if (i < s.length) {
      remaining.set(s[i], (remaining.get(s[i]) ?? 0) + 1);
    }
  }
  // 2. geçiş: soldan sağa sarılar (yeşil olmayanlar, kalan sayıdan tüketerek).
  for (let i = 0; i < n; i++) {
    if (marks[i] === 'G') continue;
    const left = remaining.get(g[i]) ?? 0;
    if (left > 0) {
      marks[i] = 'Y';
      remaining.set(g[i], left - 1);
    }
  }
  return marks;
}

/**
 * Offline/test yedeği: gerçek gizli havuz sunucudadır (secret_words) ve
 * oyuncu kendi kelimesini SEÇER — generate yalnız offline mod / test için
 * küçük, yaygın bir örneklemden çeker. (Hepsi secret_words havuzundandır.)
 */
const FALLBACK_SECRETS: readonly string[] = [
  'anne', 'adam', 'gece', 'yeni',
  'güzel', 'büyük', 'fazla', 'orada',
  'olacak', 'yardım', 'şeyler', 'birkaç',
];

export const wordContent: ContentTypeDef = {
  id: 'word',
  allowedLengths: WORD_LENGTHS,
  generate(rng = Math.random) {
    return FALLBACK_SECRETS[Math.floor(rng() * FALLBACK_SECRETS.length)];
  },
  parse(input) {
    const parsed = parseWord(input);
    return parsed.ok
      ? { ok: true, value: parsed.word }
      : { ok: false, reason: parsed.reason };
  },
  evaluate(secret, guess) {
    return evaluateWordGuess(secret, guess);
  },
};
