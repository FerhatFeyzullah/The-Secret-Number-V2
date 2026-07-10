# Yük testi (load test) — Gizemli Sayılar

"Aynı anda birçok oyuncu oynasaydı" senaryosunu **gerçek Supabase**'e karşı ölçer.
Sanal oyuncular gerçek istemcinin (`src/online/matchService.ts`) RPC akışını
`@supabase/supabase-js` ile birebir taklit eder: matchmaking → Realtime abonelik →
set_secret → sıra-bazlı make_guess → finish. Karma yük (word/protocol/private) +
eşzamanlı "yalnız-matchmake" fırtınası ile *"iki kişi kelime oynarken diğerleri
oynayamıyor"* profilini üretir.

## ⚠️ Bu prod veritabanına vurur

Güvenlik iskeleti yerleşik ama sorumluluk sende:
- Yalnız **işaretli test hesapları** (`loadtest+NNNN@loadtest.local`) kullanılır;
  gerçek kullanıcılara karışmaz.
- Koşu sonu **otomatik temizlik** test maçlarını siler; iki gerçek kullanıcı
  arasındaki hiçbir maça dokunulmaz.
- Free-tier'ı ani boğmamak için **kademeli ramp** (5→15→30) — parametrik.

## Kurulum (bir kez)

1. `cp .env.loadtest.example .env.loadtest` → 3 anahtarı doldur
   (Supabase → Project Settings → API: Project URL, anon, service_role).
   `.env.loadtest` gitignore'ludur.
2. Test hesabı havuzunu oluştur:
   ```bash
   npm run loadtest:seed
   ```

## Çalıştırma

```bash
# Varsayılan kademeli koşu (5 → 15 → 30 oda) + oto-temizlik
npm run loadtest:run

# Parametreli
npm run loadtest:run -- --rooms 10,30,60 --hold 60 --ramp 40 \
  --mix "word:60,protocol:25,private:15" --storm 15

# Yalnız planı gör (bağlanmaz)
npm run loadtest:run -- --dry-run

# Koşu sonunda hesapları da sil
npm run loadtest:run -- --purge-users
```

Koşu; canlı aşama günlüğü + sonda **RPC gecikme tablosu (p50/p95/p99)**, sayaçlar,
hata kodları ve bir JSON rapor (`scratchpad/loadtest-report-*.json`) verir.

## Temizlik (elle)

```bash
npm run loadtest:cleanup                 # test maç verisini sil
npm run loadtest:cleanup -- --purge-users # hesapları da sil
```

## CLI bayrakları

| Bayrak | Varsayılan | Açıklama |
|---|---|---|
| `--rooms a,b,c` | `5,15,30` | Ramp aşamaları (her aşamadaki eşzamanlı oda) |
| `--hold N` | `45` | Aşama başına tutma süresi (sn) |
| `--ramp N` | `30` | Aşama içinde spawn'ın yayıldığı süre (sn) |
| `--mix "k:w,…"` | `word:60,protocol:25,private:15` | Senaryo ağırlıkları |
| `--storm N` | `10` | Aşama başına yalnız-matchmake oyuncu |
| `--accounts N` | `Σoda·2+storm+20` | Hesap havuzu boyutu |
| `--max-turns N` | `24` | Oyuncu bu kadar kendi turundan sonra maçtan çıkar |
| `--heartbeat N` | `5000` | Heartbeat aralığı (ms) |
| `--purge-users` | — | Koşu/temizlik sonu hesapları da sil |
| `--dry-run` | — | Yalnız planı yazdır |
| `--verbose` | — | Hata detaylarını yazdır |

## Metrikler nasıl okunur

- **`matchmake_quick/protocol` p95/p99** yükselirse → matchmaking darboğazı
  (kilit çekişmesi / seq-scan / compute). Bizim daha önce index'le çözdüğümüz sınıf.
- **`pairing` süresi** + **`pairing_timeout`** artışı → "eşleşemiyor" belirtisi.
- **`make_guess` p99** + **`realtime_fanout`** → maç-içi gecikme / Realtime tavanı.
- **`session_error` / `unknown` / timeout** kodları → gerçek kötü sinyal
  (`not_your_turn` beklenen, iyi huylu yarıştır).

## Notlar

- Node ≥ 20 gerekir (global `WebSocket`). Bu repo Node 22 kullanıyor.
- Uygulama koduna dokunmaz; yalnız `scripts/loadtest/` + `package.json`.
- Protokol maçında seçim fazı sunucuya rastgele doldurtulur — protokol ETKİ
  mantığı yük testinin hedefi değildir, yalnız akış/yük ölçülür.
