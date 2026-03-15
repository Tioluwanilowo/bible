import { BibleMetadata, BibleBook, BibleVerse } from './types';

export class BibleLibraryManager {
  private static instance: BibleLibraryManager;
  private bibles: Map<string, { 
    metadata: BibleMetadata, 
    books: BibleBook[], 
    verseIndex: Record<string, BibleVerse> 
  }> = new Map();
  private defaultVersion: string = 'KJV';

  private constructor() {}

  public static getInstance(): BibleLibraryManager {
    if (!BibleLibraryManager.instance) {
      BibleLibraryManager.instance = new BibleLibraryManager();
    }
    return BibleLibraryManager.instance;
  }

  public loadBible(metadata: BibleMetadata, books: BibleBook[], verses: BibleVerse[]) {
    const verseIndex: Record<string, BibleVerse> = {};
    for (const v of verses) {
      const key = `${v.book.toLowerCase()}-${v.chapter}-${v.verse}`;
      verseIndex[key] = v;
    }
    this.bibles.set(metadata.abbreviation.toUpperCase(), { metadata, books, verseIndex });
  }

  public getAvailableVersions(): string[] {
    return Array.from(this.bibles.keys());
  }

  public getVerse(book: string, chapter: number, verse: number, version?: string): BibleVerse | null {
    const targetVersion = (version || this.defaultVersion).toUpperCase();
    const bible = this.bibles.get(targetVersion);
    if (!bible) return null;

    const key = `${book.toLowerCase()}-${chapter}-${verse}`;
    return bible.verseIndex[key] || null;
  }
  
  /**
   * Return every [key, BibleVerse] pair loaded for the given version.
   * Key format: "genesis-1-1", "john-3-16", etc.
   * Used by VerseContentSearch to build the inverted word index.
   */
  public getVerseEntries(version?: string): Array<[string, BibleVerse]> {
    const target = (version || this.defaultVersion).toUpperCase();
    const bible = this.bibles.get(target);
    if (!bible) return [];
    return Object.entries(bible.verseIndex) as Array<[string, BibleVerse]>;
  }

  public getVerses(book: string, chapter: number, startVerse: number, endVerse: number, version?: string): BibleVerse[] {
    const targetVersion = (version || this.defaultVersion).toUpperCase();
    const bible = this.bibles.get(targetVersion);
    if (!bible) return [];

    const results: BibleVerse[] = [];
    for (let i = startVerse; i <= endVerse; i++) {
      const key = `${book.toLowerCase()}-${chapter}-${i}`;
      if (bible.verseIndex[key]) {
        results.push(bible.verseIndex[key]);
      } else {
        break; // Stop if a verse is missing in the range
      }
    }
    return results;
  }
}

export const bibleLibrary = BibleLibraryManager.getInstance();
