// Test hesabı havuzunu oluşturur (service_role, admin API). E-posta doğrulaması
// atlanır (email_confirm:true) → hesaplar anında giriş yapılabilir. İdempotent:
// var olan hesaplar atlanır.
import { pathToFileURL } from 'node:url';
import { getConfig, assertConnection } from './config.mjs';
import { serviceClient, accountEmail } from './client.mjs';

export async function runSeed(cfg) {
  assertConnection(cfg, { needService: true });
  const service = serviceClient(cfg);
  let created = 0;
  let existing = 0;
  let failed = 0;
  let idx = 0;
  const CONCURRENCY = 5; // Free-tier'a nazik ol

  async function worker() {
    while (idx < cfg.accountCount) {
      const i = idx++;
      const email = accountEmail(cfg, i);
      const { error } = await service.auth.admin.createUser({
        email,
        password: cfg.accountPassword,
        email_confirm: true,
      });
      if (!error) created++;
      else if (/already|registered|exists|duplicate/i.test(error.message)) existing++;
      else {
        failed++;
        if (cfg.verbose) console.error(`  ${email}: ${error.message}`);
      }
    }
  }

  console.log(`Test hesabı havuzu oluşturuluyor: hedef ${cfg.accountCount} (${accountEmail(cfg, 0)} …)`);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`seed bitti → ${created} yeni · ${existing} mevcut · ${failed} hata`);
  if (failed) console.log('  (hata detayı için --verbose ekle)');
  return { created, existing, failed };
}

// Doğrudan çalıştırıldıysa (npm run loadtest:seed). pathToFileURL: yol Türkçe
// karakter içerdiğinden (Masaüstü) import.meta.url yüzde-kodlu — düz birleştirme
// eşleşmez, bu yüzden aynı kodlamayı üreten pathToFileURL ile karşılaştır.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cfg = getConfig();
  runSeed(cfg).catch((e) => {
    console.error('seed hata:', e.message);
    process.exit(1);
  });
}
