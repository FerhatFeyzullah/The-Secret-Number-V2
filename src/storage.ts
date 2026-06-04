import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  name: 'profile.name',
  sound: 'settings.sound',
  haptics: 'settings.haptics',
  gamesPlayed: 'stats.gamesPlayed',
  legacyGamesWon: 'stats.gamesWon', // eski sürümden taşıma
  bestScore: 'stats.bestScore',
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

export async function getStats() {
  const [played, legacy, best] = await AsyncStorage.multiGet([
    KEYS.gamesPlayed,
    KEYS.legacyGamesWon,
    KEYS.bestScore,
  ]);
  return {
    gamesPlayed: Number(played[1]) || Number(legacy[1]) || 0,
    bestScore: best[1] ? Number(best[1]) : null,
  };
}

/** Kazanılan oyunu kaydeder: sayaç artar, daha az tahminse en iyi skor güncellenir. */
export async function recordWin(guessCount: number) {
  const stats = await getStats();
  const pairs: [string, string][] = [[KEYS.gamesPlayed, String(stats.gamesPlayed + 1)]];
  if (stats.bestScore === null || guessCount < stats.bestScore) {
    pairs.push([KEYS.bestScore, String(guessCount)]);
  }
  await AsyncStorage.multiSet(pairs);
}

/** Kaybedilen oyun da oynanan oyun sayısına eklenir. */
export async function recordLoss() {
  const stats = await getStats();
  await AsyncStorage.setItem(KEYS.gamesPlayed, String(stats.gamesPlayed + 1));
}
