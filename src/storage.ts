import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  name: 'profile.name',
  sound: 'settings.sound',
  haptics: 'settings.haptics',
  gamesPlayed: 'stats.gamesPlayed',
  legacyGamesWon: 'stats.gamesWon', // eski sürümden taşıma (eski "oynanan" sayacı)
  bestScore: 'stats.bestScore',
  wins: 'stats.wins', // kazanılan oyun sayısı
  streak: 'stats.streak', // güncel üst üste galibiyet
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

/** Oyun istatistikleri. Eksik/eski anahtarlar 0'dan (en iyi skor null) başlar.
 *  winRate = kazanılan ÷ oynanan, tam sayı yüzde; oynanan 0 ise %0. */
export async function getStats() {
  const [played, legacy, best, wins, streak] = await AsyncStorage.multiGet([
    KEYS.gamesPlayed,
    KEYS.legacyGamesWon,
    KEYS.bestScore,
    KEYS.wins,
    KEYS.streak,
  ]);
  const gamesPlayed = Number(played[1]) || Number(legacy[1]) || 0;
  const winCount = Number(wins[1]) || 0;
  return {
    gamesPlayed,
    bestScore: best[1] ? Number(best[1]) : null,
    wins: winCount,
    streak: Number(streak[1]) || 0,
    winRate: gamesPlayed === 0 ? 0 : Math.round((winCount / gamesPlayed) * 100),
  };
}

/** Galibiyet: oynanan + kazanılan + seri artar; daha az tahminse en iyi skor güncellenir. */
export async function recordWin(guessCount: number) {
  const stats = await getStats();
  const pairs: [string, string][] = [
    [KEYS.gamesPlayed, String(stats.gamesPlayed + 1)],
    [KEYS.wins, String(stats.wins + 1)],
    [KEYS.streak, String(stats.streak + 1)],
  ];
  if (stats.bestScore === null || guessCount < stats.bestScore) {
    pairs.push([KEYS.bestScore, String(guessCount)]);
  }
  await AsyncStorage.multiSet(pairs);
}

/** Yenilgi: oynanan artar, güncel seri sıfırlanır (kazanılan ve en iyi skor korunur). */
export async function recordLoss() {
  const stats = await getStats();
  await AsyncStorage.multiSet([
    [KEYS.gamesPlayed, String(stats.gamesPlayed + 1)],
    [KEYS.streak, '0'],
  ]);
}
