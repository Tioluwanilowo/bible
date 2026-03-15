import { ParsedReference } from './types';
import { Scripture } from '../../types';

export class ScriptureContextResolver {
  public static resolveContextualCommand(
    normalizedText: string, 
    currentContext: Scripture | null
  ): ParsedReference | null {
    if (!currentContext) return null;
    
    if (normalizedText.includes('next verse') || normalizedText.includes('continue')) {
      return {
        book: currentContext.book,
        chapter: currentContext.chapter,
        startVerse: currentContext.endVerse ? currentContext.endVerse + 1 : currentContext.verse + 1,
        confidence: 0.95
      };
    }
    
    if (normalizedText.includes('previous verse') || normalizedText.includes('back one verse') || normalizedText.includes('go back')) {
      const prevV = currentContext.verse - 1;
      if (prevV > 0) {
        return {
          book: currentContext.book,
          chapter: currentContext.chapter,
          startVerse: prevV,
          confidence: 0.95
        };
      }
    }
    
    const verseMatch = normalizedText.match(/(?:skip to|go to|down to|verse)\s+(\d+)/);
    if (verseMatch) {
      return {
        book: currentContext.book,
        chapter: currentContext.chapter,
        startVerse: parseInt(verseMatch[1], 10),
        confidence: 0.85
      };
    }
    
    return null;
  }
}
