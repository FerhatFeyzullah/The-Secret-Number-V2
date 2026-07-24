import { Redirect, useLocalSearchParams } from 'expo-router';

import { AgeDemoScreen } from '@/online/ui/age/age-demo-screen';
import { AgeLearnScreen } from '@/online/ui/age/age-learn-screen';
import { AgeMatchScreen } from '@/online/ui/age/age-match-screen';

/** Gizem Çağı maç route'u: /age/[id]. Tüm faz (kuyruk/hazırlık/savaş/sonuç)
 *  akışı AgeMatchScreen içinde useAgeMatch durumuna göre yönetilir.
 *  id === 'demo' → sunucusuz yerel demo (yalnız UI testi).
 *  id === 'learn' → maç öncesi öğretici (örnek harita + adım adım); bitince eşleşme. */
export default function AgeRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!id) return <Redirect href="/" />;
  if (id === 'demo') return <AgeDemoScreen />;
  if (id === 'learn') return <AgeLearnScreen />;
  return <AgeMatchScreen matchId={id} />;
}
