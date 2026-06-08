import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { colors, mono } from '@/ui/theme';
import { ChoiceCard, LobbyHeader } from './parts';

/** Özel oyun tanıtımı — oda kodu (davet), saat/ilk sıra, skora saymama. */
const PRIVATE_SECTIONS: InfoSection[] = [
  {
    icon: 'key',
    accent: colors.cyan,
    title: 'Oda Kodu',
    body: 'Arkadaş davet sistemi: “Oda Kur” ile bir kod oluşturup paylaşırsın ya da “Oda Bul” ile arkadaşının kodunu girersin.',
  },
  {
    icon: 'sliders',
    accent: colors.amber,
    title: 'Saat & İlk Sıra',
    body: 'Odayı kuran oyuncu maç süresini ve ilk sırayı (kim başlar) belirler.',
  },
  {
    icon: 'info',
    accent: colors.teal,
    title: 'Önemli',
    body: 'Özel maçlar Kupa, XP ve Veri’ye SAYMAZ — yalnızca arkadaşça oyun içindir.',
  },
];

/** Özel oyun seçimi: Oda Kur / Oda Bul. Akışa ilk girişte tanıtım modalı açılır. */
export function PrivateChoiceScreen({
  onCreate,
  onJoin,
  onBack,
}: {
  onCreate: () => void;
  onJoin: () => void;
  onBack: () => void;
}) {
  // Tanıtım (flicker-safe): intro BAŞTA false; bayrak yüklenip !seen ise açılır.
  const [intro, setIntro] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const seen = await getSeen('privateRoom');
      if (alive && !seen) setIntro(true);
    })();
    return () => {
      alive = false;
    };
  }, []);
  const openIntro = useCallback(() => setIntro(true), []);
  const closeIntro = useCallback(() => {
    setIntro(false);
    void markSeen('privateRoom');
  }, []);

  return (
    <View style={styles.root}>
      <LobbyHeader title="ÖZEL OYUN" onBack={onBack} onInfo={openIntro} />

      <View style={styles.heading}>
        <Text style={styles.headingLabel}>NE YAPMAK İSTERSİN?</Text>
        <View style={styles.headingRule} />
      </View>

      <View style={styles.cards}>
        <ChoiceCard
          icon="plus"
          accent={colors.cyan}
          title="Oda Kur"
          subtitle="Oda kodu oluştur, arkadaşını davet et"
          onPress={onCreate}
        />
        <ChoiceCard
          icon="log-in"
          accent={colors.amber}
          title="Oda Bul"
          subtitle="Oda kodunu girerek katıl"
          onPress={onJoin}
        />
      </View>

      <InfoModal
        visible={intro}
        onClose={closeIntro}
        title="ÖZEL OYUN"
        icon="lock"
        accent={colors.amber}
        sections={PRIVATE_SECTIONS}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
    width: 28,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.amber,
  },
  cards: {
    gap: 14,
  },
});
