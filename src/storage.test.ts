import AsyncStorage from '@react-native-async-storage/async-storage';

import { getStats, recordLoss, recordWin } from './storage';

// AsyncStorage'ı bellek-içi mock ile değiştir; her testten önce temizle.
jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock fabrikası dış kapsamı alamaz
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('getStats', () => {
  it('hiç veri yokken sıfırlardan başlar', async () => {
    expect(await getStats()).toEqual({
      gamesPlayed: 0,
      bestScore: null,
      wins: 0,
      streak: 0,
      winRate: 0,
    });
  });

  it('eski stats.gamesWon anahtarını oynanan oyuna taşır (geriye dönük uyum)', async () => {
    await AsyncStorage.setItem('stats.gamesWon', '7');
    const stats = await getStats();
    expect(stats.gamesPlayed).toBe(7);
    expect(stats.wins).toBe(0);
    expect(stats.streak).toBe(0);
  });
});

describe('recordWin', () => {
  it('oynanan, kazanılan ve seriyi artırır; en iyi skoru kaydeder', async () => {
    await recordWin(4);
    expect(await getStats()).toEqual({
      gamesPlayed: 1,
      bestScore: 4,
      wins: 1,
      streak: 1,
      winRate: 100,
    });
  });

  it('daha az tahminde en iyi skoru günceller', async () => {
    await recordWin(5);
    await recordWin(3);
    expect((await getStats()).bestScore).toBe(3);
  });

  it('daha çok tahminde en iyi skoru bozmaz', async () => {
    await recordWin(3);
    await recordWin(6);
    expect((await getStats()).bestScore).toBe(3);
  });

  it('üst üste galibiyette seri birikir', async () => {
    await recordWin(4);
    await recordWin(4);
    await recordWin(4);
    expect((await getStats()).streak).toBe(3);
  });
});

describe('recordLoss', () => {
  it('oynananı artırır, seriyi sıfırlar, kazanılanı ve en iyi skoru korur', async () => {
    await recordWin(4); // wins 1, streak 1, best 4
    await recordLoss();
    expect(await getStats()).toEqual({
      gamesPlayed: 2,
      bestScore: 4,
      wins: 1,
      streak: 0,
      winRate: 50,
    });
  });

  it('kayıp galibiyet serisini keser; sonraki galibiyet 1’den başlar', async () => {
    await recordWin(4);
    await recordWin(4); // streak 2
    await recordLoss(); // streak 0
    await recordWin(4); // streak 1
    expect((await getStats()).streak).toBe(1);
  });
});

describe('winRate (kazanma oranı)', () => {
  it('oynanan 0 ise %0', async () => {
    expect((await getStats()).winRate).toBe(0);
  });

  it('kazanılan ÷ oynanan yüzdesini yuvarlar (2/3 → 67)', async () => {
    await recordWin(4);
    await recordWin(4);
    await recordLoss();
    expect((await getStats()).winRate).toBe(67);
  });
});
