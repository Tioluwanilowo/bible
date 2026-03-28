import React from 'react';
import { RadioTower, Eye, Zap } from 'lucide-react';
import { useStore } from '../store/useStore';

function refLabel(scripture: { book: string; chapter: number; verse: number; endVerse?: number; version: string } | null): string {
  if (!scripture) return 'No verse loaded';
  return `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''} (${scripture.version})`;
}

function VerseCard({
  title,
  subtitle,
  text,
  accent,
  icon,
}: {
  title: string;
  subtitle: string;
  text: string;
  accent: string;
  icon: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-6 min-h-[300px] h-full flex flex-col ${accent}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm uppercase tracking-wider font-semibold">{title}</span>
      </div>
      <p className="text-xs text-zinc-400 mb-4">{subtitle}</p>
      <p className="text-lg leading-relaxed text-zinc-100 overflow-y-auto pr-1">
        {text}
      </p>
    </div>
  );
}

export default function ProgramMonitorPanel() {
  const {
    liveScripture,
    previewScripture,
    transitionSettings,
    transitionRuntime,
    setTransitionSettings,
    goLiveWithTransition,
    isLiveFrozen,
  } = useStore();

  const liveText = liveScripture?.text ?? 'Nothing is currently on live output.';
  const previewText = previewScripture?.text ?? 'No preview selected yet.';

  return (
    <div className="w-full flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2 px-1 gap-2">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-zinc-500">Program View</h3>
        <span className="text-[11px] text-zinc-600">Preview (left) + Live (right)</span>
      </div>

      <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-1">Transition</span>
        {(['cut', 'fade', 'stinger'] as const).map((style) => (
          <button
            key={style}
            onClick={() => setTransitionSettings({ style })}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
              transitionSettings.style === style
                ? 'border-indigo-500 bg-indigo-600/20 text-indigo-300'
                : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500'
            }`}
          >
            {style === 'cut' ? 'Cut' : style === 'fade' ? 'Fade' : 'Stinger'}
          </button>
        ))}
        <label className="text-[10px] text-zinc-500 ml-2">Duration</label>
        <input
          type="number"
          min={0}
          max={5000}
          step={50}
          value={transitionSettings.durationMs}
          onChange={(e) => setTransitionSettings({ durationMs: Number(e.target.value) || 0 })}
          className="w-24 bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
        />
        <span className="text-[10px] text-zinc-500">ms</span>
        {transitionSettings.style === 'stinger' && (
          <input
            type="text"
            value={transitionSettings.stingerLabel}
            onChange={(e) => setTransitionSettings({ stingerLabel: e.target.value })}
            className="w-28 bg-zinc-950 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500"
            placeholder="Stinger label"
          />
        )}
        <button
          onClick={() => previewScripture && goLiveWithTransition(previewScripture)}
          disabled={!previewScripture || isLiveFrozen}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white text-xs font-medium transition-colors"
        >
          <Zap className="w-3.5 h-3.5" />
          Send Preview Live
        </button>
        {transitionRuntime?.active && (
          <span className="text-[10px] px-2 py-1 rounded bg-indigo-500/15 text-indigo-300">
            Transition active: {transitionRuntime.style}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 h-full">
        <VerseCard
          title="Preview (Next)"
          subtitle={refLabel(previewScripture)}
          text={previewText}
          accent="bg-indigo-950/25 border-indigo-700/30"
          icon={<Eye className="w-4 h-4 text-indigo-400" />}
        />
        <VerseCard
          title="Live (On Air)"
          subtitle={refLabel(liveScripture)}
          text={liveText}
          accent="bg-red-950/25 border-red-700/30"
          icon={<RadioTower className="w-4 h-4 text-red-400" />}
        />
      </div>
    </div>
  );
}
