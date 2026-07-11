# Fable İncelemesi — Genel Performans & Güvenilirlik Denetimi

> Tarih: 2026-07-11 · Kapsam: tüm istemci kodu (app/, src/), build/CI yapılandırması, bağımlılıklar.
> Yöntem: 3 paralel keşif denetimi (UI/render, veri/ağ katmanı, yapılandırma) + uygulama planı tasarımı. Tüm bulgular dosya:satır düzeyinde doğrulandı.

---

## Özet (TL;DR)

Projenin genel sağlığı **iyi**: timer temizliği, realtime abonelik hijyeni, mount guard'ları, matchmaking yarış-durumu yönetimi ve sunucu-otoriter mimari örnek nitelikte. **Yeni paket gerekmiyor.** Üç gerçek sorun kümesi var:

1. **🔴 Oyun kırıcı:** RPC'lerde timeout yok → ağ sessizce ölürse maç ekranı kalıcı donuyor, oyuncu saatten kaybediyor.
2. **🔴 Takılmanın ana kaynağı:** 250ms saat tiki, 859-988 satırlık düello ekranlarını maç boyunca **4×/saniye** baştan render ediyor.
3. **🟠 Build/CI:** Android release küçültme (R8) kapalı (~%20-40 gereksiz boyut); testler hiçbir PR'da çalışmıyor.

---

## ✅ İyi durumda olanlar (dokunma)

- **React Compiler AKTİF** — `app.json` `experiments.reactCompiler: true`; babel-preset-expo plugin'i otomatik enjekte ediyor (babel.config.js gerekmez, doğrulandı: `node_modules/expo/node_modules/babel-preset-expo/build/index.js:81-91`).
- New Architecture + Hermes + edge-to-edge açık; tüm bağımlılıklar SDK 54 ile sürüm-uyumlu (21 paket kontrol edildi, sıfır sapma).
- Supabase istemci konfigürasyonu native için doğru (`persistSession`, AsyncStorage, `detectSessionInUrl:false`, AppState'e bağlı token yenileme).
- Realtime hijyeni: kanal teardown, `disposed` bayrağı, üstel backoff'lu yeniden bağlanma, `SUBSCRIBED`'da refresh — abone ol/çık churn'ü YOK.
- Matchmaking yarış yönetimi güçlü: `searchSeqRef` monotonik token'lar, `withTimeout`, idempotent leave/claim.
- Timer temizliği kusursuz; setState-after-unmount koruması tutarlı; çift-gönderim busy bayrakları her yerde.
- OTA açılışı bloklamıyor (`ON_ERROR_RECOVERY` + in-app güncelleme kapısı); `.env` gitignore'da; kelime listeleri bundle'da değil (Supabase'den geliyor); DB indeksleri poll edilen sorguları kapsıyor.
- 10 test dosyası çekirdek saf mantığı (evaluate, secret, mapping, matchService, update-machine) kapsıyor.

## 📦 Paket kararları — yeni paket GEREKMİYOR

| Öneri | Karar | Neden |
|---|---|---|
| react-native-mmkv | ❌ Hayır | AsyncStorage'da yalnız küçük anahtarlar var; açılış darboğazı bundle/asset yüklemesi, storage değil. Native modül + migrasyon maliyetine değmez. |
| @shopify/flash-list | ❌ Hayır | Uzun liste yok; FlatList'ler zaten kısa/sınırlı listelerde doğru kullanılmış. |
| expo-image | ❌ Hayır | Tek statik bundled görsel var; RN `<Image>` yeterli. |

Sorunların hiçbiri paket eksikliğinden kaynaklanmıyor — hepsi mevcut kodda desen düzeltmesiyle çözülüyor.

---

# Bulgular (öncelik sırasıyla)

## P1 — 🔴 RPC'lerde timeout yok → kalıcı donma (oyun kırıcı)

- `src/online/matchService.ts:115-126` (`callRpc`) ve tablo okumaları (`fetchMatchState` :649-671, `fetchGuesses`, `fetchPresence`) **AbortController/timeout olmadan** çağrılıyor. Hücresel ağ geçişinde/sessiz socket ölümünde promise dakikalarca asılı kalabilir.
- Tüm busy bayrakları await ÖNCESİ set edilip yalnız `finally`'de temizleniyor → asılı istek = sonsuz spinner + kilitli tuş takımı:
  - `duel-screen.tsx:583` `submit`, `word-duel-screen.tsx:355` `submit`
  - `setup-screen.tsx:182` `lock` (KİLİTLE asılı kalır → setup saati dolar → maç iptal!)
  - `protocol-select-screen.tsx:220` `confirm`, `duel-screen.tsx:286-409` `runProtocol`
- Matchmaking'de koruma zaten VAR (`app/online.tsx:62-67` `withTimeout`) ama maç içi çağrılara uygulanmamış.

## P2 — 🔴 250ms saat tiki tam-ekran render fırtınası

- `src/online/useMatch.ts:32` `TICK_MS=250`, `:393-397` `setInterval(() => setNow(Date.now()))`. `now`/`clocks` hook'tan dönüyor → **DuelScreen (859 satır) + WordDuelScreen (988 satır) maç boyunca 4×/sn tam render**; görünen saat saniyede 1 değişiyor (4 render'ın 3'ü aynı piksel). `claimTimeout` (:442) ve `resolveSetupTimeout` (:467) effect'leri her tik yeniden koşuyor.
- Aynı desen: `setup-screen.tsx:112`, `protocol-select-screen.tsx:136` (884 satırlık ekran, 16 protokol kartı 4×/sn), `duel/round-setup.tsx:39`, `word/word-setup-panel.tsx:54-57` (**tüm TR klavye 4×/sn render**).
- `word-setup-screen.tsx:62` doğru deseni zaten kullanıyor (setState'siz callback-interval) — diğerleri buna uymalı.
- Yan etki: `duel-screen.tsx:713-722` DigitPad'e her tik yepyeni `accessory` elementi → DigitPad de 4×/sn render.

## P3 — 🟠 Emniyet poll'u arka planda çalışmaya devam ediyor

- `useMatch.ts:220-230` — 1.5s (ön-oyun) / 5s (aktif) poll'un AppState farkındalığı YOK; kardeşleri (heartbeat :404-436, lobi sayacı) doğru şekilde duruyor. Arka plandaki maç her birkaç saniyede 4-5 sorguluk tam `refresh` atıyor → pil + free-tier kotası; resume'da üst üste yığılan refresh'ler.

## P4 — 🟠 Bayat fetch, yeni realtime state'i eziyor

- `useMatch.ts:164-201` `refresh()` toptan `setMatch` yapıyor; sıra değiştikten sonra gelen eski poll snapshot'ı `currentTurn`'ü anlık geri çeviriyor → sıra göstergesi/pad kilidi titremesi. Sürüm/sıra guard'ı yok. (Not: `MatchRow`'da `updated_at`/seq kolonu yok → alan karşılaştırması güvenilmez; yerel realtime-epoch sayacı gerekir.)

## P5 — 🟠 Her poll'da gereksiz `profiles` sorgusu

- `matchService.ts:663-669` — her `fetchMatchState` çağrısı `profiles .in(ids)` de çekiyor; `useMatch` adları zaten cache'liyor (`usernamesRef` + `backfillUsernames` :125-162). Ön-oyun poll'unda dakikada ~40 gereksiz sorgu/istemci → en sıcak döngünün sorgu sayısını ikiye katlıyor.

## P6 — 🟠 Android release: R8 minify + resource shrink KAPALI

- Üretilen `android/app/build.gradle:69,116-118` `android.enableMinifyInReleaseBuilds` / `enableShrinkResourcesInReleaseBuilds` property'lerini okuyor, ikisi de default **false**. **DİKKAT:** `android/` CNG ile üretiliyor (`.gitignore:53-54`) → düzeltme gradle dosyasına DEĞİL config plugin'e yazılmalı (repo'da hazır desen var: `plugins/with-local-java-home.js`). Tipik kazanç: %20-40 küçük binary.

## P7 — 🟠 CI'da test/lint yok

- `.github/workflows/` yalnız `ios-unsigned-ipa.yml` içeriyor. 10 test dosyası (oyun kuralları, matchService, update-machine) hiçbir PR'da koşmuyor → çekirdek mantık regresyonları sessizce merge olur.

## P8 — 🟡 Küçük kalemler (temizlik paketi)

| # | Bulgu | Yer |
|---|---|---|
| a | 14 sonsuz `Animated.loop` her ekranda (alttaki stack ekranları dahil) hep çalışıyor; memo yok | `src/ui/floating-digits.tsx` ← `screen.tsx:41` |
| b | Statik ikonlarda bile reanimated hook'ları çalışıyor; mağaza ~40-50 `<Svg>` mount ediyor → açılış takılması | `src/signals/icons/anim.tsx:47-56,90-142`, `store-screen.tsx:199-229` |
| c | `describe()` switch'inde `default` yok → sunucu yeni enum gönderirse düello ekranı çöker | `guess-history.tsx:15-35` |
| d | Çift-dokunuş aynı frame'de `submitting` state guard'ını geçiyor → sahte "Sıra sende değil" toast'ı | `duel-screen.tsx:583`, `word-duel-screen.tsx:355` |
| e | Preview APK 4 ABI taşıyor (x86/x86_64 emülatör mimarileri) → ~2× büyük | `gradle.properties:35` + `eas.json` preview |
| f | Bundled logo 178KB 1540×541 (gereksiz büyük); `app-icon-background.png` 1.9MB (repo/prebuild maliyeti) | `intro-overlay.tsx:16`, `assets/images/` |
| g | Referanssız şablon asset'leri (~1.5MB repo şişkinliği): `icon.png` 799KB, `logo-glow.png` 331KB, `react-logo*`, `expo-badge*`, `tutorial-web.png`, `splash-icon.png`, `info:` adlı kaza dosyası | `assets/images/` |
| h | `sendSignal` kanal yeniden bağlanırken emoji'yi sessizce düşürüyor (düşük önem) | `useMatch.ts:513-521` |

**WONTFIX kararı:** `online-presence.tsx`'in maç sırasında track etmesi — kapatmak lobi sayacının anlamını bozar (maçtakiler "çevrimiçi" sayılmaz olur), maliyeti ihmal edilebilir.

---

# Uygulama Planı (3 bağımsız faz)

## Faz A — Güvenilirlik + çekirdek performans (P1-P5)

### A1. RPC timeout sarmalayıcı (P1)
**`src/online/matchService.ts`:**
- `REQUEST_TIMEOUT_MS = 10_000` + `withTimeout<T>(p, ms)` helper (Promise.race tabanlı; AbortController KULLANMA — mevcut testler `rpc`'yi düz promise mock'luyor, `.abortSignal()` zinciri hepsini kırar). Timeout'ta `new OnlineError('timeout', ERROR_MESSAGES.timeout)`.
- `ERROR_MESSAGES`'a: `timeout: 'Sunucu yanıt vermedi, lütfen tekrar dene.'`
- `callRpc`: `await withTimeout(client.rpc(fn, args))` → TÜM RPC'ler kapsanır. PostgREST okumalarını da sar (`fetchMatchState`, `fetchGuesses`, `fetchPresence`, `fetchProtocolUses`, `adminPoolSize`).
- UI değişikliği GEREKMEZ: busy bayrakları `finally`'de temizleniyor, catch'ler `errMsg(e)`'den geçiyor → Türkçe mesaj otomatik.
- One-shot ref kilitlerini timeout'ta sıfırla: `useMatch.ts` claim/resolve catch'leri (:452-457, :475-480) + setup/word-setup/protocol-select `firedRef` catch'leri.
- **Test** (`matchService.test.ts`): fake timer ile asılı promise → 10sn'de `code==='timeout'`; hızlı yanıtta timer temizleniyor.

### A2. 4 Hz tam-ekran render'ları öldür (P2)
Fikir: tik başına değişen tek veri saat metni → tikleme YAPRAK bileşenlere insin; timeout tespiti state-effect yerine ref-okuyan interval olsun.

- **`useMatch.ts`:** `now` state, `TICK_MS`, tik effect'i (:393-397) ve render-time türetmeleri SİL. `clocks`/`opponentUnstable`/`opponentGone`'u API'den çıkar (dış tüketici YOK — grep doğrulandı). `matchRef`/`presenceRef`/`lastEventAtRef` ekle. claimTimeout → `phase==='active'`'te 500ms ref-okuyan interval (mevcut `claimedTurnRef` guard'ıyla); resolveSetupTimeout ve heartbeat hızlandırıcı aynı desen.
- **Yeni `src/online/useLiveClocks.ts`:** `useLiveClocks(match): {clock1Ms, clock2Ms}` — yalnız `status==='active' && turnStartedAt && !turnFrozen` iken 250ms interval; çağıran yaprak tikler.
- **`duel/player-pod.tsx`:** `LivePlayerChip({match, self, name, accent, stack})` — kendi tikler, mevcut `PlayerChip`'i sarar.
- **`duel-screen.tsx`:** `clocks`/`myClockMs`/`oppClockMs` sil; iki `PlayerChip` kullanımı (:680-686 ve DigitPad `accessory` :713-722) → `LivePlayerChip` (accessory'nin her-tik-yeni-element sorunu da çözülür).
- **`word-duel-screen.tsx`:** saat satırı (:508-529) → dosya sonunda `WordClockRow({match, onLowWarn})`; `useLiveClocks` + `lowBuzzedRef` haptiği oraya taşınır.
- **`setup/countdown-ring.tsx`:** kendini tikleyen hale getir: `{deadline: number|null, totalMs, lowMs=5000}`; içeride 250ms interval, 0'da durur.
- **Çağrı yerleri:** `setup-screen.tsx` (:46,:110-114) ve `protocol-select-screen.tsx` (:49,:134-138) → `nowMs` sil, iptal tespiti word-setup-screen:60-73 desenine (500ms callback-interval + one-shot ref), Alert metninde `Date.now()` lokal. `round-setup.tsx` (:36-41) → mola için kuantize `{inBreak, breakSec}` (değişmeyince `prev` döndüren setState). `word-setup-panel.tsx` (:54-57) → timer metni kendi tikleyen `SetupTimer` bileşenine.

### A3. Poll'a AppState kapısı + taze-olay atlama (P3)
`useMatch.ts:220-230` → heartbeat effect'i (:404-436) gibi: background'da durdur, resume'da anında `refresh()` + yeniden başlat. Ön-oyun 1.5s → **2.5s** (setup/select'te both-ready hızlandırıcılar zaten var). Callback'te `Date.now() - lastEventAtRef.current < period` ise turu atla.

### A4. Bayat-fetch guard'ı: realtime epoch sayacı (P4)
`matchEventSeqRef` — matches UPDATE handler'ının başında artır. `refresh()`: `Promise.all` öncesi `seqAtStart` yakala; sonra sayaç değişmediyse `setMatch(withNames(state))`, değiştiyse maç satırını atla (guesses/presence/uses id-anahtarlı → koşulsuz güvenli). `withNames(state)`: `usernamesRef`'i işleyen helper — realtime handler'daki (:279-296) çift mantıktan çıkar, A5 de kullanır.

### A5. Poll'da profiles sorgusunu atla (P5)
`fetchMatchState(matchId, opts?: {skipProfiles?: boolean})`; `refresh`'te iki oyuncunun adı da cache'teyse `skipProfiles: true`; `withNames()` adları geri doldurur; `backfillUsernames` emniyet ağı kalır. **Test:** mock'a zincirlenebilir `from()` builder; skip'te `from('profiles')` çağrılmadığını assert et.

**Faz A doğrulama:** `npm test` + `npx tsc --noEmit`; cihazda: (1) maç ortası uçak modu → ≤10sn'de hata + pad açılır; (2) DevTools "highlight updates" → yalnız saat yaprakları 4×/sn; (3) saat 0'da otomatik claim ~1sn; (4) Bo3 ara-tur sayacı düzgün; (5) 20sn arka plan → Supabase loglarında poll yok, resume'da anında tazeleme; (6) hızlı sıra değişiminde titreme yok.

## Faz B — Build & CI (P6, P7, P8-e)

### B1. R8 minify + resource shrink — config plugin (CNG-doğru)
**Yeni `plugins/with-android-release-shrink.js`** (`with-local-java-home.js` deseninde, `withGradleProperties` ile):
`android.enableMinifyInReleaseBuilds=true` + `android.enableShrinkResourcesInReleaseBuilds=true`. `app.json` plugins'e ekle.
Doğrulama: `npm run build:android:local` → APK boyutu önce/sonra; cihazda tam duman testi (auth, hızlı maç, kelime, protokol, mağaza, OTA, sfx). R8 kırılırsa proguard keep kuralı eklenir (SDK 54'te normalde gerekmez).

### B2. CI workflow
**Yeni `.github/workflows/test.yml`** — push/PR (main, development), ubuntu-latest: checkout → setup-node(20, npm cache) → `npm ci` → `npx tsc --noEmit` → `npm test -- --ci` → `npm run lint`. Secret gerekmez (testler Supabase'i mock'luyor).

### B3. Preview build arm-only
`eas.json` preview profiline: `"env": {"ORG_GRADLE_PROJECT_reactNativeArchitectures": "arm64-v8a,armeabi-v7a"}` (env property'si gradle.properties'i override eder — CNG'de doğru mekanizma). Production dokunulmaz (app-bundle zaten cihaz başına böler). Preview APK ~yarıya iner + yerel build hızlanır.

## Faz C — Temizlik paketi (P8)

1. **FloatingDigits:** `React.memo` + `useIsFocused()` ile odak dışında `loop.stop()` (glyph'ler unmount EDİLMEZ — geçişte boş kalmasın).
2. **Sinyal ikonları:** `Layer`/`Glow` → dispatcher + `StillLayer`(hook'suz)/`MotionLayer` — `animated=false`'ta reanimated hook'ları hiç çalışmasın. Svg'leri BİRLEŞTİRME (katman animasyonları bağımsız).
3. **`describe()` default:** `default: return {label: String(feedback), color: colors.dim}` (`content-ui.tsx` de kapsanır).
4. **Çift-gönderim kilidi:** `submitLatchRef` — senkron check+set, `finally`'de temizle.
5. **Görseller:** logo 1540→1200px + pngquant; `app-icon-background.png` sıkıştır; referanssız asset'leri sil (silmeden önce son referans kontrolü).
6. **Opsiyonel:** `app/online.tsx:62-68` lokal `withTimeout`'u kaldır → A1'deki tek kaynağa devret.

**Faz C doğrulama:** test + lint; mağaza/intro/düello görsel turu; mağaza scroll FPS iyileşmesi.

## Uygulama sırası
A1 (izole, test kapsamlı) → A2 (en büyük diff: önce useMatch + useLiveClocks + düello ekranları, sonra setup/select/round + ring, sonra word-setup-panel) → A3+A4+A5 birlikte (hepsi `refresh`/poll çevresinde, ortak ref'leri paylaşır) → B → C.

## Git notu
Çalışma alanında hâlâ commit'lenmemiş şifre-sıfırlama dosyaları var (`app/auth.tsx`, `src/auth.tsx`, `app/reset-password.tsx`). Bu plana başlamadan önce onların commit durumu netleştirilmeli ki diff'ler karışmasın.
