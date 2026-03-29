import { useEffect, useRef, useState } from 'react';
import { Settings, Mic, TerminalSquare, AlertCircle, Palette, User } from 'lucide-react';
import { useStore } from '../store/useStore';
import SettingsModal from './SettingsModal';
import { listeningCoordinator } from '../lib/ListeningCoordinator';

export default function Sidebar() {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const {
    showSimulator,
    toggleSimulator,
    showThemeDesigner,
    toggleThemeDesigner,
    isListening,
    listeningState,
    transcriptionStatus,
    isMockMode,
    userProfiles,
    activeUserProfileId,
    setActiveUserProfile,
  } = useStore();
  const activeProfile = userProfiles.find((profile) => profile.id === activeUserProfileId) ?? userProfiles[0];

  useEffect(() => {
    if (!isProfileMenuOpen) return;

    // Keep menu behavior desktop-like: close when clicking away or pressing Escape.
    const handleClickOutside = (event: MouseEvent) => {
      if (!sidebarRef.current) return;
      if (!sidebarRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProfileMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isProfileMenuOpen]);

  const toggleMic = async () => {
    if (isListening) {
      await listeningCoordinator.stopListening();
    } else {
      await listeningCoordinator.startListening();
    }
  };

  return (
    <>
      <div ref={sidebarRef} className="relative w-16 bg-zinc-900 border-r border-zinc-800 flex flex-col items-center py-4 space-y-8">
        <button
          onClick={() => setIsProfileMenuOpen((value) => !value)}
          className="w-10 h-10 rounded-full border border-zinc-700 bg-indigo-600/20 flex items-center justify-center overflow-hidden relative"
          title={`Active profile: ${activeProfile?.name || 'Unknown'} (click to switch)`}
        >
          {activeProfile?.avatarDataUrl ? (
            <img src={activeProfile.avatarDataUrl} alt={`${activeProfile.name} avatar`} className="w-full h-full object-cover" />
          ) : (
            <User className="w-6 h-6 text-white" />
          )}
          {isMockMode && (
            <span className="absolute -top-1 -right-1 w-3 h-3 bg-amber-500 rounded-full border-2 border-zinc-900" title="Mock Mode Active"></span>
          )}
        </button>

        {isProfileMenuOpen && (
          <div className="absolute left-14 top-3 z-50 w-64 rounded-xl border border-zinc-700 bg-zinc-900/95 backdrop-blur shadow-2xl p-2">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">Switch Profile</p>
            <div className="max-h-72 overflow-y-auto space-y-1">
              {userProfiles.map((profile) => {
                const isActive = profile.id === activeUserProfileId;
                return (
                  <button
                    key={profile.id}
                    onClick={() => {
                      // Switching profiles immediately applies that profile's saved settings/state.
                      setActiveUserProfile(profile.id);
                      setIsProfileMenuOpen(false);
                    }}
                    className={`w-full text-left px-2 py-2 rounded-lg border transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-500/15'
                        : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-full border border-zinc-700 bg-zinc-800 overflow-hidden flex items-center justify-center shrink-0">
                      {profile.avatarDataUrl ? (
                        <img src={profile.avatarDataUrl} alt={`${profile.name} avatar`} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-4 h-4 text-zinc-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-white truncate">{profile.name}</p>
                      <p className="text-[10px] text-zinc-500 truncate">{isActive ? 'Active' : 'Click to switch'}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                setIsProfileMenuOpen(false);
                setIsSettingsOpen(true);
              }}
              className="mt-2 w-full px-2 py-1.5 rounded-lg text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Manage Profiles
            </button>
          </div>
        )}

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
