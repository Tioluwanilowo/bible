import { TranscriptionProvider, Transcript } from '../../types';

const MOCK_SCENARIO = [
  "Good morning church.",
  "Let's open our Bibles to John chapter 3 verse 16.",
  "It says, For God so loved the world...",
  "Let's read the next verse.",
  "Actually, go back to the previous verse.",
  "Let's switch to the ESV version.",
  "Now let's skip down to verse 17.",
  "And we can continue reading from there."
];

export class MockTranscriptionProvider implements TranscriptionProvider {
  name = 'mock';
  private isRunning = false;
  private timer: any = null;
  private currentIndex = 0;
  private onTranscriptChunkCallback?: (transcript: Transcript) => void;

  isSupported(): boolean {
    return true;
  }

  async initialize(_options?: any): Promise<void> {
    // No initialization needed for mock
  }

  async start(_stream?: MediaStream): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentIndex = 0;
    this.emitNext();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) clearTimeout(this.timer);
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.onTranscriptChunkCallback = undefined;
  }

  set onTranscriptChunk(callback: (transcript: Transcript) => void) {
    this.onTranscriptChunkCallback = callback;
  }

  set onError(_callback: (error: Error) => void) {
    // Mock provider currently has no error path.
  }

  private emitNext() {
    if (!this.isRunning || this.currentIndex >= MOCK_SCENARIO.length) {
      this.isRunning = false;
      return;
    }

    const text = MOCK_SCENARIO[this.currentIndex];
    this.currentIndex++;

    let charIndex = 0;
    const emitPartial = () => {
      if (!this.isRunning) return;
      
      charIndex += Math.floor(Math.random() * 10) + 5;
      const isFinal = charIndex >= text.length;
      const currentText = isFinal ? text : text.substring(0, charIndex);

      if (this.onTranscriptChunkCallback) {
        this.onTranscriptChunkCallback({
          id: `msg-${this.currentIndex}`,
          text: currentText,
          timestamp: Date.now(),
          isFinal,
          provider: this.name
        });
      }

      if (isFinal) {
        this.timer = setTimeout(() => this.emitNext(), 2000 + Math.random() * 2000);
      } else {
        this.timer = setTimeout(emitPartial, 100 + Math.random() * 100);
      }
    };

    emitPartial();
  }
}
