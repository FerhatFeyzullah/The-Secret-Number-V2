import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { GuessFeedback, OnlineGuess } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

/** Sunucu feedback'ini çip etiketi + rengine çevirir.
 *  Pozisyon bilgisi YOK — yalnızca doğru rakam sayısı / sıra bilgisi. */
function describe(feedback: GuessFeedback): { label: string; color: string } {
  switch (feedback) {
    case 'win':
      return { label: 'doğru sayı!', color: colors.success };
    case 'digits_correct_wrong_order':
      return { label: 'rakamlar doğru, yerler yanlış', color: colors.amber };
    case 'partial:2':
      return { label: '2 rakam doğru', color: colors.cyan };
    case 'partial:1':
      return { label: '1 rakam doğru', color: colors.dim };
    case 'partial:0':
      return { label: 'hiç doğru rakam yok', color: withAlpha(colors.dim, 0.6) };
  }
}

function FeedbackChip({ feedback }: { feedback: GuessFeedback }) {
  const { label, color } = describe(feedback);
  return (
    <View style={[styles.chip, { borderColor: withAlpha(color, 0.45), backgroundColor: withAlpha(color, 0.1) }]}>
      <View style={[styles.chipDot, { backgroundColor: color, boxShadow: `0 0 5px ${color}` }]} />
      <Text style={[styles.chipText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function GuessRow({ entry, attempt, top }: { entry: OnlineGuess; attempt: number; top: boolean }) {
  return (
    <View style={[styles.row, top ? styles.rowTop : styles.rowIdle]}>
      <Text style={styles.attempt}>{attempt}</Text>
      <Text style={styles.digits}>{entry.digits.split('').join(' ')}</Text>
      <FeedbackChip feedback={entry.feedback} />
    </View>
  );
}

/** Tahmin geçmişi — SADECE kendi tahminlerim, en yeni üstte. */
export function GuessHistory({ guesses }: { guesses: OnlineGuess[] }) {
  // En yeni üstte (servis eskiden yeniye verir).
  const data = [...guesses].reverse();
  const total = guesses.length;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerText}>TAHMİN GEÇMİŞİ</Text>
        <View style={styles.headerRule} />
        <Text style={styles.headerCount}>{total} tahmin</Text>
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => (
          <GuessRow entry={item} attempt={total - index} top={index === 0} />
        )}
        ListEmptyComponent={<Text style={styles.empty}>Henüz tahmin yok</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    marginBottom: 7,
  },
  headerText: {
    fontSize: 9,
    color: colors.dim,
    letterSpacing: 2,
    fontFamily: mono,
  },
  headerRule: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  headerCount: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
    opacity: 0.6,
  },
  listContent: {
    gap: 5,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 11,
  },
  rowTop: {
    backgroundColor: cyanAlpha(0.06),
    borderColor: cyanAlpha(0.18),
  },
  rowIdle: {
    backgroundColor: 'rgba(255,255,255,0.025)',
    borderColor: 'rgba(255,255,255,0.07)',
  },
  attempt: {
    fontSize: 9,
    color: withAlpha(colors.dim, 0.5),
    fontFamily: mono,
    width: 16,
    textAlign: 'right',
  },
  digits: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
    letterSpacing: 3,
    minWidth: 68,
  },
  chip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  chipText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: mono,
    letterSpacing: 0.3,
    flexShrink: 1,
  },
  empty: {
    textAlign: 'center',
    paddingVertical: 18,
    fontSize: 10,
    color: withAlpha(colors.dim, 0.4),
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
