// Kelime modu TEK HAVUZ üreteci (gizli belirleme + tahmin aynı havuzdan).
//
// Karar: 4-6 harfli "bilinen/yaygın" Türkçe kelime tavanı ~5.000 (frekans verisi).
// Havuz = frekans-sıralı ∩ gerçek-sözlük, temiz + aile-dostu + özel-isimsiz.
//   Kaynaklar (açık): OpenSubtitles frekans (hermitdave/FrequencyWords) +
//   TDK başsözcük (mertemin/turkish-word-list) + mevcut data/valid_words.txt.
//
// Kullanım: node scripts/gen-word-pool.mjs
//   Kaynakları /tmp'e indirir (yoksa), data/word_pool.txt + eklenenleri üretir.
import fs from 'fs';
import { execSync } from 'child_process';

const REPO = decodeURIComponent(new URL('..', import.meta.url).pathname);
const D = REPO + 'data';
const FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/tr/tr_50k.txt';
const DICT_URL = 'https://raw.githubusercontent.com/mertemin/turkish-word-list/master/words.txt';
const FREQ = '/tmp/tr_freq.txt', DICT = '/tmp/tr_dict1.txt';
const dl = (url, out) => { if (!fs.existsSync(out)) execSync(`curl -sL --max-time 90 "${url}" -o "${out}"`); };
dl(FREQ_URL, FREQ); dl(DICT_URL, DICT);

const trLower = (s) => s.toLocaleLowerCase('tr');
const TR = /^[abcçdefgğhıijklmnoöprsştuüvyz]+$/, VOWEL = /[aeıioöuü]/;
const ok = (w) => w.length >= 4 && w.length <= 6 && TR.test(w) && VOWEL.test(w);
const lines = (p) => fs.readFileSync(p, 'utf8').split('\n');

// Aile-dostu kara liste (küfür/uygunsuz/yetişkin).
const BAD = new Set(('orospu,sürtük,kaltak,sikik,siken,sikme,sikti,siker,sikiş,sikeyim,sikerim,siktir,'+
  'götü,götün,göt,amcık,amına,amını,yavşak,puşt,pezo,gavat,ibne,piçi,zübük,seks,ensest,lavuk,kahpe,'+
  'fahişe,dildo,zeker,penis,vajina,meme,memesi,dallama,yarrak,yarak,taşak,porno,anal,üstsüz,mastür,porno').split(','));
// Özel isim kara liste (ülke/şehir/kişi/din — 304 aday içinde görülenler).
const PROPER = new Set(('kore,küba,israil,italya,iran,iranlı,isveç,tibet,kenya,kıbrıs,prusya,angola,'+
  'bosna,tonya,kemal,cemil,celal,abbas,kerim,tarık,sami,adem,islam,islami,incil').split(','));

const valid = new Set(lines(D + '/valid_words.txt').map(w => trLower(w.trim())).filter(Boolean));
const mert = new Set(lines(DICT).map(w => trLower(w.trim())).filter(w => w && !w.includes(' ')));
const real = new Set([...valid, ...mert]);
const freqArr = lines(FREQ).map(l => trLower((l.trim().split(/\s+/)[0] || ''))).filter(ok);
const clean = (w) => ok(w) && real.has(w) && !BAD.has(w) && !PROPER.has(w);

// Tek havuz: frekans sıralı, benzersiz, temiz.
const seen = new Set(), pool = [];
for (const w of freqArr) if (clean(w) && !seen.has(w)) { seen.add(w); pool.push(w); }

const oldSecret = new Set(lines(D + '/secret_words.txt').map(w => trLower(w.trim())).filter(Boolean));
const additions = pool.filter(w => !oldSecret.has(w));
// Tek havuz = mevcut secret ∪ pool (mevcut hiçbir kelimeyi düşürme; sadece ekle).
const full = [...new Set([...lines(D + '/secret_words.txt').map(w => trLower(w.trim())).filter(Boolean), ...pool])];

fs.writeFileSync(D + '/word_pool.txt', full.join('\n') + '\n');
fs.writeFileSync('/tmp/additions.txt', additions.join('\n') + '\n');
console.log('TEK HAVUZ:', full.length, '| eklenen:', additions.length,
  '| filtrelenen küfür+özel-isim (aday içinde):',
  [...new Set(freqArr)].filter(w => real.has(w) && (BAD.has(w) || PROPER.has(w)) && !oldSecret.has(w)).join(', '));
console.log('\nEKLENEN (frekans sıralı):\n' + additions.join(' '));
