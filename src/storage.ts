import AsyncStorage from '@react-native-async-storage/async-storage';

// Not: stats.* anahtarları kaldırıldı — istatistik artık YALNIZCA online
// (Hızlı Maç) ve sunucudan gelir (get_my_rank); offline hiçbir şey kaydetmez.
const KEYS = {
  name: 'profile.name',
  sound: 'settings.sound',
  haptics: 'settings.haptics',
  lastMode: 'menu.lastMode', // ana ekranda son seçilen mod (profil verisi değil)
  lastLevel: 'progress.lastLevel', // seviye atlama kutlamasını tek sefer göstermek için
} as const;

export type GameMode = 'solo' | 'online';

export async function getLastMode(): Promise<GameMode> {
  const mode = await AsyncStorage.getItem(KEYS.lastMode);
  return mode === 'online' ? 'online' : 'solo'; // varsayılan: tek kişilik
}

export async function setLastMode(mode: GameMode) {
  await AsyncStorage.setItem(KEYS.lastMode, mode);
}

export const DEFAULT_NAME = 'Oyuncu';

export async function getProfileName() {
  const name = await AsyncStorage.getItem(KEYS.name);
  return name?.trim() || DEFAULT_NAME;
}

/** Varsayılana düşmeden ham yerel adı döndürür; hiç kaydedilmemişse null.
 *  (İlk girişte offline adı bir defalığına DB'ye taşımak için kullanılır.) */
export async function getRawProfileName() {
  const name = await AsyncStorage.getItem(KEYS.name);
  return name?.trim() || null;
}

export async function setProfileName(name: string) {
  await AsyncStorage.setItem(KEYS.name, name.trim());
}

/** Son görülen seviye (seviye atlama kutlamasını tek sefer tetiklemek için).
 *  Hiç kaydedilmemişse null → ilk açılışta kutlama gösterilmez, yalnız ilklenir. */
export async function getLastSeenLevel(): Promise<number | null> {
  const v = await AsyncStorage.getItem(KEYS.lastLevel);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function setLastSeenLevel(level: number) {
  await AsyncStorage.setItem(KEYS.lastLevel, String(level));
}

export async function getToggle(key: 'sound' | 'haptics') {
  const value = await AsyncStorage.getItem(KEYS[key]);
  return value !== 'off'; // varsayılan: açık
}

export async function setToggle(key: 'sound' | 'haptics', enabled: boolean) {
  await AsyncStorage.setItem(KEYS[key], enabled ? 'on' : 'off');
}
