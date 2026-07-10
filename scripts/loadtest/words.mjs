// Geçerli gizli/tahmin içeriği üretir. Kelimeler yerel havuzdan (data/word_pool.txt)
// seçilir — sunucudaki secret_words ile aynı liste, DB'ye SELECT atmadan.
import { readFileSync } from 'node:fs';
import { ROOT } from './config.mjs';

let byLength = null;

function ensureLoaded() {
  if (byLength) return;
  const raw = readFileSync(new URL('data/word_pool.txt', ROOT), 'utf8');
  byLength = { 4: [], 5: [], 6: [] };
  for (const line of raw.split('\n')) {
    const w = line.trim();
    if (!w) continue;
    // Türkçe harf uzunluğu: Array.from ile kod-noktası bazında (ç/ş/ı/ğ tek harf).
    const len = Array.from(w).length;
    if (byLength[len]) byLength[len].push(w);
  }
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Verilen uzunlukta rastgele geçerli kelime. Uzunluk havuzda yoksa en yakına düşer. */
export function randomWord(length) {
  ensureLoaded();
  const bucket = byLength[length]?.length ? byLength[length] : byLength[5];
  return pick(bucket);
}

/** 3 farklı rakam (1-9), sayı modu gizli/tahmini. */
export function randomNumber() {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let i = digits.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [digits[i], digits[j]] = [digits[j], digits[i]];
  }
  return digits.slice(0, 3).join('');
}

/** Maçın içerik tipine + uzunluğuna göre geçerli bir gizli/tahmin üretir. */
export function randomContent(contentType, wordLength) {
  return contentType === 'word' ? randomWord(wordLength ?? 5) : randomNumber();
}

export function poolSizes() {
  ensureLoaded();
  return { 4: byLength[4].length, 5: byLength[5].length, 6: byLength[6].length };
}
