/**
 * ChatGPTInterpreter
 *
 * Sends rolling transcript context to the OpenAI Chat Completions API and
 * returns a strict-JSON AIResponse describing the speaker's intent.
 *
 * Model strategy
 * ──────────────
 *  Primary  : gpt-5-nano  (fast, low cost)
 *  Fallback : gpt-5-mini  (triggered automatically when the primary call
 *             fails with a network/API error OR returns low confidence)
 *
 * This class is pure input/output — it performs NO verse lookups, NO
 * chapter-boundary resolution, and NO Bible dataset access.
 */

import type { Transcript, ConfirmedRef, PendingRef } from '../../types';
import type { AIResponse } from './types';

// gpt-4o-mini: fast non-reasoning model, ~300-600 ms, ideal for live classification.
// gpt-5-nano was a reasoning model (576 internal reasoning tokens ≈ 3-4 s delay) — too slow.
const PRIMARY_MODEL  = 'gpt-4o-mini';
const FALLBACK_MODEL = 'gpt-4o';

/** Confidence level below which we retry with the fallback model. */
const LOW_CONFIDENCE_THRESHOLD = 0.65;

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

// ── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are a Bible reference detection assistant embedded in live church worship software. \
Your ONLY job is to detect Bible references and navigation commands from spoken transcript text.

STRICT RULES:
1. Return ONLY valid JSON on a single line. No markdown, no code blocks, no explanations.
2. Never look up verses, calculate verse counts, or resolve chapter/verse boundaries — the application handles that.
3. Extract only what was EXPLICITLY spoken. If a component (book / chapter / verse) was not mentioned, omit it.
4. Use canonical English book names (e.g. "Genesis", "1 John", "Song of Solomon", "Revelation").
5. Ignore filler words, prayers, announcements, and sermon content that are not Bible navigation.
6. Bare compact numbers like "316", "2125", "128" near a book name mean chapter:verse (3:16, 21:25, 1:28).
   If the book appeared in an earlier transcript chunk, still use it as context for a bare number in the latest chunk.
7. NEVER hallucinate a book. If the speaker did NOT say a book name in the LAST transcript chunk, omit "book"
   from your JSON entirely — even if CONFIRMED shows a different book than your training data might suggest.
   The app inherits the book automatically from CONFIRMED.
8. DEDUP RULE: Return no_action ONLY when the LAST chunk has NO explicit verse reference AND NO navigation
   keyword. Do NOT re-fire a reference that exactly matches CONFIRMED (book + chapter + verse).
9. EXPLICIT VERSE RULE: If the LAST chunk contains a specific, complete verse reference (Book Chapter:Verse)
   in ANY context — including passing mentions, commentary, or sermon — ALWAYS return set_reference for it.
   A verse spoken is a verse to display, regardless of surrounding words.
   Exception: skip only if it exactly matches CONFIRMED (Rule 8 dedup applies).

CONTEXT PROVIDED:
- confirmed: Bible reference currently shown on the projection screen
- pending:   Partially spoken reference still being assembled
- transcripts: Recent spoken chunks, oldest first — focus on the LAST chunk,
               but use EARLIER chunks for book/chapter context
               (e.g. book name in chunk 1 + bare digits or verse number in chunk 2 = scripture reference)

INHERITANCE NOTE (handled by the app, not you):
- "chapter 5 verse 4" with no book → omit book from your JSON
- "verse 16" with no chapter       → omit book and chapter from your JSON
- The app inherits missing parts from confirmed/pending automatically.

RANGE NAVIGATION NOTE:
When confirmed shows a verse range (e.g. Luke 15:5-7, verseEnd=7), "next verse" means go to
verseEnd+1 (verse 8) — NOT verse+1 (verse 6). The app handles this automatically when you
return "next_verse". The preacher may be reading from a different Bible version than what is
displayed; that does NOT affect navigation — verse numbers are the same across translations.

COMMANDS:
- "set_reference"    — Speaker stated a Bible reference (full or partial)
- "jump_to_verse"    — "go to verse N" / "skip to verse N" in the current chapter only
- "next_verse"       — any forward transition: "next verse", "continue", "continue reading",
                       "let us continue", "moving on", "carry on", "as we move forward",
                       "the next verse", "and verse [N+1]" when N is the current endVerse
- "previous_verse"   — "previous verse", "back one verse", "go back", "let us go back"
- "next_chapter"     — "next chapter", "go to next chapter", "moving to chapter N"
- "previous_chapter" — "previous chapter", "back a chapter"
- "change_translation" — Speaker requested a different Bible version/translation
- "no_action"        — No Bible reference intent (sermon, prayer, announcements, etc.)

RESPONSE FORMAT — one JSON object, nothing else:
{"command":"set_reference","confidence":0.95,"book":"Genesis","chapter":3,"verse":16}
{"command":"set_reference","confidence":0.85,"book":"John","chapter":3}
{"command":"set_reference","confidence":0.9,"chapter":5,"verse":4}
{"command":"set_reference","confidence":0.9,"verse":16}
{"command":"set_reference","confidence":0.9,"book":"Genesis","chapter":3,"verse":4,"endVerse":5}
{"command":"jump_to_verse","confidence":0.9,"verse":16}
{"command":"next_verse","confidence":0.95}
{"command":"previous_verse","confidence":0.95}
{"command":"next_chapter","confidence":0.95}
{"command":"previous_chapter","confidence":0.95}
{"command":"change_translation","confidence":0.9,"translation":"NIV"}
{"command":"no_action","confidence":1.0}

EXAMPLES:
"Turn to Genesis chapter 3 verse 16" → {"command":"set_reference","confidence":0.95,"book":"Genesis","chapter":3,"verse":16}
"John 3" → {"command":"set_reference","confidence":0.75,"book":"John","chapter":3}
"chapter 5 verse 4" (confirmed: Genesis 3:1) → {"command":"set_reference","confidence":0.9,"chapter":5,"verse":4}
"chapter 15 verse 8" (confirmed: Luke 15:7) → {"command":"set_reference","confidence":0.95,"chapter":15,"verse":8}
"verse 16" (confirmed: Genesis 5:4) → {"command":"set_reference","confidence":0.9,"verse":16}
"and we'll continue in the next verse" → {"command":"next_verse","confidence":0.95}
"read that in the NIV" → {"command":"change_translation","confidence":0.9,"translation":"NIV"}
"let us bow our heads in prayer" → {"command":"no_action","confidence":1.0}
"Genesis" (book only, no chapter) → {"command":"set_reference","confidence":0.5,"book":"Genesis"}
"verse 16 in Genesis 2 says" → {"command":"set_reference","confidence":0.9,"book":"Genesis","chapter":2,"verse":16}
"then verse 16 in Genesis 2 says" → {"command":"set_reference","confidence":0.9,"book":"Genesis","chapter":2,"verse":16}
"Further in Genesis 3 verse 4 to 5 He says" → {"command":"set_reference","confidence":0.9,"book":"Genesis","chapter":3,"verse":4,"endVerse":5}
"Genesis 3 verse 4 to 5" → {"command":"set_reference","confidence":0.95,"book":"Genesis","chapter":3,"verse":4,"endVerse":5}
"Hebrews chapter 11 verse 17" → {"command":"set_reference","confidence":0.95,"book":"Hebrews","chapter":11,"verse":17}
[prev: "And Judges tells us this doesn't it?"] [current: "2125 says that when"] → {"command":"set_reference","confidence":0.9,"book":"Judges","chapter":21,"verse":25}
[prev: "Let us look at Romans 8"] [current: "verse 28 says all things"] → {"command":"set_reference","confidence":0.9,"verse":28}
"let us continue" (confirmed: Luke 15:5-7) → {"command":"next_verse","confidence":0.95}
"moving on" (confirmed: Luke 15:5-7) → {"command":"next_verse","confidence":0.9}
"as we move forward" (confirmed: any) → {"command":"next_verse","confidence":0.9}
"now carry on from there" → {"command":"next_verse","confidence":0.85}
[buffer has old Luke 15 chunks] [current: "and this is what it means for us today"] (confirmed: Luke 19:10) → {"command":"no_action","confidence":1.0}
[current: "so that is what I wanted to share with you"] (confirmed: Luke 15:7) → {"command":"no_action","confidence":1.0}
"of John 10:10 that Jesus had promised to follow him" → {"command":"set_reference","confidence":0.9,"book":"John","chapter":10,"verse":10}
"as we see in Romans 8:28 God works all things together" → {"command":"set_reference","confidence":0.9,"book":"Romans","chapter":8,"verse":28}
"just like back in Psalm 23:1 the Lord is my shepherd" → {"command":"set_reference","confidence":0.9,"book":"Psalms","chapter":23,"verse":1}
"that is what John 3:16 tells us about God's love" → {"command":"set_reference","confidence":0.9,"book":"John","chapter":3,"verse":16}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMessages(
  buffer: Transcript[],
  confirmedRef: ConfirmedRef | null,
  pendingRef:   PendingRef   | null,
): { role: string; content: string }[] {
  const confirmedStr = confirmedRef
    ? JSON.stringify({
        book:        confirmedRef.book,
        chapter:     confirmedRef.chapter,
        verse:       confirmedRef.verseStart,
        ...(confirmedRef.verseEnd ? { verseEnd: confirmedRef.verseEnd } : {}),
        translation: confirmedRef.translation,
      })
    : 'none';

  const pendingStr = pendingRef
    ? JSON.stringify({
        ...(pendingRef.book        ? { book:    pendingRef.book        } : {}),
        ...(pendingRef.chapter     ? { chapter: pendingRef.chapter     } : {}),
        ...(pendingRef.verseStart  ? { verse:   pendingRef.verseStart  } : {}),
      })
    : 'none';

  const transcriptLines = buffer
    .map((t, i) => `[${i + 1}] "${t.text}"`)
    .join('\n');

  const userContent =
    `CONFIRMED: ${confirmedStr}\n` +
    `PENDING: ${pendingStr}\n\n` +
    `RECENT TRANSCRIPTS (oldest first, last is most recent):\n${transcriptLines}\n\n` +
    `Return JSON for the LAST transcript in context of all prior chunks.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user',   content: userContent   },
  ];
}

/** Extract a JSON object from the model's response, tolerating markdown code fences. */
function extractJson(content: string): AIResponse {
  // Strip ```json ... ``` wrappers that some models add despite instructions
  const stripped = content.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error(`[ChatGPT] extractJson: no JSON object found in: "${content}"`);
    throw new Error('No JSON object found in model response');
  }
  let parsed: AIResponse;
  try {
    parsed = JSON.parse(match[0]) as AIResponse;
  } catch (parseErr) {
    console.error(`[ChatGPT] extractJson: JSON.parse failed on: "${match[0]}"`, parseErr);
    throw parseErr;
  }
  if (!parsed.command) {
    console.error(`[ChatGPT] extractJson: missing "command" field in parsed object:`, parsed);
    throw new Error('Missing "command" field in model response');
  }
  if (typeof parsed.confidence !== 'number') parsed.confidence = 0.8; // safe default
  console.log(`[ChatGPT] ✔ Parsed AIResponse:`, parsed);
  return parsed;
}

/** Single OpenAI Chat Completions call. Throws on any API/network error. */
async function callModel(
  model:    string,
  messages: { role: string; content: string }[],
  apiKey:   string,
): Promise<AIResponse> {
  // ── DIAGNOSTIC: confirm exactly which endpoint + model we are hitting ────
  console.log(`[ChatGPT] ▶ callModel  endpoint=${OPENAI_ENDPOINT}  model=${model}`);

  const res = await fetch(OPENAI_ENDPOINT, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      // gpt-4o-mini is a standard (non-reasoning) model — the JSON answer is ~50-80 tokens,
      // so 256 is ample. No need for the 2000 budget that was required for gpt-5-* reasoning.
      max_completion_tokens: 256,
    }),
  });

  console.log(`[ChatGPT] ← HTTP ${res.status} ${res.statusText}  model=${model}`);

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({})) as any;
    const msg = errBody?.error?.message ?? res.statusText;
    throw new Error(`OpenAI ${model} error (${res.status}): ${msg}`);
  }

  const data = await res.json() as any;

  // ── DIAGNOSTIC: log the full raw payload so we can see the exact structure ─
  try {
    console.log(`[ChatGPT] Raw response (${model}):`, JSON.stringify(data, null, 2));
  } catch {
    console.log(`[ChatGPT] Raw response (${model}): [could not serialise]`);
  }

  // ── DIAGNOSTIC: probe every known content field individually ─────────────
  const pathOutputText   = data?.output_text;                    // Responses API shorthand
  const pathOutputArray  = data?.output?.[0]?.content?.[0]?.text; // Responses API structured
  const pathChoices      = data?.choices?.[0]?.message?.content;   // Chat Completions

  console.log(`[ChatGPT] Field probe (${model}):`);
  console.log(`  output_text              → ${pathOutputText   !== undefined && pathOutputText   !== null ? `string(${String(pathOutputText).length})   "${String(pathOutputText).slice(0, 60)}"` : String(pathOutputText)}`);
  console.log(`  output[0].content[0].text → ${pathOutputArray !== undefined && pathOutputArray !== null ? `string(${String(pathOutputArray).length})  "${String(pathOutputArray).slice(0, 60)}"` : String(pathOutputArray)}`);
  console.log(`  choices[0].message.content → ${pathChoices    !== undefined && pathChoices    !== null ? `string(${String(pathChoices).length})  "${String(pathChoices).slice(0, 60)}"` : String(pathChoices)}`);

  // Try all locations; first non-null/non-undefined wins
  const content: string =
    pathOutputText  ??
    pathOutputArray ??
    pathChoices     ??
    '';

  console.log(`[ChatGPT] Extracted content (${model}): length=${content.length}  "${content.slice(0, 120)}"`);

  if (!content) {
    // Dump top-level keys + any nested output/choices to make the structure obvious
    const topKeys = Object.keys(data ?? {}).join(', ');
    console.error(`[ChatGPT] ✖ EMPTY content from ${model}.  Top-level keys: [${topKeys}]`);
    if (data?.output  !== undefined) console.error(`[ChatGPT]   data.output  =`, JSON.stringify(data.output));
    if (data?.choices !== undefined) console.error(`[ChatGPT]   data.choices =`, JSON.stringify(data.choices));
    throw new Error(`Empty response from ${model}`);
  }

  return extractJson(content);
}

// ── Public class ──────────────────────────────────────────────────────────────

export class ChatGPTInterpreter {
  /**
   * Interpret the rolling transcript buffer and return an AIResponse.
   *
   * Model cascade:
   *   1. Try gpt-5-nano.
   *   2. If the call throws (network error, model unavailable, etc.) → try gpt-5-mini.
   *   3. If nano succeeds but returns confidence < LOW_CONFIDENCE_THRESHOLD → also
   *      try gpt-5-mini and keep whichever has the higher confidence.
   *   4. If both models fail → throw (caller falls back to rule-based system).
   *
   * Returns null if no API key or empty buffer (caller uses rule-based instead).
   */
  async interpret(
    buffer:       Transcript[],
    confirmedRef: ConfirmedRef | null,
    pendingRef:   PendingRef   | null,
    apiKey:       string,
  ): Promise<AIResponse | null> {
    if (!apiKey || buffer.length === 0) return null;

    const messages = buildMessages(buffer, confirmedRef, pendingRef);

    let primaryResponse: AIResponse | null = null;
    let primaryError:    Error | null = null;

    // ── Step 1: Primary model ─────────────────────────────────────────────
    try {
      primaryResponse = await callModel(PRIMARY_MODEL, messages, apiKey);
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[ChatGPT] ${PRIMARY_MODEL} failed: ${primaryError.message} — trying ${FALLBACK_MODEL}`);
    }

    // ── Step 2: Fallback if primary failed or returned low confidence ─────
    const needsFallback =
      !primaryResponse ||
      primaryResponse.confidence < LOW_CONFIDENCE_THRESHOLD;

    if (needsFallback) {
      try {
        const fallbackResponse = await callModel(FALLBACK_MODEL, messages, apiKey);
        // Use fallback if primary failed, or if fallback is more confident
        if (!primaryResponse || fallbackResponse.confidence >= primaryResponse.confidence) {
          return fallbackResponse;
        }
      } catch (fallbackErr) {
        // If primary also failed, propagate the original error so the caller
        // falls back to the rule-based interpreter
        if (!primaryResponse) {
          const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          throw new Error(
            `Both models failed. ${PRIMARY_MODEL}: ${primaryError?.message}. ${FALLBACK_MODEL}: ${fbMsg}`,
          );
        }
        // Primary succeeded (but low confidence) and fallback also failed → use primary
        console.warn(`[ChatGPT] ${FALLBACK_MODEL} also failed — using ${PRIMARY_MODEL} result`);
      }
    }

    return primaryResponse;
  }
}

export const chatGPTInterpreter = new ChatGPTInterpreter();
