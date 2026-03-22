import { ParsingPipeline } from './bible/ParsingPipeline';
import { VerseLookupEngine } from './bible/VerseLookupEngine';
import { bibleLibrary } from './bible/BibleLibraryManager';
import { loadDefaultBibles } from './bible/BibleModuleLoader';
import { Scripture } from '../types';

export { loadDefaultBibles };
export { searchVersesByContent, primeVerseContentIndex } from './bible/VerseContentSearch';
export type { VerseMatch, ContentSearchOptions } from './bible/VerseContentSearch';

export function parseReference(input: string, currentContext: Scripture | null = null) {
  const result = ParsingPipeline.parse(input, currentContext);
  if (result.reference) {
    return {
      book: result.reference.book,
      chapter: result.reference.chapter,
      verse: result.reference.startVerse,
      endVerse: result.reference.endVerse,
      version: result.reference.version
    };
  }
  return null;
}

export function getScripture(book: string, chapter: number, verse: number, version: string, endVerse?: number): Scripture | null {
  return VerseLookupEngine.lookup({
    book,
    chapter,
    startVerse: verse,
    endVerse,
    confidence: 1,
    version
  }, version);
}

export function getBookNames(version?: string): string[] {
  return bibleLibrary.getBooks(version).map((b) => b.name);
}

export function getChapterCount(book: string, version?: string): number | null {
  return bibleLibrary.getChapterCount(book, version);
}

export function getLastVerseInChapter(book: string, chapter: number, version?: string): number | null {
  return bibleLibrary.getLastVerseInChapter(book, chapter, version);
}

export function getNextVerse(current: Scripture): Scripture | null {
  const nextV = current.endVerse ? current.endVerse + 1 : current.verse + 1;
  return getScripture(current.book, current.chapter, nextV, current.version);
}

export function getPrevVerse(current: Scripture): Scripture | null {
  const prevV = current.verse - 1;
  if (prevV <= 0) return null;
  return getScripture(current.book, current.chapter, prevV, current.version);
}

export function getExtendedRange(current: Scripture): Scripture | null {
  const endV = current.endVerse ? current.endVerse + 1 : current.verse + 1;
  return getScripture(current.book, current.chapter, current.verse, current.version, endV);
}

export function getGotoVerse(current: Scripture, targetVerse: number): Scripture | null {
  return getScripture(current.book, current.chapter, targetVerse, current.version);
}

/**
 * Returns the last valid verse number for the given book/chapter/version,
 * or null if the chapter doesn't exist. Used by ReferenceStateEngine for
 * previous-verse chapter-boundary navigation.
 */
export function getLastVerseOfChapter(book: string, chapter: number, version: string): number | null {
  for (let v = 176; v >= 1; v--) {
    const result = VerseLookupEngine.lookup({ book, chapter, startVerse: v, confidence: 1, version }, version);
    if (result) return v;
  }
  return null;
}

// ── Verse fingerprinter ───────────────────────────────────────────────────────

/**
 * English function words AND high-frequency KJV/Bible words that appear across
 * almost every verse in any chapter.  These carry no distinguishing signal when
 * scoring which verse a preacher is reading — excluding them prevents them from
 * creating false ties between multiple verses.
 *
 * Min-word-length of 4 already handles most 1–3 letter function words ("and",
 * "the", "of", "in", "he", "a"…); this list handles 4+ letter words that are
 * still too common to be informative.
 */
const VERSE_STOP_WORDS = new Set([
  // English function words (4+ chars)
  'that', 'this', 'with', 'from', 'they', 'will', 'have', 'been', 'were',
  'then', 'than', 'them', 'into', 'upon', 'unto', 'your', 'their', 'what',
  'which', 'would', 'could', 'should', 'about', 'after', 'before', 'these',
  'those', 'there', 'where', 'here', 'each', 'even', 'both', 'only', 'also',
  'when', 'whom', 'whose', 'while', 'shall', 'since', 'very', 'just', 'once',
  // KJV archaic forms
  'thou', 'thee', 'thy', 'thine', 'hath', 'doth', 'dost', 'thus', 'thereof',
  'himself', 'themselves', 'behold', 'verily', 'saith', 'spake', 'whereby',
  'therein', 'thereto', 'withal', 'whereby', 'whosoever', 'whatsoever',
  // High-frequency Bible words that appear in almost every verse
  'lord', 'said', 'come', 'came', 'went', 'make', 'made', 'like', 'great',
  'hand', 'name', 'word', 'among', 'people', 'therefore', 'speak', 'know',
  'give', 'given', 'good', 'many', 'days', 'time', 'over', 'down', 'away',
]);

/**
 * Extracts content words from a text string for fingerprinting purposes.
 * Lowercases, strips punctuation, keeps words ≥ 4 chars that are not in the
 * stop list.  These are the words that carry verse-specific meaning.
 */
function extractContentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !VERSE_STOP_WORDS.has(w));
}

/**
 * Infers the most likely verse number from spoken transcript text.
 *
 * Called when the preacher announces a book + chapter but no verse.  Instead
 * of always defaulting to verse 1, this function scores every verse in the
 * chapter by counting how many content words from the transcript appear in
 * that verse's text, then returns the verse with the highest score.
 *
 * Rationale:
 *   • Preachers often read the verse aloud immediately after announcing it,
 *     so distinctive words from the verse appear in the same transcript chunk.
 *   • Bible verse text is highly specific — "Nicodemus", "born again",
 *     "justified", "Zacchaeus" etc. are virtually unique to one or two verses.
 *   • Common words (stop list) are excluded to prevent noise matches.
 *
 * Returns verse 1 if:
 *   • The transcript has no content words (just the reference announcement).
 *   • No verse reaches the minimum match threshold of 2 content words.
 *
 * Performance: all lookups are synchronous in-memory operations on the
 * pre-loaded Bible dataset — typically < 2 ms for a 30-verse chapter.
 */
export function inferVerseFromText(
  book:    string,
  chapter: number,
  version: string,
  text:    string,
): number {
  const transcriptWords = extractContentWords(text);
  if (transcriptWords.length === 0) return 1;

  const transcriptSet = new Set(transcriptWords);

  const lastVerse = getLastVerseOfChapter(book, chapter, version);
  if (!lastVerse) return 1;

  let bestVerse = 1;
  let bestScore = 0;

  for (let v = 1; v <= lastVerse; v++) {
    const scripture = getScripture(book, chapter, v, version);
    if (!scripture) continue;

    const verseWords = extractContentWords(scripture.text);
    let score = 0;
    for (const w of verseWords) {
      if (transcriptSet.has(w)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestVerse = v;
    }
  }

  // Require at least 2 content-word matches before trusting the inference.
  // A single common word is too noisy; 2+ matching content words is a strong
  // signal that the preacher is actually reading that specific verse.
  return bestScore >= 2 ? bestVerse : 1;
}
