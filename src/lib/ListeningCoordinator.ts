import { useStore } from '../store/useStore';
import { AudioInputManager } from './audioManager';
import { TranscriptionProvider } from '../types';
import { BrowserSpeechRecognitionProvider } from './transcription/BrowserSpeechRecognitionProvider';
import { WhisperTranscriptionProvider } from './transcription/WhisperTranscriptionProvider';
import { GoogleSpeechProvider } from './transcription/GoogleSpeechProvider';
import { MockTranscriptionProvider } from './transcription/MockTranscriptionProvider';
import { RealtimeAudioProvider } from './transcription/RealtimeAudioProvider';
import { DeepgramSpeechProvider } from './transcription/DeepgramSpeechProvider';

export class ListeningCoordinator {
  private static instance: ListeningCoordinator;
  private activeProvider: TranscriptionProvider | null = null;
  private activeStream: MediaStream | null = null;
  private browserProvider = new BrowserSpeechRecognitionProvider();
  private whisperProvider = new WhisperTranscriptionProvider();
  private googleProvider = new GoogleSpeechProvider();
  private mockProvider = new MockTranscriptionProvider();
  private realtimeProvider = new RealtimeAudioProvider();
  private deepgramProvider = new DeepgramSpeechProvider();

  static getInstance(): ListeningCoordinator {
    if (!ListeningCoordinator.instance) {
      ListeningCoordinator.instance = new ListeningCoordinator();
    }
    return ListeningCoordinator.instance;
  }

  async startListening() {
    const store = useStore.getState();
    const { settings, isMockMode } = store;

    store.setListeningState('initializing');
    store.setTranscriptionStatus('ready');

    try {
      // 1. Determine Provider
      // Inject the user's runtime API keys so isSupported() can reflect whether a key is available
      this.whisperProvider.setApiKey(settings.openaiApiKey || '');
      this.googleProvider.setApiKey(settings.googleSttApiKey || '');
      this.realtimeProvider.setApiKey(settings.openaiApiKey || '');
      this.deepgramProvider.setApiKey(settings.deepgramApiKey || '');

      if (isMockMode) {
        this.activeProvider = this.mockProvider;
      } else if (settings.providerId === 'realtime' && this.realtimeProvider.isSupported()) {
        this.activeProvider = this.realtimeProvider;
      } else if (settings.providerId === 'deepgram' && this.deepgramProvider.isSupported()) {
        this.activeProvider = this.deepgramProvider;
      } else if (settings.providerId === 'google' && this.googleProvider.isSupported()) {
        this.activeProvider = this.googleProvider;
      } else if (settings.providerId === 'whisper' && this.whisperProvider.isSupported()) {
        this.activeProvider = this.whisperProvider;
      } else if (this.browserProvider.isSupported()) {
        this.activeProvider = this.browserProvider;
      } else {
        store.logActivity('No transcription provider available. Falling back to mock mode.', 'warning');
        store.setIsMockMode(true);
        this.activeProvider = this.mockProvider;
      }

      // 2. Connect Audio (if not mock)
      // Gemini needs the specific deviceId stream; browser provider ignores it but we still open it
      if (!store.isMockMode) {
        this.activeStream = await AudioInputManager.connectDevice(settings.deviceId);
        if (!this.activeStream) {
          throw new Error('Failed to connect to audio device.');
        }
      }

      // 3. Initialize and Start Provider
      this.activeProvider.onTranscriptChunk = (transcript) => {
        useStore.getState().addTranscript(transcript);
      };

      // Wire the realtime command callback (only fires when provider === realtime)
      if (this.activeProvider === this.realtimeProvider) {
        this.realtimeProvider.onRealtimeCommand = (aiResponse) => {
          useStore.getState().processRealtimeSignal(aiResponse);
        };
      }

      this.activeProvider.onError = (error) => {
        console.error('Transcription error:', error);
        useStore.getState().logActivity(`Transcription error: ${error.message}`, 'error');
        useStore.getState().setTranscriptionStatus('error');
        // Provider has fatally stopped — clean up so the UI reflects that
        this.stopListening();
      };

      await this.activeProvider.initialize();
      await this.activeProvider.start(this.activeStream || undefined);

      store.setListeningState('listening');
      store.setTranscriptionStatus('active');
      store.setIsListening(true);
      store.logActivity(`Started listening using ${this.activeProvider.name} provider`, 'success');

    } catch (error: any) {
      console.error('Failed to start listening:', error);
      store.setListeningState('error');
      store.setTranscriptionStatus('error');
      store.setIsListening(false);
      store.logActivity(`Failed to start listening: ${error.message}`, 'error');
      this.cleanup();
    }
  }

  async stopListening() {
    // Already stopped — nothing to do (guards against duplicate calls from error handler)
    if (!this.activeProvider && !this.activeStream && !useStore.getState().isListening) return;

    const store = useStore.getState();

    try {
      if (this.activeProvider) {
        await this.activeProvider.stop();
      }
    } catch (error) {
      console.error('Error stopping provider:', error);
    }

    this.cleanup();

    store.setListeningState('stopped');
    store.setTranscriptionStatus('ready');
    store.setIsListening(false);
    store.logActivity('Stopped listening', 'info');
  }

  private cleanup() {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
    if (this.activeProvider) {
      this.activeProvider.onTranscriptChunk = undefined;
      this.activeProvider.onError = undefined;
      if (this.activeProvider === this.realtimeProvider) {
        this.realtimeProvider.onRealtimeCommand = undefined;
      }
      this.activeProvider = null;
    }
  }
}

export const listeningCoordinator = ListeningCoordinator.getInstance();
