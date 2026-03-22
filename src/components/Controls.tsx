import React from 'react';
import { useStore } from '../store/useStore';
import { Play, Square, ChevronLeft, ChevronRight, Snowflake, Pause, ListPlus, Send } from 'lucide-react';

export default function Controls() {
  const {
    mode, setMode, version, setVersion, previewScripture, setLive, clearLive,
    isAutoPaused, toggleAutoPause, isLiveFrozen, toggleFreeze,
    nextVerse, prevVerse, availableVersions,
    queue, queuePreview, sendNextQueuedLive,
  } = useStore();

  const handleGoLive = () => {
    if (previewScripture) {
      setLive(previewScripture);
    }
  };

  return (
    <div className="h-20 bg-zinc-900 border-t border-zinc-800 flex items-center justify-between px-6">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <div className="flex bg-zinc-950 rounded-lg p-1 border border-zinc-800">
            <button
              onClick={() => setMode('manual')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'manual' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              Manual
            </button>
            <button
              onClick={() => setMode('auto')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'auto' ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-white'}`}
            >
              Auto Mode
            </button>
          </div>
          
          {mode === 'auto' && (
            <button
              onClick={toggleAutoPause}
              title={isAutoPaused ? "Resume Auto Mode (Ctrl+P)" : "Pause Auto Mode (Ctrl+P)"}
              className={`p-2 rounded-lg transition-colors ${isAutoPaused ? 'bg-amber-500/20 text-amber-500' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
            >
              {isAutoPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
            </button>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <label className="text-xs text-zinc-500 uppercase font-semibold">Version</label>
          <select 
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 text-white text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
          >
            {availableVersions.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-1 mr-4">
          <button 
            onClick={prevVerse}
            disabled={!previewScripture}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
            title="Previous Verse (Left Arrow)"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button 
            onClick={nextVerse}
            disabled={!previewScripture}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
            title="Next Verse (Right Arrow)"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={toggleFreeze}
          className={`flex items-center space-x-2 px-4 py-2 rounded-lg transition-colors font-medium text-sm border ${isLiveFrozen ? 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50' : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white hover:bg-zinc-800'}`}
          title="Freeze Live Output (Ctrl+F)"
        >
          <Snowflake className="w-4 h-4" />
          <span>{isLiveFrozen ? 'Frozen' : 'Freeze'}</span>
        </button>

        <button 
          onClick={clearLive}
          disabled={isLiveFrozen}
          className="flex items-center space-x-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:hover:bg-zinc-800 text-white rounded-lg transition-colors font-medium text-sm"
          title="Clear Live Output (Esc)"
        >
          <Square className="w-4 h-4" />
          <span>Clear</span>
        </button>
        <button
          onClick={queuePreview}
          disabled={!previewScripture}
          className="flex items-center space-x-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-lg transition-colors font-medium text-sm"
          title="Queue current preview"
        >
          <ListPlus className="w-4 h-4" />
          <span>Queue</span>
        </button>
        <button
          onClick={sendNextQueuedLive}
          disabled={queue.length === 0 || isLiveFrozen}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors font-medium text-sm"
          title="Send next queued reference live"
        >
          <Send className="w-4 h-4" />
          <span>Next Live</span>
        </button>
        <button 
          onClick={handleGoLive}
          disabled={!previewScripture || isLiveFrozen}
          className="flex items-center space-x-2 px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors font-medium text-sm"
          title="Go Live (Ctrl+Enter)"
        >
          <Play className="w-4 h-4" />
          <span>Go Live</span>
        </button>
      </div>
    </div>
  );
}
