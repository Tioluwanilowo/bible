import { ProviderStatus, OutputLog } from './output';

export interface Scripture {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  text: string;
  version: string;
}

export type Intent = 'OPEN_REFERENCE' | 'NEXT_VERSE' | 'PREVIOUS_VERSE' | 'GOTO_VERSE' | 'SWITCH_VERSION' | 'CONTINUE_READING' | 'START_FROM_VERSE';

export interface Transcript {
  id: string;
  text: string;
  timestamp: number;
  isFinal: boolean;
  confidence?: number;
  provider?: string;
}

export interface Command {
  id: string;
  intent: Intent;
  confidence: number;
  payload?: any;
  timestamp: number;
  sourceText: string;
}

export interface ExecutionResult {
  scripture: Scripture | null;
  confidence: number;
  notes: string;
  requiresApproval: boolean;
  canUpdateLive: boolean;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  details?: any;
}

/**
 * A verse detected by Realtime from audio content (quoted scripture, thematic match)
 * rather than an explicit verbal announcement.  Shown in the Suggestions panel for
 * the operator to review and optionally approve into preview.
 */
export interface SuggestedVerse {
  id: string;
  scripture: Scripture;
  confidence: number;
  timestamp: number;
}

export interface QueuedReference {
  id: string;
  scripture: Scripture;
  queuedAt: number;
}

export type LiveTransitionType = 'cut' | 'fade' | 'stinger';

export interface LiveTransitionSettings {
  style: LiveTransitionType;
  durationMs: number;
  stingerLabel: string;
}

export interface LiveTransitionRuntime {
  active: boolean;
  style: LiveTransitionType;
  startedAt: number;
  endsAt: number;
}

export interface RunSheetAutoSettings {
  enabled: boolean;
  intervalSec: number;
}

export interface ThemeAsset {
  id: string;
  name: string;
  type: 'image' | 'font';
  dataUrl: string;
  mimeType: string;
  createdAt: number;
}

export interface LatencySample {
  id: string;
  timestamp: number;
  provider?: string;
  audioToTranscriptMs?: number;
  transcriptToIntentMs?: number;
  intentToPreviewMs?: number;
  previewToLiveMs?: number;
  totalToLiveMs?: number;
}

export interface SessionEvent {
  id: string;
  timestamp: number;
  type: 'transcript' | 'command' | 'preview' | 'live' | 'clear' | 'queue' | 'manual' | 'system';
  label: string;
  scripture?: Scripture | null;
  details?: any;
}

export interface AppUserProfile {
  id: string;
  name: string;
  /** Optional operator avatar image shown in profile picker/sidebar. */
  avatarDataUrl?: string;
  settings: Settings;
  version: string;
  mode: 'auto' | 'manual';
  runSheetAuto: RunSheetAutoSettings;
  transitionSettings: LiveTransitionSettings;
  activeThemeId: string | null;
  activeVoiceProfileId: string | null;
  outputTargets: OutputTarget[];
  updatedAt: number;
}

export interface PastorVoiceProfile {
  id: string;
  name: string;
  highConfidenceThreshold: number;
  mediumConfidenceThreshold: number;
  enableConfidenceGuardrails: boolean;
  verseLockEnabled: boolean;
  aiCueGateEnabled: boolean;
  suggestionCooldownMs: number;
}

export interface RemoteControlSettings {
  enabled: boolean;
  port: number;
  token: string;
}

export type OBSSceneSwitchMode = 'program' | 'preview';

export interface OBSSceneTarget {
  id: string;
  name: string;
  enabled: boolean;
  host: string;
  port: number;
  password: string;
  sceneName: string;
  mode: OBSSceneSwitchMode;
}

export interface OBSAutomationSettings {
  enabled: boolean;
  triggerOnGoLive: boolean;
  targets: OBSSceneTarget[];
}

export type ListeningState = 'idle' | 'initializing' | 'listening' | 'error' | 'stopped';
export type TranscriptionStatus = 'ready' | 'active' | 'unavailable' | 'error';

export interface TranscriptionProvider {
  name: string;
  isSupported(): boolean;
  initialize(options?: any): Promise<void>;
  start(stream?: MediaStream): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  onTranscriptChunk?: (transcript: Transcript) => void;
  onError?: (error: Error) => void;
}

export interface Settings {
  deviceId: string;
  providerId: string;
  /** User-supplied OpenAI API key for Whisper transcription */
  openaiApiKey: string;
  /** User-supplied Google Cloud API key for Speech-to-Text */
  googleSttApiKey: string;
  /** User-supplied OpenAI API key for the ChatGPT reference interpreter */
  chatgptApiKey: string;
  /** User-supplied Deepgram API key for Nova-2 streaming transcription */
  deepgramApiKey: string;
  highConfidenceThreshold: number;
  mediumConfidenceThreshold: number;
  /** Extra safety checks before auto-live updates are applied. */
  enableConfidenceGuardrails: boolean;
  /** Keep auto-live locked to same chapter with adjacent-verse continuation only. */
  verseLockEnabled: boolean;
  /** Skip AI intent calls when transcript has no scripture/navigation cue. */
  aiCueGateEnabled: boolean;
  /** Hold suggestions briefly after an explicit reference to reduce false jumps. */
  suggestionCooldownMs: number;
  /** Built-in local network remote control server configuration. */
  remoteControl: RemoteControlSettings;
  /** OBS WebSocket scene switching automation triggered on Go Live. */
  obsAutomation: OBSAutomationSettings;
  presentation: PresentationSettings;
  targetDisplayId: string | null;
  hotkeys: Record<string, HotkeyConfig>;
}

// ── AI Reference State ────────────────────────────────────────────────────────

/** The Bible reference currently shown on the live output — source of truth for the AI. */
export interface ConfirmedRef {
  book:        string;
  chapter:     number;
  verseStart:  number;
  verseEnd?:   number;
  translation: string;
  updatedAt:   number;
}

/**
 * A partially-assembled Bible reference built from consecutive speech chunks.
 * Expires after PENDING_EXPIRY_MS (5 s) of unrelated speech.
 */
export interface PendingRef {
  book?:       string;
  chapter?:    number;
  verseStart?: number;
  verseEnd?:   number;
  updatedAt:   number;
}

export type PresentationTheme = 'dark' | 'light' | 'minimal-lower-third' | 'transparent' | 'chroma-green';
export type PresentationLayout = 'full-scripture' | 'lower-third' | 'reference-only' | 'custom';

export interface PresentationSettings {
  theme: PresentationTheme;
  layout: PresentationLayout;
  fontScale: number;
  fontFamily: 'serif' | 'sans' | 'mono';
  textAlignment: 'left' | 'center' | 'right' | 'justify';
  padding: number;
  referenceVisible: boolean;
  versionVisible: boolean;
  backgroundStyle: 'solid' | 'transparent';
  lowerThirdPosition: 'bottom-left' | 'bottom-center' | 'bottom-right';
  broadcastSafe?: boolean;
  // Extended styling
  backgroundColor: string;
  backgroundOpacity: number;
  textColor: string;
  referenceColor: string;
  textShadow: boolean;
  verseQuotes: boolean;
}

/** Position and per-element styling for a text element on the 1920x1080 canvas */
export interface ElementPosition {
  x: number;       // left edge % of canvas width
  y: number;       // top edge % of canvas height
  width: number;   // element width % of canvas width (ignored when autoWidth=true)
  visible: boolean;
  /** Layer order. Higher values render in front of lower values. */
  zIndex?: number;
  /** Rounded corner radius for text container/highlight (px at 1920 reference width). */
  borderRadius?: number;
  /** When true the element shrinks/grows to fit its text (no fixed width) */
  autoWidth?: boolean;
  /** Element height % of canvas height. undefined = content height (no constraint) */
  height?: number;
  /** When true the font size auto-scales to fill the fixed width × height box */
  autoFontSize?: boolean;
  /** Per-element font overrides (null = inherit from global PresentationSettings) */
  fontFamily?: 'serif' | 'sans' | 'mono';
  /** Absolute font size in px at the 1920px reference width. null = derive from global fontScale */
  fontSize?: number;
  /** Per-element text color override */
  textColor?: string;
  /** Per-element text alignment override */
  textAlignment?: 'left' | 'center' | 'right' | 'justify';
  /** Vertical alignment of text within a fixed-height box */
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  /** Optional text highlight color behind the element text (hex). */
  textHighlightColor?: string;
  /** Opacity % for text highlight color. */
  textHighlightOpacity?: number;
}

export interface ThemeBoxLayer {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  zIndex: number;
  fillColor: string;
  fillOpacity: number;
  borderRadius: number;
  imageUrl?: string;
}

export interface ThemeElements {
  scripture: ElementPosition;
  reference: ElementPosition;
  boxes: ThemeBoxLayer[];
}

export interface Theme {
  id: string;
  name: string;
  settings: PresentationSettings;
  elements: ThemeElements;
  createdAt: number;
  updatedAt: number;
}

/** Default element layout — centered full-scripture style */
export const DEFAULT_ELEMENTS: ThemeElements = {
  scripture: {
    x: 5, y: 28, width: 90, visible: true, autoWidth: false, fontSize: 64,
    zIndex: 20, borderRadius: 0, textHighlightColor: '#000000', textHighlightOpacity: 0,
  },
  reference: {
    x: 20, y: 72, width: 60, visible: true, autoWidth: false, fontSize: 32,
    zIndex: 30, borderRadius: 0, textHighlightColor: '#000000', textHighlightOpacity: 0,
  },
  boxes: [],
};

/** Snap zone presets for drag-drop canvas */
export const SNAP_PRESETS = {
  top:         { scripture: { x: 5, y: 5,  width: 90 }, reference: { x: 20, y: 22, width: 60 } },
  middle:      { scripture: { x: 5, y: 28, width: 90 }, reference: { x: 20, y: 72, width: 60 } },
  lowerThird:  { scripture: { x: 5, y: 58, width: 90 }, reference: { x: 20, y: 80, width: 60 } },
} as const;

export interface DisplayInfo {
  id: string;
  name: string;
  isPrimary: boolean;
}

/** A named output channel that maps to one live window on a specific display with a specific theme */
export interface OutputTarget {
  id: string;
  label: string;
  /** 'window' = Electron window on a display  |  'ndi' = NDI network broadcast */
  type: 'window' | 'ndi';
  displayId: string | null;   // null = primary display (window type only)
  themeId: string | null;     // null = follow global active theme
  enabled: boolean;
  windowOpen: boolean;        // runtime only — not persisted
  /** NDI source name visible to receivers on the network (ndi type only) */
  ndiSourceName?: string;
}

export interface LiveOutputState {
  targetDisplayId: string | null;
  windowBounds: any | null; // Electron.Rectangle
  isWindowOpen: boolean;
  windowStatus: 'open' | 'closed' | 'moved' | 'unavailable';
  currentTheme: PresentationTheme;
  currentLayout: PresentationLayout;
  currentScripture: Scripture | null;
  isFrozen: boolean;
  previewDiffersFromLive: boolean;
}

export interface HotkeyConfig {
  key: string;
  modifiers: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  action: string;
}

export interface OutputSettings {
  providers: Record<string, { enabled: boolean }>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  status: ProviderStatus;
  errorMessage?: string;
}

export interface AppState {
  showThemeDesigner: boolean;
  toggleThemeDesigner: () => void;
  themes: Theme[];
  activeThemeId: string | null;
  voiceProfiles: PastorVoiceProfile[];
  activeVoiceProfileId: string | null;
  userProfiles: AppUserProfile[];
  activeUserProfileId: string | null;

  // ── AI Reference State ────────────────────────────────────────────────────
  /** Rolling buffer of the last N final transcript chunks fed to the AI. */
  transcriptBuffer: Transcript[];
  /** Mirrors liveScripture as a ConfirmedRef for the AI interpreter context. */
  confirmedRef: ConfirmedRef | null;
  /** Partially assembled reference being built across speech chunks. */
  pendingRef: PendingRef | null;
  addTheme: (name?: string) => string;
  duplicateTheme: (id: string) => string;
  updateTheme: (id: string, updates: Partial<Pick<Theme, 'name' | 'settings' | 'elements'>>) => void;
  deleteTheme: (id: string) => void;
  setActiveTheme: (id: string | null) => void;
  addVoiceProfileFromCurrent: (name: string) => string;
  updateVoiceProfileFromCurrent: (id: string) => void;
  removeVoiceProfile: (id: string) => void;
  setActiveVoiceProfile: (id: string) => void;
  createUserProfile: (name: string) => string;
  renameUserProfile: (id: string, name: string) => void;
  setUserProfileAvatar: (id: string, avatarDataUrl: string | null) => void;
  deleteUserProfile: (id: string) => void;
  setActiveUserProfile: (id: string) => void;
  saveCurrentToActiveProfile: () => void;
  // Output targets (multi-display / multi-window)
  outputTargets: OutputTarget[];
  addOutputTarget: () => string;
  addNDITarget: () => string;
  removeOutputTarget: (id: string) => void;
  updateOutputTarget: (id: string, updates: Partial<OutputTarget>) => void;
  mode: 'auto' | 'manual';
  isAutoPaused: boolean;
  isLiveFrozen: boolean;
  showSimulator: boolean;
  isListening: boolean;
  listeningState: ListeningState;
  transcriptionStatus: TranscriptionStatus;
  isMockMode: boolean;
  settings: Settings;
  version: string;
  availableVersions: string[];
  previewScripture: Scripture | null;
  liveScripture: Scripture | null;
  activityLog: ActivityEntry[];
  history: Scripture[];
  transcripts: Transcript[];
  commands: Command[];
  pendingCommands: Command[];
  suggestions: SuggestedVerse[];
  queue: QueuedReference[];
  runSheetAuto: RunSheetAutoSettings;
  transitionSettings: LiveTransitionSettings;
  transitionRuntime: LiveTransitionRuntime | null;
  themeAssets: ThemeAsset[];
  latencySamples: LatencySample[];
  sessionEvents: SessionEvent[];
  onboardingCompleted: boolean;
  liveOutputState: LiveOutputState;
  availableDisplays: DisplayInfo[];
  
  outputSettings: OutputSettings;
  providerStatuses: Record<string, ProviderInfo>;
  outputLogs: OutputLog[];
  parsingDiagnostics: any[];
  
  setAvailableVersions: (versions: string[]) => void;
  setMode: (mode: 'auto' | 'manual') => void;
  toggleAutoPause: () => void;
  toggleFreeze: () => void;
  toggleSimulator: () => void;
  setListeningState: (state: ListeningState) => void;
  setTranscriptionStatus: (status: TranscriptionStatus) => void;
  setIsListening: (isListening: boolean) => void;
  setIsMockMode: (isMockMode: boolean) => void;
  updateSettings: (settings: Partial<Settings>) => void;
  setVersion: (version: string) => void;
  setPreview: (scripture: Scripture | null) => void;
  setLive: (scripture: Scripture | null) => void;
  clearLive: () => void;
  logActivity: (message: string, type?: 'info' | 'success' | 'warning' | 'error', details?: any) => void;
  addToHistory: (scripture: Scripture) => void;
  nextVerse: () => void;
  prevVerse: () => void;
  addTranscript: (transcript: Transcript) => void;
  /** Monotonically-increasing counter, incremented each time Realtime fires a successful
   *  processCommand.  The batch AI path captures this value before its async call and
   *  discards its result if the counter has advanced by the time the Promise resolves. */
  realtimeCommandSeq: number;
  /** Handles a scripture command detected directly from OpenAI Realtime live audio. */
  processRealtimeSignal: (aiResponse: import('../lib/interpreter/types').AIResponse) => void;
  processCommand: (command: Command) => void;
  executeCommand: (command: Command) => void;
  approveCommand: (id: string) => void;
  rejectCommand: (id: string) => void;
  addSuggestion: (scripture: Scripture, confidence: number) => void;
  approveSuggestion: (id: string) => void;
  dismissSuggestion: (id: string) => void;
  queueScripture: (scripture: Scripture) => void;
  queuePreview: () => void;
  removeQueuedReference: (id: string) => void;
  clearQueue: () => void;
  sendNextQueuedLive: () => void;
  sendQueuedReference: (id: string) => void;
  updateRunSheetAuto: (updates: Partial<RunSheetAutoSettings>) => void;
  setTransitionSettings: (updates: Partial<LiveTransitionSettings>) => void;
  goLiveWithTransition: (scripture: Scripture | null, styleOverride?: LiveTransitionType) => void;
  addThemeAsset: (asset: Omit<ThemeAsset, 'id' | 'createdAt'>) => string;
  removeThemeAsset: (id: string) => void;
  addLatencySample: (sample: Omit<LatencySample, 'id' | 'timestamp'>) => void;
  clearLatencySamples: () => void;
  addSessionEvent: (event: Omit<SessionEvent, 'id' | 'timestamp'>) => void;
  clearSessionEvents: () => void;
  replaySessionEvent: (id: string) => void;
  setOnboardingCompleted: (value: boolean) => void;

  // Live Output Actions
  setLiveOutputState: (state: Partial<LiveOutputState>) => void;
  setTargetDisplay: (displayId: string | null) => void;
  setLiveWindowBounds: (windowId: string, bounds: any) => void;
  setLiveWindowOpen: (isOpen: boolean) => void;
  setLiveWindowStatus: (windowId: string, status: LiveOutputState['windowStatus']) => void;
  updatePresentationSettings: (settings: Partial<PresentationSettings>) => void;
  setAvailableDisplays: (displays: DisplayInfo[]) => void;
  updateHotkey: (action: string, hotkey: HotkeyConfig) => void;
  removeHotkey: (action: string) => void;

  setOutputSettings: (settings: Partial<OutputSettings>) => void;
  registerProvider: (info: ProviderInfo) => void;
  setProviderStatus: (id: string, status: ProviderStatus, errorMessage?: string) => void;
  addOutputLog: (log: OutputLog) => void;
  addParsingDiagnostic: (diagnostic: any) => void;
}
