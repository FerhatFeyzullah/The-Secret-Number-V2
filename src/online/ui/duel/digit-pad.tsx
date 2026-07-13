import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, cyanAlpha, mono } from '@/ui/theme';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/** Tek hane kutusu: dolu/aktif/kilitli durumlar + imleç blink. */
function DigitBox({ value, active, locked }: { value: string; active: boolean; locked: boolean }) {
  const blink = useRef(new Animated.Value(1)).current;
  const showCursor = active && !value && !locked;
  useEffect(() => {
    if (!showCursor) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 0, delay: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 0, delay: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [showCursor, blink]);

  return (
    <View
      style={[
        styles.box,
        value ? styles.boxFilled : active ? styles.boxActive : styles.boxIdle,
        locked && styles.boxLocked,
      ]}>
      {showCursor ? <Animated.View style={[styles.cursor, { opacity: blink }]} /> : null}
      <Text style={styles.boxText}>{value}</Text>
    </View>
  );
}

/** 3D basılabilen tuş (sayı / aksiyon / gönder). */
function PadKey({
  children,
  onPress,
  disabled,
  variant = 'digit',
  flex = 1,
}: {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'digit' | 'action' | 'submit';
  flex?: number;
}) {
  const submit = variant === 'submit';
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.key,
        submit ? styles.keySubmit : variant === 'action' ? styles.keyAction : styles.keyDigit,
        { flex, height: submit ? 48 : 44 }, // kompakt; dokunma hedefi ≥44px kalır
        !pressed && !disabled && (submit ? styles.key3dSubmit : styles.key3d),
        pressed && !disabled && styles.keyPressed,
        disabled && styles.keyDisabled,
      ]}>
      {children}
    </Pressable>
  );
}

/** Tahmin girişi + tuş takımı. Sırada değilken kilitli/sönük.
 *  accessory: giriş panelinin sağına iliştirilen kapsül (kendi saatin). */
export function DigitPad({
  guess,
  locked,
  onDigit,
  onDelete,
  onSubmit,
  accessory,
  emoteSlot,
}: {
  guess: string[];
  locked: boolean;
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  accessory?: React.ReactNode;
  /** Alt aksiyon satırının soluna iliştirilen emote/mesaj butonu (maç-içi). */
  emoteSlot?: React.ReactNode;
}) {
  const used = new Set(guess);
  const full = guess.length >= 3;

  return (
    <>
      {/* Giriş kutuları (+ yanında kendi saatin) */}
      <View style={styles.entryRow}>
        <View style={[styles.panel, styles.entry, locked && styles.panelLocked]}>
          <Text style={styles.caption}>RAKİBİN KODUNU KIR</Text>
          <View style={styles.boxes}>
            {[0, 1, 2].map((i) => (
              <DigitBox key={i} value={guess[i] || ''} active={guess.length === i} locked={locked} />
            ))}
          </View>
        </View>
        {accessory}
      </View>

      {/* Tuş takımı */}
      <View style={[styles.panel, styles.pad, locked && styles.padLocked]}>
        <View style={styles.grid}>
          {[0, 1, 2].map((row) => (
            <View key={row} style={styles.gridRow}>
              {DIGITS.slice(row * 3, row * 3 + 3).map((d) => (
                <PadKey
                  key={d}
                  onPress={() => onDigit(d)}
                  disabled={locked || used.has(d) || full}>
                  <Text style={styles.digitText}>{d}</Text>
                </PadKey>
              ))}
            </View>
          ))}
        </View>
        <View style={styles.bottomRow}>
          {emoteSlot}
          <PadKey variant="action" onPress={onDelete} disabled={locked || guess.length === 0}>
            <Feather name="delete" size={18} color={colors.dim} />
          </PadKey>
          <PadKey variant="submit" flex={2} onPress={onSubmit} disabled={locked || !full}>
            <Text style={styles.submitText}>TAHMİN ET</Text>
          </PadKey>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  entryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  panel: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    padding: 10,
  },
  entry: {
    flex: 1,
  },
  panelLocked: {
    opacity: 0.4,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  caption: {
    fontSize: 9,
    color: colors.dim,
    letterSpacing: 2,
    fontFamily: mono,
    textAlign: 'center',
    marginBottom: 7,
  },
  boxes: {
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
  },
  box: {
    width: 52,
    height: 56,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxIdle: {
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  boxActive: {
    backgroundColor: cyanAlpha(0.06),
    borderColor: cyanAlpha(0.5),
    boxShadow: `0 0 18px ${cyanAlpha(0.35)}`,
  },
  boxFilled: {
    backgroundColor: cyanAlpha(0.12),
    borderColor: cyanAlpha(0.55),
    boxShadow: `0 0 10px ${cyanAlpha(0.2)}`,
  },
  boxLocked: {
    opacity: 0.38,
  },
  cursor: {
    position: 'absolute',
    width: 2,
    height: 22,
    borderRadius: 2,
    backgroundColor: colors.cyan,
    boxShadow: `0 0 6px ${colors.cyan}`,
  },
  boxText: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    textShadowColor: colors.cyan,
    textShadowRadius: 14,
  },
  pad: {
    paddingHorizontal: 10,
    gap: 6,
  },
  padLocked: {
    opacity: 0.28,
  },
  grid: {
    gap: 6,
  },
  gridRow: {
    flexDirection: 'row',
    gap: 6,
  },
  bottomRow: {
    flexDirection: 'row',
    gap: 6,
  },
  key: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyDigit: {
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  keyAction: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  keySubmit: {
    backgroundColor: cyanAlpha(0.22),
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.47),
  },
  key3d: {
    boxShadow: '0 2px 0 rgba(0,0,0,0.25)',
  },
  key3dSubmit: {
    boxShadow: `0 3px 0 ${colors.cyanDeep}, 0 0 16px ${cyanAlpha(0.35)}`,
  },
  keyPressed: {
    transform: [{ translateY: 2 }],
  },
  keyDisabled: {
    opacity: 0.25,
  },
  digitText: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
  },
  submitText: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.ice,
    fontFamily: mono,
    letterSpacing: 2,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 8,
  },
});
