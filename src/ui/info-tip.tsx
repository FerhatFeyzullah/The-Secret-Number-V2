import { StyleSheet, Text, View } from 'react-native';

import { colors, mono, withAlpha } from './theme';

/** Ana ekran (ve ileride başka yerler) için basılı-tut bilgi metinleri —
 *  TEK kaynaktan yönetilir. Yeni öğe eklemek için buraya bir kayıt ekle. */
export const TIPS = {
  rating: {
    title: 'Kupa Puanı',
    body: 'Rekabet sıralaman; Hızlı ve Protokol maçlarını kazandıkça artar, kaybedince düşer.',
    accent: colors.amber,
  },
  veri: {
    title: 'Veri',
    body: 'Maçlardan kazanılır; protokol ve emoji açmak için harcanır.',
    accent: colors.cyan,
  },
} as const satisfies Record<string, { title: string; body: string; accent: string }>;

export type TipId = keyof typeof TIPS;

/** Camsı/neon, küçük bilgi balonu (yalnız gösterim). Konumlandırmayı çağıran
 *  yapar (öğenin yakınında, ekran kenarına taşmadan). */
export function InfoTipBubble({
  title,
  body,
  accent = colors.cyan,
}: {
  title: string;
  body: string;
  accent?: string;
}) {
  return (
    <View style={[styles.bubble, { borderColor: withAlpha(accent, 0.5) }]}>
      <Text style={[styles.title, { color: accent }]}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    maxWidth: 240,
    gap: 3,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 13,
    borderWidth: 1,
    backgroundColor: 'rgba(8,15,30,0.96)',
    boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  body: {
    fontSize: 10,
    color: colors.dim,
    fontFamily: mono,
    lineHeight: 14,
  },
});
