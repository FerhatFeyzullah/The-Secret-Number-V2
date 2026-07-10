// Yük testi verisini prod'dan temizler (service_role, RLS bypass). Yalnız işaretli
// test hesaplarının dahil olduğu maçları siler — iki gerçek kullanıcı arasındaki
// hiçbir maça DOKUNMAZ. --purge-users ile hesapları da siler.
import { pathToFileURL } from 'node:url';
import { getConfig, assertConnection } from './config.mjs';
import { serviceClient } from './client.mjs';

/** Havuz e-postası biçimindeki (loadtest+NNNN@domain) tüm auth kullanıcılarını bulur. */
async function listTestUsers(service, cfg) {
  const users = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const batch = data?.users ?? [];
    for (const u of batch) {
      if (u.email && u.email.startsWith(cfg.accountPrefix) && u.email.endsWith('@' + cfg.accountDomain)) {
        users.push({ id: u.id, email: u.email });
      }
    }
    if (batch.length < perPage) break;
    page++;
  }
  return users;
}

/** Bu kullanıcıların player1/player2 olduğu maç id'leri. */
async function matchIdsForUsers(service, ids) {
  const found = new Set();
  const chunk = 50;
  for (let i = 0; i < ids.length; i += chunk) {
    const list = ids.slice(i, i + chunk).join(',');
    const { data, error } = await service
      .from('matches')
      .select('id')
      .or(`player1.in.(${list}),player2.in.(${list})`);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) found.add(r.id);
  }
  return [...found];
}

async function deleteForMatches(service, matchIds) {
  const chunk = 100;
  const childTables = ['guesses', 'secrets', 'presence', 'match_protocol_uses'];
  let deletedMatches = 0;
  for (let i = 0; i < matchIds.length; i += chunk) {
    const sub = matchIds.slice(i, i + chunk);
    for (const t of childTables) {
      const { error } = await service.from(t).delete().in('match_id', sub);
      // Tablo yoksa/kolon yoksa sessizce geç (şema sürümüne dayanıklı).
      if (error && !/does not exist|schema cache|relation/i.test(error.message)) {
        console.warn(`  ${t} silinirken: ${error.message}`);
      }
    }
    const { error } = await service.from('matches').delete().in('id', sub);
    if (error) throw new Error(error.message);
    deletedMatches += sub.length;
  }
  return deletedMatches;
}

export async function runCleanup(cfg, { purgeUsers = false } = {}) {
  assertConnection(cfg, { needService: true });
  const service = serviceClient(cfg);

  console.log('cleanup: test hesapları taranıyor…');
  const users = await listTestUsers(service, cfg);
  console.log(`  ${users.length} test hesabı bulundu`);
  if (!users.length) return { matches: 0, users: 0 };

  const ids = users.map((u) => u.id);
  const matchIds = await matchIdsForUsers(service, ids);
  console.log(`  ${matchIds.length} test maçı → veri siliniyor…`);
  const deleted = await deleteForMatches(service, matchIds);
  console.log(`  ${deleted} maç + alt kayıtları silindi`);

  let purged = 0;
  if (purgeUsers) {
    console.log('  --purge-users: hesaplar siliniyor…');
    for (const u of users) {
      const { error } = await service.auth.admin.deleteUser(u.id);
      if (!error) purged++;
      else if (cfg.verbose) console.error(`  ${u.email}: ${error.message}`);
    }
    console.log(`  ${purged} hesap silindi`);
  }
  console.log('cleanup bitti.');
  return { matches: deleted, users: purged };
}

// Doğrudan çalıştırıldıysa (npm run loadtest:cleanup [-- --purge-users]).
// pathToFileURL: Türkçe yol (Masaüstü) import.meta.url'de yüzde-kodlu olduğundan.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = getConfig();
  runCleanup(cfg, { purgeUsers: cfg.purgeUsers }).catch((e) => {
    console.error('cleanup hata:', e.message);
    process.exit(1);
  });
}
