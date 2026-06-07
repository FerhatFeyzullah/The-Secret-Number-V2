import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AuthProvider } from '@/auth';
import { colors } from '@/ui/theme';

// Kök yığının çapası HER ZAMAN ana menü (index). Cihaz son açık derin route'a
// (ör. /match/[id], /match-setup) geri yüklense bile yığının ilk ekranı index
// olur → geri tuşu/swipe ana menüye gider, ASLA uygulamadan çıkmaz.
export const unstable_settings = { initialRouteName: 'index' };

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgTop },
        }}>
        {/* Maç-ortası ekranlarda kaydırarak-geri (iOS edge-swipe / Android geri
            jesti) KAPALI: kazara çıkıp maçı düşürmek/hükmen kaybetmek engellenir.
            Tek çıkış yolu ekrandaki geri butonu → beforeRemove onayı → leave_match.
            Diğer route'lar dosya-tabanlı varsayılanla çalışmaya devam eder. */}
        <Stack.Screen name="protocol-select" options={{ gestureEnabled: false }} />
        <Stack.Screen name="match-setup" options={{ gestureEnabled: false }} />
        <Stack.Screen name="match/[id]" options={{ gestureEnabled: false }} />
      </Stack>
      <StatusBar style="light" />
    </AuthProvider>
  );
}
