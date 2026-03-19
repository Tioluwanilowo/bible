/**
 * ReferenceStateEngine
 *
 * Orchestrates the AI-assisted Bible reference detection pipeline:
 *
 *  1. Receives the rolling transcript buffer, confirmedRef, and pendingRef.
 *  2. Expires stale pendingRef (> PENDING_EXPIRY_MS of unrelated speech).
 *  3. Calls ChatGPTInterpreter to get an AIResponse.
 *  4. Resolves the AIResponse into a concrete Command using:
 *       - Same-book / chapter / verse inheritance from confirmedRef & pendingRef
 *       - Boundary-aware next/previous verse and chapter navigation
 *       - Local Bible dataset lookups (via bibleEngine)
 *
 * What this engine does NOT do:
 *   ✗ Call STT providers
 *   ✗ Access the Zustand store directly (results are returned to the store)
 *   ✗ Look up verse text (that happens inside executeCommand → VerseLookupEngine)
 */

import type { Transcript, Command, ConfirmedRef, PendingRef } from '../../types';
import type { AIResponse, InterpretResult } from './types';
import { chatGPTInterpreter } from './ChatGPTInterpreter';
import { getScripture, getLastVerseOfChapter, inferVerseFromText } from '../bibleEngine';

// ── Constants ────────────────────────────────────────────────────────────────

/** How long (ms) a partial pending reference survives without completion. */
const PENDING_EXPIRY_MS = 5_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCommand(
  intent:     Command['intent'],
  confidence: number,
  payload:    Command['payload'],
  sourceText: string,
): Command {
  return {
    id:         Math.random().toString(36).substring(2, 9),
    intent,
    confidence,
    payload,
    timestamp:  Date.now(),
    sourceText,
  };
}

// ── Engine class ──────────────────────────────────────────────────────────────

export class ReferenceStateEngine {
  private static instance: ReferenceStateEngine;

  static getInstance(): ReferenceStateEngine {
    if (!ReferenceStateEngine.instance) {
      ReferenceStateEngine.instance = new ReferenceStateEngine();
    }
    return ReferenceStateEngine.instance;
  }

  /**
   * Main entry point called from the store's addTranscript action.
   *
   * @returns InterpretResult — may contain a Command (to pass to processCommand)
   *          and/or an updated pendingRef.
   * @throws  When the AI call fails (both primary and fallback models).
   *          The caller (store) catches this and runs the rule-based fallback.
   */
  async process(
    buffer:       Transcript[],
    confirmedRef: ConfirmedRef | null,
    pendingRef:   PendingRef   | null,
    apiKey:       string,
    version:      string,
  ): Promise<InterpretResult> {
    // ── Expire stale pending ref ──────────────────────────────────────────
    const now = Date.now();
    const activePending: PendingRef | null =
      pendingRef && (now - pendingRef.updatedAt) <= PENDING_EXPIRY_MS
        ? pendingRef
        : null;

    // Returning pendingRef: null here signals the store to clear an expired pending
    const expiredPendingClear = pendingRef && !activePending
      ? { pendingRef: null as null }
      : {};

    // ── Call ChatGPT API ──────────────────────────────────────────────────
    const aiResponse = await chatGPTInterpreter.interpret(
      buffer,
      confirmedRef,
      activePending,
      apiKey,
    );

    // null means empty buffer or no API key — should not reach here normally
    if (!aiResponse) {
      return expiredPendingClear;
    }

    // ── Resolve AI response into a Command ────────────────────────────────
    // Join all buffer chunks so the verse fingerprinter (inferVerseFromText)
    // sees the full rolling window of speech, not just the final chunk.
    // The anti-hallucination book check also benefits — the book name may have
    // appeared in an earlier chunk rather than the most recent one.
    const sourceText = buffer.map(t => t.text).join(' ');
    const latestText = buffer[buffer.length - 1]?.text ?? '';
    const result = this.resolveCommand(
      aiResponse,
      confirmedRef,
      activePending,
      version,
      sourceText,
      latestText,
    );

    // Merge expired-pending signal with resolve result
    // (if resolveCommand already sets pendingRef, that takes precedence)
    return Object.keys(expiredPendingClear).length > 0 && result.pendingRef === undefined
      ? { ...expiredPendingClear, ...result }
      : result;
  }

  // ── Command resolution ────────────────────────────────────────────────────

  private resolveCommand(
    ai:          AIResponse,
    confirmed:   ConfirmedRef | null,
    pending:     PendingRef   | null,
    version:     string,
    sourceText:  string,
    latestText:  string,
  ): InterpretResult {
    const blockRelativeNav = this.shouldBlockRelativeNavigation(confirmed, pending);

    switch (ai.command) {
      case 'set_reference':
        return this.resolveSetReference(ai, confirmed, pending, version, sourceText);

      case 'jump_to_verse':
        if (!this.hasRelativeNavigationCue(latestText, ai.command)) return {};
        if (blockRelativeNav) return {};
        return this.resolveJumpToVerse(ai, confirmed, version, sourceText);

      case 'next_verse':
        if (!this.hasRelativeNavigationCue(latestText, ai.command)) return {};
        if (blockRelativeNav) return {};
        return this.resolveNextVerse(confirmed, version, sourceText);

      case 'previous_verse':
        if (!this.hasRelativeNavigationCue(latestText, ai.command)) return {};
        if (blockRelativeNav) return {};
        return this.resolvePrevVerse(confirmed, version, sourceText);

      case 'next_chapter':
        if (!this.hasRelativeNavigationCue(latestText, ai.command)) return {};
        if (blockRelativeNav) return {};
        return this.resolveNextChapter(confirmed, version, sourceText);

      case 'previous_chapter':
        if (!this.hasRelativeNavigationCue(latestText, ai.command)) return {};
        if (blockRelativeNav) return {};
        return this.resolvePrevChapter(confirmed, version, sourceText);

      case 'change_translation':
        return this.resolveChangeTranslation(ai, sourceText);

      case 'no_action':
      default:
        // Nothing to do; no change to pending
        return {};
    }
  }

  private hasRelativeNavigationCue(
    text:    string,
    command: AIResponse['command'],
  ): boolean {
    const t = text.toLowerCase();
    if (!t.trim()) return false;

    switch (command) {
      case 'next_verse':
        return /\b(next verse|continue(?: reading)?|carry on|moving on|move forward|read on|keep reading|and verse\s+\d+)\b/.test(t);
      case 'previous_verse':
        return /\b(previous verse|back one verse|go back(?: one verse)?|verse before)\b/.test(t);
      case 'jump_to_verse':
        return /\b((go|skip|jump)\s+to\s+verse|verse\s+\d+)\b/.test(t);
      case 'next_chapter':
        return /\b(next chapter|go to chapter\s+\d+|moving to chapter\s+\d+)\b/.test(t);
      case 'previous_chapter':
        return /\b(previous chapter|back a chapter|go back a chapter)\b/.test(t);
      default:
        return true;
    }
  }

  private sameBookName(a: string, b: string): boolean {
    const normalizedA = a.toLowerCase().replace(/\s+/g, ' ').trim();
    const normalizedB = b.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizedA === normalizedB) return true;

    const compactA = a.toLowerCase().replace(/[^a-z0-9]/g, '');
    const compactB = b.toLowerCase().replace(/[^a-z0-9]/g, '');
    return compactA === compactB;
  }

  /**
   * Guardrail against accidental relative navigation ("continue", "next verse")
   * while a new target reference is still being assembled (e.g. "Mark 10 ...").
   */
  private shouldBlockRelativeNavigation(
    confirmed: ConfirmedRef | null,
    pending:   PendingRef   | null,
  ): boolean {
    if (!confirmed || !pending) return false;

    const hasPendingContext =
      typeof pending.book === 'string' ||
      typeof pending.chapter === 'number';
    if (!hasPendingContext) return false;

    const pendingIsIncomplete = typeof pending.verseStart !== 'number';
    if (!pendingIsIncomplete) return false;

    const bookConflicts = typeof pending.book === 'string'
      ? !this.sameBookName(pending.book, confirmed.book)
      : false;
    const chapterConflicts = typeof pending.chapter === 'number'
      ? pending.chapter !== confirmed.chapter
      : false;

    return bookConflicts || chapterConflicts;
  }

  // ── set_reference ─────────────────────────────────────────────────────────

  private resolveSetReference(
    ai:         AIResponse,
    confirmed:  ConfirmedRef | null,
    pending:    PendingRef   | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    // Anti-hallucination: if the AI returned a book that doesn't appear in the
    // spoken text, it likely hallucinated from training data. Fall back to the
    // confirmed/pending book instead of blindly trusting the AI-supplied book.
    //
    // Exception — same-book updates:
    // When the AI's book matches the currently confirmed book we are ALREADY
    // displaying that book.  The guard's job is to prevent wild CROSS-BOOK
    // jumps (e.g. model says "Matthew" when preaching about grace while on
    // Luke).  Blocking a verse update within the same book is overly strict
    // and breaks the primary Realtime use-case where the model correctly tracks
    // "Philippians 1:24" from cumulative session audio even though the recent
    // Whisper chunk only captured a sentence mid-passage.
    const srcLower = sourceText.toLowerCase();
    const aiBookMatchesConfirmed =
      ai.book && confirmed?.book &&
      ai.book.toLowerCase().split(' ')[0] === confirmed.book.toLowerCase().split(' ')[0];
    const aiBookVerified = ai.book
      ? aiBookMatchesConfirmed || srcLower.includes(ai.book.toLowerCase().split(' ')[0])
      : false;
    const effectiveAiBook = aiBookVerified ? ai.book : undefined;

    // If book not verified, discard it — inherit from confirmed/pending instead.
    // Inherit missing components: AI omits what was not spoken; fill from
    // pending first, then from confirmed (same-book/chapter inheritance).
    const book       = effectiveAiBook ?? pending?.book ?? confirmed?.book ?? null;
    const chapter    = ai.chapter ?? pending?.chapter ?? null;
    const verse      = ai.verse   ?? pending?.verseStart                   ?? null;
    const verseEnd   = ai.verseEnd;
    const translation = ai.translation ?? confirmed?.translation ?? version;

    // Dedup: if the fully-resolved reference is identical to what is already
    // confirmed, the AI re-fired from rolling buffer history — skip it.
    if (
      confirmed &&
      book     === confirmed.book        &&
      chapter  === confirmed.chapter     &&
      verse    === confirmed.verseStart  &&
      !verseEnd
    ) {
      return {};
    }

    // ── Full reference: book + chapter + verse ────────────────────────────
    if (book && chapter !== null && verse !== null) {
      // Verify the verse exists in the local dataset before firing
      const scripture = getScripture(book, chapter, verse, translation, verseEnd);
      if (scripture) {
        return {
          command: makeCommand(
            'OPEN_REFERENCE',
            ai.confidence,
            { book, chapter, verse, endVerse: verseEnd },
            sourceText,
          ),
          pendingRef: null, // completed — clear pending
        };
      }
      // Verse not found (wrong book/chapter/verse combo) — store what we know
    }

    // ── book + chapter only (no verse yet) ───────────────────────────────
    if (book && chapter !== null && verse === null) {
      // Infer which verse the preacher is reading by scoring each verse in the
      // chapter against the spoken transcript words.  Falls back to verse 1 if
      // the transcript has no content words or no verse reaches the 2-word match
      // threshold (e.g. preacher only announced the reference without reading).
      const inferredVerse = inferVerseFromText(book, chapter, translation, sourceText);

      const newPending: PendingRef = { book, chapter, updatedAt: Date.now() };
      // Fire a below-highConfidenceThreshold command so it goes through the
      // approval flow rather than updating live automatically.
      return {
        command:    makeCommand(
          'OPEN_REFERENCE',
          Math.min(ai.confidence, 0.72),
          { book, chapter, verse: inferredVerse },
          sourceText,
        ),
        pendingRef: newPending,
      };
    }

    // ── book only ─────────────────────────────────────────────────────────
    if (book && chapter === null) {
      return {
        pendingRef: { book, updatedAt: Date.now() },
      };
    }

    // ── verse only (no book or chapter mentioned) ─────────────────────────
    // Inherit both book and chapter from confirmed
    if (verse !== null && !ai.book && !ai.chapter && confirmed) {
      const scripture = getScripture(
        confirmed.book,
        confirmed.chapter,
        verse,
        confirmed.translation,
        verseEnd,
      );
      if (scripture) {
        return {
          command: makeCommand(
            'OPEN_REFERENCE',
            ai.confidence,
            { book: confirmed.book, chapter: confirmed.chapter, verse, endVerse: verseEnd },
            sourceText,
          ),
          pendingRef: null,
        };
      }
    }

    // ── chapter + verse, no book ──────────────────────────────────────────
    if (!ai.book && chapter !== null && verse !== null && confirmed) {
      const scripture = getScripture(
        confirmed.book,
        chapter,
        verse,
        confirmed.translation,
        verseEnd,
      );
      if (scripture) {
        return {
          command: makeCommand(
            'OPEN_REFERENCE',
            ai.confidence,
            { book: confirmed.book, chapter, verse, endVerse: verseEnd },
            sourceText,
          ),
          pendingRef: null,
        };
      }
    }

    // Partial data that doesn't form a resolvable reference yet — store it
    const partialPending: PendingRef = {
      ...(book        ? { book }        : {}),
      ...(chapter !== null ? { chapter } : {}),
      ...(verse  !== null  ? { verseStart: verse } : {}),
      ...(verseEnd    ? { verseEnd }    : {}),
      updatedAt: Date.now(),
    };
    return { pendingRef: partialPending };
  }

  // ── jump_to_verse ─────────────────────────────────────────────────────────

  private resolveJumpToVerse(
    ai:         AIResponse,
    confirmed:  ConfirmedRef | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    if (!ai.verse || !confirmed) return {};

    const scripture = getScripture(
      confirmed.book,
      confirmed.chapter,
      ai.verse,
      version,
    );
    if (!scripture) return {};

    return {
      command: makeCommand(
        'OPEN_REFERENCE',
        ai.confidence,
        { book: confirmed.book, chapter: confirmed.chapter, verse: ai.verse },
        sourceText,
      ),
      pendingRef: null,
    };
  }

  // ── next_verse ────────────────────────────────────────────────────────────

  private resolveNextVerse(
    confirmed:  ConfirmedRef | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    if (!confirmed) return {};

    const nextVNum = (confirmed.verseEnd ?? confirmed.verseStart) + 1;

    // Try next verse in the same chapter
    let scripture = getScripture(confirmed.book, confirmed.chapter, nextVNum, version);

    // Chapter boundary: wrap to first verse of next chapter
    if (!scripture) {
      scripture = getScripture(confirmed.book, confirmed.chapter + 1, 1, version);
    }

    if (!scripture) return {}; // end of book — stay put

    return {
      command: makeCommand(
        'OPEN_REFERENCE',
        0.95,
        { book: scripture.book, chapter: scripture.chapter, verse: scripture.verse },
        sourceText,
      ),
      pendingRef: null,
    };
  }

  // ── previous_verse ────────────────────────────────────────────────────────

  private resolvePrevVerse(
    confirmed:  ConfirmedRef | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    if (!confirmed) return {};

    const prevVNum = confirmed.verseStart - 1;

    if (prevVNum >= 1) {
      const scripture = getScripture(confirmed.book, confirmed.chapter, prevVNum, version);
      if (scripture) {
        return {
          command: makeCommand(
            'OPEN_REFERENCE',
            0.95,
            { book: scripture.book, chapter: scripture.chapter, verse: scripture.verse },
            sourceText,
          ),
          pendingRef: null,
        };
      }
    }

    // Chapter boundary: wrap to last verse of previous chapter
    if (confirmed.chapter > 1) {
      const prevChapter = confirmed.chapter - 1;
      const lastVerse   = getLastVerseOfChapter(confirmed.book, prevChapter, version);
      if (lastVerse !== null) {
        return {
          command: makeCommand(
            'OPEN_REFERENCE',
            0.95,
            { book: confirmed.book, chapter: prevChapter, verse: lastVerse },
            sourceText,
          ),
          pendingRef: null,
        };
      }
    }

    return {}; // start of book — stay put
  }

  // ── next_chapter ──────────────────────────────────────────────────────────

  private resolveNextChapter(
    confirmed:  ConfirmedRef | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    if (!confirmed) return {};

    const scripture = getScripture(confirmed.book, confirmed.chapter + 1, 1, version);
    if (!scripture) return {}; // end of book

    return {
      command: makeCommand(
        'OPEN_REFERENCE',
        0.95,
        { book: confirmed.book, chapter: confirmed.chapter + 1, verse: 1 },
        sourceText,
      ),
    };
  }

  // ── previous_chapter ──────────────────────────────────────────────────────

  private resolvePrevChapter(
    confirmed:  ConfirmedRef | null,
    version:    string,
    sourceText: string,
  ): InterpretResult {
    if (!confirmed || confirmed.chapter <= 1) return {};

    const scripture = getScripture(confirmed.book, confirmed.chapter - 1, 1, version);
    if (!scripture) return {};

    return {
      command: makeCommand(
        'OPEN_REFERENCE',
        0.95,
        { book: confirmed.book, chapter: confirmed.chapter - 1, verse: 1 },
        sourceText,
      ),
    };
  }

  // ── change_translation ────────────────────────────────────────────────────

  private resolveChangeTranslation(
    ai:         AIResponse,
    sourceText: string,
  ): InterpretResult {
    if (!ai.translation) return {};

    return {
      command: makeCommand(
        'SWITCH_VERSION',
        ai.confidence,
        { version: ai.translation },
        sourceText,
      ),
    };
  }
}

export const referenceStateEngine = ReferenceStateEngine.getInstance();
