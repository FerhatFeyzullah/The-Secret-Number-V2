// Telifsiz kısa ses efektlerini sentezler (16-bit PCM mono WAV).
// Kullanım: node scripts/generate-sfx.js
const fs = require('fs');
const path = require('path');

const SR = 22050;
const OUT_DIR = path.join(__dirname, '..', 'assets', 'sfx');

/** Tek ton üretir; slideTo verilirse frekans süre boyunca oraya kayar. */
function tone({ freq, dur, type = 'sine', vol = 0.4, slideTo = null }) {
  const n = Math.round(SR * dur);
  const attack = Math.round(SR * 0.005);
  const release = Math.round(SR * 0.03);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = slideTo === null ? freq : freq + ((slideTo - freq) * i) / n;
    phase += (2 * Math.PI * f) / SR;
    const raw = type === 'square' ? Math.sign(Math.sin(phase)) : Math.sin(phase);
    const env = Math.min(1, (i + 1) / attack, (n - i) / release);
    out[i] = raw * vol * env;
  }
  return out;
}

function silence(dur) {
  return new Float32Array(Math.round(SR * dur));
}

function concat(parts) {
  const n = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(n);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk boyutu
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bit depth
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(OUT_DIR, name), Buffer.concat([header, data]));
  console.log('yazıldı:', name);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// Tuş/tahmin blip'i: kısa, tok bir square tık.
writeWav('blip.wav', tone({ freq: 760, dur: 0.05, type: 'square', vol: 0.16 }));

// Doğru-his: iki kısa yükselen sine nota.
writeWav(
  'good.wav',
  concat([
    tone({ freq: 520, dur: 0.07, vol: 0.3 }),
    silence(0.02),
    tone({ freq: 700, dur: 0.09, vol: 0.3 }),
  ]),
);

// Kazanma: yükselen kısa melodi (C5-E5-G5-C6).
writeWav(
  'win.wav',
  concat([
    tone({ freq: 523.25, dur: 0.11, vol: 0.35 }),
    tone({ freq: 659.25, dur: 0.11, vol: 0.35 }),
    tone({ freq: 783.99, dur: 0.11, vol: 0.35 }),
    tone({ freq: 1046.5, dur: 0.24, vol: 0.35 }),
  ]),
);

// Kaybetme: alçalan kayan ton.
writeWav('lose.wav', tone({ freq: 380, dur: 0.5, slideTo: 150, vol: 0.35 }));
