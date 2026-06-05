import AsyncStorage from '@react-native-async-storage/async-storage';

// Not: stats.* anahtarları kaldırıldı — istatistik artık YALNIZCA online
// (Hızlı Maç) ve sunucudan gelir (get_my_rank); offline hiçbir şey kaydetmez.
const KEYS = {
  name: 'profile.name',
  sound: 'settings.sound',
  haptics: 'settings.haptics',
  lastMode: 'menu.lastMode', // ana ekranda son seçilen mod (profil verisi değil)
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

export async function getToggle(key: 'sound' | 'haptics') {
  const value = await AsyncStorage.getItem(KEYS[key]);
  return value !== 'off'; // varsayılan: açık
}

export async function setToggle(key: 'sound' | 'haptics', enabled: boolean) {
  await AsyncStorage.setItem(KEYS[key], enabled ? 'on' : 'off');
}
