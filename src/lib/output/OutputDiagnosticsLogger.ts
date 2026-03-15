import { OutputLog } from '../../types/output';
import { useStore } from '../../store/useStore';

class OutputDiagnosticsLogger {
  private static instance: OutputDiagnosticsLogger;
  
  private constructor() {}

  public static getInstance(): OutputDiagnosticsLogger {
    if (!OutputDiagnosticsLogger.instance) {
      OutputDiagnosticsLogger.instance = new OutputDiagnosticsLogger();
    }
    return OutputDiagnosticsLogger.instance;
  }

  public log(level: 'info' | 'warn' | 'error', message: string, providerId?: string, details?: any) {
    const logEntry: OutputLog = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      level,
      providerId,
      message,
      details
    };

    console[level](`[OutputDiagnostics] ${providerId ? `[${providerId}] ` : ''}${message}`, details || '');

    // Push to store, keep only last 100 logs
    const store = useStore.getState();
    if (store.addOutputLog) {
      store.addOutputLog(logEntry);
    }
  }

  public info(message: string, providerId?: string, details?: any) {
    this.log('info', message, providerId, details);
  }

  public warn(message: string, providerId?: string, details?: any) {
    this.log('warn', message, providerId, details);
  }

  public error(message: string, providerId?: string, details?: any) {
    this.log('error', message, providerId, details);
  }
}

export const outputLogger = OutputDiagnosticsLogger.getInstance();
