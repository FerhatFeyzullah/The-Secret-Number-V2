import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { withLayoutContext } from 'expo-router';

import { TabBar } from '@/ui/tab-bar';

const { Navigator } = createMaterialTopTabNavigator();

// expo-router bağlamına bağlı Material Top Tabs: altında gerçek kaydırmalı pager
// (react-native-pager-view) var → ekranlar parmağı takip eder, yarıdan fazlası
// çekilince komşu sekmeye geçer, azında olduğun sekmede kalırsın.
const MaterialTopTabs = withLayoutContext(Navigator);

// Sekme kümesinin çapası her zaman Ana Ekran (index) — ortadaki sekme, açılış.
export const unstable_settings = { initialRouteName: 'index' };

/** Clash Royale tarzı 5'li alt sekme kabuğu. Sıra soldan sağa:
 *  Mağaza · Donanım · Ana Ekran (orta) · Klan · Turnuva. Bar tamamen özel
 *  TabBar'da; sekmeler arası yatay kaydırma pager tarafından canlı yapılır.
 *  OYNA/ayarlar gibi tam-ekran akışlar kök Stack'te → sekme çubuğunu kaplar. */
export default function TabsLayout() {
  return (
    <MaterialTopTabs
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ swipeEnabled: true, lazy: false }}>
      <MaterialTopTabs.Screen name="store" options={{ title: 'Mağaza' }} />
      <MaterialTopTabs.Screen name="gear" options={{ title: 'Donanım' }} />
      <MaterialTopTabs.Screen name="index" options={{ title: 'Ana Ekran' }} />
      <MaterialTopTabs.Screen name="clan" options={{ title: 'Klan' }} />
      <MaterialTopTabs.Screen name="cup" options={{ title: 'Turnuva' }} />
    </MaterialTopTabs>
  );
}
