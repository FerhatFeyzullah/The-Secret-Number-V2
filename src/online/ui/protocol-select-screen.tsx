import { Feather } from '@expo/vector-icons';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  cancelSetupTimeout,
  getMyHand,
  leaveMatch,
  OnlineError,
  resolveProtocolSelect,
  setProtocolSelection,
  useMatch,
  type ProtocolHand,
} from '@/online';
import { getProtocol, PILLAR_LABELS } from '@/protocols/catalog';
import { Screen } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

import { PILLAR_COLOR, protocolIcon } from './protocol-visuals';
import { CountdownRing } from './setup/countdown-ring';

const SELECT_TOTAL_MS = 20_000;
const LOW_MS = 5_000;
const errMsg = (e: unknown) =>
  e instanceof OnlineError ? e.message : 'Bağlantı hatası, lütfen tekrar dene.';

/** Destiny's Hand — maç başı protokol seçimi (Protokol Maçı, belirleme öncesi).
 *  El SUNUCUDA dağıtılır (get_my_hand); seçim set_protocol_selection'a yazılır.
 *  Süre dolunca/eksik seçimde sunucu rastgele tamamlar. Rakibin eli gizli.
 *  Sayaç ancak iki taraf da present olunca (select_deadline) başlar. */
export function ProtocolSelectScreen({ matchId }: { matchId: string }) {
  const router = useRouter();
  const navigation = useNavigation();
  const { match, loading, error } = useMatch(matchId);

  const [hand, setHand] = useState<ProtocolHand | null>(null);
  const [handError, setHandError] = useState<string | null>(null);
  const [handDetail, setHandDetail] = useState<string | null>(null);
  const [handLoading, setHandLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const [lockedSelection, setLockedSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const status = match?.status ?? null;
  const slots = hand?.slots ?? 2;
  const bothPresent = !!match && match.player1Present && match.player2Present;
  const deadline = match?.selectDeadline ? Date.parse(match.selectDeadline) : null;
  // Sunucu penceresi 7 sn VS tamponu içerir (27 sn); halka 20 sn'ye kelepçelenir.
  const remainingMs = deadline
    ? Math.min(SELECT_TOTAL_MS, Math.max(0, deadline - nowMs))
    : SELECT_TOTAL_MS;
  const pastDeadline = deadline ? nowMs > deadline : false;
  const low = remainingMs <= LOW_MS;
  const presentDeadline = match?.presentDeadline ? Date.parse(match.presentDeadline) : null;
  const pastPresentDeadline = presentDeadline ? nowMs > presentDeadline : false;
  const oppLocked = match
    ? match.myRole === 'player1'
      ? match.player2Ready
      : match.player1Ready
    : false;

  // Eli sunucudan çek. El, eşleşme anında dağıtılır; nadiren realtime durum
  // güncellemesi el satırından önce gelebilir (yarış) → boş elde birkaç kez
  // yeniden dene. Gerçek hata olursa anlamlı mesaj + "Tekrar Dene".
  useEffect(() => {
    if (status !== 'protocol_select' || hand) return;
    let alive = true;
    setHandLoading(true);
    setHandError(null);
    setHandDetail(null);
    (async () => {
      for (let attempt = 0; attempt < 3 && alive; attempt++) {
        try {
          const h = await getMyHand(matchId);
          if (!alive) return;
          if (h.hand.length === 0 && attempt < 2) {
            await new Promise((r) => setTimeout(r, 500)); // el henüz hazır değil → bekle
            continue;
          }
          setHand(h);
          if (h.selected.length > 0) {
            setSelected(h.selected);
            setLockedSelection(h.selected);
            setLocked(true);
          }
          setHandLoading(false);
          return;
        } catch (e) {
          if (!alive) return;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          setHandError(errMsg(e));
          setHandDetail(e instanceof OnlineError ? e.serverMessage ?? null : null);
          setHandLoading(false);
          return;
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [status, matchId, hand, reloadKey]);

  const retryHand = useCallback(() => {
    setHand(null);
    setHandError(null);
    setHandDetail(null);
    setReloadKey((k) => k + 1);
  }, []);

  // Görsel geri sayım tiki (yalnız seçim fazında).
  useEffect(() => {
    if (status !== 'protocol_select') return;
    const iv = setInterval(() => setNowMs(Date.now()), 250);
    return () => clearInterval(iv);
  }, [status]);

  // Süre/idle tetikleyici (karar sunucuda):
  //  a) idle: bir taraf present, diğeri gelmedi → cancel.
  //  b) seçim süresi doldu (iki taraf present) → resolve (eksikleri rastgele tamamla).
  const firedRef = useRef(false);
  useEffect(() => {
    if (status !== 'protocol_select' || firedRef.current) return;
    if (bothPresent && pastDeadline) {
      firedRef.current = true;
      void resolveProtocolSelect(matchId).catch(() => {});
    } else if (!bothPresent && pastPresentDeadline) {
      firedRef.current = true;
      void cancelSetupTimeout(matchId).catch(() => {});
    }
  }, [status, bothPresent, pastDeadline, pastPresentDeadline, matchId]);

  // status → setup: belirleme ekranına geç.
  const leavingRef = useRef(false);
  const navedRef = useRef(false);
  useEffect(() => {
    if (status !== 'setup' || navedRef.current) return;
    navedRef.current = true;
    leavingRef.current = true;
    const t = setTimeout(
      () => router.replace({ pathname: '/match-setup', params: { matchId } }),
      500,
    );
    return () => clearTimeout(t);
  }, [status, matchId, router]);

  // İptal/terk → mesaj + geri (kendi çıkışımız değilse).
  const endedRef = useRef(false);
  useEffect(() => {
    if (!match || navedRef.current || endedRef.current || leavingRef.current) return;
    if (status === 'cancelled' || status === 'finished' || status === 'abandoned') {
      endedRef.current = true;
      leavingRef.current = true;
      // Hiçbir süre dolmadan iptal geldiyse rakip ayrılmıştır (leave/yeni arama).
      const reason =
        status === 'cancelled' && !pastDeadline && !pastPresentDeadline
          ? 'Rakip ayrıldı, maç iptal edildi.'
          : !bothPresent
            ? 'Rakip katılmadı, maç iptal edildi.'
            : 'Süre doldu, maç iptal edildi.';
      Alert.alert('Maç iptal', reason, [{ text: 'Tamam', onPress: () => router.back() }]);
    }
  }, [status, match, bothPresent, pastDeadline, pastPresentDeadline, router]);

  // Çıkış onayı: seçim fazında çıkış = maç iptal.
  useEffect(() => {
    const sub = navigation.addListener('beforeRemove', (e) => {
      if (leavingRef.current || match?.status !== 'protocol_select') return;
      e.preventDefault();
      Alert.alert('Maçtan çık', 'Çıkarsan maç iptal olur. Çıkmak istiyor musun?', [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Çık',
          style: 'destructive',
          onPress: () => {
            leavingRef.current = true;
            void leaveMatch(matchId).catch(() => {});
            navigation.dispatch(e.data.action);
          },
        },
      ]);
    });
    return sub;
  }, [navigation, match?.status, matchId]);

  const full = selected.length >= slots;
  const toggle = useCallback(
    (id: string) => {
      if (locked) return;
      setActionError(null);
      setSelected((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= slots) return prev;
        return [...prev, id];
      });
    },
    [locked, slots],
  );

  const confirm = useCallback(async () => {
    if (locked || busy || selected.length === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await setProtocolSelection(matchId, selected);
      setLockedSelection(res.selected);
      setSelected(res.selected);
      setLocked(true);
    } catch (e) {
      setActionError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }, [locked, busy, selected, matchId]);

  const exitButton = (
    <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.exit}>
      <Feather name="chevron-left" size={20} color={colors.text} />
    </Pressable>
  );

  const cards = useMemo(
    () => (hand?.hand ?? []).map((id) => getProtocol(id)).filter((p): p is NonNullable<typeof p> => !!p),
    [hand],
  );

  if (!match) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loading ? (
            <ActivityIndicator color={colors.cyan} />
          ) : (
            <Text style={styles.note}>{error ?? 'Maç bulunamadı.'}</Text>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* Üst enerji ışını */}
      <View style={styles.beam} />

      <View style={styles.content}>
        {/* Başlık + sayaç */}
        <View style={styles.header}>
          {exitButton}
          <View style={styles.headerText}>
            <Text style={styles.title}>PROTOKOL SEÇİMİ</Text>
            <Text style={styles.subtitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              Bu maça götüreceğin protokolleri seç
            </Text>
          </View>
          {bothPresent ? (
            <CountdownRing remainingMs={remainingMs} totalMs={SELECT_TOTAL_MS} low={low} />
          ) : (
            <ActivityIndicator color={colors.amber} />
          )}
        </View>

        {/* Maç bağlamı */}
        <View style={styles.context}>
          <View style={styles.ctxDot} />
          <Text style={styles.ctxText}>Protokol Maçı · Best of 3</Text>
        </View>

        {!bothPresent ? (
          <Text style={styles.waiting}>RAKİP HAZIR BEKLENİYOR…</Text>
        ) : null}

        {/* Seçim sayacı (pip'ler) */}
        <View style={[styles.counter, full && styles.counterFull]}>
          <View style={styles.pips}>
            {Array.from({ length: slots }).map((_, i) => (
              <View key={i} style={[styles.pip, i < selected.length && styles.pipOn]}>
                {i < selected.length ? <Feather name="check" size={11} color={colors.cyan} /> : null}
              </View>
            ))}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.counterText}>
              <Text style={{ color: full ? colors.cyan : colors.ice }}>{selected.length}</Text>
              <Text style={{ color: colors.dim }}> / {slots} seçildi</Text>
            </Text>
            <Text style={[styles.counterHint, { color: full ? colors.cyan : colors.dim }]}>
              {full ? 'Limit dolu — hazır olabilirsin' : `${slots - selected.length} slot daha seçilebilir`}
            </Text>
          </View>
        </View>

        {/* El (kart ızgarası) — hazır değilse yükleniyor / hata + yeniden dene */}
        {!hand && handLoading ? (
          <View style={styles.handState}>
            <ActivityIndicator color={colors.cyan} />
            <Text style={styles.handStateText}>El hazırlanıyor…</Text>
          </View>
        ) : !hand && handError ? (
          <View style={styles.handState}>
            <Feather name="alert-circle" size={22} color={colors.danger} />
            <Text style={styles.handStateText}>{handError}</Text>
            {handDetail ? <Text style={styles.handDetail}>{handDetail}</Text> : null}
            <Pressable onPress={retryHand} hitSlop={8} style={styles.retryBtn}>
              <Feather name="refresh-cw" size={14} color={colors.cyan} />
              <Text style={styles.retryText}>Tekrar Dene</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.handLabel}>EL — {cards.length} kart çekildi</Text>
            <View style={styles.grid}>
              {cards.map((proto) => {
            const isSel = selected.includes(proto.id);
            const dimmed = !isSel && full;
            const color = PILLAR_COLOR[proto.pillar];
            return (
              <Pressable
                key={proto.id}
                onPress={() => toggle(proto.id)}
                disabled={locked || (dimmed && !isSel)}
                style={({ pressed }) => [
                  styles.card,
                  isSel && { borderColor: cyanAlpha(0.6), backgroundColor: cyanAlpha(0.12) },
                  dimmed && !isSel && styles.cardDimmed,
                  pressed && !locked && styles.cardPressed,
                ]}>
                {isSel ? (
                  <View style={styles.badge}>
                    <Feather name="check" size={11} color={colors.bgTop} />
                  </View>
                ) : null}
                <View style={[styles.cardIcon, { borderColor: withAlpha(color, isSel ? 0.6 : 0.35), backgroundColor: withAlpha(color, isSel ? 0.18 : 0.1) }]}>
                  <Feather name={protocolIcon(proto.id)} size={20} color={color} />
                </View>
                <Text style={styles.cardName} numberOfLines={2}>
                  {proto.name}
                </Text>
                <Text style={styles.cardHint} numberOfLines={3}>
                  {proto.effect}
                </Text>
                <View style={[styles.tag, { borderColor: withAlpha(color, 0.38), backgroundColor: withAlpha(color, 0.12) }]}>
                  <View style={[styles.tagDot, { backgroundColor: color }]} />
                  <Text style={[styles.tagText, { color }]}>{PILLAR_LABELS[proto.pillar]}</Text>
                </View>
              </Pressable>
            );
              })}
            </View>
          </>
        )}

        <View style={{ flex: 1 }} />
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {/* Onay butonu */}
        {locked ? (
          <View style={styles.lockedBanner}>
            <Feather name="check" size={16} color={colors.success} />
            <Text style={styles.lockedText}>SEÇİM KİLİTLENDİ</Text>
          </View>
        ) : (
          <Pressable
            onPress={confirm}
            disabled={selected.length === 0 || busy || !bothPresent || !hand}
            style={({ pressed }) => [
              styles.confirm,
              (selected.length === 0 || !bothPresent) && styles.confirmOff,
              pressed && selected.length > 0 && styles.confirmPressed,
            ]}>
            {busy ? (
              <ActivityIndicator color={colors.ice} size="small" />
            ) : (
              <>
                <Feather name="lock" size={16} color={selected.length > 0 ? colors.ice : colors.dim} />
                <Text style={[styles.confirmText, selected.length === 0 && { color: colors.dim }]}>
                  {full ? 'KİLİTLE' : 'HAZIR'}
                </Text>
              </>
            )}
          </Pressable>
        )}
        <Text style={styles.footNote}>
          {locked ? 'Rakip bekleniyor…' : 'Seçmezsen rastgele atanır'}
        </Text>

        {/* Rakip durumu */}
        {bothPresent ? (
          <View style={styles.opp}>
            <View style={[styles.oppDot, { backgroundColor: oppLocked ? colors.success : colors.amber }]} />
            <Text style={[styles.oppText, { color: oppLocked ? colors.success : colors.amber }]}>
              {oppLocked ? '✓ Rakip seçti' : 'Rakip seçiyor…'}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Kilitlenme overlay'i */}
      {locked ? (
        <View style={styles.overlay}>
          <View style={styles.overlayIcon}>
            <Feather name="lock" size={26} color={colors.cyan} />
          </View>
          <Text style={styles.overlayTitle}>KİLİTLENDİ</Text>
          <Text style={styles.overlaySub}>Protokoller hazırlandı</Text>
          <View style={styles.overlayRow}>
            {lockedSelection.map((id) => {
              const proto = getProtocol(id);
              if (!proto) return null;
              const color = PILLAR_COLOR[proto.pillar];
              return (
                <View key={id} style={styles.overlayCard}>
                  <View style={[styles.overlayCardIcon, { borderColor: cyanAlpha(0.6), backgroundColor: withAlpha(color, 0.18) }]}>
                    <Feather name={protocolIcon(id)} size={20} color={color} />
                  </View>
                  <Text style={styles.overlayCardName} numberOfLines={1}>
                    {proto.name}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.overlayFoot}>
            {status === 'setup' ? 'Gizli sayı aşamasına geçiliyor…' : 'Rakip bekleniyor…'}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  beam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 18px ${colors.cyan}`,
    zIndex: 3,
  },
  content: {
    flex: 1,
    paddingTop: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 12,
  },
  subtitle: {
    fontSize: 10,
    color: colors.dim,
    marginTop: 3,
  },
  exit: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  context: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  ctxDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  ctxText: {
    fontSize: 10,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  waiting: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.amber,
    fontFamily: mono,
    textAlign: 'center',
    marginBottom: 10,
  },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  counterFull: {
    borderColor: cyanAlpha(0.45),
    backgroundColor: cyanAlpha(0.1),
  },
  pips: {
    flexDirection: 'row',
    gap: 5,
  },
  pip: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pipOn: {
    borderColor: colors.cyan,
    backgroundColor: cyanAlpha(0.22),
  },
  counterText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  counterHint: {
    fontSize: 9,
    fontFamily: mono,
    marginTop: 1,
  },
  handLabel: {
    fontSize: 8,
    letterSpacing: 2,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  handState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
  },
  handStateText: {
    fontSize: 13,
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'center',
  },
  handDetail: {
    fontSize: 10,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.12),
  },
  retryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    width: '47.5%',
    flexGrow: 1,
    backgroundColor: colors.glass,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
    borderRadius: 18,
    padding: 12,
    gap: 8,
    minHeight: 142,
  },
  cardDimmed: {
    opacity: 0.38,
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardName: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  cardHint: {
    fontSize: 9,
    color: colors.dim,
    lineHeight: 13,
    flex: 1,
  },
  tag: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  tagDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  tagText: {
    fontSize: 8,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  actionError: {
    color: colors.danger,
    fontSize: 11,
    textAlign: 'center',
    marginBottom: 8,
  },
  confirm: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 16,
    borderRadius: 15,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.55),
    backgroundColor: cyanAlpha(0.24),
    boxShadow: `0 4px 0 ${colors.cyanDeep}, 0 0 20px ${cyanAlpha(0.3)}`,
  },
  confirmOff: {
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    boxShadow: undefined,
  },
  confirmPressed: {
    transform: [{ translateY: 3 }],
    boxShadow: `0 0 14px ${cyanAlpha(0.25)}`,
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 3,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 10,
  },
  footNote: {
    textAlign: 'center',
    fontSize: 9,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    letterSpacing: 0.5,
    marginTop: 9,
  },
  lockedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 15,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: withAlpha(colors.success, 0.4),
    backgroundColor: withAlpha(colors.success, 0.14),
  },
  lockedText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.success,
    fontFamily: mono,
  },
  opp: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  oppDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  oppText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: {
    color: colors.dim,
    fontSize: 14,
    fontFamily: mono,
    textAlign: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: 'rgba(6,12,26,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  overlayIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: cyanAlpha(0.15),
    borderWidth: 2.5,
    borderColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `0 0 28px ${cyanAlpha(0.55)}`,
  },
  overlayTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.7),
    textShadowRadius: 16,
  },
  overlaySub: {
    fontSize: 10,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
    marginTop: -8,
  },
  overlayRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  overlayCard: {
    alignItems: 'center',
    gap: 6,
    width: 64,
  },
  overlayCardIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayCardName: {
    fontSize: 8,
    color: colors.dim,
    fontFamily: mono,
    textAlign: 'center',
  },
  overlayFoot: {
    fontSize: 10,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    letterSpacing: 0.5,
    marginTop: 6,
  },
});
