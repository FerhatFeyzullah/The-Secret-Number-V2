import type { GuessResult, InvalidReason } from './types';

/** Desteklenen gizli içerik tipleri.
 *  'wordrace' (Kelime Yarışı) kelime ile AYNI parse/generate/evaluate kurallarını
 *  kullanır (4-6 harf); yalnız online mod davranışı farklıdır (sunucu tek gizli
 *  kelime seçer, iki oyuncu eşzamanlı yarışır). */
export type ContentTypeId = 'number' | 'word' | 'wordrace';

/** İçerik tipinden bağımsız ayrıştırma sonucu. Sınır tipi string'dir;
 *  tipin iç temsili (örn. rakam tuple'ı) dışarı sızmaz. */
export type ParseResult =
  | { ok: true; value: string }
  | { ok: false; reason: InvalidReason };

/**
 * Bir gizli içerik tipinin sözleşmesi: üretim, doğrulama ve değerlendirme
 * tek noktada. Motor "sayı" bilmez; eldeki tipin tanımına delege eder.
 * Sunucu (RPC) nihai doğruluk kaynağıdır; buradaki evaluate yalnız offline
 * mod ve istemci ön-doğrulaması içindir.
 */
export type ContentTypeDef = {
  id: ContentTypeId;
  /** Geçerli gizli içerik uzunlukları (sayıda [3]; kelimede [4,5,6]). */
  allowedLengths: readonly number[];
  /** Kurala uygun rastgele gizli içerik üretir (string sınır formatında). */
  generate(rng?: () => number): string;
  /** Ham girdiyi doğrular; geçerliyse kanonik string değerini döndürür. */
  parse(input: string): ParseResult;
  /** Tahmini gizli içeriğe karşı değerlendirir (secret geçerli olmalıdır). */
  evaluate(secret: string, guess: string): GuessResult;
};
