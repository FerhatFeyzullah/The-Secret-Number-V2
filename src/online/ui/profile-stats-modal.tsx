import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getMyRank, isEliteLevel, levelTitle, OnlineError, type MyRank } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

/** Yüklenirken kutu içinde yanıp sönen yer tutucu çubuk (iskelet). */
function Skel({ width }: { width: number }) {
  const pulse = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[styles.skel, { width, opacity: pulse }]} />;
}

/** Profil istatistik modalı: avatar + ad + kupa rozeti, altında 2x2 istatistik
 *  kutusu. Veriler yalnızca sunucudan (get_my_rank — Hızlı Maç istatistikleri);
 *  offline hiçbir şey kaydetmez. Oturum yoksa "giriş gerekli" durumu gösterilir. */
export function ProfileStatsModal({
  visible,
  name,
  signedIn,
  onClose,
}: {
  visible: boolean;
  /** Görünen ad (useProfile — modal veriyi beklemeden adı gösterir). */
  name: string;
  signedIn: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();

  const pop = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await getMyRank());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'İstatistikler yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    if (signedIn) {
      void load();
    } else {
      setData(null);
      setError(null);
    }
  }, [visible, signedIn, load, pop]);

  const winRate =
    data == null ? 0 : data.played === 0 ? 0 : Math.round((data.wins / data.played) * 100);

  // Seviye ilerlemesi: sunucu eşikleri (level_floor..level_next) arasındaki oran.
  // levelNext null = maks seviye → çubuk dolu.
  const levelPct =
    data == null
      ? 0
      : data.levelNext == null
        ? 1
        : Math.min(1, Math.max(0, (data.xp - data.levelFloor) / (data.levelNext - data.levelFloor)));

  // Elit aralık (8-10): altın tonu + güçlü parıltı (son-seviye cilası).
  const elite = data != null && isEliteLevel(data.level);

  const boxes: { icon: keyof typeof Feather.glyphMap; label: string; value: string }[] = [
    { icon: 'play-circle', label: 'OYNANAN', value: String(data?.played ?? 0) },
    { icon: 'check-circle', label: 'KAZANILAN', value: String(data?.wins ?? 0) },
    { icon: 'percent', label: 'BAŞARI ORANI', value: `%${winRate}` },
    { icon: 'zap', label: 'GALİBİYET SERİSİ', value: String(data?.streak ?? 0) },
  ];

  const cardStyle = {
    opacity: pop,
    transform: [
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View
        style={[
          styles.root,
          // Modal native katmanda açıldığından SafeAreaView devre dışı; inset'leri
          // kendimiz uygularız.
          { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 },
        ]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          {/* Başlık çubuğu */}
          <View style={styles.head}>
            <Text style={styles.title}>PROFİL</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {/* Kimlik: avatar + ad + kupa rozeti */}
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {signedIn ? (
              <View style={styles.trophy}>
                <Feather name="award" size={13} color={colors.amber} />
                {loading ? (
                  <Skel width={34} />
                ) : (
                  <Text style={styles.trophyText}>
                    {data ? `${data.rating}  ·  #${data.rank}` : '—'}
                  </Text>
                )}
              </View>
            ) : null}
          </View>

          {/* Seviye (XP ilerlemesi) + unvan + Veri — yalnızca sunucudan gelir.
              Seviye 8-10 (elit) altın tonu + güçlü parıltıyla ayrışır. */}
          {signedIn && !error ? (
            <View style={styles.progress}>
              <View style={styles.progressHead}>
                {loading ? (
                  <Skel width={120} />
                ) : (
                  <View style={styles.levelWrap}>
                    <Text style={styles.levelNum}>SEVİYE {data?.level ?? 1}</Text>
                    <Text
                      style={[styles.levelTitle, elite && styles.levelTitleElite]}
                      numberOfLines={1}>
                      {levelTitle(data?.level ?? 1)}
                    </Text>
                  </View>
                )}
                {loading ? (
                  <Skel width={56} />
                ) : (
                  <View style={styles.veriChip}>
                    <Feather name="database" size={11} color={colors.cyan} />
                    <Text style={styles.veriText}>{data?.veri ?? 0} VERİ</Text>
                  </View>
                )}
              </View>
              <View style={[styles.barTrack, elite && styles.barTrackElite]}>
                <View
                  style={[
                    styles.barFill,
                    elite && styles.barFillElite,
                    { width: `${Math.round(levelPct * 100)}%` },
                  ]}
                />
              </View>
              {!loading && data ? (
                <Text style={styles.barLabel}>
                  {data.levelNext == null
                    ? 'MAKS SEVİYE'
                    : `${data.xp - data.levelFloor} / ${data.levelNext - data.levelFloor} XP`}
                </Text>
              ) : null}
            </View>
          ) : null}

          {!signedIn ? (
            // Oturum yok: istatistikler online'a bağlı.
            <View style={styles.signedOut}>
              <Feather name="lock" size={22} color={colors.dim} />
              <Text style={styles.signedOutText}>
                İstatistikler çevrimiçi maçlardan gelir.{'\n'}Görmek için giriş yapmalısın.
              </Text>
            </View>
          ) : error ? (
            <View style={styles.signedOut}>
              <Feather name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => void load()} style={styles.retry}>
                <Text style={styles.retryText}>Tekrar Dene</Text>
              </Pressable>
            </View>
          ) : (
            // 2x2 istatistik kutuları (yüklenirken iskelet)
            <View style={styles.grid}>
              {boxes.map((b) => (
                <View key={b.label} style={styles.box}>
                  <Feather name={b.icon} size={15} color={colors.cyan} style={styles.boxIcon} />
                  {loading ? (
                    <Skel width={44} />
                  ) : (
                    <Text style={styles.boxValue}>{b.value}</Text>
                  )}
                  <Text style={styles.boxLabel}>{b.label}</Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(5,8,15,0.72)',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  card: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.bgMid,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 30px ${cyanAlpha(0.12)}`,
    paddingBottom: 20,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  title: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.4),
    textShadowRadius: 12,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identity: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 20,
    paddingBottom: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.glass,
    borderWidth: 2,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 18px ${cyanAlpha(0.45)}`,
  },
  avatarText: {
    color: colors.cyan,
    fontSize: 26,
    fontWeight: '800',
    fontFamily: mono,
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '800',
    maxWidth: '80%',
  },
  trophy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.32),
  },
  trophyText: {
    color: colors.amber,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  progress: {
    gap: 7,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  progressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  levelWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flexShrink: 1,
  },
  levelNum: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.dim,
    fontFamily: mono,
  },
  levelTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: colors.ice,
    fontFamily: mono,
    flexShrink: 1,
  },
  levelTitleElite: {
    color: colors.gold,
    textShadowColor: withAlpha(colors.gold, 0.7),
    textShadowRadius: 12,
  },
  veriChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: cyanAlpha(0.1),
    borderWidth: 1,
    borderColor: cyanAlpha(0.3),
  },
  veriText: {
    color: colors.cyan,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  barTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 10px ${cyanAlpha(0.5)}`,
  },
  barTrackElite: {
    borderColor: withAlpha(colors.gold, 0.35),
  },
  barFillElite: {
    backgroundColor: colors.gold,
    boxShadow: `0 0 16px ${withAlpha(colors.gold, 0.7)}`,
  },
  barLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'right',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 16,
  },
  box: {
    // 2 sütun: gap 10 → her kutu yarı genişlikten gap payı düşer.
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  boxIcon: {
    marginBottom: 2,
  },
  boxValue: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
  },
  boxLabel: {
    fontSize: 9,
    letterSpacing: 1.2,
    color: colors.dim,
    fontFamily: mono,
  },
  skel: {
    height: 18,
    borderRadius: 6,
    backgroundColor: cyanAlpha(0.3),
  },
  signedOut: {
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 18,
  },
  signedOutText: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  retry: {
    marginTop: 4,
    paddingVertical: 9,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  retryText: {
    color: colors.cyan,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
});
