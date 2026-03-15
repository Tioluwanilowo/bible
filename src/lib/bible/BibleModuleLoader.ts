import { bibleLibrary } from './BibleLibraryManager';
import { BookAliasResolver } from './BookAliasResolver';

const VERSION_META: Record<string, { displayName: string }> = {
  kjv:  { displayName: 'King James Version' },
  bbe:  { displayName: 'Bible in Basic English' },
  asv:  { displayName: 'American Standard Version' },
  web:  { displayName: 'World English Bible' },
  esv:  { displayName: 'English Standard Version' },
  nkjv: { displayName: 'New King James Version' },
  amp:  { displayName: 'Amplified Bible' },
  niv:  { displayName: 'New International Version' },
  nlt:  { displayName: 'New Living Translation' },
};

async function loadBibleVersion(versionId: string): Promise<boolean> {
  try {
    // Use a relative path so this works both in the Vite dev server (served from
    // public/bibles/) and in the packaged Electron app loaded via file:// protocol
    // (bibles are copied to dist/bibles/ by Vite's public-folder handling).
    const response = await fetch(`./bibles/${versionId}.json`);
    if (!response.ok) return false;

    const data = await response.json();
    if (!data.books || Object.keys(data.books).length === 0) return false;

    const meta = VERSION_META[versionId];
    const metadata = {
      version: data.version,
      name: meta?.displayName || data.name || data.version,
      abbreviation: data.version,
      language: 'en',
      publicDomain: true,
    };

    const books: { id: string; name: string; chapters: number }[] = [];
    const verses: { book: string; chapter: number; verse: number; text: string }[] = [];

    for (const [bookName, chapters] of Object.entries(data.books || {})) {
      // Normalize to canonical name (e.g. NIV's "Psalm" → "Psalms") so all
      // versions use the same key and cross-version lookups always succeed.
      const canonicalName = BookAliasResolver.resolve(bookName) ?? bookName;
      books.push({ id: canonicalName, name: canonicalName, chapters: Object.keys(chapters as any).length });

      for (const [chapterNum, versesObj] of Object.entries(chapters as any)) {
        for (const [verseNum, text] of Object.entries(versesObj as any)) {
          verses.push({
            book: canonicalName,
            chapter: parseInt(chapterNum),
            verse: parseInt(verseNum),
            text: text as string,
          });
        }
      }
    }

    bibleLibrary.loadBible(metadata, books, verses);
    console.log(`Loaded ${data.version}: ${verses.length.toLocaleString()} verses`);
    return true;
  } catch (error) {
    console.warn(`Bible "${versionId}" not available (run "npm run setup-bibles" to download):`, (error as Error).message);
    return false;
  }
}

export async function loadDefaultBibles(): Promise<void> {
  const versionIds = Object.keys(VERSION_META); // kjv, bbe, asv, web

  const results = await Promise.allSettled(versionIds.map(loadBibleVersion));

  const loaded = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`Bibles loaded: ${loaded}/${versionIds.length} versions available`);
}
