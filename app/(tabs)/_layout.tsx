import { Stack } from 'expo-router';

/** (tabs) grubu artık TEK ekran (index): 5'li Clash Royale sekme kabuğu o ekranın
 *  içinde yatay ScrollView pager olarak yaşar (native pager-view YOK → OTA-uyumlu).
 *  Kök Stack çapası '(tabs)' olmaya devam eder; başlık gizli. */
export default function TabsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
