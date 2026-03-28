import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express, { Request, Response } from 'express';

let mainWindow: BrowserWindow | null = null;
const liveWindows = new Map<string, BrowserWindow>();

// ── Realtime / Deepgram WebSocket bridges ─────────────────────────────────────
// The renderer cannot attach custom headers to a browser WebSocket.
// Both OpenAI Realtime (Authorization: Bearer) and Deepgram (Authorization: Token)
// are handled here in the main process using the `ws` Node package so the API
// keys are set directly on the socket and never appear in renderer network traffic.
// Audio chunks arrive via IPC; transcript/command events are pushed back the same way.
//
// ws is loaded lazily (inside the handler, not at module level) so a missing
// package cannot crash main.js and prevent all other IPC handlers from
// registering.  Add ws as a direct dependency if needed: npm install ws

let realtimeWs: any = null;
let realtimeWsOwner: Electron.WebContents | null = null;

// ── Deepgram WS state ──────────────────────────────────────────────────────────
let deepgramWs: any = null;
let deepgramWsOwner: Electron.WebContents | null = null;

function closeDeepgramWs(): void {
  if (deepgramWs) {
    try { deepgramWs.close(); } catch { /* ignore */ }
    deepgramWs = null;
  }
  deepgramWsOwner = null;
}

function closeRealtimeWs(): void {
  if (realtimeWs) {
    try { realtimeWs.close(); } catch { /* ignore */ }
    realtimeWs = null;
  }
  realtimeWsOwner = null;
}

/** Lazy-load `ws` so a missing module cannot crash module initialisation. */
function loadWsClass(): { WS: any; error?: undefined } | { WS?: undefined; error: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const WS = require('ws');
    return { WS };
  } catch (err: any) {
    console.error('[RealtimeWS] Failed to load ws module:', err.message);
    console.error('[RealtimeWS] Fix: run  npm install ws  in the project root');
    return { error: `ws module not available: ${err.message}. Run: npm install ws` };
  }
}

// Use Electron packaging state, not NODE_ENV.
// This prevents installed EXEs from accidentally entering dev mode
// if NODE_ENV=development exists in the system environment.
const isDev = !app.isPackaged;

/**
 * Returns the Vite dev server base URL.
 *
 * Vite's writeDevServerUrl plugin writes the actual URL (with whatever port
 * Vite chose) to dist-electron/.dev-server-url every time the dev server
 * starts.  We read that file so the port is never hardcoded — it works
 * whether Vite ended up on 3000, 3001, 3002, or any other port.
 *
 * Falls back to the VITE_DEV_SERVER_URL env var, then to localhost:3000.
 */
function getDevServerUrl(): string {
  try {
    const urlFile = path.join(__dirname, '.dev-server-url');
    return fs.readFileSync(urlFile, 'utf-8').trim();
  } catch {
    return process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:3000';
  }
}

// Resolved once at startup — all windows share the same dev server.

const DEV_SERVER_URL = isDev ? getDevServerUrl() : '';

type RemoteControlConfig = {
  enabled: boolean;
  port: number;
  token: string;
};

type RemoteRuntimeState = {
  mode: 'auto' | 'manual';
  isAutoPaused: boolean;
  isLiveFrozen: boolean;
  previewReference: string;
  liveReference: string;
  queueCount: number;
  updatedAt: number;
};

type RemoteClientInfo = {
  id: string;
  ip: string;
  userAgent: string;
  lastSeenAt: number;
  lastCommandAt?: number;
};

let remoteControlConfig: RemoteControlConfig = {
  enabled: false,
  port: 4217,
  token: '',
};
let remoteControlApp: ReturnType<typeof express> | null = null;
let remoteControlServer: import('http').Server | null = null;
let remoteControlError: string | null = null;
let remoteRuntimeState: RemoteRuntimeState = {
  mode: 'manual',
  isAutoPaused: false,
  isLiveFrozen: false,
  previewReference: '',
  liveReference: '',
  queueCount: 0,
  updatedAt: Date.now(),
};
const remoteClients = new Map<string, RemoteClientInfo>();
const remoteSSEClients = new Set<Response>();
const remoteRateWindow = new Map<string, { count: number; windowStart: number }>();
let remoteLastCommandAt: number | null = null;
let remoteCommandCount = 0;

function getRemoteClientId(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
  const ua = String(req.header('user-agent') || 'unknown-agent');
  return `${ip}::${ua}`;
}

function touchRemoteClient(req: Request, command = false): void {
  const id = getRemoteClientId(req);
  const now = Date.now();
  const existing = remoteClients.get(id);
  const info: RemoteClientInfo = existing ? {
    ...existing,
    lastSeenAt: now,
    lastCommandAt: command ? now : existing.lastCommandAt,
  } : {
    id,
    ip: req.ip || req.socket.remoteAddress || 'unknown-ip',
    userAgent: String(req.header('user-agent') || 'unknown-agent'),
    lastSeenAt: now,
    lastCommandAt: command ? now : undefined,
  };
  remoteClients.set(id, info);
  if (command) {
    remoteLastCommandAt = now;
    remoteCommandCount += 1;
  }
}

function isRemoteRateLimited(req: Request): boolean {
  const id = getRemoteClientId(req);
  const now = Date.now();
  const current = remoteRateWindow.get(id);
  if (!current || now - current.windowStart > 1000) {
    remoteRateWindow.set(id, { count: 1, windowStart: now });
    return false;
  }
  current.count += 1;
  remoteRateWindow.set(id, current);
  return current.count > 25;
}

function cleanupRemoteClientState(): void {
  const cutoff = Date.now() - 60_000;
  for (const [key, client] of remoteClients.entries()) {
    if (client.lastSeenAt < cutoff) remoteClients.delete(key);
  }
}

function broadcastRemoteState(): void {
  if (remoteSSEClients.size === 0) return;
  const payload = JSON.stringify({ state: remoteRuntimeState, ts: Date.now() });
  for (const res of Array.from(remoteSSEClients)) {
    try {
      res.write(`event: state\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      remoteSSEClients.delete(res);
    }
  }
}

function getRemoteUrls(port: number): string[] {
  const urls = new Set<string>();

  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const entry of iface) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      urls.add(`http://${entry.address}:${port}`);
    }
  }

  return [...urls];
}

function parseRemoteToken(req: Request): string {
  const headerToken = req.header('x-scriptureflow-token');
  if (headerToken && typeof headerToken === 'string') return headerToken.trim();

  const auth = req.header('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }

  const queryToken = req.query?.token;
  if (typeof queryToken === 'string') return queryToken.trim();
  return '';
}

function isRemoteAuthorized(req: Request): boolean {
  if (!remoteControlConfig.token) return true;
  const incoming = parseRemoteToken(req);
  return incoming.length > 0 && incoming === remoteControlConfig.token;
}

function buildRemoteStatus() {
  cleanupRemoteClientState();
  return {
    running: Boolean(remoteControlServer),
    enabled: remoteControlConfig.enabled,
    port: remoteControlConfig.port,
    tokenSet: Boolean(remoteControlConfig.token),
    urls: getRemoteUrls(remoteControlConfig.port),
    connectedClients: remoteClients.size,
    lastCommandAt: remoteLastCommandAt ?? undefined,
    commandCount: remoteCommandCount,
    error: remoteControlError ?? undefined,
    state: remoteRuntimeState,
  };
}

function buildRemoteControlPage(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>ScriptureFlow Remote</title>
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; margin: 0; background: #0a0a0a; color: #f4f4f5; }
      .wrap { max-width: 860px; margin: 0 auto; padding: 18px; }
      .card { background: #121216; border: 1px solid #24242a; border-radius: 12px; padding: 14px; margin-bottom: 12px; }
      .row { display: flex; gap: 8px; flex-wrap: wrap; }
      button { border: 0; border-radius: 8px; padding: 10px 12px; color: white; background: #3f3f46; cursor: pointer; }
      button:hover { background: #52525b; }
      .primary { background: #2563eb; }
      .ok { background: #059669; }
      .danger { background: #b91c1c; }
      input { width: 100%; border-radius: 8px; border: 1px solid #27272a; background: #09090b; color: white; padding: 10px; box-sizing: border-box; margin-bottom: 8px; }
      .muted { color: #a1a1aa; font-size: 12px; }
      .title { font-size: 18px; font-weight: 700; margin: 0 0 8px; }
      .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .state { display: grid; grid-template-columns: 130px 1fr; gap: 6px; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="title">ScriptureFlow Remote</p>
        <p class="muted">Control preview/live and queue from phone or laptop.</p>
        <input id="token" placeholder="Access token (leave empty if remote has no token)" />
        <p id="authMsg" class="muted"></p>
      </div>
      <div class="card">
        <p class="title">Live Controls</p>
        <div class="row">
          <button class="ok" onclick="act('goLive')">Go Live</button>
          <button class="danger" onclick="act('clearLive')">Clear Live</button>
          <button onclick="act('nextVerse')">Next Verse</button>
          <button onclick="act('prevVerse')">Previous Verse</button>
        </div>
      </div>
      <div class="card">
        <p class="title">Mode</p>
        <div class="row">
          <button onclick="act('setModeManual')">Manual</button>
          <button onclick="act('setModeAuto')">Auto</button>
          <button onclick="act('toggleAutoPause')">Pause / Resume Auto</button>
        </div>
      </div>
      <div class="card">
        <p class="title">Queue</p>
        <div class="row">
          <button class="primary" onclick="act('queuePreview')">Queue Current Preview</button>
          <button class="ok" onclick="act('sendNextQueuedLive')">Send Next Queued Live</button>
        </div>
      </div>
      <div class="card">
        <p class="title">Direct Preview Lookup</p>
        <input id="book" placeholder="Book (e.g. John)" />
        <input id="chapter" placeholder="Chapter (e.g. 3)" />
        <input id="verse" placeholder="Verse (e.g. 16)" />
        <button class="primary" onclick="setPreviewRef()">Set Preview Reference</button>
      </div>
      <div class="card">
        <p class="title">Current State</p>
        <div id="state" class="state"></div>
      </div>
    </div>
    <script>
      let stateStream = null;
      let tokenRequired = false;

      function authHeaders() {
        const token = document.getElementById('token').value.trim();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['x-scriptureflow-token'] = token;
        return headers;
      }
      function readTokenFromUrl() {
        try {
          const params = new URLSearchParams(window.location.search || '');
          return (params.get('token') || '').trim();
        } catch {
          return '';
        }
      }
      function setAuthMsg(text) {
        const el = document.getElementById('authMsg');
        if (!el) return;
        el.textContent = text || '';
      }
      function getToken() {
        return document.getElementById('token').value.trim();
      }
      async function loadPublicConfig() {
        try {
          const res = await fetch('/api/public-config');
          if (!res.ok) return;
          const data = await res.json();
          tokenRequired = Boolean(data?.tokenRequired);
        } catch {}
      }
      async function act(type, payload) {
        if (tokenRequired && !getToken()) {
          setAuthMsg('Authentication required. Enter access token.');
          return;
        }
        const res = await fetch('/api/action', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ type, payload: payload || {} }),
        });
        if (res.status === 401) {
          setAuthMsg('Unauthorized: enter the correct access token.');
          return;
        }
        await refreshState();
      }
      async function setPreviewRef() {
        const book = document.getElementById('book').value.trim();
        const chapter = parseInt(document.getElementById('chapter').value.trim(), 10);
        const verse = parseInt(document.getElementById('verse').value.trim(), 10);
        if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse)) return;
        await act('setPreviewReference', { book, chapter, verse });
      }
      function renderState(s) {
        document.getElementById('state').innerHTML =
          '<div class=\"muted\">Mode</div><div>' + (s.mode || '-') + '</div>' +
          '<div class=\"muted\">Auto Paused</div><div>' + (s.isAutoPaused ? 'Yes' : 'No') + '</div>' +
          '<div class=\"muted\">Frozen</div><div>' + (s.isLiveFrozen ? 'Yes' : 'No') + '</div>' +
          '<div class=\"muted\">Preview</div><div class=\"mono\">' + (s.previewReference || '-') + '</div>' +
          '<div class=\"muted\">Live</div><div class=\"mono\">' + (s.liveReference || '-') + '</div>' +
          '<div class=\"muted\">Queue</div><div>' + (s.queueCount ?? 0) + '</div>';
      }
      async function refreshState() {
        if (tokenRequired && !getToken()) {
          setAuthMsg('Authentication required. Enter access token.');
          return false;
        }
        const res = await fetch('/api/state', { headers: authHeaders() });
        if (res.status === 401) {
          setAuthMsg('Unauthorized: enter the correct access token.');
          return false;
        }
        if (!res.ok) return false;
        setAuthMsg('');
        const data = await res.json();
        renderState(data.state || {});
        return true;
      }
      function connectStateStream() {
        if (stateStream) {
          try { stateStream.close(); } catch {}
          stateStream = null;
        }
        const token = getToken();
        if (tokenRequired && !token) return;
        const url = token ? ('/api/events?token=' + encodeURIComponent(token)) : '/api/events';
        try {
          const es = new EventSource(url);
          stateStream = es;
          es.addEventListener('state', (ev) => {
            try {
              const payload = JSON.parse(ev.data);
              if (payload && payload.state) renderState(payload.state);
            } catch {}
          });
          es.onerror = () => {
            try { es.close(); } catch {}
            stateStream = null;
            if (tokenRequired && !getToken()) return;
            setTimeout(connectStateStream, 1500);
          };
        } catch {}
      }
      const tokenInput = document.getElementById('token');
      tokenInput.value = readTokenFromUrl();
      tokenInput.addEventListener('change', () => {
        connectStateStream();
        refreshState();
      });
      tokenInput.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        connectStateStream();
        refreshState();
      });
      loadPublicConfig().then(async () => {
        if (tokenRequired && !getToken()) {
          setAuthMsg('Authentication required. Enter access token.');
          return;
        }
        connectStateStream();
        await refreshState();
      });
      setInterval(refreshState, 5000);
    </script>
  </body>
</html>`;
}

async function stopRemoteControlServer(): Promise<void> {
  for (const res of Array.from(remoteSSEClients)) {
    try { res.end(); } catch { /* ignore */ }
  }
  remoteSSEClients.clear();
  if (!remoteControlServer) return;
  await new Promise<void>((resolve) => {
    remoteControlServer?.close(() => resolve());
  });
  remoteControlServer = null;
  remoteControlApp = null;
}

async function startRemoteControlServer(): Promise<void> {
  if (remoteControlServer) return;

  const appServer = express();
  appServer.use(express.json({ limit: '32kb' }));

  appServer.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  appServer.get('/api/public-config', (_req, res) => {
    res.json({
      ok: true,
      tokenRequired: Boolean(remoteControlConfig.token),
    });
  });

  appServer.get('/api/state', (req, res) => {
    if (!isRemoteAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    touchRemoteClient(req, false);
    res.json({ ok: true, state: remoteRuntimeState, version: app.getVersion() });
  });

  appServer.get('/api/events', (req, res) => {
    if (!isRemoteAuthorized(req)) {
      res.status(401).end();
      return;
    }
    touchRemoteClient(req, false);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    remoteSSEClients.add(res);
    const payload = JSON.stringify({ state: remoteRuntimeState, ts: Date.now() });
    res.write(`event: state\n`);
    res.write(`data: ${payload}\n\n`);

    req.on('close', () => {
      remoteSSEClients.delete(res);
    });
  });

  appServer.post('/api/action', (req, res) => {
    if (!isRemoteAuthorized(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    if (isRemoteRateLimited(req)) {
      res.status(429).json({ ok: false, error: 'Too many requests. Slow down.' });
      return;
    }
    touchRemoteClient(req, true);

    const type = String(req.body?.type || '').trim();
    const payload = req.body?.payload ?? {};
    const allowed = new Set([
      'goLive',
      'clearLive',
      'nextVerse',
      'prevVerse',
      'queuePreview',
      'sendNextQueuedLive',
      'setPreviewReference',
      'setModeAuto',
      'setModeManual',
      'toggleAutoPause',
    ]);
    if (!allowed.has(type)) {
      res.status(400).json({ ok: false, error: 'Unknown action type' });
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      res.status(503).json({ ok: false, error: 'Main window unavailable' });
      return;
    }
    mainWindow.webContents.send('remote-command', { type, payload });
    broadcastRemoteState();
    res.json({ ok: true });
  });

  appServer.get('/', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(buildRemoteControlPage());
  });

  await new Promise<void>((resolve, reject) => {
    const server = appServer.listen(remoteControlConfig.port, '0.0.0.0', () => {
      remoteControlServer = server;
      remoteControlApp = appServer;
      remoteControlError = null;
      console.log(`[Remote] Listening on port ${remoteControlConfig.port}`);
      resolve();
    });
    server.once('error', (err) => {
      reject(err);
    });
  });
}

async function configureRemoteControl(nextConfig: Partial<RemoteControlConfig>) {
  const normalized: RemoteControlConfig = {
    enabled: Boolean(nextConfig.enabled),
    port: Math.min(65535, Math.max(1024, Number(nextConfig.port) || 4217)),
    token: String(nextConfig.token ?? '').trim(),
  };
  const changedPort = normalized.port !== remoteControlConfig.port;
  const changedEnabled = normalized.enabled !== remoteControlConfig.enabled;
  const changedToken = normalized.token !== remoteControlConfig.token;

  remoteControlConfig = normalized;

  try {
    if (!normalized.enabled) {
      await stopRemoteControlServer();
      return { ok: true, ...buildRemoteStatus() };
    }

    if (!remoteControlServer || changedPort || changedEnabled) {
      await stopRemoteControlServer();
      await startRemoteControlServer();
    } else if (changedToken) {
      // Token is read dynamically per request; no restart required.
    }

    return { ok: true, ...buildRemoteStatus() };
  } catch (err: any) {
    remoteControlError = err?.message ?? String(err);
    console.error(`[Remote] Failed to configure server: ${remoteControlError}`);
    await stopRemoteControlServer();
    return { ok: false, ...buildRemoteStatus() };
  }
}

// ── NDI state ─────────────────────────────────────────────────────
// NDI uses an offscreen BrowserWindow that renders scripture via live.html
// and feeds paint-event BGRA frames directly into the NDI SDK.
// No visible window or capturePage polling needed.

const NDI_LEGACY_WINDOW_ID = '__ndi__'; // legacy alias for older renderer routes
const NDI_WINDOW_PREFIX = '__ndi__:';
const NDI_LEGACY_TARGET_ID = '__legacy__';

type NDIStatus = {
  status: 'active' | 'stopped' | 'unavailable' | 'error';
  reason?: string;
  error?: string;
  sourceName?: string;
  targetId?: string;
  activeCount?: number;
};

type NDISession = {
  targetId: string;
  windowId: string;
  sourceName: string;
  sender: any;
  repaintTimer: ReturnType<typeof setInterval> | null;
  startedAt: number;
  frameCount: number;
  frameErrors: number;
  lastFrameAt: number | null;
  rollingFps: number;
};

type NDIDiagnosticsRow = {
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
};

const ndiSessions = new Map<string, NDISession>();
let ndiGrandiose: any = null;      // cached after first successful load
let ndiLoadError: string | null = null;  // last error from require('grandiose')

// Known NDI Runtime install locations on Windows.
// The packaged app may not inherit the user's PATH, so we prepend these
// directories before attempting to load grandiose so Windows can resolve
// Processing.NDI.Lib.x64.dll even if it isn't in the process PATH.
// IMPORTANT: NDI 6 Tools paths must come first — grandiose bundles a
// stale NDI v3 DLL that uses an incompatible discovery protocol. By
// injecting the NDI 6 Tools runtime directory into PATH before requiring
// grandiose, Windows finds the v6 DLL from PATH (after the CI build step
// has removed the bundled v3 DLL from grandiose's build/Release/ dir).
const NDI_RUNTIME_PATHS = [
  'C:\\Program Files\\NDI\\NDI 6 Tools\\Runtime',
  'C:\\Program Files\\NDI\\NDI 6 Tools\\Router',
  'C:\\Program Files\\NDI\\NDI 6 Runtime\\v6',
  'C:\\Program Files\\NDI\\NDI 6 Runtime',
  'C:\\Program Files\\NDI\\NDI 5 Runtime',
  'C:\\Program Files\\NewTek\\NewTek NDI Tools',
  'C:\\Program Files\\NewTek\\NDI 4 Runtime\\v4.6',
];

let ndiRuntimeDiagnosticsLogged = false;

function getGrandioseRootDir(): string {
  if (isDev) {
    return path.join(process.cwd(), 'node_modules', 'grandiose');
  }
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'grandiose');
}

function getGrandioseReleaseDir(): string {
  return path.join(getGrandioseRootDir(), 'build', 'Release');
}

function getGrandioseDllTargets(): string[] {
  const root = getGrandioseRootDir();
  return [
    path.join(root, 'build', 'Release', 'Processing.NDI.Lib.x64.dll'),
    path.join(root, 'lib', 'win_x64', 'Processing.NDI.Lib.x64.dll'),
  ];
}

function getGrandioseNodeCandidates(): string[] {
  const root = getGrandioseRootDir();
  const candidates = [
    path.join(root, 'build', 'Release', 'grandiose.node'),
  ];

  const binRoot = path.join(root, 'bin');
  try {
    if (fs.existsSync(binRoot)) {
      for (const entry of fs.readdirSync(binRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.toLowerCase().startsWith('win32-x64')) continue;
        candidates.push(path.join(binRoot, entry.name, 'grandiose.node'));
      }
    }
  } catch {
    // ignore candidate enumeration errors
  }

  return [...new Set(candidates)];
}

function getStagedNDIRuntimeDir(): string {
  try {
    return path.join(app.getPath('userData'), 'ndi-native');
  } catch {
    return path.join(os.tmpdir(), 'scriptureflow-ndi-native');
  }
}

function findInstalledNDIRuntimeDll(): string | null {
  for (const runtimeDir of NDI_RUNTIME_PATHS) {
    const candidate = path.join(runtimeDir, 'Processing.NDI.Lib.x64.dll');
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function syncBundledDllWithRuntime(runtimeDll?: string | null): void {
  if (!runtimeDll) return;

  for (const target of getGrandioseDllTargets()) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(runtimeDll, target);
      console.log(`[NDI] Synced runtime DLL to ${target}`);
    } catch (err: any) {
      console.warn(`[NDI] Could not sync runtime DLL to ${target}: ${err?.message ?? String(err)}`);
    }
  }
}

function stageRuntimeDll(runtimeDll: string): string | null {
  const stageDir = getStagedNDIRuntimeDir();
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    const stagedDll = path.join(stageDir, 'Processing.NDI.Lib.x64.dll');
    fs.copyFileSync(runtimeDll, stagedDll);
    return stageDir;
  } catch (err: any) {
    console.warn(`[NDI] Could not stage runtime DLL in userData: ${err?.message ?? String(err)}`);
    return null;
  }
}

function stageGrandioseNode(runtimeDll?: string | null): string | null {
  const sourceNode = getGrandioseNodeCandidates().find((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  if (!sourceNode) return null;

  const stageDir = getStagedNDIRuntimeDir();
  const stagedNode = path.join(stageDir, 'grandiose.node');
  try {
    fs.mkdirSync(stageDir, { recursive: true });
    fs.copyFileSync(sourceNode, stagedNode);
    if (runtimeDll) {
      fs.copyFileSync(runtimeDll, path.join(stageDir, 'Processing.NDI.Lib.x64.dll'));
    }
    return stagedNode;
  } catch (err: any) {
    console.warn(`[NDI] Could not stage grandiose.node in userData: ${err?.message ?? String(err)}`);
    return null;
  }
}

function wrapGrandioseAddon(addon: any): any {
  const wrappedFind = (...args: any[]) => {
    if (!addon || typeof addon.find !== 'function') return [];
    if (args.length === 0) return addon.find();

    const first = args[0];
    if (first && typeof first === 'object') {
      const normalized = { ...first };
      if (Array.isArray(normalized.groups)) {
        normalized.groups = normalized.groups.join(',');
      }
      if (Array.isArray(normalized.extraIPs)) {
        normalized.extraIPs = normalized.extraIPs.join(',');
      }
      return addon.find(normalized);
    }

    return addon.find(...args);
  };

  return {
    version: addon?.version,
    find: wrappedFind,
    isSupportedCPU: addon?.isSupportedCPU,
    receive: addon?.receive,
    send: addon?.send,
    FOURCC_BGRA: addon?.FOURCC_BGRA,
    SEND_TIMECODE_SYNTHESIZE: addon?.SEND_TIMECODE_SYNTHESIZE,
  };
}

function tryLoadGrandioseFromNodePath(nodePath: string): { mod: any | null; error?: string } {
  try {
    const addon = require(nodePath);
    if (!addon || typeof addon.send !== 'function') {
      return { mod: null, error: `Native addon loaded but send() export is missing (${nodePath})` };
    }
    console.log(`[NDI] Loaded native grandiose addon directly from ${nodePath}`);
    return { mod: wrapGrandioseAddon(addon) };
  } catch (err: any) {
    return { mod: null, error: `${nodePath}: ${err?.message ?? String(err)}` };
  }
}

function logNDIDllDiagnostics(): void {
  if (ndiRuntimeDiagnosticsLogged) return;
  ndiRuntimeDiagnosticsLogged = true;

  const found = getGrandioseDllTargets().filter((dllPath) => {
    try { return fs.existsSync(dllPath); } catch { return false; }
  });
  if (found.length > 0) {
    console.log(`[NDI] grandiose DLL lookup paths present: ${found.join(', ')}`);
  } else {
    console.log('[NDI] grandiose DLL lookup paths currently missing (runtime PATH fallback expected).');
  }
}

function injectNDIRuntimePaths(extraDirs: string[] = []): void {
  const existing = process.env.PATH ?? '';
  const runtimeDirs = [...extraDirs, ...NDI_RUNTIME_PATHS];
  const toAdd = runtimeDirs
    .filter(p => {
      try { return fs.existsSync(p); } catch { return false; }
    })
    .filter(p => !existing.includes(p));

  if (toAdd.length > 0) {
    process.env.PATH = toAdd.join(';') + ';' + existing;
    console.log(`[NDI] Injected runtime paths: ${toAdd.join(', ')}`);
  }
}

function loadGrandiose(): any {
  if (ndiGrandiose) return ndiGrandiose;
  const runtimeDll = findInstalledNDIRuntimeDll();
  const stagedRuntimeDir = runtimeDll ? stageRuntimeDll(runtimeDll) : null;
  const extraPathDirs = stagedRuntimeDir ? [stagedRuntimeDir] : [];
  // Ensure NDI Runtime DLLs are findable before the first require()
  injectNDIRuntimePaths(extraPathDirs);
  syncBundledDllWithRuntime(runtimeDll);
  logNDIDllDiagnostics();
  const loadErrors: string[] = [];
  try {
    ndiGrandiose = require('grandiose');
    ndiLoadError = null;
    console.log('[NDI] grandiose loaded successfully');
    return ndiGrandiose;
  } catch (err: any) {
    const initialErr = err?.message ?? String(err);
    loadErrors.push(`require('grandiose'): ${initialErr}`);
    console.warn(`[NDI] require('grandiose') failed: ${initialErr}`);
  }

  const stagedNode = stageGrandioseNode(runtimeDll);
  const directCandidates = [
    ...(stagedNode ? [stagedNode] : []),
    ...getGrandioseNodeCandidates(),
  ];
  for (const candidate of [...new Set(directCandidates)]) {
    try {
      if (!fs.existsSync(candidate)) continue;
    } catch {
      continue;
    }

    const loaded = tryLoadGrandioseFromNodePath(candidate);
    if (loaded.mod) {
      ndiGrandiose = loaded.mod;
      ndiLoadError = null;
      console.log('[NDI] grandiose direct native load succeeded');
      return ndiGrandiose;
    }
    if (loaded.error) loadErrors.push(loaded.error);
  }

  ndiLoadError = loadErrors.join(' | ');
  console.error(`[NDI] grandiose failed to load: ${ndiLoadError}`);
  return null;
}

function hasExistingPath(p: string): boolean {
  try { return fs.existsSync(p); } catch { return false; }
}

/** Human-readable explanation of why NDI is unavailable. */
function ndiUnavailableReason(): string {
  const msg = ndiLoadError ?? '';
  if (msg.includes('Processing.NDI') || msg.includes('.dll') || msg.includes('DLL')) {
    return `NDI runtime DLL could not be loaded (${msg}). Reinstall NDI 6 Tools and restart ScriptureFlow.`;
  }
  if (msg.includes('NODE_MODULE_VERSION') || msg.includes('was compiled against a different')) {
    return 'grandiose native module is ABI-mismatched for this Electron build. Rebuild with: npm run setup-ndi';
  }
  if (msg.includes('Cannot find module') || msg.includes('grandiose')) {
    return 'grandiose native module not found. Reinstall dependencies and run: npm run setup-ndi';
  }
  return msg ? `grandiose failed to load: ${msg}` : 'grandiose native module unavailable';
}

/**
 * Start NDI output.
 * Creates an invisible offscreen BrowserWindow that renders the live scripture
 * page. Every time the renderer paints a frame, the raw BGRA pixels are sent
 * straight to the NDI SDK sender — no polling, no capturePage overhead.
 */
function normalizeNDITargetId(targetId?: string): string {
  if (typeof targetId !== 'string') return NDI_LEGACY_TARGET_ID;
  const trimmed = targetId.trim();
  return trimmed.length > 0 ? trimmed : NDI_LEGACY_TARGET_ID;
}

function getNDIWindowId(targetId?: string): string {
  return `${NDI_WINDOW_PREFIX}${normalizeNDITargetId(targetId)}`;
}

function isNDIWindowId(windowId: string): boolean {
  return windowId === NDI_LEGACY_WINDOW_ID || windowId.startsWith(NDI_WINDOW_PREFIX);
}

function destroyNDISession(session: NDISession): void {
  if (session.repaintTimer) {
    clearInterval(session.repaintTimer);
    session.repaintTimer = null;
  }

  if (session.sender) {
    try { session.sender.destroy?.(); } catch { /* ignore */ }
    session.sender = null;
  }

  const offscreenWin = liveWindows.get(session.windowId);
  if (offscreenWin && !offscreenWin.isDestroyed()) {
    try { offscreenWin.destroy(); } catch { /* ignore */ }
  }

  liveWindows.delete(session.windowId);
  if (ndiSessions.get(session.targetId) === session) {
    ndiSessions.delete(session.targetId);
  }
}

function stopAllNDI(notify = true): void {
  const sessions = Array.from(ndiSessions.values());
  for (const session of sessions) {
    const stoppedTargetId = session.targetId;
    destroyNDISession(session);
    if (notify) {
      mainWindow?.webContents.send('ndi-status-changed', {
        status: 'stopped',
        targetId: stoppedTargetId,
        activeCount: ndiSessions.size,
      } satisfies NDIStatus);
    }
  }
}

function startNDI(sourceName: string, targetId?: string): { ok: boolean; error?: string; targetId: string } {
  const resolvedTargetId = normalizeNDITargetId(targetId);
  stopNDI(resolvedTargetId, false);

  const grandiose = loadGrandiose();
  if (!grandiose) {
    return { ok: false, error: ndiUnavailableReason(), targetId: resolvedTargetId };
  }

  let sender: any = null;
  try {
    sender = grandiose.send({ name: sourceName, clockVideo: true, clockAudio: false });
  } catch (err: any) {
    sender = null;
    return {
      ok: false,
      error: `NDI SDK error: ${err.message}. Make sure NDI Runtime is installed from ndi.video`,
      targetId: resolvedTargetId,
    };
  }

  const windowId = getNDIWindowId(resolvedTargetId);
  const sessionState: NDISession = {
    targetId: resolvedTargetId,
    windowId,
    sourceName,
    sender,
    repaintTimer: null,
    startedAt: Date.now(),
    frameCount: 0,
    frameErrors: 0,
    lastFrameAt: null,
    rollingFps: 0,
  };

  const offscreenWin = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  liveWindows.set(windowId, offscreenWin);
  ndiSessions.set(resolvedTargetId, sessionState);

  offscreenWin.webContents.setFrameRate(30);
  offscreenWin.webContents.on('paint', (_event, _dirty, image) => {
    if (!sessionState.sender) return;
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;
    const frameData = image.toBitmap();
    const now = Date.now();
    if (sessionState.lastFrameAt) {
      const delta = now - sessionState.lastFrameAt;
      if (delta > 0) {
        const instant = 1000 / delta;
        sessionState.rollingFps = sessionState.rollingFps === 0
          ? instant
          : (sessionState.rollingFps * 0.85) + (instant * 0.15);
      }
    }
    sessionState.lastFrameAt = now;
    try {
      sessionState.sender.video({
        xres: size.width,
        yres: size.height,
        frameRateN: 30 * 1000,
        frameRateD: 1000,
        fourCC: grandiose.FOURCC_BGRA ?? 'BGRA',
        lineStrideBytes: size.width * 4,
        data: frameData,
        timecode: grandiose.SEND_TIMECODE_SYNTHESIZE ?? BigInt(0),
      });
      sessionState.frameCount += 1;
    } catch {
      sessionState.frameErrors += 1;
      /* ignore individual frame errors */
    }
  });

  offscreenWin.webContents.startPainting();
  sessionState.repaintTimer = setInterval(() => {
    const win = liveWindows.get(windowId);
    if (win && !win.isDestroyed()) win.webContents.invalidate();
  }, 1000);

  offscreenWin.on('closed', () => {
    liveWindows.delete(windowId);
    const current = ndiSessions.get(resolvedTargetId);
    if (current === sessionState) {
      if (current.repaintTimer) {
        clearInterval(current.repaintTimer);
        current.repaintTimer = null;
      }
      ndiSessions.delete(resolvedTargetId);
    }
  });

  const url = isDev
    ? `${DEV_SERVER_URL}/live.html`
    : `file://${path.join(__dirname, '../dist/live.html')}`;

  offscreenWin.loadURL(url).catch((err: any) => {
    console.error('[NDI] Renderer load failed:', err.message);
  });

  setTimeout(() => {
    try {
      grandiose.find({ showLocalSources: true, wait: 5000 }).then((sources: any[]) => {
        console.log(`[NDI] Visible sources (${sources.length}):`, sources.map((s: any) => s.name));
        if (!sources.some((s: any) => s.name && s.name.toLowerCase().includes('scriptureflow'))) {
          console.warn(`[NDI] ${sourceName} (target: ${resolvedTargetId}) not in discovery list - check Windows Firewall and network profile (must be Private, not Public)`);
        }
      }).catch(() => {});
    } catch { /* grandiose.find may not exist in all versions */ }
  }, 3000);

  return { ok: true, targetId: resolvedTargetId };
}

function stopNDI(targetId?: string, notify = true): void {
  const resolvedTargetId = normalizeNDITargetId(targetId);
  const session = ndiSessions.get(resolvedTargetId);
  if (session) {
    destroyNDISession(session);
  }

  if (notify) {
    mainWindow?.webContents.send('ndi-status-changed', {
      status: 'stopped',
      targetId: resolvedTargetId,
      activeCount: ndiSessions.size,
    } satisfies NDIStatus);
  }
}

function getNDIStatus(targetId?: string): NDIStatus {
  if (!loadGrandiose()) return { status: 'unavailable', reason: ndiUnavailableReason() };

  if (typeof targetId === 'string' && targetId.trim().length > 0) {
    const resolvedTargetId = normalizeNDITargetId(targetId);
    const session = ndiSessions.get(resolvedTargetId);
    if (session) {
      return {
        status: 'active',
        targetId: resolvedTargetId,
        sourceName: session.sourceName,
        activeCount: ndiSessions.size,
      };
    }
    return {
      status: 'stopped',
      targetId: resolvedTargetId,
      activeCount: ndiSessions.size,
    };
  }

  const firstSession = ndiSessions.values().next().value as NDISession | undefined;
  if (firstSession) {
    return {
      status: 'active',
      targetId: firstSession.targetId,
      sourceName: firstSession.sourceName,
      activeCount: ndiSessions.size,
    };
  }

  return { status: 'stopped', activeCount: 0 };
}

function getNDIDiagnostics(targetId?: string): {
  rows: NDIDiagnosticsRow[];
  summary: {
    activeCount: number;
    runtimeDetected: boolean;
    runtimePath?: string;
    loadError?: string;
    nodeTargets: string[];
    dllTargets: string[];
    checkedAt: number;
  };
} {
  const runtimePath = findInstalledNDIRuntimeDll() ?? undefined;
  const runtimeDetected = Boolean(runtimePath);
  const loadError = ndiLoadError ?? undefined;
  const nodeTargets = getGrandioseNodeCandidates().filter((candidate) => {
    try { return fs.existsSync(candidate); } catch { return false; }
  });
  const stagedNode = path.join(getStagedNDIRuntimeDir(), 'grandiose.node');
  if (hasExistingPath(stagedNode) && !nodeTargets.includes(stagedNode)) {
    nodeTargets.unshift(stagedNode);
  }
  const dllTargets = getGrandioseDllTargets().filter((candidate) => hasExistingPath(candidate));
  const rows = Array.from(ndiSessions.values())
    .filter((session) => {
      if (!targetId || !targetId.trim()) return true;
      return session.targetId === normalizeNDITargetId(targetId);
    })
    .map((session) => {
      const uptimeMs = Date.now() - session.startedAt;
      return {
        targetId: session.targetId,
        sourceName: session.sourceName,
        active: true,
        startedAt: session.startedAt,
        uptimeMs,
        frameCount: session.frameCount,
        frameErrors: session.frameErrors,
        fps: Math.max(0, Number(session.rollingFps.toFixed(2))),
        lastFrameAt: session.lastFrameAt,
        runtimeDetected,
        runtimePath,
      } satisfies NDIDiagnosticsRow;
    });

  return {
    rows,
    summary: {
      activeCount: rows.length,
      runtimeDetected,
      runtimePath,
      loadError,
      nodeTargets,
      dllTargets,
      checkedAt: Date.now(),
    },
  };
}

// ── Window helpers ─────────────────────────────────────────────────

function createMainWindow() {
  const iconPath = isDev
    ? path.join(process.cwd(), 'public/favicon.ico')
    : path.join(__dirname, '../dist/favicon.ico');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    const loadDevUrl = async () => {
      console.log(`[Electron] Loading renderer from dev server: ${DEV_SERVER_URL}`);
      try {
        await mainWindow!.loadURL(DEV_SERVER_URL);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        console.error(`[Electron] Failed to load dev server URL ${DEV_SERVER_URL}: ${msg}`);
        const html = `
          <html>
            <body style="font-family:Segoe UI,Arial,sans-serif;background:#111;color:#f5f5f5;padding:24px;line-height:1.5">
              <h2 style="margin:0 0 12px 0">Renderer failed to load</h2>
              <p style="margin:0 0 8px 0">Could not reach Vite dev server at <code>${DEV_SERVER_URL}</code>.</p>
              <p style="margin:0 0 8px 0">Start it with <code>npm run dev</code> or use <code>npm run electron:dev</code>.</p>
              <p style="margin:0">Error: <code>${msg}</code></p>
            </body>
          </html>
        `;
        await mainWindow!.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
      }
    };
    void loadDevUrl();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopAllNDI(false);
    void stopRemoteControlServer();
    closeRealtimeWs();
    closeDeepgramWs();
    liveWindows.forEach(win => { try { win.close(); } catch { /* ignore */ } });
    liveWindows.clear();
  });
}

function createLiveWindow(windowId: string = 'main', displayId?: string) {
  if (liveWindows.has(windowId)) {
    liveWindows.get(windowId)!.focus();
    return;
  }

  let targetDisplay = screen.getPrimaryDisplay();
  if (displayId) {
    const displays = screen.getAllDisplays();
    const found = displays.find(d => d.id.toString() === displayId);
    if (found) targetDisplay = found;
  }

  const win = new BrowserWindow({
    x: targetDisplay.bounds.x + 50,
    y: targetDisplay.bounds.y + 50,
    width: 1280,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: `ScriptureFlow Live Output${windowId !== 'main' ? ` (${windowId})` : ''}`,
    backgroundColor: '#000000',
  });

  if (isDev) {
    win.loadURL(`${DEV_SERVER_URL}/live.html`);
  } else {
    win.loadFile(path.join(__dirname, '../dist/live.html'));
  }

  liveWindows.set(windowId, win);

  win.on('closed', () => {
    liveWindows.delete(windowId);
    mainWindow?.webContents.send('live-window-status-changed', { windowId, status: 'closed' });
  });

  win.on('moved', () => {
    if (mainWindow && liveWindows.has(windowId)) {
      mainWindow.webContents.send('live-window-status-changed', { windowId, status: 'moved' });
      mainWindow.webContents.send('live-window-bounds-changed', { windowId, bounds: win.getBounds() });
    }
  });

  win.on('resized', () => {
    if (mainWindow && liveWindows.has(windowId)) {
      mainWindow.webContents.send('live-window-bounds-changed', { windowId, bounds: win.getBounds() });
    }
  });

  mainWindow?.webContents.send('live-window-status-changed', { windowId, status: 'open' });
  mainWindow?.webContents.send('live-window-bounds-changed', { windowId, bounds: win.getBounds() });
}

function notifyDisplaysChanged() {
  if (mainWindow) {
    const displays = screen.getAllDisplays().map(d => ({
      id: d.id.toString(),
      name: `Display ${d.id} (${d.bounds.width}x${d.bounds.height})`,
      isPrimary: d.id === screen.getPrimaryDisplay().id,
    }));
    mainWindow.webContents.send('displays-changed', displays);
  }
}

// ── Auto-updater ───────────────────────────────────────────────────

let updateDownloaded = false;     // true once a release is ready to install
let checkingManually  = false;    // true while the user triggered the check

function setupAutoUpdater() {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    console.log(`[Updater] Update available: ${info.version}`);
    if (checkingManually) {
      checkingManually = false;
      dialog.showMessageBox({
        type: 'info',
        title: 'Update Available',
        message: `ScriptureFlow ${info.version} is available`,
        detail: 'Downloading in the background. You will be notified when it is ready to install.',
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Already up to date.');
    if (checkingManually) {
      checkingManually = false;
      dialog.showMessageBox({
        type: 'info',
        title: 'No Updates',
        message: 'You are up to date!',
        detail: `ScriptureFlow ${app.getVersion()} is the latest version.`,
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[Updater] Update downloaded: ${info.version}`);
    updateDownloaded = true;
    // Update the menu so "Check for Updates" becomes "Restart to Install"
    buildAppMenu();
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `ScriptureFlow ${info.version} has been downloaded`,
      detail: 'Restart now to install the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall(false, true);
    });
  });

  autoUpdater.on('error', (err) => {
    console.error(`[Updater] Error: ${err.message}`);
    if (checkingManually) {
      checkingManually = false;
      dialog.showMessageBox({
        type: 'error',
        title: 'Update Check Failed',
        message: 'Could not check for updates.',
        detail: err.message,
        buttons: ['OK'],
      });
    }
  });

  // Silent check 5 s after startup, then every 4 hours
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5_000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1_000);
}

// ── Application menu ───────────────────────────────────────────────

function buildAppMenu() {
  const helpSubmenu: Electron.MenuItemConstructorOptions[] = updateDownloaded
    ? [
        {
          label: 'Restart to Install Update',
          click: () => autoUpdater.quitAndInstall(false, true),
        },
      ]
    : [
        {
          label: 'Check for Updates...',
          click: async () => {
            if (isDev) {
              dialog.showMessageBox({
                type: 'info',
                title: 'Development Mode',
                message: 'Update checking is disabled in development mode.',
                buttons: ['OK'],
              });
              return;
            }
            checkingManually = true;
            try {
              await autoUpdater.checkForUpdates();
            } catch (err: any) {
              checkingManually = false;
              dialog.showMessageBox({
                type: 'error',
                title: 'Update Check Failed',
                message: 'Could not reach the update server.',
                detail: err.message,
                buttons: ['OK'],
              });
            }
          },
        },
      ];

  helpSubmenu.push(
    { type: 'separator' },
    {
      label: 'About ScriptureFlow',
      click: () => {
        dialog.showMessageBox({
          type: 'info',
          title: 'About ScriptureFlow',
          message: 'ScriptureFlow',
          detail: `Version ${app.getVersion()}\n\nAI-powered worship display that listens to your preacher and puts scripture on screen automatically.`,
          buttons: ['OK'],
        });
      },
    },
  );

  const menu = Menu.buildFromTemplate([
    { role: 'fileMenu'   as const },
    { role: 'editMenu'   as const },
    { role: 'viewMenu'   as const },
    { role: 'windowMenu' as const },
    { label: 'Help', submenu: helpSubmenu },
  ]);
  Menu.setApplicationMenu(menu);
}

// ── App lifecycle ──────────────────────────────────────────────────

app.whenReady().then(() => {
  // ── Grant microphone (and camera) access to all renderer windows ──────────
  // Without this handler Electron 36+ silently denies getUserMedia, which breaks
  // the Browser Speech Recognition and Gemini Live Audio transcription providers.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'audioCapture', 'microphone', 'speech'].includes(permission);
    callback(allowed);
  });

  // ── Register WebSocket bridge IPC handlers BEFORE opening any window ─────
  // Guarantees channels are ready before any preload/renderer can invoke them.
  registerRealtimeHandlers();
  registerDeepgramHandlers();
  buildAppMenu();
  setupAutoUpdater();

  createMainWindow();
  // Live window is opened on demand when the user clicks "Open Window" in Settings.
  // Do NOT auto-open here — it should only appear after the user explicitly requests it.

  screen.on('display-added', notifyDisplaysChanged);
  screen.on('display-removed', notifyDisplaysChanged);
  screen.on('display-metrics-changed', notifyDisplaysChanged);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopAllNDI(false);
  void stopRemoteControlServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── IPC: Live window ───────────────────────────────────────────────

ipcMain.on('send-to-live', (event, { windowId = 'main', data }: { windowId?: string; data: any }) => {
  let resolvedWindowId = windowId;
  if (windowId === NDI_LEGACY_WINDOW_ID) {
    resolvedWindowId = getNDIWindowId();
    if (!liveWindows.has(resolvedWindowId)) {
      const firstSession = ndiSessions.values().next().value as NDISession | undefined;
      if (firstSession) resolvedWindowId = firstSession.windowId;
    }
  }

  const win = liveWindows.get(resolvedWindowId);
  if (!win || win.isDestroyed()) return;
  if (isNDIWindowId(resolvedWindowId)) {
    // NDI offscreen window has no preload — push data via executeJavaScript
    win.webContents.executeJavaScript(
      `window.__ndiUpdate && window.__ndiUpdate(${JSON.stringify(data)})`
    ).catch(() => {});
  } else {
    win.webContents.send('update-live', data);
  }
});

ipcMain.on('send-theme-to-live', (event, theme, layout) => {
  liveWindows.forEach(win => win.webContents.send('update-theme', theme, layout));
});

ipcMain.handle('get-displays', () => {
  const displays = screen.getAllDisplays();
  return displays.map(d => ({
    id: d.id.toString(),
    name: `Display ${d.id} (${d.bounds.width}x${d.bounds.height})`,
    isPrimary: d.id === screen.getPrimaryDisplay().id,
  }));
});

ipcMain.handle('remote-control-configure', async (_event, config: Partial<RemoteControlConfig>) => {
  return configureRemoteControl(config);
});

ipcMain.handle('remote-control-status', () => {
  return buildRemoteStatus();
});

ipcMain.on('remote-control-state-sync', (_event, payload: Partial<RemoteRuntimeState>) => {
  remoteRuntimeState = {
    ...remoteRuntimeState,
    ...payload,
    updatedAt: Date.now(),
  };
  broadcastRemoteState();
});

ipcMain.on('open-live-window', (event, { windowId = 'main', displayId }: { windowId?: string; displayId?: string }) => {
  createLiveWindow(windowId, displayId);
});

ipcMain.on('close-live-window', (event, windowId: string = 'main') => {
  liveWindows.get(windowId)?.close();
});

ipcMain.on('move-live-window', (event, { windowId = 'main', displayId }: { windowId?: string; displayId: string }) => {
  const win = liveWindows.get(windowId);
  if (!win) {
    createLiveWindow(windowId, displayId);
    return;
  }

  const displays = screen.getAllDisplays();
  const targetDisplay = displays.find(d => d.id.toString() === displayId);
  if (targetDisplay) {
    win.setBounds({
      x: targetDisplay.bounds.x + 50,
      y: targetDisplay.bounds.y + 50,
      width: 1280,
      height: 720,
    });
    mainWindow?.webContents.send('live-window-status-changed', { windowId, status: 'moved' });
  }
});

// ── IPC: NDI ───────────────────────────────────────────────────────

ipcMain.handle('ndi-start', (_event, { sourceName, targetId }: { sourceName: string; targetId?: string }) => {
  const result = startNDI(sourceName, targetId);
  mainWindow?.webContents.send('ndi-status-changed', {
    status: result.ok ? 'active' : 'error',
    targetId: result.targetId,
    sourceName: result.ok ? sourceName : undefined,
    error: result.error,
    activeCount: ndiSessions.size,
  });
  return result;
});

ipcMain.on('ndi-stop', (_event, payload?: { targetId?: string }) => {
  stopNDI(payload?.targetId, true);
});

ipcMain.on('open-external', (_event, url: string) => {
  if (typeof url !== 'string') return;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const isHttps = parsed.protocol === 'https:';
    const isPrivate172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        isPrivate172
      );

    if (isHttps || isLocalHttp) {
      shell.openExternal(parsed.toString());
    }
  } catch {
    // ignore invalid URLs
  }
});

// ── IPC: OpenAI Realtime WebSocket bridge ──────────────────────────────────────
// Handlers are registered inside registerRealtimeHandlers() which is called from
// app.whenReady() BEFORE createMainWindow().  This guarantees registration is
// complete before any preload/renderer can invoke the channel.
// ipcMain.removeHandler() guards prevent "already registered" throws on any
// accidental second call (e.g. hot-reload scenarios in dev).

function registerRealtimeHandlers(): void {
  console.log('[Main] Registering Realtime IPC handlers…');

  // Guard: remove any stale handler from a previous registration attempt.
  ipcMain.removeHandler('realtime-connect');

  ipcMain.handle('realtime-connect', (event, { url, apiKey }: { url: string; apiKey: string }) => {
    console.log('[Main] realtime-connect handler invoked');
    closeRealtimeWs();

    // Lazy-load ws — safe even if the package is temporarily missing
    const { WS, error: wsLoadError } = loadWsClass();
    if (!WS) {
      return { ok: false, error: wsLoadError };
    }

    const hasKey = typeof apiKey === 'string' && apiKey.length > 0;
    console.log(`[RealtimeWS] key present: ${hasKey}${hasKey ? `, prefix: ${apiKey.slice(0, 7)}…` : ''}`);

    if (!hasKey) {
      console.error('[RealtimeWS] Aborted — no API key provided.');
      return { ok: false, error: 'No OpenAI API key configured. Enter your key in Settings → Audio & Transcription.' };
    }

    realtimeWsOwner = event.sender;

    try {
      realtimeWs = new WS(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1',
        },
      });
      console.log('[RealtimeWS] WebSocket created, waiting for open…');
    } catch (err: any) {
      console.error(`[RealtimeWS] Failed to create WebSocket: ${err.message}`);
      realtimeWsOwner = null;
      return { ok: false, error: err.message };
    }

    realtimeWs.on('open', () => {
      console.log('[RealtimeWS] Connection opened');
      if (realtimeWsOwner && !realtimeWsOwner.isDestroyed()) {
        realtimeWsOwner.send('realtime-open');
      }
    });

    realtimeWs.on('message', (data: any) => {
      if (realtimeWsOwner && !realtimeWsOwner.isDestroyed()) {
        realtimeWsOwner.send('realtime-message', data.toString());
      }
    });

    realtimeWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[RealtimeWS] Closed — code: ${code}, reason: ${reason.toString() || '(none)'}`);
      realtimeWs = null;
      if (realtimeWsOwner && !realtimeWsOwner.isDestroyed()) {
        realtimeWsOwner.send('realtime-close', code, reason.toString());
      }
      realtimeWsOwner = null;
    });

    realtimeWs.on('error', (err: Error) => {
      console.error(`[RealtimeWS] Socket error: ${err.message}`);
      if (realtimeWsOwner && !realtimeWsOwner.isDestroyed()) {
        realtimeWsOwner.send('realtime-error', err.message);
      }
    });

    return { ok: true };
  });

  // fire-and-forget: no removeHandler needed for ipcMain.on (no duplicate-throw risk)
  ipcMain.on('realtime-send', (_event, data: string) => {
    if (realtimeWs && realtimeWs.readyState === 1 /* OPEN */) {
      try { realtimeWs.send(data); } catch (err: any) {
        console.error(`[RealtimeWS] Send failed: ${err.message}`);
      }
    }
  });

  ipcMain.on('realtime-disconnect', () => {
    console.log('[RealtimeWS] Disconnect requested by renderer');
    closeRealtimeWs();
  });

  console.log('[Main] Realtime IPC handlers registered ✓');
}

ipcMain.handle('ndi-get-status', (_event, payload?: { targetId?: string }) => {
  return getNDIStatus(payload?.targetId);
});

ipcMain.handle('ndi-get-diagnostics', (_event, payload?: { targetId?: string }) => {
  return getNDIDiagnostics(payload?.targetId);
});

// ── IPC: Deepgram WebSocket bridge ─────────────────────────────────────────────
// Deepgram streaming API requires  Authorization: Token <key>  — a custom header
// that the renderer-side browser WebSocket API cannot set.  The main process owns
// the socket (using the `ws` package) and forwards binary audio frames and JSON
// control messages in both directions via IPC.

function registerDeepgramHandlers(): void {
  console.log('[Main] Registering Deepgram IPC handlers…');

  ipcMain.removeHandler('deepgram-connect');

  ipcMain.handle('deepgram-connect', (event, { url, apiKey }: { url: string; apiKey: string }) => {
    closeDeepgramWs();

    const { WS, error: wsLoadError } = loadWsClass();
    if (!WS) return { ok: false, error: wsLoadError };

    if (!apiKey) {
      return { ok: false, error: 'No Deepgram API key configured. Enter your key in Settings → Audio & Transcription.' };
    }

    deepgramWsOwner = event.sender;

    try {
      deepgramWs = new WS(url, {
        headers: { 'Authorization': `Token ${apiKey}` },
      });
    } catch (err: any) {
      deepgramWsOwner = null;
      return { ok: false, error: err.message };
    }

    deepgramWs.on('open', () => {
      console.log('[DeepgramWS] Connection opened');
      if (deepgramWsOwner && !deepgramWsOwner.isDestroyed()) {
        deepgramWsOwner.send('deepgram-open');
      }
    });

    deepgramWs.on('message', (data: Buffer) => {
      if (deepgramWsOwner && !deepgramWsOwner.isDestroyed()) {
        deepgramWsOwner.send('deepgram-message', data.toString());
      }
    });

    deepgramWs.on('close', (code: number, reason: Buffer) => {
      console.log(`[DeepgramWS] Closed — code: ${code}, reason: ${reason.toString() || '(none)'}`);
      deepgramWs = null;
      if (deepgramWsOwner && !deepgramWsOwner.isDestroyed()) {
        deepgramWsOwner.send('deepgram-close', code, reason.toString());
      }
      deepgramWsOwner = null;
    });

    deepgramWs.on('error', (err: Error) => {
      console.error(`[DeepgramWS] Socket error: ${err.message}`);
      if (deepgramWsOwner && !deepgramWsOwner.isDestroyed()) {
        deepgramWsOwner.send('deepgram-error', err.message);
      }
    });

    return { ok: true };
  });

  // Send a raw binary audio frame (ArrayBuffer from renderer → Buffer in Node → binary WS frame)
  ipcMain.on('deepgram-send-audio', (_event, data: Buffer) => {
    if (deepgramWs && deepgramWs.readyState === 1 /* OPEN */) {
      try { deepgramWs.send(data); } catch (err: any) {
        console.error(`[DeepgramWS] Audio send failed: ${err.message}`);
      }
    }
  });

  // Send a JSON control message (CloseStream, KeepAlive)
  ipcMain.on('deepgram-send-json', (_event, data: string) => {
    if (deepgramWs && deepgramWs.readyState === 1 /* OPEN */) {
      try { deepgramWs.send(data); } catch (err: any) {
        console.error(`[DeepgramWS] JSON send failed: ${err.message}`);
      }
    }
  });

  ipcMain.on('deepgram-disconnect', () => {
    console.log('[DeepgramWS] Disconnect requested by renderer');
    closeDeepgramWs();
  });

  console.log('[Main] Deepgram IPC handlers registered ✓');
}



