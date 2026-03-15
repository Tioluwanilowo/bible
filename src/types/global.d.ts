export {};

declare global {
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

      // NDI — offscreen renderer approach; no windowId needed
      ndiStart: (sourceName: string) => Promise<{ ok: boolean; error?: string }>;
      ndiStop: () => void;
      ndiGetStatus: () => Promise<{ status: string }>;
      onNDIStatusChanged: (callback: (payload: { status: string; sourceName?: string; error?: string }) => void) => void;

      /** Open a URL in the system default browser */
      openExternal?: (url: string) => void;
    };
  }
}
