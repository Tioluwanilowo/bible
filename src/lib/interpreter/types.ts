import type { Command, PendingRef } from '../../types';

// ── AI command vocabulary ────────────────────────────────────────────────────
export type AICommand =
  | 'set_reference'      // new reference (full or partial)
  | 'jump_to_verse'      // go to specific verse in current chapter
  | 'next_verse'
  | 'previous_verse'
  | 'next_chapter'
  | 'previous_chapter'
  | 'change_translation'
  | 'no_action';

// ── Raw JSON shape returned by the ChatGPT API ───────────────────────────────
export interface AIResponse {
  command: AICommand;
  /** 0–1. Below LOW_CONFIDENCE_THRESHOLD the engine retries with the mini model. */
  confidence: number;
  /** Canonical book name ("Genesis", "1 John", …). Absent = inherit. */
  book?: string;
  chapter?: number;
  verse?: number;
  verseEnd?: number;
  /** Translation abbreviation ("NIV", "ESV", …). Only for change_translation. */
  translation?: string;
  /**
   * true  = speaker explicitly said the book name aloud in this audio turn
   *         (e.g. "turn to Psalms 16:6") → route to preview immediately.
   * false = reference was inferred from verse content being quoted/preached
   *         → route to Suggestions panel for operator review.
   * Absent (legacy / batch path) = treated as explicit.
   */
  isExplicit?: boolean;
}

// ── Result returned by ReferenceStateEngine to the store ────────────────────
export interface InterpretResult {
  /**
   * A fully resolved Command ready for store.processCommand().
   * Absent when there is nothing actionable yet (partial reference stored in pendingRef).
   */
  command?: Command;
  /**
   * Updated pending-reference state:
   *   undefined → no change (leave existing pendingRef unchanged)
   *   null      → clear pending (reference completed or discarded)
   *   object    → partially assembled reference, waiting for more speech
   */
  pendingRef?: PendingRef | null;
}
