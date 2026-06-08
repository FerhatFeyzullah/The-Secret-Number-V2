import { InfoModal } from '../ui/info-modal';
import { leagueForRating } from './catalog';

/** Haftalık sezon sıfırlandığında BİR KEZ gösterilir (yeni season_id görülünce;
 *  bkz. getLastSeenSeason). "Kupan kısmen geri çekildi" + güncel lig. Görünüm
 *  InfoModal sistemiyle tutarlı; tetikleme/flicker-safe mantığı çağırandadır. */
export function SeasonResetModal({
  visible,
  onClose,
  rating,
}: {
  visible: boolean;
  onClose: () => void;
  rating: number;
}) {
  const lg = leagueForRating(rating);
  return (
    <InfoModal
      visible={visible}
      onClose={onClose}
      title="YENİ SEZON"
      icon="refresh-cw"
      accent={lg.color}
      ctaLabel="Anladım"
      sections={[
        {
          icon: 'rotate-ccw',
          title: 'Kupa çekildi',
          body: 'Yeni hafta başladı. Kupan kısmen geri çekildi (mesafenin %30’u) — herkes için rekabet tazelendi. Seviye, XP, Veri, protokol ve sinyallerin korunur.',
          accent: lg.color,
        },
        {
          icon: 'shield',
          title: `Ligin: ${lg.name}`,
          body: 'Ligin Kupa’na göre belirlenir. Maç kazandıkça yüksel; yeni sezonda üst liglere tırmanmak için en yakın rakiplerinle eşleşirsin.',
          accent: lg.color,
        },
      ]}
    />
  );
}
