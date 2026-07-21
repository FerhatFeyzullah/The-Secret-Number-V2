/** Lig sistemi — TEK DOĞRULUK KAYNAĞI (istemci). Lig, oyuncunun Kupa'sından
 *  (rating) türetilir; ayrı kolon yoktur. Sınırlar sunucudaki `_league_key` /
 *  `_league_bounds` ile BİREBİR aynıdır (20260607000015_leagues.sql) — burada
 *  değişirse migration'da da değişmeli.
 *
 *  Kademeler (Şifre teması; alt sınır dahil): Gürültü <1200 · İz 1200–1449 ·
 *  Kod 1450–1749 · Şifre 1750–2099 · Anahtar 2100–2499 · Matris 2500–2999 ·
 *  Çekirdek ≥3000. Yalnız GÖRÜNEN ad; key/eşik/renk ve sunucu `_league_key` aynı. */

export type LeagueKey =
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'master'
  | 'legend';

export type League = {
  key: LeagueKey;
  /** Türkçe görünen ad. */
  name: string;
  /** Dahil alt Kupa sınırı (bronz = 0, en alt). */
  min: number;
  /** Dahil üst Kupa sınırı; Efsane'de sınırsız (null). */
  max: number | null;
  /** Rozet/aksan rengi (kademe kimliği). */
  color: string;
  /** 1 (Bronz) → 7 (Efsane). Sıralama/karşılaştırma için. */
  tier: number;
};

/** Artan sırada (Bronz → Efsane). `max` = bir sonrakinin `min` − 1. */
export const LEAGUES: readonly League[] = [
  { key: 'bronze', name: 'Gürültü', min: 0, max: 1199, color: '#C8803C', tier: 1 },
  { key: 'silver', name: 'İz', min: 1200, max: 1449, color: '#B9C2CE', tier: 2 },
  { key: 'gold', name: 'Kod', min: 1450, max: 1749, color: '#F4B41A', tier: 3 },
  { key: 'platinum', name: 'Şifre', min: 1750, max: 2099, color: '#54E0C7', tier: 4 },
  { key: 'diamond', name: 'Anahtar', min: 2100, max: 2499, color: '#46B7F5', tier: 5 },
  { key: 'master', name: 'Matris', min: 2500, max: 2999, color: '#A78BFA', tier: 6 },
  { key: 'legend', name: 'Çekirdek', min: 3000, max: null, color: '#FF5470', tier: 7 },
];

/** Kupa → lig. En yüksek kademeden aşağı bakar; ilk `min`'i geçen kademe. */
export function leagueForRating(rating: number): League {
  for (let i = LEAGUES.length - 1; i >= 0; i--) {
    if (rating >= LEAGUES[i].min) return LEAGUES[i];
  }
  return LEAGUES[0];
}

/** Lig anahtarından lig (kapsam dışıysa Bronz). */
export function leagueByKey(key: LeagueKey): League {
  return LEAGUES.find((l) => l.key === key) ?? LEAGUES[0];
}
