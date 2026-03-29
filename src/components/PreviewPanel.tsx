import { useStore } from '../store/useStore';
import ManualSearch from './ManualSearch';
import RunSheetPanel from './RunSheetPanel';
import ProgramMonitorPanel from './ProgramMonitorPanel';

export default function PreviewPanel() {
  const { commands, mode, isAutoPaused } = useStore();
  const latestCommand = commands[0];

  return (
    <div className="flex-1 flex flex-col bg-zinc-950 p-6 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Operator Preview</h2>
        {latestCommand && mode === 'auto' && !isAutoPaused && (
          <div className="flex items-center space-x-2 text-xs">
            <span className="text-zinc-500">Latest Intent:</span>
            <span className="text-indigo-400 font-mono bg-indigo-500/10 px-2 py-1 rounded">{latestCommand.intent}</span>
          </div>
        )}
      </div>

      <div className="mb-4">
        <ManualSearch />
      </div>

      <div className="flex-1 min-h-0">
        <ProgramMonitorPanel />
      </div>

      <div className="mt-4">
        <RunSheetPanel />
      </div>
    </div>
  );
}
