import { possessive } from './age-ticker';

/** Akış çipi metinlerindeki tamlayan eki ("Derya'nın kulesini aldı"). Kullanıcı
 *  adları serbest metin → ünlü uyumu ve kaynaştırma n'si doğru çalışmalı. */
describe('possessive', () => {
  it('ünlüyle biten adlara kaynaştırma n\'si ekler', () => {
    expect(possessive('Derya')).toBe("Derya'nın");
    expect(possessive('Bora')).toBe("Bora'nın");
    expect(possessive('Oyuncu')).toBe("Oyuncu'nun");
    expect(possessive('Gökçe')).toBe("Gökçe'nin");
  });

  it('sessizle biten adlara doğrudan ek getirir', () => {
    expect(possessive('Zeynep')).toBe("Zeynep'in");
    expect(possessive('Ahmet')).toBe("Ahmet'in");
    expect(possessive('Yalçın')).toBe("Yalçın'ın");
    expect(possessive('Gültekin')).toBe("Gültekin'in");
  });

  it('son ünlüye göre kalın/ince ve düz/yuvarlak seçer', () => {
    expect(possessive('Uğur')).toBe("Uğur'un");
    expect(possessive('Görkem')).toBe("Görkem'in");
    expect(possessive('Ülkü')).toBe("Ülkü'nün");
    expect(possessive('Doruk')).toBe("Doruk'un");
  });

  it('ünlüsüz/boş adlarda çökmez', () => {
    expect(possessive('X')).toBe("X'in");
    expect(possessive('')).toBe("'in");
  });
});
