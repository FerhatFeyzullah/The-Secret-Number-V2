import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { getMyRank, OnlineError, unlockSignal, type MyRank } from '@/online';
import { SIGNALS, type Signal } from '@/signals/catalog';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

type FeatherName = keyof typeof Feather.glyphMap;

/** Mağaza sekmeleri — şimdilik yalnız Sinyaller dolu; yapı çok-kategorili
 *  (ileride temalar/çerçeveler vb. eklenebilir). */
type TabKey = 'signals';
const TABS: { key: TabKey; label: string; icon: FeatherName }[] = [
  { key: 'signals', label: 'SİNYALLER', icon: 'message-circle' },
];

const STORE_INTRO: InfoSection[] = [
  {
    icon: 'message-circle',
    accent: colors.cyan,
    title: 'Sinyal Nedir?',
    body: 'Maç sonunda rakibine gönderdiğin tepki (kupa, kahkaha, sinsi…). Tamamen kozmetik — oyunu etkilemez.',
  },
  {
    icon: 'shopping-bag',
    accent: colors.teal,
    title: 'Nasıl Alınır?',
    body: 'Veri ile satın alınır. Veri’yi çevrimiçi maç kazanarak biriktirirsin.',
  },
  {
    icon: 'layers',
    accent: colors.violet,
    title: 'Destene Ekle',
    body: 'Aldığın sinyalleri “Sinyallerim” destene (en çok 6) ekleyip maç sonunda kullanırsın.',
  },
];

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'İşlem başarısız, tekrar dene.';
const fmtVeri = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Sinyal Mağazası: sekmeli, Veri ile satın alma (unlock_signal — sunucu otoriteli). */
export function StoreScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('signals');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await getMyRank());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Mağaza yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
    else setLoading(false);
  }, [session, load]);

  // İlk-kez tanıtım (flicker-safe): bayrak gelene kadar açılmaz.
  const [introVisible, setIntroVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seen = await getSeen('storeIntro');
      if (alive && !seen) setIntroVisible(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const openIntro = useCallback(() => setIntroVisible(true), []);
  const closeIntro = useCallback(() => {
    setIntroVisible(false);
    void markSeen('storeIntro');
  }, []);

  const owned = data?.ownedSignals ?? [];
  const veri = data?.veri ?? 0;
  const selected = selectedId ? SIGNALS.find((s) => s.id === selectedId) ?? null : null;
  const selectedOwned = selected ? owned.includes(selected.id) : false;
  const selectedAfford = selected ? veri >= selected.veriCost : false;

  const closeDialog = useCallback(() => {
    setSelectedId(null);
    setActionError(null);
  }, []);

  const buy = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await unlockSignal(selected.id);
      setData((d) => (d ? { ...d, veri: res.veri, ownedSignals: res.ownedSignals } : d));
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.iconBtn}>
        <Feather name="arrow-left" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.title}>MAĞAZA</Text>
      <View style={styles.headerRight}>
        <Pressable onPress={openIntro} hitSlop={10} style={styles.help}>
          <Feather name="help-circle" size={17} color={colors.cyan} />
        </Pressable>
        {session && data ? (
          <View style={styles.veriBalance}>
            <Feather name="hexagon" size={12} color={colors.teal} />
            <Text style={styles.veriText}>{fmtVeri(veri)}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  let body;
  if (!session) {
    body = (
      <View style={styles.centered}>
        <Feather name="lock" size={26} color={colors.dim} />
        <Text style={styles.centeredText}>Mağaza hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.</Text>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { next: '/store' } })}
          style={styles.signInBtn}>
          <Text style={styles.signInText}>Giriş Yap</Text>
        </Pressable>
      </View>
    );
  } else if (loading) {
    body = (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.cyan} />
      </View>
    );
  } else if (error) {
    body = (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={24} color={colors.danger} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable onPress={() => void load()} style={styles.signInBtn}>
          <Text style={styles.signInText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Sekme çubuğu (çok-kategorili yapı; şimdilik 1 dolu) */}
        <View style={styles.tabs}>
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tab, active && styles.tabActive]}>
                <Feather name={t.icon} size={14} color={active ? colors.cyan : colors.dim} />
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'signals' ? (
          <View style={styles.grid}>
            {SIGNALS.map((s) => {
              const Icon = s.component;
              const isOwned = owned.includes(s.id);
              const afford = veri >= s.veriCost;
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSelectedId(s.id)}
                  style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
                  {/* Izgarada statik (perf); önizlemede tam animasyon */}
                  <Icon size={56} animated={false} />
                  <Text style={styles.cardName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  {isOwned ? (
                    <View style={[styles.badge, styles.badgeOwned]}>
                      <Feather name="check" size={10} color={colors.success} />
                      <Text style={[styles.badgeText, { color: colors.success }]}>Sahipsin</Text>
                    </View>
                  ) : (
                    <View style={[styles.badge, !afford && styles.badgeOff]}>
                      <Feather name="hexagon" size={9} color={afford ? colors.teal : colors.dim} />
                      <Text style={[styles.badgeText, { color: afford ? colors.teal : colors.dim }]}>
                        {s.veriCost}
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <Screen>
      {header}
      {body}

      {selected ? (
        <SignalDialog
          signal={selected}
          owned={selectedOwned}
          afford={selectedAfford}
          busy={busy}
          error={actionError}
          onBuy={buy}
          onClose={closeDialog}
        />
      ) : null}

      <InfoModal
        visible={introVisible}
        onClose={closeIntro}
        title="MAĞAZA"
        icon="shopping-bag"
        accent={colors.cyan}
        sections={STORE_INTRO}
      />
    </Screen>
  );
}

/** Sinyal önizleme + satın alma diyaloğu (büyük animasyonlu ikon). */
function SignalDialog({
  signal,
  owned,
  afford,
  busy,
  error,
  onBuy,
  onClose,
}: {
  signal: Signal;
  owned: boolean;
  afford: boolean;
  busy: boolean;
  error: string | null;
  onBuy: () => void;
  onClose: () => void;
}) {
  const Icon = signal.component;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.dialogRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.dialog} onStartShouldSetResponder={() => true}>
          <View style={[styles.beam, { backgroundColor: colors.cyan }]} />
          <Pressable onPress={onClose} hitSlop={10} style={styles.dialogClose}>
            <Feather name="x" size={16} color={colors.dim} />
          </Pressable>

          <View style={styles.preview}>
            <Icon size={104} animated />
          </View>
          <Text style={styles.previewName}>{signal.name}</Text>

          {owned ? (
            <View style={[styles.ownedBanner]}>
              <Feather name="check" size={15} color={colors.success} />
              <Text style={styles.ownedText}>Bu sinyale sahipsin</Text>
            </View>
          ) : (
            <>
              {error ? <Text style={styles.dialogError}>{error}</Text> : null}
              <Pressable
                onPress={onBuy}
                disabled={!afford || busy}
                style={({ pressed }) => [
                  styles.buyBtn,
                  (!afford || busy) && styles.buyBtnOff,
                  pressed && afford && !busy && styles.buyBtnPressed,
                ]}>
                {busy ? (
                  <ActivityIndicator color={colors.ice} size="small" />
                ) : (
                  <>
                    <Feather name="hexagon" size={15} color={afford ? colors.ice : colors.dim} />
                    <Text style={[styles.buyText, !afford && { color: colors.dim }]}>
                      {afford ? `Satın Al · ${signal.veriCost} Veri` : `Yetersiz Veri · ${signal.veriCost}`}
                    </Text>
                  </>
                )}
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  help: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.4),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.5),
    textShadowRadius: 10,
  },
  veriBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.teal, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.teal, 0.4),
  },
  veriText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  scroll: {
    paddingBottom: 28,
    gap: 16,
  },
  tabs: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  tabActive: {
    borderColor: cyanAlpha(0.5),
    backgroundColor: cyanAlpha(0.12),
  },
  tabText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.dim,
    fontFamily: mono,
  },
  tabTextActive: {
    color: colors.cyan,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 7,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  cardName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.teal, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.teal, 0.32),
  },
  badgeOff: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  badgeOwned: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.35),
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  // ── ortak durumlar ──
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 24,
  },
  centeredText: {
    color: colors.dim,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
  },
  signInBtn: {
    marginTop: 6,
    paddingVertical: 10,
    paddingHorizontal: 22,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  signInText: {
    color: colors.cyan,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 1,
  },
  // ── diyalog ──
  dialogRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    backgroundColor: 'rgba(5,9,18,0.82)',
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.42),
    backgroundColor: 'rgba(10,20,40,0.98)',
    paddingTop: 26,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    overflow: 'hidden',
    boxShadow: `0 18px 48px rgba(0,0,0,0.55), 0 0 30px ${cyanAlpha(0.12)}`,
  },
  beam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  dialogClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    width: 132,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  previewName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 0.5,
    marginTop: 4,
    marginBottom: 16,
  },
  ownedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.4),
    backgroundColor: withAlpha(colors.success, 0.14),
  },
  ownedText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  dialogError: {
    color: colors.danger,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 10,
  },
  buyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    alignSelf: 'stretch',
    paddingVertical: 15,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.2),
    boxShadow: `0 4px 0 ${cyanAlpha(0.25)}`,
  },
  buyBtnOff: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    boxShadow: undefined,
  },
  buyBtnPressed: {
    transform: [{ translateY: 2 }],
    boxShadow: undefined,
  },
  buyText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.ice,
    fontFamily: mono,
  },
});
