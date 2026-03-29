import { useMemo, useState } from 'react';
import { CheckCircle2, User, Users } from 'lucide-react';
import { useStore } from '../store/useStore';

interface ProfileLaunchPickerProps {
  onContinue: () => void;
}

export default function ProfileLaunchPicker({ onContinue }: ProfileLaunchPickerProps) {
  const { userProfiles, activeUserProfileId, setActiveUserProfile } = useStore();
  // Preselect the active profile so Enter/Continue is one click for repeat users.
  const initialId = activeUserProfileId || userProfiles[0]?.id || '';
  const [selectedProfileId, setSelectedProfileId] = useState(initialId);

  const selectedProfile = useMemo(
    () => userProfiles.find((profile) => profile.id === selectedProfileId) ?? userProfiles[0],
    [selectedProfileId, userProfiles],
  );

  const continueWithProfile = () => {
    if (!selectedProfile) return;
    // Persist chosen operator context before the main app UI mounts.
    setActiveUserProfile(selectedProfile.id);
    onContinue();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex items-center justify-center p-5">
      <div className="w-full max-w-3xl rounded-2xl border border-zinc-800 bg-zinc-900 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-indigo-400" />
            <h2 className="text-sm font-semibold text-white">Choose Operator Profile</h2>
          </div>
          <span className="text-[11px] text-zinc-500">{userProfiles.length} profile{userProfiles.length === 1 ? '' : 's'}</span>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-zinc-400">
            Select who is running this session before ScriptureFlow loads.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {userProfiles.map((profile) => {
              const selected = selectedProfile?.id === profile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => setSelectedProfileId(profile.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    selected
                      ? 'border-indigo-500 bg-indigo-500/10'
                      : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full border border-zinc-700 bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {profile.avatarDataUrl ? (
                        <img src={profile.avatarDataUrl} alt={`${profile.name} avatar`} className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-5 h-5 text-zinc-300" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{profile.name}</p>
                      <p className="text-[11px] text-zinc-500">Profile ID: {profile.id.slice(0, 8)}</p>
                    </div>
                    {selected && <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 flex justify-end">
            <button
              onClick={continueWithProfile}
              disabled={!selectedProfile}
              className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
