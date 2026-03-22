/**
 * VerseContentSearch
 *
 * Fast inverted-index search over loaded Bible verses.
 *
 * Use case: the preacher quotes scripture without naming the reference.
 * Example: "The Lord is my shepherd, I shall not want" -> suggests Psalm 23:1.
 */

import { bibleLibrary } from './BibleLibraryManager';

const STOP_WORDS = new Set([
  'that', 'this', 'with', 'from', 'they', 'will', 'have', 'been', 'were',
  'then', 'than', 'them', 'into', 'upon', 'unto', 'your', 'their', 'what',
  'which', 'would', 'could', 'should', 'about', 'after', 'before', 'these',
  'those', 'there', 'where', 'here', 'each', 'even', 'both', 'only', 'also',
  'when', 'whom', 'whose', 'while', 'shall', 'since', 'very', 'just', 'once',
  'thou', 'thee', 'thy', 'thine', 'hath', 'doth', 'dost', 'thus', 'thereof',
  'himself', 'themselves', 'behold', 'verily', 'saith', 'spake', 'whereby',
  'therein', 'thereto', 'withal', 'whosoever', 'whatsoever',
  'lord', 'said', 'come', 'came', 'went', 'make', 'made', 'like', 'great',
  'hand', 'name', 'word', 'among', 'people', 'therefore', 'speak', 'know',
  'give', 'given', 'good', 'many', 'days', 'time', 'over', 'down', 'away',
]);

function extractWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w));
}

interface VerseIndex {
  wordToVerses: Map<string, string[]>;
  verseCounts: Map<string, number>;
  wordDocFreq: Map<string, number>;
  verseWordSet: Map<string, Set<string>>;
  verseIdfTotals: Map<string, number>;
  totalVerses: number;
  verseMeta: Map<string, { book: string; chapter: number; verse: number }>;
  version: string;
}

export interface VerseMatch {
  book: string;
  chapter: number;
  verse: number;
  score: number;
  matchCount: number;
}

export interface ContentSearchOptions {
  threshold?: number;
  minMatches?: number;
  maxResults?: number;
}

let cachedIndex: VerseIndex | null = null;

function buildIndex(version: string): VerseIndex {
  const entries = bibleLibrary.getVerseEntries(version);

  const wordToVerses = new Map<string, string[]>();
  const verseCounts = new Map<string, number>();
  const wordDocFreq = new Map<string, number>();
  const verseWordSet = new Map<string, Set<string>>();
  const verseIdfTotals = new Map<string, number>();
  const verseMeta = new Map<string, { book: string; chapter: number; verse: number }>();

  for (const [key, verse] of entries) {
    const words = extractWords(verse.text);
    if (words.length === 0) continue;

    const uniqueWords = [...new Set(words)];
    const uniqueWordSet = new Set(uniqueWords);

    verseCounts.set(key, uniqueWords.length);
    verseWordSet.set(key, uniqueWordSet);
    verseMeta.set(key, { book: verse.book, chapter: verse.chapter, verse: verse.verse });

    for (const w of uniqueWordSet) {
      const list = wordToVerses.get(w);
      if (list) {
        list.push(key);
      } else {
        wordToVerses.set(w, [key]);
      }
      wordDocFreq.set(w, (wordDocFreq.get(w) ?? 0) + 1);
    }
  }

  const totalVerses = verseCounts.size;
  for (const [key, words] of verseWordSet) {
    let idfTotal = 0;
    for (const word of words) {
      const df = wordDocFreq.get(word) ?? 1;
      const idf = Math.log((totalVerses + 1) / (df + 1)) + 1;
      idfTotal += idf;
    }
    verseIdfTotals.set(key, idfTotal || 1);
  }

  return {
    wordToVerses,
    verseCounts,
    wordDocFreq,
    verseWordSet,
    verseIdfTotals,
    totalVerses,
    verseMeta,
    version,
  };
}

function getOrBuildIndex(version: string): VerseIndex {
  if (!cachedIndex || cachedIndex.version !== version) {
    const t0 = performance.now();
    cachedIndex = buildIndex(version);
    const ms = Math.round(performance.now() - t0);
    console.log(
      `[VerseContentSearch] Index built for ${version}: ${cachedIndex.verseCounts.size} verses, ${cachedIndex.wordToVerses.size} words - ${ms} ms`,
    );
  }
  return cachedIndex;
}

function buildTranscriptBigrams(words: string[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i < words.length - 1; i++) {
    pairs.add(`${words[i]} ${words[i + 1]}`);
  }
  return pairs;
}

export function searchVersesByContent(
  text: string,
  version: string,
  opts: ContentSearchOptions = {},
): VerseMatch[] {
  const threshold = opts.threshold ?? 0.35;
  const minMatches = opts.minMatches ?? 3;
  const maxResults = opts.maxResults ?? 3;

  const words = extractWords(text);
  if (words.length < 5) return [];

  const transcriptSet = new Set(words);
  const transcriptWords = [...transcriptSet];
  const transcriptBigrams = buildTranscriptBigrams(transcriptWords);

  const idx = getOrBuildIndex(version);

  const matchCounts = new Map<string, number>();
  const weightedMatchSums = new Map<string, number>();

  for (const word of transcriptSet) {
    const verseKeys = idx.wordToVerses.get(word);
    if (!verseKeys) continue;

    const df = idx.wordDocFreq.get(word) ?? 1;
    const idf = Math.log((idx.totalVerses + 1) / (df + 1)) + 1;

    for (const key of verseKeys) {
      matchCounts.set(key, (matchCounts.get(key) ?? 0) + 1);
      weightedMatchSums.set(key, (weightedMatchSums.get(key) ?? 0) + idf);
    }
  }

  const results: VerseMatch[] = [];

  for (const [key, matchCount] of matchCounts) {
    if (matchCount < minMatches) continue;

    const verseWords = idx.verseWordSet.get(key);
    if (!verseWords) continue;

    const totalWeight = idx.verseIdfTotals.get(key) ?? 1;
    const matchedWeight = weightedMatchSums.get(key) ?? 0;
    const weightedCoverage = matchedWeight / totalWeight;

    let matchingBigrams = 0;
    if (transcriptBigrams.size > 0 && verseWords.size > 1) {
      const verseArray = [...verseWords];
      for (let i = 0; i < verseArray.length - 1; i++) {
        if (transcriptBigrams.has(`${verseArray[i]} ${verseArray[i + 1]}`)) {
          matchingBigrams++;
        }
      }
    }

    const phraseBonus = transcriptBigrams.size > 0
      ? Math.min(0.2, (matchingBigrams / transcriptBigrams.size) * 0.2)
      : 0;

    const score = Math.min(1, weightedCoverage * 0.85 + phraseBonus);
    if (score < threshold) continue;

    const meta = idx.verseMeta.get(key);
    if (!meta) continue;

    results.push({
      ...meta,
      score,
      matchCount,
    });
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

export function primeVerseContentIndex(version: string): void {
  getOrBuildIndex(version);
}
