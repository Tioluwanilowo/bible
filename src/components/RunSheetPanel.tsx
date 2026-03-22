import React from 'react';
import { ListOrdered, Eye, Send, Trash2, Plus } from 'lucide-react';
import { useStore } from '../store/useStore';

function toReferenceLabel(scripture: { book: string; chapter: number; verse: number; endVerse?: number }): string {
  return `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`;
}

export default function RunSheetPanel() {
  const {
    queue,
    previewScripture,
    queuePreview,
    sendNextQueuedLive,
    sendQueuedReference,
    removeQueuedReference,
    clearQueue,
    setPreview,
    isLiveFrozen,
  } = useStore();

  return (
    <div className="w-full max-w-3xl mb-4 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-zinc-300">
          <ListOrdered className="w-4 h-4 text-indigo-400" />
          <span className="text-xs uppercase tracking-wider font-semibold">Run Sheet</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{queue.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={queuePreview}
            disabled={!previewScripture}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 text-xs text-zinc-200 transition-colors"
            title="Queue the currently previewed scripture"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Queue Current</span>
          </button>
          <button
            onClick={sendNextQueuedLive}
            disabled={queue.length === 0 || isLiveFrozen}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-xs text-white transition-colors"
            title="Send the first queued item live"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Send Next Live</span>
          </button>
          <button
            onClick={clearQueue}
            disabled={queue.length === 0}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-red-500/20 disabled:opacity-40 text-xs text-zinc-300 transition-colors"
            title="Clear all queued references"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {queue.length === 0 ? (
        <p className="text-xs text-zinc-500 px-1 pb-1">
          Queue references for service flow, then send each live in order.
        </p>
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
          {queue.map((item, idx) => (
            <div key={item.id} className="flex items-center justify-between gap-3 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 font-medium truncate">
                  {idx + 1}. {toReferenceLabel(item.scripture)}
                </p>
                <p className="text-[11px] text-zinc-500 truncate line-clamp-1">
                  "{item.scripture.text}"
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setPreview(item.scripture)}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                  title="Load into preview"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => sendQueuedReference(item.id)}
                  disabled={isLiveFrozen}
                  className="p-1.5 rounded hover:bg-emerald-500/20 text-emerald-400 disabled:opacity-40 transition-colors"
                  title="Send this item live now"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => removeQueuedReference(item.id)}
                  className="p-1.5 rounded hover:bg-red-500/20 text-red-400 transition-colors"
                  title="Remove from queue"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
