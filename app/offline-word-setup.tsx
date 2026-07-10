import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getSeen, markSeen } from '@/storage';
import { GlassButton, GlassCard } from '@/ui/glass';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { Screen, ScreenHeader } from '@/ui/screen';
import { colors, mono } from '@/ui/theme';

/** Tek oyunculu kelime modu tanıtımı — tek tur, süreli, sınırsız tahmin, Wordle. */
const WORD_SOLO_SECTIONS: InfoSection[] = [
  {
    icon: 'type',
    accent: colors.success,
    title: 'Gizli Kelime',
    body: 'Telefon 4, 5 ya da 6 harfli gizli bir kelime tutar (uzunluğu sen seçersin). Amaç: onu süre bitmeden bulmak.',
  },
  {
    icon: 'clock',
    accent: colors.amber,
    title: 'Süreye Karşı',
    body: 'Geri sayan bir saate karşı oynarsın; süre dolarsa kaybedersin. Süre boyunca istediğin kadar tahmin yapabilirsin.',
  },
  {
    icon: 'eye',
    accent: colors.teal,
    title: 'Renkli İpucu',
    body: 'Her tahminde harfler renklenir: yeşil = doğru harf, doğru yerde; sarı = kelimede var ama yeri yanlış.',
  },
  {
    icon: 'check-circle',
    accent: colors.success,
    title: 'Geçerli Kelime',
    body: 'Tahminlerin gerçek bir Türkçe kelime olmalı — sözlükte olmayan harf dizileri kabul edilmez.',
  },
];

type LengthChoice = number | 'random';

const lengthOptions: { label: string; value: LengthChoice }[] = [
  { label: '4 harf', value: 4 },
  { label: '5 harf', value: 5 },
  { label: '6 harf', value: 6 },
  { label: 'Rastgele', value: 'random' },
];

/** Süre değerleri özel oda kurulumundan (private-room-setup) ilhamla: 1/1.5/2/3 dk. */
const timeOptions: { label: string; value: number }[] = [
  { label: '1 dk', value: 60 },
  { label: '1.5 dk', value: 90 },
  { label: '2 dk', value: 120 },
  { label: '3 dk', value: 180 },
];

export default function OfflineWordSetupScreen() {
  const router = useRouter();
  const [length, setLength] = useState<LengthChoice>('random');
  const [seconds, setSeconds] = useState(90);

  const start = () => {
    router.push({
      pathname: '/offline-word',
      params: { length: String(length), seconds: String(seconds) },
    });
  };

  // Tanıtım (flicker-safe): bayrak yüklenip !seen ise açılır.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seen = await getSeen('soloWordIntro');
      if (alive && !seen) setIntro(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const openIntro = useCallback(() => setIntro(true), []);
  const closeIntro = useCallback(() => {
    setIntro(false);
    void markSeen('soloWordIntro');
  }, []);

  return (
    <Screen float="letters">
      <ScreenHeader title="Kelime Kurulumu" onInfo={openIntro} />
      <ScrollView contentContainerStyle={styles.list}>
        <GlassCard>
          <View style={styles.cardHeader}>
            <Feather name="type" size={20} color={colors.success} />
            <Text style={styles.cardTitle}>Kelime Uzunluğu</Text>
          </View>
          <Text style={styles.cardDesc}>
            Kaç harfli kelime? Rastgele seçersen telefon 4-6 arası bir uzunluk tutar.
          </Text>
          <View style={styles.chips}>
            {lengthOptions.map((opt) => {
              const on = length === opt.value;
              return (
                <Pressable
                  key={String(opt.value)}
                  onPress={() => setLength(opt.value)}
                  style={[styles.chip, on && styles.chipActive]}>
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        <GlassCard>
          <View style={styles.cardHeader}>
            <Feather name="clock" size={20} color={colors.amber} />
            <Text style={styles.cardTitle}>Süre</Text>
          </View>
          <Text style={styles.cardDesc}>
            Doğru kelimeyi bu süre içinde bulmalısın — süre boyunca sınırsız tahmin.
          </Text>
          <View style={styles.chips}>
            {timeOptions.map((opt) => {
              const on = seconds === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setSeconds(opt.value)}
                  style={[styles.chip, on && styles.chipActive]}>
                  <Text style={[styles.chipText, on && styles.chipTextActive]}>{opt.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </GlassCard>

        <GlassButton label="Başla" accent={colors.success} onPress={start} />
      </ScrollView>

      <InfoModal
        visible={intro}
        onClose={closeIntro}
        title="KELİME MODU"
        icon="type"
        accent={colors.success}
        sections={WORD_SOLO_SECTIONS}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 16,
    paddingBottom: 24,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cardDesc: {
    color: colors.dim,
    fontSize: 13,
    lineHeight: 19,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: colors.success,
    backgroundColor: 'rgba(74, 222, 128, 0.12)',
  },
  chipText: {
    color: colors.dim,
    fontWeight: '600',
    fontFamily: mono,
  },
  chipTextActive: {
    color: colors.success,
  },
});
