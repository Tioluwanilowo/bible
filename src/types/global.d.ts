export {};

declare global {
  interface NDIDiagnosticsRow {
    targetId: string;
    sourceName: string;
    active: boolean;
    startedAt: number;
    uptimeMs: number;
    frameCount: number;
    frameErrors: number;
    fps: number;
    lastFrameAt: number | null;
    runtimeDetected: boolean;
    runtimePath?: string;
  }

  interface NDIDiagnosticsSummary {
    activeCount: number;
    runtimeDetected: boolean;
    runtimePath?: string;
    checkedAt: number;
  }

  interface OBSSceneTargetConfig {
    id: string;
    name: string;
    enabled: boolean;
    host: string;
    port: number;
    password: string;
    sceneName: string;
    mode: 'program' | 'preview';
  }

  interface OBSSceneTriggerResult {
    ok: boolean;
    targetId: string;
    targetName: string;
    mode: 'program' | 'preview';
    sceneName: string;
    message: string;
  }

  interface OBSSceneListResult {
    ok: boolean;
    targetId: string;
    targetName: string;
    scenes: string[];
    currentProgramSceneName?: string;
    currentPreviewSceneName?: string;
    message: string;
  }

  interface Window {
    electronAPI?: {
      sendToLive: (windowId: string, data: any) => void;
      onUpdateLive: (callback: (data: any) => void) => void;
      sendThemeToLive: (theme: string, layout: string) => void;
      onUpdateTheme: (callback: (theme: string, layout: string) => void) => void;
      getDisplays: () => Promise<any[]>;
      openLiveWindow: (windowId: string, displayId?: string) => void;
      closeLiveWindow: (windowId: string) => void;
      moveLiveWindow: (windowId: string, displayId: string) => void;
      onLiveWindowStatusChanged: (callback: (payload: { windowId: string; status: string }) => void) => void;
      onLiveWindowBoundsChanged: (callback: (payload: { windowId: string; bounds: any }) => void) => void;
      onDisplaysChanged: (callback: (displays: any[]) => void) => void;
      remoteConfigure: (config: { enabled: boolean; port: number; token: string }) => Promise<any>;
      remoteGetStatus: () => Promise<any>;
      remoteStateSync: (payload: {
        mode: 'auto' | 'manual';
        isAutoPaused: boolean;
        isLiveFrozen: boolean;
        previewReference: string;
        liveReference: string;
        queueCount: number;
      }) => void;
      onRemoteCommand: (callback: (payload: { type: string; payload?: any }) => void) => (() => void) | void;
      // NDI — offscreen renderer approach; no windowId needed
      ndiStart: (sourceName: string, targetId?: string) => Promise<{ ok: boolean; error?: string; targetId?: string }>;
      ndiStop: (targetId?: string) => void;
      ndiGetStatus: (targetId?: string) => Promise<{ status: string; reason?: string; sourceName?: string; targetId?: string; activeCount?: number }>;
      ndiGetDiagnostics: (targetId?: string) => Promise<{ rows: NDIDiagnosticsRow[]; summary: NDIDiagnosticsSummary }>;
      onNDIStatusChanged: (callback: (payload: { status: string; sourceName?: string; error?: string; targetId?: string; activeCount?: number }) => void) => (() => void) | void;

      /** Open a URL in the system default browser */
      openExternal?: (url: string) => void;

      obsTriggerGoLive?: (payload: {
        enabled: boolean;
        triggerOnGoLive?: boolean;
        targets: OBSSceneTargetConfig[];
        reference?: string;
      }) => Promise<{ ok: boolean; results: OBSSceneTriggerResult[]; skipped?: string }>;
      obsTestTarget?: (target: OBSSceneTargetConfig) => Promise<OBSSceneTriggerResult>;
      obsListScenes?: (target: OBSSceneTargetConfig) => Promise<OBSSceneListResult>;
    };
  }
}

