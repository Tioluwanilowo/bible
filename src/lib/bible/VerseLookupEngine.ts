import { bibleLibrary } from './BibleLibraryManager';
import { ParsedReference } from './types';
import { Scripture } from '../../types';

export class VerseLookupEngine {
  public static lookup(ref: ParsedReference, defaultVersion: string): Scripture | null {
    const version = ref.version || defaultVersion;
    
    if (ref.endVerse) {
      const verses = bibleLibrary.getVerses(ref.book, ref.chapter, ref.startVerse, ref.endVerse, version);
      if (verses.length === 0) return null;
      
      const combinedText = verses.map(v => v.verse === ref.startVerse ? v.text : `[${v.verse}] ${v.text}`).join(' ');
      
      return {
        book: ref.book,
        chapter: ref.chapter,
        verse: ref.startVerse,
        endVerse: verses[verses.length - 1].verse,
        text: combinedText,
        version
      };
    } else {
      const verse = bibleLibrary.getVerse(ref.book, ref.chapter, ref.startVerse, version);
      if (!verse) return null;
      
      return {
        book: ref.book,
        chapter: ref.chapter,
        verse: ref.startVerse,
        text: verse.text,
        version
      };
    }
  }
}
