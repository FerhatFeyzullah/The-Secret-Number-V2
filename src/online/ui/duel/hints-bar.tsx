import { Feather } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import type { GuessFeedback, ProtocolHint } from '@/online';
import { colors, mono, withAlpha } from '@/ui/theme';

import type { FeatherName } from '../parts';

/** Çip için kısa feedback etiketi (pozisyon sızdırma kuralları aynen —
 *  bu, rakibin tahminine ZATEN verilmiş feedback'tir). */
function shortFeedback(fb: GuessFeedback): string {
  switch (fb) {
    case 'win':
      return 'buldu!';
    case 'digits_correct_wrong_order':
      return 'yerler yanlış';
    case 'partial:2':
      return '2 doğru';
    case 'partial:1':
      return '1 doğru';
    case 'partial:0':
      return '0 doğru';
  }
}

function Chip({ icon, text, color }: { icon: FeatherName; text: string; color: string }) {
  return (
    <View
      style={[
        styles.chip,
        { borderColor: withAlpha(color, 0.4), backgroundColor: withAlpha(color, 0.1) },
      ]}>
      <Feather name={icon} size={10} color={color} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** Bilgi protokollerinin verdiği KALICI ipuçları (yalnız bu turun; oyuncu
 *  unutmasın): Eleme "n YOK", Sayı İşareti "n VAR", Konum Testi "n→p EVET/
 *  HAYIR", Rakip Okuması "son tahmin + feedback". Yalnız kendi bilgilerin. */
export function HintsBar({
  eliminated,
  hints,
}: {
  eliminated: number[];
  hints: ProtocolHint[];
}) {
  if (eliminated.length === 0 && hints.length === 0) return null;
  return (
    <View style={styles.root}>
      <Text style={styles.label}>İPUÇLARI</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}>
        {eliminated.map((d) => (
          <Chip key={`e${d}`} icon="slash" text={`${d} YOK`} color={colors.amber} />
        ))}
        {hints.map((h, i) => {
          if (h.t === 'reveal') {
            return <Chip key={`h${i}`} icon="hash" text={`${h.digit} VAR`} color={colors.success} />;
          }
          if (h.t === 'postest') {
            return (
              <Chip
                key={`h${i}`}
                icon="map-pin"
                text={`${h.digit}→${h.pos}. ${h.match ? 'EVET' : 'HAYIR'}`}
                color={h.match ? colors.success : colors.danger}
              />
            );
          }
          return (
            <Chip
              key={`h${i}`}
              icon="search"
              text={`Rakip ${h.digits.split('').join(' ')} · ${shortFeedback(h.feedback)}`}
              color={colors.cyan}
            />
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  label: {
    fontSize: 8,
    color: colors.dim,
    letterSpacing: 1.5,
    fontFamily: mono,
  },
  row: {
    gap: 6,
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  chipText: {
    fontSize: 9,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
});
