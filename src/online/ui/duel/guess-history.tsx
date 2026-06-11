import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { GuessFeedback, OnlineGuess } from '@/online';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

/** Sis Perdesi: işaretli tahminin feedback'i bu kadar geç gösterilir
 *  (yalnız gösterim; sunucu değerlendirmesi aynen yapılmıştır). */
const FOG_MS = 4000;

/** Sunucu feedback'ini çip etiketi + rengine çevirir.
 *  Pozisyon bilgisi YOK — yalnızca doğru rakam sayısı / sıra bilgisi.
 *  (İçerik tipi kayıt defteri content-ui.tsx de bunu kullanır.) */
export function describe(feedback: GuessFeedback): { label: string; color: string } {
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
    // Kelime moduna ait değerler (sayı maçında üretilmez; tip bütünlüğü için).
    case 'partial:3':
      return { label: '3 harf doğru', color: colors.cyan };
    case 'partial:4':
      return { label: '4 harf doğru', color: colors.cyan };
    case 'partial:5':
      return { label: '5 harf doğru', color: colors.cyan };
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

/** Sisli tahmin: feedback 4 sn maskelenir, sonra normal çip açılır. */
function FoggedAwareChip({ entry }: { entry: OnlineGuess }) {
  const [, setRevealed] = useState(0);
  const age = Date.now() - Date.parse(entry.createdAt);
  const masked = !!entry.fogged && age < FOG_MS;
  useEffect(() => {
    if (!masked) return;
    const t = setTimeout(() => setRevealed((x) => x + 1), FOG_MS - age + 60);
    return () => clearTimeout(t);
    // age her render değişir; maske bir kez açılır — yalnız masked izlenir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masked, entry.id]);
  if (masked) {
    return (
      <View style={[styles.chip, styles.fogChip]}>
        <Feather name="cloud" size={9} color={colors.dim} />
        <Text style={[styles.chipText, { color: colors.dim }]} numberOfLines={1}>
          sis perdesi…
        </Text>
      </View>
    );
  }
  return <FeedbackChip feedback={entry.feedback} />;
}

function GuessRow({ entry, attempt, top }: { entry: OnlineGuess; attempt: number; top: boolean }) {
  return (
    <View style={[styles.row, top ? styles.rowTop : styles.rowIdle]}>
      <Text style={styles.attempt}>{attempt}</Text>
      <Text style={styles.digits}>{entry.digits.split('').join(' ')}</Text>
      <FoggedAwareChip entry={entry} />
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
    marginBottom: 5,
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
    gap: 4,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
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
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    fontFamily: mono,
    letterSpacing: 3,
    minWidth: 60,
  },
  chip: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  chipDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  fogChip: {
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
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
    paddingVertical: 12,
    fontSize: 10,
    color: withAlpha(colors.dim, 0.4),
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
