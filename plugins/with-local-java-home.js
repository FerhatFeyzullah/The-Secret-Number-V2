// Yerel build (eas build --local) prebuild'inde Gradle'ı Java 17'ye sabitler.
//
// Neden: Fedora'da sistem varsayılan Java'sı 25 (class file major 69); Gradle bunu
// tanımayıp "Unsupported class file major version 69" ile patlıyor. android/ her
// prebuild'de yeniden üretildiğinden gradle.properties'e elle yazılan
// org.gradle.java.home kayboluyordu — bu plugin prebuild'de otomatik (yeniden) yazar.
//
// GÜVENLİK: yalnızca YEREL build'de (EAS_BUILD_RUNNER === 'local-build-plugin') VE
// yol gerçekten varsa uygulanır. Bulut EAS build'lerinde (EAS_BUILD_RUNNER ===
// 'eas-build') ve normal config değerlendirmesinde (expo-doctor/lint/prebuild)
// NO-OP → bulut build / başka makineler ETKİLENMEZ.
//
// Yol MAKİNEYE ÖZEL: varsayılan bu makinedeki Temurin 17; başka makinede
// JAVA_HOME_17 env'i ile ezilebilir (kod değişmeden).
const { withGradleProperties } = require('expo/config-plugins');
const fs = require('fs');

const JAVA_17 = process.env.JAVA_HOME_17 || '/usr/lib/jvm/temurin-17-jdk';
const IS_LOCAL_BUILD = process.env.EAS_BUILD_RUNNER === 'local-build-plugin';
const KEY = 'org.gradle.java.home';

module.exports = function withLocalJavaHome(config) {
  // Yerel build değilse ya da Java 17 yolu yoksa: hiçbir şey yapma (güvenli).
  if (!IS_LOCAL_BUILD || !fs.existsSync(JAVA_17)) return config;

  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const existing = props.find((p) => p.type === 'property' && p.key === KEY);
    if (existing) existing.value = JAVA_17;
    else props.push({ type: 'property', key: KEY, value: JAVA_17 });
    return cfg;
  });
};
