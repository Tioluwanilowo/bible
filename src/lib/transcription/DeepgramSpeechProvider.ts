/**
 * DeepgramSpeechProvider
 *
 * Streams raw PCM audio to the Deepgram Nova-2 API via an IPC-bridged WebSocket
 * that lives in the Electron main process.  Moving the socket to main means the
 * Authorization: Token header is set directly by Node.js `ws` and never appears
 * in renderer network traffic.
 *
 * Detection strategy — server VAD (end-of-utterance):
 *   Deepgram's server-side VAD fires a final transcript when it detects ~300 ms
 *   of silence after speech.  No fixed commit timer needed — detection fires
 *   within ~700 ms of the speaker finishing a phrase.
 *
 * Data flow:
 *   Mic → AudioContext (16 kHz PCM16) → IPC deepgramSendAudio → main WS → Deepgram
 *                                                                              │
 *   speech_final=true result ─────────────────────────────────────────────────┤
 *     → onTranscriptChunk  (ChatGPT batch path + UI display)
 *
 * Auth: main process sets  Authorization: Token <key>  on the socket headers
 * via the `ws` npm package.
 *
 * Cost: ~$0.0043/min vs OpenAI Realtime ~$0.10/min  (~23× cheaper).
 */

import type { TranscriptionProvider, Transcript } from '../../types';
import { useStore } from '../../store/useStore';
import { normalizeWithTailContext, extractChunkTail } from './scriptureNormalizer';

// ── Constants ──────────────────────────────────────────────────────────────────

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';
const RECONNECT_DELAY_MS = 2_000;
const MAX_RECONNECTS = 3;

/** PCM16 at 16 kHz mono — Deepgram's preferred format for accuracy. */
const SAMPLE_RATE = 16_000;

/** ScriptProcessorNode buffer size → ~256 ms of audio per chunk at 16 kHz. */
const BUFFER_SIZE = 4_096;

/**
 * Standard Bible book names — boosted at intensity 2.
 * These are unambiguous (not common English words) so a moderate boost is sufficient.
 */
const SCRIPTURE_KEYWORDS_STANDARD = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Samuel', 'Kings', 'Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Psalms', 'Psalm',
  'Proverbs', 'Ecclesiastes', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Obadiah', 'Jonah', 'Habakkuk', 'Zephaniah',
  'Haggai', 'Zechariah', 'Malachi', 'Matthew', 'Romans',
  'Corinthians', 'Galatians', 'Ephesians', 'Philippians', 'Colossians',
  'Thessalonians', 'Timothy', 'Philemon', 'Hebrews', 'Peter',
  'Jude', 'Revelation', 'verse', 'chapter',
];

/**
 * Books whose names overlap with common English words or first names.
 * Deepgram's acoustic final-pass rescoring tends to replace these with
 * more-frequent alternatives (e.g., "Acts" → "chapter", "John" → "on",
 * "Mark" → "mark"). Higher keyword intensity (3) biases the model back
 * toward the scripture book name.
 */
const SCRIPTURE_KEYWORDS_AMBIGUOUS = [
  'Acts', 'Mark', 'John', 'Luke', 'James', 'Ruth', 'Job',
  'Joel', 'Amos', 'Hosea', 'Micah', 'Nahum', 'Titus',
];

/** All book names (excluding 'verse'/'chapter') for presence-detection regex. */
const ALL_BOOK_NAMES = [
  ...SCRIPTURE_KEYWORDS_STANDARD.filter(w => w !== 'verse' && w !== 'chapter'),
  ...SCRIPTURE_KEYWORDS_AMBIGUOUS,
];

/** Matches any Bible book name as a whole word (case-insensitive). */
const BOOK_NAME_RE = new RegExp(`\\b(${ALL_BOOK_NAMES.join('|')})\\b`, 'i');

// ── URL builder ────────────────────────────────────────────────────────────────

/**
 * Build the Deepgram streaming URL with config params in the query string.
 * The API key is NOT included here — it is sent as  Authorization: Token  by
 * the main-process IPC bridge (see electron/main.ts registerDeepgramHandlers).
 *
 * Keywords are appended with literal colons (e.g. &keywords=Genesis:2) rather
 * than URL-encoded (%3A) to match Deepgram's expected  WORD:INTENSITY  format.
 */
function buildDeepgramUrl(): string {
  const params = new URLSearchParams({
    encoding:         'linear16',
    sample_rate:      String(SAMPLE_RATE),
    channels:         '1',
    model:            'nova-2',
    language:         'en-US',
    smart_format:     'true',   // formats numbers and punctuation
    interim_results:  'true',   // stream partials for live UI display
    endpointing:      '300',    // 300 ms silence → end-of-utterance boundary
    utterance_end_ms: '1000',   // emit final after 1 s total silence
  });

  let url = `${DEEPGRAM_WS_URL}?${params.toString()}`;

  // Standard books: intensity 2; ambiguous books (common English words/names): intensity 3.
  // Higher intensity on ambiguous books counteracts Deepgram's acoustic rescoring which
  // replaces short book names with frequent English words (e.g., "Acts" → "chapter").
  for (const kw of SCRIPTURE_KEYWORDS_STANDARD) {
    url += `&keywords=${encodeURIComponent(kw)}:2`;
  }
  for (const kw of SCRIPTURE_KEYWORDS_AMBIGUOUS) {
    url += `&keywords=${encodeURIComponent(kw)}:3`;
  }

  return url;
}

// ── Provider class ─────────────────────────────────────────────────────────────

export class DeepgramSpeechProvider implements TranscriptionProvider {
  name = 'deepgram';

  // Standard TranscriptionProvider callbacks
  onTranscriptChunk?: (transcript: Transcript) => void;
  onError?: (error: Error) => void;

  private apiKey = '';
  private isRunning = false;
  private isWsOpen = false;

  // Audio pipeline
  private audioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // Reconnection
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  // KeepAlive — sent every 8 s to prevent Deepgram closing the socket with
  // code 1011 ("no audio received within the timeout window") during pauses.
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // Store the mic stream so the audio pipeline can be rebuilt on reconnect
  // if the AudioContext was unexpectedly closed.
  private micStream: MediaStream | null = null;

  // Diagnostic: track first audio send per session
  private firstAudioSent = false;

  // Transcript state
  private transcriptCounter = 0;
  /** Tail of previous final transcript — cross-chunk normalizer context. */
  private lastChunkTail = '';
  /** Most-recent interim transcript for this utterance — used to rescue book names
   *  that Deepgram's final-pass acoustic rescoring drops or replaces. */
  private lastInterimText = '';

  // ── Electron API accessor ──────────────────────────────────────────────────

  private get electronAPI(): any {
    return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    console.log(`[Deepgram] ${message}`);
    try { useStore.getState().logActivity(`[Deepgram] ${message}`, type); } catch { /* ignore */ }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  setApiKey(key: string): void { this.apiKey = key; }
  isSupported(): boolean { return !!this.apiKey; }

  async initialize(): Promise<void> { /* connection deferred to start() */ }

  async start(stream?: MediaStream): Promise<void> {
    if (!stream) throw new Error('[Deepgram] No audio stream provided.');
    if (!this.apiKey) throw new Error('[Deepgram] No Deepgram API key configured.');

    const api = this.electronAPI;
    if (!api?.deepgramConnect) {
      throw new Error(
        '[Deepgram] window.electronAPI.deepgramConnect not found. ' +
        'This provider requires the Electron shell.',
      );
    }

    this.isRunning = true;
    this.reconnectAttempts = 0;
    this.lastChunkTail = '';
    this.lastInterimText = '';
    this.micStream = stream;
    this.setupAudioPipeline(stream);
    this.connectWebSocket();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.lastChunkTail = '';
    this.lastInterimText = '';
    this.firstAudioSent = false;
    this.micStream = null;
    this.disconnect();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.onTranscriptChunk = undefined;
    this.onError = undefined;
  }

  // ── WebSocket lifecycle (via IPC bridge) ───────────────────────────────────

  private connectWebSocket(): void {
    if (!this.isRunning) return;

    this.log('Connecting to Deepgram Nova-2…', 'info');

    const api = this.electronAPI;

    // Register IPC event handlers BEFORE calling deepgramConnect.
    api.onDeepgramOpen(() => {
      this.reconnectAttempts = 0;
      this.isWsOpen = true;
      this.log('Connected — session ready', 'success');

      // Ensure the AudioContext is running — Electron/Chromium suspends it when
      // no user gesture has occurred in the renderer.  A suspended context stops
      // onaudioprocess from firing, so no audio ever reaches Deepgram and the
      // socket times out with code 1011 ("no audio received").
      if (this.audioContext) {
        const ctxState = this.audioContext.state;
        this.log(`AudioContext state on connect: ${ctxState}`, 'info');
        if (ctxState === 'suspended') {
          this.log('AudioContext suspended — resuming…', 'warning');
          this.audioContext.resume()
            .then(() => this.log('AudioContext resumed ✔', 'success'))
            .catch((e: any) => this.log(`AudioContext.resume() failed: ${e.message}`, 'error'));
        }
      }

      // Restart the audio pipeline if it was lost (e.g. AudioContext suspended
      // or closed during a previous disconnect cycle).
      if (!this.processorNode && this.micStream) {
        this.log('Rebuilding audio pipeline after reconnect…', 'info');
        this.setupAudioPipeline(this.micStream);
      }

      // Send an immediate KeepAlive RIGHT NOW to prevent the early-timeout race:
      // the interval timer fires every 5 s, but on the very first connection the
      // audio pipeline takes ~256 ms to produce its first chunk.  If Deepgram's
      // internal inactivity clock started before our audio arrived, the connection
      // would time out (code 1011) before the first interval tick.  The immediate
      // KeepAlive resets Deepgram's clock at t=0, giving the pipeline time to warm up.
      try {
        this.electronAPI?.deepgramSendJson(JSON.stringify({ type: 'KeepAlive' }));
        this.log('KeepAlive sent (immediate, on connect)', 'info');
      } catch { /* ignore */ }

      // Then maintain KeepAlive every 5 s so Deepgram doesn't close the socket
      // with code 1011 during quiet moments (prayers, worship, sermon pauses).
      this.startKeepAlive();
    });

    api.onDeepgramMessage((data: string) => {
      try {
        this.handleMessage(JSON.parse(data));
      } catch {
        // Malformed JSON — ignore
      }
    });

    api.onDeepgramError((message: string) => {
      this.log(`WebSocket error: ${message}`, 'error');
    });

    api.onDeepgramClose((code: number, reason: string) => {
      this.isWsOpen = false;
      this.log(`WebSocket closed (code ${code}${reason ? ` — ${reason}` : ''})`, 'info');

      if (!this.isRunning) return; // intentional stop — don't reconnect

      // 4xx codes from Deepgram = auth/bad-request — stop retrying
      if (code >= 4000 && code < 5000) {
        this.isRunning = false;
        const detail = reason || 'check your Deepgram API key in Settings';
        this.log(`Auth/config error (code ${code}): ${detail} — stopped`, 'error');
        this.onError?.(new Error(`Deepgram rejected connection (${code}): ${detail}`));
        return;
      }

      if (this.reconnectAttempts < MAX_RECONNECTS) {
        this.scheduleReconnect();
      } else {
        this.isRunning = false;
        this.log(`Max reconnects (${MAX_RECONNECTS}) reached — stopping`, 'error');
        this.onError?.(new Error('Deepgram connection lost after maximum retry attempts.'));
      }
    });

    // Ask main process to open the authenticated WebSocket
    api.deepgramConnect(buildDeepgramUrl(), this.apiKey)
      .then((result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          this.log(`Connection failed: ${result?.error ?? 'unknown error'}`, 'error');
          if (this.isRunning) this.scheduleReconnect();
        }
      })
      .catch((err: any) => {
        this.log(`Connection failed: ${err.message}`, 'error');
        if (this.isRunning) this.scheduleReconnect();
      });
  }

  // ── Deepgram message handling ──────────────────────────────────────────────

  private handleMessage(msg: any): void {
    switch (msg.type) {

      case 'Results': {
        const transcript: string  = msg.channel?.alternatives?.[0]?.transcript ?? '';
        const isFinal: boolean    = msg.is_final     === true;
        const speechFinal: boolean = msg.speech_final === true;

        if (!transcript.trim()) return;

        if (isFinal) {
          // Process every committed (is_final) chunk — NOT just speech_final ones.
          //
          // WHY: Deepgram sets is_final=true when it commits to text for an audio
          // segment but speech_final only fires when VAD detects ≥300 ms silence.
          // A preacher reading a verse without pausing (e.g. "Luke 15:1-7, Scripture
          // says, now the tax collectors…") will never trigger speech_final because
          // there is no 300 ms gap.  The scripture reference appears in a committed
          // is_final=true, speech_final=false chunk that we previously ignored.
          // Processing every is_final chunk means we catch scripture references
          // mid-utterance; subsequent chunks (sermon commentary) will get
          // AI → no_action or be deduped by the confirmedRef guard.

          // ── Book rescue: restore names Deepgram drops in its final acoustic pass ──
          // Only rescue when the final text looks like it COULD be a scripture
          // reference (contains a chapter/verse keyword or a number).  This prevents
          // false rescues like "So" + interim "Kings" → "Kings So".
          let finalText = transcript;

          const looksLikeRef = /\b(?:chapter|verse|\d+)\b/i.test(finalText);
          if (!BOOK_NAME_RE.test(finalText) && this.lastInterimText && looksLikeRef) {
            const m = this.lastInterimText.match(BOOK_NAME_RE);
            if (m) {
              const rescuedBook = m[1];
              // Preferred: replace a spurious "chapter" that Deepgram substituted for
              // the book name (the most common substitution pattern).
              const replaced = finalText.replace(/\bchapter\b/i, rescuedBook);
              if (replaced !== finalText) {
                this.log(`Book rescue: "chapter" → "${rescuedBook}" (from interim)`, 'info');
                finalText = replaced;
              } else {
                // Fallback: book was simply omitted — prepend it.
                this.log(`Book rescue: prepended "${rescuedBook}" (from interim)`, 'info');
                finalText = `${rescuedBook} ${finalText}`;
              }
            }
          }

          // Clear the saved interim so the NEXT is_final chunk in the same
          // utterance doesn't reuse stale interim data from a different phrase.
          this.lastInterimText = '';

          // Apply scripture normalization with cross-chunk tail context
          const normalized = normalizeWithTailContext(finalText, this.lastChunkTail);
          this.lastChunkTail = extractChunkTail(finalText, 15);

          if (finalText !== normalized) {
            this.log(`Normalised: "${finalText}" → "${normalized}"`, 'info');
          }

          const label = speechFinal ? 'Transcript' : 'Transcript (mid-utt)';
          this.log(`${label}: "${normalized}"`, 'success');

          this.transcriptCounter++;
          this.onTranscriptChunk?.({
            id:        `dg-${Date.now()}-${this.transcriptCounter}`,
            text:      normalized,
            timestamp: Date.now(),
            isFinal:   true,
            provider:  this.name,
          });

        } else {
          // Interim result — save for book rescue, then push for live display.
          // ChatGPT batch path ignores non-final transcripts (isFinal=false).
          this.lastInterimText = transcript;
          this.onTranscriptChunk?.({
            id:        `dg-interim-${Date.now()}`,
            text:      transcript,
            timestamp: Date.now(),
            isFinal:   false,
            provider:  this.name,
          });
        }
        break;
      }

      case 'Metadata':
        this.log(`Session started (request_id=${msg.request_id ?? '?'})`, 'info');
        break;

      case 'Error':
        this.log(`API error: ${msg.message ?? msg.description ?? 'unknown'}`, 'error');
        if (this.onError) this.onError(new Error(msg.message ?? 'Deepgram error'));
        break;

      default:
        // SpeechStarted, UtteranceEnd, etc. — not needed
        break;
    }
  }

  // ── Audio pipeline ─────────────────────────────────────────────────────────

  private setupAudioPipeline(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.sourceNode   = this.audioContext.createMediaStreamSource(stream);
      // ScriptProcessorNode: deprecated but universally supported in Electron/Chromium
      this.processorNode = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRunning || !this.isWsOpen) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Float32 → Int16 PCM
        const pcm16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send binary frame via IPC → main process → Deepgram WS
        // slice(0) creates a copy of the buffer so IPC serialization doesn't
        // race with the next onaudioprocess call writing to the same backing store.
        try {
          this.electronAPI?.deepgramSendAudio(pcm16.buffer.slice(0));
          // Log the very first audio chunk so we can confirm the pipeline is live.
          if (!this.firstAudioSent) {
            this.firstAudioSent = true;
            this.log(`Audio flowing ✔ (${pcm16.buffer.byteLength} B/chunk @ 16 kHz)`, 'success');
          }
        } catch {
          // Individual send errors are silently dropped; close handler reconnects
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
    } catch (err: any) {
      this.log(`Audio pipeline error: ${err.message}`, 'error');
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private keepAliveCount = 0;

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveCount = 0;
    this.log('KeepAlive started (every 5 s)', 'info');
    this.keepAliveTimer = setInterval(() => {
      if (this.isWsOpen) {
        try {
          this.electronAPI?.deepgramSendJson(JSON.stringify({ type: 'KeepAlive' }));
          this.keepAliveCount++;
          // Log to console every tick; show in Activity panel every 6th (≈ every 30 s).
          console.log(`[Deepgram] KeepAlive #${this.keepAliveCount}`);
          if (this.keepAliveCount % 6 === 0) {
            this.log(`KeepAlive #${this.keepAliveCount} sent`, 'info');
          }
        } catch { /* ignore */ }
      }
    }, 5_000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * this.reconnectAttempts;
    this.log(`Reconnecting in ${delay / 1000} s (attempt ${this.reconnectAttempts}/${MAX_RECONNECTS})…`, 'warning');
    this.reconnectTimer = setTimeout(() => {
      if (this.isRunning) this.connectWebSocket();
    }, delay);
  }

  private disconnect(): void {
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.processorNode) {
      try { this.processorNode.disconnect(); } catch { /* ignore */ }
      this.processorNode = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch { /* ignore */ }
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.isWsOpen = false;

    // Tell main process to close the socket
    try { this.electronAPI?.deepgramDisconnect(); } catch { /* ignore */ }
  }
}
