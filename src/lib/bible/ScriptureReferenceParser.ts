import { ParsedReference } from './types';
import { BookAliasResolver } from './BookAliasResolver';

export class ScriptureReferenceParser {
  public static parse(normalizedText: string): ParsedReference | null {
    // ── Step 0: strip trailing punctuation from words ─────────────────────
    // Handles STT output like "Luke." "Genesis," "verse." so book names and
    // numbers are recognised correctly.
    let cleaned = normalizedText
      .replace(/([a-zA-Z])[.,;!?]+(?=\s|$)/gi, '$1')   // "Luke." → "Luke"
      .replace(/(\d)[.,;!?]+(?=\s|$)/g, '$1');          // "24." → "24"

    // ── Step 1: capture an explicit "verse N" BEFORE filler removal ───────
    // Handles "verse 16 in Genesis 2" → Genesis 2:16
    // (the "verse" keyword is a filler and would be stripped, losing the number)
    const preVerseMatch = cleaned.match(/\bverse\s+(?:number\s+)?(\d{1,3})\b/i);
    const explicitVerse = preVerseMatch ? parseInt(preVerseMatch[1], 10) : null;

    // ── Step 2: remove filler words ───────────────────────────────────────
    cleaned = cleaned
      .replace(/\b(let's|lets|read|turn to|go to|open to|chapter|verse|verses|through|to|and|the|in|of|at|says|it|that|we|are|reading|from|look)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // ── Step 3: find the book name ────────────────────────────────────────
    const bookExtraction = BookAliasResolver.extractBook(cleaned);
    if (!bookExtraction) return null;

    const book = bookExtraction.book;
    const remaining = bookExtraction.remaining.trim();

    // ── Step 4: extract numbers from the remaining text ───────────────────
    // Handles: "3 16", "3:16", "3 16-18", "3 16 18"
    const numbers = remaining.match(/\d+/g);

    // No numbers at all (book only) — very low confidence
    if (!numbers || numbers.length < 1) {
      return { book, chapter: 1, startVerse: 1, confidence: 0.5 };
    }

    const chapter = parseInt(numbers[0], 10);

    // Only one number after the book — book+chapter, no explicit verse
    if (numbers.length === 1) {
      // If we captured an explicit "verse N" before the book (e.g. "verse 16 in Genesis 2")
      if (explicitVerse !== null) {
        return { book, chapter, startVerse: explicitVerse, confidence: 0.92 };
      }
      // Book+chapter only — lower confidence so a popup is shown rather than
      // auto-navigating (lets the preacher continue with the verse number)
      return { book, chapter, startVerse: 1, confidence: 0.72 };
    }

    // Two or more numbers — chapter + verse (+ optional end-verse for ranges)
    const startVerse = parseInt(numbers[1], 10);
    let endVerse: number | undefined;
    if (numbers.length >= 3) {
      endVerse = parseInt(numbers[2], 10);
    }

    // ── Step 5: detect an inline version tag ──────────────────────────────
    let version: string | undefined;
    const versionMatch = normalizedText.match(/\b(kjv|niv|esv|nlt|nkjv)\b/i);
    if (versionMatch) {
      version = versionMatch[1].toUpperCase();
    }

    return {
      book,
      chapter,
      startVerse,
      endVerse,
      version,
      confidence: 0.95,
    };
  }
}
