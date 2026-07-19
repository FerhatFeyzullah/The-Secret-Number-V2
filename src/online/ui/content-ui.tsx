import type { ElementType } from 'react';

import type { ContentTypeId } from '@/game';
import type { GuessFeedback } from '@/online';
import { feedbackToGuessResult } from '@/online';
import { colors, withAlpha } from '@/ui/theme';

import { DigitPad } from './duel/digit-pad';
import { describe as describeNumberFeedback } from './duel/guess-history';
import { VaultDials } from './setup/vault-dials';
import { TrKeyboard } from './word/tr-keyboard';
import { WordSetupPanel } from './word/word-setup-panel';

/**
 * İçerik tipine göre UI parçaları kayıt defteri.
 *
 * number: mevcut kasa kadranı + rakam pedi (ekranlar doğrudan kullanır).
 * word: kelime belirleme paneli + TR klavye (word-setup/word-duel ekranları).
 * Bileşen prop sözleşmeleri tip bazında farklıdır (ElementType); ekran seçimi
 * route katmanında contentType ile yapılır, bu kayıt sözleşmeyi belgeler.
 */
export type ContentUIDef = {
  /** Gizli içerik belirleme girişi. */
  SetupInput: ElementType;
  /** Tahmin girişi (düello). */
  GuessPad: ElementType;
  /** İçerik değerini gösterim için biçimler (örn. "123" → "1 2 3"; null → "—"). */
  formatValue: (value: string | null) => string;
  /** Sunucu feedback'ini çip etiketi + rengine çevirir. */
  describe: (feedback: GuessFeedback) => { label: string; color: string };
};

/** Kelime feedback metni: "N harf doğru" / anagram / kazanma. */
function describeWordFeedback(feedback: GuessFeedback): { label: string; color: string } {
  if (feedback === 'win') return { label: 'doğru kelime!', color: colors.success };
  if (feedback === 'digits_correct_wrong_order')
    return { label: 'harfler doğru, yerler yanlış', color: colors.amber };
  const r = feedbackToGuessResult(feedback);
  const n = r.status === 'partial' ? r.correctCount : 0;
  if (n === 0) return { label: 'hiç doğru harf yok', color: withAlpha(colors.dim, 0.6) };
  return { label: `${n} harf doğru`, color: n >= 3 ? colors.amber : colors.cyan };
}

export const contentUI: Record<ContentTypeId, ContentUIDef> = {
  number: {
    SetupInput: VaultDials,
    GuessPad: DigitPad,
    // result-overlay'deki spaced() ile aynı gösterim.
    formatValue: (value) => (value ? value.split('').join(' ') : '—'),
    describe: describeNumberFeedback,
  },
  word: {
    SetupInput: WordSetupPanel,
    GuessPad: TrKeyboard,
    formatValue: (value) => (value ? Array.from(value).join(' ') : '—'),
    describe: describeWordFeedback,
  },
  // Kelime Yarışı: gizli kelime SUNUCU tarafından seçilir (belirleme YOK), ama
  // UI parçaları (tahmin klavyesi + gösterim/feedback) kelime ile aynıdır.
  wordrace: {
    SetupInput: WordSetupPanel,
    GuessPad: TrKeyboard,
    formatValue: (value) => (value ? Array.from(value).join(' ') : '—'),
    describe: describeWordFeedback,
  },
};

export function getContentUI(id: ContentTypeId): ContentUIDef {
  return contentUI[id];
}
