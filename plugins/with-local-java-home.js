// Yerel build (eas build --local) prebuild'inde gradle.properties'i bu makineye göre
// sabitler. android/ her prebuild'de yeniden üretildiğinden buraya elle yazılan
// ayarlar kayboluyor — bu plugin prebuild'de onları otomatik (yeniden) yazar.
//
// 1) org.gradle.java.home → Java 17:
//    Fedora'da sistem varsayılan Java'sı 25 (class file major 69); Gradle bunu
//    tanımayıp "Unsupported class file major version 69" ile patlıyor.
//    Yol MAKİNEYE ÖZEL: varsayılan bu makinedeki Temurin 17; başka makinede
//    JAVA_HOME_17 env'i ile ezilebilir (kod değişmeden). Yol yoksa atlanır.
//
// 2) org.gradle.workers.max → 2:
//    16 GB RAM'li bu makinede, new arch + Hermes + 4-ABI (arm64/armeabi/x86/x86_64)
//    native derleme varsayılan 8 worker'da belleği tüketip OOM'a düşüyordu
//    ("Disk quota exceeded" aslında bellek tükenmesiydi). 2 worker'da ~4.8 GB boş
//    bellek payıyla sorunsuz tamamlanıyor.
//
// GÜVENLİK: yalnızca YEREL build'de (EAS_BUILD_RUNNER === 'local-build-plugin')
// uygulanır. Bulut EAS build'lerinde (EAS_BUILD_RUNNER === 'eas-build') ve normal
// config değerlendirmesinde (expo-doctor/lint/prebuild) NO-OP → bulut build (daha
// çok RAM'li) yavaşlamaz, başka makineler ETKİLENMEZ.
const { withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');

const JAVA_17 = process.env.JAVA_HOME_17 || '/usr/lib/jvm/temurin-17-jdk';
const IS_LOCAL_BUILD = process.env.EAS_BUILD_RUNNER === 'local-build-plugin';

function setProp(props, key, value) {
  const existing = props.find((p) => p.type === 'property' && p.key === key);
  if (existing) existing.value = value;
  else props.push({ type: 'property', key, value });
}

module.exports = function withLocalJavaHome(config) {
  // Yerel build değilse hiçbir şey yapma (güvenli).
  if (!IS_LOCAL_BUILD) return config;

  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    // Java 17 yolunu yalnızca gerçekten varsa sabitle.
    if (fs.existsSync(JAVA_17)) setProp(props, 'org.gradle.java.home', JAVA_17);
    // Bellek baskısını sınırla (OOM önleme) — yoldan bağımsız her yerel build'de.
    setProp(props, 'org.gradle.workers.max', '2');
    return cfg;
  });
};
