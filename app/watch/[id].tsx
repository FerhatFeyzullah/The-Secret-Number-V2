import { Redirect, useLocalSearchParams } from 'expo-router';

import { DuelScreen, WordDuelScreen, WordRaceScreen } from '@/online/ui';

/** KLAN MAÇ İZLEME route'u: /watch/[id]?as=<oyuncu>&content=<tip>
 *
 *  Maç ekranlarının AYNISINI `spectateAs` ile açar → izlenen oyuncunun gözünden
 *  salt-okunur ayna. `as` yoksa izleme anlamsızdır (perspektif sahibi yok) →
 *  ana menüye düşer. Asıl erişim kapısı sunucudadır (can_spectate_match RLS):
 *  yetkisiz istekte maç satırı hiç gelmez, ekran "bulunamadı"ya düşer.
 *
 *  Bilerek /match/[id] DEĞİL: maç-sahibi izleyicisi (MatchSessionProvider) o
 *  route ailesini "maç ekranı" sayar; seyirci maçı hiç sahiplenmemelidir. */
export default function WatchRoute() {
  const { id, as, content } = useLocalSearchParams<{
    id?: string;
    as?: string;
    content?: string;
  }>();
  if (!id || !as) return <Redirect href="/" />;
  if (content === 'wordrace') return <WordRaceScreen matchId={id} spectateAs={as} />;
  if (content === 'word') return <WordDuelScreen matchId={id} spectateAs={as} />;
  return <DuelScreen matchId={id} spectateAs={as} />;
}
