import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { getToggle, type GameMode } from '../storage';
import { colors, cyanAlpha } from './theme';

const canHaptics = Platform.OS === 'ios' || Platform.OS === 'android';

async function tapHaptic() {
  if (!canHaptics) return;
  if (await getToggle('haptics')) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

const OPTIONS: { mode: GameMode; label: string; icon: 'person' | 'globe'; accent: string }[] = [
  { mode: 'solo', label: 'Tek Kişilik', icon: 'person', accent: colors.cyan },
  { mode: 'online', label: 'Çok Oyunculu', icon: 'globe', accent: colors.amber },
];

/** Mod seçici segment: seçili olan kabarık + parlak (moda göre camgöbeği/amber),
 *  seçili olmayan gömük ve sönük. Seçim değişince hafif haptik. */
export function ModeSegment({
  value,
  onChange,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
}) {
  const select = (mode: GameMode) => {
    if (mode === value) return;
    tapHaptic();
    onChange(mode);
  };

  return (
    <View style={styles.track}>
      {OPTIONS.map(({ mode, label, icon, accent }) => {
        const selected = mode === value;
        return (
          <Pressable
            key={mode}
            onPress={() => select(mode)}
            style={[
              styles.option,
              selected && [
                styles.selected,
                {
                  borderColor: accent,
                  backgroundColor:
                    mode === 'solo' ? cyanAlpha(0.14) : 'rgba(255, 200, 87, 0.14)',
                  shadowColor: accent,
                },
              ],
            ]}>
            <Ionicons
              name={selected ? icon : (`${icon}-outline` as const)}
              size={16}
              color={selected ? accent : colors.dim}
            />
            <Text style={[styles.label, selected && { color: accent }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.28)', // gömük zemin
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 14,
    padding: 5,
  },
  option: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selected: {
    // Kabarık his: iOS'ta ince neon glow (shadowColor inline accent ile).
    // Android'de elevation Material gölgesi, yarı saydam turuncu/camgöbeği dolgunun
    // ardına KOYU bir leke basıyordu (iOS'ta sorun yok) → Android'de kapatıldı.
    // Seçili durum zaten accent kenar + renkli dolgu ile net belli.
    ...Platform.select({
      ios: { shadowOpacity: 0.5, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
      android: { elevation: 0 },
      default: {},
    }),
  },
  label: {
    color: colors.dim,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
