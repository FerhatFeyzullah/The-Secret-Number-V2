import { Redirect, useLocalSearchParams } from 'expo-router';

import { SecretSetupScreen } from '@/online/ui';

/** Gizli kod belirleme route'u: eşleşme bulununca matchId ile buraya gelinir.
 *  Tüm belirleme/realtime mantığı SecretSetupScreen'de. matchId yoksa (ör. cihaz
 *  bu route'a ölü/parametresiz geri yüklendiyse) ana menüye yönlendirir —
 *  <Redirect> mount/timing'i güvenli yönetir ("before mounting" hatası vermez). */
export default function MatchSetupRoute() {
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  if (!matchId) return <Redirect href="/" />;
  return <SecretSetupScreen matchId={matchId} />;
}
