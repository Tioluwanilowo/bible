import React from 'react';
import { useStore } from '../store/useStore';
import { Terminal } from 'lucide-react';

export default function ParsingDiagnostics() {
  const diagnostics = useStore(state => state.parsingDiagnostics);

  if (!diagnostics || diagnostics.length === 0) return null;

  return (
    <div className="bg-zinc-950 border-t border-zinc-800 p-4 shrink-0 max-h-48 overflow-y-auto">
      <div className="flex items-center space-x-2 mb-2">
        <Terminal className="w-4 h-4 text-zinc-400" />
        <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Parsing Diagnostics</h3>
      </div>
      <div className="space-y-2">
        {diagnostics.map((diag, idx) => (
          <div key={idx} className="bg-zinc-900 rounded p-2 text-xs font-mono">
            <div className="text-zinc-300">Input: "{diag.originalText}"</div>
            <div className="text-zinc-500">Normalized: "{diag.normalizedText}"</div>
            {diag.reference ? (
              <div className="text-emerald-400 mt-1">
                Result: {diag.reference.book} {diag.reference.chapter}:{diag.reference.startVerse}
                {diag.reference.endVerse ? `-${diag.reference.endVerse}` : ''} 
                {diag.reference.version ? ` (${diag.reference.version})` : ''} 
                [Conf: {diag.reference.confidence}]
              </div>
            ) : (
              <div className="text-amber-400 mt-1">Result: No reference detected</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
