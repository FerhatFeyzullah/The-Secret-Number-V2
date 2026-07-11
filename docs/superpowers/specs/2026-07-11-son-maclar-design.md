# Son Maçlar — Global Maç Akışı (Tasarım)

Tarih: 2026-07-11 · Durum: onaylandı, uygulama planı bekliyor

## Bağlam

Oyuna "geçmiş maçlar" özelliği ekleniyor. Kullanıcının isteği: **kişisel değil, oyun geneli** — menüye girince oyunda oynanan **son 30 eşleşmeli maç** (herkesinki) görünsün; canlılık/sosyal kanıt hissi versin.

Kritik kısıt: mevcut `match_retention` migration'ı bitmiş maçları ~15 dk sonra siliyor (`reap_finished_matches`, pg_cron), tüm maç-scoped veri (`secrets`, `guesses`, `presence`, protokoller) `on delete cascade` ile gidiyor. Kalıcı olan tek şey `profiles`'taki toplu istatistikler. **Yani maç-bazlı geçmiş hiçbir yerde tutulmuyor** → özetleri kalıcı, silme-süpürgesinden muaf bir yere yazmak gerekiyor.

## Hedef / Hedef değil

**Hedef:**
- Global "Son Maçlar" akışı: son 30 eşleşmeli maç, en yeni üstte, zaman etiketi yok.
- Her maçın altında tur-bazlı gizli sayı/kelime ifşası (kazananın gizlisi vurgulu).
- Ana menüden bir buton → liderlik-tarzı modal.

**Hedef değil (v1):**
- Kişisel "benim maçlarım" filtresi (sadece global).
- Gerçek-zamanlı canlı ticker (aç-çek yeterli; sonraya kolay eklenir).
- Özel/dostluk maçları (akışa girmez).
- "Load more" / 30'dan fazlası.

## UX

Görsel referans: mockup (`scratchpad/son-maclar-mockup.html`). Oyunun `theme.ts` paletine sadık (koyu mavi zemin, neon cyan, mono kodlar).

**Kart anatomisi:**
- Üst satır: `oyuncu1  ·  [mod çipi + skor + sonuç sebebi]  ·  oyuncu2`
  - Kazanan: parlak/ışıldayan isim; kaybeden: sönük isim.
  - Her ismin **altında** o maçtaki kupa değişimi: kazanan `+N 🏆` (yeşil), kaybeden `−N 🏆` (kırmızı). 🏆 yalnız burada (kupa birimi); isim yanında ayrı kupa YOK.
  - Ortada: mod çipi (**Hızlı** cyan / **Kelime** amber / **Protokol** mor), skor (Bo3 → "2–1"; tek tur → skor yok), küçük sonuç sebebi ("doğru tahmin" / "süre doldu" / "terk").
- Altında **tur-bazlı ifşa**: her tur bir satır — iki oyuncunun gizlisi tile olarak (rakam ya da harf), ortada "Tur N". Kazananın gizlisi altın vurgulu; **kupa tile'a yapışık, dış tarafta** (oyuncu1 kazandıysa tile'ların solunda, oyuncu2 kazandıysa sağında).
- Tek turlu Hızlı maçta tek tur satırı; Bo3'te (Kelime/Protokol) 2–3 tur.

**Giriş noktası:** Ana menüde (`app/index.tsx`) yeni buton — mevcut lider tablosu butonu (`setBoardOpen`) / mağaza / protokoller ile aynı desen. Tıklayınca `RecentMatchesModal` açılır (`LeaderboardModal` birebir deseni: `<Modal transparent animationType="fade">`).

## Veri modeli

Yeni tablo `public.match_history` — minik, denormalize, self-contained özet satırları:

| Kolon | Tip | Not |
|---|---|---|
| `id` | bigint / uuid PK | |
| `match_id` | uuid **unique** | idempotency (aynı maç iki kez yazılmasın) |
| `ended_at` | timestamptz | sıralama anahtarı (desc) |
| `mode` | text | 'quick' \| 'protocol' |
| `content_type` | text | 'number' \| 'word' |
| `win_target` | int | Bo3 mi (>1) tek tur mu (1) |
| `player1`, `player2` | uuid | |
| `player1_name`, `player2_name` | text | **snapshot** (o anki username) |
| `winner` | uuid | kazanan oyuncu |
| `result` | text | 'win' \| 'timeout' \| 'forfeit' |
| `p1_round_wins`, `p2_round_wins` | int | skor |
| `p1_delta`, `p2_delta` | int | kupa değişimi (maç satırından) |
| `rounds` | jsonb | `[{ round, p1_secret, p2_secret, winner }]` (winner: 1\|2) |

Not: gizli/isim/delta **snapshot** — sonraki username değişimi geçmişi bozmaz, okuma joinsiz.

## Yazma yolu (maç bitişinde)

- Hook: `_apply_rating(m)` maç bitişinde deltaları yazan yer ve **zaten yalnızca skorlanan eşleşmeli maçlarda** (`mode in ('quick','protocol') and status='finished'`) çalışıyor → private/dostluk doğal olarak dışarıda kalır.
- Yeni `_record_match_history(m)` fonksiyonu `_apply_rating` sonrası (aynı transaction, deltalar hazırken) çağrılır. İçinde:
  1. `secrets`'ten tüm turların iki gizlisini topla (tablo `(match_id, player, round)` anahtarlı → her tur mevcut).
  2. Her tur için **tur kazananı** türet: `guesses`'te `round=r AND feedback='win'` olan tahmının sahibi. Timeout ile biten tur (win-guess yok) için: kalan turu skor-farkından çıkar ya da tur-çözümleme mantığından al — **açık detay, plan aşamasında netleşecek** (bkz. Açık noktalar).
  3. `insert into match_history (...) on conflict (match_id) do nothing`.
  4. **Rolling-30 temizliği:** `delete from match_history where id not in (select id from match_history order by ended_at desc limit 30);` → tablo hiç 30'u geçmez, cron gerekmez.
- `matches` (ağır canlı veri) reap'i **DEĞİŞMEZ** — 15 dk süpürge + zombi waiting/setup temizliği aynen kalır (reveal/yeniden-bağlanma penceresi maç hacmine bağlanmasın diye ayrı tutuldu).

## Okuma yolu

- `get_recent_matches()` RPC — SECURITY DEFINER, `match_history`'den `order by ended_at desc limit 30` döner. `get_leaderboard` desenine birebir; `authenticated`'a execute grant.
- Gizlilik: bitmiş maçların gizlileri zaten iki tarafa açılıyor ve tek-maçlık → public göstermek güvenli. İsimler lider tablosuyla tutarlı.

## İstemci

- `src/online/matchService.ts`: `getRecentMatches(): Promise<RecentMatch[]>` (RPC sarmalayıcı, snake→camel eşleme). `withTimeout` ile sarılır (A1 deseni).
- `src/online/types.ts`: `RecentMatch` + `RecentMatchRound` tipleri.
- Yeni bileşen `src/online/ui/recent-matches-modal.tsx` (`{ visible, onClose }`), mockup'ı RN'e çevirir; mod→çip, result→sebep etiketi eşlemesi client'ta.
- `app/index.tsx`: `recentOpen` state + buton + `<RecentMatchesModal .../>` (leaderboard deseni).
- Tazeleme: modal açılınca fetch + aşağı-çekince yenile (FlatList `refreshing`). Realtime yok (v1).

## Eşlemeler

- Mod çipi: `content_type==='word'` → Kelime; `mode==='protocol' && content_type==='number'` → Protokol; `mode==='quick'` → Hızlı.
- Sonuç sebebi: `win`→"doğru tahmin", `timeout`→"süre doldu", `forfeit`→"terk".
- Skor: `win_target>1` ise "p1RoundWins–p2RoundWins"; değilse gösterme (tek tur).

## Kenar durumlar

- **Private/dostluk maçları:** `_apply_rating` bunlarda çalışmadığından hiç yazılmaz.
- **Boş akış:** hiç maç yoksa modal "henüz maç oynanmadı" boş durumu gösterir.
- **Eksik isim:** username null ise kısa bir yer tutucu ("Rakip"/kısaltma).
- **İdempotency:** `on conflict (match_id) do nothing` → finalize iki kez koşsa da tek satır.
- **Timeout turu kazananı:** win-guess yoksa türetim (bkz. Açık noktalar).

## Açık noktalar (plan aşamasında)

1. **Timeout ile biten tur kazananı.** win-guess'siz turlarda tur kazananını güvenilir belirlemek: (a) skor farkından çıkarım (guess-kazanılan turları çıkar, kalanı skora göre ata), ya da (b) tur-çözümleme fonksiyonlarına (protocol/word round advance) küçük bir "tur kazananı" kaydı ekle. Plan tercihi netleştirecek.
2. `match_history.id` tipi (bigint identity vs uuid) ve indeksler (`ended_at desc`).
3. RPC dönüşünde `rounds` JSONB'nin istemci tipiyle şekil doğrulaması.

## Doğrulama

- **Migration testi** (Supabase Docker harness): iki oyunculu bir Bo3 maçı bitir → `match_history`'de tek satır + doğru turlar/kazananlar/deltalar; 31. maçtan sonra en eski satırın silindiğini doğrula.
- **Birim testi** (`matchService.test.ts` deseni): `get_recent_matches` RPC eşlemesi + `getRecentMatches` snake→camel + boş dönüş.
- **Cihaz/manuel:** ana menü butonu → modal açılır, son maçlar görünür, tur ifşaları ve kupa deltaları doğru; aşağı-çek yeniler; her mod tipi (Hızlı/Kelime/Protokol) doğru çip.
- `npx tsc --noEmit` + `npm test` + `npm run lint` yeşil.
