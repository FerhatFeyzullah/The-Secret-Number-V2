import type { GuessResult, InvalidReason } from './types';

/** Desteklenen gizli içerik tipleri. Şimdilik yalnız sayı; kelime Faz 2'de eklenir. */
export type ContentTypeId = 'number';

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
  /** Gizli içeriğin sabit uzunluğu (sayıda 3 hane). */
  secretLength: number;
  /** Kurala uygun rastgele gizli içerik üretir (string sınır formatında). */
  generate(rng?: () => number): string;
  /** Ham girdiyi doğrular; geçerliyse kanonik string değerini döndürür. */
  parse(input: string): ParseResult;
  /** Tahmini gizli içeriğe karşı değerlendirir (secret geçerli olmalıdır). */
  evaluate(secret: string, guess: string): GuessResult;
};
