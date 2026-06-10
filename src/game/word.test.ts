import { getContentType } from './index';
import { evaluateWordGuess, normalizeTr, parseWord, wordContent } from './word';

describe('normalizeTr (Türkçe locale)', () => {
  it("İ→i ve I→ı (İngilizce lower'ın aksine)", () => {
    expect(normalizeTr('İSTEK')).toBe('istek');
    expect(normalizeTr('KAPI')).toBe('kapı'); // I → ı, i DEĞİL
    expect(normalizeTr('IŞIK')).toBe('ışık');
  });

  it('Türkçe harfleri korur', () => {
    expect(normalizeTr('ÇĞÖŞÜ')).toBe('çğöşü');
  });
});

describe('parseWord (yalnız format; havuz üyeliği sunucuda)', () => {
  it('4-6 harf Türkçe kelimeleri kabul eder', () => {
    expect(parseWord('anne')).toEqual({ ok: true, word: 'anne' });
    expect(parseWord('çiğ' + 'dem')).toEqual({ ok: true, word: 'çiğdem' });
    expect(parseWord('IŞIK')).toEqual({ ok: true, word: 'ışık' }); // normalize edilir
  });

  it('uzunluk dışını reddeder', () => {
    expect(parseWord('ana')).toEqual({ ok: false, reason: 'length' });
    expect(parseWord('annelik')).toEqual({ ok: false, reason: 'length' });
    expect(parseWord('')).toEqual({ ok: false, reason: 'length' });
  });

  it('Türkçe alfabe dışını reddeder (rakam/sembol/qwx)', () => {
    expect(parseWord('an1e')).toEqual({ ok: false, reason: 'nonLetter' });
    expect(parseWord('ann!')).toEqual({ ok: false, reason: 'nonLetter' });
    expect(parseWord('waxy')).toEqual({ ok: false, reason: 'nonLetter' });
    expect(parseWord('an e')).toEqual({ ok: false, reason: 'nonLetter' });
  });

  it('uzunluğu karakter bazında sayar (çok baytlı Türkçe harfler tek)', () => {
    // 'üzüm' UTF-8'de 6 bayt ama 4 harftir — kabul edilmeli.
    expect(parseWord('üzüm')).toEqual({ ok: true, word: 'üzüm' });
    expect(Array.from('üzüm').length).toBe(4);
  });
});

describe('evaluateWordGuess — multiset harf sayımı', () => {
  it('tekrarlı harfleri DOĞRU sayar (basit küme kesişimi değil)', () => {
    // kelle = {k,e:2,l:2}; kelep = {k,e:2,l,p} → min toplamı k1+e2+l1 = 4.
    // Küme kesişimi 3 (k,e,l) derdi — yanlış olurdu.
    expect(evaluateWordGuess('kelle', 'kelep')).toEqual({ status: 'partial', correctCount: 4 });
    // anne = {a,n:2,e}; nine = {n:2,i,e} → n2+e1 = 3.
    expect(evaluateWordGuess('anne', 'nine')).toEqual({ status: 'partial', correctCount: 3 });
    // Tahminde tekrar, gizlide tek: anne vs nana → a1(min 1,1... a:2'de) —
    // nana = {n:2,a:2}; anne = {a,n:2,e} → n2+a1 = 3.
    expect(evaluateWordGuess('anne', 'nana')).toEqual({ status: 'partial', correctCount: 3 });
  });

  it('ı/i ayrımı: ayrı harfler, eşleşmez', () => {
    expect(evaluateWordGuess('kına', 'kina')).toEqual({ status: 'partial', correctCount: 3 });
  });

  it('ç/c, ş/s, ğ/g, ö/o, ü/u ayrımı', () => {
    expect(evaluateWordGuess('çaba', 'caba')).toEqual({ status: 'partial', correctCount: 3 });
    expect(evaluateWordGuess('güzel', 'guzel')).toEqual({ status: 'partial', correctCount: 4 });
  });

  it('win: birebir eşleşme (normalizasyon sonrası)', () => {
    expect(evaluateWordGuess('anne', 'anne')).toEqual({ status: 'win' });
    expect(evaluateWordGuess('ANNE', 'anne')).toEqual({ status: 'win' });
    expect(evaluateWordGuess('ışık', 'IŞIK')).toEqual({ status: 'win' });
  });

  it('anagram: harfler doğru, yer yanlış (pozisyon sızmaz)', () => {
    expect(evaluateWordGuess('anne', 'nane')).toEqual({ status: 'digitsCorrectWrongOrder' });
    expect(evaluateWordGuess('kelle', 'lekle')).toEqual({ status: 'digitsCorrectWrongOrder' });
  });

  it('hiç ortak harf yoksa partial:0', () => {
    expect(evaluateWordGuess('anne', 'kuşçu')).toEqual({ status: 'invalid', reason: 'length' });
    expect(evaluateWordGuess('anne', 'kucu')).toEqual({ status: 'partial', correctCount: 0 });
  });

  it('uzunluk uyuşmazlığı / bozuk format invalid', () => {
    expect(evaluateWordGuess('anne', 'güzel')).toEqual({ status: 'invalid', reason: 'length' });
    expect(evaluateWordGuess('anne', 'an1e')).toEqual({ status: 'invalid', reason: 'nonLetter' });
  });
});

describe('wordContent (ContentTypeDef)', () => {
  it("kayıt defterinde 'word' olarak kayıtlı", () => {
    expect(getContentType('word')).toBe(wordContent);
    expect(wordContent.allowedLengths).toEqual([4, 5, 6]);
  });

  it('generate her zaman parse eden değer üretir (offline/test yedeği)', () => {
    for (let i = 0; i < 200; i++) {
      const value = wordContent.generate();
      expect(wordContent.parse(value)).toEqual({ ok: true, value });
    }
  });

  it('evaluate evaluateWordGuess ile aynı', () => {
    expect(wordContent.evaluate('kelle', 'kelep')).toEqual({ status: 'partial', correctCount: 4 });
    expect(wordContent.evaluate('anne', 'nane')).toEqual({ status: 'digitsCorrectWrongOrder' });
  });
});
