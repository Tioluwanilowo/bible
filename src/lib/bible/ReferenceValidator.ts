import { ParsedReference } from './types';

export class ReferenceValidator {
  public static validate(reference: ParsedReference | null): ParsedReference | null {
    if (!reference) return null;
    
    if (reference.endVerse && reference.endVerse <= reference.startVerse) {
      reference.endVerse = undefined;
    }
    
    if (reference.chapter <= 0) reference.chapter = 1;
    if (reference.startVerse <= 0) reference.startVerse = 1;
    
    return reference;
  }
}
