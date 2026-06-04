import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth, useProfile } from '@/auth';
import { getStats } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { Screen } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

export default function MenuScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Görünen ad TEK kaynaktan (ayarlarla aynı hook):
  // oturum açıkken profiles.username, kapalıyken yerel ad.
  const { name, refresh: refreshName } = useProfile();
  const [stats, setStats] = useState({ gamesPlayed: 0, bestScore: null as number | null });

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

  return (
    <Screen>
      <View style={styles.topRow}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.profileName}>{name}</Text>
        </View>
        <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
          <Ionicons name="settings-outline" size={26} color={colors.cyan} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <Text style={styles.logoLine}>● ● ●</Text>
        <Text style={styles.logo}>GİZEMLİ{'\n'}SAYILAR</Text>
        <Text style={styles.tagline}>şifreyi kır, sayıyı bul</Text>
      </View>

      <View style={styles.menu}>
        <GlassButton label="Tek Kişilik" onPress={() => router.push('/offline-setup')} />
        <GlassButton
          label="Çok Oyunculu"
          accent={colors.amber}
          badge="Çok Yakında"
          onPress={goOnline}
        />
        <GlassButton small label="Nasıl Oynanır" onPress={() => router.push('/how-to-play')} />
      </View>

      <GlassCard style={styles.stats}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.gamesPlayed}</Text>
          <Text style={styles.statLabel}>Oynanan Oyun</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statItem}>
          <Text style={styles.statValue}>
            {stats.bestScore === null ? '—' : stats.bestScore}
          </Text>
          <Text style={styles.statLabel}>En İyi (tahmin)</Text>
        </View>
      </GlassCard>

      <Text style={styles.version}>v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 18,
    fontWeight: '800',
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  hero: {
    alignItems: 'center',
    marginTop: 36,
    marginBottom: 28,
    gap: 8,
  },
  logoLine: {
    color: colors.amber,
    fontSize: 14,
    letterSpacing: 6,
  },
  logo: {
    color: colors.cyan,
    fontSize: 44,
    fontWeight: 'bold',
    fontFamily: mono,
    textAlign: 'center',
    letterSpacing: 6,
    lineHeight: 54,
    textShadowColor: colors.cyanDim,
    textShadowRadius: 18,
  },
  tagline: {
    color: colors.dim,
    fontSize: 13,
    letterSpacing: 2,
  },
  menu: {
    gap: 18,
    marginTop: 8,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 28,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: colors.glassBorder,
  },
  statValue: {
    color: colors.amber,
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: mono,
  },
  statLabel: {
    color: colors.dim,
    fontSize: 12,
  },
  version: {
    textAlign: 'center',
    color: colors.dim,
    fontSize: 12,
    marginTop: 'auto',
    paddingVertical: 12,
  },
});
