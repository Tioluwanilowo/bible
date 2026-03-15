import { TranscriptionProvider, Transcript } from '../../types';
import { useStore } from '../../store/useStore';
import { normalizeWithTailContext, extractChunkTail } from './scriptureNormalizer';

/**
 * Bible book names + spoken patterns passed as speech context hints.
 * Google Cloud STT boosts recognition probability for these phrases,
 * significantly improving accuracy for scripture references like "John 3:16".
 */
const SCRIPTURE_HINTS = [
  // Old Testament
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', 'First Samuel', 'Second Samuel',
  'First Kings', 'Second Kings', 'First Chronicles', 'Second Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalm', 'Psalms',
  'Proverbs', 'Ecclesiastes', 'Song of Solomon', 'Song of Songs',
  'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel',
  'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah',
  'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  // New Testament
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans',
  'First Corinthians', 'Second Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', 'First Thessalonians', 'Second Thessalonians',
  'First Timothy', 'Second Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', 'First Peter', 'Second Peter',
  'First John', 'Second John', 'Third John', 'Jude', 'Revelation',
  // Common spoken patterns around scripture refs
  'chapter', 'verse', 'verses', 'chapter verse', 'through verse',
  'open to', 'turn to', 'go to', 'let us read', 'we are reading from',
  'colon', 'and verse', 'starting at verse',
];

/**
 * GoogleSpeechProvider — near real-time transcription via Google Cloud STT.
 *
 * Architecture: AudioContext → ScriptProcessorNode → LINEAR16 PCM accumulation
 * → Google Cloud STT REST API every ~3 seconds.
 *
 * Why LINEAR16 instead of WEBM:
 * - No container format — every buffer is a standalone, self-contained audio chunk
 * - Lower latency: 3 s capture + ~1 s API ≈ 4 s total (vs 5 s + 1.5 s = 6.5 s with MediaRecorder)
 * - More reliable across Electron versions (no MediaRecorder quirks)
 * - Simpler buffer math: raw samples, no header re-attachment needed
 *
 * Scripture accuracy: all 66 Bible book names + common spoken reference patterns
 * are sent as speechContexts with a boost of 15, significantly improving
 * recognition of "John 3:16", "Psalm 23", "First Corinthians 13" etc.
 */
export class GoogleSpeechProvider implements TranscriptionProvider {
  name = 'google';

  // Web Audio pipeline
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;

  // PCM accumulation
  private pcmChunks: Int16Array[] = [];
  private pcmSampleCount = 0;
  /** 3 seconds of audio at 16 kHz = 48 000 samples */
  private readonly CHUNK_SAMPLES = 16_000 * 3;

  private runtimeApiKey = '';
  private isRunning = false;
  private chunkCount = 0;
  private currentTranscriptId = '';
  /** Tail of the previous chunk — gives normalizer cross-boundary context. */
  private lastChunkTail = '';

  private onTranscriptChunkCallback?: (transcript: Transcript) => void;
  private onErrorCallback?: (error: Error) => void;

  // ── Helpers ────────────────────────────────────────────────────────────────

  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    console.log(`[Google STT] ${message}`);
    try { useStore.getState().logActivity(`[Google STT] ${message}`, type); } catch { /* ignore */ }
  }

  setApiKey(key: string): void { this.runtimeApiKey = key; }

  private resolveApiKey(): string {
    return this.runtimeApiKey ||
      (typeof process !== 'undefined' ? process.env.GOOGLE_STT_API_KEY ?? '' : '');
  }

  isSupported(): boolean { return !!this.resolveApiKey(); }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> { /* session created in start() */ }

  async start(stream?: MediaStream): Promise<void> {
    if (!stream) throw new Error('GoogleSpeechProvider requires a MediaStream.');
    const apiKey = this.resolveApiKey();
    if (!apiKey) {
      throw new Error(
        'Google Cloud API key is not configured. Please enter your key in Settings → Audio & Transcription.',
      );
    }

    this.isRunning = true;
    this.chunkCount = 0;
    this.currentTranscriptId = `msg-${Date.now()}`;
    this.pcmChunks = [];
    this.pcmSampleCount = 0;

    // Create AudioContext HERE (synchronously, inside the user-gesture call stack)
    // so Chrome/Electron does not suspend it.
    this.audioContext = new AudioContext({ sampleRate: 16_000 });
    if (this.audioContext.state !== 'running') {
      await this.audioContext.resume();
    }
    this.log(`AudioContext: ${this.audioContext.state} — capturing at 16 kHz`, 'info');

    this.setupAudioPipeline(stream, apiKey);
    this.log('Listening — first transcript in ~3 s', 'success');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.pcmChunks = [];
    this.pcmSampleCount = 0;
    this.lastChunkTail = '';
    this.teardownPipeline();
    this.log('Stopped', 'info');
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.onTranscriptChunkCallback = undefined;
    this.onErrorCallback = undefined;
  }

  set onTranscriptChunk(callback: (transcript: Transcript) => void) {
    this.onTranscriptChunkCallback = callback;
  }

  set onError(callback: (error: Error) => void) {
    this.onErrorCallback = callback;
  }

  // ── Audio pipeline ─────────────────────────────────────────────────────────

  private setupAudioPipeline(stream: MediaStream, apiKey: string) {
    if (!this.audioContext) return;

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    // 4096-sample buffer, mono in, mono out
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    this.processor.onaudioprocess = (e) => {
      if (!this.isRunning) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // Float32 → Int16 PCM
      const pcm16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      this.pcmChunks.push(pcm16);
      this.pcmSampleCount += pcm16.length;

      // Once we have 3 seconds of audio, flush to Google STT
      if (this.pcmSampleCount >= this.CHUNK_SAMPLES) {
        // Concatenate all accumulated chunks into a single Int16Array
        const combined = new Int16Array(this.pcmSampleCount);
        let offset = 0;
        for (const chunk of this.pcmChunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }

        // Reset buffer immediately so next samples go into a fresh window
        this.pcmChunks = [];
        this.pcmSampleCount = 0;

        // Fire-and-forget — don't block onaudioprocess
        this.transcribePCM(combined, apiKey).catch((err) =>
          this.log(`Transcribe error: ${err.message}`, 'error'),
        );
      }
    };

    this.sourceNode.connect(this.processor);
    // Connect to destination to keep the audio graph alive (no audible output)
    this.processor.connect(this.audioContext.destination);
  }

  private teardownPipeline() {
    if (this.processor) { try { this.processor.disconnect(); } catch { /* ignore */ } this.processor = null; }
    if (this.sourceNode) { try { this.sourceNode.disconnect(); } catch { /* ignore */ } this.sourceNode = null; }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => { /* ignore */ });
      this.audioContext = null;
    }
  }

  // ── Google Cloud STT REST API ──────────────────────────────────────────────

  private async transcribePCM(pcm16: Int16Array, apiKey: string) {
    this.chunkCount++;
    const durationSec = (pcm16.length / 16_000).toFixed(1);

    // Compute RMS amplitude to diagnose mic/audio issues.
    // RMS near 0 = silence / mic not working. RMS > 500 = audible signal.
    let sumSq = 0;
    for (let i = 0; i < pcm16.length; i++) sumSq += pcm16[i] * pcm16[i];
    const rms = Math.round(Math.sqrt(sumSq / pcm16.length));
    const level = rms < 50 ? '🔇 silent' : rms < 500 ? '🔈 quiet' : rms < 3000 ? '🔉 good' : '🔊 loud';
    this.log(`Sending chunk #${this.chunkCount} (${durationSec} s, LINEAR16) — mic level: ${rms} ${level}`, 'info');

    // Int16Array → base64
    const bytes = new Uint8Array(pcm16.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);

    const requestBody = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16_000,
        languageCode: 'en-US',
        // latest_long: best accuracy for continuous speech / scripture reading
        model: 'latest_long',
        enableAutomaticPunctuation: true,
        // Scripture context hints — boosts all Bible book names + reference patterns
        speechContexts: [{
          phrases: SCRIPTURE_HINTS,
          boost: 20.0,   // maximum boost — prioritise scripture vocabulary heavily
        }],
      },
      audio: { content: base64 },
    };

    try {
      const response = await fetch(
        `https://speech.googleapis.com/v1/speech:recognize?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        const apiError = data?.error;
        let message = `Google STT API ${response.status}`;
        if (apiError?.message) message += `: ${apiError.message}`;
        if (response.status === 403) {
          message += ' — ensure the Cloud Speech-to-Text API is enabled in your Google Cloud project.';
        }
        throw new Error(message);
      }

      // Merge all result alternatives into one transcript string
      const results: any[] = data.results ?? [];
      const rawText = results
        .map((r: any) => r.alternatives?.[0]?.transcript ?? '')
        .join(' ')
        .trim();

      // Fix collapsed numbers, including cross-chunk cases where the book name
      // appeared anywhere in the previous chunk ("Judges tells us … | 2125 says…")
      const text = normalizeWithTailContext(rawText, this.lastChunkTail);
      // Store 15 words of tail so the NEXT chunk can find a book name even
      // when it appeared mid-sentence rather than right at the end.
      this.lastChunkTail = extractChunkTail(rawText, 15);

      if (rawText !== text) {
        this.log(`Normalised: "${rawText}" → "${text}"`, 'info');
      }

      this.log(
        text ? `Transcription: "${text}"` : 'No speech detected in chunk',
        text ? 'success' : 'info',
      );

      if (text && this.onTranscriptChunkCallback) {
        this.onTranscriptChunkCallback({
          id: this.currentTranscriptId,
          text,
          timestamp: Date.now(),
          isFinal: true,
          provider: this.name,
        });
        // Each chunk is a standalone result — give the next one a fresh ID
        this.currentTranscriptId = `msg-${Date.now()}`;
      }
    } catch (e: any) {
      const message = e?.message ?? 'Unknown Google STT error';
      this.log(`Error: ${message}`, 'error');
      if (this.onErrorCallback) this.onErrorCallback(new Error(message));
    }
  }
}
