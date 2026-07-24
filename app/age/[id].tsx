import { Redirect, useLocalSearchParams } from 'expo-router';

import { AgeMatchScreen } from '@/online/ui/age/age-match-screen';

/** Gizem Çağı maç route'u: /age/[id]. Tüm faz (kuyruk/hazırlık/savaş/sonuç)
 *  akışı AgeMatchScreen içinde useAgeMatch durumuna göre yönetilir. */
export default function AgeRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!id) return <Redirect href="/" />;
  return <AgeMatchScreen matchId={id} />;
}
