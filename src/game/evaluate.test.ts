import { evaluateGuess, parseGuess } from './evaluate';
import type { Secret } from './types';

const secret: Secret = [1, 2, 3];

describe('parseGuess', () => {
  it('geçerli tahmini kabul eder', () => {
    expect(parseGuess('123')).toEqual({ ok: true, digits: [1, 2, 3] });
    expect(parseGuess('987')).toEqual({ ok: true, digits: [9, 8, 7] });
  });

  it('eksik veya fazla haneyi reddeder', () => {
    expect(parseGuess('')).toEqual({ ok: false, reason: 'length' });
    expect(parseGuess('12')).toEqual({ ok: false, reason: 'length' });
    expect(parseGuess('1234')).toEqual({ ok: false, reason: 'length' });
  });

  it('sıfır içeren tahmini reddeder', () => {
    expect(parseGuess('120')).toEqual({ ok: false, reason: 'zero' });
    expect(parseGuess('012')).toEqual({ ok: false, reason: 'zero' });
  });

  it('rakam olmayan karakteri reddeder', () => {
    expect(parseGuess('1a2')).toEqual({ ok: false, reason: 'nonDigit' });
    expect(parseGuess('12.')).toEqual({ ok: false, reason: 'nonDigit' });
  });

  it('tekrarlı rakamı reddeder', () => {
    expect(parseGuess('112')).toEqual({ ok: false, reason: 'duplicate' });
    expect(parseGuess('999')).toEqual({ ok: false, reason: 'duplicate' });
  });
});

describe('evaluateGuess', () => {
  it('geçersiz tahmin nedeniyle birlikte invalid döner', () => {
    expect(evaluateGuess(secret, '12')).toEqual({ status: 'invalid', reason: 'length' });
    expect(evaluateGuess(secret, '103')).toEqual({ status: 'invalid', reason: 'zero' });
    expect(evaluateGuess(secret, '11x')).toEqual({ status: 'invalid', reason: 'nonDigit' });
    expect(evaluateGuess(secret, '122')).toEqual({ status: 'invalid', reason: 'duplicate' });
  });

  it('correctCount 0: hiçbir rakam tutmuyor', () => {
    expect(evaluateGuess(secret, '456')).toEqual({ status: 'partial', correctCount: 0 });
  });

  it('correctCount 1: tek rakam tutuyor, pozisyondan bağımsız', () => {
    expect(evaluateGuess(secret, '156')).toEqual({ status: 'partial', correctCount: 1 });
    expect(evaluateGuess(secret, '561')).toEqual({ status: 'partial', correctCount: 1 });
  });

  it('correctCount 2: iki rakam tutuyor, pozisyondan bağımsız', () => {
    expect(evaluateGuess(secret, '124')).toEqual({ status: 'partial', correctCount: 2 });
    expect(evaluateGuess(secret, '412')).toEqual({ status: 'partial', correctCount: 2 });
  });

  it('permütasyon ama kazanmama → digitsCorrectWrongOrder', () => {
    expect(evaluateGuess(secret, '231')).toEqual({ status: 'digitsCorrectWrongOrder' });
    expect(evaluateGuess(secret, '321')).toEqual({ status: 'digitsCorrectWrongOrder' });
    expect(evaluateGuess(secret, '132')).toEqual({ status: 'digitsCorrectWrongOrder' });
  });

  it('tam eşleşme → win', () => {
    expect(evaluateGuess(secret, '123')).toEqual({ status: 'win' });
  });

  it('pozisyon bilgisi dışarı sızmaz', () => {
    // '132' tahmininde 1 rakamı yerinde, '312' tahmininde hiçbiri yerinde değil.
    // Sonuçlar birebir aynı olmalı — pozisyon sayısı ayırt edilemez.
    const oneInPlace = evaluateGuess(secret, '132');
    const noneInPlace = evaluateGuess(secret, '312');
    expect(oneInPlace).toStrictEqual(noneInPlace);

    // Sonuç nesnesi yalnızca 'status' alanı taşır, ek alan yok.
    expect(Object.keys(oneInPlace)).toEqual(['status']);
    expect(Object.keys(evaluateGuess(secret, '123'))).toEqual(['status']);
  });
});
