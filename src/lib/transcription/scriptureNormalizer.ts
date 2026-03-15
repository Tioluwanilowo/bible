/**
 * scriptureNormalizer.ts
 *
 * Post-processes raw speech-to-text output to fix how scripture references
 * are transcribed.  Cloud STT often collapses spoken numbers:
 *   "John three sixteen"            → "John 316"   (should be John 3:16)
 *   "Judges twenty one twenty five" → "Judges 2125"  (should be Judges 21:25)
 *   "Romans eight twenty eight"     → "Romans 828"   (should be Romans 8:28)
 *   "Exodus five seven"             → "Exodus 57"    (should be Exodus 5:7)
 *
 * The normalizer detects recognised Bible book names followed by compact
 * numbers and re-inserts the colon.  For 2-digit numbers a per-book
 * chapter-count table distinguishes valid chapter references from compact
 * chapter:verse pairs (e.g. "Psalms 57" stays as-is; "Exodus 57" → "5:7").
 *
 * Cross-chunk support: when a book name ends one STT chunk and the compact
 * number starts the next (possibly after filler words like "It is 2125"),
 * the caller passes the previous chunk's tail for context.
 */

// ---------------------------------------------------------------------------
// All canonical Bible book names — includes Roman-numeral and ordinal variants
// so the normalizer can fix compact numbers in any spoken form.
// ---------------------------------------------------------------------------
const BOOK_NAMES: string[] = [
  // Pentateuch
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  // History
  'Joshua', 'Judges', 'Ruth',
  'First Samuel', 'Second Samuel', '1 Samuel', '2 Samuel',
  'I Samuel', 'II Samuel', '1st Samuel', '2nd Samuel',
  'First Kings', 'Second Kings', '1 Kings', '2 Kings',
  'I Kings', 'II Kings', '1st Kings', '2nd Kings',
  'First Chronicles', 'Second Chronicles', '1 Chronicles', '2 Chronicles',
  'I Chronicles', 'II Chronicles', '1st Chronicles', '2nd Chronicles',
  'Ezra', 'Nehemiah', 'Esther',
  // Poetry
  'Job', 'Psalm', 'Psalms', 'Proverbs', 'Ecclesiastes',
  'Song of Solomon', 'Song of Songs',
  // Major Prophets
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  // Minor Prophets
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  // Gospels & Acts
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  // Paul's letters
  'Romans',
  'First Corinthians', 'Second Corinthians', '1 Corinthians', '2 Corinthians',
  'I Corinthians', 'II Corinthians', '1st Corinthians', '2nd Corinthians',
  'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  'First Thessalonians', 'Second Thessalonians', '1 Thessalonians', '2 Thessalonians',
  'I Thessalonians', 'II Thessalonians', '1st Thessalonians', '2nd Thessalonians',
  'First Timothy', 'Second Timothy', '1 Timothy', '2 Timothy',
  'I Timothy', 'II Timothy', '1st Timothy', '2nd Timothy',
  'Titus', 'Philemon', 'Hebrews',
  // General letters
  'James',
  'First Peter', 'Second Peter', '1 Peter', '2 Peter',
  'I Peter', 'II Peter', '1st Peter', '2nd Peter',
  'First John', 'Second John', 'Third John', '1 John', '2 John', '3 John',
  'I John', 'II John', 'III John', '1st John', '2nd John', '3rd John',
  'Jude',
  // Apocalypse
  'Revelation',
];

// Sort longest → shortest so multi-word names ("First Corinthians") match
// before single-word prefixes ("First").
const SORTED_BOOKS = [...BOOK_NAMES].sort((a, b) => b.length - a.length);

// Pre-escaped book names for regex use.
const escapedBooks = SORTED_BOOKS.map((b) =>
  b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
);
const BOOK_RE_SRC = escapedBooks.join('|');

// ---------------------------------------------------------------------------
// Per-book chapter counts — used to disambiguate 2-digit compact refs.
// Keys are lower-cased to allow case-insensitive lookup.
// ---------------------------------------------------------------------------
const MAX_CHAPTERS_MAP: Record<string, number> = {
  // Pentateuch
  genesis: 50, exodus: 40, leviticus: 27, numbers: 36, deuteronomy: 34,
  // History
  joshua: 24, judges: 21, ruth: 4,
  '1 samuel': 31, '2 samuel': 24,
  'first samuel': 31, 'second samuel': 24,
  'i samuel': 31, 'ii samuel': 24,
  '1st samuel': 31, '2nd samuel': 24,
  '1 kings': 22, '2 kings': 25,
  'first kings': 22, 'second kings': 25,
  'i kings': 22, 'ii kings': 25,
  '1st kings': 22, '2nd kings': 25,
  '1 chronicles': 29, '2 chronicles': 36,
  'first chronicles': 29, 'second chronicles': 36,
  'i chronicles': 29, 'ii chronicles': 36,
  '1st chronicles': 29, '2nd chronicles': 36,
  ezra: 10, nehemiah: 13, esther: 10,
  // Poetry
  job: 42, psalm: 150, psalms: 150, proverbs: 31, ecclesiastes: 12,
  'song of solomon': 8, 'song of songs': 8,
  // Major Prophets
  isaiah: 66, jeremiah: 52, lamentations: 5, ezekiel: 48, daniel: 12,
  // Minor Prophets
  hosea: 14, joel: 3, amos: 9, obadiah: 1, jonah: 4, micah: 6,
  nahum: 3, habakkuk: 3, zephaniah: 3, haggai: 2, zechariah: 14, malachi: 4,
  // Gospels & Acts
  matthew: 28, mark: 16, luke: 24, john: 21, acts: 28,
  // Paul's letters
  romans: 16,
  '1 corinthians': 16, '2 corinthians': 13,
  'first corinthians': 16, 'second corinthians': 13,
  'i corinthians': 16, 'ii corinthians': 13,
  '1st corinthians': 16, '2nd corinthians': 13,
  galatians: 6, ephesians: 6, philippians: 4, colossians: 4,
  '1 thessalonians': 5, '2 thessalonians': 3,
  'first thessalonians': 5, 'second thessalonians': 3,
  'i thessalonians': 5, 'ii thessalonians': 3,
  '1st thessalonians': 5, '2nd thessalonians': 3,
  '1 timothy': 6, '2 timothy': 4,
  'first timothy': 6, 'second timothy': 4,
  'i timothy': 6, 'ii timothy': 4,
  '1st timothy': 6, '2nd timothy': 4,
  titus: 3, philemon: 1, hebrews: 13,
  // General letters
  james: 5,
  '1 peter': 5, '2 peter': 3,
  'first peter': 5, 'second peter': 3,
  'i peter': 5, 'ii peter': 3,
  '1st peter': 5, '2nd peter': 3,
  '1 john': 5, '2 john': 1, '3 john': 1,
  'first john': 5, 'second john': 1, 'third john': 1,
  'i john': 5, 'ii john': 1, 'iii john': 1,
  '1st john': 5, '2nd john': 1, '3rd john': 1,
  jude: 1, revelation: 22,
};

// ---------------------------------------------------------------------------
// Word-number → digit conversion
// Handles spoken scripture references like "John three sixteen" → "John 3 16"
// and "chapter five verse four" → "chapter 5 verse 4".
// Only converts word numbers in scripture reference contexts so that general
// sermon text like "one thing I know" is left untouched.
// ---------------------------------------------------------------------------
const WORD_ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};

const WORD_TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const ONES_PAT = Object.keys(WORD_ONES).join('|');
const TENS_PAT = Object.keys(WORD_TENS).join('|');

/**
 * Regex fragment that matches a single spoken number 1-99.
 * Handles compound forms: "twenty one", "twenty-one", "thirty five", etc.
 */
const WORD_NUM = `(?:(?:${TENS_PAT})(?:[\\s\\-](?:${ONES_PAT}))?|(?:${ONES_PAT}))`;

/**
 * Convert a word-number string to its integer value.
 * Accepts single words ("three" → 3), tens ("twenty" → 20),
 * and compound tens+ones ("twenty one" / "twenty-one" → 21).
 * Returns null if the string is not a recognised word number.
 */
function wordNumToInt(s: string): number | null {
  const lower = s.toLowerCase().trim();
  if (WORD_ONES[lower] !== undefined) return WORD_ONES[lower];
  if (WORD_TENS[lower] !== undefined) return WORD_TENS[lower];
  const m = lower.match(new RegExp(`^(${TENS_PAT})[\\s\\-](${ONES_PAT})$`));
  if (m) return (WORD_TENS[m[1]] ?? 0) + (WORD_ONES[m[2]] ?? 0);
  return null;
}

/**
 * Pre-pass: replace spoken word numbers with digits in scripture-reference
 * contexts. Two trigger contexts are recognised:
 *
 *   (a) Directly after a Bible book name:
 *       "John three sixteen"         → "John 3 16"
 *       "Romans eight twenty eight"  → "Romans 8 28"
 *       "Genesis one one"            → "Genesis 1 1"
 *
 *   (b) Directly after the keywords "chapter" or "verse":
 *       "chapter three"              → "chapter 3"
 *       "verse sixteen"              → "verse 16"
 *       "chapter five verse four"    → "chapter 5 verse 4"
 *
 * General sermon text ("one thing I know") is NOT changed because word
 * numbers are only converted when they immediately follow a known trigger.
 */
function replaceWordNumbers(text: string): string {
  let result = text;

  // (b) "chapter/verse <word-num>"  — convert in-place, keep keyword
  result = result.replace(
    new RegExp(`\\b(chapter|verse)\\s+(${WORD_NUM})`, 'gi'),
    (match, keyword: string, wordNum: string) => {
      const n = wordNumToInt(wordNum);
      return n !== null ? `${keyword} ${n}` : match;
    },
  );

  // (a) "<BookName> <word-num> [<word-num>]"  — up to 2 consecutive numbers
  result = result.replace(
    new RegExp(`\\b(${BOOK_RE_SRC})\\s+(${WORD_NUM})(?:\\s+(${WORD_NUM}))?`, 'gi'),
    (match, book: string, first: string, second: string | undefined) => {
      const n1 = wordNumToInt(first);
      if (n1 === null) return match;
      if (second !== undefined) {
        const n2 = wordNumToInt(second);
        if (n2 !== null) return `${book} ${n1} ${n2}`;
      }
      return `${book} ${n1}`;
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Chapter / verse range heuristics
// Max chapters in any canonical book = 150 (Psalms)
// Max verses in any single chapter   = 176 (Psalm 119)
// ---------------------------------------------------------------------------
const MAX_CHAPTER = 150;
const MAX_VERSE   = 176;

function isValidChapter(n: number) { return n >= 1 && n <= MAX_CHAPTER; }
function isValidVerse(n: number)   { return n >= 1 && n <= MAX_VERSE; }

function getMaxChapters(bookName: string): number {
  return MAX_CHAPTERS_MAP[bookName.toLowerCase()] ?? MAX_CHAPTER;
}

/**
 * Try to split a 3- or 4-digit compact string into "chapter:verse".
 * Returns a formatted string like "21:25", or null if no valid split found.
 */
function splitChapterVerse(digits: string): string | null {
  if (digits.length === 3) {
    // Candidates: 1:23  or  12:3
    const candidates: [number, number][] = [
      [+digits[0],          +digits.slice(1)],   // e.g. 3:16
      [+digits.slice(0, 2), +digits[2]],          // e.g. 31:6
    ];
    for (const [ch, vs] of candidates) {
      if (isValidChapter(ch) && isValidVerse(vs)) return `${ch}:${vs}`;
    }
  }

  if (digits.length === 4) {
    // Candidates (most likely first): 12:34 > 1:234 > 123:4
    const candidates: [number, number][] = [
      [+digits.slice(0, 2), +digits.slice(2)],   // e.g. 21:25  ← most common
      [+digits[0],          +digits.slice(1)],   // e.g. 1:234
      [+digits.slice(0, 3), +digits[3]],          // e.g. 123:4
    ];
    for (const [ch, vs] of candidates) {
      if (isValidChapter(ch) && isValidVerse(vs)) return `${ch}:${vs}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalise scripture references in a raw STT transcript.
 *
 * Fixes:
 *  0. 2-digit compact — "Exodus 57"    → "Exodus 5:7"   (57 > 40-chapter Exodus)
 *                        "Psalms 57"   → unchanged       (57 ≤ 150-chapter Psalms)
 *  1. Spaced numbers  — "John 3 16"    → "John 3:16"
 *                        "Judges 21 25"→ "Judges 21:25"
 *  2. 3-4 digit compact — "John 316"   → "John 3:16"
 *                          "Judges 2125"→ "Judges 21:25"
 *  3. Already-correct refs ("John 3:16") are left untouched.
 */
export function normalizeScriptureRefs(text: string): string {
  if (!text) return text;

  // Pre-pass: spoken word numbers → digits in scripture reference contexts.
  // "John three sixteen" → "John 3 16"  |  "verse four" → "verse 4"
  let result = replaceWordNumbers(text);

  // --- Pass -1: strip "chapter" / "verse" keywords and insert colon ---
  // "John chapter 3 verse 16"        → "John 3:16"
  // "Genesis chapter 1 verse 1"      → "Genesis 1:1"
  // "Psalm 23 verse 1"               → "Psalm 23:1"
  // "Matthew chapter 4 from verse 8" → "Matthew 4:8"  (handles spoken "from verse N")
  result = result.replace(
    new RegExp(
      `\\b(${BOOK_RE_SRC})\\s+(?:chapter\\s+)?(\\d{1,3})\\s+(?:from\\s+)?(?:verse\\s+)?(\\d{1,3})(?!\\s*:)\\b`,
      'gi',
    ),
    (_match, book, ch, vs) => {
      const c = +ch;
      const v = +vs;
      if (isValidChapter(c) && isValidVerse(v)) return `${book} ${c}:${v}`;
      return _match;
    },
  );

  // --- Pass 0: "Book NN" → "Book N:N" when NN exceeds the book's chapter count ---
  // e.g. "Exodus 57": 57 > 40 → "Exodus 5:7"
  // e.g. "Psalms 57": 57 ≤ 150 → unchanged (valid chapter 57)
  // Guard (?!\d) prevents matching the first 2 digits of a 3+ digit number.
  result = result.replace(
    new RegExp(`\\b(${BOOK_RE_SRC})\\s+(\\d{2})(?!\\d)(?!\\s*:)`, 'gi'),
    (_match, book, digits) => {
      const num = +digits;
      if (num > getMaxChapters(book)) {
        const ch = +digits[0];
        const vs = +digits[1];
        if (isValidChapter(ch) && isValidVerse(vs)) return `${book} ${ch}:${vs}`;
      }
      return _match;
    },
  );

  // --- Pass 1: "Book N N" → "Book N:N"  (two separate numbers with a space) ---
  // e.g. "John 3 16" → "John 3:16",  "Judges 21 25" → "Judges 21:25"
  // Guard: don't match if already followed by a colon ("John 3:16 ...")
  result = result.replace(
    new RegExp(
      `\\b(${BOOK_RE_SRC})\\s+(\\d{1,3})\\s+(\\d{1,3})(?!\\s*:)\\b`,
      'gi',
    ),
    (_match, book, ch, vs) => {
      const c = +ch;
      const v = +vs;
      if (isValidChapter(c) && isValidVerse(v)) return `${book} ${c}:${v}`;
      return _match; // not a valid ref — leave as-is
    },
  );

  // --- Pass 2: "Book NNNN" → "Book NN:NN"  (3- or 4-digit compact number) ---
  // e.g. "Judges 2125" → "Judges 21:25",  "John 316" → "John 3:16"
  result = result.replace(
    new RegExp(`\\b(${BOOK_RE_SRC})\\s+(\\d{3,4})\\b`, 'gi'),
    (_match, book, digits) => {
      const normalized = splitChapterVerse(digits);
      return normalized ? `${book} ${normalized}` : _match;
    },
  );

  return result;
}

/**
 * Normalise a transcript chunk while also checking for references that span
 * the boundary between the *previous* chunk and this one.
 *
 * Three cross-chunk variants are handled:
 *   A) Tail ends with book name:    "…Judges"   | "2125 says…"
 *   B) Tail ends with book name:    "…Judges"   | "It is 2125 says…"
 *   C) Book name appears ANYWHERE in the previous tail (not just at the end):
 *      "And Judges tells us this"   | "2125 says…"
 *
 * For A & B: if the previous tail ends with a book name, scan the first WINDOW
 * words of the current chunk for a bare digit string and normalize it using
 * that book name.
 *
 * For C: if the current chunk starts with a bare 2-4 digit number that wasn't
 * caught by A/B, search the ENTIRE previous tail for the most recently
 * mentioned book name, then try normalising those leading digits as a
 * chapter:verse for that book.
 *
 * @param text         Current chunk transcript (raw from STT)
 * @param previousTail Last N words of the previous chunk (or empty string)
 */
export function normalizeWithTailContext(text: string, previousTail: string): string {
  if (!text) return text;

  if (previousTail) {
    // ── Case A / B: tail ends with a book name ────────────────────────────
    const tailBookRe = new RegExp(`(${BOOK_RE_SRC})\\s*$`, 'i');
    const tailBookMatch = previousTail.match(tailBookRe);

    if (tailBookMatch) {
      const bookName = tailBookMatch[1];
      const words = text.trimStart().split(/\s+/);
      const WINDOW = 5;

      for (let i = 0; i < Math.min(words.length, WINDOW); i++) {
        if (/^\d{2,4}$/.test(words[i])) {
          const testRef = `${bookName} ${words[i]}`;
          const normRef = normalizeScriptureRefs(testRef);
          if (normRef !== testRef) {
            const normNumber = normRef.slice(bookName.length + 1);
            const newWords = [...words];
            newWords[i] = normNumber;
            return normalizeScriptureRefs(newWords.join(' '));
          }
          break;
        }
      }
    }

    // ── Case C: book name is ANYWHERE in the previous tail (not just end) ─
    // e.g. "And Judges tells us this doesn't it?" → "2125 says…"
    // The 4-word tail window may not include the book — but the full previousTail
    // text passed here (up to 15 words) is searched exhaustively.
    const digitMatch = text.trimStart().match(/^(\d{2,4})\b/);
    if (digitMatch) {
      // Find the LAST (most recently spoken) book name anywhere in the full tail
      const anyBookRe = new RegExp(`\\b(${BOOK_RE_SRC})\\b`, 'gi');
      let lastBook: string | null = null;
      let m: RegExpExecArray | null;
      while ((m = anyBookRe.exec(previousTail)) !== null) {
        lastBook = m[1]; // keep overwriting → we want the last occurrence
      }

      if (lastBook) {
        const testRef = `${lastBook} ${digitMatch[1]}`;
        const normRef = normalizeScriptureRefs(testRef);
        if (normRef !== testRef) {
          // Digits normalised → splice the "NN:NN" form into the current chunk
          const normNum = normRef.slice(lastBook.length + 1); // e.g. "21:25"
          const fixed = text.trimStart().replace(/^\d{2,4}\b/, normNum);
          return normalizeScriptureRefs(fixed);
        }
      }
    }
  }

  return normalizeScriptureRefs(text);
}

/**
 * Extract the last `wordCount` words from a transcript chunk to use as
 * tail context for the *next* chunk.  Returns a trailing-space string so
 * it can be directly prepended to the next chunk without extra glue.
 *
 * Trailing punctuation is stripped from each word so that "Luke." and "Luke"
 * both appear as "Luke" in the tail — this ensures the tailBookRe in
 * normalizeWithTailContext correctly recognises book names after punctuation.
 */
export function extractChunkTail(text: string, wordCount = 4): string {
  if (!text.trim()) return '';
  const words = text
    .trim()
    .split(/\s+/)
    .map(w => w.replace(/[.,;!?:]+$/, ''))   // strip trailing punctuation
    .filter(Boolean);
  return words.slice(-wordCount).join(' ') + ' ';
}
