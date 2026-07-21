import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { OnlineError, unlockSignal, useRank } from '@/online';
import { SIGNALS, type Signal } from '@/signals/catalog';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen, TAB_EDGES } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const STORE_INTRO: InfoSection[] = [
  {
    icon: 'message-circle',
    accent: colors.cyan,
    title: 'Sinyal Nedir?',
    body: 'Rakibine gönderdiğin tepki (kupa, kahkaha, sinsi…). Hem maç sırasında hem de maç sonunda kullanılır. Tamamen kozmetik — oyunu etkilemez.',
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
    body: 'Aldığın sinyalleri “Donanım” destene (en çok 6) ekleyip maç sırasında ve sonunda kullanırsın.',
  },
];

const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'İşlem başarısız, tekrar dene.';
const fmtVeri = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Sinyal Mağazası (alt sekme). Veri ile satın alma (unlock_signal — sunucu
 *  otoriteli). Sekme olduğu için geri ok yok; odaklanınca Veri sessizce tazelenir. */
export function StoreScreen() {
  const router = useRouter();
  const { session } = useAuth();
  // Ortak rank store — TEK doğruluk kaynağı (bkz. RankProvider). Mağaza artık kendi
  // kopyasını tutmaz: satın alma patch'ler → Ana Ekran/Donanım ANINDA görür.
  const { rank: data, error: rankError, refresh, patch } = useRank();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Route'a dönünce tazele (maç/ayar dönüşü). Pager swipe'ında zaten patch ile güncel.
  useFocusEffect(
    useCallback(() => {
      if (session) void refresh();
    }, [session, refresh]),
  );

  // Rank henüz gelmediyse: hata yoksa spinner, hata varsa tekrar-dene.
  const loading = session && !data && !rankError;
  const loadFailed = session && !data && rankError;

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
  const ownedCount = SIGNALS.filter((s) => owned.includes(s.id)).length;
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
      patch({ veri: res.veri, ownedSignals: res.ownedSignals });
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [selected, patch]);

  const header = (
    <View style={styles.header}>
      <View style={styles.titleWrap}>
        <Feather name="shopping-bag" size={18} color={colors.cyan} />
        <Text style={styles.title}>MAĞAZA</Text>
      </View>
      <View style={styles.headerRight}>
        {session && data ? (
          <View style={styles.veriBalance}>
            <Feather name="hexagon" size={13} color={colors.teal} />
            <Text style={styles.veriText}>{fmtVeri(veri)}</Text>
          </View>
        ) : null}
        <Pressable onPress={openIntro} hitSlop={10} style={styles.help}>
          <Feather name="help-circle" size={17} color={colors.cyan} />
        </Pressable>
      </View>
    </View>
  );

  let body;
  if (!session) {
    body = (
      <View style={styles.centered}>
        <Feather name="lock" size={26} color={colors.dim} />
        <Text style={styles.centeredText}>
          Mağaza hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.
        </Text>
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
  } else if (loadFailed) {
    body = (
      <View style={styles.centered}>
        <Feather name="alert-circle" size={24} color={colors.danger} />
        <Text style={styles.errorText}>Mağaza yüklenemedi.</Text>
        <Pressable onPress={() => void refresh()} style={styles.signInBtn}>
          <Text style={styles.signInText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Bölüm başlığı + koleksiyon sayacı (şimdilik tek kategori: Sinyaller). */}
        <View style={styles.sectionRow}>
          <Feather name="message-circle" size={13} color={colors.cyan} />
          <Text style={styles.sectionLabel}>SİNYALLER</Text>
          <Text style={styles.sectionCount}>
            {ownedCount}/{SIGNALS.length}
          </Text>
        </View>

        <View style={styles.grid}>
          {SIGNALS.map((s) => {
            const Icon = s.component;
            const isOwned = owned.includes(s.id);
            const afford = veri >= s.veriCost;
            const locked = !isOwned && !afford;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSelectedId(s.id)}
                style={({ pressed }) => [
                  styles.card,
                  isOwned && styles.cardOwned,
                  locked && styles.cardLocked,
                  pressed && styles.cardPressed,
                ]}>
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
      </ScrollView>
    );
  }

  return (
    <Screen edges={TAB_EDGES}>
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
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 12,
  },
  titleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.5),
    textShadowRadius: 10,
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
  veriBalance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.teal, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.teal, 0.4),
  },
  veriText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  scroll: {
    paddingBottom: 28,
    gap: 14,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: mono,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.cyan,
  },
  sectionCount: {
    marginLeft: 'auto',
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '700',
    color: colors.dim,
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
  cardOwned: {
    borderColor: withAlpha(colors.success, 0.3),
    backgroundColor: withAlpha(colors.success, 0.06),
  },
  cardLocked: {
    opacity: 0.5,
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
