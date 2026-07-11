import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getRecentMatches, OnlineError, type RecentMatch, type RecentMatchRound } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const MODE_META = {
  hizli: { label: 'Hızlı', color: colors.cyan },
  kelime: { label: 'Kelime', color: colors.amber },
  protokol: { label: 'Protokol', color: colors.violet },
} as const;

function modeKey(m: RecentMatch): keyof typeof MODE_META {
  if (m.contentType === 'word') return 'kelime';
  if (m.mode === 'protocol') return 'protokol';
  return 'hizli';
}

function reasonLabel(result: RecentMatch['result']): string {
  if (result === 'win') return 'doğru tahmin';
  if (result === 'timeout') return 'süre doldu';
  if (result === 'forfeit') return 'terk';
  return '';
}

/** Bir gizliyi (sayı ya da kelime) tile dizisine böler. Kazananınki altın vurgulu. */
function Tiles({ value, win }: { value: string | null; win: boolean }) {
  const chars = (value ?? '').toUpperCase().split('');
  return (
    <View style={styles.tiles}>
      {chars.map((c, i) => (
        <View key={i} style={[styles.tile, win && styles.tileWin]}>
          <Text style={[styles.tileText, win && styles.tileTextWin]}>{c}</Text>
        </View>
      ))}
    </View>
  );
}

function RoundRow({ r }: { r: RecentMatchRound }) {
  const p1Win = r.winner === 1;
  const p2Win = r.winner === 2;
  return (
    <View style={styles.round}>
      <View style={[styles.secret, styles.s1]}>
        {p1Win ? <Text style={styles.rt}>🏆</Text> : null}
        <Tiles value={r.p1Secret} win={p1Win} />
      </View>
      <Text style={styles.turn}>Tur {r.round}</Text>
      <View style={[styles.secret, styles.s2]}>
        <Tiles value={r.p2Secret} win={p2Win} />
        {p2Win ? <Text style={styles.rt}>🏆</Text> : null}
      </View>
    </View>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <Text style={[styles.delta, up ? styles.deltaUp : styles.deltaDown]}>
      {up ? '+' : '−'}
      {Math.abs(value)} 🏆
    </Text>
  );
}

function MatchCard({ m }: { m: RecentMatch }) {
  const meta = MODE_META[modeKey(m)];
  const p1Won = m.p1Won;
  return (
    <View style={styles.match}>
      <View style={styles.matchHead}>
        <View style={[styles.player, styles.pRight]}>
          <Text style={[styles.name, p1Won ? styles.nameWin : styles.nameLose]} numberOfLines={1}>
            {m.player1Name ?? 'Rakip'}
          </Text>
          <Delta value={m.p1RatingDelta} />
        </View>
        <View style={styles.center}>
          <Text style={[styles.mode, { color: meta.color, backgroundColor: withAlpha(meta.color, 0.13) }]}>
            {meta.label}
          </Text>
          {m.winTarget > 1 ? (
            <Text style={styles.tally}>
              {m.p1RoundWins}–{m.p2RoundWins}
            </Text>
          ) : null}
          <Text style={styles.reason}>{reasonLabel(m.result)}</Text>
        </View>
        <View style={[styles.player, styles.pLeft]}>
          <Text style={[styles.name, !p1Won ? styles.nameWin : styles.nameLose]} numberOfLines={1}>
            {m.player2Name ?? 'Rakip'}
          </Text>
          <Delta value={m.p2RatingDelta} />
        </View>
      </View>
      <View style={styles.reveal}>
        {m.rounds.map((r) => (
          <RoundRow key={r.round} r={r} />
        ))}
      </View>
    </View>
  );
}

/** Global "Son Maçlar" akışı — ana menü butonundan açılan liderlik-tarzı modal. */
export function RecentMatchesModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [matches, setMatches] = useState<RecentMatch[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const pop = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    setError(null);
    try {
      setMatches(await getRecentMatches());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Son maçlar yüklenemedi.');
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

  const cardStyle = {
    opacity: pop,
    transform: [
      { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View style={[styles.card, cardStyle]}>
          <View style={styles.head}>
            <View style={styles.headIcon}>
              <Feather name="activity" size={17} color={colors.cyan} />
            </View>
            <Text style={styles.title}>SON MAÇLAR</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <Feather name="x" size={16} color={colors.dim} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator color={colors.cyan} />
              <Text style={styles.muted}>Yükleniyor…</Text>
            </View>
          ) : error ? (
            <View style={styles.centerBox}>
              <Feather name="alert-circle" size={22} color={colors.danger} />
              <Text style={styles.errorText} selectable>
                {error}
              </Text>
              <Pressable
                onPress={() => {
                  setLoading(true);
                  load().finally(() => setLoading(false));
                }}
                style={styles.retry}>
                <Text style={styles.retryText}>Tekrar Dene</Text>
              </Pressable>
            </View>
          ) : (matches?.length ?? 0) === 0 ? (
            <View style={styles.centerBox}>
              <Text style={styles.muted}>Henüz maç oynanmadı.</Text>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={matches ?? []}
              keyExtractor={(m) => m.matchId}
              renderItem={({ item }) => <MatchCard m={item} />}
              contentContainerStyle={styles.listBody}
              showsVerticalScrollIndicator={false}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(3,7,18,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  card: {
    // İçeriğe sarılan, sınırı olan kutu (LeaderboardModal deseni): kısa listede
    // kompakt, uzun listede maxHeight'e dayanıp liste kayar. minHeight belirli bir
    // taban verir; list flexGrow:0/flexShrink:1 olduğu için liste doğru render olur
    // (flex:1 + maxHeight kombinasyonu listeyi 0'a çökertip GÖRÜNMEZ yapıyordu).
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    minHeight: 320,
    backgroundColor: colors.bgMid,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
  },
  headIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cyanAlpha(0.13),
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
  },
  title: { flex: 1, color: colors.ice, fontSize: 14, fontWeight: '800', letterSpacing: 2.5, fontFamily: mono },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  muted: { color: colors.dim, fontSize: 13, fontFamily: mono },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  retry: {
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  retryText: { color: colors.cyan, fontSize: 13, fontWeight: '700', fontFamily: mono },
  // Büyümez, gerekirse küçülür (LeaderboardModal deseni): kısa içerikte kart
  // içeriğe sarılır; uzun içerikte kart maxHeight'e dayanınca liste kayar.
  list: { flexGrow: 0, flexShrink: 1 },
  listBody: { padding: 12, gap: 12 },

  match: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    padding: 13,
    paddingBottom: 6,
  },
  matchHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 11 },
  player: { flex: 1, gap: 3, minWidth: 0 },
  pRight: { alignItems: 'flex-end' },
  pLeft: { alignItems: 'flex-start' },
  name: { fontSize: 14, fontWeight: '700', maxWidth: '100%' },
  nameWin: { color: colors.ice, textShadowColor: cyanAlpha(0.4), textShadowRadius: 12 },
  nameLose: { color: colors.dim },
  delta: { fontSize: 11, fontWeight: '800', fontFamily: mono, letterSpacing: 0.3 },
  deltaUp: { color: colors.success },
  deltaDown: { color: colors.danger },
  center: { alignItems: 'center', gap: 3, paddingHorizontal: 8 },
  mode: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    fontFamily: mono,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
    textTransform: 'uppercase',
  },
  tally: { fontSize: 17, fontWeight: '800', color: colors.text, fontFamily: mono, letterSpacing: 1 },
  reason: { fontSize: 9.5, color: colors.dim, letterSpacing: 0.4 },

  reveal: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)', borderStyle: 'dashed' },
  round: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  secret: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  s1: { justifyContent: 'flex-end' },
  s2: { justifyContent: 'flex-start' },
  rt: { fontSize: 12 },
  turn: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tiles: { flexDirection: 'row', gap: 4 },
  tile: {
    minWidth: 20,
    height: 24,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  tileWin: { borderColor: withAlpha(colors.gold, 0.55), backgroundColor: withAlpha(colors.gold, 0.1) },
  tileText: { fontSize: 13, fontWeight: '800', color: colors.dim, fontFamily: mono },
  tileTextWin: { color: colors.ice },
});
