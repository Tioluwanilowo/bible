import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { History, Activity, MessageSquare, Terminal, CheckCircle, Check, X } from 'lucide-react';

export default function ActivityPanel() {
  const {
    activityLog, history, transcripts, commands, pendingCommands,
    setPreview, approveCommand, rejectCommand,
  } = useStore();
  const [tab, setTab] = useState<'history' | 'activity' | 'transcripts' | 'commands' | 'approvals'>('transcripts');

  return (
    <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setTab('transcripts')}
          className={`flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'transcripts' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <MessageSquare className="w-4 h-4 mb-1" />
          <span>Feed</span>
        </button>
        <button
          onClick={() => setTab('commands')}
          className={`flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'commands' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Terminal className="w-4 h-4 mb-1" />
          <span>Cmds</span>
        </button>

        <button
          onClick={() => setTab('approvals')}
          className={`relative flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'approvals' ? 'text-amber-400 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <CheckCircle className="w-4 h-4 mb-1" />
          <span>Approve</span>
          {pendingCommands.length > 0 && (
            <span className="absolute top-2 right-2 w-2 h-2 bg-amber-500 rounded-full"></span>
          )}
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'history' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <History className="w-4 h-4 mb-1" />
          <span>History</span>
        </button>
        <button
          onClick={() => setTab('activity')}
          className={`flex-1 flex flex-col items-center justify-center py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors ${tab === 'activity' ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-zinc-500 hover:text-zinc-300'}`}
        >
          <Activity className="w-4 h-4 mb-1" />
          <span>Log</span>
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

      </div>
    </div>
  );
}
