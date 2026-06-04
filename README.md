# Gizemli Sayılar 🔢

3 haneli gizli sayıyı bulmaya çalıştığın bir tahmin oyunu. **Offline mod hazır** — çok oyunculu online mod yakında!

## Oyun Kuralları

- Gizli sayı; **1-9 arası, birbirinden farklı 3 rakamdan** oluşur (sıfır yok).
- Her tahminde **kaç rakamın doğru olduğu** söylenir — ama hangileri ve hangi pozisyonda olduğu **asla** söylenmez.
- Üç rakamın üçü de doğru ama sıra yanlışsa: *"rakamlar doğru, yerleri yanlış"*.
- Rakamları doğru sıraya koyduğunda kazanırsın! 🎉

**Modlar:** Tahmin Hakkı (5/7/10/12 hak — biterse kaybedersin) · Süreli (30 sn / 1 dk / 2 dk / özel — süre dolarsa kaybedersin)

## Teknoloji Yığını

- [Expo SDK 54](https://expo.dev) (mağazadaki Expo Go ile uyumlu) + React Native 0.81
- TypeScript (oyun mantığı katmanında sıkı tipleme)
- Expo Router (dosya tabanlı navigasyon)
- AsyncStorage (profil, ayarlar, istatistikler — tamamen yerel)
- expo-audio (sentezlenmiş ses efektleri) + expo-haptics (titreşim)
- Jest + jest-expo (birim testler)

## Kurulum

```bash
npm install                      # bağımlılıklar (postinstall sesleri otomatik üretir)
node scripts/generate-sfx.js     # ses efektlerini elle üretmek istersen
npx expo start                   # dev server — QR'ı Expo Go ile okut
npm test                         # birim testler
```

> **Not:** `assets/sfx/` altındaki WAV dosyaları repoya dahil değildir; `scripts/generate-sfx.js` ile koddan sentezlenir (`npm install` sonrası otomatik çalışır).

## Klasör Yapısı

```
app/                # ekranlar (Expo Router)
  index.tsx         #   ana menü
  offline-setup.tsx #   mod seçimi (hak / süre)
  offline.tsx       #   offline oyun ekranı
  online.tsx        #   çok oyunculu (yakında)
  settings.tsx      #   profil + ayarlar
  how-to-play.tsx   #   kurallar
src/
  game/             # saf TS oyun mantığı + testler (sıkı tipli çekirdek)
  ui/               # tema, camsı bileşenler, animasyonlu arka plan
  storage.ts        # AsyncStorage yardımcıları
  sfx.ts            # ses efekti hook'u
scripts/
  generate-sfx.js   # WAV ses efektlerini sentezler
assets/sfx/         # üretilen sesler (gitignore'da)
```
