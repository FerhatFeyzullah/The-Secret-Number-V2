import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/auth';
import {
  cancelClanRequest,
  getMyClan,
  getMyClanRequests,
  OnlineError,
  type Clan,
  type ClanCard,
} from '@/online';
import { Screen, TAB_EDGES } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { ChoiceCard } from '../parts';
import { ClanBrowse } from './clan-browse';
import { ClanChat } from './clan-chat';
import { ClanCreate } from './clan-create';
import { ClanHome } from './clan-home';
import { ClanLeaderboard } from './clan-leaderboard';
import { ClanEmblemView } from './emblem';

// 'none' klandayken = sohbet; 'members' = üye/yönetim ekranı.
type SubView = 'none' | 'browse' | 'create' | 'leaderboard' | 'members';

/** Klan sekmesi (/clan) — Faz 1 iskelet. Klanda ise ana ekran; değilse kur/gözat. */
export function ClanScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const myId = session?.user.id ?? '';

  const [clan, setClan] = useState<Clan | null>(null);
  const [myRequests, setMyRequests] = useState<ClanCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<SubView>('none');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (spinner: boolean) => {
      if (!session) {
        setLoading(false);
        return;
      }
      if (spinner) setLoading(true);
      setError(null);
      try {
        const c = await getMyClan();
        setClan(c);
        setMyRequests(c ? [] : await getMyClanRequests());
      } catch (e) {
        setError(e instanceof OnlineError ? e.message : 'Klan yüklenemedi.');
      } finally {
        if (spinner) setLoading(false);
      }
    },
    [session],
  );

  const loadedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setLoading(false);
        return;
      }
      if (!loadedRef.current) {
        loadedRef.current = true;
        void load(true);
      } else {
        void load(false);
      }
    }, [session, load]),
  );

  const cancel = (id: string) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await cancelClanRequest(id);
        await load(false);
      } catch {
        // sessiz
      } finally {
        setBusy(false);
      }
    })();
  };

  // ── Oturum kapısı ──
  if (!session) {
    return (
      <Screen edges={TAB_EDGES}>
        <View style={styles.gate}>
          <Feather name="lock" size={26} color={colors.dim} />
          <Text style={styles.gateText}>Klanlar hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.</Text>
          <Pressable onPress={() => router.push({ pathname: '/auth', params: { next: '/clan' } })} style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>Giriş Yap</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // ── Lider tablosu (klanda olsun olmasın) ──
  if (view === 'leaderboard') {
    return (
      <Screen edges={TAB_EDGES}>
        <ClanLeaderboard myClanId={clan?.id ?? null} onBack={() => setView('none')} />
      </Screen>
    );
  }

  // ── Klandaysa: sohbet (varsayılan) ya da üye/yönetim ──
  if (clan) {
    if (view === 'members') {
      return (
        <Screen edges={TAB_EDGES}>
          <ClanHome
            clan={clan}
            myId={myId}
            onReload={() => load(false)}
            onLeaderboard={() => setView('leaderboard')}
            onBack={() => setView('none')}
            onExit={() => {
              setClan(null);
              setView('none');
              void load(false);
            }}
          />
        </Screen>
      );
    }
    return (
      <Screen edges={TAB_EDGES}>
        <ClanChat clan={clan} myId={myId} onOpenMembers={() => setView('members')} />
      </Screen>
    );
  }

  // ── Klanda değilse: alt akışlar ──
  if (view === 'create') {
    return (
      <Screen edges={TAB_EDGES}>
        <ClanCreate onBack={() => setView('none')} onCreated={(c) => { setClan(c); setView('none'); }} />
      </Screen>
    );
  }
  if (view === 'browse') {
    return (
      <Screen edges={TAB_EDGES}>
        <ClanBrowse onBack={() => setView('none')} onJoined={(c) => { setClan(c); setView('none'); }} />
      </Screen>
    );
  }

  // ── Klanda değil, ana giriş ──
  return (
    <Screen edges={TAB_EDGES}>
      {loading ? (
        <View style={styles.gate}>
          <ActivityIndicator color={colors.cyan} />
        </View>
      ) : error ? (
        <View style={styles.gate}>
          <Feather name="alert-circle" size={24} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void load(true)} style={styles.gateBtn}>
            <Text style={styles.gateBtnText}>Tekrar Dene</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <View style={styles.hero}>
            <ClanEmblemView emblem={{ shape: 'shield', icon: 'hash', color: 'cyan' }} size={72} />
            <Text style={styles.heroTitle}>KLANLAR</Text>
            <Text style={styles.heroSub}>Bir klana katıl ya da kendi klanını kur; birlikte tırmanın.</Text>
          </View>

          <ChoiceCard
            icon="flag"
            accent={colors.cyan}
            title="Klan Kur"
            subtitle="Kendi klanını oluştur · Sv.3+ ve 1000 Veri"
            onPress={() => setView('create')}
          />
          <ChoiceCard
            icon="search"
            accent={colors.teal}
            title="Klanlara Göz At"
            subtitle="Klan ara ve katıl"
            onPress={() => setView('browse')}
          />
          <ChoiceCard
            icon="bar-chart-2"
            accent={colors.amber}
            title="Klan Sıralaması"
            subtitle="En güçlü klanları gör"
            onPress={() => setView('leaderboard')}
          />

          {myRequests.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>BEKLEYEN İSTEKLER · {myRequests.length}</Text>
              {myRequests.map((c) => (
                <View key={c.id} style={styles.pendingRow}>
                  <ClanEmblemView emblem={c.emblem} size={38} glow={false} />
                  <View style={styles.pendingInfo}>
                    <Text style={styles.pendingName} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={styles.pendingMeta}>Onay bekleniyor</Text>
                  </View>
                  <Pressable onPress={() => cancel(c.id)} disabled={busy} hitSlop={8} style={styles.cancelBtn}>
                    <Feather name="x" size={16} color={colors.danger} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  gateText: { color: colors.dim, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  errorText: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  gateBtn: {
    marginTop: 6, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 12,
    borderWidth: 1, borderColor: cyanAlpha(0.4), backgroundColor: cyanAlpha(0.12),
  },
  gateBtnText: { color: colors.cyan, fontWeight: '800', fontFamily: mono, letterSpacing: 1 },
  scroll: { paddingBottom: 28, gap: 14 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 18, paddingBottom: 8 },
  heroTitle: {
    fontFamily: mono, fontSize: 22, fontWeight: '900', letterSpacing: 3, color: colors.ice,
    textShadowColor: colors.cyan, textShadowRadius: 14,
  },
  heroSub: { textAlign: 'center', color: colors.dim, fontSize: 13, lineHeight: 20, maxWidth: 280 },
  section: { gap: 8, marginTop: 4 },
  sectionLabel: { fontFamily: mono, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, color: colors.dim },
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 14,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  pendingInfo: { flex: 1, gap: 2 },
  pendingName: { fontSize: 14, fontWeight: '700', color: colors.text },
  pendingMeta: { fontSize: 11, color: colors.amber, fontFamily: mono },
  cancelBtn: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: withAlpha(colors.danger, 0.1), borderWidth: 1, borderColor: withAlpha(colors.danger, 0.3),
  },
});
