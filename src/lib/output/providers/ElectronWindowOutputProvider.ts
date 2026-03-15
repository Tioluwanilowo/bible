import { OutputProvider, OutputPayload, ProviderStatus } from '../../../types/output';
import { outputLogger } from '../OutputDiagnosticsLogger';
import { useStore } from '../../../store/useStore';

export class ElectronWindowOutputProvider implements OutputProvider {
  public id = 'electron-window';
  public name = 'Live Presentation Window';
  public type = 'electron-window' as const;
  public status: ProviderStatus = 'disabled';
  public lastUpdate?: number;
  public errorMessage?: string;

  private setStatus(status: ProviderStatus, error?: string) {
    this.status = status;
    this.errorMessage = error;
    const store = useStore.getState();
    if (store.setProviderStatus) {
      store.setProviderStatus(this.id, status, error);
    }
  }

  async initialize(): Promise<void> {
    this.setStatus('initializing');
    outputLogger.info('Initializing Electron Window Provider', this.id);
    
    // Check if electron API is available
    // In some environments, it might take a moment to be attached to the window object
    if (typeof window !== 'undefined' && window.electronAPI) {
      this.setStatus('ready');
      outputLogger.info('Electron Window Provider initialized', this.id);
    } else {
      // It's possible we are running in a browser environment, or it hasn't loaded yet.
      // We'll set it to ready anyway, and the update/clear methods will check again.
      // This prevents the error from showing up in the browser preview.
      this.setStatus('ready');
      outputLogger.info('Electron Window Provider initialized (API check deferred)', this.id);
    }
  }

  async start(): Promise<void> {
    if (this.status === 'unavailable' || this.status === 'disabled') return;
    this.setStatus('active');
    outputLogger.info('Electron Window Provider started', this.id);
  }

  async update(payload: OutputPayload): Promise<void> {
    if (this.status !== 'active') return;

    try {
      if (window.electronAPI) {
        // Provider always targets the 'main' window; multi-window routing is handled by setLive()
        window.electronAPI.sendToLive('main', payload as any);
        this.lastUpdate = Date.now();
        outputLogger.info(`Updated payload: ${payload.id}`, this.id);
      }
    } catch (err: any) {
      outputLogger.error('Failed to update live state', this.id, err);
      this.setStatus('error', err.message);
    }
  }

  async clear(): Promise<void> {
    if (this.status !== 'active') return;

    try {
      if (window.electronAPI) {
        window.electronAPI.sendToLive('main', { type: 'clear' } as any);
        this.lastUpdate = Date.now();
        outputLogger.info('Cleared output', this.id);
      }
    } catch (err: any) {
      outputLogger.error('Failed to clear live state', this.id, err);
      this.setStatus('error', err.message);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'unavailable') return;
    this.setStatus('ready');
    outputLogger.info('Electron Window Provider stopped', this.id);
  }

  async dispose(): Promise<void> {
    this.setStatus('disabled');
    outputLogger.info('Electron Window Provider disposed', this.id);
  }
}
