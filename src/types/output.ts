export type ProviderStatus = 'initializing' | 'ready' | 'active' | 'error' | 'unavailable' | 'disabled';

export interface OutputPayload {
  id: string;
  timestamp: number;
  type: 'scripture' | 'clear';
  content?: {
    reference: string;
    text: string;
    version: string;
  };
  presentation: {
    theme: 'dark' | 'light' | 'transparent' | 'chroma-green' | 'minimal-lower-third';
    layout: 'full-scripture' | 'lower-third' | 'reference-only' | 'custom';
    broadcastSafe: boolean;
    backgroundStyle?: 'solid' | 'transparent';
    fontFamily?: 'serif' | 'sans' | 'mono';
    fontScale?: number;
    textAlignment?: 'left' | 'center' | 'right' | 'justify';
    backgroundColor?: string;
    backgroundOpacity?: number;
    textColor?: string;
    referenceColor?: string;
    textShadow?: boolean;
    verseQuotes?: boolean;
    padding?: number;
  };
  visibility: {
    reference: boolean;
    version: boolean;
  };
  /** Per-element absolute positions + style overrides (used when layout === 'custom') */
  elements?: {
    scripture: {
      x: number; y: number; width: number; visible: boolean;
      height?: number; autoWidth?: boolean; autoFontSize?: boolean;
      fontFamily?: 'serif' | 'sans' | 'mono';
      fontSize?: number;
      textColor?: string;
      textAlignment?: 'left' | 'center' | 'right' | 'justify';
      verticalAlignment?: 'top' | 'middle' | 'bottom';
    };
    reference: {
      x: number; y: number; width: number; visible: boolean;
      height?: number; autoWidth?: boolean; autoFontSize?: boolean;
      fontFamily?: 'serif' | 'sans' | 'mono';
      fontSize?: number;
      textColor?: string;
      textAlignment?: 'left' | 'center' | 'right' | 'justify';
      verticalAlignment?: 'top' | 'middle' | 'bottom';
    };
  };
}

export interface OutputProvider {
  id: string;
  name: string;
  type: 'electron-window' | 'ndi' | 'other';
  status: ProviderStatus;
  lastUpdate?: number;
  errorMessage?: string;

  initialize(): Promise<void>;
  start(): Promise<void>;
  update(payload: OutputPayload): Promise<void>;
  clear(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface OutputLog {
  id: string;
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  providerId?: string;
  message: string;
  details?: any;
}
