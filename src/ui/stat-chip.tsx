import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, mono } from './theme';

/** Uzun sayıları chip'e sığacak şekilde kısaltır (1200 → "1,2k"). */
export function formatStat(value: number): string {
  if (value < 1000) return String(value);
  const k = value / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`.replace('.', ',');
}

/** Yarı saydam hap şeklinde küçük istatistik rozeti: solda ikon, sağda değer. */
export function StatChip({
  icon,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={12} color={colors.amber} />
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  value: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: mono,
  },
});
