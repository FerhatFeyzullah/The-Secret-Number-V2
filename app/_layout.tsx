import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider } from '@/auth';
import { MatchSessionProvider, OnlinePresenceProvider } from '@/online';
import { ChallengeProvider } from '@/online/ui';
import { shouldShowOverlay } from '@/updates/update-machine';
import { UpdateOverlay } from '@/updates/update-overlay';
import { useUpdateGate } from '@/updates/use-update-gate';
import { IntroDoneContext } from '@/ui/intro-context';
import { colors } from '@/ui/theme';
import { IntroOverlay } from '@/ui/intro-overlay';

// Kök yığının çapası HER ZAMAN sekme kabuğu (tabs → orta sekme Ana Ekran). Cihaz
// son açık derin route'a (ör. /match/[id], /match-setup) geri yüklense bile yığının
// ilk ekranı (tabs) olur → geri tuşu/swipe ana menüye gider, ASLA uygulamadan çıkmaz.
export const unstable_settings = { initialRouteName: '(tabs)' };

// Native splash'i biz kapatacağız (intro overlay hazır olunca) → splash ile intro
// arasında menü flash'i olmaz.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  // Her soğuk başlangıçta yayıncı intro'su (route DEĞİL, overlay → nav yığını temiz).
  const [introDone, setIntroDone] = useState(false);
  // OTA güncelleme kapısı: açılışta (intro ile eşzamanlı) arka planda kontrol eder.
  const updateGate = useUpdateGate();
  useEffect(() => {
    // İlk render sonrası: native splash'i kapat (altında intro overlay zaten boyalı).
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    // GestureHandlerRootView: alt sekmelerde yatay kaydırma jesti için kök sarmalayıcı.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        {/* introDone: ekranlar (ör. ana menü welcome modalı) intro bitmeden modal
            açmasın. Native <Modal>, JS-overlay intro'nun üstüne çizilir → intro'ya
            bağlamazsak önüne geçer. */}
        <IntroDoneContext.Provider value={introDone}>
        {/* Uygulama-geneli "aktif online oyuncu" presence sayacı (lobide gösterilir).
            useAuth gerektirir → AuthProvider içinde; Stack'i sarar ki /online route'u
            useOnlineCount'a erişsin. */}
        <OnlinePresenceProvider>
          {/* Merkezi "aktif maç sahibi": maç-ekran kümesi dışına çıkıldığında tek
              leave_match'i bu provider'ın navigasyon izleyicisi tetikler. */}
          <MatchSessionProvider>
            {/* Klan içi meydan okuma app-geneli akışı (mod/ayar/yanıt-bekle + gelen
                kart); Stack'i sarar ki overlay'ler her ekranın üstüne çizilsin. */}
            <ChallengeProvider>
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
            </ChallengeProvider>
          </MatchSessionProvider>
        </OnlinePresenceProvider>
        <StatusBar style="light" />
        {/* Açılış intro'su — en üstte, menüyü kaplar; bitince fade-out + unmount,
            altta hazır menü görünür. Geri tuşu intro'ya dönmez (overlay, route değil). */}
        {!introDone ? <IntroOverlay onDone={() => setIntroDone(true)} /> : null}
        {/* Intro bittikten SONRA, güncelleme varsa zorunlu OTA ekranı (menüyü kaplar).
            Güncelleme yoksa/kontrol başarısızsa hiç görünmez → menü normal açılır. */}
        {introDone && shouldShowOverlay(updateGate.phase) ? (
          <UpdateOverlay {...updateGate} />
        ) : null}
      </IntroDoneContext.Provider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
