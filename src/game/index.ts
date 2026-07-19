import type { ContentTypeDef, ContentTypeId } from './content';
import { numberContent } from './number';
import { wordContent, wordRaceContent } from './word';

export type { Digit, GuessResult, InvalidReason, Secret } from './types';
export type { ContentTypeDef, ContentTypeId, ParseResult } from './content';
export { evaluateGuess, generateSecret, numberContent, parseGuess } from './number';
export {
  evaluateWordGuess,
  normalizeTr,
  opponentKnowledge,
  parseWord,
  upperTr,
  WORD_LENGTHS,
  wordContent,
  wordRaceContent,
  wordMarks,
} from './word';
export type { LetterMark } from './word';

/** İçerik tipi kayıt defteri. wordrace kelime tanımını (aynı kurallar) yeniden
 *  kullanır — yalnız id farklı. */
export const contentTypes: Record<ContentTypeId, ContentTypeDef> = {
  number: numberContent,
  word: wordContent,
  wordrace: wordRaceContent,
};

export function getContentType(id: ContentTypeId): ContentTypeDef {
  return contentTypes[id];
}
