import { Feather } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import { GlassButton } from '@/ui/glass';
import { colors, mono, withAlpha } from '@/ui/theme';
import { Emblem, LobbyHeader } from './parts';

const LEN = 6;
const VALID = /[A-Z0-9]/;

/** Oda kodu girişi (6 segment). Geçerli kod tamamlanınca "Katıl" aktif olur;
 *  sunucudan dönen hata tasarımdaki inline stilde gösterilir. */
export function JoinRoomScreen({
  error,
  busy,
  onJoin,
  onBack,
}: {
  error?: string | null;
  busy?: boolean;
  onJoin: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState<string[]>(Array(LEN).fill(''));
  const refs = useRef<(TextInput | null)[]>([]);
  const full = code.every((c) => c !== '');

  const setAt = (i: number, value: string) => {
    const ch = value.toUpperCase().slice(-1);
    if (ch && !VALID.test(ch)) return;
    setCode((prev) => {
      const next = [...prev];
      next[i] = ch;
      return next;
    });
    if (ch && i < LEN - 1) refs.current[i + 1]?.focus();
  };

  const onKey = (i: number, e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (e.nativeEvent.key !== 'Backspace') return;
    if (code[i] === '' && i > 0) {
      refs.current[i - 1]?.focus();
      setCode((prev) => {
        const next = [...prev];
        next[i - 1] = '';
        return next;
      });
    }
  };

  return (
    <View style={styles.root}>
      <LobbyHeader title="ODA BUL" onBack={onBack} />
      <View style={styles.body}>
        <Emblem icon="log-in" accent={colors.amber} size={72} iconSize={32} fillIcon />
        <Text style={styles.label}>ODA KODUNU GİR</Text>

        <View style={styles.inputs}>
          {code.map((ch, i) => (
            <TextInput
              key={i}
              ref={(el) => {
                refs.current[i] = el;
              }}
              value={ch}
              onChangeText={(v) => setAt(i, v)}
              onKeyPress={(e) => onKey(i, e)}
              maxLength={1}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardType="default"
              selectTextOnFocus
              autoFocus={i === 0}
              style={[styles.cell, ch ? styles.cellFilled : styles.cellEmpty]}
            />
          ))}
        </View>

        <View style={styles.errorRow}>
          {error ? (
            <>
              <Feather name="alert-circle" size={12} color={colors.danger} />
              <Text style={styles.errorText} selectable>
                {error}
              </Text>
            </>
          ) : null}
        </View>

        <View style={styles.action}>
          <GlassButton
            label={busy ? 'Katılınıyor…' : 'Katıl'}
            accent={colors.amber}
            variant="fill"
            disabled={!full || busy}
            onPress={() => onJoin(code.join(''))}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 36,
  },
  label: {
    fontSize: 12,
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 2,
    marginTop: 24,
    marginBottom: 22,
  },
  inputs: {
    flexDirection: 'row',
    gap: 8,
  },
  cell: {
    width: 46,
    height: 62,
    borderRadius: 12,
    borderWidth: 2,
    textAlign: 'center',
    fontSize: 26,
    fontWeight: '800',
    color: colors.amber,
    fontFamily: mono,
  },
  cellEmpty: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: withAlpha('#ffffff', 0.14),
  },
  cellFilled: {
    backgroundColor: 'rgba(255,200,87,0.1)',
    borderColor: withAlpha(colors.amber, 0.55),
  },
  errorRow: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    marginBottom: 24,
  },
  errorText: {
    fontSize: 11,
    color: colors.danger,
  },
  action: {
    width: '100%',
    paddingHorizontal: 16,
  },
});
