import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getClanLeaderboard, OnlineError, type ClanLeaderboardEntry } from '@/online';
import { colors, cyanAlpha, mono } from '@/ui/theme';
import { ClanEmblemView } from './emblem';

function rankColor(rank: number): string {
  if (rank === 1) return colors.gold;
  if (rank === 2) return colors.silver;
  if (rank === 3) return colors.bronze;
  return colors.dim;
}

/** Klan lider tablosu: skor = üye Kupa toplamı, global ilk 50. */
export function ClanLeaderboard({
  myClanId,
  onBack,
}: {
  myClanId: string | null;
  onBack: () => void;
}) {
  const [rows, setRows] = useState<ClanLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getClanLeaderboard());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Sıralama yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Feather name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>KLAN SIRALAMASI</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={24} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={styles.retryText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="award" size={24} color={colors.dim} />
          <Text style={styles.emptyText}>Henüz klan yok.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
          {rows.map((r) => {
            const mine = r.id === myClanId;
            const rc = rankColor(r.rank);
            return (
              <View key={r.id} style={[styles.row, mine && styles.rowMine]}>
                <Text style={[styles.rank, { color: rc }]}>{r.rank}</Text>
                <ClanEmblemView emblem={r.emblem} size={40} glow={false} />
                <View style={styles.info}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.tag}>[{r.tag}]</Text>
                    {mine ? <Text style={styles.mineBadge}>SEN</Text> : null}
                  </View>
                  <Text style={styles.members}>{r.memberCount}/30 üye</Text>
                </View>
                <View style={styles.scoreBox}>
                  <Feather name="award" size={12} color={colors.amber} />
                  <Text style={styles.score}>{r.score}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10, marginBottom: 8 },
  backBtn: {
    width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  title: {
    flex: 1, textAlign: 'center', fontSize: 14, fontWeight: '800', letterSpacing: 2,
    color: colors.ice, fontFamily: mono, textShadowColor: cyanAlpha(0.5), textShadowRadius: 10,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 40 },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  emptyText: { color: colors.dim, fontSize: 14 },
  retry: {
    marginTop: 6, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12,
    borderWidth: 1, borderColor: cyanAlpha(0.4), backgroundColor: cyanAlpha(0.12),
  },
  retryText: { color: colors.cyan, fontWeight: '800', fontFamily: mono, letterSpacing: 1 },
  list: { paddingBottom: 28, gap: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: 14, backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  rowMine: { borderColor: cyanAlpha(0.5), backgroundColor: cyanAlpha(0.1) },
  rank: { width: 26, textAlign: 'center', fontSize: 15, fontWeight: '900', fontFamily: mono },
  info: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: colors.text, fontFamily: mono },
  tag: { fontSize: 11, fontWeight: '800', color: colors.cyan, fontFamily: mono },
  mineBadge: {
    fontSize: 8, fontWeight: '800', color: colors.cyan, fontFamily: mono, letterSpacing: 1,
    borderWidth: 1, borderColor: cyanAlpha(0.4), borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1,
  },
  members: { fontSize: 11, color: colors.dim, fontFamily: mono },
  scoreBox: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  score: { fontSize: 14, fontWeight: '900', color: colors.amber, fontFamily: mono },
});
