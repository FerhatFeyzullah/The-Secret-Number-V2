import { Feather } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { colors, cyanAlpha, mono, withAlpha } from './theme';

type FeatherName = keyof typeof Feather.glyphMap;

/** Bilgilendirme modalının tek bölümü: kategori ikonu + kısa başlık + açıklama. */
export type InfoSection = {
  icon: FeatherName;
  title: string;
  body: string;
  /** Bölüm vurgu rengi (kategori); verilmezse modalın ana aksanı. */
  accent?: string;
};

/** Yeniden kullanılabilir bilgilendirme modalı (ilk-kez tanıtımları + "?" tekrar
 *  açma). Tema ile birebir: koyu indigo zemin, camsı yüzey, elektrik mavisi
 *  vurgu, mono başlık, yumuşak glow, fade + hafif scale girişi. İçerik bölümleri
 *  çağırandan gelir (esnek), görünüm tutarlı kalır.
 *
 *  Düzen FLEX tabanlı (sabit sayısal yükseklik YOK): başlık (sabit üst) + içerik
 *  (ScrollView, kalan alanı kaplar/kayar) + buton (sabit alt). Kart yüksekliği
 *  `maxHeight:'100%'` ile güvenli alana oturur; bu yüzden ilk-render'da insets
 *  henüz 0 olsa bile (iOS Modal yarışı) değer OTURUNCA düzen kendini düzeltir —
 *  yeniden açmaya gerek kalmaz. İç içe SafeAreaProvider, Modal'ın KENDİ
 *  penceresinin güvenli alanını ölçer (ana penceredeki bayat/0 inset sorununu
 *  giderir). */
export function InfoModal({
  visible,
  onClose,
  title,
  icon = 'info',
  accent = colors.cyan,
  sections,
  ctaLabel = 'Anladım',
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  icon?: FeatherName;
  accent?: string;
  sections: InfoSection[];
  ctaLabel?: string;
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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/* Modal'ın kendi penceresi için güvenli alanı yeniden ölç. */}
      <SafeAreaProvider>
        <View style={styles.root}>
          {/* Arka plana dokununca kapanır (kartın altında). */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

          {/* Güvenli alanı PADDING olarak uygular; flex:1 ile ekranı kaplar →
              kart maxHeight:'100%' bu içerik kutusuna (ekran − çentik/gesture)
              göre çözülür. box-none: boş alan dokunuşları arkadaki kapatıcıya. */}
          <SafeAreaView edges={['top', 'bottom']} style={styles.safe} pointerEvents="box-none">
            <Animated.View
              // Kart kendi dokunuşunu yutar (kart içine dokununca kapanmaz).
              onStartShouldSetResponder={() => true}
              style={[styles.card, { borderColor: withAlpha(accent, 0.42) }, cardStyle]}>
              {/* Üst enerji şeridi: tam en, köşe yarıçapına uyumlu kavis. */}
              <View style={[styles.beam, { backgroundColor: accent, boxShadow: `0 0 18px ${accent}` }]} />

              {/* Başlık — SABİT üst */}
              <View style={styles.header}>
                <View
                  style={[
                    styles.headerIcon,
                    { borderColor: withAlpha(accent, 0.5), backgroundColor: withAlpha(accent, 0.16) },
                  ]}>
                  <Feather name={icon} size={20} color={accent} />
                </View>
                <Text style={styles.title}>{title}</Text>
              </View>

              {/* İçerik — kalan alanı kaplar; taşarsa YALNIZ bu bölüm kayar */}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollBody}
                showsVerticalScrollIndicator={false}
                bounces={false}>
                {sections.map((s, i) => {
                  const a = s.accent ?? accent;
                  return (
                    <View key={i} style={styles.section}>
                      <View
                        style={[
                          styles.secIcon,
                          { borderColor: withAlpha(a, 0.45), backgroundColor: withAlpha(a, 0.12) },
                        ]}>
                        <Feather name={s.icon} size={15} color={a} />
                      </View>
                      <View style={styles.secText}>
                        <Text style={[styles.secTitle, { color: a }]}>{s.title}</Text>
                        <Text style={styles.secBody}>{s.body}</Text>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Buton — SABİT alt (içeriğin parçası değil) */}
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.cta,
                  { borderColor: withAlpha(accent, 0.55), backgroundColor: withAlpha(accent, 0.2) },
                  pressed && styles.ctaPressed,
                ]}>
                <Text style={styles.ctaText}>{ctaLabel}</Text>
              </Pressable>
            </Animated.View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(5,9,18,0.82)',
  },
  safe: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    // Sayısal hesap YOK: güvenli alana sığan içerik kutusunun tamamı kadar.
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
  // Üst vurgu şeridi: kartın TAM enini kaplar; üst köşe yarıçapına (22) uyumlu
  // kavislenir → köşelerde kesilmeden, soldan sağa simetrik durur.
  beam: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: colors.ice,
    fontFamily: mono,
    textShadowColor: cyanAlpha(0.6),
    textShadowRadius: 12,
  },
  scroll: {
    // İçerik kart sınırını aşarsa yalnız bu bölüm kayar; başlık + buton sabit.
    // flexShrink: kısa içerikte içeriğe sığar, uzun içerikte küçülüp kaydırır.
    flexShrink: 1,
  },
  scrollBody: {
    gap: 14,
    paddingBottom: 4,
    paddingRight: 2,
  },
  section: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  secIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  secText: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
    gap: 3,
  },
  secTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 0.3,
  },
  secBody: {
    fontSize: 12,
    color: colors.text,
    lineHeight: 17,
  },
  cta: {
    marginTop: 18,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    boxShadow: `0 4px 0 ${cyanAlpha(0.25)}`,
  },
  ctaPressed: {
    transform: [{ translateY: 2 }],
    boxShadow: undefined,
  },
  ctaText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.ice,
    fontFamily: mono,
  },
});
