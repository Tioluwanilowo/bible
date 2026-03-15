/**
 * VerseContentSearch
 *
 * Fast inverted-index search over all loaded Bible verses.
 *
 * Use case: the preacher QUOTES scripture without naming the reference.
 * Example: "The Lord is my shepherd, I shall not want" → suggests Psalm 23:1.
 *
 * Algorithm
 * ─────────
 * BUILD (once per version, lazy-cached):
 *   word → [verseKey, ...]   inverted index
 *   verseKey → wordCount     number of UNIQUE content words per verse
 *   verseKey → meta          book / chapter / verse numbers
 *
 * SEARCH:
 *   1. Extract unique content words from the transcript.
 *   2. Walk the inverted index — count matches per candidate verse.
 *   3. Score = matchCount / verseUniqueWordCount  (fraction of verse covered).
 *   4. Return top-N verses where score >= threshold AND matchCount >= minMatches.
 *
 * Performance:
 *   Build:  ~30-60 ms (one-time, all 31 000 KJV verses).
 *   Search: ~1-5 ms per query (inverted index lookup + scoring).
 */

import { bibleLibrary } from './BibleLibraryManager';

// ── Stop words ────────────────────────────────────────────────────────────────
// Mirrors the list in bibleEngine.ts.  Words excluded here are too common to
// carry verse-distinguishing signal.
const STOP_WORDS = new Set([
  // English function words (4+ chars)
  'that', 'this', 'with', 'from', 'they', 'will', 'have', 'been', 'were',
  'then', 'than', 'them', 'into', 'upon', 'unto', 'your', 'their', 'what',
  'which', 'would', 'could', 'should', 'about', 'after', 'before', 'these',
  'those', 'there', 'where', 'here', 'each', 'even', 'both', 'only', 'also',
  'when', 'whom', 'whose', 'while', 'shall', 'since', 'very', 'just', 'once',
  // KJV archaic forms
  'thou', 'thee', 'thy', 'thine', 'hath', 'doth', 'dost', 'thus', 'thereof',
  'himself', 'themselves', 'behold', 'verily', 'saith', 'spake', 'whereby',
  'therein', 'thereto', 'withal', 'whosoever', 'whatsoever',
  // High-frequency Bible words with low distinguishing power
  'lord', 'said', 'come', 'came', 'went', 'make', 'made', 'like', 'great',
  'hand', 'name', 'word', 'among', 'people', 'therefore', 'speak', 'know',
  'give', 'given', 'good', 'many', 'days', 'time', 'over', 'down', 'away',
]);

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP_WORDS.has(w));
}

// ── Index types ───────────────────────────────────────────────────────────────

interface VerseIndex {
  /** word → verse keys that contain that word */
  wordToVerses: Map<string, string[]>;
  /** verse key → number of unique content words (denominator for scoring) */
  verseCounts: Map<string, number>;
  /** verse key → human-readable coords */
  verseMeta: Map<string, { book: string; chapter: number; verse: number }>;
  version: string;
}

export interface VerseMatch {
  book:       string;
  chapter:    number;
  verse:      number;
  /** Fraction of the verse's unique content words found in the transcript (0–1). */
  score:      number;
  matchCount: number;
}

export interface ContentSearchOptions {
  /**
   * Minimum fraction of verse content words that must appear in the transcript.
   * Default: 0.35  (35 %).
   */
  threshold?: number;
  /**
   * Absolute minimum number of matching content words required.
   * Prevents weak matches on very short verses (e.g. 1-word verses).
   * Default: 3.
   */
  minMatches?: number;
  /** Maximum number of suggestions to return.  Default: 3. */
  maxResults?: number;
}

// ── Singleton index cache ─────────────────────────────────────────────────────

let cachedIndex: VerseIndex | null = null;

function buildIndex(version: string): VerseIndex {
  const entries = bibleLibrary.getVerseEntries(version);

  const wordToVerses = new Map<string, string[]>();
  const verseCounts  = new Map<string, number>();
  const verseMeta    = new Map<string, { book: string; chapter: number; verse: number }>();

  for (const [key, verse] of entries) {
    const words = extractWords(verse.text);
    if (words.length === 0) continue;

    // Use unique words per verse — "shepherds" appearing 3× in one verse still
    // counts as 1 match so common-within-verse repetition doesn't inflate scores.
    const uniqueWords = [...new Set(words)];

    verseCounts.set(key, uniqueWords.length);
    verseMeta.set(key, { book: verse.book, chapter: verse.chapter, verse: verse.verse });

    for (const w of uniqueWords) {
      const list = wordToVerses.get(w);
      if (list) {
        list.push(key);
      } else {
        wordToVerses.set(w, [key]);
      }
    }
  }

  return { wordToVerses, verseCounts, verseMeta, version };
}

function getOrBuildIndex(version: string): VerseIndex {
  if (!cachedIndex || cachedIndex.version !== version) {
    const t0 = performance.now();
    cachedIndex = buildIndex(version);
    const ms = Math.round(performance.now() - t0);
    console.log(`[VerseContentSearch] Index built for ${version}: ${cachedIndex.verseCounts.size} verses, ${cachedIndex.wordToVerses.size} words — ${ms} ms`);
  }
  return cachedIndex;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Find Bible verses whose content significantly overlaps with the given text.
 *
 * The transcript must contain at least 5 content words; shorter utterances
 * are not reliable enough to generate suggestions.
 *
 * @param text    Spoken transcript text (already normalised by scriptureNormalizer).
 * @param version Bible version to search against (e.g. "KJV").
 * @param opts    Tuning parameters — see ContentSearchOptions.
 * @returns       Up to `maxResults` verses sorted by score descending.
 */
export function searchVersesByContent(
  text:    string,
  version: string,
  opts:    ContentSearchOptions = {},
): VerseMatch[] {
  const threshold  = opts.threshold  ?? 0.35;
  const minMatches = opts.minMatches ?? 3;
  const maxResults = opts.maxResults ?? 3;

  // Extract unique content words from the transcript
  const words = extractWords(text);
  if (words.length < 5) return [];          // too short — skip
  const transcriptSet = new Set(words);

  const idx = getOrBuildIndex(version);

  // Accumulate match counts: how many of the transcript's content words
  // appear in each candidate verse
  const matchCounts = new Map<string, number>();
  for (const word of transcriptSet) {
    const verseKeys = idx.wordToVerses.get(word);
    if (!verseKeys) continue;
    for (const key of verseKeys) {
      matchCounts.set(key, (matchCounts.get(key) ?? 0) + 1);
    }
  }

  // Score and filter
  const results: VerseMatch[] = [];
  for (const [key, count] of matchCounts) {
    if (count < minMatches) continue;

    const total = idx.verseCounts.get(key) ?? 1;
    const score = count / total;
    if (score < threshold) continue;

    const meta = idx.verseMeta.get(key);
    if (!meta) continue;

    results.push({ ...meta, score, matchCount: count });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

/**
 * Pre-warm the index for the given version so the first live search is instant.
 * Call once after loadDefaultBibles() completes.
 */
export function primeVerseContentIndex(version: string): void {
  getOrBuildIndex(version);
}
