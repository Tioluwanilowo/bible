import { TranscriptionProvider, Transcript } from '../../types';

export class BrowserSpeechRecognitionProvider implements TranscriptionProvider {
  name = 'browser';
  private recognition: any = null;
  private onTranscriptChunkCallback?: (transcript: Transcript) => void;
  private onErrorCallback?: (error: Error) => void;
  private isRunning = false;
  private currentTranscriptId = '';
  /**
   * Incremented every time start() is called. Each recognition instance
   * captures the generation at creation time so stale onend/onerror callbacks
   * from a previous session can never interfere with a new one.
   */
  private sessionGen = 0;

  isSupported(): boolean {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  }

  async initialize(options?: any): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('Browser Speech Recognition is not supported in this environment.');
    }
    // Destroy any existing instance so no stale handlers survive across sessions.
    this.destroyRecognition();
  }

  private createRecognition() {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    // Snapshot the generation counter so each closure belongs to this instance only.
    const gen = this.sessionGen;

    rec.onresult = (event: any) => {
      if (!this.isRunning || this.sessionGen !== gen) return;

      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      const text = finalTranscript || interimTranscript;
      const isFinal = !!finalTranscript;

      if (text.trim() && this.onTranscriptChunkCallback) {
        this.onTranscriptChunkCallback({
          id: this.currentTranscriptId,
          text: text.trim(),
          timestamp: Date.now(),
          isFinal,
          provider: this.name,
        });

        if (isFinal) {
          this.currentTranscriptId = `msg-${Date.now()}`;
        }
      }
    };

    rec.onerror = (event: any) => {
      if (this.sessionGen !== gen) return; // stale session — discard
      if (event.error === 'no-speech') {
        // Harmless silence — onend will auto-restart
        return;
      }
      // Fatal errors: stop isRunning so onend doesn't loop
      const fatal = ['network', 'not-allowed', 'service-not-allowed', 'aborted'];
      if (fatal.includes(event.error)) {
        this.isRunning = false;
      }
      if (this.onErrorCallback) {
        // Provide human-readable messages for common failure modes
        const friendlyMessages: Record<string, string> = {
          'network': 'Browser Speech Recognition requires Google\'s speech servers, which are unavailable in Electron. Please switch to Google Cloud STT or OpenAI Whisper in Settings → Audio & Transcription.',
          'service-not-allowed': 'Browser Speech Recognition is not available in this environment. Please switch to Google Cloud STT or OpenAI Whisper in Settings → Audio & Transcription.',
          'not-allowed': 'Microphone permission was denied. Please allow microphone access and try again.',
          'aborted': 'Speech recognition was aborted.',
          'audio-capture': 'No microphone was found. Check your audio device settings.',
          'language-not-supported': 'The selected language is not supported by browser speech recognition.',
        };
        const message = friendlyMessages[event.error] ?? `Speech recognition error: ${event.error}`;
        this.onErrorCallback(new Error(message));
      }
    };

    rec.onend = () => {
      if (this.sessionGen !== gen) return; // stale session — never restart
      if (this.isRunning) {
        try {
          rec.start();
        } catch (e) {
          console.error('Failed to restart recognition', e);
        }
      }
    };

    this.recognition = rec;
  }

  private destroyRecognition() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* ignore */ }
      // Null out handlers immediately so no late-firing events reach us
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
      this.recognition = null;
    }
  }

  async start(stream?: MediaStream): Promise<void> {
    // Each start gets a fresh recognition instance and a new generation ID.
    this.sessionGen++;
    this.isRunning = true;
    this.currentTranscriptId = `msg-${Date.now()}`;
    this.createRecognition();

    try {
      // The Web Speech API does not accept a MediaStream directly.
      // It handles microphone access internally via its own permission flow.
      this.recognition.start();
    } catch (e) {
      // Ignore — already started (shouldn't happen with a fresh instance)
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    // Bump generation BEFORE destroying so the onend that fires during abort
    // is immediately treated as stale and never triggers a restart.
    this.sessionGen++;
    this.destroyRecognition();
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
}
