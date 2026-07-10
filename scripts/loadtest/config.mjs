// Yük testi yapılandırması: .env.loadtest + CLI argümanları.
// Bağımlılık yok — .env dosyasını elle ayrıştırırız (dotenv gerekmez).
import { readFileSync, existsSync } from 'node:fs';

export const ROOT = new URL('../../', import.meta.url);
const ENV_PATH = new URL('.env.loadtest', ROOT);

/** .env.loadtest'i oku ve process.env'e (var olanı EZMEDEN) yükle. */
function loadEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  const raw = readFileSync(ENV_PATH, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** --key value  ve  --flag  biçimlerini ayrıştırır. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true; // bayrak
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/** "word:60,protocol:25,private:15" → { word:60, protocol:25, private:15 } */
function parseMix(s) {
  const mix = {};
  for (const part of s.split(',')) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (k && Number.isFinite(n) && n > 0) mix[k.trim()] = n;
  }
  return Object.keys(mix).length ? mix : { word: 60, protocol: 25, private: 15 };
}

/** "5,15,30" → [5,15,30];  "30" → [30] */
function parseStages(s) {
  const stages = String(s)
    .split(',')
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return stages.length ? stages : [5, 15, 30];
}

export function getConfig(argv = process.argv.slice(2)) {
  loadEnvFile();
  const args = parseArgs(argv);
  const num = (k, d) => (args[k] !== undefined ? Number(args[k]) : d);

  const stages = parseStages(args.rooms ?? '5,15,30');
  const sumRooms = stages.reduce((a, b) => a + b, 0);
  const stormPlayers = num('storm', 10);

  return {
    // Bağlantı (env'den; koda ASLA gömülmez)
    url: process.env.LOADTEST_URL ?? '',
    anonKey: process.env.LOADTEST_ANON_KEY ?? '',
    serviceRoleKey: process.env.LOADTEST_SERVICE_ROLE_KEY ?? '',

    // Test hesabı havuzu
    accountPrefix: process.env.LOADTEST_ACCOUNT_PREFIX ?? 'loadtest+',
    accountDomain: process.env.LOADTEST_ACCOUNT_DOMAIN ?? 'loadtest.local',
    accountPassword: process.env.LOADTEST_ACCOUNT_PASSWORD ?? 'LoadTest!2026#pool',
    // Aşamalar üst üste binebilir (oturumlar dakikalarca yaşar): havuzu TÜM
    // aşamaların toplam oda sayısına göre boyutla → lease bloklamaz.
    accountCount: num('accounts', sumRooms * 2 + stormPlayers + 20),

    // Yük profili
    stages, // ramp aşamaları: her aşamadaki eşzamanlı oda sayısı
    holdSec: num('hold', 45), // her aşama kaç sn tutulur
    rampSec: num('ramp', 30), // aşama içinde spawn'ın yayıldığı süre
    mix: parseMix(args.mix ?? 'word:60,protocol:25,private:15'),
    stormPlayers, // aşama başına "yalnız-matchmake" oyuncu

    // Maç davranışı
    maxTurns: num('max-turns', 24), // oyuncu bu kadar kendi turundan sonra leaveMatch ile biter
    heartbeatMs: num('heartbeat', 5000),

    // Bayraklar
    purgeUsers: !!args['purge-users'],
    dryRun: !!args['dry-run'], // yalnız planı yazdır, bağlanma
    verbose: !!args.verbose,

    // Rapor
    reportDir: process.env.LOADTEST_REPORT_DIR ??
      '/tmp/claude-1000/-home-vavi-Masa-st--TheSecretNumber/11c6aecb-fb0c-4cbf-9a71-b51c3e50ae22/scratchpad',
  };
}

/** Zorunlu bağlantı anahtarları var mı? (service_role sadece seed/cleanup için.) */
export function assertConnection(cfg, { needService = false } = {}) {
  const missing = [];
  if (!cfg.url) missing.push('LOADTEST_URL');
  if (!cfg.anonKey) missing.push('LOADTEST_ANON_KEY');
  if (needService && !cfg.serviceRoleKey) missing.push('LOADTEST_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(
      `Eksik ortam değişkeni: ${missing.join(', ')}. ` +
        `.env.loadtest dosyasını .env.loadtest.example'a göre doldur.`,
    );
  }
}
