/**
 * RealtimeAudioProvider
 *
 * Streams raw PCM audio to the OpenAI Realtime API via an IPC-bridged WebSocket
 * that lives in the Electron main process.  Moving the socket to main means the
 * API key is set directly on the `ws` package connection and never appears in
 * renderer network traffic.
 *
 * Detection strategy — periodic commit loop (no server VAD):
 *   Instead of waiting for a silence gap (server VAD), we commit the audio buffer
 *   and request a model response every COMMIT_INTERVAL_MS.  This means scripture
 *   references are detected within ~COMMIT_INTERVAL_MS of being spoken, regardless
 *   of whether the pastor pauses.
 *
 * Data flow:
 *   Mic → AudioContext (24 kHz PCM16) → IPC realtimeSend → main WS → OpenAI
 *                                                                         │
 *   Every COMMIT_INTERVAL_MS ──────────────────────────────────────────────┤
 *     → input_audio_buffer.commit   (seals the current audio chunk)       │
 *     → response.create             (asks model to evaluate the chunk)     │
 *         ← response.function_call_arguments.done → onRealtimeCommand      │
 *         ← conversation.item.input_audio_transcription.completed          │
 *               → onTranscriptChunk  (UI display + batch fallback)         │
 *
 * Auth: main process sets Authorization + OpenAI-Beta on the socket headers
 * via the `ws` npm package.  No header injection or webRequest intercept needed.
 *
 * Implements TranscriptionProvider so it slots into ListeningCoordinator without
 * structural changes.
 */

import type { TranscriptionProvider, Transcript } from '../../types';
import type { AIResponse } from '../interpreter/types';
import { useStore } from '../../store/useStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';
const RECONNECT_DELAY_MS = 2_000;

/** OpenAI Realtime hard session limit — platform closes the socket at exactly this age. */
const SESSION_MAX_MS = 60 * 60 * 1_000; // 60 minutes

/**
 * How far before the platform limit we proactively rotate to a fresh session.
 * The 5-minute buffer lets any in-flight response finish before we close the socket.
 */
const SESSION_RENEW_MS = 55 * 60 * 1_000; // 55 minutes

/** How long (ms) to wait after closing the old socket before opening the new one. */
const ROTATION_SETTLE_MS = 500;

/**
 * Fallback timeout (ms) to force-clear `rotationInProgress` if session.updated
 * never fires (e.g. network failure during reconnect).  Long enough to cover a
 * slow WS handshake + session negotiation.
 */
const ROTATION_STALL_TIMEOUT_MS = 15_000;

/**
 * How long (ms) to wait for a response.done / response.cancelled before
 * declaring the response "stuck" and force-clearing isResponseInProgress.
 *
 * Root cause of silent stop: a network condition that delivers the outbound
 * response.create but drops the inbound response.done, leaving
 * isResponseInProgress = true permanently.  The commit loop then skips every
 * tick with no error and no log — transcription silently stops.
 *
 * 8 seconds is well above the normal round-trip (1–3 s) but short enough to
 * recover quickly if a response is genuinely dropped.
 */
const RESPONSE_TIMEOUT_MS = 8_000;

/** PCM16 at 24 kHz mono — required by the OpenAI Realtime API. */
const SAMPLE_RATE = 24_000;

/** ScriptProcessorNode buffer size → ~170 ms of audio per chunk at 24 kHz. */
const BUFFER_SIZE = 4_096;

/**
 * How often (ms) we commit the audio buffer and request a detection response.
 * Lower = faster detection, more API calls.  2 s is a good balance — most
 * scripture references ("John 3 verse 16", "Second Timothy 3:16") are spoken
 * in under 2 seconds, so they land fully inside a single commit window.
 */
const COMMIT_INTERVAL_MS = 2_000;

/**
 * Minimum RMS energy to consider a chunk "has audio".
 * Below this level the chunk is silence — we skip the commit so the model
 * does not re-evaluate the conversation history without new speech.
 */
const SILENCE_RMS_THRESHOLD = 0.01;

/**
 * Minimum confidence score required to forward a detected command to the store.
 * Semantic hallucinations (e.g. "Hebrews 6:6" inferred from "fall away") typically
 * arrive at 0.80–0.90.  Genuine explicit references score 0.90+.
 */
const MIN_CONFIDENCE = 0.88;

// ── Auth error close codes from OpenAI ────────────────────────────────────────
// Receiving these means the API key is wrong / missing — stop retrying.
const AUTH_CLOSE_CODES = new Set([3000, 4000, 4001]);

// ── Session configuration ─────────────────────────────────────────────────────

const SESSION_INSTRUCTIONS =
  'You are a Bible verse REFERENCE DETECTOR — not a theology assistant. ' +
  'Your ONLY job: detect when the speaker says a Bible reference aloud.\n\n' +

  'STRICT RULES:\n' +
  '1. Call detect_scripture_command when the speaker says a Bible BOOK NAME plus CHAPTER or VERSE NUMBER aloud. ' +
     'Examples: "John 3:16", "turn to Romans chapter 8 verse 28", "Psalms 16 verse 6".\n' +
  '2. You MAY also call it when you strongly recognise verse content being quoted even without an explicit reference — ' +
     'but in that case set isExplicit=false so the operator can review it.\n' +
  '3. Set isExplicit=true ONLY when the speaker actually says the book name aloud in this audio turn. ' +
     'Set isExplicit=false when you are inferring from verse content or theme.\n' +
  '4. Navigation commands (next verse, previous chapter) are valid when the speaker says those words as a direction. Set isExplicit=true for navigation.\n' +
  '5. Do NOT use conversation history to infer references. Each audio turn is independent.\n' +
  '6. Do NOT respond conversationally. Do NOT generate audio output.';

const SCRIPTURE_TOOL = {
  type: 'function',
  name: 'detect_scripture_command',
  description: 'Call this when the speaker explicitly states a Bible reference or navigation command.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: [
          'set_reference', 'next_verse', 'previous_verse',
          'next_chapter', 'previous_chapter', 'change_translation', 'jump_to_verse',
        ],
        description: 'The type of Bible navigation command detected.',
      },
      confidence: { type: 'number', description: 'Confidence score 0–1.' },
      isExplicit: {
        type: 'boolean',
        description:
          'true if the speaker said the book name aloud in this audio turn. ' +
          'false if the reference was inferred from verse content or theme being quoted.',
      },
      book: { type: 'string', description: 'Canonical Bible book name (e.g., "Genesis", "John", "1 Corinthians").' },
      chapter: { type: 'integer', description: 'Chapter number.' },
      verse: { type: 'integer', description: 'Starting verse number.' },
      verseEnd: { type: 'integer', description: 'Ending verse number for a range.' },
      translation: { type: 'string', description: 'Bible translation abbreviation (e.g., "NIV", "ESV").' },
    },
    required: ['command', 'confidence', 'isExplicit'],
  },
};

// ── PCM16 helpers ─────────────────────────────────────────────────────────────

function float32ToPcm16(float32: Float32Array): Int16Array {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm16;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ── Provider class ────────────────────────────────────────────────────────────

export class RealtimeAudioProvider implements TranscriptionProvider {
  name = 'realtime';

  // Standard TranscriptionProvider callbacks
  onTranscriptChunk?: (transcript: Transcript) => void;
  onError?: (error: Error) => void;

  /** Extra callback: fires when the Realtime API detects a scripture command. */
  onRealtimeCommand?: (aiResponse: AIResponse) => void;

  private runtimeApiKey = '';
  private audioContext: AudioContext | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private isRunning = false;
  private isWsOpen = false;   // true between realtime-open and realtime-close/error
  private sessionReady = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private commitTimer: ReturnType<typeof setInterval> | null = null;
  private isResponseInProgress = false;   // guard: don't stack response.create calls
  private responseStartedAt    = 0;       // Date.now() when isResponseInProgress was set
  private hasAudioSinceLastCommit = false; // set by onaudioprocess when RMS > threshold
  private transcriptCounter = 0;

  // ── Diagnostic / visibility ────────────────────────────────────────────────

  /** How many audio chunks have been committed this session. */
  private commitCount = 0;

  /** Most recent audio RMS value — used in "no speech" diagnostic log. */
  private lastRms = 0;

  /**
   * Timestamp of the last "no speech detected" warning so we don't spam
   * the activity log every 2 s while the pastor hasn't spoken yet.
   */
  private lastNoAudioWarnAt = 0;

  // ── Session rotation / expiry ──────────────────────────────────────────────

  /** Date.now() timestamp recorded when session.updated fires (session is fully ready). */
  private sessionStartedAt = 0;

  /**
   * Fires at SESSION_RENEW_MS to proactively rotate before the platform cuts us off.
   * Cleared whenever we rotate or the user stops listening.
   */
  private sessionRenewTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Mutex that prevents overlapping rotation attempts.
   * - Set to true at the start of rotateSession().
   * - Cleared in session.updated (rotation succeeded) or the stall-timeout fallback.
   * - Also prevents the close handler from scheduling a redundant reconnect while
   *   rotateSession() is already opening the replacement socket.
   */
  private rotationInProgress = false;

  /** The MediaStream passed to start() — retained so the audio pipeline can be
   *  re-bound after a session rotation if needed. */
  private activeStream: MediaStream | null = null;

  // ── Public API ─────────────────────────────────────────────────────────────

  setApiKey(key: string): void {
    this.runtimeApiKey = key;
  }

  isSupported(): boolean {
    return !!this.runtimeApiKey;
  }

  async initialize(): Promise<void> {
    // No-op — connection is deferred to start() so the audio stream is available.
  }

  async start(stream?: MediaStream): Promise<void> {
    if (!stream) throw new Error('[Realtime] No audio stream provided.');
    if (!this.runtimeApiKey) throw new Error('[Realtime] No OpenAI API key configured.');

    const api = this.electronAPI;
    if (!api?.realtimeConnect) {
      throw new Error(
        '[Realtime] window.electronAPI.realtimeConnect not found. ' +
        'This provider requires the Electron shell — it cannot run in a plain browser.',
      );
    }

    this.activeStream = stream;
    this.isRunning = true;
    this.setupAudioPipeline(stream);
    this.connectWebSocket();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.disconnect();
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.onTranscriptChunk = undefined;
    this.onError = undefined;
    this.onRealtimeCommand = undefined;
  }

  // ── Electron API accessor ──────────────────────────────────────────────────

  private get electronAPI(): any {
    return typeof window !== 'undefined' ? (window as any).electronAPI : undefined;
  }

  // ── Audio pipeline ─────────────────────────────────────────────────────────

  private setupAudioPipeline(stream: MediaStream): void {
    try {
      this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);

      // ScriptProcessorNode is deprecated but universally supported in Electron/Chromium
      // without requiring a separate AudioWorklet file.
      this.processorNode = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRunning || !this.isWsOpen || !this.sessionReady) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Track whether this window contains audible sound.
        // RMS energy: sqrt( mean(x²) ).  Values below SILENCE_RMS_THRESHOLD are silence.
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) sumSq += float32[i] * float32[i];
        const rms = Math.sqrt(sumSq / float32.length);
        this.lastRms = rms;
        if (rms > SILENCE_RMS_THRESHOLD) {
          this.hasAudioSinceLastCommit = true;
        }

        const pcm16 = float32ToPcm16(float32);
        const base64 = arrayBufferToBase64(pcm16.buffer);
        try {
          this.electronAPI?.realtimeSend(
            JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }),
          );
        } catch {
          // Individual send errors are silently dropped; the close handler
          // will trigger reconnect if the connection is actually broken.
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
    } catch (err: any) {
      this.log(`Audio pipeline error: ${err.message}`, 'error');
    }
  }

  // ── Periodic commit loop ────────────────────────────────────────────────────
  // Replaces server VAD.  Every COMMIT_INTERVAL_MS we seal the current audio
  // buffer and ask the model to evaluate it.  This fires detection as soon as
  // the words are spoken — no pause required.

  private startCommitLoop(): void {
    this.stopCommitLoop();
    this.log(`Commit loop started — detecting every ${COMMIT_INTERVAL_MS / 1000} s`, 'info');

    this.commitTimer = setInterval(() => {
      if (!this.isRunning || !this.isWsOpen || !this.sessionReady) return;

      // ── Watchdog 1: AudioContext suspended ───────────────────────────────
      // The browser / Electron host can suspend the AudioContext after a period
      // of inactivity (power-saving, background tab, OS audio policy changes).
      // When suspended, onaudioprocess stops firing completely — hasAudioSinceLastCommit
      // stays false and commits silently stop forever.
      // Resume the context so audio capture restarts on the next tick.
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.log('AudioContext suspended — resuming', 'warning');
        this.audioContext.resume().catch(() => {});
        return; // skip this tick; audio will flow normally on the next one
      }

      // Skip if no audible speech since last commit — avoids re-evaluating
      // conversation history on silence and suppresses phantom detections.
      if (!this.hasAudioSinceLastCommit) {
        // Log a diagnostic warning every 15 s so the user can see that the
        // loop IS running but the mic level is below the silence gate.
        // Helps distinguish "system silent because nothing spoken" from
        // "system broken / audio pipeline stalled".
        const now = Date.now();
        if (now - this.lastNoAudioWarnAt > 15_000) {
          this.lastNoAudioWarnAt = now;
          this.log(
            `Listening — no speech detected  (mic level: ${this.lastRms.toFixed(4)}, threshold: ${SILENCE_RMS_THRESHOLD})`,
            'info',
          );
        }
        return;
      }

      // ── Watchdog 2: stuck response ────────────────────────────────────────
      // If response.done / response.cancelled never arrive (e.g. a network
      // condition that delivers outbound frames but drops inbound ones),
      // isResponseInProgress stays true permanently and every commit tick is
      // silently skipped — transcription stops with no error and no log.
      // Force-clear the flag after RESPONSE_TIMEOUT_MS so the loop can fire again.
      if (this.isResponseInProgress) {
        const age = Date.now() - this.responseStartedAt;
        if (age < RESPONSE_TIMEOUT_MS) return; // still within normal window

        this.log(
          `Response timed out after ${age} ms — clearing stuck flag and resuming`,
          'warning',
        );
        this.isResponseInProgress = false;
        this.responseStartedAt    = 0;
        // Fall through to the commit below — this tick will send the next request.
      }

      // Claim the audio flag before the async send so a rapid onaudioprocess
      // callback cannot sneak in and set it back before we clear it.
      this.hasAudioSinceLastCommit = false;

      try {
        // Seal the audio chunk accumulated since the last commit.
        this.electronAPI?.realtimeSend(
          JSON.stringify({ type: 'input_audio_buffer.commit' }),
        );
        // Ask the model to evaluate the current audio.
        // conversation:"none" means the model's response items (function_call,
        // text) are NOT added to the conversation history.  Without this, the
        // growing list of prior function-call items creates a "momentum" bias
        // where the model keeps predicting the next verse (Galatians 5:2 → 5:3)
        // even when the current audio contains no scripture reference at all.
        this.electronAPI?.realtimeSend(
          JSON.stringify({ type: 'response.create', response: { conversation: 'none' } }),
        );
        this.isResponseInProgress = true;
        this.responseStartedAt    = Date.now();

        // Visibility: log the first commit and then every 15th (every 30 s)
        // so the user can confirm audio is actively flowing to OpenAI.
        this.commitCount++;
        if (this.commitCount === 1 || this.commitCount % 15 === 0) {
          this.log(`Committed audio chunk #${this.commitCount}`, 'info');
        }
      } catch {
        // WS error — the close handler will reconnect.
      }
    }, COMMIT_INTERVAL_MS);
  }

  private stopCommitLoop(): void {
    if (this.commitTimer) {
      clearInterval(this.commitTimer);
      this.commitTimer = null;
    }
  }

  // ── WebSocket lifecycle (via IPC bridge) ───────────────────────────────────

  private connectWebSocket(): void {
    if (!this.isRunning) return;

    this.log('Connecting to OpenAI Realtime…', 'info');

    const api = this.electronAPI;

    // Register event handlers BEFORE calling realtimeConnect so no events are missed.
    api.onRealtimeOpen(() => {
      this.isWsOpen = true;
      // session.created arrives from the server next; config is sent then.
    });

    api.onRealtimeMessage((data: string) => {
      try {
        this.handleServerEvent(JSON.parse(data));
      } catch {
        // Malformed JSON — ignore
      }
    });

    api.onRealtimeError((message: string) => {
      this.log(`WebSocket error: ${message}`, 'error');
    });

    api.onRealtimeClose((code: number, reason: string) => {
      this.isWsOpen = false;
      this.sessionReady = false;
      this.stopCommitLoop();

      // A session rotation explicitly closes the old socket then opens a new one.
      // Suppress the normal reconnect path here — rotateSession() drives it.
      if (this.rotationInProgress) return;

      // Auth / fatal close — stop reconnecting to avoid burning API quota.
      if (AUTH_CLOSE_CODES.has(code)) {
        this.isRunning = false;
        const detail = reason || 'check your OpenAI API key in Settings';
        this.log(`Auth failed (code ${code}): ${detail} — stopped`, 'error');
        this.onError?.(new Error(`OpenAI Realtime auth failed (${code}): ${detail}`));
        return;
      }

      if (this.isRunning) {
        this.log(`Connection closed (${code}) — reconnecting…`, 'warning');
        this.scheduleReconnect();
      } else {
        this.log('Disconnected', 'info');
      }
    });

    // Ask main process to open the authenticated WebSocket.
    api.realtimeConnect(REALTIME_URL, this.runtimeApiKey)
      .then((result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          this.log(`Connection failed: ${result?.error ?? 'unknown error'}`, 'error');
          // If the key is missing, stop immediately — retrying won't help.
          if (result?.error?.includes('No OpenAI API key')) {
            this.isRunning = false;
            this.onError?.(new Error(result.error));
          } else if (this.isRunning) {
            this.scheduleReconnect();
          }
        }
      })
      .catch((err: any) => {
        this.log(`Connection failed: ${err.message}`, 'error');
        if (this.isRunning) this.scheduleReconnect();
      });
  }

  // ── Server event handling ──────────────────────────────────────────────────

  private handleServerEvent(event: any): void {
    switch (event.type) {

      case 'session.created': {
        // Manual turn detection: turn_detection disabled.
        // We commit the buffer and trigger responses on our own timer.
        this.electronAPI?.realtimeSend(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text'],
            instructions: SESSION_INSTRUCTIONS,
            input_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: null,   // ← disable server VAD; we drive commits ourselves
            tools: [SCRIPTURE_TOOL],
            tool_choice: 'auto',
          },
        }));
        break;
      }

      case 'session.updated': {
        this.sessionReady = true;
        // If this fires as part of a rotation, mark the rotation complete BEFORE
        // logging so the activity log reads in chronological order.
        this.rotationInProgress = false;

        // Reset per-session diagnostic counters so chunk numbers restart cleanly
        // after every rotation and "no speech" warnings fire immediately if needed.
        this.commitCount        = 0;
        this.lastNoAudioWarnAt  = 0;

        // Proactively resume the AudioContext in case the OS suspended it during
        // the reconnect window.  onaudioprocess stops firing when suspended;
        // resuming here restores audio capture before the first commit.
        if (this.audioContext && this.audioContext.state === 'suspended') {
          this.log('AudioContext was suspended at session ready — resuming', 'warning');
          this.audioContext.resume().catch(() => {});
        }

        this.markSessionStarted();
        this.log('Session ready — streaming audio', 'success');
        // Start the periodic commit loop now that the session is configured.
        this.startCommitLoop();
        break;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const text: string = (event.transcript ?? '').trim();
        if (text) {
          this.log(`Heard: "${text.slice(0, 100)}${text.length > 100 ? '…' : ''}"`, 'info');
          this.transcriptCounter++;
          const transcript: Transcript = {
            id: `rt-${Date.now()}-${this.transcriptCounter}`,
            text,
            timestamp: Date.now(),
            isFinal: true,
            provider: 'realtime',
          };
          this.onTranscriptChunk?.(transcript);
        }
        break;
      }

      case 'response.function_call_arguments.done': {
        try {
          const args = JSON.parse(event.arguments ?? '{}') as AIResponse;
          if (args.command && typeof args.confidence === 'number') {
            const ref = [
              args.book,
              args.chapter,
              args.verse != null ? `:${args.verse}` : null,
              args.verseEnd != null ? `-${args.verseEnd}` : null,
            ].filter(Boolean).join(' ');

            if (args.confidence < MIN_CONFIDENCE) {
              this.log(
                `Ignored low-confidence: "${args.command}"${ref ? ` — ${ref}` : ''} (${Math.round(args.confidence * 100)}% < ${Math.round(MIN_CONFIDENCE * 100)}% threshold)`,
                'warning',
              );
              break;
            }

            this.log(
              `Detected: "${args.command}"${ref ? ` — ${ref}` : ''} (${Math.round(args.confidence * 100)}%)`,
              'success',
            );
            this.onRealtimeCommand?.(args);
          }
        } catch {
          // Malformed function arguments — ignore
        }
        break;
      }

      case 'response.done': {
        this.isResponseInProgress = false;
        this.responseStartedAt    = 0;
        break;
      }

      case 'response.cancelled': {
        this.isResponseInProgress = false;
        this.responseStartedAt    = 0;
        break;
      }

      case 'error': {
        const msg: string = event.error?.message ?? 'Unknown error';
        const code: string = event.error?.code ?? '';
        this.isResponseInProgress = false;
        this.responseStartedAt    = 0;

        // ── Session expiry — this is an expected lifecycle event, not a crash ──
        // OpenAI fires this error event when the 60-minute hard limit is reached.
        // We rotate to a fresh session instead of surfacing it as a fatal error.
        if (this.isSessionExpiredError(msg)) {
          this.log(
            `Session hit platform limit after ${this.sessionAgeString()} — rotating to fresh session`,
            'warning',
          );
          this.rotateSession('error-expiry');
          break;
        }

        // ── All other errors ───────────────────────────────────────────────────
        this.log(`Error: ${msg}`, 'error');

        // API-level auth errors (after session is established) — stop retrying.
        if (code === 'invalid_api_key' || code === 'auth_error') {
          this.isRunning = false;
          this.onError?.(new Error(`OpenAI Realtime auth failed: ${msg}`));
        }
        break;
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.isRunning) this.connectWebSocket();
    }, RECONNECT_DELAY_MS);
  }

  private disconnect(): void {
    this.stopCommitLoop();
    this.stopSessionRenewTimer();
    this.rotationInProgress = false;
    this.sessionStartedAt = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.activeStream = null;
    this.isWsOpen = false;
    this.sessionReady = false;
    this.isResponseInProgress = false;
    this.responseStartedAt    = 0;
    this.hasAudioSinceLastCommit = false;
    this.electronAPI?.realtimeDisconnect();
  }

  // ── Session rotation helpers ────────────────────────────────────────────────

  /**
   * Returns true if the OpenAI error message signals the 60-minute platform limit.
   * OpenAI currently sends: "Your session hit the maximum duration of 60 minutes."
   * Matching on the stable substring "maximum duration" avoids breaking if the
   * exact wording changes slightly.
   */
  private isSessionExpiredError(msg: string): boolean {
    return msg.toLowerCase().includes('maximum duration');
  }

  /** Human-readable age of the current session, e.g. "55m 3s" or "unknown age". */
  private sessionAgeString(): string {
    if (!this.sessionStartedAt) return 'unknown age';
    const ms = Date.now() - this.sessionStartedAt;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1_000);
    return `${m}m ${s}s`;
  }

  /**
   * Records session start time and arms the proactive renewal timer.
   * Called from session.updated — the earliest point we know the session is live.
   */
  private markSessionStarted(): void {
    this.sessionStartedAt = Date.now();
    this.stopSessionRenewTimer();

    this.sessionRenewTimer = setTimeout(() => {
      this.log(
        `Proactive renewal — session age: ${this.sessionAgeString()} ` +
        `(limit: ${SESSION_MAX_MS / 60_000} min, renewing at ${SESSION_RENEW_MS / 60_000} min)`,
        'info',
      );
      this.rotateSession('proactive-renew');
    }, SESSION_RENEW_MS);

    this.log(
      `Session started — proactive renewal scheduled in ${SESSION_RENEW_MS / 60_000} min`,
      'info',
    );
  }

  private stopSessionRenewTimer(): void {
    if (this.sessionRenewTimer) {
      clearTimeout(this.sessionRenewTimer);
      this.sessionRenewTimer = null;
    }
  }

  /**
   * Closes only the WebSocket transport layer — the audio pipeline
   * (AudioContext + ScriptProcessorNode) is intentionally left running.
   *
   * onaudioprocess continues capturing from the mic but the
   * `!this.isWsOpen || !this.sessionReady` guard prevents it from forwarding
   * any audio until the new session is fully ready.  This means:
   *   • No mic-permission re-prompt after rotation.
   *   • No audio gap in the physical capture chain.
   *   • The ~1–2 s WS reconnect window simply buffers silently.
   */
  private disconnectWebSocketOnly(): void {
    this.isWsOpen = false;
    this.sessionReady = false;
    this.isResponseInProgress = false;
    this.responseStartedAt    = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.electronAPI?.realtimeDisconnect();
  }

  /**
   * Performs a transparent session rotation:
   *
   *   1. Stops the commit loop (no sends during the gap).
   *   2. Cancels the proactive renewal timer.
   *   3. Closes the current WebSocket via disconnectWebSocketOnly()
   *      (audio pipeline stays live).
   *   4. After ROTATION_SETTLE_MS, opens a fresh WebSocket.
   *   5. The new session.updated event clears rotationInProgress, calls
   *      markSessionStarted() and startCommitLoop() — normal operation resumes.
   *
   * Idempotent: a second call while rotation is in progress is a no-op, so
   * concurrent triggers (proactive timer AND hard expiry error) cannot stack.
   *
   * Stall guard: if session.updated never fires (network failure during the new
   * connection attempt), ROTATION_STALL_TIMEOUT_MS forces the flag clear and
   * schedules a normal reconnect so the app cannot get permanently stuck.
   */
  private rotateSession(reason: string): void {
    if (this.rotationInProgress) {
      this.log(
        `Rotation already in progress — ignoring duplicate trigger (${reason})`,
        'info',
      );
      return;
    }

    if (!this.isRunning) return; // user already stopped listening

    this.rotationInProgress = true;
    this.log(`Session rotation started — reason: ${reason}`, 'info');

    // Halt audio forwarding and close the old socket.
    this.stopCommitLoop();
    this.stopSessionRenewTimer();
    this.disconnectWebSocketOnly();

    // Brief settle delay, then open the replacement socket.
    setTimeout(() => {
      if (!this.isRunning) {
        // User stopped listening during the settle delay.
        this.rotationInProgress = false;
        return;
      }

      this.log('Opening replacement WebSocket…', 'info');
      this.connectWebSocket();

      // Stall guard — forces rotationInProgress clear and triggers a manual
      // reconnect if session.updated never arrives (e.g. network failure).
      setTimeout(() => {
        if (this.rotationInProgress && this.isRunning) {
          this.log(
            `Rotation stalled after ${ROTATION_STALL_TIMEOUT_MS / 1_000} s — forcing reconnect`,
            'warning',
          );
          this.rotationInProgress = false;
          this.scheduleReconnect();
        }
      }, ROTATION_STALL_TIMEOUT_MS);

    }, ROTATION_SETTLE_MS);
  }

  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    console.log(`[Realtime] ${message}`);
    try {
      useStore.getState().logActivity(`[Realtime] ${message}`, type);
    } catch {
      // Store may not be initialised yet during early startup
    }
  }
}
