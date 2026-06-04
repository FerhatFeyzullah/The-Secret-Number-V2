import { StyleSheet, Text, View } from 'react-native';

import { colors, mono } from './theme';

/** Alt satırdaki detay istatistik kartı: üstte büyük değer, altta küçük etiket.
 *  Camsı zemin; değerin rengi isteğe bağlı (varsayılan: aydınlık metin). */
export function StatCard({
  value,
  label,
  accent = colors.text,
}: {
  value: string;
  label: string;
  accent?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={[styles.value, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  value: {
    fontSize: 21,
    fontWeight: '800',
    fontFamily: mono,
  },
  label: {
    color: colors.dim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
});
