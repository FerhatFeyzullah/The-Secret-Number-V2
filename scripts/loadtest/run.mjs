// Yük testi orkestratörü: kademeli (ramp) aşamalarda gerçekçi karma yük üretir,
// metrik toplar, özet + JSON rapor yazar, sonra otomatik temizlik yapar.
import { getConfig, assertConnection } from './config.mjs';
import { newPlayerClient, accountEmail } from './client.mjs';
import { Metrics } from './metrics.mjs';
import { openPlayer, playSession, playPrivatePair, runStorm } from './player.mjs';
import { runCleanup } from './cleanup.mjs';
import { poolSizes } from './words.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ağırlıklı senaryo seçici: mix = { word:60, protocol:25, private:15, ... } */
function makePicker(mix) {
  const entries = Object.entries(mix);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  return () => {
    let r = Math.random() * total;
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k;
    }
    return entries[0][0];
  };
}

/** Tembel-girişli hesap havuzu: lease(n) n boş oyuncu ayırır (gerekince giriş
 *  yapar), release geri verir. Havuz tavana göre boyutlu → normalde bloklamaz. */
function makePool(cfg, metrics) {
  const slots = [];
  for (let i = 0; i < cfg.accountCount; i++) {
    slots.push({ email: accountEmail(cfg, i), player: null, busy: false });
  }
  const waiters = [];

  function tryAcquire(n) {
    const free = slots.filter((s) => !s.busy);
    if (free.length < n) return null;
    const chosen = free.slice(0, n);
    chosen.forEach((s) => (s.busy = true));
    return chosen;
  }

  async function lease(n) {
    let got = tryAcquire(n);
    while (!got) {
      await new Promise((res) => waiters.push(res));
      got = tryAcquire(n);
    }
    try {
      const players = [];
      for (const s of got) {
        if (!s.player) s.player = await openPlayer(cfg, metrics, s.email);
        players.push(s.player);
      }
      return players;
    } catch (e) {
      for (const s of got) s.busy = false; // bu lease iptal → hepsini bırak
      const w = waiters.shift();
      if (w) w();
      throw e;
    }
  }

  function release(player) {
    const s = slots.find((x) => x.player === player);
    if (s) {
      s.busy = false;
      const w = waiters.shift();
      if (w) w();
    }
  }

  return { lease, release };
}

async function main() {
  const cfg = getConfig();

  const sizes = poolSizes();
  console.log('══ Gizemli Sayılar — yük testi ══════════════════════════');
  console.log(`  hedef:      ${cfg.url}`);
  console.log(`  aşamalar:   ${cfg.stages.join(' → ')} oda  (hold ${cfg.holdSec}s, ramp ${cfg.rampSec}s)`);
  console.log(`  karışım:    ${Object.entries(cfg.mix).map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`  fırtına:    ${cfg.stormPlayers} yalnız-matchmake/aşama`);
  console.log(`  hesaplar:   ${cfg.accountCount} (havuz)`);
  console.log(`  kelime hav.: 4=${sizes[4]} 5=${sizes[5]} 6=${sizes[6]}`);
  console.log('─────────────────────────────────────────────────────────');

  if (cfg.dryRun) {
    console.log('--dry-run: yalnız plan yazdırıldı, bağlanılmadı.');
    return;
  }

  // Gerçek koşu: bağlantı anahtarları zorunlu.
  assertConnection(cfg);
  const metrics = new Metrics();

  // Preflight: 0 numaralı hesapla giriş dene → yoksa seed'e yönlendir.
  try {
    const probe = newPlayerClient(cfg);
    const { error } = await probe.auth.signInWithPassword({
      email: accountEmail(cfg, 0),
      password: cfg.accountPassword,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error(`\nGiriş başarısız (${e.message}).`);
    console.error('Önce test hesaplarını oluştur:  npm run loadtest:seed\n');
    process.exit(1);
  }

  const pool = makePool(cfg, metrics);
  const pick = makePicker(cfg.mix);
  const sessions = [];

  const launchRoom = (type) => {
    const p = (async () => {
      let players;
      try {
        players = await pool.lease(2);
        if (type === 'private') {
          await playPrivatePair(cfg, metrics, players[0], players[1]);
        } else {
          // word/number/protocol: iki bağımsız matchmaker (sunucu eşler).
          await Promise.all([
            playSession(cfg, metrics, players[0], type),
            playSession(cfg, metrics, players[1], type),
          ]);
        }
      } catch (err) {
        metrics.countError(err?.code ?? 'room_error');
      } finally {
        if (players) players.forEach((pl) => pool.release(pl));
      }
    })();
    sessions.push(p);
  };

  const launchStorm = () => {
    const p = (async () => {
      let players;
      try {
        players = await pool.lease(1);
        await runStorm(cfg, metrics, players[0]);
      } catch (err) {
        metrics.countError(err?.code ?? 'storm_error');
      } finally {
        if (players) players.forEach((pl) => pool.release(pl));
      }
    })();
    sessions.push(p);
  };

  for (let s = 0; s < cfg.stages.length; s++) {
    const R = cfg.stages[s];
    console.log(`\n▶ Aşama ${s + 1}/${cfg.stages.length}: ${R} oda hedefi`);
    const gap = R > 0 ? (cfg.rampSec * 1000) / R : 0;
    for (let k = 0; k < R; k++) {
      launchRoom(pick());
      if (gap) await sleep(gap);
    }
    for (let k = 0; k < cfg.stormPlayers; k++) {
      launchStorm();
      await sleep(150);
    }
    console.log(`  ${R} oda + ${cfg.stormPlayers} fırtına başlatıldı; ${cfg.holdSec}s tutuluyor…`);
    await sleep(cfg.holdSec * 1000);
  }

  console.log('\nAşamalar bitti — kalan oturumların drenajı bekleniyor…');
  await Promise.allSettled(sessions);

  metrics.printSummary();
  const reportPath = metrics.writeReport(cfg.reportDir);
  console.log(`Rapor: ${reportPath}`);

  // Koşu sonu otomatik temizlik (prod'da zorunlu iskeletin parçası).
  console.log('\nOtomatik temizlik başlıyor…');
  try {
    await runCleanup(cfg, { purgeUsers: cfg.purgeUsers });
  } catch (e) {
    console.error(`Temizlik hatası (elle çalıştır: npm run loadtest:cleanup): ${e.message}`);
  }
}

main().catch((e) => {
  console.error('\nYük testi hata:', e?.message ?? e);
  process.exit(1);
});
