import { Feather } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getSignal } from '@/signals/catalog';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { useTabsPager } from '@/ui/tabs-pager-context';

export const DECK_MAX = 6;

/** Sinyal destesi paneli (Donanım · Emoji sekmesi). Saf/kontrollü: veri ve deste
 *  üst ekrandan (DonanimScreen) gelir; slot/karta dokunuş onToggle ile bildirilir.
 *  Kendi Screen sarmalayıcısı, header'ı, yükleme/hata durumu YOK. */
export function SignalDeckPanel({
  owned,
  deck,
  onToggle,
}: {
  owned: string[];
  deck: string[];
  onToggle: (id: string) => void;
}) {
  const { goToTab } = useTabsPager();
  const extras = owned.filter((id) => !deck.includes(id));

  return (
    <ScrollView
      style={styles.flex}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}>
      {/* DESTEM */}
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>DESTEM</Text>
        <Text style={styles.count}>
          <Text style={{ color: colors.cyan }}>{deck.length}</Text>
          <Text style={{ color: colors.dim }}> / {DECK_MAX}</Text>
        </Text>
      </View>
      <View style={styles.slots}>
        {Array.from({ length: DECK_MAX }).map((_, i) => {
          const id = deck[i];
          const sig = id ? getSignal(id) : undefined;
          if (sig) {
            const Icon = sig.component;
            return (
              <Pressable key={i} onPress={() => onToggle(sig.id)} style={[styles.slot, styles.slotFull]}>
                <Icon size={42} animated />
                <View style={styles.slotRemove}>
                  <Feather name="x" size={10} color={colors.bgTop} />
                </View>
              </Pressable>
            );
          }
          return (
            <View key={i} style={[styles.slot, styles.slotEmpty]}>
              <Feather name="plus" size={18} color={withAlpha(colors.dim, 0.5)} />
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>Slottaki sinyale dokun → desteden çıkar</Text>

      {/* SAHİP OLDUKLARIM */}
      <View style={[styles.sectionHead, { marginTop: 20 }]}>
        <Text style={styles.sectionLabel}>SAHİP OLDUKLARIM</Text>
        <Text style={styles.count}>
          <Text style={{ color: colors.teal }}>{owned.length}</Text>
        </Text>
      </View>
      <View style={styles.grid}>
        {owned.map((id) => {
          const sig = getSignal(id);
          if (!sig) return null;
          const Icon = sig.component;
          const inDeck = deck.includes(id);
          return (
            <Pressable
              key={id}
              onPress={() => onToggle(id)}
              style={({ pressed }) => [styles.card, inDeck && styles.cardInDeck, pressed && styles.cardPressed]}>
              <View style={inDeck ? styles.dimIcon : undefined}>
                <Icon size={52} animated={false} />
              </View>
              <Text style={styles.cardName} numberOfLines={1}>
                {sig.name}
              </Text>
              {inDeck ? (
                <View style={styles.deckTag}>
                  <Feather name="check" size={10} color={colors.cyan} />
                  <Text style={styles.deckTagText}>Destede</Text>
                </View>
              ) : (
                <Text style={styles.addText}>+ Ekle</Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {extras.length === 0 ? (
        <Pressable onPress={() => goToTab('store')} style={styles.shopHint}>
          <Feather name="shopping-bag" size={13} color={colors.cyan} />
          <Text style={styles.shopHintText}>Daha fazla sinyal için Mağaza’ya git</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scroll: {
    paddingBottom: 28,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
    fontWeight: '800',
  },
  count: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: mono,
  },
  slots: {
    flexDirection: 'row',
    gap: 8,
  },
  slot: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFull: {
    backgroundColor: cyanAlpha(0.1),
    borderWidth: 1.5,
    borderColor: cyanAlpha(0.5),
  },
  slotEmpty: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.14)',
  },
  slotRemove: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.cyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 9,
    color: withAlpha(colors.dim, 0.7),
    fontFamily: mono,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: 0.3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    // Sabit genişlik + flexGrow YOK → tek kalan kart iki kart enine yayılmaz;
    // %30 + 10px gap dar ekranda da 3 sütunu güvenle sığdırır (sarmaz).
    width: '30%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  cardInDeck: {
    borderColor: cyanAlpha(0.4),
    backgroundColor: cyanAlpha(0.08),
  },
  cardPressed: {
    transform: [{ scale: 0.97 }],
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  dimIcon: {
    opacity: 0.5,
  },
  cardName: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  deckTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: cyanAlpha(0.12),
    borderWidth: 1,
    borderColor: cyanAlpha(0.32),
  },
  deckTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  addText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.dim,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  shopHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 18,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cyanAlpha(0.3),
    backgroundColor: cyanAlpha(0.08),
  },
  shopHintText: {
    fontSize: 12,
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.3,
  },
});
