import React from 'react';
import { useStore } from '../store/useStore';
import ManualSearch from './ManualSearch';

export default function PreviewPanel() {
  const { previewScripture, commands, mode, isAutoPaused } = useStore();
  const latestCommand = commands[0];

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Operator Preview</h2>
        {latestCommand && mode === 'auto' && !isAutoPaused && (
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-zinc-500">Latest Intent:</span>
            <span className="text-indigo-400 font-mono bg-indigo-500/10 px-2 py-1 rounded">{latestCommand.intent}</span>
          </div>
        )}
      </div>
      
      <div className="flex justify-center">
        <ManualSearch />
      </div>

      <div className="flex-1 border border-zinc-800 rounded-2xl bg-zinc-900/50 flex items-center justify-center p-8 relative">
        {previewScripture ? (
          <div className="text-center max-w-2xl">
            <p className="text-3xl font-serif mb-6 leading-relaxed">"{previewScripture.text}"</p>
            <p className="text-xl text-zinc-400 font-medium">
              {previewScripture.book} {previewScripture.chapter}:{previewScripture.verse}
              {previewScripture.endVerse ? `-${previewScripture.endVerse}` : ''}
              <span className="text-zinc-600 text-sm ml-2">{previewScripture.version}</span>
            </p>
          </div>
        ) : (
          <p className="text-zinc-600">Search for a scripture or wait for voice detection.</p>
        )}
      </div>
    </div>
  );
}
