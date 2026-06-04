import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth, useProfile } from '@/auth';
import { getLastMode, getStats, setLastMode, type GameMode } from '@/storage';
import { ModeSegment } from '@/ui/mode-segment';
import { PlayButton } from '@/ui/play-button';
import { Screen } from '@/ui/screen';
import { StatCard } from '@/ui/stat-card';
import { formatStat, StatChip } from '@/ui/stat-chip';
import { colors, mono } from '@/ui/theme';

type Stats = Awaited<ReturnType<typeof getStats>>;

const EMPTY_STATS: Stats = {
  gamesPlayed: 0,
  bestScore: null,
  wins: 0,
  streak: 0,
  winRate: 0,
};

export default function MenuScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Görünen ad TEK kaynaktan (ayarlarla aynı hook):
  // oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name, refresh: refreshName } = useProfile();
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [mode, setMode] = useState<GameMode>('solo');

  // Son seçilen modu hatırla (yereldir, profil verisi değil).
  useEffect(() => {
    getLastMode().then(setMode);
  }, []);

  const selectMode = (next: GameMode) => {
    setMode(next);
    setLastMode(next);
  };

  // Ayarlardan veya oyundan dönünce profil adı ve istatistikleri tazele.
  useFocusEffect(
    useCallback(() => {
      refreshName();
      getStats().then(setStats);
    }, [refreshName]),
  );

  // Online yalnızca burada oturum ister; oturum yoksa giriş ekranına yönlendir.
  const goOnline = () => {
    if (session) {
      router.push('/online');
    } else {
      router.push({ pathname: '/auth', params: { next: '/online' } });
    }
  };

  // OYNA: seçili moda göre mevcut navigasyon davranışı aynen korunur.
  const play = () => {
    if (mode === 'solo') {
      router.push('/offline-setup');
    } else {
      goOnline();
    }
  };

  const best = stats.bestScore === null ? '—' : formatStat(stats.bestScore);

  return (
    <Screen>
      {/* Üst bar: avatar + ad + chip'ler, sağda ayarlar */}
      <View style={styles.topRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.identity}>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.chips}>
            <StatChip icon="eye-outline" value={formatStat(stats.gamesPlayed)} />
            <StatChip icon="locate-outline" value={best} />
          </View>
        </View>
        <Pressable onPress={() => router.push('/settings')} hitSlop={12} style={styles.gear}>
          <Ionicons name="settings-outline" size={22} color={colors.cyan} />
        </Pressable>
      </View>

      {/* Logo: GİZEMLİ / SAYILAR + üç haneli "?" motifi */}
      <View style={styles.hero}>
        <Text style={styles.logoTop}>GİZEMLİ</Text>
        <Text style={styles.logoBottom}>SAYILAR</Text>
        <View style={styles.secretBoxes}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.secretBox}>
              <Text style={styles.secretBoxText}>?</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Menü: mod seçici + OYNA + Nasıl Oynanır */}
      <View style={styles.menu}>
        <ModeSegment value={mode} onChange={selectMode} />
        <PlayButton mode={mode} onPress={play} />
        <Pressable
          onPress={() => router.push('/how-to-play')}
          hitSlop={8}
          style={styles.howToPlay}>
          <Ionicons name="help-circle-outline" size={16} color={colors.dim} />
          <Text style={styles.howToPlayText}>Nasıl Oynanır</Text>
        </Pressable>
      </View>

      {/* Alt: detay istatistik kartları + sürüm */}
      <View style={styles.footer}>
        <View style={styles.statsRow}>
          <StatCard value={best} label="EN İYİ" />
          <StatCard value={String(stats.streak)} label="SERİ" />
          <StatCard value={`%${stats.winRate}`} label="BAŞARI" />
        </View>
        <Text style={styles.version}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.cyan,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 20,
    fontWeight: '800',
    fontFamily: mono,
  },
  identity: {
    flexShrink: 1,
    alignItems: 'flex-start',
    gap: 5,
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
  },
  gear: {
    marginLeft: 'auto',
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 26,
  },
  logoTop: {
    color: colors.dim,
    fontSize: 22,
    fontWeight: '300',
    fontFamily: mono,
    letterSpacing: 12,
    marginLeft: 12, // letterSpacing'in sağdaki boşluğunu dengele
  },
  logoBottom: {
    color: colors.cyan,
    fontSize: 46,
    fontWeight: '900',
    fontFamily: mono,
    letterSpacing: 6,
    marginLeft: 6,
    marginTop: 2,
    textShadowColor: colors.cyanDim,
    textShadowRadius: 18,
  },
  secretBoxes: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  secretBox: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: 'rgba(52, 224, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(52, 224, 255, 0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secretBoxText: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '800',
    fontFamily: mono,
  },
  menu: {
    gap: 16,
  },
  howToPlay: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
  },
  howToPlayText: {
    color: colors.dim,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  footer: {
    marginTop: 'auto',
    gap: 14,
    paddingBottom: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  version: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 12,
    paddingVertical: 6,
  },
});
