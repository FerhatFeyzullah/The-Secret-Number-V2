import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useAuth } from '@/auth';
import { getMyRank, OnlineError, unlockProtocol, type MyRank } from '@/online';
import { PILLAR_LABELS, PROTOCOLS, type Pillar, type Protocol } from '@/protocols/catalog';
import { Screen } from '@/ui/screen';
import { colors, mono, withAlpha } from '@/ui/theme';
import { type FeatherName } from './parts';
import { PILLAR_COLOR, protocolIcon } from './protocol-visuals';

const PILLAR_ORDER: Pillar[] = ['info', 'time', 'disrupt', 'defense'];

const PILLAR_HEAD_ICON: Record<Pillar, FeatherName> = {
  info: 'search',
  time: 'clock',
  disrupt: 'zap',
  defense: 'shield',
};

// Saf "satın al + sahip ol" modeli — maça götürme Faz 3'te rastgele dağıtımla
// (Destiny's Hand). Durumlar: kilitli / satın alınabilir / sahip.
type ProtoState = 'locked' | 'buyable' | 'owned';

function deriveState(p: Protocol, level: number, owned: string[]): ProtoState {
  if (owned.includes(p.id)) return 'owned';
  return level >= p.levelGate ? 'buyable' : 'locked';
}

function stateColor(s: ProtoState): string {
  if (s === 'buyable') return colors.cyan;
  if (s === 'owned') return colors.success;
  return colors.dim;
}

const fmtVeri = (n: number) => n.toLocaleString('tr-TR');

/* ── Protokol düğümü ──────────────────────────────────────── */
function ProtocolNode({
  proto,
  state,
  onPress,
}: {
  proto: Protocol;
  state: ProtoState;
  onPress: () => void;
}) {
  const locked = state === 'locked';
  const owned = state === 'owned';
  const accent = stateColor(state);
  const icon = protocolIcon(proto.id);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.node,
        {
          backgroundColor: withAlpha(accent, locked ? 0.05 : 0.08),
          borderColor: withAlpha(accent, locked ? 0.22 : 0.4),
        },
        owned && { boxShadow: `0 0 10px ${withAlpha(colors.success, 0.25)}` },
        locked && styles.nodeLocked,
        pressed && styles.nodePressed,
      ]}>
      <View style={[styles.nodeIcon, { borderColor: withAlpha(accent, 0.35), backgroundColor: withAlpha(accent, 0.1) }]}>
        <Feather name={locked ? 'lock' : icon} size={15} color={accent} />
      </View>
      {/* Sabit yükseklikli isim alanı: 1 ve 2 satırlık isimler aynı boyda durur,
          ızgara hizalı kalır. Uzun isim kelime bazlı 2 satıra sarılır; gerekirse
          1-2px küçülür (minimumFontScale ile sınırlı). */}
      <View style={styles.nameBox}>
        <Text
          style={[styles.nodeName, locked && styles.nodeNameLocked]}
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.85}>
          {proto.name}
        </Text>
      </View>
      {owned ? (
        <View style={styles.nodeBadge}>
          <Feather name="check" size={9} color={colors.success} />
          <Text style={[styles.nodeBadgeText, { color: colors.success }]}>Sahip</Text>
        </View>
      ) : locked ? (
        <Text style={styles.nodeGate}>Sv.{proto.levelGate}</Text>
      ) : (
        <View style={styles.nodeBadge}>
          <Feather name="hexagon" size={8} color={colors.teal} />
          <Text style={[styles.nodeBadgeText, { color: colors.teal }]}>{proto.veriCost}</Text>
        </View>
      )}
    </Pressable>
  );
}

/* ── Detay dialogu ───────────────────────────────────────── */
function DetailDialog({
  proto,
  state,
  veri,
  level,
  busy,
  error,
  onClose,
  onBuy,
}: {
  proto: Protocol;
  state: ProtoState;
  veri: number;
  level: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onBuy: () => void;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
  }, [v]);

  const locked = state === 'locked';
  const owned = state === 'owned';
  const accent = stateColor(state);
  const canAfford = veri >= proto.veriCost;
  const icon = protocolIcon(proto.id);

  const card = {
    opacity: v,
    transform: [
      { scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
      { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
    ],
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.dialogRoot} onPress={onClose}>
        <Animated.View style={[styles.dialog, card]} onStartShouldSetResponder={() => true}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.dialogClose}>
            <Feather name="x" size={14} color={colors.dim} />
          </Pressable>

          <View style={styles.dialogHead}>
            <View style={[styles.dialogIcon, { borderColor: withAlpha(accent, 0.5), backgroundColor: withAlpha(accent, 0.14) }]}>
              <Feather name={locked ? 'lock' : icon} size={22} color={accent} />
            </View>
            <View style={styles.dialogTitleWrap}>
              <Text style={[styles.dialogTitle, { color: locked ? colors.dim : colors.ice }]}>
                {proto.name}
              </Text>
              <Text style={styles.dialogMeta}>
                {PILLAR_LABELS[proto.pillar]} · Seviye {proto.levelGate}
                {proto.oneShot ? ' · Tek kullanım' : ''}
              </Text>
            </View>
          </View>

          <Text style={styles.dialogEffect}>{proto.effect}</Text>

          {/* Gereksinim + maliyet */}
          <View style={styles.dialogChips}>
            <View style={styles.dialogChip}>
              <Text style={styles.dialogChipLabel}>Gereksinim</Text>
              <Text style={[styles.dialogChipVal, { color: level >= proto.levelGate ? colors.success : colors.danger }]}>
                Sv.{proto.levelGate}
              </Text>
              <Feather
                name={level >= proto.levelGate ? 'check' : 'lock'}
                size={10}
                color={level >= proto.levelGate ? colors.success : colors.danger}
              />
            </View>
            {!owned ? (
              <View style={[styles.dialogChip, { borderColor: withAlpha(colors.teal, 0.4), backgroundColor: withAlpha(colors.teal, 0.08) }]}>
                <Feather name="hexagon" size={10} color={colors.teal} />
                <Text style={[styles.dialogChipVal, { color: colors.teal }]}>{proto.veriCost} Veri</Text>
              </View>
            ) : null}
          </View>

          {error ? <Text style={styles.dialogError} selectable>{error}</Text> : null}

          {/* Aksiyon / durum */}
          {locked ? (
            <View style={styles.lockedNote}>
              <Text style={styles.lockedNoteText}>{`Sv.${proto.levelGate}'de açılır`}</Text>
            </View>
          ) : owned ? (
            <View style={styles.ownedNote}>
              <Feather name="check-circle" size={14} color={colors.success} />
              <Text style={styles.ownedNoteText}>Bu protokole sahipsin</Text>
            </View>
          ) : (
            <>
              <Pressable
                onPress={onBuy}
                disabled={!canAfford || busy}
                style={[styles.actionBtn, (!canAfford || busy) && styles.actionBtnOff]}>
                {busy ? (
                  <ActivityIndicator color={colors.ice} size="small" />
                ) : (
                  <>
                    <Feather name="hexagon" size={14} color={canAfford ? colors.teal : colors.dim} />
                    <Text style={[styles.actionText, !canAfford && { color: colors.dim }]}>
                      Aç · {proto.veriCost} Veri
                    </Text>
                  </>
                )}
              </Pressable>
              {!canAfford ? (
                <Text style={styles.dialogError}>
                  Yetersiz Veri ({fmtVeri(veri)} / {proto.veriCost})
                </Text>
              ) : null}
            </>
          )}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/* ── Ana ekran ───────────────────────────────────────────── */
export function ProtocolTreeScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [data, setData] = useState<MyRank | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      setData(await getMyRank());
    } catch (e) {
      setError(e instanceof OnlineError ? e.message : 'Protokoller yüklenemedi.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) void load();
    else setLoading(false);
  }, [session, load]);

  const owned = useMemo(() => data?.owned ?? [], [data]);
  const level = data?.level ?? 1;
  const veri = data?.veri ?? 0;

  const selected = selectedId ? PROTOCOLS.find((p) => p.id === selectedId) ?? null : null;
  const selectedState = selected ? deriveState(selected, level, owned) : null;

  const closeDialog = useCallback(() => {
    setSelectedId(null);
    setActionError(null);
  }, []);

  const buy = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await unlockProtocol(selected.id);
      setData((d) => (d ? { ...d, veri: res.veri, owned: res.owned } : d));
    } catch (e) {
      setActionError(e instanceof OnlineError ? e.message : 'İşlem başarısız.');
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
        <Feather name="arrow-left" size={18} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>PROTOKOLLER</Text>
      {session && data ? (
        <View style={styles.veriBalance}>
          <Feather name="hexagon" size={12} color={colors.teal} />
          <Text style={styles.veriBalanceText}>{fmtVeri(veri)}</Text>
        </View>
      ) : (
        <View style={styles.back} />
      )}
    </View>
  );

  let body;
  if (!session) {
    body = (
      <View style={styles.centered}>
        <Feather name="lock" size={26} color={colors.dim} />
        <Text style={styles.centeredText}>
          Protokoller hesabına bağlıdır.{'\n'}Görmek için giriş yapmalısın.
        </Text>
        <Pressable
          onPress={() => router.push({ pathname: '/auth', params: { next: '/protocols' } })}
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
        <Text style={styles.errorText} selectable>{error}</Text>
        <Pressable onPress={() => void load()} style={styles.signInBtn}>
          <Text style={styles.signInText}>Tekrar Dene</Text>
        </Pressable>
      </View>
    );
  } else {
    body = (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Seviye + sahip olunan protokol özeti */}
        <View style={styles.summaryRow}>
          <View style={styles.levelChip}>
            <View style={styles.levelDot} />
            <Text style={styles.levelChipText}>Seviye {level}</Text>
          </View>
          <View style={styles.ownedChip}>
            <Feather name="package" size={12} color={colors.cyan} />
            <Text style={styles.ownedChipText}>
              <Text style={{ color: colors.cyan }}>{owned.length}</Text> protokol sahibi
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Dal başlıkları */}
        <View style={styles.branchHeads}>
          {PILLAR_ORDER.map((pl) => (
            <View key={pl} style={styles.branchHead}>
              <View style={[styles.branchHeadIcon, { borderColor: withAlpha(PILLAR_COLOR[pl], 0.4), backgroundColor: withAlpha(PILLAR_COLOR[pl], 0.12) }]}>
                <Feather name={PILLAR_HEAD_ICON[pl]} size={15} color={PILLAR_COLOR[pl]} />
              </View>
              <Text style={[styles.branchHeadText, { color: PILLAR_COLOR[pl] }]} numberOfLines={1}>
                {PILLAR_LABELS[pl]}
              </Text>
            </View>
          ))}
        </View>

        {/* Devre ağacı: 4 dikey dal */}
        <View style={styles.tree}>
          {PILLAR_ORDER.map((pl) => {
            const nodes = PROTOCOLS.filter((p) => p.pillar === pl).sort((a, b) => a.levelGate - b.levelGate);
            return (
              <View key={pl} style={styles.col}>
                {nodes.map((proto, ri) => {
                  const st = deriveState(proto, level, owned);
                  return (
                    <View key={proto.id} style={styles.colItem}>
                      {ri > 0 ? <View style={[styles.connector, { backgroundColor: withAlpha(PILLAR_COLOR[pl], 0.5) }]} /> : null}
                      <ProtocolNode proto={proto} state={st} onPress={() => setSelectedId(proto.id)} />
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>

        <Text style={styles.footerHint}>Her protokole dokun → detay</Text>
      </ScrollView>
    );
  }

  return (
    <Screen>
      {header}
      {body}
      {selected && selectedState ? (
        <DetailDialog
          proto={selected}
          state={selectedState}
          veri={veri}
          level={level}
          busy={busy}
          error={actionError}
          onClose={closeDialog}
          onBuy={buy}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: withAlpha(colors.cyan, 0.5),
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
  veriBalanceText: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '800',
    fontFamily: mono,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingHorizontal: 24,
  },
  centeredText: {
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
  signInBtn: {
    marginTop: 4,
    paddingVertical: 11,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.4),
    backgroundColor: withAlpha(colors.cyan, 0.12),
  },
  signInText: {
    color: colors.cyan,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 1,
  },
  scroll: {
    paddingBottom: 32,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
    paddingBottom: 14,
  },
  levelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  levelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    boxShadow: `0 0 5px ${colors.success}`,
  },
  levelChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  ownedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: withAlpha(colors.cyan, 0.08),
    borderWidth: 1,
    borderColor: withAlpha(colors.cyan, 0.28),
  },
  ownedChipText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  divider: {
    height: 1,
    backgroundColor: withAlpha(colors.cyan, 0.15),
    marginBottom: 16,
  },
  branchHeads: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  branchHead: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  branchHeadIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  branchHeadText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  tree: {
    flexDirection: 'row',
  },
  col: {
    flex: 1,
    alignItems: 'center',
  },
  colItem: {
    alignItems: 'center',
    width: '100%',
  },
  connector: {
    width: 2,
    height: 16,
    borderRadius: 1,
  },
  node: {
    width: '94%',
    // Sabit minimum yükseklik: tüm düğümler (1 ve 2 satırlık isimler) eşit boyda.
    minHeight: 96,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5,
  },
  nodeLocked: {
    opacity: 0.6,
  },
  nodePressed: {
    transform: [{ scale: 0.96 }],
  },
  nodeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameBox: {
    height: 22, // iki satır (lineHeight 11) — tek/çift satır aynı yüksekliği kaplar
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  nodeName: {
    fontSize: 8,
    fontWeight: '700',
    color: colors.text,
    fontFamily: mono,
    textAlign: 'center',
    lineHeight: 11,
  },
  nodeNameLocked: {
    color: withAlpha(colors.dim, 0.6),
  },
  nodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  nodeBadgeText: {
    fontSize: 7.5,
    fontWeight: '700',
    fontFamily: mono,
  },
  nodeGate: {
    fontSize: 8,
    color: withAlpha(colors.dim, 0.6),
    fontFamily: mono,
  },
  footerHint: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 9,
    color: withAlpha(colors.dim, 0.4),
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  // Dialog
  dialogRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    backgroundColor: 'rgba(4,8,20,0.8)',
  },
  dialog: {
    width: '100%',
    backgroundColor: colors.bgMid,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 22,
    padding: 20,
    boxShadow: '0 0 40px rgba(0,0,0,0.7)',
  },
  dialogClose: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  dialogHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
    paddingRight: 30,
  },
  dialogIcon: {
    width: 54,
    height: 54,
    borderRadius: 15,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogTitleWrap: {
    flex: 1,
    gap: 3,
  },
  dialogTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.4,
  },
  dialogMeta: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
  },
  dialogEffect: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 19,
    marginBottom: 16,
  },
  dialogChips: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  dialogChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  dialogChipLabel: {
    fontSize: 8,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.4,
  },
  dialogChipVal: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: mono,
  },
  dialogError: {
    fontSize: 10,
    color: colors.danger,
    fontFamily: mono,
    textAlign: 'center',
    marginBottom: 10,
  },
  lockedNote: {
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(60,80,120,0.2)',
    borderWidth: 1,
    borderColor: withAlpha(colors.dim, 0.22),
    alignItems: 'center',
  },
  lockedNoteText: {
    fontSize: 10,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  ownedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: withAlpha(colors.success, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.35),
  },
  ownedNoteText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.success,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.cyan, 0.5),
    backgroundColor: withAlpha(colors.cyan, 0.2),
  },
  actionBtnOff: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 1,
  },
});
