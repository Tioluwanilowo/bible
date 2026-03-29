import type { OBSSceneTarget } from '../../types';

/**
 * Renderer-side OBS websocket client.
 *
 * Why this exists:
 * - Preferred path is Electron main-process IPC handlers (`obs-test-target`,
 *   `obs-list-scenes`, `obs-trigger-go-live`).
 * - In some dev/prod mismatch cases those handlers can be missing in a running
 *   app instance. This module provides a safe fallback so OBS controls keep
 *   working instead of failing hard in the UI.
 */
export type OBSSceneTriggerResult = {
  ok: boolean;
  targetId: string;
  targetName: string;
  mode: 'program' | 'preview';
  sceneName: string;
  message: string;
};

export type OBSSceneListResult = {
  ok: boolean;
  targetId: string;
  targetName: string;
  scenes: string[];
  currentProgramSceneName?: string;
  currentPreviewSceneName?: string;
  message: string;
};

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

async function sha256Base64(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await window.crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64(digest);
}

async function buildAuth(password: string, salt: string, challenge: string): Promise<string> {
  const secret = await sha256Base64(`${password}${salt}`);
  return sha256Base64(`${secret}${challenge}`);
}

function normalizeWsUrl(host: string, port: number): string {
  const trimmedHost = (host || '').trim();
  const safePort = Number.isFinite(port) ? Math.min(65535, Math.max(1, Math.round(port))) : 4455;
  if (!trimmedHost) return '';
  if (/^wss?:\/\//i.test(trimmedHost)) {
    try {
      const parsed = new URL(trimmedHost);
      if (!parsed.port) parsed.port = String(safePort);
      if (parsed.pathname === '/') parsed.pathname = '';
      return parsed.toString();
    } catch {
      return '';
    }
  }
  return `ws://${trimmedHost}:${safePort}`;
}

async function obsRequest(target: OBSSceneTarget, requestType: string, requestData?: Record<string, any>): Promise<any> {
  const wsUrl = normalizeWsUrl(target.host, target.port);
  if (!wsUrl) throw new Error('Invalid OBS host or port');

  // requestId ties our request to exactly one response packet (op=7).
  const requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const timeoutMs = 7000;

  return new Promise((resolve, reject) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch { /* ignore */ }
      reject(new Error('Timed out waiting for OBS response'));
    }, timeoutMs);

    const finish = (err?: Error, data?: any) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      try { ws?.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(data);
    };

    try {
      ws = new WebSocket(wsUrl);
    } catch (err: any) {
      finish(new Error(err?.message || 'Failed to create OBS socket'));
      return;
    }

    ws.onmessage = (event) => {
      let packet: any;
      try {
        packet = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const op = Number(packet?.op);
      const data = packet?.d || {};

      // op=0 Hello: OBS sends rpcVersion and optional auth challenge.
      if (op === 0) {
        const identify: any = {
          rpcVersion: typeof data?.rpcVersion === 'number' ? data.rpcVersion : 1,
          eventSubscriptions: 0,
        };
        const challenge = data?.authentication?.challenge;
        const salt = data?.authentication?.salt;
        if (challenge && salt) {
          if (!target.password) {
            finish(new Error('OBS requires a password but none was provided'));
            return;
          }
          buildAuth(target.password, salt, challenge)
            .then((auth) => {
              identify.authentication = auth;
              ws?.send(JSON.stringify({ op: 1, d: identify }));
            })
            .catch((err: any) => {
              finish(new Error(err?.message || 'Failed to authenticate with OBS'));
            });
        } else {
          ws?.send(JSON.stringify({ op: 1, d: identify }));
        }
        return;
      }

      // op=2 Identified: now we can send our request.
      if (op === 2) {
        ws?.send(JSON.stringify({
          op: 6,
          d: {
            requestType,
            requestId,
            requestData: requestData || {},
          },
        }));
        return;
      }

      // op=7 RequestResponse: resolve/reject only for our requestId.
      if (op === 7 && data?.requestId === requestId) {
        const status = data?.requestStatus || {};
        if (!status?.result) {
          finish(new Error(String(status?.comment || `OBS request failed (code ${status?.code ?? 'unknown'})`)));
          return;
        }
        finish(undefined, data?.responseData || {});
      }
    };

    ws.onerror = () => {
      finish(new Error('OBS socket connection failed'));
    };

    ws.onclose = (event) => {
      if (settled) return;
      finish(new Error(`OBS closed connection (${event.code})`));
    };
  });
}

export async function listObsScenesDirect(target: OBSSceneTarget): Promise<OBSSceneListResult> {
  const response = await obsRequest(target, 'GetSceneList');
  const scenes = Array.isArray(response?.scenes)
    ? response.scenes.map((scene: any) => String(scene?.sceneName || '').trim()).filter(Boolean)
    : [];
  return {
    ok: true,
    targetId: target.id,
    targetName: target.name || target.host,
    scenes,
    currentProgramSceneName: typeof response?.currentProgramSceneName === 'string' ? response.currentProgramSceneName : undefined,
    currentPreviewSceneName: typeof response?.currentPreviewSceneName === 'string' ? response.currentPreviewSceneName : undefined,
    message: `Loaded ${scenes.length} scene${scenes.length === 1 ? '' : 's'} from OBS`,
  };
}

export async function triggerObsSceneDirect(target: OBSSceneTarget): Promise<OBSSceneTriggerResult> {
  if (!target.sceneName?.trim()) {
    throw new Error('Scene name is required');
  }
  const requestType = target.mode === 'preview' ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene';
  await obsRequest(target, requestType, { sceneName: target.sceneName });
  return {
    ok: true,
    targetId: target.id,
    targetName: target.name || target.host,
    mode: target.mode,
    sceneName: target.sceneName,
    message: `Switched ${target.mode} scene to "${target.sceneName}"`,
  };
}

export async function triggerObsGoLiveDirect(config: {
  enabled: boolean;
  triggerOnGoLive?: boolean;
  targets: OBSSceneTarget[];
}): Promise<{ ok: boolean; results: OBSSceneTriggerResult[]; skipped?: string }> {
  if (!config.enabled) return { ok: true, results: [], skipped: 'OBS automation disabled' };
  if (config.triggerOnGoLive === false) return { ok: true, results: [], skipped: 'Go Live trigger disabled' };

  const targets = (config.targets || []).filter((target) => (
    target?.enabled && target?.host?.trim() && target?.sceneName?.trim()
  ));
  if (targets.length === 0) return { ok: true, results: [], skipped: 'No enabled OBS targets configured' };

  // Best-effort fan-out: one target failure should not block other targets.
  const results = await Promise.all(targets.map(async (target) => {
    try {
      return await triggerObsSceneDirect(target);
    } catch (err: any) {
      return {
        ok: false,
        targetId: target.id,
        targetName: target.name || target.host,
        mode: target.mode,
        sceneName: target.sceneName,
        message: err?.message || 'OBS switch failed',
      } as OBSSceneTriggerResult;
    }
  }));
  return { ok: results.every((row) => row.ok), results };
}

export function isMissingObsHandlerError(err: any): boolean {
  const msg = String(err?.message || '');
  // Renderer checks for these exact IPC registration errors and then falls back
  // to direct websocket calls from this file.
  return msg.includes("No handler registered for 'obs-test-target'")
    || msg.includes("No handler registered for 'obs-list-scenes'")
    || msg.includes("No handler registered for 'obs-trigger-go-live'");
}
