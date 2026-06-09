import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import { AuthProvider } from '@/auth';
import { MatchSessionProvider } from '@/online';
import { IntroDoneContext } from '@/ui/intro-context';
import { colors } from '@/ui/theme';
import { IntroOverlay } from '@/ui/intro-overlay';

// Kök yığının çapası HER ZAMAN ana menü (index). Cihaz son açık derin route'a
// (ör. /match/[id], /match-setup) geri yüklense bile yığının ilk ekranı index
// olur → geri tuşu/swipe ana menüye gider, ASLA uygulamadan çıkmaz.
export const unstable_settings = { initialRouteName: 'index' };

// Native splash'i biz kapatacağız (intro overlay hazır olunca) → splash ile intro
// arasında menü flash'i olmaz.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // Her soğuk başlangıçta yayıncı intro'su (route DEĞİL, overlay → nav yığını temiz).
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    // İlk render sonrası: native splash'i kapat (altında intro overlay zaten boyalı).
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <AuthProvider>
      {/* introDone: ekranlar (ör. ana menü welcome modalı) intro bitmeden modal
          açmasın. Native <Modal>, JS-overlay intro'nun üstüne çizilir → intro'ya
          bağlamazsak önüne geçer. */}
      <IntroDoneContext.Provider value={introDone}>
        {/* Merkezi "aktif maç sahibi": maç-ekran kümesi dışına çıkıldığında tek
            leave_match'i bu provider'ın navigasyon izleyicisi tetikler. */}
        <MatchSessionProvider>
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
        </MatchSessionProvider>
        <StatusBar style="light" />
        {/* Açılış intro'su — en üstte, menüyü kaplar; bitince fade-out + unmount,
            altta hazır menü görünür. Geri tuşu intro'ya dönmez (overlay, route değil). */}
        {!introDone ? <IntroOverlay onDone={() => setIntroDone(true)} /> : null}
      </IntroDoneContext.Provider>
    </AuthProvider>
  );
}
