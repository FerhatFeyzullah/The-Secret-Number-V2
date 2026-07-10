import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { adminAddWord, adminPoolSize, adminRemoveWord, adminVerifyPin, OnlineError } from '@/online';

import { GlassButton } from './glass';
import { colors, cyanAlpha, mono } from './theme';

const TR_WORD = /^[abcçdefgğhıijklmnoöprsştuüvyz]{4,6}$/;
const VOWEL = /[aeıioöuü]/;
const trLower = (s: string) => s.toLocaleLowerCase('tr').trim();
const PIN_LEN = 4;
// Özel sayı pad'i (sistem klavyesi AÇILMAZ). Sol-alt boş, sağ-alt sil.
const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

/** Gizli yönetici paneli: sürüm yazısına 5 kez basınca açılır. Önce PIN (özel
 *  sayı pad'i; SUNUCUDA doğrulanır), sonra kelime havuzuna (secret_words) ekleme.
 *  PIN kodda tutulmaz; sunucudaki hash'e karşı doğrulanır. */
export function AdminWordPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<'pin' | 'panel'>('pin');
  const [pin, setPin] = useState('');
  const [word, setWord] = useState('');
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Hangi işlem yürüyor (buton etiketleri için): 'add' | 'remove' | null.
  const [op, setOp] = useState<'add' | 'remove' | null>(null);

  const reset = () => {
    setPhase('pin');
    setPin('');
    setWord('');
    setPoolSize(null);
    setAdded([]);
    setMsg(null);
    setBusy(false);
    setOp(null);
  };
  const close = () => {
    reset();
    onClose();
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
      setPin(candidate); // ekleme çağrılarında sunucuya gider
      adminPoolSize()
        .then(setPoolSize)
        .catch(() => {});
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
              <Text style={styles.sub}>
                Havuz: {poolSize == null ? '…' : poolSize} kelime · yeni kelime ekle
              </Text>
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
                onSubmitEditing={() => void submit('add')}
              />
              <Text
                style={[
                  styles.msg,
                  (msg?.includes('eklendi') || msg?.includes('silindi')) && styles.ok,
                  !msg && styles.hidden,
                ]}>
                {msg ?? ' '}
              </Text>
              <View style={styles.actionRow}>
                <View style={styles.actionBtn}>
                  <GlassButton
                    label={busy && op === 'add' ? 'Ekleniyor…' : 'Ekle'}
                    accent={colors.cyan}
                    variant="fill"
                    disabled={busy}
                    onPress={() => void submit('add')}
                  />
                </View>
                <View style={styles.actionBtn}>
                  <GlassButton
                    label={busy && op === 'remove' ? 'Siliniyor…' : 'Sil'}
                    accent={colors.danger}
                    variant="outline"
                    disabled={busy}
                    onPress={() => void submit('remove')}
                  />
                </View>
              </View>
              {added.length ? (
                <Text style={styles.addedList} numberOfLines={2}>
                  Bu oturumda: {added.join(', ')}
                </Text>
              ) : null}
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
    maxWidth: 340,
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
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
