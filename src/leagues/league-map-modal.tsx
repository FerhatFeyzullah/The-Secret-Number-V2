import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, cyanAlpha, mono, withAlpha } from '../ui/theme';
import { LEAGUES, leagueForRating } from './catalog';
import { LeagueIcon } from './icons';

/** Lig haritası: 7 kademenin tamamı (Bronz → Efsane) + Kupa aralıkları. Oyuncunun
 *  mevcut ligi (rating'ten) vurgulanır ("BURADASIN") ve bir üst lige kaç Kupa
 *  kaldığı gösterilir. Tek doğruluk kaynağı catalog.ts. Yalnız görüntüleme.
 *  InfoModal deseni: nested SafeAreaProvider + flex + ScrollView + sabit Kapat
 *  butonu → iOS'ta buton kesilmez, dar/geniş ekranda düzgün. */

const ACCENT = colors.cyan;

function rangeLabel(min: number, max: number | null): string {
  return max == null ? `${min}+` : `${min}–${max}`;
}

export function LeagueMapModal({
  visible,
  onClose,
  rating,
}: {
  visible: boolean;
  onClose: () => void;
  rating: number | null;
}) {
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    pop.setValue(0);
    Animated.spring(pop, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
  }, [visible, pop]);

  const cardStyle = {
    opacity: pop,
    transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
  };

  const current = rating != null ? leagueForRating(rating) : null;
  // Üst lig (varsa) + kalan Kupa — yalnız mevcut ligin satırında gösterilir.
  const next = current && current.tier < LEAGUES.length ? LEAGUES[current.tier] : null;
  const toNext = next && rating != null ? Math.max(0, next.min - rating) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaProvider>
        <View style={styles.root}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <SafeAreaView edges={['top', 'bottom']} style={styles.safe} pointerEvents="box-none">
            <Animated.View
              onStartShouldSetResponder={() => true}
              style={[styles.card, { borderColor: withAlpha(ACCENT, 0.42) }, cardStyle]}>
              <View style={[styles.beam, { backgroundColor: ACCENT, boxShadow: `0 0 18px ${ACCENT}` }]} />

              {/* Başlık — sabit üst */}
              <View style={styles.header}>
                <View style={styles.headerIcon}>
                  <Feather name="award" size={20} color={ACCENT} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>LİGLER</Text>
                  {current ? (
                    <Text style={styles.subtitle}>
                      {next
                        ? `${current.name} • bir üst lig (${next.name}) için ${toNext} kupa`
                        : `${current.name} • zirvedesin, en üst lig`}
                    </Text>
                  ) : (
                    <Text style={styles.subtitle}>Kupa kazandıkça yüksel</Text>
                  )}
                </View>
              </View>

              {/* Liste — kalan alanı kaplar; taşarsa yalnız bu bölüm kayar */}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollBody}
                showsVerticalScrollIndicator={false}
                bounces={false}>
                {LEAGUES.map((l) => {
                  const isCurrent = current?.key === l.key;
                  return (
                    <View
                      key={l.key}
                      style={[
                        styles.row,
                        {
                          borderColor: isCurrent ? withAlpha(l.color, 0.6) : colors.glassBorder,
                          backgroundColor: isCurrent ? withAlpha(l.color, 0.14) : 'rgba(0,0,0,0.18)',
                        },
                      ]}>
                      <LeagueIcon league={l.key} size={46} animated />
                      <View style={styles.rowText}>
                        <Text style={[styles.rowName, { color: l.color }]} numberOfLines={1}>
                          {l.name}
                        </Text>
                        <Text style={styles.rowRange}>{rangeLabel(l.min, l.max)} kupa</Text>
                      </View>
                      {isCurrent ? (
                        <View style={[styles.herePill, { borderColor: withAlpha(l.color, 0.7) }]}>
                          <Text style={[styles.hereText, { color: l.color }]}>BURADASIN</Text>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>

              {/* Kapat — sabit alt */}
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}>
                <Text style={styles.ctaText}>Kapat</Text>
              </Pressable>
            </Animated.View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'rgba(5,9,18,0.82)' },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    maxHeight: '100%',
    borderRadius: 22,
    borderWidth: 1.5,
    backgroundColor: 'rgba(10,20,40,0.98)',
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 18,
    overflow: 'hidden',
    boxShadow: `0 18px 48px rgba(0,0,0,0.55), 0 0 30px ${cyanAlpha(0.12)}`,
  },
  beam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: withAlpha(ACCENT, 0.5),
    backgroundColor: withAlpha(ACCENT, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 12,
  },
  subtitle: { fontSize: 11.5, color: colors.dim, marginTop: 2 },
  scroll: { flexShrink: 1 },
  scrollBody: { gap: 8, paddingBottom: 4, paddingRight: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 14,
    borderWidth: 1,
  },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 14, fontWeight: '800', fontFamily: mono, letterSpacing: 0.5 },
  rowRange: { fontSize: 12, color: colors.text },
  herePill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  hereText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: mono },
  cta: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    borderColor: withAlpha(ACCENT, 0.55),
    backgroundColor: withAlpha(ACCENT, 0.2),
    boxShadow: `0 4px 0 ${cyanAlpha(0.25)}`,
  },
  ctaPressed: { transform: [{ translateY: 2 }], boxShadow: undefined },
  ctaText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
  },
});
