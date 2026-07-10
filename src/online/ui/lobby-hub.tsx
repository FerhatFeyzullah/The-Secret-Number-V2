import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { LobbyCounts } from '@/online';
import { getSeen, markSeen } from '@/storage';
import { InfoModal, type InfoSection } from '@/ui/info-modal';
import { colors, cyanAlpha, mono, withAlpha } from '@/ui/theme';
import { ChoiceCard, LobbyHeader } from './parts';

/** Hızlı Maç tanıtımı — gerçek mekanikle birebir (3 farklı rakam, pozisyonsuz
 *  geri bildirim, kişi-başı saat, Kupa/XP/Veri kazanımı). */
const QUICK_SECTIONS: InfoSection[] = [
  {
    icon: 'hash',
    accent: colors.cyan,
    title: 'Gizli Sayı',
    body: '3 FARKLI rakamdan oluşur (1-9 arası, sıfır YOK). Sen ve rakibin birer gizli sayı belirlersiniz.',
  },
  {
    icon: 'target',
    accent: colors.cyan,
    title: 'Sırayla Tahmin',
    body: 'Sırayla rakibin gizli sayısını tahmin edersin. Her tahmin yine 3 farklı rakamdır.',
  },
  {
    icon: 'eye',
    accent: colors.teal,
    title: 'Geri Bildirim',
    body: 'Kaç rakamının doğru olduğu söylenir; ama YERİ söylenmez. Rakamlar doğru olup sırası yanlışsa ayrıca belirtilir.',
  },
  {
    icon: 'clock',
    accent: colors.amber,
    title: 'Süre',
    body: 'Her oyuncunun kendi saati vardır ve yalnız sırandayken işler. Süren biterse turu kaybedersin.',
  },
  {
    icon: 'award',
    accent: colors.amber,
    title: 'Kazanım',
    body: 'Kazanınca Kupa, XP ve Veri kazanırsın (kaybedince daha azı). Veri ile yeni protokoller açılır.',
  },
];

/** Protokol Maçı tanıtımı — iki tur kazanma, Kader Eli, protokol rolü, farkı. */
const PROTOCOL_SECTIONS: InfoSection[] = [
  {
    icon: 'layers',
    accent: colors.violet,
    title: 'İki Tur Kazanan Alır',
    body: 'En çok 3 tur oynanır; önce 2 turu kazanan maçı alır. Her turun kendi gizli sayısı vardır.',
  },
  {
    icon: 'shuffle',
    accent: colors.cyan,
    title: 'Kader Eli',
    body: 'Maç başında, sahip olduğun protokollerden rastgele bir EL dağıtılır. Yuva sayına göre 2-3 tanesini seçip maça götürürsün.',
  },
  {
    icon: 'zap',
    accent: colors.amber,
    title: 'Protokoller',
    body: 'Maç içi özel güçler: zaman, ipucu, sabotaj, savunma. Her biri maç başına 1 kez kullanılır.',
  },
  {
    icon: 'columns',
    accent: colors.teal,
    title: 'Hızlı Maç’tan Farkı',
    body: 'Aynı tahmin kuralları + 3 tur + protokoller. Hızlı Maç tek turdur ve protokol içermez.',
  },
];

/** Kelime Modu tanıtımı — kelime düellosu mekaniği (Bo3 + random uzunluk, protokolsüz). */
const WORD_SECTIONS: InfoSection[] = [
  {
    icon: 'type',
    accent: colors.success,
    title: 'Gizli Kelime',
    body: 'Her tur 4, 5 ya da 6 harf RASTGELE belirlenir (ikinize de aynı). Yaygın Türkçe kelimelerden gizli kelimeni seçersin.',
  },
  {
    icon: 'target',
    accent: colors.cyan,
    title: 'Sırayla Tahmin',
    body: 'Sırayla rakibin kelimesini tahmin edersin. Tahminin geçerli bir Türkçe kelime olmalı.',
  },
  {
    icon: 'eye',
    accent: colors.teal,
    title: 'Geri Bildirim',
    body: 'Kaç HARFİN doğru olduğu söylenir; ama YERİ söylenmez. Harfler doğru olup sırası yanlışsa ayrıca belirtilir.',
  },
  {
    icon: 'layers',
    accent: colors.violet,
    title: 'İki Tur Kazanan Alır',
    body: 'En çok 3 tur oynanır; önce 2 turu kazanan maçı alır. Her tur kelime uzunluğu yeniden belirlenir.',
  },
  {
    icon: 'award',
    accent: colors.amber,
    title: 'Kazanım',
    body: 'Kazanınca Kupa, XP ve Veri kazanırsın (kaybedince daha azı). Sayı moduyla aynı lig/sezon.',
  },
];

type Intro = { kind: 'quick' | 'protocol' | 'word'; proceed: boolean };

/** Online lobi ana ekranı: Hızlı Maç (hero) + Protokol Maçı + Özel Oyun.
 *  İlk dokunuşta ilgili tanıtım modalı araya girer (sonra şeffaf); "?" rozeti
 *  modalı her zaman tekrar açar. */
export function LobbyHub({
  notice,
  onlineCount,
  waiting,
  onQuick,
  onProtocol,
  onWord,
  onPrivate,
  onHowTo,
  onBack,
}: {
  /** Lobiye dönüş nedeni bilgisi (ör. "Rakip ayrıldı, maç iptal edildi."). */
  notice?: string | null;
  /** Uygulama-geneli canlı online oyuncu sayısı; null → gizli. */
  onlineCount?: number | null;
  /** Moda göre kuyrukta rakip bekleyen oyuncu sayısı; null → kartlarda gizli. */
  waiting?: LobbyCounts | null;
  onQuick: () => void;
  onProtocol: () => void;
  onWord: () => void;
  onPrivate: () => void;
  onHowTo: () => void;
  onBack: () => void;
}) {
  const [intro, setIntro] = useState<Intro | null>(null);

  // İlk dokunuş: tanıtımı görmediyse modal araya girer; gördüyse direkt başlar.
  // (Tap'ta await sonrası açıldığı için flicker yok.)
  const tapQuick = async () => {
    if (await getSeen('quickIntro')) onQuick();
    else setIntro({ kind: 'quick', proceed: true });
  };
  const tapProtocol = async () => {
    if (await getSeen('protocolIntro')) onProtocol();
    else setIntro({ kind: 'protocol', proceed: true });
  };
  const tapWord = async () => {
    if (await getSeen('wordIntro')) onWord();
    else setIntro({ kind: 'word', proceed: true });
  };

  // "?" rozeti: seen'den bağımsız her zaman açar, aramayı BAŞLATMAZ.
  const infoQuick = () => setIntro({ kind: 'quick', proceed: false });
  const infoProtocol = () => setIntro({ kind: 'protocol', proceed: false });
  const infoWord = () => setIntro({ kind: 'word', proceed: false });

  const closeIntro = () => {
    const cur = intro;
    setIntro(null);
    if (!cur) return;
    void markSeen(
      cur.kind === 'quick' ? 'quickIntro' : cur.kind === 'protocol' ? 'protocolIntro' : 'wordIntro',
    );
    if (cur.proceed) (cur.kind === 'quick' ? onQuick : cur.kind === 'protocol' ? onProtocol : onWord)();
  };

  return (
    <View style={styles.root}>
      <LobbyHeader title="ÇEVRİMİÇİ" onBack={onBack} />

      {onlineCount != null ? (
        <View style={styles.onlineRow}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>{onlineCount} oyuncu çevrimiçi</Text>
        </View>
      ) : null}

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
          waiting={waiting?.quick}
          onPress={tapQuick}
          onInfo={infoQuick}>
          <View style={styles.tags}>
            <Text style={styles.tag}>⏱ Zamana Karşı</Text>
            <Text style={styles.tag}>🔢 3 haneli kod</Text>
          </View>
        </ChoiceCard>

        <ChoiceCard
          icon="layers"
          accent={colors.violet}
          title="Protokol Maçı"
          subtitle="Protokollü düello · 3 tur"
          waiting={waiting?.protocol}
          onPress={tapProtocol}
          onInfo={infoProtocol}>
          <View style={styles.tags}>
            <Text style={styles.tag}>🏆 2 tur kazanan alır</Text>
          </View>
        </ChoiceCard>

        <ChoiceCard
          icon="type"
          accent={colors.success}
          title="Kelime Modu"
          subtitle="Kelime düellosu · 3 tur"
          waiting={waiting?.word}
          onPress={tapWord}
          onInfo={infoWord}>
          <View style={styles.tags}>
            <Text style={styles.tag}>🔤 4-6 harf · her tur rastgele</Text>
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

      <InfoModal
        visible={intro?.kind === 'quick'}
        onClose={closeIntro}
        title="HIZLI MAÇ"
        icon="zap"
        accent={colors.cyan}
        sections={QUICK_SECTIONS}
        ctaLabel={intro?.proceed ? 'Anladım, Başla' : 'Anladım'}
      />
      <InfoModal
        visible={intro?.kind === 'protocol'}
        onClose={closeIntro}
        title="PROTOKOL MAÇI"
        icon="layers"
        accent={colors.violet}
        sections={PROTOCOL_SECTIONS}
        ctaLabel={intro?.proceed ? 'Anladım, Başla' : 'Anladım'}
      />
      <InfoModal
        visible={intro?.kind === 'word'}
        onClose={closeIntro}
        title="KELİME MODU"
        icon="type"
        accent={colors.success}
        sections={WORD_SECTIONS}
        ctaLabel={intro?.proceed ? 'Anladım, Başla' : 'Anladım'}
      />

      {/* <View style={styles.footer}>
        <Pressable onPress={onHowTo} hitSlop={8} style={styles.howTo}>
          <Feather name="help-circle" size={13} color={colors.dim} />
          <Text style={styles.howToText}>Nasıl çalışır?</Text>
        </Pressable>
      </View> */}
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
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginTop: 4,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
    boxShadow: `0 0 8px ${colors.success}`,
  },
  onlineText: {
    color: colors.dim,
    fontSize: 12,
    fontWeight: '600',
    fontFamily: mono,
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
