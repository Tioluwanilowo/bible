import { useState } from 'react';
import { useStore } from '../store/useStore';
import { History, Activity, MessageSquare, Terminal, CheckCircle, Check, X, Gauge, RotateCcw, Trash2 } from 'lucide-react';

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function msLabel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${Math.round(value)} ms`;
}

export default function ActivityPanel() {
  const {
    activityLog, history, transcripts, commands, pendingCommands,
    setPreview, approveCommand, rejectCommand,
    latencySamples, clearLatencySamples,
    sessionEvents, clearSessionEvents, replaySessionEvent,
  } = useStore();
  const [tab, setTab] = useState<'history' | 'activity' | 'transcripts' | 'commands' | 'approvals' | 'latency' | 'events'>('transcripts');

  const recentSamples = latencySamples.slice(0, 120);
  const audioToTranscript = avg(recentSamples.map((s) => s.audioToTranscriptMs).filter((v): v is number => typeof v === 'number'));
  const transcriptToIntent = avg(recentSamples.map((s) => s.transcriptToIntentMs).filter((v): v is number => typeof v === 'number'));
  const intentToPreview = avg(recentSamples.map((s) => s.intentToPreviewMs).filter((v): v is number => typeof v === 'number'));
  const previewToLive = avg(recentSamples.map((s) => s.previewToLiveMs).filter((v): v is number => typeof v === 'number'));
  const totalToLive = avg(recentSamples.map((s) => s.totalToLiveMs).filter((v): v is number => typeof v === 'number'));

  return (
    <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
      <div className="flex border-b border-zinc-800 overflow-x-auto">
        <button
          onClick={() => setTab('transcripts')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'transcripts' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <MessageSquare className="w-4 h-4 mb-1" />
          <span>Feed</span>
        </button>
        <button
          onClick={() => setTab('commands')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'commands' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Terminal className="w-4 h-4 mb-1" />
          <span>Cmds</span>
        </button>

        <button
          onClick={() => setTab('approvals')}
          className={`relative min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'approvals' ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <CheckCircle className="w-4 h-4 mb-1" />
          <span>Approve</span>
          {pendingCommands.length > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-amber-500 rounded-full"></span>
          )}
        </button>
        <button
          onClick={() => setTab('history')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'history' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <History className="w-4 h-4 mb-1" />
          <span>History</span>
        </button>
        <button
          onClick={() => setTab('activity')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'activity' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Activity className="w-4 h-4 mb-1" />
          <span>Log</span>
        </button>
        <button
          onClick={() => setTab('latency')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'latency' ? 'text-emerald-400 border-b-2 border-emerald-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Gauge className="w-4 h-4 mb-1" />
          <span>Latency</span>
        </button>
        <button
          onClick={() => setTab('events')}
          className={`min-w-[60px] flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'events' ? 'text-cyan-400 border-b-2 border-cyan-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <RotateCcw className="w-4 h-4 mb-1" />
          <span>Events</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ── APPROVALS (batch AI) ─────────────────────────────────────── */}
        {tab === 'approvals' && (
          pendingCommands.length > 0 ? (
            pendingCommands.map((cmd) => (
              <div key={cmd.id} className="bg-zinc-950 p-3 rounded-lg border border-amber-500/30">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-amber-500">{cmd.intent}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{(cmd.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-zinc-400 italic line-clamp-2 mb-3">"{cmd.sourceText}"</p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => rejectCommand(cmd.id)}
                    className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-zinc-900 hover:bg-red-500/20 text-red-400 rounded transition-colors text-xs font-medium"
                  >
                    <X className="w-3 h-3" />
                    <span>Reject</span>
                  </button>
                  <button
                    onClick={() => approveCommand(cmd.id)}
                    className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-zinc-900 hover:bg-emerald-500/20 text-emerald-400 rounded transition-colors text-xs font-medium"
                  >
                    <Check className="w-3 h-3" />
                    <span>Approve</span>
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-600 text-center mt-4">No pending approvals.</div>
          )
        )}

        {tab === 'history' && (
          history.length > 0 ? (
            history.map((scripture, i) => (
              <div
                key={i}
                onClick={() => setPreview(scripture)}
                className="cursor-pointer group bg-zinc-950 p-3 rounded-lg border border-zinc-800/50 hover:border-indigo-500/50 transition-colors"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium text-zinc-200 group-hover:text-indigo-400 transition-colors">
                    {scripture.book} {scripture.chapter}:{scripture.verse}
                    {scripture.endVerse ? `-${scripture.endVerse}` : ''}
                  </span>
                  <span className="text-xs text-zinc-600">{scripture.version}</span>
                </div>
                <p className="text-xs text-zinc-500 line-clamp-2">"{scripture.text}"</p>
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-600 text-center mt-4">No recent history.</div>
          )
        )}

        {tab === 'activity' && (
          activityLog.length > 0 ? (
            activityLog.map((log) => (
              <div key={log.id} className={`text-sm p-3 rounded-lg border ${log.type === 'error' ? 'bg-red-950/30 border-red-900/50 text-red-400' : log.type === 'warning' ? 'bg-amber-950/30 border-amber-900/50 text-amber-400' : log.type === 'success' ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-400' : 'bg-zinc-950 border-zinc-800/50 text-zinc-400'}`}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] uppercase font-bold opacity-50">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                {log.message}
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-600 text-center mt-4">No activity yet.</div>
          )
        )}

        {tab === 'transcripts' && (
          transcripts.length > 0 ? (
            [...transcripts].reverse().map((t) => (
              <div key={t.id} className={`text-sm p-3 rounded-lg border ${t.isFinal ? 'bg-zinc-950 border-zinc-800/50 text-zinc-300' : 'bg-zinc-900 border-indigo-500/30 text-zinc-400 italic'}`}>
                {t.text}
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-600 text-center mt-4">Waiting for speech...</div>
          )
        )}

        {tab === 'commands' && (
          commands.length > 0 ? (
            commands.map((cmd) => (
              <div key={cmd.id} className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-bold text-emerald-500">{cmd.intent}</span>
                  <span className="text-[10px] text-zinc-500 font-mono">{(cmd.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-zinc-400 italic line-clamp-2">"{cmd.sourceText}"</p>
                {cmd.payload && (
                  <pre className="mt-2 text-[10px] text-zinc-500 bg-zinc-900 p-2 rounded overflow-x-auto">
                    {JSON.stringify(cmd.payload, null, 2)}
                  </pre>
                )}
              </div>
            ))
          ) : (
            <div className="text-sm text-zinc-600 text-center mt-4">No commands detected.</div>
          )
        )}

        {tab === 'latency' && (
          <div className="space-y-3">
            <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Trigger Latency Optimizer</p>
                <button
                  onClick={clearLatencySamples}
                  disabled={latencySamples.length === 0}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              </div>
              <div className="grid grid-cols-2 gap-y-1 text-[11px]">
                <span className="text-zinc-500">Audio -&gt; Transcript</span>
                <span className="text-zinc-200 text-right">{msLabel(audioToTranscript)}</span>
                <span className="text-zinc-500">Transcript -&gt; Intent</span>
                <span className="text-zinc-200 text-right">{msLabel(transcriptToIntent)}</span>
                <span className="text-zinc-500">Intent -&gt; Preview</span>
                <span className="text-zinc-200 text-right">{msLabel(intentToPreview)}</span>
                <span className="text-zinc-500">Preview -&gt; Live</span>
                <span className="text-zinc-200 text-right">{msLabel(previewToLive)}</span>
                <span className="text-zinc-500">Total -&gt; Live</span>
                <span className="text-emerald-300 text-right">{msLabel(totalToLive)}</span>
              </div>
              <p className="text-[10px] text-zinc-500 mt-2">
                Showing averages from latest {recentSamples.length} samples.
              </p>
            </div>

            {recentSamples.length === 0 ? (
              <div className="text-sm text-zinc-600 text-center mt-4">No latency samples yet.</div>
            ) : (
              recentSamples.slice(0, 20).map((sample) => (
                <div key={sample.id} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/50 text-[10px] space-y-1">
                  <div className="flex justify-between text-zinc-500">
                    <span>{new Date(sample.timestamp).toLocaleTimeString()}</span>
                    <span>{sample.provider || 'unknown'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-y-0.5">
                    <span className="text-zinc-500">A-&gt;T</span><span className="text-zinc-300 text-right">{msLabel(sample.audioToTranscriptMs ?? null)}</span>
                    <span className="text-zinc-500">T-&gt;I</span><span className="text-zinc-300 text-right">{msLabel(sample.transcriptToIntentMs ?? null)}</span>
                    <span className="text-zinc-500">I-&gt;P</span><span className="text-zinc-300 text-right">{msLabel(sample.intentToPreviewMs ?? null)}</span>
                    <span className="text-zinc-500">P-&gt;L</span><span className="text-zinc-300 text-right">{msLabel(sample.previewToLiveMs ?? null)}</span>
                    <span className="text-zinc-500">Total</span><span className="text-emerald-300 text-right">{msLabel(sample.totalToLiveMs ?? null)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'events' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">Session Events + Replay</p>
              <button
                onClick={clearSessionEvents}
                disabled={sessionEvents.length === 0}
                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-40"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </div>
            {sessionEvents.length === 0 ? (
              <div className="text-sm text-zinc-600 text-center mt-4">No session events yet.</div>
            ) : (
              sessionEvents.map((event) => (
                <div key={event.id} className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/50">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-zinc-200">{event.label}</p>
                      <p className="text-[10px] text-zinc-500">
                        {new Date(event.timestamp).toLocaleTimeString()} · {event.type}
                      </p>
                    </div>
                    {(event.scripture || event.type === 'clear') && (
                      <button
                        onClick={() => replaySessionEvent(event.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-cyan-900/30 hover:bg-cyan-900/45 text-cyan-300 border border-cyan-800/40"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Replay
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
