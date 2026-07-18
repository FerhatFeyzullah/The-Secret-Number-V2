import { Feather } from '@expo/vector-icons';
import { useRouter, usePathname, type Href } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth';
import {
  acceptChallenge,
  cancelChallenge,
  createChallenge,
  getPendingChallenge,
  OnlineError,
  rejectChallenge,
  subscribeChallenges,
  useMatchSession,
  type ChallengeFull,
  type FirstTurnMode,
  type IncomingChallenge,
  type PrivateRoomMode,
} from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const REJECT_MSGS = ['Şimdi olmaz', 'Birazdan çıkacağım', 'Sonra oynayalım'];
const CHALLENGE_MS = 30000;

const MODES: { mode: PrivateRoomMode; icon: 'zap' | 'cpu' | 'type'; label: string; sub: string; accent: string }[] = [
  { mode: 'quick', icon: 'zap', label: 'Hızlı Maç', sub: 'Sayı · tek tur', accent: colors.cyan },
  { mode: 'protocol', icon: 'cpu', label: 'Protokol', sub: 'Sayı · Bo3 + protokol', accent: colors.violet },
  { mode: 'word', icon: 'type', label: 'Kelime', sub: 'Wordle · Bo3', accent: colors.teal },
];
const CLOCKS = [60000, 90000, 120000, 180000];
const TURNS: { val: FirstTurnMode; label: string }[] = [
  { val: 'random', label: 'Rastgele' },
  { val: 'creator', label: 'Ben başlarım' },
];
const WORD_LENGTHS: { val: number | null; label: string }[] = [
  { val: null, label: 'Rastgele' },
  { val: 4, label: '4' },
  { val: 5, label: '5' },
  { val: 6, label: '6' },
];

function modeLabel(m: PrivateRoomMode): string {
  return MODES.find((x) => x.mode === m)?.label ?? 'Maç';
}
function clockLabel(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
}
function isBusyPath(path: string): boolean {
  return (
    path === '/online' ||
    path === '/match-setup' ||
    path === '/protocol-select' ||
    path.startsWith('/match/')
  );
}
const errMsg = (e: unknown) => (e instanceof OnlineError ? e.message : 'İşlem başarısız, tekrar dene.');

type ChallengeApi = { challenge: (player: string, username: string) => void };
const Ctx = createContext<ChallengeApi | null>(null);

/** Klan içi meydan okuma — app-geneli akış: mod/ayar modalları, "yanıt bekleniyor"
 *  overlay'i (giden), üstten kayan gelen kart (onayla/reddet). Realtime; onayda
 *  iki oyuncu da maça yönlenir. Kök seviyede (Stack'i sarar) mount edilir. */
export function ChallengeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const myId = session?.user.id ?? null;
  const router = useRouter();
  const pathname = usePathname();
  const matchSession = useMatchSession();

  // Giden akış
  const [target, setTarget] = useState<{ player: string; username: string } | null>(null);
  const [outPhase, setOutPhase] = useState<'idle' | 'mode' | 'settings' | 'waiting'>('idle');
  const [outMode, setOutMode] = useState<PrivateRoomMode>('quick');
  const [outId, setOutId] = useState<string | null>(null);
  const [outResult, setOutResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const outTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gelen akış
  const [incoming, setIncoming] = useState<IncomingChallenge | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [incBusy, setIncBusy] = useState(false);
  const incTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Basit toast (meşgul/hata bildirimi).
  const [toast, setToast] = useState<string | null>(null);

  // Realtime geri çağrımının bayat okumaması için ref'ler.
  const outIdRef = useRef<string | null>(null);
  const outModeRef = useRef<PrivateRoomMode>('quick');
  const incomingRef = useRef<IncomingChallenge | null>(null);
  const busyRef = useRef(false);
  outIdRef.current = outId;
  outModeRef.current = outMode;
  incomingRef.current = incoming;
  busyRef.current = isBusyPath(pathname);

  const clearOut = useCallback(() => {
    if (outTimer.current) clearTimeout(outTimer.current);
    setOutPhase('idle');
    setTarget(null);
    setOutId(null);
    setOutResult(null);
  }, []);

  const clearIncoming = useCallback(() => {
    if (incTimer.current) clearTimeout(incTimer.current);
    setIncoming(null);
    setRejecting(false);
  }, []);

  const routeToMatch = useCallback(
    (matchId: string, mode: PrivateRoomMode) => {
      matchSession.claim(matchId, 'match');
      const href: Href =
        mode === 'protocol'
          ? { pathname: '/protocol-select', params: { matchId } }
          : { pathname: '/match-setup', params: { matchId, content: mode === 'word' ? 'word' : 'number' } };
      router.push(href);
    },
    [matchSession, router],
  );

  const showIncoming = useCallback(
    (inc: IncomingChallenge) => {
      if (incTimer.current) clearTimeout(incTimer.current);
      setIncoming(inc);
      setRejecting(false);
      const ms = Math.max(0, new Date(inc.expiresAt).getTime() - Date.now());
      incTimer.current = setTimeout(() => setIncoming(null), ms || CHALLENGE_MS);
    },
    [],
  );

  // Realtime + kaçan bekleyen davet.
  useEffect(() => {
    if (!myId) return;
    void getPendingChallenge()
      .then((inc) => {
        if (inc && !busyRef.current) showIncoming(inc);
      })
      .catch(() => {});

    const onChange = (c: ChallengeFull) => {
      if (c.toPlayer === myId) {
        // Gelen davet
        if (c.status === 'pending') {
          if (!busyRef.current) {
            showIncoming({
              id: c.id, fromPlayer: c.fromPlayer, fromUsername: c.fromUsername,
              mode: c.mode, clockMs: c.clockMs, firstTurn: c.firstTurn,
              wordLength: c.wordLength, expiresAt: c.expiresAt,
            });
          }
        } else if (incomingRef.current?.id === c.id) {
          clearIncoming();
        }
      }
      if (c.fromPlayer === myId && outIdRef.current === c.id) {
        // Giden davetimin yanıtı
        if (c.status === 'accepted' && c.matchId) {
          if (outTimer.current) clearTimeout(outTimer.current);
          clearOut();
          routeToMatch(c.matchId, outModeRef.current);
        } else if (c.status === 'rejected') {
          if (outTimer.current) clearTimeout(outTimer.current);
          setOutResult(c.rejectMessage ? `Reddedildi · "${c.rejectMessage}"` : 'Reddedildi');
          outTimer.current = setTimeout(() => clearOut(), 2600);
        } else if (c.status === 'cancelled' || c.status === 'expired') {
          clearOut();
        }
      }
    };

    const unsub = subscribeChallenges(myId, onChange);
    return () => unsub();
  }, [myId, showIncoming, clearIncoming, clearOut, routeToMatch]);

  useEffect(
    () => () => {
      if (outTimer.current) clearTimeout(outTimer.current);
      if (incTimer.current) clearTimeout(incTimer.current);
    },
    [],
  );

  // ── Giden akış eylemleri ──
  const challenge = useCallback((player: string, username: string) => {
    setTarget({ player, username });
    setOutMode('quick');
    setOutId(null);
    setOutResult(null);
    setOutPhase('mode');
  }, []);

  const confirmSettings = useCallback(
    async (clockMs: number, firstTurn: FirstTurnMode, wordLength: number | null) => {
      if (!target || sending) return;
      setSending(true);
      try {
        const { id, expiresAt } = await createChallenge(target.player, outMode, clockMs, firstTurn, wordLength);
        setOutId(id);
        setOutResult(null);
        setOutPhase('waiting');
        // Sunucu 30 sn'de expire eder; davet edilen son ana onaylarsa "kabul"
        // realtime'ı geç gelebilir → sayaca küçük tolerans (yarış → takılma önlenir).
        const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now()) + 2500;
        if (outTimer.current) clearTimeout(outTimer.current);
        outTimer.current = setTimeout(() => {
          setOutResult('Yanıt yok');
          outTimer.current = setTimeout(() => clearOut(), 1800);
        }, ms || CHALLENGE_MS);
      } catch (e) {
        setOutPhase('idle');
        setTarget(null);
        setOutResult(null);
        setToast(errMsg(e)); // meşgul/hata → kısa toast
      } finally {
        setSending(false);
      }
    },
    [target, sending, outMode, clearOut],
  );

  const cancelOut = useCallback(() => {
    if (outId) void cancelChallenge(outId).catch(() => {});
    clearOut();
  }, [outId, clearOut]);

  // ── Gelen akış eylemleri ──
  const acceptIn = useCallback(async () => {
    const inc = incoming;
    if (!inc || incBusy) return;
    setIncBusy(true);
    try {
      const ticket = await acceptChallenge(inc.id);
      clearIncoming();
      routeToMatch(ticket.matchId, inc.mode);
    } catch (e) {
      clearIncoming();
      setToast(errMsg(e));
    } finally {
      setIncBusy(false);
    }
  }, [incoming, incBusy, clearIncoming, routeToMatch]);

  const rejectIn = useCallback(
    async (message: string) => {
      const inc = incoming;
      if (!inc || incBusy) return;
      setIncBusy(true);
      try {
        await rejectChallenge(inc.id, message);
      } catch {
        // sessiz
      } finally {
        clearIncoming();
        setIncBusy(false);
      }
    },
    [incoming, incBusy, clearIncoming],
  );

  return (
    <Ctx.Provider value={{ challenge }}>
      <View style={styles.flex}>
        {children}

        <ModeModal
        visible={outPhase === 'mode'}
        target={target?.username ?? ''}
        onPick={(m) => {
          setOutMode(m);
          setOutPhase('settings');
        }}
        onClose={clearOut}
      />
      <SettingsModal
        visible={outPhase === 'settings'}
        mode={outMode}
        target={target?.username ?? ''}
        busy={sending}
        onConfirm={confirmSettings}
        onBack={() => setOutPhase('mode')}
        onClose={clearOut}
      />
      <WaitingOverlay
        visible={outPhase === 'waiting'}
        target={target?.username ?? ''}
        result={outResult}
        onCancel={cancelOut}
      />
      {incoming ? (
        <IncomingCard
          incoming={incoming}
          rejecting={rejecting}
          busy={incBusy}
          onAccept={acceptIn}
          onStartReject={() => setRejecting(true)}
          onReject={rejectIn}
          onDismissReject={() => setRejecting(false)}
        />
      ) : null}
        {toast ? <Toast text={toast} onDone={() => setToast(null)} /> : null}
      </View>
    </Ctx.Provider>
  );
}

export function useChallenge(): ChallengeApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChallenge must be used within ChallengeProvider');
  return v;
}

/* ── Mod modalı ─────────────────────────────────────────────── */
function ModeModal({
  visible,
  target,
  onPick,
  onClose,
}: {
  visible: boolean;
  target: string;
  onPick: (m: PrivateRoomMode) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <Text style={styles.sheetTitle}>{`${target}'e meydan oku`}</Text>
          <Text style={styles.sheetSub}>Oyun modu seç</Text>
          {MODES.map((m) => (
            <Pressable key={m.mode} onPress={() => onPick(m.mode)} style={styles.modeRow}>
              <View style={[styles.modeIcon, { borderColor: withAlpha(m.accent, 0.5), backgroundColor: withAlpha(m.accent, 0.14) }]}>
                <Feather name={m.icon} size={20} color={m.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.modeName}>{m.label}</Text>
                <Text style={styles.modeSub}>{m.sub}</Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.dim} />
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

/* ── Ayar modalı ────────────────────────────────────────────── */
function SettingsModal({
  visible,
  mode,
  target,
  busy,
  onConfirm,
  onBack,
  onClose,
}: {
  visible: boolean;
  mode: PrivateRoomMode;
  target: string;
  busy: boolean;
  onConfirm: (clockMs: number, firstTurn: FirstTurnMode, wordLength: number | null) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [clock, setClock] = useState(60000);
  const [turn, setTurn] = useState<FirstTurnMode>('random');
  const [wl, setWl] = useState<number | null>(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          <View style={styles.sheetHead}>
            <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
              <Feather name="arrow-left" size={16} color={colors.text} />
            </Pressable>
            <Text style={styles.sheetTitle}>{modeLabel(mode)} · {target}</Text>
            <View style={styles.backBtn} />
          </View>

          <Text style={styles.rowLabel}>MAÇ SÜRESİ</Text>
          <View style={styles.chips}>
            {CLOCKS.map((c) => (
              <Pressable key={c} onPress={() => setClock(c)} style={[styles.chip, clock === c && styles.chipOn]}>
                <Text style={[styles.chipText, clock === c && styles.chipTextOn]}>{clockLabel(c)}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.rowLabel}>İLK SIRA</Text>
          <View style={styles.chips}>
            {TURNS.map((t) => (
              <Pressable key={t.val} onPress={() => setTurn(t.val)} style={[styles.chip, styles.chipWide, turn === t.val && styles.chipOn]}>
                <Text style={[styles.chipText, turn === t.val && styles.chipTextOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'word' ? (
            <>
              <Text style={styles.rowLabel}>HARF SAYISI</Text>
              <View style={styles.chips}>
                {WORD_LENGTHS.map((w) => (
                  <Pressable key={String(w.val)} onPress={() => setWl(w.val)} style={[styles.chip, wl === w.val && styles.chipOn]}>
                    <Text style={[styles.chipText, wl === w.val && styles.chipTextOn]}>{w.label}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          <Pressable
            onPress={() => onConfirm(clock, turn, mode === 'word' ? wl : null)}
            disabled={busy}
            style={[styles.confirmBtn, busy && styles.confirmOff]}>
            {busy ? (
              <ActivityIndicator color={colors.ice} size="small" />
            ) : (
              <>
                <Feather name="send" size={15} color={colors.ice} />
                <Text style={styles.confirmText}>Meydan Oku</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/* ── Yanıt bekleniyor overlay'i (giden) ─────────────────────── */
function WaitingOverlay({
  visible,
  target,
  result,
  onCancel,
}: {
  visible: boolean;
  target: string;
  result: string | null;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.modalRoot}>
        <View style={styles.waitCard}>
          {result ? (
            <>
              <Feather name="x-circle" size={30} color={colors.danger} />
              <Text style={styles.waitTitle}>{result}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.cyan} size="large" />
              <Text style={styles.waitTitle}>{target}</Text>
              <Text style={styles.waitSub}>yanıt bekleniyor…</Text>
              <Pressable onPress={onCancel} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>İptal</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ── Gelen davet kartı (üstten kayar) ───────────────────────── */
function IncomingCard({
  incoming,
  rejecting,
  busy,
  onAccept,
  onStartReject,
  onReject,
  onDismissReject,
}: {
  incoming: IncomingChallenge;
  rejecting: boolean;
  busy: boolean;
  onAccept: () => void;
  onStartReject: () => void;
  onReject: (msg: string) => void;
  onDismissReject: () => void;
}) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(-40)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [slide]);

  return (
    <View style={[styles.cardWrap, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
      <Animated.View style={[styles.card, { opacity: slide.interpolate({ inputRange: [-40, 0], outputRange: [0, 1] }), transform: [{ translateY: slide }] }]}>
        <View style={styles.cardTop}>
          <View style={styles.cardAvatar}>
            <Text style={styles.cardAvatarText}>{(incoming.fromUsername.charAt(0) || '?').toUpperCase()}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.cardName} numberOfLines={1}>{incoming.fromUsername}</Text>
            <Text style={styles.cardMeta}>
              {modeLabel(incoming.mode)} · {clockLabel(incoming.clockMs)}
              {incoming.mode === 'word' ? ` · ${incoming.wordLength ?? 'Rastgele'} harf` : ''}
            </Text>
          </View>
          <Feather name="zap" size={18} color={colors.amber} />
        </View>

        {rejecting ? (
          <View style={styles.rejectMsgs}>
            {REJECT_MSGS.map((msg) => (
              <Pressable key={msg} onPress={() => onReject(msg)} disabled={busy} style={styles.rejectMsgBtn}>
                <Text style={styles.rejectMsgText}>{msg}</Text>
              </Pressable>
            ))}
            <Pressable onPress={onDismissReject} disabled={busy} hitSlop={8} style={styles.rejectBack}>
              <Feather name="arrow-left" size={14} color={colors.dim} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.cardActions}>
            <Pressable onPress={onStartReject} disabled={busy} style={[styles.actBtn, styles.rejectBtn]}>
              <Feather name="x" size={16} color={colors.danger} />
              <Text style={[styles.actText, { color: colors.danger }]}>Reddet</Text>
            </Pressable>
            <Pressable onPress={onAccept} disabled={busy} style={[styles.actBtn, styles.acceptBtn]}>
              {busy ? (
                <ActivityIndicator color={colors.ice} size="small" />
              ) : (
                <>
                  <Feather name="check" size={16} color={colors.ice} />
                  <Text style={[styles.actText, { color: colors.ice }]}>Onayla</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

/* ── Basit toast ────────────────────────────────────────────── */
function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <View style={[styles.toastWrap, { paddingTop: insets.top + 8 }]} pointerEvents="none">
      <View style={styles.toast}>
        <Feather name="info" size={14} color={colors.amber} />
        <Text style={styles.toastText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(5,9,18,0.72)' },
  sheet: {
    width: '100%', maxWidth: 360, borderRadius: 22, borderWidth: 1, borderColor: cyanAlpha(0.35),
    backgroundColor: 'rgba(10,20,40,0.99)', padding: 18, gap: 8,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  backBtn: {
    width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  sheetTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '800', color: colors.ice, fontFamily: mono },
  sheetSub: { textAlign: 'center', fontSize: 12, color: colors.dim, marginBottom: 6 },
  modeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 16,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  modeIcon: { width: 44, height: 44, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  modeName: { fontSize: 15, fontWeight: '800', color: colors.text, fontFamily: mono },
  modeSub: { fontSize: 11, color: colors.dim, marginTop: 2 },
  rowLabel: { fontFamily: mono, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, color: colors.dim, marginTop: 8 },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    flex: 1, minWidth: 56, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  chipWide: { minWidth: 120 },
  chipOn: { borderColor: colors.cyan, backgroundColor: cyanAlpha(0.14) },
  chipText: { fontSize: 13, fontWeight: '800', color: colors.dim, fontFamily: mono },
  chipTextOn: { color: colors.cyan },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 14,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: cyanAlpha(0.55), backgroundColor: cyanAlpha(0.2),
  },
  confirmOff: { opacity: 0.6 },
  confirmText: { fontSize: 14, fontWeight: '800', color: colors.ice, fontFamily: mono, letterSpacing: 0.5 },
  // waiting
  waitCard: {
    width: '100%', maxWidth: 300, borderRadius: 22, borderWidth: 1, borderColor: cyanAlpha(0.35),
    backgroundColor: 'rgba(10,20,40,0.99)', paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 10,
  },
  waitTitle: { fontSize: 16, fontWeight: '800', color: colors.ice, fontFamily: mono, textAlign: 'center' },
  waitSub: { fontSize: 12, color: colors.dim },
  cancelBtn: {
    marginTop: 8, paddingVertical: 9, paddingHorizontal: 24, borderRadius: 12,
    borderWidth: 1, borderColor: withAlpha(colors.danger, 0.4), backgroundColor: withAlpha(colors.danger, 0.1),
  },
  cancelText: { color: colors.danger, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  // incoming card
  cardWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, zIndex: 100 },
  card: {
    borderRadius: 18, borderWidth: 1.5, borderColor: cyanAlpha(0.5), backgroundColor: 'rgba(10,20,40,0.99)',
    padding: 12, gap: 10,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 12 }, default: {} }),
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardAvatar: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: colors.amber, backgroundColor: withAlpha(colors.amber, 0.18),
  },
  cardAvatarText: { color: colors.amber, fontSize: 18, fontWeight: '800', fontFamily: mono },
  cardName: { fontSize: 15, fontWeight: '800', color: colors.ice, fontFamily: mono },
  cardMeta: { fontSize: 11, color: colors.dim, fontFamily: mono, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: 8 },
  actBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5 },
  rejectBtn: { borderColor: withAlpha(colors.danger, 0.4), backgroundColor: withAlpha(colors.danger, 0.1) },
  acceptBtn: { borderColor: cyanAlpha(0.55), backgroundColor: cyanAlpha(0.2) },
  actText: { fontSize: 14, fontWeight: '800', fontFamily: mono },
  rejectMsgs: { gap: 6 },
  rejectMsgBtn: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder,
  },
  rejectMsgText: { fontSize: 13, color: colors.text, fontWeight: '600', textAlign: 'center' },
  rejectBack: { alignSelf: 'center', paddingVertical: 4 },
  // toast
  toastWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 120 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12,
    borderWidth: 1, borderColor: withAlpha(colors.amber, 0.4), backgroundColor: 'rgba(10,20,40,0.98)',
  },
  toastText: { fontSize: 12, color: colors.amber, fontFamily: mono },
});
