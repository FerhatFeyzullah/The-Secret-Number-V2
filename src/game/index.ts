import type { ContentTypeDef, ContentTypeId } from './content';
import { numberContent } from './number';

export type { Digit, GuessResult, InvalidReason, Secret } from './types';
export type { ContentTypeDef, ContentTypeId, ParseResult } from './content';
export { evaluateGuess, generateSecret, numberContent, parseGuess } from './number';

/** İçerik tipi kayıt defteri. Kelime modu (Faz 2) buraya eklenir. */
export const contentTypes: Record<ContentTypeId, ContentTypeDef> = {
  number: numberContent,
};

export function getContentType(id: ContentTypeId): ContentTypeDef {
  return contentTypes[id];
}
