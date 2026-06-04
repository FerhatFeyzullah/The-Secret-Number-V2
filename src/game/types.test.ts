import { evaluateGuess } from './evaluate';
import type { GuessResult, Secret } from './types';

/** Verilen status'un üyesinde 'status' dışındaki alanların birliği. */
type ExtraFieldsOf<S extends GuessResult['status']> = Exclude<
  keyof Extract<GuessResult, { status: S }>,
  'status'
>;

// Derleme zamanı garantisi: bu sabitler ancak ilgili üyede ek alan
// yoksa (tip never ise) derlenir. Pozisyon sayısı tipte var olamaz.
const winLeaksNothing: ExtraFieldsOf<'win'> extends never ? true : false = true;
const wrongOrderLeaksNothing: ExtraFieldsOf<'digitsCorrectWrongOrder'> extends never
  ? true
  : false = true;

describe('GuessResult tipi', () => {
  it('win ve digitsCorrectWrongOrder yalnızca status alanı taşır', () => {
    expect(winLeaksNothing).toBe(true);
    expect(wrongOrderLeaksNothing).toBe(true);
  });

  it('pozisyon eşleşme sayısına tip seviyesinde erişilemez', () => {
    const secret: Secret = [1, 2, 3];
    const result = evaluateGuess(secret, '231');
    if (result.status === 'digitsCorrectWrongOrder') {
      // @ts-expect-error pozisyon sayısı dönen tipte tutulmaz
      const leak = result.positionCount;
      expect(leak).toBeUndefined();
    }
    expect(result.status).toBe('digitsCorrectWrongOrder');
  });
});
