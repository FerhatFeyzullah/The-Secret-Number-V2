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
import { formatStat, StatChip } from '@/ui/stat-chip';
import { colors, mono } from '@/ui/theme';

export default function MenuScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Görünen ad TEK kaynaktan (ayarlarla aynı hook):
  // oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name, refresh: refreshName } = useProfile();
  const [stats, setStats] = useState({ gamesPlayed: 0, bestScore: null as number | null });
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

  return (
    <Screen>
      <View style={styles.topRow}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.profileName} numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View style={styles.chips}>
          <StatChip icon="game-controller-outline" value={formatStat(stats.gamesPlayed)} />
          <StatChip
            icon="trophy-outline"
            value={stats.bestScore === null ? '—' : formatStat(stats.bestScore)}
          />
        </View>
        <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
          <Ionicons name="settings-outline" size={26} color={colors.cyan} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroGhost}>?</Text>
        <Text style={styles.logoLine}>● ● ●</Text>
        <Text style={styles.logoTop}>GİZEMLİ</Text>
        <Text style={styles.logoBottom}>SAYILAR</Text>
        <Text style={styles.tagline}>şifreyi kır, sayıyı bul</Text>
      </View>

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

      <Text style={styles.version}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 17,
    fontWeight: '800',
  },
  profileName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
  hero: {
    alignItems: 'center',
    marginTop: 34,
    marginBottom: 30,
    gap: 6,
  },
  heroGhost: {
    position: 'absolute',
    top: -36,
    color: 'rgba(130, 150, 255, 0.07)',
    fontSize: 190,
    fontWeight: 'bold',
    fontFamily: mono,
  },
  logoLine: {
    color: colors.amber,
    fontSize: 13,
    letterSpacing: 6,
  },
  logoTop: {
    color: colors.dim,
    fontSize: 25,
    fontWeight: '300',
    fontFamily: mono,
    letterSpacing: 14,
    marginTop: 2,
  },
  logoBottom: {
    color: colors.cyan,
    fontSize: 46,
    fontWeight: 'bold',
    fontFamily: mono,
    letterSpacing: 7,
    textShadowColor: colors.cyanDim,
    textShadowRadius: 18,
  },
  tagline: {
    color: colors.dim,
    fontSize: 13,
    letterSpacing: 2,
    marginTop: 4,
  },
  menu: {
    gap: 18,
    marginTop: 8,
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
  version: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 12,
    marginTop: 'auto',
    paddingVertical: 12,
  },
});
