import type { InfoSection } from './info-modal';
import { colors } from './theme';

/** Ana ekran karşılama modalının içeriği — ilk açılışta otomatik, Ayarlar'dan
 *  tekrar açılabilir. Tek kaynaktan (home + settings aynı içeriği kullanır). */
export const WELCOME_INTRO: {
  title: string;
  icon: InfoSection['icon'];
  accent: string;
  sections: InfoSection[];
} = {
  title: 'HOŞ GELDİN',
  icon: 'zap',
  accent: colors.cyan,
  sections: [
    {
      icon: 'target',
      accent: colors.cyan,
      title: 'Amaç',
      body: 'Rakibinin gizli kodunu ondan önce çöz — sayı modunda 3 haneli sayı, kelime modunda 4-6 harfli kelime. Sırayla tahmin eder, “kaç tanesi doğru” ipucuyla yaklaşırsın.',
    },
    {
      icon: 'wifi',
      accent: colors.teal,
      title: 'Çevrimdışı / Çevrimiçi',
      body: 'Çevrimdışı: tek başına, internetsiz pratik. Çevrimiçi: gerçek rakiplere karşı — Kupa, XP ve Veri kazandırır.',
    },
    {
      icon: 'grid',
      accent: colors.violet,
      title: 'Ana Ekran',
      body: 'OYNA ile mod seçip başlarsın. Üstte profilin ve kupan, “Protokoller” ile güçlerin, “Ayarlar” ile ses/profil ayarların.',
    },
    {
      icon: 'help-circle',
      accent: colors.amber,
      title: 'Kurallar',
      body: 'Tüm kuralların ayrıntısı için ana ekrandaki “Nasıl Oynanır”a göz at.',
    },
  ],
};
