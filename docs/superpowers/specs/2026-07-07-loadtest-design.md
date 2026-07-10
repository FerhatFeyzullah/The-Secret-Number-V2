# Spec: Gerçekçi eşzamanlı yük testi (gerçek Supabase, güvenli)

**Tarih:** 2026-07-07
**Durum:** Onaylandı (kullanıcı) — implementasyon planına hazır

## Amaç

"Aynı anda birçok oyuncu oynuyor olsaydı" senaryosunu ölçmek. Somut soru:
Free-tier Supabase kaç **eşzamanlı odayı** kaldırır, ve bildirilen bug —
*"iki kişi kelime oynarken diğerleri hiçbir mod oynayamıyor"* — yük altında
gerçekten oluşuyor mu? Amaç, tavanı **kademeli** bulmak ve darboğazın hangi
katmanda (matchmaking kilidi / RPC gecikmesi / Realtime fanout / Free-tier
compute) olduğunu göstermek.

## Kapsam kararları (kullanıcı onaylı)

- **Hedef ortam:** GERÇEK Supabase (Free-tier prod). Realtime + PostgREST +
  pooler + gerçek compute tavanı dahil ölçülür. Bu, güçlü bir güvenlik iskeleti
  gerektirir (aşağıda).
- **Senaryo:** karma/gerçekçi — tam maç yaşam döngüsü + eşzamanlı matchmake
  çekişmesi, word quick + protocol + private room karışımı.
- **Araç:** özel Node.js (ESM) script + `@supabase/supabase-js` (zaten
  bağımlılık). k6/Artillery DEĞİL — çünkü oyuncu durumlu, çok adımlı ve
  Supabase Realtime websocket'i kullanıyor; en sadık simülasyon gerçek istemci
  kütüphanesiyle olur. Node ≥20 (global `WebSocket`).

## Sanal oyuncu = gerçek istemcinin durum makinesi

`src/online/matchService.ts` istemci→RPC sözleşmesini birebir taklit eder.
Hiçbir yeni sunucu davranışı varsayılmaz; yalnız mevcut RPC'ler çağrılır.

- **word quick:** `signInWithPassword` → `find_or_create_quick_match('word')`
  → `matches:id=eq.<id>` postgres_changes kanalına abone (gerçek istemci gibi)
  → status `setup` olunca `mark_ready` → `set_secret(word,'word')` → status
  `active` → sıra bende iken `make_guess(word,'word')` döngüsü → `heartbeat`
  periyodik → finish'te `get_round_reveal`/`get_match_reveal`.
  Kelimeler `data/word_pool.txt`'ten (havuza SELECT atmadan yerelde seçilir).
- **number quick:** aynı akış; secret/guess = 3 farklı rakam (1–9).
- **protocol (Bo3):** `find_or_create_protocol_match` → seçim fazını mevcut
  seçim RPC'leriyle geçer: anlık ilerleme için `set_protocol_selection(id, [])`
  (sunucu eldeki kartlardan rastgele doldurur), yalnız süre dolarsa fallback
  `resolve_protocol_select` (`select_not_expired`'a dikkat). Kesin çağrı sırası
  implementasyonda migration'dan doğrulanır. Protokol ETKİ mantığını yük testi
  HEDEFLEMEZ → aynı setup/guess döngüsü, `win_target=2`.
- **private room:** çiftin biri `create_private_room(...)`, eşi
  `join_private_room(code)` → aynı döngü.

Her oyuncu, gerçek istemci gibi arada `heartbeat` atar ve kendi kanalına abone
kalır. Tahminler kasıtlı olarak (çoğunlukla) yanlış seçilir ki maçlar birkaç
tur sürsün ve gerçek "uzun süren oda" yükü oluşsun; ara sıra kazanan tahmin
verilir ki maçlar da kapansın.

## Karma yük profili

Orkestratör kademeli (ramp) çalışır. Her aşamada **N oda** hedefine doğru
çiftler açılır; varsayılan karışım:

- %60 word quick, %25 protocol, %15 private room.
- Ayrıca her aşamada bir grup **"yalnız-matchmake"** oyuncusu kuyruğa girip
  hemen çıkar (kontenjan çekişmesi) — "başkaları eşleşemiyor" hipotezini test
  eder.

Varsayılan ramp: `5 → 15 → 30` oda (her aşama ~30–60 sn tutulur), tümü CLI ile
parametrik (`--rooms`, `--ramp`, `--mix`, `--hold`). Agresif koşu için
`--rooms 50/100`.

## Ölçülen metrikler

- **Pairing süresi:** `find_or_create_quick_match` çağrısı → status `setup`
  (Realtime event'i ile gözlenir). p50/p95/p99.
- **RPC gecikmesi** (RPC adı bazında): matchmake, set_secret, make_guess,
  mark_ready, heartbeat… p50/p95/p99.
- **Realtime fanout gecikmesi:** guesser'ın `make_guess` resolve anı → rakibin
  kanalında ilgili event'in geldiği an (yaklaşık; tek saat referansı script).
- **Hata/timeout oranı** sunucu koduna göre. `not_your_turn` gibi beklenen
  kodlar ayrı sayılır; `unknown` / timeout / bağlantı kopması = kötü sinyal.
- **Sürdürülen eşzamanlı oda tavanı:** hata oranı/gecikme eşiği aşılana dek
  ulaşılan en yüksek eşzamanlı aktif oda.
- Çıktı: konsolda özet tablo + `scratchpad/loadtest-report-*.json` ham veri.

## Güvenlik iskeleti (prod'da ZORUNLU)

1. **Ayrılmış hesap havuzu.** `loadtest+NNNN@loadtest.local` biçiminde,
   service_role ile `auth.admin.createUser({ email_confirm: true })` üzerinden
   bir kez seed edilir (e-posta doğrulaması atlanır). Gerçek kullanıcılara
   karışmaz; işaretli domain ile toplu ayırt edilir. Parola sabit/deterministik
   (yalnız yerel `.env.loadtest`'te).
2. **Temizlik.** Koşu sonu otomatik + ayrı `loadtest:cleanup` komutu. service_role
   ile bu hesapların ürettiği `guesses` → `secrets` → `presence` →
   `match_protocol_uses` → `matches` satırları purge edilir (RLS bypass).
   `--purge-users` bayrağı hesapları da (`auth.admin.deleteUser`) siler.
3. **Kademeli ramp + sınır.** Ani yük yerine kademeli artış; her aşama arası
   kısa bekleme. Free-tier'ı ani boğmadan "diz" noktasını bulur.
4. **Sırlar asla commit'lenmez.** `LOADTEST_URL` / `LOADTEST_ANON_KEY` /
   `LOADTEST_SERVICE_ROLE_KEY` → `.env.loadtest` (gitignore'lu). Anahtarsız
   `.env.loadtest.example` commit'lenir. Repo public — service_role anahtarı
   koda/gite ASLA girmez.

## Dosya yapısı

```
scripts/loadtest/
  config.mjs     env + CLI ayrıştırma (rooms, ramp, mix, hold, flags)
  client.mjs     anon + service_role supabase client fabrikası
  words.mjs      data/word_pool.txt yükle; geçerli word/number üret
  metrics.mjs    latency kaydı, p50/p95/p99, hata sayacı, rapor yazımı
  player.mjs     sanal oyuncu durum makineleri (word/number/protocol/private)
  seed.mjs       test hesabı havuzu oluştur/listele (service_role)
  cleanup.mjs    maç verisini purge (+ opsiyonel --purge-users)
  run.mjs        orkestratör: ramp, spawn, metrik topla, raporla, oto-cleanup
  README.md      güvenli çalıştırma rehberi
.env.loadtest.example          (commit; anahtarsız)
.gitignore                     (+ .env.loadtest)
package.json                   (+ loadtest:seed / loadtest:run / loadtest:cleanup)
```

App koduna (`src/`, `app/`, migration'lar) DOKUNULMAZ. Sadece `scripts/`,
`package.json`, `.gitignore`, `.env.loadtest.example`, `docs/`.

## Doğrulama

1. `npm run loadtest:seed` — test hesabı havuzunu bir kez oluşturur (service_role).
2. `npm run loadtest:run -- --rooms 30 --ramp 60` — kademeli yük, canlı sayaçlar,
   sonda özet tablo + JSON rapor; ardından oto-cleanup.
3. Prod'da yalnız işaretli test hesapları kalır; `npm run loadtest:cleanup --
   --purge-users` ile onlar da silinebilir.
4. Rapordan tavan + darboğaz katmanı okunur; buna göre "tier yükselt / index /
   Realtime" kararı netleşir.

## Kapsam dışı (YAGNI)

- Protokol ETKİ mantığının (shield/reflect/steal…) yük testi — yalnız akış
  ölçülür, oyun-teorisi değil.
- Grafik/dashboard (JSON rapor yeter; gerekirse sonra).
- CI'a bağlama (elle çalıştırılan bir teşhis aracı; otomatik değil).

## Git

CLAUDE.md: önce uygula, **commit etme**. Kullanıcı "commit/PR" derse
`development`'tan `chore/loadtest-harness` → `--base development`.
