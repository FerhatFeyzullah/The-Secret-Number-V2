import { Redirect, useLocalSearchParams } from 'expo-router';

import { ProtocolSelectScreen } from '@/online/ui';

/** Destiny's Hand seçim route'u: Protokol Maçı eşleşince (belirleme öncesi)
 *  matchId ile buraya gelinir. matchId yoksa (ör. cihaz ölü/parametresiz geri
 *  yüklendiyse) ana menüye yönlendirir — <Redirect> timing'i güvenli yönetir. */
export default function ProtocolSelectRoute() {
  const { matchId } = useLocalSearchParams<{ matchId?: string }>();
  if (!matchId) return <Redirect href="/" />;
  return <ProtocolSelectScreen matchId={matchId} />;
}
