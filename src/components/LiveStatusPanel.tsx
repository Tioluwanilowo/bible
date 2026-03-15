import React from 'react';
import { useStore } from '../store/useStore';
import { Monitor, MonitorOff, LayoutTemplate, Snowflake, RefreshCw } from 'lucide-react';

export default function LiveStatusPanel() {
  const { liveOutputState, availableDisplays, settings, themes, activeThemeId } = useStore();
  const { windowStatus, targetDisplayId, currentTheme, currentLayout, isFrozen, previewDiffersFromLive } = liveOutputState;
  const activeTheme = themes.find(t => t.id === activeThemeId);

  const targetDisplay = availableDisplays.find(d => d.id === targetDisplayId) || availableDisplays[0];

  return (
    <div className="bg-zinc-900 border-b border-zinc-800 p-4 flex items-center justify-between text-sm">
      <div className="flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          {windowStatus === 'open' || windowStatus === 'moved' ? (
            <Monitor className="w-4 h-4 text-emerald-500" />
          ) : (
            <MonitorOff className="w-4 h-4 text-zinc-500" />
          )}
          <span className="font-medium text-zinc-300">
            {windowStatus === 'open' || windowStatus === 'moved' ? 'Live Window Active' : 'Live Window Closed'}
          </span>
          {targetDisplay && (
            <span className="text-zinc-500 text-xs ml-2 bg-zinc-800 px-2 py-0.5 rounded">
              {targetDisplay.name}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 text-zinc-400">
          <LayoutTemplate className="w-4 h-4" />
          {activeTheme ? (
            <span className="capitalize">
              <span className="text-indigo-400">{activeTheme.name}</span>
              {' • '}
              <span className="text-zinc-400 capitalize">{activeTheme.settings.theme}</span>
            </span>
          ) : (
            <span className="capitalize">{currentTheme} • {currentLayout.replace(/-/g, ' ')}</span>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {isFrozen && (
          <div className="flex items-center space-x-1.5 text-cyan-400 bg-cyan-500/10 px-2.5 py-1 rounded-md border border-cyan-500/20">
            <Snowflake className="w-3.5 h-3.5" />
            <span className="font-medium text-xs uppercase tracking-wider">Frozen</span>
          </div>
        )}
        
        {previewDiffersFromLive && !isFrozen && (
          <div className="flex items-center space-x-1.5 text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="font-medium text-xs uppercase tracking-wider">Update Pending</span>
          </div>
        )}
      </div>
    </div>
  );
}
