# Kelime modu — maç/eşleşme yaşam döngüsü incelemesi

> İnceleme tarihi: 2026-06-27 · Branch: `development`
> Kapsam: kelime modu eklendikten sonra maç eşleşme, hayalet maç, maçtan çıkma /
> kopma → karşı tarafın kazanması gibi yaşam-döngüsü senaryoları.

## Özet

İyi haber: **klasik "hayalet maç" ve "çıkınca rakip kazanır" yolları kelime
modunda doğru çalışıyor.** `leave_match`, disconnect-reap, `claim_timeout`
fonksiyonları content-type'tan bağımsız ve word maçlarında
(`mode='quick'` + `content_type='word'` + `win_target=2` Bo3) tutarlı davranıyor.

**Bir gerçek açık var:** Bo3 maçında **tur arası (2./3. tur) gizli-kelime
belirleme fazının zaman aşımı sunucuda çözümlenmiyor** → maç kilitlenebiliyor ve
mağdur taraf çıkmak zorunda kalınca **oyalayan (geride olan) taraf kazanıyor.**
Bu hem word Bo3 hem protokol Bo3'ü etkiliyor.

---

## Doğru çalıştığı teyit edilenler

| Senaryo | Sonuç | Kaynak |
|---|---|---|
| Aktif maçta çıkış (`leave_match`) | Rakip hükmen **kazanır** (forfeit) | `supabase/migrations/20260607000004_destiny_hand.sql` |
| Aktif maçta kopma/çökme (heartbeat-reap) | Hayatta olan **kazanır** (15 sn eşiği) | `supabase/migrations/20260607000013_heartbeat_reap.sql` |
| Tur saati (120 sn) dolması | `claim_timeout` → sıradaki kaybeder, `_advance_or_finish` | `supabase/migrations/20260607000007_protocols_4b.sql` |
| Ön-oyun / 1. tur setup'ta çıkış / kopma | Maç **iptal** (kazanan yok) — adil | `leave_match` + reap |
| **1. tur** setup'ta oyalama / gelmeme | İstemci `cancel_setup_timeout` → iptal | `src/online/ui/word/word-setup-screen.tsx:59-73` |
| Bekleyen maçı terk eden + 2. arayan | `_cancel_unstarted_matchmade` artığı kapatır | matchmaking |
| Word / number / protocol kuyruk ayrımı | `FOR UPDATE SKIP LOCKED` + content_type filtresi → çapraz / çift eşleşme yok | matchmaking |

Yani word maçı `mode='quick'` + `content_type='word'` + `win_target=2` olarak
doğsa da tüm yaşam-döngüsü fonksiyonları `win_target` / `content_type` / status'a
göre dallandığı için word'ü doğru işliyor.

---

## 🔴 Açık: Tur-arası (Bo3 round ≥ 2) belirleme fazının zaman aşımı çözümsüz

### Mekanizma

1. 1. tur biter → `_advance_or_finish` maçı `status='setup'`, `current_round=2`,
   `setup_deadline = now()+68 sn` yapar, `*_ready` bayraklarını sıfırlar ama
   **`*_present` bayraklarını taşır** (iki taraf hâlâ "present").
   → `supabase/migrations/20260611000003_word_round_length_bo3.sql:60-89`
2. Bu 2. tur belirleme ekranı **düello ekranının içinde** render edilir
   (`WordSetupPanel`), ayrı route değil.
   → `src/online/ui/word/word-duel-screen.tsx:362-373`
3. **`WordSetupPanel` deadline dolunca hiçbir şey yapmıyor** —
   `cancel_setup_timeout` çağrısı yok, otomatik gönderim yok; sayaç 0'da kalıyor.
   → `src/online/ui/word/word-setup-panel.tsx` (tüm dosya)
4. `cancel_setup_timeout` yalnızca **istemci çağırırsa** çalışır ve round ayrımı
   yapmadan **tüm maçı iptal eder**; ama onu çağıran tek yer 1. tur route ekranı
   (`word-setup-screen.tsx`). Düello-içi tur geçişinde çağıran yok.
   → `supabase/migrations/20260607000004_destiny_hand.sql`
5. Global stale-maç temizleyen cron **yok** (yalnız haftalık sezon reset'i var).
   Disconnect-reap ise yalnız rakip *sessizse* (kopmuşsa) tetiklenir.

### Sonuç

Bo3'te skor **1-0** iken, geride olan oyuncu 2. tur belirlemede **uygulamayı ön
planda tutup sırrını girmezse** (heartbeat atmaya devam eder ama `set_secret`
yapmaz):

- `setup_deadline` (68 sn) geçer, **hiçbir taraf çözüm tetikleyemez** → maç
  `setup`'ta **kilitli kalır**.
- Önde olan oyuncu "Rakip bekleniyor…" ekranında sonsuza dek bekler. Tek çıkışı
  **maçtan çıkmak** → `leave_match` (`setup`, `current_round>1`) → **forfeit,
  kazanan = oyalayan taraf.**

Yani **geride olan oyuncu, sırrını girmeyerek lider oyuncuyu ya sonsuz beklemeye
ya da hükmen yenilgiye zorlayabiliyor.** Tam da sorulan "maçtan çıkma → karşı
tarafın kazanması" durumunun istismara dönüşmüş hâli.

### Etki ve sınırlar

- **Etkilenen:** word Bo3 **ve** protokol Bo3 (aynı `RoundSetup` / duel deseni —
  `src/online/ui/duel-screen.tsx:616`, `src/online/ui/duel/round-setup.tsx` da
  `cancel_setup_timeout` çağırmıyor). Tek-tur number "quick" modunda tur geçişi
  olmadığı için **etkilenmez.**
- **Hafifletici:** Oyalayan oyuncu uygulamayı **arka plana alır / kapatırsa**
  heartbeat durur → 15 sn'de reap devreye girer → **hayatta olan kazanır**
  (doğru). Açık yalnızca uygulama **ön planda tutulup kasıtlı oyalama** (ya da
  telefonu açık bırakıp >68 sn dalgınlık) durumunda kalıyor. Bu yüzden severity
  **düşük-orta**, ama kasıtlı istismara açık ve "asılı maç" UX'i kötü.

### Önerilen düzeltme yönü (henüz uygulanmadı)

İki seçenek (tercihen ikisi birlikte):

1. **İstemci:** Tur-arası setup'a da 1. tur ekranındaki zaman-aşımı tetikleyicisini
   ekle (`WordSetupPanel` + `RoundSetup` içine, deadline geçince bir RPC çağır).
2. **Sunucu (daha sağlam):** Tur-arası setup zaman aşımını **iptal yerine adil
   çöz** — `cancel_setup_timeout`'u round>1 için "sırrını giren oyuncu turu/maçı
   kazanır" (ya da iki taraf da girmediyse iptal) olacak şekilde ayır; böylece
   karar istemci çağrısına bağlı kalmaz ve oyalama ödüllendirilmez. İdeali: aktif
   tur saatindeki gibi her iki istemcinin de claim edebildiği idempotent bir
   sunucu kararı.

---

## İncelenen başlıca kaynaklar

- Sunucu RPC'leri (kümülatif migration'ların **en son** tanımları):
  - `leave_match` → `20260607000004_destiny_hand.sql`
  - `forfeit_disconnect` → `20260605000009_trophy_rating.sql`
  - `heartbeat` / `_reap_if_opponent_stale` → `20260607000013_heartbeat_reap.sql`
  - `claim_timeout` → `20260607000007_protocols_4b.sql`
  - `cancel_setup_timeout` / `mark_ready` → `20260607000004_destiny_hand.sql` / `20260615000000_word_remove_protocol.sql`
  - `_advance_or_finish` (Bo3 tur geçişi, 68 sn) → `20260611000003_word_round_length_bo3.sql`
  - `find_or_create_quick_match` (word dalı, clock_ms=120000) → `20260620000000_word_round_clock_120s.sql`
  - `make_guess` (word per-harf + Bo3) → `20260615000001_word_wordle_marks.sql`
- İstemci:
  - `src/online/useMatch.ts` (heartbeat / reap / claim tetikleyici)
  - `src/online/match-session.tsx` (merkezi leave)
  - `src/online/ui/word/word-setup-screen.tsx` (1. tur belirleme — cancel timer **var**)
  - `src/online/ui/word/word-duel-screen.tsx` (düello + tur-arası setup)
  - `src/online/ui/word/word-setup-panel.tsx` (belirleme paneli — cancel timer **yok**)
  - `src/online/ui/duel-screen.tsx` + `src/online/ui/duel/round-setup.tsx` (number/protokol karşılaştırması)
