import React from 'react';
import { useStore } from '../store/useStore';
import ParsingDiagnostics from './ParsingDiagnostics';

const TEST_PHRASES = [
  "Let's open to John 3:16",
  "John three sixteen",
  "Next verse please",
  "Read that in NIV",
  "Continue reading",
  "Go to verse 15",
  "Start from verse 1",
  "Romans chapter 8 verse 28",
  "First Corinthians thirteen verse four",
  "Back one verse",
  "Switch to ESV"
];

export default function DevSimulator() {
  const addTranscript = useStore(state => state.addTranscript);

  const emitPhrase = (text: string) => {
    addTranscript({
      id: Math.random().toString(36).substring(2, 9),
      text,
      timestamp: Date.now(),
      isFinal: true
    });
  };

  return (
    <div className="w-80 bg-zinc-900 border-l border-zinc-800 flex flex-col">
      <div className="p-4 flex-1 overflow-hidden flex flex-col">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4 shrink-0">Dev Simulator</h3>
        <div className="space-y-2 overflow-y-auto flex-1">
          {TEST_PHRASES.map((phrase, i) => (
            <button
              key={i}
              onClick={() => emitPhrase(phrase)}
              className="w-full text-left px-3 py-2 bg-zinc-950 hover:bg-zinc-800 text-zinc-300 text-sm rounded-lg border border-zinc-800 transition-colors"
            >
              "{phrase}"
            </button>
          ))}
        </div>
      </div>
      <ParsingDiagnostics />
    </div>
  );
}
