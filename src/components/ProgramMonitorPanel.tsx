import React from 'react';
import { RadioTower, Eye } from 'lucide-react';
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
  const { liveScripture, previewScripture } = useStore();

  const liveText = liveScripture?.text ?? 'Nothing is currently on live output.';
  const previewText = previewScripture?.text ?? 'No preview selected yet.';

  return (
    <div className="w-full flex-1 min-h-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-xs uppercase tracking-wider font-semibold text-zinc-500">Program View</h3>
        <span className="text-[11px] text-zinc-600">Preview (left) + Live (right)</span>
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
