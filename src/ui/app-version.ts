import * as Application from 'expo-application';
import Constants from 'expo-constants';

/** Oyun içi sürüm etiketi: "v2.2.0 (5)".
 *  - Sürüm ADI (2.2.0): app config'ten (elle yönetilir).
 *  - Parantez içi build no (Android versionCode): gerçek APK'dan (expo-application).
 *    eas.json remote + autoIncrement ile her build'de +1 artar. Dev/Expo Go'da
 *    build no bilinmezse parantez atlanır. */
export function appVersionLabel(): string {
  const version = Constants.expoConfig?.version ?? '2.2.0';
  const build = Application.nativeBuildVersion;
  return `v${version}${build ? ` (${build})` : ''}`;
}
