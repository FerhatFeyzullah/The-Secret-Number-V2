import { Redirect, useLocalSearchParams } from 'expo-router';

import { SecretSetupScreen, WordSecretSetupScreen } from '@/online/ui';

/** Gizli kod belirleme route'u: eşleşme bulununca matchId ile buraya gelinir.
 *  content=word → kelime belirleme ekranı; aksi halde sayı (mevcut ekran AYNEN).
 *  Tüm belirleme/realtime mantığı ekranların kendisinde. matchId yoksa (ör. cihaz
 *  bu route'a ölü/parametresiz geri yüklendiyse) ana menüye yönlendirir —
 *  <Redirect> mount/timing'i güvenli yönetir ("before mounting" hatası vermez). */
export default function MatchSetupRoute() {
  const { matchId, content } = useLocalSearchParams<{ matchId?: string; content?: string }>();
  if (!matchId) return <Redirect href="/" />;
  if (content === 'word') return <WordSecretSetupScreen matchId={matchId} />;
  return <SecretSetupScreen matchId={matchId} />;
}
