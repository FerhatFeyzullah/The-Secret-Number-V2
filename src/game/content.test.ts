import { contentTypes, getContentType, numberContent } from './index';
import { evaluateGuess, parseGuess } from './number';
import type { Secret } from './types';

describe('içerik tipi kayıt defteri', () => {
  it("üyeler 'number' ve 'word'; number numberContent'in kendisidir", () => {
    expect(Object.keys(contentTypes).sort()).toEqual(['number', 'word']);
    expect(getContentType('number')).toBe(numberContent);
    expect(numberContent.id).toBe('number');
    expect(numberContent.allowedLengths).toEqual([3]);
  });
});

describe('numberContent.generate', () => {
  it('her zaman kurala uygun string üretir (parse kabul eder)', () => {
    for (let i = 0; i < 500; i++) {
      const value = numberContent.generate();
      expect(numberContent.parse(value)).toEqual({ ok: true, value });
    }
  });
});

describe('numberContent.parse', () => {
  it('parseGuess ile birebir aynı kararı verir', () => {
    const cases = ['123', '987', '12', '1234', '120', '112', '1a3', ''];
    for (const input of cases) {
      const expected = parseGuess(input);
      const actual = numberContent.parse(input);
      if (expected.ok) {
        expect(actual).toEqual({ ok: true, value: input });
      } else {
        expect(actual).toEqual({ ok: false, reason: expected.reason });
      }
    }
  });
});

describe('numberContent.evaluate', () => {
  const secret = '123';
  const secretTuple: Secret = [1, 2, 3];

  it('evaluateGuess ile birebir aynı sonucu verir', () => {
    const guesses = ['123', '321', '145', '456', '124', '12', '120', '112'];
    for (const guess of guesses) {
      expect(numberContent.evaluate(secret, guess)).toEqual(
        evaluateGuess(secretTuple, guess),
      );
    }
  });

  it('geçersiz secret programlama hatasıdır (fırlatır)', () => {
    expect(() => numberContent.evaluate('110', '123')).toThrow();
  });
});
