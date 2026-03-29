# ScriptureFlow Developer Guide

This guide is for contributors working on the ScriptureFlow codebase.
It documents architecture, runtime flows, packaging details, and the safest
way to make changes without breaking production builds.

## 1. Stack and Runtime Model

- Desktop shell: Electron (`electron/main.ts`, `electron/preload.ts`)
- UI: React + Vite (`src/*`)
- State: Zustand with persistence (`src/store/useStore.ts`)
- Speech to text:
  - Deepgram (preferred live provider)
  - Browser speech and mock providers for fallback/testing
- AI interpretation:
  - OpenAI GPT via command interpreter
  - Fast regex path for explicit references
- Output:
  - Local live windows
  - NDI output via offscreen Electron rendering
  - Optional OBS scene automation via WebSocket v5
  - Optional remote control web app (LAN)

## 2. Project Layout

Core directories:

- `electron/`
  - `main.ts`: app lifecycle, IPC, NDI, remote control server, OBS handlers, updater
  - `preload.ts`: secure renderer API bridge
- `src/`
  - `App.tsx`: main operator app shell
  - `LiveApp.tsx`: live output renderer entry
  - `store/useStore.ts`: main app state and actions
  - `components/`: UI panels and settings
  - `lib/`: business logic (bible parsing, transcription, outputs, smart guides)
  - `types/`: shared app contracts
- `public/bibles/`: bible payloads loaded at runtime
- `scripts/`: build/package/setup utilities

Entry points:

- `src/main.tsx` -> `index.html` (operator UI)
- `src/live.tsx` -> `live.html` (live output UI)

## 3. Local Development

Prerequisites:

- Node.js 20+
- npm 10+
- Windows is the primary target for packaging and NDI

Install:

```bash
npm install
```

Optional bible data refresh:

```bash
npm run setup-bibles
```

Run UI only:

```bash
npm run dev
```

Run full Electron dev:

```bash
npm run electron:dev
```

Type check:

```bash
npm run lint
```

Production web build:

```bash
npm run build
```

Compile Electron main/preload:

```bash
npm run electron:compile
```

## 4. Build and Packaging

Production app build:

```bash
npm run electron:build
```

Package installer/exe:

```bash
npm run electron:pack
```

`electron:pack` runs:

1. `setup-ndi` (native rebuild for grandiose)
2. web + electron compile
3. output cleanup
4. `electron-builder`

Important:

- NDI behavior can differ between dev and packaged exe because DLL resolution
  depends on process PATH and unpacked resources.
- Always verify NDI in an installed package before release tagging.

## 5. Runtime Architecture Overview

### 5.1 Operator flow

1. App starts -> profile picker screen (choose active operator profile).
2. `useStore` restores persistent settings/profile data.
3. Audio provider starts listening.
4. Transcript chunk enters parser/interpreter.
5. Command updates preview and optionally pushes live output.
6. Live payload is broadcast to enabled output channels.
7. Optional OBS scene automation triggers on go live.

### 5.2 Output flow

- Main window output routes through Electron IPC (`send-to-live`).
- NDI output routes to offscreen windows (per NDI target id).
- Additional providers use `OutputProviderManager`.

### 5.3 Remote control flow

- Electron main hosts Express server on configured port.
- LAN URLs are exposed in Settings.
- Optional token auth:
  - Remote page first loads auth form.
  - After token entry, state/actions are available.
- QR code in Settings points to LAN IP URL (not localhost).

## 6. State Model Notes (`useStore`)

`useStore` is the central source of truth. It contains:

- Session mode and listening status
- Preview/live scripture
- Queue/run sheet
- Themes and presentation
- Output targets and provider status
- Remote control runtime sync payload
- Voice profiles + user profiles

Profile behavior:

- Each user profile snapshots settings, mode, output targets, and transition config.
- Switching profile applies the saved profile state immediately.

Persistence:

- Store uses Zustand persist (`name: scriptureflow-settings`).
- Merge logic includes migration guards for older saved schemas.

## 7. OBS Integration Notes

Primary path:

- Renderer calls `window.electronAPI.obs*` handlers.
- Main process performs OBS WebSocket handshake and requests.

Fallback path:

- If an IPC handler is missing (version mismatch), renderer falls back to
  `src/lib/obs/obsDirectClient.ts`.
- This prevents settings UI from hard failing when handlers are not registered.

Troubleshooting:

- `ECONNREFUSED host:4455`: OBS WebSocket server disabled or wrong host/port.
- Auth failures: password mismatch with OBS WebSocket settings.
- No scenes loaded: connect first, then request scene list.

## 8. NDI Integration Notes

NDI uses offscreen Electron windows and native grandiose bindings.

Key points:

- NDI runtime DLL resolution is managed in main process.
- Multiple NDI targets are supported via per-target offscreen windows.
- Legacy route `__ndi__` remains for compatibility.

Common failures:

- Runtime not installed or not discoverable by packaged app.
- Bundled stale DLL conflicts (fixed by runtime path staging/sync logic).
- App works in dev but fails in exe due to environment differences.

## 9. Remote Control Security Model

- Token is optional.
- When token is set:
  - `/api/state`, `/api/events`, `/api/action` require valid token.
  - Remote page initially renders auth gate.
- Token can be sent by:
  - `x-scriptureflow-token` header
  - `Authorization: Bearer <token>`
  - `?token=...` query param

Rate limiting:

- Per-client limiter is applied on action endpoint to reduce spam.

## 10. Smart Guides (Template Builder)

Smart alignment and snapping are implemented in:

- `src/lib/canvas/smartGuides.ts`

Core helpers:

- `getElementBounds()`
- `getAlignmentCandidates()`
- `getSnapPosition()`

Guide rendering is drag-time only and should never mutate saved content.

## 11. Release Checklist

Before tagging a release:

1. `npm run lint`
2. `npm run build`
3. `npm run electron:compile`
4. `npm run electron:pack`
5. Install packaged exe and verify:
   - app launches without white screen
   - live output opens
   - NDI detected by external receiver
   - remote control works (with and without token)
   - OBS connect/load/test switch works

Then:

1. bump version
2. commit
3. tag
4. push branch + tag
5. publish release artifacts

## 12. Coding Guidance for Contributors

- Keep renderer and main-process concerns clearly separated.
- Prefer additive migration-safe changes in persisted store schema.
- Avoid hardcoding localhost ports in Electron dev mode.
- Keep fallback behavior for mixed-version sessions where practical.
- Add comments only for non-obvious behavior:
  - handshake/state machine code
  - compatibility fallbacks
  - packaging/runtime edge cases

## 13. Frequently Seen Issues

White screen at launch:

- Usually renderer URL mismatch or dev server not running.
- Check `.dev-server-url` and startup script order.

Remote says Unauthorized immediately:

- Token is enabled and remote has no token yet.
- Expected behavior is auth gate first; verify remote page build in main process.

OBS test button says no handler:

- Main/preload not refreshed in running app instance.
- Restart app. Renderer fallback may still allow testing.

NDI not visible in production:

- Confirm NDI runtime installed on host machine.
- Rebuild/package with `setup-ndi`.
- Verify runtime path diagnostics in Settings.

---

If you make architectural changes (IPC contracts, profile schema, output pipeline,
or packaging scripts), update this file in the same PR.
