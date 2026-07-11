// Android RELEASE build'inde R8 kod küçültme + kullanılmayan kaynak temizliğini
// açar. android/ CNG ile üretildiği (gitignore'da) ve her prebuild'de yeniden
// yazıldığı için gradle.properties'e elle yazmak KALICI DEĞİL — bu plugin
// prebuild'de property'leri otomatik (yeniden) yazar.
//
// Üretilen android/app/build.gradle şu property'leri okur:
//   minifyEnabled     ← findProperty('android.enableMinifyInReleaseBuilds') ?: false
//   shrinkResources   ← findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: false
// İkisi de varsayılan false → R8/ProGuard dead-code eliminasyonu ve kullanılmayan
// resource temizliği KAPALIYDI (üretim APK/AAB ~%20-40 gereksiz büyük).
//
// Yalnız RELEASE varyantını etkiler; debug/dev-client build'leri değişmez.
// RN + Hermes + Expo kütüphaneleri kendi consumer keep-kurallarını getirir; oyun
// mantığı JS (Hermes bytecode) olduğundan R8'den etkilenmez. Kırılma olursa
// proguard-rules.pro'ya keep kuralı eklenir (SDK 54'te normalde gerekmez).
const { withGradleProperties } = require('expo/config-plugins');

function setProp(props, key, value) {
  const existing = props.find((p) => p.type === 'property' && p.key === key);
  if (existing) existing.value = value;
  else props.push({ type: 'property', key, value });
}

module.exports = function withAndroidReleaseShrink(config) {
  return withGradleProperties(config, (cfg) => {
    setProp(cfg.modResults, 'android.enableMinifyInReleaseBuilds', 'true');
    setProp(cfg.modResults, 'android.enableShrinkResourcesInReleaseBuilds', 'true');
    return cfg;
  });
};
