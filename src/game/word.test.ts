import { getContentType } from './index';
import {
  evaluateWordGuess,
  normalizeTr,
  opponentKnowledge,
  parseWord,
  upperTr,
  wordContent,
  wordMarks,
} from './word';

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

describe('upperTr (gösterim için Türkçe büyük harf)', () => {
  it('i→İ ve ı→I (CSS uppercase aksine i/ı ayrımını korur)', () => {
    expect(upperTr('bilim')).toBe('BİLİM'); // i → İ (noktalı)
    expect(upperTr('kızıl')).toBe('KIZIL'); // ı → I (noktasız)
    expect(upperTr('iı')).toBe('İI'); // ikisi AYRI kalır (yanlış okuma önlenir)
  });

  it('diğer Türkçe harfleri doğru büyütür', () => {
    expect(upperTr('çğöşü')).toBe('ÇĞÖŞÜ');
    expect(upperTr('inek')).toBe('İNEK');
    expect(upperTr('sıçan')).toBe('SIÇAN');
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

describe('wordMarks — Wordle iki-geçişli işaretleme (KELİME modu; pozisyon SIZAR)', () => {
  it('spec örneği: gizli "halı" tahmin "arpa" → soldaki a sarı, sağdaki a yok', () => {
    expect(wordMarks('halı', 'arpa')).toEqual(['Y', 'X', 'X', 'X']);
  });

  it('spec örneği: gizli "halı" tahmin "kapı" → a,ı yeşil; k,p yok', () => {
    expect(wordMarks('halı', 'kapı')).toEqual(['X', 'G', 'X', 'G']);
  });

  it('tam isabet hepsi yeşil', () => {
    expect(wordMarks('kalem', 'kalem')).toEqual(['G', 'G', 'G', 'G', 'G']);
  });

  it('yeşil + sarı karışımı', () => {
    // gizli "abck" (a,b,c,k) tahmin "back" (b,a,c,k):
    //  poz: b≠a, a≠b, c=c(G), k=k(G) → remaining={a:1,b:1}
    //  2.geçiş: b→sarı, a→sarı → [Y,Y,G,G]
    expect(wordMarks('abck', 'back')).toEqual(['Y', 'Y', 'G', 'G']);
  });

  it('tekrarlı harf: gizlideki adet kadar sarı/yeşil verilir, fazlası yok', () => {
    // gizli "anne" (a,n,n,e) tahmin "nana" (n,a,n,a):
    //  pozisyon: n≠a, a≠n, n=n(G), a≠e → remaining = {a:1, n:1, e:1}
    //  2.geçiş: n→sarı(n:0), a→sarı(a:0), [G], a→ X (a tükendi) → [Y,Y,G,X]
    expect(wordMarks('anne', 'nana')).toEqual(['Y', 'Y', 'G', 'X']);
  });

  it('çoklu yeşil + ayrı sarı', () => {
    // gizli "kelle" (k,e,l,l,e) tahmin "kelep" (k,e,l,e,p):
    //  poz: k=k(G), e=e(G), l=l(G), e≠l, p≠e → remaining={l:1,e:1}
    //  2.geçiş: idx3 e→sarı(e:0), idx4 p→X → [G,G,G,Y,X]
    expect(wordMarks('kelle', 'kelep')).toEqual(['G', 'G', 'G', 'Y', 'X']);
  });

  it('ı≠i: "i" tahmini "ı" gizlisine renk vermez', () => {
    // gizli "kına" (k,ı,n,a) tahmin "kina" (k,i,n,a): k=G, i≠ı→X (ı başka yerde yok),
    //  n=G, a=G → [G,X,G,G]
    expect(wordMarks('kına', 'kina')).toEqual(['G', 'X', 'G', 'G']);
  });

  it('Türkçe locale normalizasyonu: BÜYÜK harf girişi de doğru işaretlenir', () => {
    expect(wordMarks('IŞIK', 'ışık')).toEqual(['G', 'G', 'G', 'G']);
    expect(wordMarks('halı', 'KAPI')).toEqual(['X', 'G', 'X', 'G']);
  });

  it('hiç ortak harf yok → hepsi X', () => {
    expect(wordMarks('abck', 'demo')).toEqual(['X', 'X', 'X', 'X']);
  });
});

describe('opponentKnowledge — birikimli yeşil/sarı bilgi durumu (multiset)', () => {
  // Marks el ile doğrulandı (bkz. wordMarks testleri). Model:
  //  green = tur boyunca G işaretli pozisyonların birleşimi;
  //  yellow = Σ_c ( known(c) − greenKnown(c) ), known(c)=max(bestNonX(c), greenKnown(c)).

  it('hiç tahmin yok / boş girdi → 0/0', () => {
    expect(opponentKnowledge('kalp', [])).toEqual({ green: 0, yellow: 0 });
    expect(opponentKnowledge('', [])).toEqual({ green: 0, yellow: 0 });
  });

  it('t1: 2 sarı, 0 yeşil (iki harf "var" ama yersiz)', () => {
    // gizli "kalp", tahmin "lkoe" → [Y,Y,X,X]: l,k biliniyor (yersiz).
    expect(opponentKnowledge('kalp', ['lkoe'])).toEqual({ green: 0, yellow: 2 });
  });

  it('promotion: bir sarı yeşile oturunca sarı−1 / yeşil+1', () => {
    // t1 "lkoe" [Y,Y,X,X] (l,k sarı) → t2 "kloe" [G,Y,X,X] (k yeşile oturdu, l hâlâ sarı).
    expect(opponentKnowledge('kalp', ['lkoe', 'kloe'])).toEqual({ green: 1, yellow: 1 });
  });

  it('yeni yeşil (eski sarılardan değil): yeşil+1, sarı sabit', () => {
    // t1 "lkoe" (l,k sarı) → t2 "zazz" [X,G,X,X] (a yeşil, yepyeni). Sarılar korunur.
    expect(opponentKnowledge('kalp', ['lkoe', 'zazz'])).toEqual({ green: 1, yellow: 2 });
  });

  it('daha kötü sonraki tahmin bilgiyi düşürmez (birikimli)', () => {
    // t1 "lkoe" (0 yeşil, 2 sarı) → t3 "zzzz" (hiç isabet). Durum korunur.
    expect(opponentKnowledge('kalp', ['lkoe', 'zzzz'])).toEqual({ green: 0, yellow: 2 });
  });

  it('yeşiller farklı tahminlerden birikir (union, max değil)', () => {
    // t1 "kzzz" [G,X,X,X] (k@0) + t2 "zazz" [X,G,X,X] (a@1) → 2 ayrı pozisyon yeşil.
    expect(opponentKnowledge('kalp', ['kzzz', 'zazz'])).toEqual({ green: 2, yellow: 0 });
  });

  it('multiset: iki N — biri yeşil biri sarı → yeşil+1, sarı+1', () => {
    // gizli "anne" (a,n,n,e), tahmin "nnzz" [Y,G,X,X]: bir n yeşil, öbür n sarı.
    expect(opponentKnowledge('anne', ['nnzz'])).toEqual({ green: 1, yellow: 1 });
  });

  it('multiset: aynı harfin iki farklı pozisyonu ayrı tahminlerde yeşil', () => {
    // "znzz" [X,G,X,X] (n@1) + "zznz" [X,X,G,X] (n@2) → iki n de yeşil, sarı 0.
    expect(opponentKnowledge('anne', ['znzz', 'zznz'])).toEqual({ green: 2, yellow: 0 });
  });

  it('rakip kazandı → hepsi yeşil, sarı 0', () => {
    expect(opponentKnowledge('kalp', ['kalp'])).toEqual({ green: 4, yellow: 0 });
  });

  it('yeşil+sarı toplamı kelime uzunluğunu aşmaz', () => {
    const { green, yellow } = opponentKnowledge('anne', ['nnea', 'anne', 'enna']);
    expect(green + yellow).toBeLessThanOrEqual(4);
  });

  it('uzunluğu uyuşmayan tahmin atlanır (çökme yok)', () => {
    expect(opponentKnowledge('kalp', ['abc'])).toEqual({ green: 0, yellow: 0 });
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
