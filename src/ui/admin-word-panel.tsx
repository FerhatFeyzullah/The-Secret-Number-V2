import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { upperTr } from '@/game';
import {
  adminAddWord,
  adminApproveWord,
  adminListWordRequests,
  adminPoolSize,
  adminRejectWord,
  adminRemoveWord,
  adminVerifyPin,
  OnlineError,
  type WordRequest,
} from '@/online';

import { GlassButton } from './glass';
import { colors, cyanAlpha, mono, withAlpha } from './theme';

const TR_WORD = /^[abcçdefgğhıijklmnoöprsştuüvyz]{4,6}$/;
const VOWEL = /[aeıioöuü]/;
const trLower = (s: string) => s.toLocaleLowerCase('tr').trim();
const PIN_LEN = 4;
// Özel sayı pad'i (sistem klavyesi AÇILMAZ). Sol-alt boş, sağ-alt sil.
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

type Tab = 'pending' | 'add' | 'remove';

/** Gizli yönetici paneli: sürüm yazısına 5 kez basınca açılır. Önce PIN (özel sayı
 *  pad'i; SUNUCUDA doğrulanır), sonra sekmeli havuz paneli: Onay Bekleyen (oyuncu
 *  önerileri → onayla/reddet) · Ekle · Sil. PIN kodda tutulmaz. */
export function AdminWordPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<'pin' | 'panel'>('pin');
  const [pin, setPin] = useState('');
  const [tab, setTab] = useState<Tab>('pending');
  const [word, setWord] = useState('');
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [op, setOp] = useState<'add' | 'remove' | null>(null);
  // Onay bekleyen öneriler (null = yükleniyor); reqBusy = işlemi yürüyen kelime.
  const [requests, setRequests] = useState<WordRequest[] | null>(null);
  const [reqBusy, setReqBusy] = useState<string | null>(null);

  const reset = () => {
    setPhase('pin');
    setPin('');
    setTab('pending');
    setWord('');
    setPoolSize(null);
    setAdded([]);
    setMsg(null);
    setBusy(false);
    setOp(null);
    setRequests(null);
    setReqBusy(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const loadRequests = (candidate: string) => {
    setRequests(null);
    adminListWordRequests(candidate)
      .then(setRequests)
      .catch(() => setRequests([]));
  };

  const unlock = async (candidate: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const ok = await adminVerifyPin(candidate);
      if (!ok) {
        setMsg('Yanlış PIN');
        setPin('');
        return;
      }
      setPhase('panel');
      setPin(candidate); // ekleme/onay çağrılarında sunucuya gider
      adminPoolSize()
        .then(setPoolSize)
        .catch(() => {});
      loadRequests(candidate);
    } catch {
      setMsg('Bağlantı hatası, tekrar dene.');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (k: string) => {
    if (busy) return;
    setMsg(null);
    if (k === '⌫') {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!k) return;
    setPin((p) => {
      if (p.length >= PIN_LEN) return p;
      const next = p + k;
      if (next.length === PIN_LEN) void unlock(next); // 4. hanede otomatik doğrula
      return next;
    });
  };

  const goTab = (t: Tab) => {
    setTab(t);
    setMsg(null);
  };

  const submit = async (mode: 'add' | 'remove') => {
    const w = trLower(word);
    if (!TR_WORD.test(w) || !VOWEL.test(w)) {
      setMsg('4-6 Türkçe harf olmalı');
      return;
    }
    setBusy(true);
    setOp(mode);
    setMsg(null);
    try {
      if (mode === 'add') {
        const status = await adminAddWord(w, pin);
        if (status === 'added') {
          setMsg(`"${w}" eklendi ✓`);
          setAdded((p) => [w, ...p]);
          setPoolSize((n) => (n == null ? n : n + 1));
          setWord('');
        } else if (status === 'exists') {
          setMsg(`"${w}" zaten havuzda`);
          setWord('');
        } else {
          setMsg('Geçersiz kelime');
        }
      } else {
        const status = await adminRemoveWord(w, pin);
        if (status === 'removed') {
          setMsg(`"${w}" silindi ✓`);
          setPoolSize((n) => (n == null ? n : Math.max(0, n - 1)));
          setWord('');
        } else {
          setMsg(`"${w}" havuzda yok`);
        }
      }
    } catch (e) {
      setMsg(
        e instanceof OnlineError && e.code === 'wrong_pin' ? 'PIN geçersiz' : 'Hata, tekrar dene.',
      );
    } finally {
      setBusy(false);
      setOp(null);
    }
  };

  const decide = async (w: string, action: 'approve' | 'reject') => {
    if (reqBusy) return;
    setReqBusy(w);
    setMsg(null);
    try {
      if (action === 'approve') {
        await adminApproveWord(w, pin);
        setPoolSize((n) => (n == null ? n : n + 1));
      } else {
        await adminRejectWord(w, pin);
      }
      setRequests((rs) => rs?.filter((r) => r.word !== w) ?? rs);
    } catch {
      setMsg('İşlem başarısız, tekrar dene.');
    } finally {
      setReqBusy(null);
    }
  };

  const pendingCount = requests?.length ?? 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={styles.backdrop} onPress={close} />

        <View style={styles.card}>
          {phase === 'pin' ? (
            <>
              <Text style={styles.title}>YÖNETİCİ GİRİŞİ</Text>
              <Text style={styles.sub}>PIN gir</Text>
              <View style={styles.dots}>
                {Array.from({ length: PIN_LEN }).map((_, i) => (
                  <View key={i} style={[styles.dot, i < pin.length && styles.dotOn]} />
                ))}
              </View>
              <Text style={[styles.err, !msg && styles.hidden]}>{msg ?? ' '}</Text>
              <View style={styles.keypad}>
                {KEYPAD.map((k, i) => (
                  <Pressable
                    key={i}
                    disabled={!k || busy}
                    onPress={() => onKey(k)}
                    style={({ pressed }) => [
                      styles.key,
                      !k && styles.keyEmpty,
                      pressed && k && styles.keyPressed,
                    ]}>
                    <Text style={[styles.keyText, k === '⌫' && styles.keyBack]}>{k}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>KELİME HAVUZU</Text>
              <Text style={styles.sub}>Havuz: {poolSize == null ? '…' : poolSize} kelime</Text>

              <View style={styles.tabs}>
                <Pressable
                  onPress={() => goTab('pending')}
                  style={[styles.tab, tab === 'pending' && styles.tabActive]}>
                  <Text style={[styles.tabText, tab === 'pending' && styles.tabTextActive]}>
                    Onay Bekleyen
                  </Text>
                  {pendingCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{pendingCount}</Text>
                    </View>
                  ) : null}
                </Pressable>
                <Pressable
                  onPress={() => goTab('add')}
                  style={[styles.tab, tab === 'add' && styles.tabActive]}>
                  <Text style={[styles.tabText, tab === 'add' && styles.tabTextActive]}>Ekle</Text>
                </Pressable>
                <Pressable
                  onPress={() => goTab('remove')}
                  style={[styles.tab, tab === 'remove' && styles.tabActive]}>
                  <Text style={[styles.tabText, tab === 'remove' && styles.tabTextActive]}>Sil</Text>
                </Pressable>
              </View>

              {tab === 'pending' ? (
                requests == null ? (
                  <Text style={styles.emptyList}>Yükleniyor…</Text>
                ) : requests.length === 0 ? (
                  <Text style={styles.emptyList}>Bekleyen istek yok.</Text>
                ) : (
                  <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
                    {requests.map((r) => (
                      <View key={r.word} style={styles.req}>
                        <Text style={styles.reqWord} numberOfLines={1}>
                          {upperTr(r.word)}
                        </Text>
                        <Text style={styles.reqCount}>×{r.count}</Text>
                        <View style={styles.reqActs}>
                          <Pressable
                            disabled={reqBusy != null}
                            onPress={() => void decide(r.word, 'approve')}
                            style={({ pressed }) => [
                              styles.mini,
                              styles.miniOk,
                              pressed && styles.miniPressed,
                            ]}>
                            <Text style={styles.miniOkText}>Onayla</Text>
                          </Pressable>
                          <Pressable
                            disabled={reqBusy != null}
                            onPress={() => void decide(r.word, 'reject')}
                            style={({ pressed }) => [
                              styles.mini,
                              styles.miniNo,
                              pressed && styles.miniPressed,
                            ]}>
                            <Text style={styles.miniNoText}>Reddet</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                )
              ) : (
                <>
                  <TextInput
                    style={styles.wordInput}
                    value={word}
                    onChangeText={setWord}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={6}
                    autoFocus
                    placeholder="kelime (4-6 harf)"
                    placeholderTextColor={colors.dim}
                    onSubmitEditing={() => void submit(tab === 'add' ? 'add' : 'remove')}
                  />
                  <Text
                    style={[
                      styles.msg,
                      (msg?.includes('eklendi') || msg?.includes('silindi')) && styles.ok,
                      !msg && styles.hidden,
                    ]}>
                    {msg ?? ' '}
                  </Text>
                  {tab === 'add' ? (
                    <GlassButton
                      label={busy && op === 'add' ? 'Ekleniyor…' : 'Ekle'}
                      accent={colors.cyan}
                      variant="fill"
                      disabled={busy}
                      onPress={() => void submit('add')}
                    />
                  ) : (
                    <GlassButton
                      label={busy && op === 'remove' ? 'Siliniyor…' : 'Sil'}
                      accent={colors.danger}
                      variant="outline"
                      disabled={busy}
                      onPress={() => void submit('remove')}
                    />
                  )}
                  {tab === 'add' && added.length ? (
                    <Text style={styles.addedList} numberOfLines={2}>
                      Bu oturumda: {added.join(', ')}
                    </Text>
                  ) : null}
                </>
              )}
            </>
          )}

          <GlassButton label="Kapat" accent={colors.dim} small onPress={close} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,8,18,0.88)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '86%',
    backgroundColor: colors.bgMid, // OPAK — arka plan görünmez
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 20,
    padding: 22,
    gap: 10,
    boxShadow: `0 12px 48px rgba(0,0,0,0.6)`,
  },
  title: {
    color: colors.cyan,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    fontFamily: mono,
  },
  sub: {
    color: colors.dim,
    fontSize: 13,
  },
  // ── Sekme çubuğu ──
  tabs: {
    flexDirection: 'row',
    gap: 4,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 12,
    marginTop: 2,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActive: {
    backgroundColor: cyanAlpha(0.16),
    borderColor: withAlpha(colors.cyan, 0.4),
    boxShadow: `0 0 12px -2px ${withAlpha(colors.cyan, 0.4)}`,
  },
  tabText: {
    color: colors.dim,
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  tabTextActive: {
    color: colors.ice,
  },
  badge: {
    minWidth: 16,
    paddingHorizontal: 4,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#06121f',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: mono,
  },
  // ── Onay bekleyen liste ──
  list: {
    maxHeight: 260,
  },
  listInner: {
    gap: 8,
    paddingRight: 2,
  },
  emptyList: {
    color: colors.dim,
    fontFamily: mono,
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 28,
  },
  req: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  reqWord: {
    flex: 1,
    color: colors.text,
    fontFamily: mono,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  reqCount: {
    color: colors.dim,
    fontFamily: mono,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  reqActs: {
    flexDirection: 'row',
    gap: 6,
  },
  mini: {
    borderRadius: 9,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
  },
  miniPressed: {
    opacity: 0.6,
  },
  miniOk: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
  },
  miniOkText: {
    color: '#06121f',
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  miniNo: {
    backgroundColor: 'transparent',
    borderColor: withAlpha(colors.danger, 0.5),
  },
  miniNoText: {
    color: colors.danger,
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  // PIN noktaları
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
    marginTop: 8,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: colors.glassBorder,
    backgroundColor: 'transparent',
  },
  dotOn: {
    backgroundColor: colors.cyan,
    borderColor: colors.cyan,
    boxShadow: `0 0 10px ${colors.cyan}`,
  },
  // Sayı pad'i (3 sütun)
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    marginTop: 4,
  },
  key: {
    width: '31%',
    aspectRatio: 1.7,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  keyEmpty: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  keyPressed: {
    backgroundColor: cyanAlpha(0.2),
    borderColor: colors.cyan,
  },
  keyText: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: mono,
  },
  keyBack: {
    color: colors.dim,
  },
  wordInput: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 18,
    fontFamily: mono,
    marginTop: 4,
  },
  err: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    minHeight: 18,
  },
  msg: {
    color: colors.dim,
    fontSize: 13,
    minHeight: 18,
  },
  ok: {
    color: colors.success,
    fontWeight: '700',
  },
  hidden: {
    opacity: 0,
  },
  addedList: {
    color: colors.dim,
    fontSize: 11,
    fontFamily: mono,
  },
});
