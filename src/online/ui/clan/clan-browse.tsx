import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { joinClan, listClans, OnlineError, type Clan, type ClanCard } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { ClanEmblemView } from './emblem';
import { joinModeLabel } from './roles';

/** Klanlara göz at: arama + kart listesi + katıl/istek. */
export function ClanBrowse({
  onBack,
  onJoined,
}: {
  onBack: () => void;
  onJoined: (clan: Clan) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      setResults(await listClans(q));
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Klanlar yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const join = async (card: ClanCard) => {
    if (busyId) return;
    setBusyId(card.id);
    setError(null);
    try {
      const res = await joinClan(card.id);
      if (res.status === 'joined' && res.clan) {
        onJoined(res.clan);
      } else {
        setRequested((prev) => new Set(prev).add(card.id));
      }
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Katılınamadı, tekrar dene.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
          <Feather name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>KLANLARA GÖZ AT</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchRow}>
        <Feather name="search" size={16} color={colors.dim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(query.trim())}
          returnKeyType="search"
          placeholder="Klan adı veya etiket…"
          placeholderTextColor={withAlpha(colors.dim, 0.6)}
          style={styles.searchInput}
        />
        {query ? (
          <Pressable onPress={() => { setQuery(''); void load(''); }} hitSlop={8}>
            <Feather name="x" size={16} color={colors.dim} />
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <Feather name="search" size={24} color={colors.dim} />
          <Text style={styles.emptyText}>Klan bulunamadı.</Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {results.map((c) => {
            const isRequested = requested.has(c.id);
            const full = c.memberCount >= 30;
            return (
              <View key={c.id} style={styles.card}>
                <ClanEmblemView emblem={c.emblem} size={46} />
                <View style={styles.cardInfo}>
                  <View style={styles.cardNameRow}>
                    <Text style={styles.cardName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.cardTag}>[{c.tag}]</Text>
                  </View>
                  <View style={styles.cardMeta}>
                    <Text style={styles.cardMetaText}>{c.memberCount}/30</Text>
                    <Text style={styles.cardDot}>·</Text>
                    <Text style={styles.cardMetaText}>{joinModeLabel(c.joinMode)}</Text>
                    {c.minTrophies > 0 ? (
                      <>
                        <Text style={styles.cardDot}>·</Text>
                        <Feather name="award" size={10} color={colors.amber} />
                        <Text style={styles.cardMetaText}>{c.minTrophies}+</Text>
                      </>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  onPress={() => void join(c)}
                  disabled={busyId === c.id || isRequested || (full && c.joinMode === 'open')}
                  style={[
                    styles.joinBtn,
                    c.joinMode === 'approval' && styles.joinBtnApproval,
                    (isRequested || (full && c.joinMode === 'open')) && styles.joinBtnOff,
                  ]}>
                  {busyId === c.id ? (
                    <ActivityIndicator color={colors.ice} size="small" />
                  ) : (
                    <Text style={styles.joinText}>
                      {isRequested ? 'Gönderildi' : full && c.joinMode === 'open' ? 'Dolu' : c.joinMode === 'approval' ? 'İstek' : 'Katıl'}
                    </Text>
                  )}
                </Pressable>
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: colors.glassBorder,
    marginBottom: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, padding: 0 },
  error: { color: colors.danger, fontSize: 12, textAlign: 'center', marginBottom: 10 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { color: colors.dim, fontSize: 14 },
  list: { paddingBottom: 28, gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  cardInfo: { flex: 1, gap: 4 },
  cardNameRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  cardName: { flexShrink: 1, fontSize: 15, fontWeight: '800', color: colors.text, fontFamily: mono },
  cardTag: { fontSize: 11, fontWeight: '800', color: colors.cyan, fontFamily: mono },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardMetaText: { fontSize: 11, color: colors.dim, fontFamily: mono },
  cardDot: { color: colors.dim, fontSize: 11 },
  joinBtn: {
    paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12, minWidth: 74, alignItems: 'center',
    borderWidth: 1.5, borderColor: cyanAlpha(0.55), backgroundColor: cyanAlpha(0.18),
  },
  joinBtnApproval: { borderColor: withAlpha(colors.amber, 0.5), backgroundColor: withAlpha(colors.amber, 0.15) },
  joinBtnOff: { borderColor: 'rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.04)' },
  joinText: { fontSize: 12, fontWeight: '800', color: colors.ice, fontFamily: mono, letterSpacing: 0.5 },
});
