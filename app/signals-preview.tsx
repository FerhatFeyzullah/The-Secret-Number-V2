import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SIGNALS } from '@/signals/catalog';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';

/** GEÇİCİ önizleme (Sinyal Adım 1): 18 sinyali 48px (siluet/tanınırlık) + ızgarada
 *  (zenginleştirilmiş + animasyonlu) ad/fiyatla gösterir. Animasyon aç/kapa
 *  toggle'ı ile performansı da değerlendirilebilir. Hiçbir akışa bağlı değil. */
export default function SignalsPreviewScreen() {
  const [anim, setAnim] = useState(true);
  return (
    <Screen>
      <ScreenHeader title="Sinyaller" />
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {/* Animasyon aç/kapa */}
        <Pressable onPress={() => setAnim((a) => !a)} style={[styles.toggle, anim && styles.toggleOn]}>
          <Text style={[styles.toggleText, anim && styles.toggleTextOn]}>
            Animasyon: {anim ? 'AÇIK' : 'KAPALI'}
          </Text>
        </Pressable>

        {/* 48px tanınırlık şeridi (her zaman statik — siluet testi) */}
        <Text style={styles.section}>48px — TANINIRLIK (statik)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
          {SIGNALS.map((s) => {
            const Icon = s.component;
            return (
              <View key={s.id} style={styles.stripCell}>
                <Icon size={48} animated={false} />
              </View>
            );
          })}
        </ScrollView>

        {/* Tam ızgara: zenginleştirilmiş + (toggle'a göre) animasyonlu */}
        <Text style={styles.section}>TÜM SİNYALLER ({SIGNALS.length})</Text>
        <View style={styles.grid}>
          {SIGNALS.map((s) => {
            const Icon = s.component;
            return (
              <View key={s.id} style={styles.card}>
                <Icon size={72} animated={anim} />
                <Text style={styles.name} numberOfLines={1}>
                  {s.name}
                </Text>
                {s.starter ? (
                  <View style={[styles.badge, styles.badgeStarter]}>
                    <Text style={[styles.badgeText, { color: colors.success }]}>Ücretsiz</Text>
                  </View>
                ) : (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{s.veriCost} Veri</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 14,
    paddingBottom: 32,
  },
  toggle: {
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    backgroundColor: colors.glass,
  },
  toggleOn: {
    borderColor: cyanAlpha(0.45),
    backgroundColor: cyanAlpha(0.12),
  },
  toggleText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    color: colors.dim,
    fontFamily: mono,
  },
  toggleTextOn: {
    color: colors.cyan,
  },
  section: {
    fontSize: 10,
    letterSpacing: 2,
    color: colors.dim,
    fontFamily: mono,
    marginTop: 8,
  },
  strip: {
    gap: 10,
    paddingVertical: 4,
  },
  stripCell: {
    width: 64,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  card: {
    flexBasis: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  name: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  badge: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 20,
    backgroundColor: cyanAlpha(0.1),
    borderWidth: 1,
    borderColor: cyanAlpha(0.3),
  },
  badgeStarter: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.35),
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.cyan,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
