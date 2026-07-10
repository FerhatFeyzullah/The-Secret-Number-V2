import type { ContentTypeDef, ContentTypeId } from './content';
import { numberContent } from './number';
import { wordContent } from './word';

export type { Digit, GuessResult, InvalidReason, Secret } from './types';
export type { ContentTypeDef, ContentTypeId, ParseResult } from './content';
export { evaluateGuess, generateSecret, numberContent, parseGuess } from './number';
export {
  evaluateWordGuess,
  normalizeTr,
  parseWord,
  upperTr,
  WORD_LENGTHS,
  wordContent,
  wordMarks,
} from './word';
export type { LetterMark } from './word';

/** İçerik tipi kayıt defteri. */
export const contentTypes: Record<ContentTypeId, ContentTypeDef> = {
  number: numberContent,
  word: wordContent,
};

export function getContentType(id: ContentTypeId): ContentTypeDef {
  return contentTypes[id];
}
