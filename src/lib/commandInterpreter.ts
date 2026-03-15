import { ParsingPipeline } from './bible/ParsingPipeline';
import { Command } from '../types';
import { useStore } from '../store/useStore';

const VERSION_ALIASES: Record<string, string> = {
  kjv: 'KJV', 'king james': 'KJV',
  nkjv: 'NKJV', 'new king james': 'NKJV',
  esv: 'ESV', 'english standard': 'ESV',
  asv: 'ASV', 'american standard': 'ASV',
  web: 'WEB', 'world english': 'WEB',
  bbe: 'BBE', 'basic english': 'BBE',
  amp: 'AMP', amplified: 'AMP',
  niv: 'NIV', nlt: 'NLT', nasb: 'NASB',
};

// ---------------------------------------------------------------------------
// Cross-chunk pending reference state
//
// Preachers often spread a reference across several speech chunks:
//   "Lamentations chapter 3."   →   "25 says…"
//   "Genesis."  →  "32."  →  "And verse 24."
//   "Shepherd. Luke."  →  "15 verse 4"
//   "verse."  →  "10."  →  "Chapter 19 for the son of man."
//
// _pending persists between consecutive calls to interpretTranscript.
// It expires automatically after MAX_PENDING_AGE chunks (~12-16 s at 3 s/chunk).
// ---------------------------------------------------------------------------
interface PendingRef {
  book?: string;
  chapter?: number;
  verse?: number;    // a "verse N" heard before the chapter (e.g. "verse. 10. Chapter 19")
  age: number;
}

const MAX_PENDING_AGE = 4;
let _pending: PendingRef = { age: 0 };

function agePending(): void {
  const hasData = _pending.book || _pending.chapter !== undefined || _pending.verse !== undefined;
  if (hasData) {
    _pending.age++;
    if (_pending.age > MAX_PENDING_AGE) _pending = { age: 0 };
  }
}

function clearPending(): void { _pending = { age: 0 }; }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCommand(
  intent: Command['intent'],
  confidence: number,
  payload: Command['payload'],
  sourceText: string,
): Command {
  return {
    id: Math.random().toString(36).substring(2, 9),
    intent,
    confidence,
    payload,
    timestamp: Date.now(),
    sourceText,
  };
}

/** Extract a number that opens the text, ignoring leading punctuation/spaces. */
function leadingNumber(text: string): number | null {
  const m = text.trimStart().match(/^(\d+)\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Extract N from "verse [number] N" or "verse N" patterns. */
function versePatternNumber(lower: string): number | null {
  const m = lower.match(/\bverse\s+(?:number\s+)?(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/** Extract N from "chapter N" pattern. */
function chapterPatternNumber(lower: string): number | null {
  const m = lower.match(/\bchapter\s+(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

export function interpretTranscript(text: string): Command | null {
  const state = useStore.getState();
  const currentContext = state.previewScripture;
  const lower = text.toLowerCase();

  // Age the cross-chunk pending state on every chunk processed
  agePending();

  // Run full parsing pipeline (NumberWord conversion → ContextResolver → RefParser)
  const result = ParsingPipeline.parse(text, currentContext);
  if (state.addParsingDiagnostic) {
    state.addParsingDiagnostic(result);
  }

  // ── 1. VERSION SWITCH ─────────────────────────────────────────────────────
  const versionMatch = lower.match(
    /(?:switch(?:\s+to)?|read(?:\s+(?:that|it))?\s+in|use|change\s+to)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+version|\s+bible)?\s*$/i,
  );
  if (versionMatch) {
    const raw = versionMatch[1].trim().toLowerCase();
    const resolved = VERSION_ALIASES[raw];
    if (resolved) {
      clearPending();
      return makeCommand('SWITCH_VERSION', 0.9, { version: resolved }, text);
    }
  }

  // ── 2. NAVIGATION — next/previous verse ──────────────────────────────────
  if (/\bnext\s+verse\b/.test(lower) || /\bcontinue\b/.test(lower)) {
    clearPending();
    return makeCommand('NEXT_VERSE', 0.9, {}, text);
  }
  if (
    /\b(previous|back\s+(one\s+)?|go\s+back)\s*verse\b/.test(lower) ||
    /\bback\s+one\s+verse\b/.test(lower)
  ) {
    clearPending();
    return makeCommand('PREVIOUS_VERSE', 0.9, {}, text);
  }

  // ── 3. GOTO_VERSE / combine with pending ─────────────────────────────────
  // Matches: "verse N" / "verse number N" / "go to verse N" / "skip to N" etc.
  // NOTE: only fires when no full scripture reference was detected, so that
  //   "Mark chapter 1 verse 9" → OPEN_REFERENCE(Mark 1:9), not GOTO_VERSE(9).
  const gotoRaw = lower.match(
    /(?:start\s+from|skip\s+to|go\s+to|down\s+to|verse)\s+(?:number\s+)?(\d{1,3})/,
  );
  if (gotoRaw && !result.reference) {
    const verse = parseInt(gotoRaw[1], 10);
    // If we have a pending book+chapter, complete the reference
    if (_pending.book && _pending.chapter !== undefined) {
      const cmd = makeCommand('OPEN_REFERENCE', 0.95, {
        book: _pending.book,
        chapter: _pending.chapter,
        verse,
      }, text);
      clearPending();
      return cmd;
    }
    // If we have a pending verse (heard before chapter), store it
    if (!_pending.chapter && !_pending.book) {
      _pending = { ..._pending, verse, age: 0 };
    }
    // Relative GOTO_VERSE — needs a current context
    if (currentContext) {
      clearPending();
      return makeCommand('GOTO_VERSE', 0.85, { verse }, text);
    }
  }

  // ── 4. STANDALONE "verse N" with no full ref — may precede chapter ────────
  // e.g. "verse. / 10. / Chapter 19 for the son of man."
  // We captured the "verse N" case above (gotoRaw). But handle "verse." alone:
  if (/\bverse\b/.test(lower) && !gotoRaw && !result.reference) {
    // "verse" keyword with no number — just note we're expecting a verse
    // Don't do anything actionable yet; wait for next chunk
  }

  // ── 5. SCRIPTURE REFERENCE from parser ───────────────────────────────────
  if (result.reference) {
    const ref = result.reference;

    // Book only (conf ≤ 0.5) — store book in pending, don't fire
    if (ref.confidence <= 0.5) {
      _pending = { book: ref.book, age: 0 };
      return null;
    }

    // Book+chapter with no explicit verse (conf ≈ 0.72) — store as pending
    // and fire with popup confidence so the preacher can confirm or continue
    if (ref.confidence < 0.8 && ref.startVerse === 1) {
      _pending = { book: ref.book, chapter: ref.chapter, age: 0 };
      // Fire as popup-level command (between medium and high threshold)
      const refVersionMatch = lower.match(
        /(?:switch(?:\s+to)?|read(?:\s+(?:that|it))?\s+in|in\s+the)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+version|\s+bible)?\s*$/i,
      );
      if (refVersionMatch) {
        const raw = refVersionMatch[1].trim().toLowerCase();
        const resolved = VERSION_ALIASES[raw];
        if (resolved) {
          return makeCommand('SWITCH_VERSION', 0.9, {
            book: ref.book, chapter: ref.chapter, verse: 1, version: resolved,
          }, text);
        }
      }
      return makeCommand('OPEN_REFERENCE', ref.confidence, {
        book: ref.book, chapter: ref.chapter, verse: 1,
      }, text);
    }

    // Full reference (book + chapter + verse, conf ≥ 0.9+) — clear pending
    clearPending();

    // Check for an inline version switch
    const refVersionMatch = lower.match(
      /(?:switch(?:\s+to)?|read(?:\s+(?:that|it))?\s+in|in\s+the)\s+(?:the\s+)?(\w[\w\s]*?)(?:\s+version|\s+bible)?\s*$/i,
    );
    if (refVersionMatch) {
      const raw = refVersionMatch[1].trim().toLowerCase();
      const resolved = VERSION_ALIASES[raw];
      if (resolved) {
        return makeCommand('SWITCH_VERSION', 0.9, {
          book: ref.book,
          chapter: ref.chapter,
          verse: ref.startVerse,
          endVerse: ref.endVerse,
          version: resolved,
        }, text);
      }
    }

    return makeCommand('OPEN_REFERENCE', ref.confidence, {
      book: ref.book,
      chapter: ref.chapter,
      verse: ref.startVerse,
      endVerse: ref.endVerse,
      version: ref.version,
    }, text);
  }

  // ── 6. CROSS-CHUNK ASSEMBLY — no full ref from parser ─────────────────────

  // Case A: Pending book + chapter → look for verse number in this chunk
  // e.g. Pending:{Lamentations, 3}  chunk:"25 says…"  → Lam 3:25
  // e.g. Pending:{Genesis, 32}      chunk:"And verse 24." → Gen 32:24
  if (_pending.book && _pending.chapter !== undefined) {
    const verseNum =
      versePatternNumber(lower) ??
      leadingNumber(text);

    if (verseNum !== null && verseNum >= 1 && verseNum <= 176) {
      const cmd = makeCommand('OPEN_REFERENCE', 0.95, {
        book: _pending.book,
        chapter: _pending.chapter,
        verse: verseNum,
      }, text);
      clearPending();
      return cmd;
    }

    // Check for a chapter change: "Chapter 19" after pending book
    const chNum = chapterPatternNumber(lower);
    if (chNum !== null) {
      // If we have a pending verse (reverse order: "verse 10. Chapter 19.")
      if (_pending.verse !== undefined) {
        const cmd = makeCommand('OPEN_REFERENCE', 0.88, {
          book: _pending.book ?? currentContext?.book,
          chapter: chNum,
          verse: _pending.verse,
        }, text);
        clearPending();
        return cmd;
      }
      // Just a new chapter with the same pending book
      _pending = { book: _pending.book, chapter: chNum, age: 0 };
      return makeCommand('OPEN_REFERENCE', 0.72, {
        book: _pending.book, chapter: chNum, verse: 1,
      }, text);
    }
  }

  // Case B: Pending book only → look for a chapter number in this chunk
  // e.g. Pending:{Genesis}  chunk:"32."  → store Genesis 32 (pending), show popup
  if (_pending.book && _pending.chapter === undefined) {
    // Sub-case B0: "N:M" format produced by the cross-chunk normalizer
    // e.g. tail="…Judges " + chunk="2125 says" → normalizer → "21:25 says"
    //      pending:{Judges} + chunk:"21:25 says" → Judges 21:25
    const colonRefMatch = text.trimStart().match(/^(\d{1,3}):(\d{1,3})\b/);
    if (colonRefMatch) {
      const ch = +colonRefMatch[1];
      const vs = +colonRefMatch[2];
      if (ch >= 1 && ch <= 150 && vs >= 1 && vs <= 176) {
        const cmd = makeCommand('OPEN_REFERENCE', 0.95, {
          book: _pending.book, chapter: ch, verse: vs,
        }, text);
        clearPending();
        return cmd;
      }
    }

    const chNum = chapterPatternNumber(lower) ?? leadingNumber(text);
    if (chNum !== null && chNum >= 1 && chNum <= 150) {
      _pending = { book: _pending.book, chapter: chNum, age: 0 };
      const verseNum = versePatternNumber(lower);
      if (verseNum !== null) {
        // Got book+chapter+verse all in this window
        const cmd = makeCommand('OPEN_REFERENCE', 0.95, {
          book: _pending.book, chapter: chNum, verse: verseNum,
        }, text);
        clearPending();
        return cmd;
      }
      // Book+chapter only — popup
      return makeCommand('OPEN_REFERENCE', 0.72, {
        book: _pending.book, chapter: chNum, verse: 1,
      }, text);
    }
  }

  // Case C: No pending ref, chunk has "chapter N" + optional "verse M"
  // but NO book. Use current context's book.
  // e.g. "this chapter 9 verse 35" when John is already displayed
  if (!_pending.book && currentContext) {
    const chNum = chapterPatternNumber(lower);
    const verseNum = versePatternNumber(lower);

    if (chNum !== null && verseNum !== null) {
      // "Chapter N verse M" with current context's book — medium-high confidence
      clearPending();
      return makeCommand('OPEN_REFERENCE', 0.82, {
        book: currentContext.book,
        chapter: chNum,
        verse: verseNum,
      }, text);
    }

    if (chNum !== null) {
      // Chapter only with current book — show popup
      _pending = { book: currentContext.book, chapter: chNum, age: 0 };
      return makeCommand('OPEN_REFERENCE', 0.72, {
        book: currentContext.book, chapter: chNum, verse: 1,
      }, text);
    }

    // Case D: "verse N chapter M" (reverse order) with current context
    // e.g. "verse 10. / Chapter 19 for the son of man."
    // Here we look for both in the same chunk or with stored pending verse
    if (_pending.verse !== undefined) {
      const newChNum = chapterPatternNumber(lower);
      if (newChNum !== null) {
        const cmd = makeCommand('OPEN_REFERENCE', 0.82, {
          book: currentContext.book,
          chapter: newChNum,
          verse: _pending.verse,
        }, text);
        clearPending();
        return cmd;
      }
    }
  }

  return null;
}
