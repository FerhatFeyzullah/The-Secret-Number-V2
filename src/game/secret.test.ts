import { generateSecret } from './secret';

describe('generateSecret', () => {
  it('her zaman kurala uygun üretir: 3 hane, 1-9 arası, hepsi farklı, sıfır yok', () => {
    for (let i = 0; i < 1000; i++) {
      const secret = generateSecret();
      expect(secret).toHaveLength(3);
      for (const d of secret) {
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(9);
      }
      expect(new Set(secret).size).toBe(3);
    }
  });

  it('zamanla 1-9 arasındaki tüm rakamları üretebilir', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      for (const d of generateSecret()) {
        seen.add(d);
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('enjekte edilen rng ile deterministiktir', () => {
    // rng hep 0 dönerse hiç takas olmaz: havuzun ilk üç elemanı kalır.
    expect(generateSecret(() => 0)).toEqual([1, 2, 3]);
    // rng hep 1'e yakınsa her adımda havuzun son elemanıyla takas yapılır:
    // [1..9] → [9,2,...,1] → [9,1,...,2] → [9,1,2,...]
    expect(generateSecret(() => 0.999)).toEqual([9, 1, 2]);
  });
});
