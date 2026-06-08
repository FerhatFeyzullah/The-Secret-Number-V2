/** Lig sistemi — TEK DOĞRULUK KAYNAĞI (istemci). Lig, oyuncunun Kupa'sından
 *  (rating) türetilir; ayrı kolon yoktur. Sınırlar sunucudaki `_league_key` /
 *  `_league_bounds` ile BİREBİR aynıdır (20260607000015_leagues.sql) — burada
 *  değişirse migration'da da değişmeli.
 *
 *  Kademeler (alt sınır dahil): Bronz <1200 · Gümüş 1200–1449 · Altın 1450–1749
 *  · Platin 1750–2099 · Elmas 2100–2499 · Usta 2500–2999 · Efsane ≥3000. */

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
  { key: 'bronze', name: 'Bronz', min: 0, max: 1199, color: '#C8803C', tier: 1 },
  { key: 'silver', name: 'Gümüş', min: 1200, max: 1449, color: '#B9C2CE', tier: 2 },
  { key: 'gold', name: 'Altın', min: 1450, max: 1749, color: '#F4B41A', tier: 3 },
  { key: 'platinum', name: 'Platin', min: 1750, max: 2099, color: '#54E0C7', tier: 4 },
  { key: 'diamond', name: 'Elmas', min: 2100, max: 2499, color: '#46B7F5', tier: 5 },
  { key: 'master', name: 'Usta', min: 2500, max: 2999, color: '#A78BFA', tier: 6 },
  { key: 'legend', name: 'Efsane', min: 3000, max: null, color: '#FF5470', tier: 7 },
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
