import { Redirect, useLocalSearchParams } from 'expo-router';

import { DuelScreen, WordDuelScreen } from '@/online/ui';

/** Online düello route'u: /match/[id]. content=word → kelime düellosu; aksi
 *  halde sayı düellosu (mevcut ekran AYNEN). Tüm realtime/oyun mantığı
 *  ekranlarda. id yoksa (ör. cihaz ölü/parametresiz geri yüklendiyse) ana
 *  menüye yönlendirir — <Redirect> timing'i güvenli yönetir. */
export default function MatchRoute() {
  const { id, content } = useLocalSearchParams<{ id?: string; content?: string }>();
  if (!id) return <Redirect href="/" />;
  if (content === 'word') return <WordDuelScreen matchId={id} />;
  return <DuelScreen matchId={id} />;
}
