import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getLeaderboard,
  getMyRank,
  OnlineError,
  type LeaderboardEntry,
  type MyRank,
} from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const initialOf = (name: string | null) => (name?.trim()?.[0] ?? 'O').toUpperCase();
const displayName = (name: string | null) => name?.trim() || 'Oyuncu';

/** Amber kupa puanı (Feather award — platformlar arası tutarlı, emoji yerine). */
function Rating({ value }: { value: number }) {
  return (
    <View style={styles.rating}>
      <Feather name="award" size={13} color={colors.amber} />
      <Text style={styles.ratingText}>{value}</Text>
    </View>
  );
}

function Avatar({ initial, size, bg, glow }: { initial: string; size: number; bg: string; glow?: string }) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        glow ? { boxShadow: `0 0 14px ${glow}` } : null,
      ]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

/** Podyum basamağı (1. büyük + taç). entry yoksa boş yer tutucu. */
function Pod({ entry, place }: { entry: LeaderboardEntry | undefined; place: 1 | 2 | 3 }) {
  if (!entry) return <View style={styles.pod} />;
  const medal = place === 1 ? colors.gold : place === 2 ? colors.silver : colors.bronze;
  const size = place === 1 ? 62 : 50;
  const baseH = place === 1 ? 46 : place === 2 ? 34 : 26;
  return (
    <View style={styles.pod}>
      {place === 1 ? <Text style={styles.crown}>👑</Text> : null}
      <Avatar initial={initialOf(entry.username)} size={size} bg={medal} glow={withAlpha(medal, 0.5)} />
      <Text style={styles.podName} numberOfLines={1}>
        {displayName(entry.username)}
      </Text>
      <Rating value={entry.rating} />
      <View style={[styles.podBase, { height: baseH }, place === 1 && styles.podBaseFirst]}>
        <Text style={[styles.podBaseNum, place === 1 && { color: colors.gold }]}>{place}</Text>
      </View>
    </View>
  );
}

/** Lider tablosu modali: podyum (top3) + kaydırılır liste (4+) + sabit "SEN". */
export function LeaderboardModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [board, setBoard] = useState<LeaderboardEntry[] | null>(null);
  const [me, setMe] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pop = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setError(null);
    try {
      const [lb, mine] = await Promise.all([getLeaderboard(), getMyRank()]);
      setBoard(lb);
      setMe(mine);
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Lider tablosu yüklenemedi.');
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.timing(pop, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [visible, load, pop]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const top3 = board?.slice(0, 3) ?? [];
  const rest = board?.slice(3) ?? [];
  const cardStyle = {
    opacity: pop,
    transform: [
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          {/* Başlık */}
          <View style={styles.head}>
            <View style={styles.trophy}>
              <Feather name="award" size={18} color={colors.amber} />
            </View>
            <Text style={styles.title}>LİDER TABLOSU</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.cyan} />
              <Text style={styles.muted}>Yükleniyor…</Text>
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Feather name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.errorText} selectable>
                {error}
              </Text>
              <Pressable onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} style={styles.retry}>
                <Text style={styles.retryText}>Tekrar Dene</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.podium}>
                <Pod entry={top3[1]} place={2} />
                <Pod entry={top3[0]} place={1} />
                <Pod entry={top3[2]} place={3} />
              </View>

              <FlatList
                style={styles.list}
                data={rest}
                keyExtractor={(item) => item.userId}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={
                  <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.cyan} />
                }
                renderItem={({ item, index }) => (
                  <View style={[styles.row, index % 2 === 1 && styles.rowEven]}>
                    <Text style={styles.rowRank}>{item.rank}</Text>
                    <Avatar initial={initialOf(item.username)} size={34} bg={colors.cyanDeep} />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {displayName(item.username)}
                    </Text>
                    <Rating value={item.rating} />
                  </View>
                )}
                ListEmptyComponent={<Text style={styles.muted}>Henüz sıralama yok</Text>}
              />

              {/* Sabit "SEN" satırı */}
              {me ? (
                <View style={styles.meWrap}>
                  <View style={styles.meRow}>
                    <Text style={[styles.rowRank, styles.meRank]}>{me.rank}</Text>
                    <Avatar
                      initial={initialOf(me.username)}
                      size={34}
                      bg={colors.cyan}
                      glow={cyanAlpha(0.5)}
                    />
                    <Text style={styles.rowName} numberOfLines={1}>
                      {displayName(me.username)} <Text style={styles.meTag}>· SEN</Text>
                    </Text>
                    <Rating value={me.rating} />
                  </View>
                </View>
              ) : null}
            </>
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
  },
  card: {
    position: 'absolute',
    left: 14,
    right: 14,
    top: 60,
    bottom: 36,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.bgMid,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    boxShadow: `0 24px 60px rgba(0,0,0,0.55), 0 0 30px ${cyanAlpha(0.12)}`,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  trophy: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: withAlpha(colors.amber, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 12px ${withAlpha(colors.amber, 0.3)}`,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  muted: {
    color: colors.dim,
    fontSize: 12,
    fontFamily: mono,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  retry: {
    marginTop: 6,
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
  // Podyum
  podium: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 10,
  },
  pod: {
    flex: 1,
    maxWidth: 104,
    alignItems: 'center',
    gap: 6,
  },
  crown: {
    fontSize: 16,
    marginBottom: -4,
  },
  podName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    maxWidth: 96,
  },
  podBase: {
    width: '100%',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    paddingTop: 6,
  },
  podBaseFirst: {
    backgroundColor: withAlpha(colors.gold, 0.16),
  },
  podBaseNum: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
  },
  // Liste
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 5,
    backgroundColor: 'rgba(255,255,255,0.022)',
  },
  rowEven: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rowRank: {
    width: 26,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
  },
  rowName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '800',
    color: '#0a1428',
    fontFamily: mono,
  },
  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.amber,
    fontFamily: mono,
  },
  // SEN
  meWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    backgroundColor: cyanAlpha(0.06),
  },
  meRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.45),
    backgroundColor: cyanAlpha(0.14),
    boxShadow: `0 0 16px ${cyanAlpha(0.2)}`,
  },
  meRank: {
    color: colors.cyan,
  },
  meTag: {
    fontSize: 9,
    letterSpacing: 1,
    color: colors.cyan,
    fontWeight: '800',
  },
});
