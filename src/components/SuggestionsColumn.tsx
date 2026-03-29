import { Lightbulb, Check, X } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function SuggestionsColumn() {
  const { suggestions, approveSuggestion, dismissSuggestion } = useStore();

  return (
    <div className="w-64 bg-zinc-900 border-l border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center space-x-2">
          <Lightbulb className="w-4 h-4 text-violet-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-400">
            Suggestions
          </span>
        </div>
        {suggestions.length > 0 && (
          <span className="text-[10px] font-mono bg-violet-500/20 text-violet-300 px-1.5 py-0.5 rounded">
            {suggestions.length}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-[10px] text-zinc-600 px-4 pt-3 pb-1 leading-relaxed">
        Verses inferred from spoken content. Not an explicit reference — approve to push to preview.
      </p>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {suggestions.length === 0 ? (
          <div className="text-xs text-zinc-600 text-center mt-6">No suggestions yet.</div>
        ) : (
          suggestions.map((s) => (
            <div
              key={s.id}
              className="bg-zinc-950 p-3 rounded-lg border border-violet-500/30"
            >
              {/* Reference + confidence */}
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-bold text-violet-300">
                  {s.scripture.book} {s.scripture.chapter}:{s.scripture.verse}
                  {s.scripture.endVerse ? `–${s.scripture.endVerse}` : ''}
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  {Math.round(s.confidence * 100)}%
                </span>
              </div>

              {/* Verse text preview */}
              <p className="text-xs text-zinc-500 line-clamp-2 italic mb-3">
                "{s.scripture.text}"
              </p>

              {/* Action buttons */}
              <div className="flex space-x-1.5">
                <button
                  onClick={() => dismissSuggestion(s.id)}
                  className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-zinc-900 hover:bg-red-500/20 text-red-400 rounded transition-colors text-xs font-medium"
                >
                  <X className="w-3 h-3" />
                  <span>Dismiss</span>
                </button>
                <button
                  onClick={() => approveSuggestion(s.id)}
                  className="flex-1 flex items-center justify-center space-x-1 py-1.5 bg-zinc-900 hover:bg-violet-500/20 text-violet-400 rounded transition-colors text-xs font-medium"
                >
                  <Check className="w-3 h-3" />
                  <span>Preview</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
