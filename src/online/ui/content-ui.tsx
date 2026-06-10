import type { ContentTypeId } from '@/game';
import type { GuessFeedback } from '@/online';

import { DigitPad } from './duel/digit-pad';
import { describe as describeNumberFeedback } from './duel/guess-history';
import { VaultDials } from './setup/vault-dials';

/**
 * İçerik tipine göre UI parçaları kayıt defteri (Faz 1 iskeleti).
 *
 * Şimdilik tek implementasyon: sayı modunun mevcut bileşenleri. Ekranlar
 * (setup-screen, duel-screen) henüz bu kayıt defteri ÜZERİNDEN bağlanmadı —
 * kelime modu (Faz 2) ikinci üyeyi eklediğinde ekranlar buradan seçecek;
 * o adımda SetupInput/GuessPad prop sözleşmeleri de tip-bağımsızlaştırılır.
 */
export type ContentUIDef = {
  /** Gizli içerik belirleme girişi (setup / round-setup ekranı). */
  SetupInput: typeof VaultDials;
  /** Tahmin girişi (duel ekranı). */
  GuessPad: typeof DigitPad;
  /** İçerik değerini gösterim için biçimler (örn. "123" → "1 2 3"; null → "—"). */
  formatValue: (value: string | null) => string;
  /** Sunucu feedback'ini çip etiketi + rengine çevirir. */
  describe: (feedback: GuessFeedback) => { label: string; color: string };
};

export const contentUI: Partial<Record<ContentTypeId, ContentUIDef>> = {
  number: {
    SetupInput: VaultDials,
    GuessPad: DigitPad,
    // result-overlay'deki spaced() ile aynı gösterim.
    formatValue: (value) => (value ? value.split('').join(' ') : '—'),
    describe: describeNumberFeedback,
  },
  // TODO(Faz 2C): word girişi/klavyesi buraya eklenir; o zamana dek
  // getContentUI number'a düşer (word maçı UI'dan henüz açılamaz).
};

export function getContentUI(id: ContentTypeId): ContentUIDef {
  return contentUI[id] ?? contentUI.number!;
}
