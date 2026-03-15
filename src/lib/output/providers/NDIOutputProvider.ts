import { OutputProvider, OutputPayload, ProviderStatus } from '../../../types/output';
import { outputLogger } from '../OutputDiagnosticsLogger';
import { useStore } from '../../../store/useStore';

export class NDIOutputProvider implements OutputProvider {
  public id = 'ndi';
  public name = 'NDI Output';
  public type = 'ndi' as const;
  public status: ProviderStatus = 'disabled';
  public lastUpdate?: number;
  public errorMessage?: string;

  /** The NDI source name visible to receivers on the network */
  private sourceName = 'ScriptureFlow';

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
    outputLogger.info('Initializing NDI Provider', this.id);

    if (typeof window !== 'undefined' && window.electronAPI?.ndiGetStatus) {
      try {
        const { status, reason } = await window.electronAPI.ndiGetStatus();
        if (status === 'unavailable') {
          const msg = reason ?? 'grandiose not installed — NDI SDK missing';
          this.setStatus('unavailable', msg);
          outputLogger.info(`NDI unavailable: ${msg}`, this.id);
        } else {
          this.setStatus('ready');
          outputLogger.info('NDI Provider ready', this.id);
        }
      } catch {
        this.setStatus('ready'); // assume ready; error surfaces at start()
        outputLogger.info('NDI Provider initialized (status check deferred)', this.id);
      }

      // Listen for status pushes from the main process
      window.electronAPI.onNDIStatusChanged(({ status, error }) => {
        if (status === 'active') {
          this.setStatus('active');
          outputLogger.info('NDI active — streaming via offscreen renderer', this.id);
        } else if (status === 'stopped') {
          this.setStatus('ready');
          outputLogger.info('NDI stopped', this.id);
        } else if (status === 'error') {
          this.setStatus('error', error ?? 'Unknown NDI error');
          outputLogger.error(`NDI error: ${error}`, this.id);
        }
      });
    } else {
      // Browser / test environment — stay as stub
      this.setStatus('ready');
      outputLogger.info('NDI Provider initialized (browser mode — stub)', this.id);
    }
  }

  async start(): Promise<void> {
    if (this.status === 'unavailable' || this.status === 'disabled') return;

    if (typeof window !== 'undefined' && window.electronAPI?.ndiStart) {
      outputLogger.info(`Starting NDI sender "${this.sourceName}"`, this.id);
      // No windowId — main process creates its own offscreen BrowserWindow renderer
      const result = await window.electronAPI.ndiStart(this.sourceName);
      if (result.ok) {
        this.setStatus('active');
        outputLogger.info(`NDI sender started — broadcasting as "${this.sourceName}"`, this.id);
      } else {
        this.setStatus('error', result.error ?? 'Failed to start NDI');
        outputLogger.error(`NDI start failed: ${result.error}`, this.id);
      }
    } else {
      // Stub mode (browser)
      this.setStatus('active');
      outputLogger.info('NDI Provider started (stub)', this.id);
    }
  }

  async update(_payload: OutputPayload): Promise<void> {
    if (this.status !== 'active') return;
    // Scripture data is routed to the NDI offscreen window via sendToLive('__ndi__', ...)
    // in the store's setLive action. Paint events in the main process handle frame capture.
    this.lastUpdate = Date.now();
  }

  async clear(): Promise<void> {
    if (this.status !== 'active') return;
    // The offscreen renderer will receive a clear payload and repaint a blank frame
    this.lastUpdate = Date.now();
    outputLogger.info('Clear signalled — NDI offscreen renderer will show blank frame', this.id);
  }

  async stop(): Promise<void> {
    if (this.status === 'unavailable') return;
    if (typeof window !== 'undefined' && window.electronAPI?.ndiStop) {
      window.electronAPI.ndiStop();
    }
    this.setStatus('ready');
    outputLogger.info('NDI Provider stopped', this.id);
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.setStatus('disabled');
    outputLogger.info('NDI Provider disposed', this.id);
  }

  /** Called by Settings UI to update the NDI source name before starting */
  setSourceName(name: string) {
    this.sourceName = name;
  }
}
