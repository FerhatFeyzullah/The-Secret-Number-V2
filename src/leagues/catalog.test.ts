import { LEAGUES, leagueByKey, leagueForRating, type LeagueKey } from './catalog';

describe('leagueForRating — sınırlar (sunucu _league_key ile birebir)', () => {
  // [rating, beklenen lig anahtarı]
  const cases: [number, LeagueKey][] = [
    [0, 'bronze'],
    [999, 'bronze'],
    [1199, 'bronze'],
    [1200, 'silver'],
    [1449, 'silver'],
    [1450, 'gold'],
    [1749, 'gold'],
    [1750, 'platinum'],
    [2099, 'platinum'],
    [2100, 'diamond'],
    [2499, 'diamond'],
    [2500, 'master'],
    [2999, 'master'],
    [3000, 'legend'],
    [9999, 'legend'],
  ];
  it.each(cases)('rating %i → %s', (rating, key) => {
    expect(leagueForRating(rating).key).toBe(key);
  });

  it('negatif/0 altı güvenli → bronze', () => {
    expect(leagueForRating(-50).key).toBe('bronze');
  });
});

describe('LEAGUES katalog tutarlılığı', () => {
  it('7 kademe, tier 1→7 artan', () => {
    expect(LEAGUES).toHaveLength(7);
    expect(LEAGUES.map((l) => l.tier)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('bitişik aralıklar: her max = sonrakinin min − 1 (Efsane hariç sınırsız)', () => {
    for (let i = 0; i < LEAGUES.length - 1; i++) {
      expect(LEAGUES[i].max).toBe(LEAGUES[i + 1].min - 1);
    }
    expect(LEAGUES[LEAGUES.length - 1].max).toBeNull();
  });

  it('leagueByKey bilinmeyen → bronze', () => {
    expect(leagueByKey('legend').key).toBe('legend');
    // @ts-expect-error bilinmeyen anahtar testi
    expect(leagueByKey('nope').key).toBe('bronze');
  });
});
