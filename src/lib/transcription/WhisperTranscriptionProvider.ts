import { TranscriptionProvider, Transcript } from '../../types';
import { useStore } from '../../store/useStore';
import { normalizeWithTailContext, extractChunkTail } from './scriptureNormalizer';

/**
 * WhisperTranscriptionProvider
 *
 * Captures audio from a MediaStream in 5-second chunks using MediaRecorder,
 * then sends each chunk to the OpenAI Whisper API for transcription.
 * Each returned transcript fires onTranscriptChunk with isFinal: true.
 *
 * Latency is ~6-7 seconds (5 s chunk + ~1-2 s API call), which is acceptable
 * for live worship use where the preacher reads a scripture reference.
 */
export class WhisperTranscriptionProvider implements TranscriptionProvider {
  name = 'whisper';

  private mediaRecorder: MediaRecorder | null = null;
  private pendingChunks: Blob[] = [];
  private chunkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly chunkIntervalMs = 5000;
  private mimeType = 'audio/webm;codecs=opus';
  private runtimeApiKey = '';
  private isRunning = false;
  private chunkCount = 0;
  private currentTranscriptId = '';
  /** Tail of previous chunk for cross-boundary scripture normalisation. */
  private lastChunkTail = '';

  private onTranscriptChunkCallback?: (transcript: Transcript) => void;
  private onErrorCallback?: (error: Error) => void;

  // ── Helpers ────────────────────────────────────────────────────────────────

  private log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    console.log(`[Whisper STT] ${message}`);
    try {
      useStore.getState().logActivity(`[Whisper] ${message}`, type);
    } catch {
      // Store may not be available in all environments
    }
  }

  setApiKey(key: string): void {
    this.runtimeApiKey = key;
  }

  private resolveApiKey(): string {
    return this.runtimeApiKey || (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY ?? '' : '');
  }

  isSupported(): boolean {
    return !!this.resolveApiKey();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    // Nothing to do — session is created in start()
  }

  async start(stream?: MediaStream): Promise<void> {
    if (!stream) throw new Error('WhisperTranscriptionProvider requires a MediaStream.');
    const apiKey = this.resolveApiKey();
    if (!apiKey) throw new Error('OpenAI API key is not configured. Please enter your key in Settings → Audio & Transcription.');

    this.isRunning = true;
    this.chunkCount = 0;
    this.currentTranscriptId = `msg-${Date.now()}`;

    // Pick a supported MIME type (Whisper accepts webm, mp4, ogg, etc.)
    if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
      this.mimeType = 'audio/webm;codecs=opus';
    } else if (MediaRecorder.isTypeSupported('audio/webm')) {
      this.mimeType = 'audio/webm';
    } else {
      this.mimeType = '';  // let the browser pick
    }
    this.log(`Using audio format: ${this.mimeType || 'browser default'}`, 'info');

    this.setupRecorder(stream, apiKey);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.clearChunkTimer();

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this.mediaRecorder = null;
    this.pendingChunks = [];
    this.lastChunkTail = '';
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

  // ── Recording ──────────────────────────────────────────────────────────────

  private setupRecorder(stream: MediaStream, apiKey: string) {
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    this.mediaRecorder = new MediaRecorder(stream, options);
    this.pendingChunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.pendingChunks.push(e.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      // If we were externally stopped, bail out without transcribing or restarting
      if (!this.isRunning) {
        this.pendingChunks = [];
        return;
      }

      if (this.pendingChunks.length === 0) {
        // No audio recorded — restart immediately
        if (this.mediaRecorder) {
          this.mediaRecorder.start();
          this.scheduleStop();
        }
        return;
      }

      const blob = new Blob([...this.pendingChunks], {
        type: this.mimeType || 'audio/webm',
      });
      this.pendingChunks = [];

      // Transcribe and restart
      await this.transcribeChunk(blob, apiKey);

      if (this.isRunning && this.mediaRecorder && this.mediaRecorder.state === 'inactive') {
        this.mediaRecorder.start();
        this.scheduleStop();
      }
    };

    this.mediaRecorder.onerror = (e: any) => {
      const message = e?.error?.message ?? 'MediaRecorder error';
      this.log(`Recording error: ${message}`, 'error');
      if (this.onErrorCallback) this.onErrorCallback(new Error(message));
    };

    this.mediaRecorder.start();
    this.scheduleStop();
    this.log('Recording started — first chunk in 5 s', 'success');
  }

  private scheduleStop() {
    this.clearChunkTimer();
    this.chunkTimer = setTimeout(() => {
      if (this.isRunning && this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        // Stopping triggers onstop, which transcribes and restarts
        this.mediaRecorder.stop();
      }
    }, this.chunkIntervalMs);
  }

  private clearChunkTimer() {
    if (this.chunkTimer !== null) {
      clearTimeout(this.chunkTimer);
      this.chunkTimer = null;
    }
  }

  // ── Whisper API ────────────────────────────────────────────────────────────

  private async transcribeChunk(blob: Blob, apiKey: string) {
    this.chunkCount++;
    const sizekb = (blob.size / 1024).toFixed(1);
    this.log(`Sending chunk #${this.chunkCount} (${sizekb} KB)`, 'info');

    try {
      const formData = new FormData();
      // Whisper needs a file extension hint — use .webm
      formData.append('file', blob, 'audio.webm');
      formData.append('model', 'whisper-1');
      // Plain text response — simpler to parse than json
      formData.append('response_format', 'text');
      // Hint to help Whisper recognise scripture references (e.g. "John 3:16")
      formData.append('prompt', 'Scripture reference. Book chapter and verse. For example: John 3:16, Matthew 5:3, Psalm 23.');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`Whisper API ${response.status}: ${errorText}`);
      }

      const rawText = (await response.text()).trim();
      // Fix collapsed numbers, including cross-chunk cases where the book name
      // ended the previous chunk and the digits start this one.
      const text = normalizeWithTailContext(rawText, this.lastChunkTail);
      this.lastChunkTail = extractChunkTail(rawText);
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
          isFinal: true,   // Whisper always returns complete, final results
          provider: this.name,
        });
        // Each chunk is a standalone transcript — give next one a fresh ID
        this.currentTranscriptId = `msg-${Date.now()}`;
      }
    } catch (e: any) {
      const message = e?.message ?? 'Unknown Whisper error';
      this.log(`Error: ${message}`, 'error');
      if (this.onErrorCallback) this.onErrorCallback(new Error(message));
    }
  }
}
