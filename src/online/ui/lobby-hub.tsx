import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { ChoiceCard, LobbyHeader } from './parts';

/** Online lobi ana ekranı: Hızlı Maç (hero) + Özel Oyun + "Nasıl çalışır?".
 *  Tasarımdaki sahte "çevrimiçi sayısı" rozet/sayaçları kaldırıldı (veri yok). */
export function LobbyHub({
  notice,
  onQuick,
  onPrivate,
  onHowTo,
  onBack,
}: {
  /** Lobiye dönüş nedeni bilgisi (ör. "Rakip ayrıldı, maç iptal edildi."). */
  notice?: string | null;
  onQuick: () => void;
  onPrivate: () => void;
  onHowTo: () => void;
  onBack: () => void;
}) {
  return (
    <View style={styles.root}>
      <LobbyHeader title="ÇEVRİMİÇİ" onBack={onBack} />

      {notice ? (
        <View style={styles.notice}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.heading}>
        <Text style={styles.headingLabel}>MOD SEÇ</Text>
        <View style={styles.headingRule} />
      </View>

      <View style={styles.cards}>
        <ChoiceCard
          hero
          icon="zap"
          accent={colors.cyan}
          title="Hızlı Maç"
          subtitle="Rastgele rakiple eşleş"
          onPress={onQuick}>
          <View style={styles.tags}>
            <Text style={styles.tag}>⏱ Satranç saati</Text>
            <Text style={styles.tag}>🔢 3 haneli kod</Text>
          </View>
        </ChoiceCard>

        <ChoiceCard
          icon="lock"
          accent={colors.amber}
          title="Özel Oyun"
          subtitle="Arkadaşınla oyna"
          onPress={onPrivate}
        />
      </View>

      <View style={styles.footer}>
        <Pressable onPress={onHowTo} hitSlop={8} style={styles.howTo}>
          <Feather name="help-circle" size={13} color={colors.dim} />
          <Text style={styles.howToText}>Nasıl çalışır?</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(colors.amber, 0.35),
    backgroundColor: withAlpha(colors.amber, 0.1),
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: colors.amber,
    lineHeight: 17,
  },
  heading: {
    marginTop: 12,
    marginBottom: 22,
    gap: 6,
  },
  headingLabel: {
    fontSize: 10,
    color: colors.dim,
    letterSpacing: 3,
    fontFamily: mono,
  },
  headingRule: {
    width: 32,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.cyan,
  },
  cards: {
    gap: 14,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  tag: {
    fontSize: 9,
    color: colors.dim,
    fontFamily: mono,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    paddingBottom: 16,
  },
  howTo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  howToText: {
    fontSize: 11,
    color: cyanAlpha(0.7),
    fontFamily: mono,
    textDecorationLine: 'underline',
  },
});
