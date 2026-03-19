import { OutputProvider, OutputPayload } from '../../types/output';
import { ElectronWindowOutputProvider } from './providers/ElectronWindowOutputProvider';
import { NDIOutputProvider } from './providers/NDIOutputProvider';
import { outputLogger } from './OutputDiagnosticsLogger';
import { useStore } from '../../store/useStore';

class OutputProviderManager {
  private static instance: OutputProviderManager;
  private providers: Map<string, OutputProvider> = new Map();
  private isInitialized = false;

  private constructor() {}

  public static getInstance(): OutputProviderManager {
    if (!OutputProviderManager.instance) {
      OutputProviderManager.instance = new OutputProviderManager();
    }
    return OutputProviderManager.instance;
  }

  public async initialize() {
    if (this.isInitialized) return;
    
    outputLogger.info('Initializing Output Provider Manager');

    // Register providers
    this.registerProvider(new ElectronWindowOutputProvider());
    this.registerProvider(new NDIOutputProvider());

    const state = useStore.getState();
    const settings = state.outputSettings;

    for (const provider of this.providers.values()) {
      await provider.initialize();

      // NDI is controlled per target in Settings -> Outputs & Display.
      // Never auto-start legacy/global NDI stream from persisted provider toggles.
      if (provider.id === 'ndi') {
        // Safety: ensure any stale legacy/default NDI session is stopped.
        try { window.electronAPI?.ndiStop?.('__legacy__'); } catch { /* ignore */ }

        if (settings?.providers?.[provider.id]?.enabled && state.setOutputSettings) {
          state.setOutputSettings({
            providers: {
              ...(state.outputSettings?.providers || {}),
              [provider.id]: { enabled: false },
            },
          });
        }
        if (state.setProviderStatus) {
          state.setProviderStatus(provider.id, provider.status, provider.errorMessage);
        }
        continue;
      }

      // Auto-start if enabled in settings
      if (settings?.providers?.[provider.id]?.enabled) {
        await this.startProvider(provider.id);
      } else {
        provider.status = provider.status === 'unavailable' ? 'unavailable' : 'disabled';
        if (state.setProviderStatus) {
          state.setProviderStatus(provider.id, provider.status, provider.errorMessage);
        }
      }
    }

    this.isInitialized = true;
  }

  private registerProvider(provider: OutputProvider) {
    this.providers.set(provider.id, provider);
    const state = useStore.getState();
    if (state.registerProvider) {
      state.registerProvider({
        id: provider.id,
        name: provider.name,
        type: provider.type,
        status: provider.status
      });
    }
  }

  public getProvider(id: string): OutputProvider | undefined {
    return this.providers.get(id);
  }

  public getProviders(): OutputProvider[] {
    return Array.from(this.providers.values());
  }

  public async startProvider(id: string) {
    if (id === 'ndi') return;
    const provider = this.providers.get(id);
    if (provider) {
      await provider.start();
    }
  }

  public async stopProvider(id: string) {
    if (id === 'ndi') return;
    const provider = this.providers.get(id);
    if (provider) {
      await provider.stop();
    }
  }

  public async updateAll(payload: OutputPayload) {
    const promises = [];
    for (const provider of this.providers.values()) {
      if (provider.status === 'active') {
        promises.push(provider.update(payload));
      }
    }
    await Promise.allSettled(promises);
  }

  public async clearAll() {
    const promises = [];
    for (const provider of this.providers.values()) {
      if (provider.status === 'active') {
        promises.push(provider.clear());
      }
    }
    await Promise.allSettled(promises);
  }
}

export const outputManager = OutputProviderManager.getInstance();
