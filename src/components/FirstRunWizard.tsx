import { useState } from 'react';
import { CheckCircle2, ChevronRight, Mic, Smartphone, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';

export default function FirstRunWizard() {
  const {
    onboardingCompleted,
    setOnboardingCompleted,
    settings,
    updateSettings,
    logActivity,
  } = useStore();
  const [step, setStep] = useState(1);

  if (onboardingCompleted) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">First-Run Setup Wizard</h2>
          </div>
          <span className="text-[11px] text-zinc-500">Step {step}/3</span>
        </div>

        <div className="p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <Mic className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="text-sm text-white font-medium">Audio and transcription</p>
                  <p className="text-xs text-zinc-500 mt-1">Choose the provider you want to start with. You can always change this later.</p>
                </div>
              </div>
              <select
                value={settings.providerId}
                onChange={(e) => updateSettings({ providerId: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-700 text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
              >
                <option value="browser">Browser Speech Recognition</option>
                <option value="google">Google Cloud STT</option>
                <option value="whisper">OpenAI Whisper</option>
                <option value="realtime">OpenAI Realtime</option>
                <option value="deepgram">Deepgram Nova-2</option>
              </select>
              <button
                onClick={() => setStep(2)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <Smartphone className="w-4 h-4 text-cyan-400 mt-0.5" />
                <div>
                  <p className="text-sm text-white font-medium">Operator remote setup</p>
                  <p className="text-xs text-zinc-500 mt-1">Enable local remote control and set your port/token if you use a second device.</p>
                </div>
              </div>
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <span className="text-sm text-zinc-200">Enable Remote Control</span>
                <input
                  type="checkbox"
                  checked={settings.remoteControl.enabled}
                  onChange={(e) => updateSettings({ remoteControl: { ...settings.remoteControl, enabled: e.target.checked } })}
                  className="accent-indigo-500"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min={1024}
                  max={65535}
                  value={settings.remoteControl.port}
                  onChange={(e) => {
                    const parsed = Number(e.target.value);
                    const port = Number.isFinite(parsed) ? Math.min(65535, Math.max(1024, parsed)) : 4217;
                    updateSettings({ remoteControl: { ...settings.remoteControl, port } });
                  }}
                  className="w-full bg-zinc-950 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                  placeholder="Port"
                />
                <input
                  type="text"
                  value={settings.remoteControl.token}
                  onChange={(e) => updateSettings({ remoteControl: { ...settings.remoteControl, token: e.target.value } })}
                  className="w-full bg-zinc-950 border border-zinc-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
                  placeholder="Access token (optional)"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500"
                >
                  Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
                >
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="text-sm text-white font-medium">Ready to go live</p>
                  <p className="text-xs text-zinc-500 mt-1">You can open Settings any time to change routing, transitions, NDI, and remote control.</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-sm hover:border-zinc-500"
                >
                  Back
                </button>
                <button
                  onClick={() => {
                    setOnboardingCompleted(true);
                    logActivity('First-run setup completed', 'success');
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
                >
                  Finish Setup
                </button>
                <button
                  onClick={() => setOnboardingCompleted(true)}
                  className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
                >
                  Skip
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
