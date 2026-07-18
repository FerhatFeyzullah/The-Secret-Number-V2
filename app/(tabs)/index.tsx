import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Keyboard, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ClanScreen, DonanimScreen, StoreScreen } from '@/online/ui';
import { ComingSoon } from '@/ui/coming-soon';
import { HomeMenu } from '@/ui/home-menu';
import { TabBar } from '@/ui/tab-bar';
import { TAB_ROUTES, type TabName, TabsPagerContext } from '@/ui/tabs-pager-context';
import { colors } from '@/ui/theme';

const HOME_INDEX = TAB_ROUTES.indexOf('index'); // 2 — orta sekme, açılış sayfası

/** Turnuva yer tutucusu (eski cup.tsx route'u pager sayfasına indi). */
function CupPage() {
  return (
    <ComingSoon
      icon="award"
      title="TURNUVALAR"
      subtitle="Haftalık turnuvalarda özel ödüller ve sıralama için yarış."
      accent={colors.amber}
    />
  );
}

/** Clash Royale tarzı 5'li alt sekme kabuğu — TEK ekran + yatay ScrollView pager.
 *  react-native-pager-view YERİNE core RN ScrollView (pagingEnabled) → native
 *  bağımlılık yok, mevcut build'lerle uyumlu (OTA ile gider). Parmağı takip eder,
 *  sayfa sınırına snap eder. Sıra: Mağaza · Donanım · Ana Ekran (orta) · Klan ·
 *  Turnuva. Sekme çubuğu (TabBar) pager'ı; pager de çubuğu (aktif index) sürer. */
export default function TabsPager() {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(HOME_INDEX);
  const indexRef = useRef(HOME_INDEX);
  // Sekmeye dokununca programatik kayma sırasında onScroll ara-sayfaları "aktif"
  // işaretlemesin (çubuk süpürülmesin) → kısa kilit. İlk yerleşimdeki olası sahte
  // x=0 olayını da yutar.
  const lockUntil = useRef(0);
  // Sayfa yüksekliği pager'ın ölçülen (klavye açılınca küçülen) yüksekliğine EŞLENİR.
  // Yatay ScrollView, çocukların yüksekliğini tek başına reflow etmiyor → açık
  // yükseklik ver ki klan sohbeti gibi alt-hizalı input klavyenin üstüne çıksın.
  const [viewportH, setViewportH] = useState(0);
  // iOS'te klavye pencereyi küçültmez (Android adjustResize küçültür) → iOS'te
  // klavye yüksekliğini elle çıkar; Android'de 0 (çift sayım olmasın).
  const [iosKbH, setIosKbH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setIosKbH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setIosKbH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const pageH = viewportH > 0 ? Math.max(0, viewportH - iosKbH) : undefined;
  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    setViewportH(e.nativeEvent.layout.height);
  }, []);

  const setActive = useCallback((i: number) => {
    indexRef.current = i;
    setIndex(i);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      if (i < 0 || i >= TAB_ROUTES.length) return;
      lockUntil.current = Date.now() + 450;
      scrollRef.current?.scrollTo({ x: i * width, animated: true });
      setActive(i);
    },
    [width, setActive],
  );

  const goToTab = useCallback((name: TabName) => goTo(TAB_ROUTES.indexOf(name)), [goTo]);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (Date.now() < lockUntil.current) return; // programatik/ilk kayma → yoksay
      const page = Math.round(e.nativeEvent.contentOffset.x / width);
      if (page !== indexRef.current) setActive(page);
    },
    [width, setActive],
  );

  // İlk yerleşimde olası sahte onScroll'u kısa süre yut (index HOME_INDEX kalsın).
  useEffect(() => {
    lockUntil.current = Date.now() + 350;
  }, []);

  // Genişlik değişirse (kenar durumu) mevcut sayfayı px olarak yeniden hizala.
  // Portrait kilidi var → normalde tetiklenmez; ilk mount'ta doğru konumu da garanti eder.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: indexRef.current * width, animated: false });
  }, [width]);

  // Sayfa elemanları index'e bağlı değil → bir kez kur (her kaydırmada ağır
  // ekranlar yeniden oluşturulmasın).
  const pages = useMemo(
    () => [
      <StoreScreen key="store" />,
      <DonanimScreen key="gear" />,
      <HomeMenu key="index" />,
      <ClanScreen key="clan" />,
      <CupPage key="cup" />,
    ],
    [],
  );

  const ctxValue = useMemo(() => ({ goToTab }), [goToTab]);

  return (
    <TabsPagerContext.Provider value={ctxValue}>
      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          directionalLockEnabled
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={onScroll}
          onLayout={onViewportLayout}
          contentOffset={{ x: HOME_INDEX * width, y: 0 }}
          keyboardShouldPersistTaps="handled"
          style={styles.flex}>
          {pages.map((el, i) => (
            <View key={TAB_ROUTES[i]} style={{ width, height: pageH }}>
              {el}
            </View>
          ))}
        </ScrollView>
        <TabBar routes={TAB_ROUTES} index={index} onSelect={goTo} />
      </View>
    </TabsPagerContext.Provider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bgTop },
});
