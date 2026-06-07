import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const POSITIONS = [1, 2, 3];

/** Konum Testi (info_postest) girişi: bir rakam + bir pozisyon seç → sunucuya
 *  sor ("5, 2. pozisyonda mı?"). Yalnız evet/hayır döner; doğrulama sunucuda. */
export function PostestPrompt({
  visible,
  busy,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  busy: boolean;
  onSubmit: (digit: number, position: number) => void;
  onClose: () => void;
}) {
  const [digit, setDigit] = useState<number | null>(null);
  const [pos, setPos] = useState<number | null>(null);

  // Her açılışta temiz başla.
  useEffect(() => {
    if (visible) {
      setDigit(null);
      setPos(null);
    }
  }, [visible]);

  if (!visible) return null;
  const ready = digit != null && pos != null && !busy;

  return (
    <View style={styles.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : onClose} />
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.headIcon}>
            <Feather name="map-pin" size={16} color={colors.violet} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>KONUM TESTİ</Text>
            <Text style={styles.subtitle}>Bir rakam + pozisyon seç — o pozisyonda mı?</Text>
          </View>
          <Pressable onPress={busy ? undefined : onClose} hitSlop={10} style={styles.close}>
            <Feather name="x" size={14} color={colors.dim} />
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>RAKAM</Text>
        <View style={styles.digitGrid}>
          {DIGITS.map((d) => (
            <Pressable
              key={d}
              onPress={() => setDigit(d)}
              style={({ pressed }) => [
                styles.digitKey,
                digit === d && styles.keyOn,
                pressed && styles.keyPressed,
              ]}>
              <Text style={[styles.digitText, digit === d && styles.keyTextOn]}>{d}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionLabel}>POZİSYON</Text>
        <View style={styles.posRow}>
          {POSITIONS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPos(p)}
              style={({ pressed }) => [
                styles.posKey,
                pos === p && styles.keyOn,
                pressed && styles.keyPressed,
              ]}>
              <Text style={[styles.posText, pos === p && styles.keyTextOn]}>{p}.</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          onPress={ready ? () => onSubmit(digit!, pos!) : undefined}
          disabled={!ready}
          style={[styles.submit, !ready && styles.submitOff]}>
          {busy ? (
            <ActivityIndicator color={colors.ice} size="small" />
          ) : (
            <Text style={[styles.submitText, !ready && { color: colors.dim }]}>SOR</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    backgroundColor: 'rgba(6,12,26,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.bgMid,
    borderWidth: 1,
    borderColor: withAlpha(colors.violet, 0.35),
    borderRadius: 18,
    padding: 16,
    gap: 8,
    boxShadow: `0 0 30px ${withAlpha(colors.violet, 0.2)}`,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  headIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: withAlpha(colors.violet, 0.5),
    backgroundColor: withAlpha(colors.violet, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.ice,
    fontFamily: mono,
  },
  subtitle: {
    fontSize: 9,
    color: colors.dim,
    marginTop: 2,
  },
  close: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 8,
    color: colors.dim,
    letterSpacing: 2,
    fontFamily: mono,
    marginTop: 4,
  },
  digitGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  digitKey: {
    width: '9.5%',
    minWidth: 34,
    height: 38,
    flexGrow: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posKey: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posRow: {
    flexDirection: 'row',
    gap: 6,
  },
  keyOn: {
    borderColor: withAlpha(colors.violet, 0.6),
    backgroundColor: withAlpha(colors.violet, 0.18),
  },
  keyPressed: {
    transform: [{ scale: 0.95 }],
  },
  digitText: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
  },
  posText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
  },
  keyTextOn: {
    color: colors.violet,
  },
  submit: {
    marginTop: 8,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.5),
    backgroundColor: cyanAlpha(0.2),
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitOff: {
    opacity: 0.45,
  },
  submitText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
  },
});
