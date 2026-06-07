import { Redirect, useLocalSearchParams } from 'expo-router';

import { DuelScreen } from '@/online/ui';

/** Online düello route'u: /match/[id]. matchId'yi DuelScreen'e geçirir
 *  (tüm realtime/oyun mantığı orada). id yoksa (ör. cihaz ölü/parametresiz geri
 *  yüklendiyse) ana menüye yönlendirir — <Redirect> timing'i güvenli yönetir. */
export default function MatchRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!id) return <Redirect href="/" />;
  return <DuelScreen matchId={id} />;
}
