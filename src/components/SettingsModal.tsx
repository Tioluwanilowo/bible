import React, { useEffect, useState } from 'react';
import {
  X, RefreshCw, Monitor, Mic, Tv, Cpu, Plus, Trash2,
  MonitorCheck, Circle, Radio, Eye, EyeOff, KeyRound, Smartphone, UserPlus, Save, Copy, QrCode,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { AudioInputManager } from '../lib/audioManager';
import QRCode from 'qrcode';

interface SettingsModalProps {
  onClose: () => void;
}

const LEGACY_NDI_TARGET_ID = '__legacy__';

type NDIHealthSnapshot = {
  status: 'active' | 'stopped' | 'unavailable' | 'error';
  reason?: string;
  error?: string;
  sourceName?: string;
  activeCount?: number;
  checkedAt: number;
};

type NDIDiagnosticsSnapshot = {
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

type RemoteControlStatus = {
  running: boolean;
  enabled: boolean;
  port: number;
  tokenSet: boolean;
  urls: string[];
  connectedClients?: number;
  lastCommandAt?: number;
  commandCount?: number;
  error?: string;
  state?: {
    mode?: 'auto' | 'manual';
    isAutoPaused?: boolean;
    isLiveFrozen?: boolean;
    previewReference?: string;
    liveReference?: string;
    queueCount?: number;
    updatedAt?: number;
  };
};

export default function SettingsModal({ onClose }: SettingsModalProps) {
  const {
    settings, updateSettings, updatePresentationSettings,
    isMockMode, setIsMockMode, isListening, availableDisplays,
    outputSettings, providerStatuses, setOutputSettings, outputLogs,
    themes, outputTargets, addOutputTarget, addNDITarget, removeOutputTarget, updateOutputTarget,
    voiceProfiles, activeVoiceProfileId, addVoiceProfileFromCurrent,
    updateVoiceProfileFromCurrent, removeVoiceProfile, setActiveVoiceProfile,
    userProfiles, activeUserProfileId, createUserProfile, renameUserProfile, deleteUserProfile, setActiveUserProfile,
  } = useStore();

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'audio' | 'presentation' | 'output' | 'remote' | 'routing'>('audio');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);
  const [showChatGptKey, setShowChatGptKey] = useState(false);
  const [showDeepgramKey, setShowDeepgramKey] = useState(false);
  const [showRemoteToken, setShowRemoteToken] = useState(false);
  const [newVoiceProfileName, setNewVoiceProfileName] = useState('');
  const [newUserProfileName, setNewUserProfileName] = useState('');
  const [editingUserProfileName, setEditingUserProfileName] = useState('');
  const [remoteStatus, setRemoteStatus] = useState<RemoteControlStatus | null>(null);
  const [isRefreshingRemoteStatus, setIsRefreshingRemoteStatus] = useState(false);
  const [copiedRemoteUrl, setCopiedRemoteUrl] = useState('');
  const [remoteQrDataUrl, setRemoteQrDataUrl] = useState('');

  // NDI channel controls (Outputs & Display tab — per-target NDI)
  const [ndiActiveTargets, setNdiActiveTargets] = useState<Record<string, boolean>>({});
  const [ndiTargetWorking, setNdiTargetWorking] = useState<string | null>(null);
  const [ndiErrors, setNdiErrors] = useState<Record<string, string>>({});
  const [ndiHealthByTarget, setNdiHealthByTarget] = useState<Record<string, NDIHealthSnapshot>>({});
  const [ndiDiagnosticsByTarget, setNdiDiagnosticsByTarget] = useState<Record<string, NDIDiagnosticsSnapshot>>({});
  const [ndiRuntimePath, setNdiRuntimePath] = useState<string>('');

  const loadDevices = async () => {
    setIsRefreshing(true);
    const devs = await AudioInputManager.getDevices();
    setDevices(devs);
    setIsRefreshing(false);
  };

  const activeVoiceProfile = voiceProfiles.find((profile) => profile.id === activeVoiceProfileId) ?? null;
  const activeUserProfile = userProfiles.find((profile) => profile.id === activeUserProfileId) ?? null;
  const remoteNetworkUrls = (remoteStatus?.urls ?? []).filter((url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
    } catch {
      return !url.includes('localhost');
    }
  });
  const primaryRemoteUrl = remoteNetworkUrls[0] ?? '';
  const qrRemoteUrl = primaryRemoteUrl;

  const updateRemoteControl = (updates: Partial<typeof settings.remoteControl>) => {
    updateSettings({
      remoteControl: {
        ...settings.remoteControl,
        ...updates,
      },
    });
  };

  const refreshRemoteStatus = async () => {
    if (!window.electronAPI?.remoteGetStatus) return;
    setIsRefreshingRemoteStatus(true);
    try {
      const status = await window.electronAPI.remoteGetStatus();
      setRemoteStatus(status as RemoteControlStatus);
    } catch (err: any) {
      const rawMessage = err?.message ?? 'Failed to fetch remote status';
      const message = rawMessage.includes("No handler registered for 'remote-control-status'")
        ? 'Remote backend is not loaded in this app instance yet. Restart ScriptureFlow once, then open this tab again.'
        : rawMessage;
      setRemoteStatus({
        running: false,
        enabled: settings.remoteControl.enabled,
        port: settings.remoteControl.port,
        tokenSet: Boolean(settings.remoteControl.token),
        urls: [],
        error: message,
      });
    } finally {
      setIsRefreshingRemoteStatus(false);
    }
  };

  useEffect(() => { loadDevices(); }, []);
  useEffect(() => { refreshRemoteStatus(); }, [settings.remoteControl]);
  useEffect(() => {
    if (!qrRemoteUrl) {
      setRemoteQrDataUrl('');
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrRemoteUrl, {
      margin: 1,
      width: 220,
      color: {
        dark: '#111827',
        light: '#00000000',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) setRemoteQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setRemoteQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [qrRemoteUrl]);
  useEffect(() => {
    setEditingUserProfileName(activeUserProfile?.name ?? '');
  }, [activeUserProfileId, userProfiles]);

  const refreshDisplays = () => {
    window.electronAPI?.getDisplays().then(displays => {
      useStore.getState().setAvailableDisplays(displays);
    });
  };

  useEffect(() => {
    const ndiTargets = outputTargets.filter(t => t.type === 'ndi');
    if (ndiTargets.length === 0) {
      setNdiActiveTargets({});
      setNdiHealthByTarget({});
      setNdiDiagnosticsByTarget({});
      setNdiRuntimePath('');
      return;
    }

    let cancelled = false;

    const refreshNDIHealth = async () => {
      const rows = await Promise.all(
        ndiTargets.map(async (target) => {
          try {
            const status = await window.electronAPI?.ndiGetStatus?.(target.id);
            return {
              targetId: target.id,
              status: (status?.status as NDIHealthSnapshot['status']) || 'stopped',
              reason: status?.reason,
              sourceName: status?.sourceName,
              activeCount: status?.activeCount,
              checkedAt: Date.now(),
            };
          } catch (err: any) {
            return {
              targetId: target.id,
              status: 'error' as const,
              reason: err?.message ?? 'Status check failed',
              activeCount: 0,
              checkedAt: Date.now(),
            };
          }
        }),
      );

      let diagnostics:
        | { rows: NDIDiagnosticsSnapshot[]; summary: { runtimePath?: string } }
        | null
        | undefined = null;
      try {
        diagnostics = await window.electronAPI?.ndiGetDiagnostics?.();
      } catch {
        diagnostics = null;
      }

      if (cancelled) return;

      const nextActive: Record<string, boolean> = {};
      const nextHealth: Record<string, NDIHealthSnapshot> = {};
      const nextErrors: Record<string, string> = {};

      rows.forEach((row) => {
        nextActive[row.targetId] = row.status === 'active';
        nextHealth[row.targetId] = {
          status: row.status,
          reason: row.reason,
          sourceName: row.sourceName,
          activeCount: row.activeCount,
          checkedAt: row.checkedAt,
        };
        if (row.status === 'error' || row.status === 'unavailable') {
          if (row.reason) nextErrors[row.targetId] = row.reason;
        }
      });

      setNdiActiveTargets(nextActive);
      setNdiHealthByTarget(nextHealth);
      setNdiErrors(prev => ({ ...prev, ...nextErrors }));

      const nextDiagByTarget: Record<string, NDIDiagnosticsSnapshot> = {};
      (diagnostics?.rows ?? []).forEach((row) => {
        nextDiagByTarget[row.targetId] = row;
      });
      setNdiDiagnosticsByTarget(nextDiagByTarget);
      setNdiRuntimePath(diagnostics?.summary?.runtimePath ?? '');
    };

    refreshNDIHealth();
    const pollTimer = setInterval(refreshNDIHealth, 5000);

    const unsubscribe = window.electronAPI?.onNDIStatusChanged?.(({ targetId, status, error }) => {
      if (!targetId || targetId === LEGACY_NDI_TARGET_ID) return;
      if (status === 'active') {
        setNdiActiveTargets(prev => ({ ...prev, [targetId]: true }));
      } else if (status === 'stopped' || status === 'error') {
        setNdiActiveTargets(prev => ({ ...prev, [targetId]: false }));
      }
      setNdiHealthByTarget(prev => ({
        ...prev,
        [targetId]: {
          status: (status as NDIHealthSnapshot['status']) || 'stopped',
          reason: error,
          error,
          sourceName: prev[targetId]?.sourceName,
          activeCount: prev[targetId]?.activeCount,
          checkedAt: Date.now(),
        },
      }));
      if (status === 'error' && error) {
        setNdiErrors(prev => ({ ...prev, [targetId]: error }));
      } else if (status === 'active') {
        setNdiErrors(prev => ({ ...prev, [targetId]: '' }));
      }
    });

    return () => {
      cancelled = true;
      clearInterval(pollTimer);
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [outputTargets]);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800 shrink-0">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0 overflow-x-auto">
          {([
            { id: 'audio', label: 'Audio & Transcription', icon: Mic },
            { id: 'presentation', label: 'Outputs & Display', icon: Monitor },
            { id: 'output', label: 'Output Providers', icon: Tv },
            { id: 'remote', label: 'Remote Control', icon: Smartphone },
            { id: 'routing', label: 'Hardware Routing', icon: Cpu },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center space-x-2 transition-colors whitespace-nowrap ${activeTab === id ? 'text-indigo-400 border-b-2 border-indigo-500 bg-zinc-800/50' : 'text-zinc-400 hover:text-white hover:bg-zinc-800/30'}`}
              onClick={() => setActiveTab(id)}
            >
              <Icon className="w-4 h-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* ── Audio & Transcription ─────────────────────────────── */}
          {activeTab === 'audio' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-white">Operator Profiles</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Switch between saved setup presets for different operators or services.
                    </p>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded bg-indigo-500/15 text-indigo-300">
                    {userProfiles.length} profile{userProfiles.length === 1 ? '' : 's'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Active Profile</label>
                    <select
                      value={activeUserProfileId ?? ''}
                      onChange={(e) => setActiveUserProfile(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                    >
                      {userProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Rename Active Profile</label>
                    <input
                      type="text"
                      value={editingUserProfileName}
                      onChange={(e) => setEditingUserProfileName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                      placeholder="Profile name"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => {
                      if (!activeUserProfileId) return;
                      renameUserProfile(activeUserProfileId, editingUserProfileName);
                    }}
                    disabled={!activeUserProfileId || !editingUserProfileName.trim()}
                    className="px-3 py-2 text-xs rounded-lg border border-zinc-700 text-zinc-200 hover:border-indigo-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Rename
                  </button>
                  <button
                    onClick={() => {
                      createUserProfile(newUserProfileName);
                      setNewUserProfileName('');
                    }}
                    className="px-3 py-2 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors inline-flex items-center justify-center gap-1"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    New From Current
                  </button>
                  <button
                    onClick={() => {
                      if (!activeUserProfileId) return;
                      deleteUserProfile(activeUserProfileId);
                    }}
                    disabled={!activeUserProfileId || userProfiles.length <= 1}
                    className="px-3 py-2 text-xs rounded-lg border border-red-900/60 text-red-300 hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete
                  </button>
                </div>

                <input
                  type="text"
                  value={newUserProfileName}
                  onChange={(e) => setNewUserProfileName(e.target.value)}
                  placeholder="New profile name (optional)"
                  className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-zinc-400">Audio Input Device</label>
                  <button onClick={loadDevices} disabled={isRefreshing} className="text-zinc-500 hover:text-indigo-400 transition-colors" title="Refresh Devices">
                    <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                </div>
                <select
                  value={settings.deviceId}
                  onChange={(e) => updateSettings({ deviceId: e.target.value })}
                  disabled={isListening}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="default">Default System Microphone</option>
                  {devices.map(device => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Microphone (${device.deviceId.slice(0, 5)}...)`}
                    </option>
                  ))}
                </select>
                {isListening && <p className="text-xs text-amber-500 mt-1">Stop listening to change device.</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-400 mb-2">Transcription Provider</label>
                <select
                  value={settings.providerId}
                  onChange={(e) => updateSettings({ providerId: e.target.value })}
                  disabled={isListening}
                  className="w-full bg-zinc-950 border border-zinc-800 text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  <option value="browser">Browser Speech Recognition (uses system default mic)</option>
                  <option value="google">Google Cloud Speech-to-Text (recommended)</option>
                  <option value="whisper">OpenAI Whisper (5 s chunks)</option>
                  <option value="realtime">OpenAI Realtime (live audio stream, lowest latency)</option>
                  <option value="deepgram">Deepgram Nova-2 (live stream, ~700 ms, lowest cost)</option>
                </select>

                {/* Google Cloud STT key */}
                {settings.providerId === 'google' && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      Google Cloud API Key
                    </label>
                    <div className="relative flex items-center">
                      <KeyRound className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={settings.googleSttApiKey ?? ''}
                        onChange={(e) => updateSettings({ googleSttApiKey: e.target.value.trim() })}
                        placeholder="AIza…"
                        disabled={isListening}
                        className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50 font-mono placeholder:font-sans placeholder:text-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(v => !v)}
                        className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      {settings.googleSttApiKey ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <Circle className="w-1.5 h-1.5 fill-emerald-400" /> Key configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                          <Circle className="w-1.5 h-1.5 fill-amber-400" /> No key — get one at{' '}
                          <a
                            href="https://console.cloud.google.com/apis/credentials"
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-amber-300"
                            onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://console.cloud.google.com/apis/credentials'); }}
                          >
                            console.cloud.google.com
                          </a>
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">Stored locally, never shared</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Records audio in 5-second chunks. Includes scripture-specific hints (all Bible book names) for higher accuracy on references like "John 3:16". Requires the Speech-to-Text API enabled in your Google Cloud project.
                    </p>
                  </div>
                )}

                {/* OpenAI Whisper key */}
                {settings.providerId === 'whisper' && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      OpenAI API Key
                    </label>
                    <div className="relative flex items-center">
                      <KeyRound className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                      <input
                        type={showOpenAiKey ? 'text' : 'password'}
                        value={settings.openaiApiKey ?? ''}
                        onChange={(e) => updateSettings({ openaiApiKey: e.target.value.trim() })}
                        placeholder="sk-…"
                        disabled={isListening}
                        className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50 font-mono placeholder:font-sans placeholder:text-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenAiKey(v => !v)}
                        className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showOpenAiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      {settings.openaiApiKey ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <Circle className="w-1.5 h-1.5 fill-emerald-400" /> Key configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                          <Circle className="w-1.5 h-1.5 fill-amber-400" /> No key — get one at{' '}
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-amber-300"
                            onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://platform.openai.com/api-keys'); }}
                          >
                            platform.openai.com
                          </a>
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">Stored locally, never shared</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Records audio in 5-second chunks and sends them to OpenAI Whisper for transcription.
                    </p>
                  </div>
                )}

                {/* OpenAI Realtime key */}
                {settings.providerId === 'realtime' && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      OpenAI API Key
                    </label>
                    <div className="relative flex items-center">
                      <KeyRound className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                      <input
                        type={showOpenAiKey ? 'text' : 'password'}
                        value={settings.openaiApiKey ?? ''}
                        onChange={(e) => updateSettings({ openaiApiKey: e.target.value.trim() })}
                        placeholder="sk-…"
                        disabled={isListening}
                        className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50 font-mono placeholder:font-sans placeholder:text-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOpenAiKey(v => !v)}
                        className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showOpenAiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      {settings.openaiApiKey ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <Circle className="w-1.5 h-1.5 fill-emerald-400" /> Key configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                          <Circle className="w-1.5 h-1.5 fill-amber-400" /> No key — get one at{' '}
                          <a
                            href="https://platform.openai.com/api-keys"
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-amber-300"
                            onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://platform.openai.com/api-keys'); }}
                          >
                            platform.openai.com
                          </a>
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">Stored locally, never shared</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Streams raw audio directly to OpenAI — no fixed chunks, accent-robust, ~1–2 s latency.
                      Transcripts are still captured for display and used as a fallback signal.
                      Uses the same OpenAI API key as Whisper.
                    </p>
                  </div>
                )}

                {/* Deepgram Nova-2 key */}
                {settings.providerId === 'deepgram' && (
                  <div className="mt-3 space-y-2">
                    <label className="block text-xs font-medium text-zinc-400">
                      Deepgram API Key
                    </label>
                    <div className="relative flex items-center">
                      <KeyRound className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                      <input
                        type={showDeepgramKey ? 'text' : 'password'}
                        value={settings.deepgramApiKey ?? ''}
                        onChange={(e) => updateSettings({ deepgramApiKey: e.target.value.trim() })}
                        placeholder="Token …"
                        disabled={isListening}
                        className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 disabled:opacity-50 font-mono placeholder:font-sans placeholder:text-zinc-600"
                      />
                      <button
                        type="button"
                        onClick={() => setShowDeepgramKey(v => !v)}
                        className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showDeepgramKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      {settings.deepgramApiKey ? (
                        <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                          <Circle className="w-1.5 h-1.5 fill-emerald-400" /> Key configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                          <Circle className="w-1.5 h-1.5 fill-amber-400" /> No key — free $200 credit at{' '}
                          <a
                            href="https://console.deepgram.com"
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-amber-300"
                            onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://console.deepgram.com'); }}
                          >
                            console.deepgram.com
                          </a>
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600">Stored locally, never shared</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Streams audio to Deepgram Nova-2 in real time. Fires a final transcript on end-of-utterance
                      (~300 ms silence) rather than fixed chunks — detection latency ~700 ms.
                      ~23× cheaper than OpenAI Realtime ($0.0043/min vs ~$0.10/min).
                    </p>
                  </div>
                )}

                {settings.providerId === 'browser' && settings.deviceId !== 'default' && (
                  <p className="text-xs text-amber-400 mt-1">Browser Speech Recognition ignores the device selection above. Switch to Google Cloud STT to use a specific mic.</p>
                )}
              </div>

              {/* ── ChatGPT Reference Interpreter ── */}
              <div className="pt-4 border-t border-zinc-800">
                <label className="block text-sm font-medium text-zinc-400 mb-1">
                  AI Reference Interpreter
                </label>
                <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
                  Uses ChatGPT to understand spoken Bible references from transcripts.
                  When configured, it replaces the rule-based parser with an AI model
                  that handles natural phrasing, partial references, and navigation commands.
                  Falls back to the rule-based system if the AI is unavailable.
                </p>
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-zinc-400">
                    ChatGPT API Key
                  </label>
                  <div className="relative flex items-center">
                    <KeyRound className="absolute left-3 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
                    <input
                      type={showChatGptKey ? 'text' : 'password'}
                      value={settings.chatgptApiKey ?? ''}
                      onChange={(e) => updateSettings({ chatgptApiKey: e.target.value.trim() })}
                      placeholder="sk-…"
                      className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg pl-9 pr-10 py-2.5 focus:outline-none focus:border-indigo-500 font-mono placeholder:font-sans placeholder:text-zinc-600"
                    />
                    <button
                      type="button"
                      onClick={() => setShowChatGptKey(v => !v)}
                      className="absolute right-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                      tabIndex={-1}
                    >
                      {showChatGptKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    {settings.chatgptApiKey ? (
                      <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                        <Circle className="w-1.5 h-1.5 fill-emerald-400" /> Key configured — AI interpreter active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
                        <Circle className="w-1.5 h-1.5 fill-amber-400" /> No key — using rule-based parser. Get one at{' '}
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noreferrer"
                          className="underline hover:text-amber-300"
                          onClick={e => { e.preventDefault(); window.electronAPI?.openExternal?.('https://platform.openai.com/api-keys'); }}
                        >
                          platform.openai.com
                        </a>
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-600">Stored locally, never shared</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-lg border border-zinc-800">
                <div>
                  <h3 className="text-sm font-medium text-white">Mock Simulator Mode</h3>
                  <p className="text-xs text-zinc-500 mt-1">Use simulated transcripts instead of real audio.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={isMockMode} onChange={(e) => setIsMockMode(e.target.checked)} disabled={isListening} />
                  <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 disabled:opacity-50" />
                </label>
              </div>

              <div className="pt-4 border-t border-zinc-800">
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-zinc-400">High Confidence Threshold</label>
                  <span className="text-sm text-indigo-400">{(settings.highConfidenceThreshold * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.05" value={settings.highConfidenceThreshold}
                  onChange={(e) => updateSettings({ highConfidenceThreshold: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500" />
                <p className="text-xs text-zinc-500 mt-1">Commands above this threshold execute automatically.</p>
              </div>

              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-sm font-medium text-zinc-400">Medium Confidence Threshold</label>
                  <span className="text-sm text-amber-400">{(settings.mediumConfidenceThreshold * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min="0" max="1" step="0.05" value={settings.mediumConfidenceThreshold}
                  onChange={(e) => updateSettings({ mediumConfidenceThreshold: parseFloat(e.target.value) })}
                  className="w-full accent-amber-500" />
                <p className="text-xs text-zinc-500 mt-1">Commands between medium and high require manual approval.</p>
              </div>

              <div className="pt-2 space-y-3">
                <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-lg border border-zinc-800">
                  <div>
                    <h3 className="text-sm font-medium text-white">Confidence Guardrails</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Require manual approval for risky auto-live jumps (cross-book without explicit mention, large chapter jumps).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.enableConfidenceGuardrails}
                      onChange={(e) => updateSettings({ enableConfidenceGuardrails: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-lg border border-zinc-800">
                  <div>
                    <h3 className="text-sm font-medium text-white">Verse Lock + Smart Continue</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Keep auto-live on current chapter and only allow adjacent verse moves automatically.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.verseLockEnabled}
                      onChange={(e) => updateSettings({ verseLockEnabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                  </label>
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-950 rounded-lg border border-zinc-800">
                  <div>
                    <h3 className="text-sm font-medium text-white">AI Cue Gate</h3>
                    <p className="text-xs text-zinc-500 mt-1">
                      Skip AI calls when a chunk has no scripture cue (fewer false triggers, lower latency).
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.aiCueGateEnabled}
                      onChange={(e) => updateSettings({ aiCueGateEnabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600" />
                  </label>
                </div>

                <div className="p-4 bg-zinc-950 rounded-lg border border-zinc-800">
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium text-zinc-400">Suggestion Cooldown</label>
                    <span className="text-sm text-emerald-400">{(settings.suggestionCooldownMs / 1000).toFixed(1)}s</span>
                  </div>
                  <input
                    type="range"
                    min="500"
                    max="6000"
                    step="250"
                    value={settings.suggestionCooldownMs}
                    onChange={(e) => updateSettings({ suggestionCooldownMs: parseInt(e.target.value, 10) })}
                    className="w-full accent-emerald-500"
                  />
                  <p className="text-xs text-zinc-500 mt-1">
                    Wait this long after an explicit reference before content-based suggestions can fire.
                  </p>
                </div>

                <div className="p-4 bg-zinc-950 rounded-lg border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-white">Pastor Voice Profiles</h3>
                      <p className="text-xs text-zinc-500 mt-1">
                        Save and switch detection tuning presets for different speaking styles.
                      </p>
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded bg-indigo-500/10 text-indigo-300">
                      {voiceProfiles.length} profiles
                    </span>
                  </div>

                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Active Profile</label>
                    <select
                      value={activeVoiceProfileId ?? ''}
                      onChange={(e) => setActiveVoiceProfile(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                    >
                      {voiceProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => {
                        if (!activeVoiceProfileId) return;
                        updateVoiceProfileFromCurrent(activeVoiceProfileId);
                      }}
                      disabled={!activeVoiceProfileId}
                      className="px-3 py-2 text-xs rounded-lg border border-zinc-700 text-zinc-200 hover:border-indigo-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Update
                    </button>
                    <button
                      onClick={() => {
                        const name = newVoiceProfileName.trim();
                        if (!name) return;
                        addVoiceProfileFromCurrent(name);
                        setNewVoiceProfileName('');
                      }}
                      disabled={!newVoiceProfileName.trim()}
                      className="px-3 py-2 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Save New
                    </button>
                    <button
                      onClick={() => {
                        if (!activeVoiceProfileId || voiceProfiles.length <= 1) return;
                        removeVoiceProfile(activeVoiceProfileId);
                      }}
                      disabled={!activeVoiceProfileId || voiceProfiles.length <= 1}
                      className="px-3 py-2 text-xs rounded-lg border border-red-900/60 text-red-300 hover:bg-red-900/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </div>

                  <input
                    type="text"
                    value={newVoiceProfileName}
                    onChange={(e) => setNewVoiceProfileName(e.target.value)}
                    placeholder="New profile name (e.g. Sunday Main Service)"
                    className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                  />

                  {activeVoiceProfile && (
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 text-[11px] text-zinc-400 grid grid-cols-2 gap-y-1">
                      <span>High / Medium</span>
                      <span className="text-zinc-200 text-right">
                        {(activeVoiceProfile.highConfidenceThreshold * 100).toFixed(0)}% / {(activeVoiceProfile.mediumConfidenceThreshold * 100).toFixed(0)}%
                      </span>
                      <span>Guardrails</span>
                      <span className="text-zinc-200 text-right">{activeVoiceProfile.enableConfidenceGuardrails ? 'On' : 'Off'}</span>
                      <span>Verse Lock</span>
                      <span className="text-zinc-200 text-right">{activeVoiceProfile.verseLockEnabled ? 'On' : 'Off'}</span>
                      <span>AI Cue Gate</span>
                      <span className="text-zinc-200 text-right">{activeVoiceProfile.aiCueGateEnabled ? 'On' : 'Off'}</span>
                      <span>Suggestion Cooldown</span>
                      <span className="text-zinc-200 text-right">{(activeVoiceProfile.suggestionCooldownMs / 1000).toFixed(1)}s</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Outputs & Display ─────────────────────────────────── */}
          {activeTab === 'presentation' && (
            <div className="space-y-4">
              {/* Section header + refresh */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Output Channels</h3>
                  <p className="text-xs text-zinc-500 mt-0.5">Each channel sends to its own window with an independent theme.</p>
                </div>
                <button onClick={refreshDisplays} className="text-zinc-500 hover:text-indigo-400 transition-colors" title="Refresh Displays">
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {/* Output target cards */}
              <div className="space-y-3">
                {outputTargets.map((target) => {
                  const resolvedTheme = themes.find(t => t.id === target.themeId);
                  const isNDI = target.type === 'ndi';
                  const ndiStreaming = Boolean(ndiActiveTargets[target.id]);
                  const ndiHealth = ndiHealthByTarget[target.id];
                  const ndiDiagnostics = ndiDiagnosticsByTarget[target.id];
                  const ndiStatus = ndiHealth?.status ?? (ndiStreaming ? 'active' : 'stopped');
                  const ndiLastChecked = ndiHealth?.checkedAt
                    ? new Date(ndiHealth.checkedAt).toLocaleTimeString()
                    : 'Pending';
                  const ndiUptimeSec = ndiDiagnostics ? Math.max(0, Math.round(ndiDiagnostics.uptimeMs / 1000)) : 0;

                  return (
                    <div key={target.id} className={`rounded-xl border p-4 space-y-3 transition-colors ${target.enabled ? (isNDI ? 'bg-zinc-950 border-emerald-900/40' : 'bg-zinc-950 border-zinc-700') : 'bg-zinc-900/50 border-zinc-800 opacity-60'}`}>

                      {/* Row 1: type icon + label + status badge + enable toggle + remove */}
                      <div className="flex items-center gap-2">
                        {isNDI
                          ? <Radio className={`w-4 h-4 shrink-0 ${ndiStreaming ? 'text-emerald-400' : 'text-zinc-600'}`} />
                          : <MonitorCheck className={`w-4 h-4 shrink-0 ${target.windowOpen ? 'text-emerald-400' : 'text-zinc-600'}`} />
                        }
                        <input
                          value={target.label}
                          onChange={e => updateOutputTarget(target.id, { label: e.target.value })}
                          className="flex-1 bg-transparent text-sm font-medium text-white outline-none border-b border-transparent focus:border-indigo-500 transition-colors"
                        />
                        {/* Status dot */}
                        {isNDI ? (
                          <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${ndiStreaming ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                            <Circle className={`w-1.5 h-1.5 ${ndiStreaming ? 'fill-emerald-400' : 'fill-zinc-500'}`} />
                            {ndiStreaming ? 'Streaming' : 'NDI'}
                          </span>
                        ) : (
                          <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${target.windowOpen ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                            <Circle className={`w-1.5 h-1.5 ${target.windowOpen ? 'fill-emerald-400' : 'fill-zinc-500'}`} />
                            {target.windowOpen ? 'Open' : 'Closed'}
                          </span>
                        )}
                        {/* Enable toggle */}
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input type="checkbox" className="sr-only peer" checked={target.enabled}
                            onChange={e => {
                              const enabled = e.target.checked;
                              updateOutputTarget(target.id, { enabled });
                              if (isNDI && !enabled) {
                                window.electronAPI?.ndiStop?.(target.id);
                                setNdiActiveTargets(prev => ({ ...prev, [target.id]: false }));
                              }
                            }} />
                          <div className="w-9 h-5 bg-zinc-700 rounded-full peer peer-checked:bg-indigo-600 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                        </label>
                        {/* Remove */}
                        {(outputTargets.length > 1 || isNDI) && (
                          <button onClick={() => {
                            if (isNDI && ndiStreaming) {
                              window.electronAPI?.ndiStop?.(target.id);
                              setNdiActiveTargets(prev => ({ ...prev, [target.id]: false }));
                            }
                            removeOutputTarget(target.id);
                          }}
                            className="p-1 text-zinc-600 hover:text-red-400 transition-colors shrink-0" title="Remove output">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Row 2: Theme + (Display OR NDI Source Name) */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-zinc-500 block mb-1">Theme</label>
                          <select
                            value={target.themeId ?? ''}
                            onChange={e => updateOutputTarget(target.id, { themeId: e.target.value || null })}
                            className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                          >
                            <option value="">— Follow Active Theme —</option>
                            {themes.map(t => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                          {resolvedTheme && (
                            <p className="text-[10px] text-indigo-400 mt-1 truncate">
                              Using: {resolvedTheme.name} ({resolvedTheme.settings.theme})
                            </p>
                          )}
                        </div>

                        {isNDI ? (
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">NDI Source Name</label>
                            <input
                              type="text"
                              value={target.ndiSourceName ?? ''}
                              onChange={e => updateOutputTarget(target.id, { ndiSourceName: e.target.value })}
                              placeholder="ScriptureFlow"
                              className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                            />
                            <p className="text-[10px] text-zinc-500 mt-1">Visible name in OBS / vMix</p>
                          </div>
                        ) : (
                          <div>
                            <label className="text-xs text-zinc-500 block mb-1">Display</label>
                            <select
                              value={target.displayId ?? ''}
                              onChange={e => updateOutputTarget(target.id, { displayId: e.target.value || null })}
                              className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                            >
                              <option value="">Primary Display</option>
                              {availableDisplays.map(d => (
                                <option key={d.id} value={d.id}>
                                  {d.name}{d.isPrimary ? ' ★' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

                      {/* NDI info note */}
                      {isNDI && (
                        <div className="space-y-2">
                          <p className="text-[10px] text-zinc-500 leading-relaxed">
                            NDI renders scripture into a hidden offscreen window and streams it directly - no visible window needed.
                          </p>
                          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-[10px] font-medium text-zinc-300">NDI Health Monitor</p>
                              <span
                                className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                                  ndiStatus === 'active'
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : ndiStatus === 'unavailable' || ndiStatus === 'error'
                                      ? 'bg-red-500/15 text-red-400'
                                      : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {ndiStatus}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px]">
                              <p className="text-zinc-500">Active Sources</p>
                              <p className="text-zinc-300 text-right">{ndiHealth?.activeCount ?? (ndiStreaming ? 1 : 0)}</p>
                              <p className="text-zinc-500">FPS</p>
                              <p className="text-zinc-300 text-right">{ndiDiagnostics ? ndiDiagnostics.fps.toFixed(1) : '-'}</p>
                              <p className="text-zinc-500">Frames Sent</p>
                              <p className="text-zinc-300 text-right">{ndiDiagnostics?.frameCount ?? '-'}</p>
                              <p className="text-zinc-500">Frame Errors</p>
                              <p className="text-zinc-300 text-right">{ndiDiagnostics?.frameErrors ?? '-'}</p>
                              <p className="text-zinc-500">Uptime</p>
                              <p className="text-zinc-300 text-right">{ndiDiagnostics ? `${ndiUptimeSec}s` : '-'}</p>
                              <p className="text-zinc-500">Runtime Source</p>
                              <p
                                className="text-zinc-300 text-right truncate"
                                title={ndiHealth?.sourceName || target.ndiSourceName || 'ScriptureFlow'}
                              >
                                {ndiHealth?.sourceName || target.ndiSourceName || 'ScriptureFlow'}
                              </p>
                              <p className="text-zinc-500">Runtime Path</p>
                              <p className="text-zinc-300 text-right truncate" title={ndiDiagnostics?.runtimePath || ndiRuntimePath || '-'}>
                                {ndiDiagnostics?.runtimePath || ndiRuntimePath || '-'}
                              </p>
                              <p className="text-zinc-500">Last Check</p>
                              <p className="text-zinc-300 text-right">{ndiLastChecked}</p>
                            </div>
                            {(ndiHealth?.reason || ndiErrors[target.id]) && (
                              <p className="text-[10px] text-amber-400 mt-2 break-all">
                                {ndiHealth?.reason || ndiErrors[target.id]}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Row 3: control buttons */}
                      {isNDI ? (
                        <div className="space-y-2">
                          {providerStatuses['ndi']?.status === 'unavailable' ? (
                            <p className="text-[10px] text-amber-400 leading-relaxed">
                              grandiose not installed — run:{' '}
                              <code className="text-zinc-200 bg-zinc-800 px-1 rounded">npm install grandiose</code>
                              {' '}then{' '}
                              <code className="text-zinc-200 bg-zinc-800 px-1 rounded">npx electron-rebuild -f -w grandiose</code>
                            </p>
                          ) : (
                            <>
                              <div className="flex gap-2">
                                <button
                                  disabled={ndiTargetWorking === target.id || ndiStreaming}
                                  onClick={async () => {
                                    setNdiTargetWorking(target.id);
                                    setNdiErrors(prev => ({ ...prev, [target.id]: '' }));
                                    try {
                                      const srcName = target.ndiSourceName || 'ScriptureFlow';
                                      const result = await window.electronAPI?.ndiStart(srcName, target.id);
                                      if (result?.ok) {
                                        setNdiActiveTargets(prev => ({ ...prev, [target.id]: true }));
                                      } else if (result?.error) {
                                        setNdiErrors(prev => ({ ...prev, [target.id]: result.error! }));
                                      }
                                    } catch (e: any) {
                                      setNdiErrors(prev => ({ ...prev, [target.id]: e?.message ?? 'Unknown error' }));
                                    } finally {
                                      setNdiTargetWorking(null);
                                    }
                                  }}
                                  className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  {ndiTargetWorking === target.id ? 'Starting...' : ndiStreaming ? 'Streaming' : 'Start NDI'}
                                </button>
                                <button
                                  disabled={!ndiStreaming}
                                  onClick={() => {
                                    window.electronAPI?.ndiStop?.(target.id);
                                    setNdiActiveTargets(prev => ({ ...prev, [target.id]: false }));
                                  }}
                                  className="flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors bg-zinc-700 hover:bg-zinc-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  Stop NDI
                                </button>
                              </div>
                              {ndiStreaming && (
                                <p className="text-[10px] text-emerald-400">
                                  ✓ Broadcasting as <strong>"{target.ndiSourceName || 'ScriptureFlow'}"</strong> — visible to OBS / vMix on this network
                                </p>
                              )}
                              {ndiErrors[target.id] && (
                                <div className="bg-red-950/40 border border-red-800/40 rounded-lg p-2">
                                  <p className="text-[10px] text-red-400 font-medium mb-0.5">NDI failed to start:</p>
                                  <p className="text-[10px] text-red-300 break-all font-mono">{ndiErrors[target.id]}</p>
                                  {ndiErrors[target.id].toLowerCase().includes('grandiose') && (
                                    <div className="mt-2 space-y-1">
                                      <p className="text-[10px] text-amber-400">Run these commands in the project folder:</p>
                                      <code className="block text-[10px] text-zinc-200 bg-zinc-900 px-2 py-1 rounded">python -m pip install setuptools</code>
                                      <code className="block text-[10px] text-zinc-200 bg-zinc-900 px-2 py-1 rounded">npm install grandiose</code>
                                      <code className="block text-[10px] text-zinc-200 bg-zinc-900 px-2 py-1 rounded">npx @electron/rebuild -f -w grandiose</code>
                                    </div>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          {target.windowOpen ? (
                            <>
                              <button
                                onClick={() => window.electronAPI?.closeLiveWindow(target.id)}
                                className="flex-1 py-1.5 text-xs rounded-lg bg-red-900/25 text-red-400 hover:bg-red-900/40 border border-red-900/30 transition-colors"
                              >
                                Close Window
                              </button>
                              {target.displayId && (
                                <button
                                  onClick={() => window.electronAPI?.moveLiveWindow(target.id, target.displayId!)}
                                  className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg border border-zinc-700 transition-colors"
                                >
                                  Move to Display
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              onClick={() => window.electronAPI?.openLiveWindow(target.id, target.displayId || undefined)}
                              className="flex-1 py-1.5 text-xs rounded-lg bg-emerald-900/25 text-emerald-400 hover:bg-emerald-900/40 border border-emerald-900/30 transition-colors"
                            >
                              Open Window
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add output buttons */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => addOutputTarget()}
                  className="py-2.5 border border-dashed border-zinc-700 hover:border-indigo-500 text-zinc-500 hover:text-indigo-400 text-sm rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Display Output
                </button>
                <button
                  onClick={() => addNDITarget()}
                  className="py-2.5 border border-dashed border-emerald-900/50 hover:border-emerald-600 text-zinc-500 hover:text-emerald-400 text-sm rounded-xl flex items-center justify-center gap-2 transition-colors"
                >
                  <Radio className="w-4 h-4" />
                  Add NDI Output
                </button>
              </div>

              {/* Tip */}
              {themes.length === 0 && (
                <p className="text-xs text-amber-400 text-center">
                  No themes yet — open the <strong>Theme Designer</strong> to create themes for your outputs.
                </p>
              )}
            </div>
          )}

          {/* ── Output Providers ──────────────────────────────────── */}
          {activeTab === 'output' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-white mb-4">Output Providers</h3>
                <div className="space-y-3">
                  {Object.values(providerStatuses).map(provider => (
                    <div key={provider.id} className="bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden">
                      {/* Header row */}
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <h4 className="text-sm font-medium text-white">{provider.name}</h4>
                            {provider.status === 'active' && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-400">Active</span>}
                            {provider.status === 'ready' && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-500/20 text-blue-400">Ready</span>}
                            {provider.status === 'unavailable' && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-500/20 text-zinc-400">Unavailable</span>}
                            {provider.status === 'error' && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-400">Error</span>}
                            {provider.status === 'disabled' && <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-800 text-zinc-500">Disabled</span>}
                          </div>
                          <p className="text-xs text-zinc-500 mt-1">{provider.type}</p>
                          {provider.errorMessage && <p className="text-xs text-red-400 mt-1">{provider.errorMessage}</p>}
                        </div>
                        {provider.id === 'ndi' ? (
                          <span className="px-2 py-1 rounded text-[10px] font-medium bg-zinc-800 text-zinc-300">
                            Managed in Outputs & Display
                          </span>
                        ) : (
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox" className="sr-only peer"
                              checked={outputSettings?.providers?.[provider.id]?.enabled ?? false}
                              disabled={provider.status === 'unavailable'}
                              onChange={(e) => {
                                const enabled = e.target.checked;
                                setOutputSettings({ providers: { ...(outputSettings?.providers || {}), [provider.id]: { enabled } } });
                                import('../lib/output/OutputProviderManager').then(({ outputManager }) => {
                                  if (enabled) outputManager.startProvider(provider.id);
                                  else outputManager.stopProvider(provider.id);
                                });
                              }}
                            />
                            <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 disabled:opacity-50" />
                          </label>
                        )}
                      </div>
                      {provider.id === 'ndi' && provider.status !== 'unavailable' && (
                        <div className="px-4 pb-4 pt-0 border-t border-zinc-800/60">
                          <p className="text-[10px] text-zinc-500 pt-3 leading-relaxed">
                            NDI channels are controlled in the <strong className="text-zinc-300">Outputs & Display</strong> tab.
                            Add one or more NDI outputs there and start/stop each source per channel.
                          </p>
                        </div>
                      )}

                      {/* grandiose not installed notice */}
                      {provider.id === 'ndi' && provider.status === 'unavailable' && (
                        <div className="px-4 pb-4 pt-0 border-t border-zinc-800/60">
                          <p className="text-[10px] text-amber-400 pt-3">
                            To enable NDI output, run in your terminal:<br />
                            <code className="text-zinc-200 bg-zinc-800 px-1.5 py-0.5 rounded mt-1 inline-block">
                              npm install grandiose &amp;&amp; npx electron-rebuild -f -w grandiose
                            </code>
                            <br />Also install <span className="text-zinc-300">NDI Runtime</span> from ndi.video/tools
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800">
                <h3 className="text-sm font-medium text-white mb-4">Diagnostics Logs</h3>
                <div className="bg-zinc-950 rounded-lg border border-zinc-800 h-48 overflow-y-auto p-3 space-y-2 font-mono text-xs">
                  {outputLogs.length === 0 ? (
                    <div className="text-zinc-600 text-center py-4">No logs yet</div>
                  ) : (
                    outputLogs.map(log => (
                      <div key={log.id} className={`flex space-x-2 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-amber-400' : 'text-zinc-400'}`}>
                        <span className="opacity-50 shrink-0">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                        <span className="shrink-0">{log.providerId ? `[${log.providerId}]` : '[System]'}</span>
                        <span className="break-all">{log.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Hardware Routing ──────────────────────────────────── */}
          {activeTab === 'remote' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    <Smartphone className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0" />
                    <div>
                      <h4 className="text-sm font-medium text-white">Operator Remote App</h4>
                      <p className="text-xs text-zinc-500 mt-1">
                        Control preview/live, verse step, mode and queue from any phone or laptop on your local network.
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={settings.remoteControl.enabled}
                      onChange={(e) => updateRemoteControl({ enabled: e.target.checked })}
                    />
                    <div className="w-11 h-6 bg-zinc-800 rounded-full peer peer-checked:bg-indigo-600 relative after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Remote Port</label>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={settings.remoteControl.port}
                      onChange={(e) => {
                        const parsed = Number(e.target.value);
                        const nextPort = Number.isFinite(parsed) ? Math.min(65535, Math.max(1024, parsed)) : 4217;
                        updateRemoteControl({ port: nextPort });
                      }}
                      className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Access Token (optional)</label>
                    <div className="relative">
                      <input
                        type={showRemoteToken ? 'text' : 'password'}
                        value={settings.remoteControl.token}
                        onChange={(e) => updateRemoteControl({ token: e.target.value })}
                        placeholder="Set token for secure remote access"
                        className="w-full bg-zinc-900 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 pr-10 focus:outline-none focus:border-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => setShowRemoteToken((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                        tabIndex={-1}
                      >
                        {showRemoteToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={() => refreshRemoteStatus()}
                    disabled={isRefreshingRemoteStatus}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingRemoteStatus ? 'animate-spin' : ''}`} />
                    Refresh Status
                  </button>
                  <span className={`px-2 py-1 rounded ${
                    remoteStatus?.running
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {remoteStatus?.running ? 'Running' : 'Stopped'}
                  </span>
                  {remoteStatus?.state?.mode && (
                    <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 uppercase">
                      Mode: {remoteStatus.state.mode}
                    </span>
                  )}
                  <span className="px-2 py-1 rounded bg-zinc-800 text-zinc-300">
                    Clients: {remoteStatus?.connectedClients ?? 0}
                  </span>
                </div>

                {remoteStatus?.error && (
                  <p className="text-[11px] text-red-400 break-all">{remoteStatus.error}</p>
                )}

                {remoteStatus?.state && (
                  <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 grid grid-cols-2 gap-y-1 text-[11px]">
                    <span className="text-zinc-500">Preview</span>
                    <span className="text-zinc-200 text-right truncate" title={remoteStatus.state.previewReference || '-'}>
                      {remoteStatus.state.previewReference || '-'}
                    </span>
                    <span className="text-zinc-500">Live</span>
                    <span className="text-zinc-200 text-right truncate" title={remoteStatus.state.liveReference || '-'}>
                      {remoteStatus.state.liveReference || '-'}
                    </span>
                    <span className="text-zinc-500">Queue Count</span>
                    <span className="text-zinc-200 text-right">{remoteStatus.state.queueCount ?? 0}</span>
                    <span className="text-zinc-500">Auto Paused</span>
                    <span className="text-zinc-200 text-right">{remoteStatus.state.isAutoPaused ? 'Yes' : 'No'}</span>
                    <span className="text-zinc-500">Connected Clients</span>
                    <span className="text-zinc-200 text-right">{remoteStatus.connectedClients ?? 0}</span>
                    <span className="text-zinc-500">Commands Seen</span>
                    <span className="text-zinc-200 text-right">{remoteStatus.commandCount ?? 0}</span>
                    <span className="text-zinc-500">Last Command</span>
                    <span className="text-zinc-200 text-right">
                      {remoteStatus.lastCommandAt ? new Date(remoteStatus.lastCommandAt).toLocaleTimeString() : '-'}
                    </span>
                  </div>
                )}

                <div className="space-y-2">
                  {remoteNetworkUrls.map((url) => (
                    <div key={url} className="flex items-center gap-2">
                      <button
                        onClick={() => window.electronAPI?.openExternal?.(url)}
                        className="flex-1 text-left text-[11px] bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-indigo-300 hover:text-indigo-200 hover:border-indigo-500 transition-colors truncate"
                        title={`Open ${url} in browser`}
                      >
                        {url}
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(url);
                            setCopiedRemoteUrl(url);
                            setTimeout(() => setCopiedRemoteUrl(''), 1200);
                          } catch {
                            // ignore clipboard permission failures
                          }
                        }}
                        className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                        title="Copy URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {remoteNetworkUrls.length === 0 && (
                    <p className="text-[11px] text-amber-400">
                      No LAN IP detected yet. Connect to Wi-Fi/Ethernet, then click Refresh Status.
                    </p>
                  )}
                </div>

                {primaryRemoteUrl && remoteQrDataUrl && (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <QrCode className="w-3.5 h-3.5 text-indigo-400" />
                      <p className="text-[11px] text-zinc-300 font-medium">Scan QR to open Remote Control</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <img
                        src={remoteQrDataUrl}
                        alt="Remote access QR code"
                        className="w-28 h-28 rounded bg-white p-1 border border-zinc-700"
                      />
                      <div className="min-w-0">
                        <p className="text-[10px] text-zinc-500 mb-1">Target URL</p>
                        <p className="text-[11px] text-indigo-300 break-all">{qrRemoteUrl}</p>
                        <p className="text-[10px] text-zinc-500 mt-2">
                          Ask the operator to scan this code on the same local network.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {copiedRemoteUrl && (
                  <p className="text-[10px] text-emerald-400">Copied: {copiedRemoteUrl}</p>
                )}

                <p className="text-[10px] text-zinc-500">
                  Open a URL from another device on the same Wi-Fi. Use the same token there if token auth is enabled.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'routing' && (
            <div className="space-y-6">

              {/* Display outputs → redirect to Outputs & Display */}
              <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-xl p-5 flex items-start space-x-4">
                <Monitor className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-indigo-300">Connected Displays & Multi-Output</h4>
                  <p className="text-xs text-indigo-400/80 mt-1 leading-relaxed">
                    All connected HDMI / DisplayPort monitors are managed in the <strong className="text-indigo-300">Outputs & Display</strong> tab.
                    You can open a live window on each display and assign a different theme to each one.
                  </p>
                  <button
                    onClick={() => setActiveTab('presentation')}
                    className="mt-3 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    Go to Outputs & Display →
                  </button>
                </div>
              </div>

              {/* NDI → redirect to Outputs & Display */}
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 flex items-start space-x-4">
                <Tv className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-emerald-300">NDI Network Output</h4>
                  <p className="text-xs text-emerald-400/80 mt-1 leading-relaxed">
                    NDI output (visible to OBS, vMix, Tricaster and all NDI receivers on your network)
                    is configured in the <strong className="text-emerald-300">Outputs & Display</strong> tab.
                  </p>
                  <button
                    onClick={() => setActiveTab('presentation')}
                    className="mt-3 px-4 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    Go to Outputs & Display →
                  </button>
                </div>
              </div>

              {/* Future SDI/DeckLink */}
              <div className="bg-zinc-800/40 border border-zinc-700/40 rounded-xl p-5 flex items-start space-x-4 opacity-60">
                <Cpu className="w-5 h-5 text-zinc-500 shrink-0 mt-0.5" />
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-zinc-400">SDI Hardware (DeckLink / AJA)</h4>
                    <span className="text-[10px] bg-zinc-700 text-zinc-400 px-2 py-0.5 rounded uppercase tracking-wide">Coming Soon</span>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                    Direct SDI output via Blackmagic DeckLink or AJA cards will be available in a future release.
                    For now, use the NDI output and receive it in your hardware switcher via NDI-to-SDI bridge.
                  </p>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-950/50 flex justify-end shrink-0">
          <button onClick={onClose} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-medium transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

