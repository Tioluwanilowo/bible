import React, { useState } from 'react';
import { Book, Settings, Mic, TerminalSquare, AlertCircle, Palette } from 'lucide-react';
import { useStore } from '../store/useStore';
import SettingsModal from './SettingsModal';
import { listeningCoordinator } from '../lib/ListeningCoordinator';

export default function Sidebar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { showSimulator, toggleSimulator, showThemeDesigner, toggleThemeDesigner, isListening, listeningState, transcriptionStatus, isMockMode } = useStore();

  const toggleMic = async () => {
    if (isListening) {
      await listeningCoordinator.stopListening();
    } else {
      await listeningCoordinator.startListening();
    }
  };

  return (
    <>
      <div className="w-16 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-4 space-y-8">
        <div className="p-2 bg-indigo-600 rounded-xl relative">
          <Book className="w-6 h-6 text-white" />
          {isMockMode && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-zinc-900" title="Mock Mode Active"></span>
          )}
        </div>
        <div className="flex-1 flex flex-col space-y-4 items-center">
          <button 
            onClick={toggleMic}
            title={isListening ? "Stop Listening" : "Start Listening"}
            className={`p-2 rounded-lg transition-colors relative ${isListening ? 'text-red-500 bg-red-500/10' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
          >
            <Mic className="w-6 h-6" />
            {listeningState === 'initializing' && (
              <span className="absolute top-0 right-0 w-2 h-2 bg-amber-400 rounded-full animate-pulse"></span>
            )}
            {listeningState === 'error' && (
              <AlertCircle className="absolute -top-1 -right-1 w-3 h-3 text-red-500" />
            )}
          </button>
          <button
            onClick={toggleThemeDesigner}
            title="Theme Designer"
            className={`p-2 rounded-lg transition-colors ${showThemeDesigner ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
          >
            <Palette className="w-6 h-6" />
          </button>
          <button
            onClick={toggleSimulator}
            title="Toggle Dev Simulator"
            className={`p-2 rounded-lg transition-colors ${showSimulator ? 'text-indigo-400 bg-indigo-500/10' : 'text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
          >
            <TerminalSquare className="w-6 h-6" />
          </button>
        </div>
        <button 
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors relative"
        >
          <Settings className="w-6 h-6" />
          {transcriptionStatus === 'error' && (
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
          )}
        </button>
      </div>

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </>
  );
}
