import { ComingSoon } from '@/ui/coming-soon';
import { colors } from '@/ui/theme';

/** Turnuva sekmesi (/cup) — yer tutucu. İçerik sonra netleşecek. */
export default function CupRoute() {
  return (
    <ComingSoon
      icon="award"
      title="TURNUVALAR"
      subtitle="Haftalık turnuvalarda özel ödüller ve sıralama için yarış."
      accent={colors.amber}
    />
  );
}
