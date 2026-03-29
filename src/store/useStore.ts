import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AppState,
  Theme,
  OutputTarget,
  DEFAULT_ELEMENTS,
  ConfirmedRef,
  Settings,
  Scripture,
  Command,
  PastorVoiceProfile,
  AppUserProfile,
} from '../types';
import { getNextVerse, getPrevVerse, getScripture, searchVersesByContent } from '../lib/bibleEngine';
import { interpretTranscript } from '../lib/commandInterpreter';
import { executeCommand } from '../lib/commandExecutor';
import { referenceStateEngine } from '../lib/interpreter/ReferenceStateEngine';
import type { AIResponse } from '../lib/interpreter/types';
import { isMissingObsHandlerError, triggerObsGoLiveDirect } from '../lib/obs/obsDirectClient';

// ── Fast-path scripture extraction ───────────────────────────────────────────
// After the scriptureNormalizer converts "John ten ten" → "John 10:10", the
// transcript already contains a clean Book C:V string.  If we can regex-match
// it here we can set the reference immediately without waiting for the AI,
// which occasionally misclassifies explicit verse mentions as commentary
// (e.g. "of John 10:10 that Jesus promised" → AI Rule 5 fires → no_action).

/** Canonical book names the normalizer may output. */
const BIBLE_BOOKS = new Set([
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles',
  'Ezra','Nehemiah','Esther','Job','Psalms','Psalm','Proverbs','Ecclesiastes',
  'Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel',
  'Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk',
  'Zephaniah','Haggai','Zechariah','Malachi',
  'Matthew','Mark','Luke','John','Acts','Romans',
  '1 Corinthians','2 Corinthians','Galatians','Ephesians','Philippians',
  'Colossians','1 Thessalonians','2 Thessalonians','1 Timothy','2 Timothy',
  'Titus','Philemon','Hebrews','James','1 Peter','2 Peter',
  '1 John','2 John','3 John','Jude','Revelation',
]);

/**
 * Scan a normalizer-processed transcript for the first explicit Book C:V pattern.
 * Returns the parsed components, or null if no complete verse reference found.
 * Only matches against the canonical BIBLE_BOOKS set to avoid false positives.
 */
function extractNormalizedRef(
  text: string,
): { book: string; chapter: number; verse: number; endVerse?: number } | null {
  // Matches: (optional "1 "/"2 "/"3 ") + CapWord(s) + space + digits:digits(-digits)?
  const RE = /\b((?:[123]\s+)?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(\d{1,3}):(\d{1,3})(?:\s*-\s*(\d{1,3}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(text)) !== null) {
    const book    = m[1].replace(/\s+/g, ' ').trim();
    const chapter = parseInt(m[2], 10);
    const verse   = parseInt(m[3], 10);
    const endVerse = m[4] ? parseInt(m[4], 10) : undefined;
    if (BIBLE_BOOKS.has(book)) {
      return { book, chapter, verse, endVerse };
    }
  }
  return null;
}

/** True when a fast-path ref is identical to what's already confirmed (dedup). */
function fastRefMatchesConfirmed(
  ref:       { book: string; chapter: number; verse: number },
  confirmed: ConfirmedRef | null,
): boolean {
  if (!confirmed) return false;
  return (
    confirmed.book?.toLowerCase() === ref.book.toLowerCase() &&
    confirmed.chapter === ref.chapter &&
    confirmed.verseStart === ref.verse
  );
}

function normalizeBookName(book: string): string {
  return book.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sourceMentionsBook(sourceText: string, book: string): boolean {
  const sourceLower = sourceText.toLowerCase();
  const bookLower = book.toLowerCase();
  if (sourceLower.includes(bookLower)) return true;

  const compactSource = sourceLower.replace(/[^a-z0-9]/g, '');
  if (compactSource.includes(normalizeBookName(book))) return true;

  // Common alias symmetry: Psalm <-> Psalms
  if ((bookLower === 'psalm' && /\bpsalms\b/.test(sourceLower)) || (bookLower === 'psalms' && /\bpsalm\b/.test(sourceLower))) {
    return true;
  }
  return false;
}

const BOOK_KEYWORDS = Array.from(BIBLE_BOOKS).map((b) => b.toLowerCase());

function hasScriptureIntentCue(text: string): boolean {
  const lower = text.toLowerCase();
  if (!lower.trim()) return false;

  if (/\b(?:next verse|previous verse|go back|continue(?: reading)?|carry on|move forward)\b/.test(lower)) {
    return true;
  }
  if (/\b(?:chapter|verse|translation|version|niv|kjv|esv|nkjv|nasb|nlt)\b/.test(lower)) {
    return true;
  }
  if (/\b\d{1,3}:\d{1,3}(?:-\d{1,3})?\b/.test(lower)) {
    return true;
  }
  if (/\b\d{3,4}\b/.test(lower)) {
    return true;
  }

  return BOOK_KEYWORDS.some((book) => lower.includes(book));
}

function isSameScriptureRef(a: Scripture | null | undefined, b: Scripture | null | undefined): boolean {
  if (!a || !b) return false;
  return (
    normalizeBookName(a.book) === normalizeBookName(b.book) &&
    a.chapter === b.chapter &&
    a.verse === b.verse &&
    (a.endVerse ?? null) === (b.endVerse ?? null)
  );
}

function getAutoLiveGuardrailReason(
  settings: Settings,
  liveScripture: Scripture | null,
  nextScripture: Scripture | null,
  command: Command,
): string | null {
  if (!liveScripture || !nextScripture) return null;

  const sameBook = normalizeBookName(liveScripture.book) === normalizeBookName(nextScripture.book);
  const sameChapter = liveScripture.chapter === nextScripture.chapter;
  const chapterDelta = Math.abs(nextScripture.chapter - liveScripture.chapter);

  if (settings.enableConfidenceGuardrails) {
    // Prevent surprise cross-book jumps unless the target book was explicitly spoken.
    if (!sameBook && !sourceMentionsBook(command.sourceText ?? '', nextScripture.book)) {
      return `book change to ${nextScripture.book} without explicit spoken book`;
    }
    // Large chapter jumps are often accidental mis-parses in live sermons.
    if (sameBook && chapterDelta > 1) {
      return `large chapter jump (${liveScripture.chapter} -> ${nextScripture.chapter})`;
    }
  }

  if (settings.verseLockEnabled) {
    if (!sameBook || !sameChapter) {
      return `verse lock active (stays on ${liveScripture.book} ${liveScripture.chapter})`;
    }

    const liveStart = liveScripture.verse;
    const liveEnd = liveScripture.endVerse ?? liveScripture.verse;
    const nextStart = nextScripture.verse;
    const nextEnd = nextScripture.endVerse ?? nextScripture.verse;

    const isSameVerse = nextStart === liveStart && nextEnd === liveEnd;
    const isSmartContinue = nextStart === (liveEnd + 1);
    const isOneVerseBack = nextStart === (liveStart - 1) && nextEnd === (liveStart - 1);

    if (!isSameVerse && !isSmartContinue && !isOneVerseBack) {
      return `verse lock allows only adjacent verse moves (current ${liveStart}${liveScripture.endVerse ? `-${liveEnd}` : ''})`;
    }
  }

  return null;
}

function cloneDefaultElements(): Theme['elements'] {
  return {
    scripture: { ...DEFAULT_ELEMENTS.scripture },
    reference: { ...DEFAULT_ELEMENTS.reference },
    boxes: [],
  };
}

function normalizeThemeElements(elements: any): Theme['elements'] {
  const defaults = cloneDefaultElements();
  const source = elements ?? {};
  const boxes = Array.isArray(source.boxes) ? source.boxes : [];

  return {
    scripture: { ...defaults.scripture, ...(source.scripture || {}) },
    reference: { ...defaults.reference, ...(source.reference || {}) },
    boxes: boxes.map((box: any, index: number) => ({
      id: typeof box?.id === 'string' && box.id.trim() ? box.id : crypto.randomUUID(),
      x: typeof box?.x === 'number' ? box.x : 10 + index * 2,
      y: typeof box?.y === 'number' ? box.y : 10 + index * 2,
      width: typeof box?.width === 'number' ? box.width : 30,
      height: typeof box?.height === 'number' ? box.height : 20,
      visible: box?.visible !== false,
      zIndex: typeof box?.zIndex === 'number' ? box.zIndex : 10 + index,
      fillColor: typeof box?.fillColor === 'string' ? box.fillColor : '#000000',
      fillOpacity: typeof box?.fillOpacity === 'number' ? box.fillOpacity : 40,
      borderRadius: typeof box?.borderRadius === 'number' ? box.borderRadius : 0,
      imageUrl: typeof box?.imageUrl === 'string' ? box.imageUrl : '',
    })),
  };
}

function makeDefaultTheme(name = 'Default Theme'): Theme {
  return {
    id: crypto.randomUUID(),
    name,
    settings: {
      theme: 'dark',
      layout: 'custom',
      fontFamily: 'serif',
      fontScale: 1,
      textAlignment: 'center',
      padding: 48,
      referenceVisible: true,
      versionVisible: true,
      backgroundStyle: 'solid',
      lowerThirdPosition: 'bottom-center',
      broadcastSafe: false,
      backgroundColor: '',
      backgroundOpacity: 100,
      textColor: '',
      referenceColor: '',
      textShadow: false,
      verseQuotes: false,
    },
    elements: cloneDefaultElements(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeVoiceProfileFromSettings(name: string, settings: Settings): PastorVoiceProfile {
  return {
    id: crypto.randomUUID(),
    name,
    highConfidenceThreshold: settings.highConfidenceThreshold,
    mediumConfidenceThreshold: settings.mediumConfidenceThreshold,
    enableConfidenceGuardrails: settings.enableConfidenceGuardrails,
    verseLockEnabled: settings.verseLockEnabled,
    aiCueGateEnabled: settings.aiCueGateEnabled,
    suggestionCooldownMs: settings.suggestionCooldownMs,
  };
}

function getDefaultVoiceProfiles(): PastorVoiceProfile[] {
  return [
    {
      id: 'vp-balanced',
      name: 'Balanced',
      highConfidenceThreshold: 0.8,
      mediumConfidenceThreshold: 0.6,
      enableConfidenceGuardrails: true,
      verseLockEnabled: false,
      aiCueGateEnabled: true,
      suggestionCooldownMs: 2500,
    },
    {
      id: 'vp-fast-sermon',
      name: 'Fast Sermon',
      highConfidenceThreshold: 0.75,
      mediumConfidenceThreshold: 0.55,
      enableConfidenceGuardrails: true,
      verseLockEnabled: false,
      aiCueGateEnabled: true,
      suggestionCooldownMs: 2000,
    },
    {
      id: 'vp-conservative',
      name: 'Conservative',
      highConfidenceThreshold: 0.85,
      mediumConfidenceThreshold: 0.7,
      enableConfidenceGuardrails: true,
      verseLockEnabled: true,
      aiCueGateEnabled: true,
      suggestionCooldownMs: 3500,
    },
  ];
}

const DEFAULT_RUNSHEET_AUTO = {
  enabled: false,
  intervalSec: 15,
};

const DEFAULT_TRANSITION_SETTINGS = {
  style: 'cut' as const,
  durationMs: 600,
  stingerLabel: 'Default Stinger',
};

const DEFAULT_OUTPUT_TARGETS: OutputTarget[] = [{
  id: 'main',
  label: 'Main Output',
  type: 'window',
  displayId: null,
  themeId: null,
  enabled: true,
  windowOpen: false,
}];

const DEFAULT_SETTINGS: Settings = {
  deviceId: 'default',
  providerId: 'browser',
  openaiApiKey: '',
  googleSttApiKey: '',
  chatgptApiKey: '',
  deepgramApiKey: '',
  highConfidenceThreshold: 0.8,
  mediumConfidenceThreshold: 0.6,
  enableConfidenceGuardrails: true,
  verseLockEnabled: false,
  aiCueGateEnabled: true,
  suggestionCooldownMs: 2500,
  remoteControl: {
    enabled: false,
    port: 4217,
    token: '',
  },
  obsAutomation: {
    enabled: false,
    triggerOnGoLive: true,
    targets: [],
  },
  presentation: {
    theme: 'dark',
    layout: 'full-scripture',
    fontFamily: 'serif',
    fontScale: 1,
    textAlignment: 'center',
    padding: 48,
    referenceVisible: true,
    versionVisible: true,
    backgroundStyle: 'solid',
    lowerThirdPosition: 'bottom-center',
    broadcastSafe: false,
    backgroundColor: '',
    backgroundOpacity: 100,
    textColor: '',
    referenceColor: '',
    textShadow: false,
    verseQuotes: false,
  },
  targetDisplayId: null,
  hotkeys: {
    nextVerse: { key: 'ArrowRight', modifiers: [], action: 'nextVerse' },
    prevVerse: { key: 'ArrowLeft', modifiers: [], action: 'prevVerse' },
    goLive: { key: 'Enter', modifiers: ['ctrl'], action: 'goLive' },
    toggleFreeze: { key: 'f', modifiers: ['ctrl'], action: 'toggleFreeze' },
    clearLive: { key: 'Escape', modifiers: [], action: 'clearLive' },
    toggleAutoPause: { key: 'p', modifiers: ['ctrl'], action: 'toggleAutoPause' },
  },
};

const DEFAULT_USER_PROFILE_ID = 'profile-default';

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    remoteControl: { ...settings.remoteControl },
    obsAutomation: {
      enabled: settings.obsAutomation?.enabled ?? false,
      triggerOnGoLive: settings.obsAutomation?.triggerOnGoLive ?? true,
      targets: Array.isArray(settings.obsAutomation?.targets)
        ? settings.obsAutomation.targets.map((target) => ({ ...target }))
        : [],
    },
    presentation: { ...settings.presentation },
    hotkeys: Object.fromEntries(
      Object.entries(settings.hotkeys || {}).map(([k, v]) => [k, { ...v, modifiers: [...(v.modifiers || [])] }]),
    ),
  };
}

function cloneOutputTargets(targets: OutputTarget[]): OutputTarget[] {
  return (targets || []).map((target) => ({ ...target }));
}

function buildUserProfileSnapshot(
  state: {
    settings: Settings;
    version: string;
    mode: 'auto' | 'manual';
    runSheetAuto: { enabled: boolean; intervalSec: number };
    transitionSettings: { style: 'cut' | 'fade' | 'stinger'; durationMs: number; stingerLabel: string };
    activeThemeId: string | null;
    activeVoiceProfileId: string | null;
    outputTargets: OutputTarget[];
  },
  name: string,
  id?: string,
  avatarDataUrl?: string,
): AppUserProfile {
  return {
    id: id || crypto.randomUUID(),
    name,
    avatarDataUrl,
    settings: cloneSettings(state.settings),
    version: state.version,
    mode: state.mode,
    runSheetAuto: { ...state.runSheetAuto },
    transitionSettings: { ...state.transitionSettings },
    activeThemeId: state.activeThemeId,
    activeVoiceProfileId: state.activeVoiceProfileId,
    outputTargets: cloneOutputTargets(state.outputTargets),
    updatedAt: Date.now(),
  };
}

let transitionTimer: ReturnType<typeof setTimeout> | null = null;
let lastFinalTranscriptAt: number | null = null;
let lastIntentAt: number | null = null;
let lastPreviewAt: number | null = null;

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      mode: 'manual',
      isAutoPaused: false,
      isLiveFrozen: false,
      showSimulator: false,
      showThemeDesigner: false,
      themes: [] as Theme[],
      activeThemeId: null as string | null,
      voiceProfiles: getDefaultVoiceProfiles(),
      activeVoiceProfileId: 'vp-balanced',
      userProfiles: [
        buildUserProfileSnapshot({
          settings: DEFAULT_SETTINGS,
          version: 'KJV',
          mode: 'manual',
          runSheetAuto: DEFAULT_RUNSHEET_AUTO,
          transitionSettings: DEFAULT_TRANSITION_SETTINGS,
          activeThemeId: null,
          activeVoiceProfileId: 'vp-balanced',
          outputTargets: DEFAULT_OUTPUT_TARGETS,
        }, 'Default Profile', DEFAULT_USER_PROFILE_ID),
      ],
      activeUserProfileId: DEFAULT_USER_PROFILE_ID,
      outputTargets: cloneOutputTargets(DEFAULT_OUTPUT_TARGETS),
      isListening: false,
      listeningState: 'idle',
      transcriptionStatus: 'ready',
      isMockMode: false,
      settings: cloneSettings(DEFAULT_SETTINGS),
      version: 'KJV',
      availableVersions: ['KJV'],
      previewScripture: null,
      liveScripture: null,
      activityLog: [],
      history: [],
      transcripts: [],
      commands: [],
      pendingCommands: [],
      suggestions: [],
      queue: [],
      runSheetAuto: { ...DEFAULT_RUNSHEET_AUTO },
      transitionSettings: { ...DEFAULT_TRANSITION_SETTINGS },
      transitionRuntime: null,
      themeAssets: [],
      latencySamples: [],
      sessionEvents: [],
      onboardingCompleted: false,
      liveOutputState: {
        targetDisplayId: null,
        windowBounds: null,
        isWindowOpen: false,
        windowStatus: 'closed',
        currentTheme: 'dark',
        currentLayout: 'full-scripture',
        currentScripture: null,
        isFrozen: false,
        previewDiffersFromLive: false,
      },
      availableDisplays: [],
      outputSettings: { providers: {} },
      providerStatuses: {},
      outputLogs: [],
      parsingDiagnostics: [],

      // ── AI Reference State ────────────────────────────────────────────────
      transcriptBuffer: [],
      confirmedRef: null,
      pendingRef: null,
      realtimeCommandSeq: 0,

      setAvailableVersions: (versions) => set({ availableVersions: versions }),
      toggleThemeDesigner: () => set((state) => ({ showThemeDesigner: !state.showThemeDesigner })),

      // ── Theme management ──
      addTheme: (name) => {
        const theme = makeDefaultTheme(name);
        set((state) => ({ themes: [...state.themes, theme] }));
        return theme.id;
      },
      duplicateTheme: (id) => {
        const source = get().themes.find(t => t.id === id);
        if (!source) return '';
        const normalizedElements = normalizeThemeElements(source.elements);
        const copy: Theme = {
          ...source,
          id: crypto.randomUUID(),
          name: `${source.name} (copy)`,
          elements: {
            scripture: { ...normalizedElements.scripture },
            reference: { ...normalizedElements.reference },
            boxes: normalizedElements.boxes.map((box) => ({ ...box })),
          },
          settings: { ...source.settings },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((state) => ({ themes: [...state.themes, copy] }));
        return copy.id;
      },
      updateTheme: (id, updates) => {
        set((state) => ({
          themes: state.themes.map(t =>
            t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
          ),
        }));
      },
      deleteTheme: (id) => {
        set((state) => {
          const newThemes = state.themes.filter(t => t.id !== id);
          const newActiveId = state.activeThemeId === id
            ? (newThemes[0]?.id ?? null)
            : state.activeThemeId;
          return { themes: newThemes, activeThemeId: newActiveId };
        });
      },
      setActiveTheme: (id) => {
        set({ activeThemeId: id });
        if (id) {
          const theme = get().themes.find(t => t.id === id);
          if (theme) {
            // Sync presentation settings to match the chosen theme
            set((state) => ({
              settings: {
                ...state.settings,
                presentation: { ...theme.settings },
              },
            }));
          }
        }
        get().saveCurrentToActiveProfile();
      },
      addVoiceProfileFromCurrent: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return '';
        const profile = makeVoiceProfileFromSettings(trimmed, get().settings);
        set((state) => ({
          voiceProfiles: [...state.voiceProfiles, profile],
          activeVoiceProfileId: profile.id,
        }));
        get().saveCurrentToActiveProfile();
        return profile.id;
      },
      updateVoiceProfileFromCurrent: (id) => {
        set((state) => ({
          voiceProfiles: state.voiceProfiles.map((profile) => {
            if (profile.id !== id) return profile;
            const merged = makeVoiceProfileFromSettings(profile.name, state.settings);
            return { ...merged, id: profile.id, name: profile.name };
          }),
        }));
      },
      removeVoiceProfile: (id) => {
        set((state) => {
          const nextProfiles = state.voiceProfiles.filter((profile) => profile.id !== id);
          const fallbackProfiles = nextProfiles.length > 0 ? nextProfiles : getDefaultVoiceProfiles();
          const activeVoiceProfileId = state.activeVoiceProfileId === id
            ? fallbackProfiles[0]?.id ?? null
            : state.activeVoiceProfileId;
          return {
            voiceProfiles: fallbackProfiles,
            activeVoiceProfileId,
          };
        });
        get().saveCurrentToActiveProfile();
      },
      setActiveVoiceProfile: (id) => {
        const profile = get().voiceProfiles.find((p) => p.id === id);
        if (!profile) return;
        set((state) => ({
          activeVoiceProfileId: id,
          settings: {
            ...state.settings,
            highConfidenceThreshold: profile.highConfidenceThreshold,
            mediumConfidenceThreshold: profile.mediumConfidenceThreshold,
            enableConfidenceGuardrails: profile.enableConfidenceGuardrails,
            verseLockEnabled: profile.verseLockEnabled,
            aiCueGateEnabled: profile.aiCueGateEnabled,
            suggestionCooldownMs: profile.suggestionCooldownMs,
          },
        }));
        get().saveCurrentToActiveProfile();
      },
      createUserProfile: (name) => {
        const trimmed = name.trim();
        const state = get();
        const profileName = trimmed || `Profile ${state.userProfiles.length + 1}`;
        const profile = buildUserProfileSnapshot({
          settings: state.settings,
          version: state.version,
          mode: state.mode,
          runSheetAuto: state.runSheetAuto,
          transitionSettings: state.transitionSettings,
          activeThemeId: state.activeThemeId,
          activeVoiceProfileId: state.activeVoiceProfileId,
          outputTargets: state.outputTargets,
        }, profileName);
        set((s) => ({
          userProfiles: [...s.userProfiles, profile],
          activeUserProfileId: profile.id,
        }));
        return profile.id;
      },
      renameUserProfile: (id, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((state) => ({
          userProfiles: state.userProfiles.map((profile) =>
            profile.id === id
              ? { ...profile, name: trimmed, updatedAt: Date.now() }
              : profile,
          ),
        }));
      },
      setUserProfileAvatar: (id, avatarDataUrl) => {
        set((state) => ({
          userProfiles: state.userProfiles.map((profile) =>
            profile.id === id
              ? { ...profile, avatarDataUrl: avatarDataUrl || undefined, updatedAt: Date.now() }
              : profile,
          ),
        }));
      },
      deleteUserProfile: (id) => {
        const state = get();
        if (state.userProfiles.length <= 1) return;
        const remaining = state.userProfiles.filter((profile) => profile.id !== id);
        if (remaining.length === 0) return;
        const deletingActive = state.activeUserProfileId === id;
        const nextActiveId = deletingActive ? remaining[0].id : (state.activeUserProfileId ?? remaining[0].id);
        const nextProfile = remaining.find((profile) => profile.id === nextActiveId) ?? remaining[0];
        set({
          userProfiles: remaining,
          activeUserProfileId: nextActiveId,
          settings: cloneSettings(nextProfile.settings),
          version: nextProfile.version,
          mode: nextProfile.mode,
          runSheetAuto: { ...nextProfile.runSheetAuto },
          transitionSettings: { ...nextProfile.transitionSettings },
          activeThemeId: nextProfile.activeThemeId,
          activeVoiceProfileId: nextProfile.activeVoiceProfileId,
          outputTargets: cloneOutputTargets(nextProfile.outputTargets),
        });
      },
      setActiveUserProfile: (id) => {
        const profile = get().userProfiles.find((p) => p.id === id);
        if (!profile) return;
        set({
          activeUserProfileId: id,
          settings: cloneSettings(profile.settings),
          version: profile.version,
          mode: profile.mode,
          runSheetAuto: { ...profile.runSheetAuto },
          transitionSettings: { ...profile.transitionSettings },
          activeThemeId: profile.activeThemeId,
          activeVoiceProfileId: profile.activeVoiceProfileId,
          outputTargets: cloneOutputTargets(profile.outputTargets),
        });
      },
      saveCurrentToActiveProfile: () => {
        const state = get();
        const activeId = state.activeUserProfileId;
        if (!activeId) return;
        const currentProfile = state.userProfiles.find((profile) => profile.id === activeId);
        const snapshot = buildUserProfileSnapshot({
          settings: state.settings,
          version: state.version,
          mode: state.mode,
          runSheetAuto: state.runSheetAuto,
          transitionSettings: state.transitionSettings,
          activeThemeId: state.activeThemeId,
          activeVoiceProfileId: state.activeVoiceProfileId,
          outputTargets: state.outputTargets,
        }, currentProfile?.name || 'Profile', activeId, currentProfile?.avatarDataUrl);
        set((s) => ({
          userProfiles: s.userProfiles.map((profile) => profile.id === activeId ? snapshot : profile),
        }));
      },
      // Output target management
      addOutputTarget: () => {
        const id = crypto.randomUUID();
        const target: OutputTarget = {
          id,
          label: `Output ${get().outputTargets.filter(t => !t.type || t.type === 'window').length + 1}`,
          type: 'window',
          displayId: null,
          themeId: null,
          enabled: true,
          windowOpen: false,
        };
        set(state => ({ outputTargets: [...state.outputTargets, target] }));
        get().saveCurrentToActiveProfile();
        return id;
      },
      addNDITarget: () => {
        const id = crypto.randomUUID();
        const ndiCount = get().outputTargets.filter(t => t.type === 'ndi').length;
        const target: OutputTarget = {
          id,
          label: `NDI Output${ndiCount > 0 ? ` ${ndiCount + 1}` : ''}`,
          type: 'ndi',
          displayId: null,
          themeId: null,
          enabled: true,
          windowOpen: false,
          ndiSourceName: ndiCount > 0 ? `ScriptureFlow ${ndiCount + 1}` : 'ScriptureFlow',
        };
        set(state => ({ outputTargets: [...state.outputTargets, target] }));
        get().saveCurrentToActiveProfile();
        return id;
      },
      removeOutputTarget: (id) => {
        set(state => ({ outputTargets: state.outputTargets.filter(t => t.id !== id) }));
        get().saveCurrentToActiveProfile();
        if (typeof window !== 'undefined' && window.electronAPI) {
          window.electronAPI.closeLiveWindow(id);
        }
      },
      updateOutputTarget: (id, updates) => {
        set(state => ({
          outputTargets: state.outputTargets.map(t => t.id === id ? { ...t, ...updates } : t),
        }));
        get().saveCurrentToActiveProfile();
      },

      setMode: (mode) => {
        set({ mode });
        get().saveCurrentToActiveProfile();
      },
      toggleAutoPause: () => set((state) => ({ isAutoPaused: !state.isAutoPaused })),
      toggleFreeze: () => {
        set((state) => {
          const newFrozen = !state.isLiveFrozen;
          get().setLiveOutputState({ isFrozen: newFrozen });
          return { isLiveFrozen: newFrozen };
        });
      },
      toggleSimulator: () => set((state) => ({ showSimulator: !state.showSimulator })),
      setListeningState: (state) => set({ listeningState: state }),
      setTranscriptionStatus: (status) => set({ transcriptionStatus: status }),
      setIsListening: (isListening) => set({ isListening }),
      setIsMockMode: (isMockMode) => set({ isMockMode }),
      updateSettings: (newSettings) => {
        set((state) => ({ settings: { ...state.settings, ...newSettings } }));
        get().saveCurrentToActiveProfile();
      },
      
      setVersion: (version) => {
        set({ version });
        const { previewScripture, liveScripture } = get();
        if (previewScripture) {
          const updated = getScripture(previewScripture.book, previewScripture.chapter, previewScripture.verse, version, previewScripture.endVerse);
          if (updated) set({ previewScripture: updated });
        }
        
        const differs = !previewScripture || !liveScripture || 
          previewScripture.book !== liveScripture.book || 
          previewScripture.chapter !== liveScripture.chapter || 
          previewScripture.verse !== liveScripture.verse ||
          previewScripture.endVerse !== liveScripture.endVerse ||
          version !== liveScripture.version;
          
        get().setLiveOutputState({ previewDiffersFromLive: differs });
        get().saveCurrentToActiveProfile();
      },
      
      setPreview: (scripture) => {
        const now = Date.now();
        set({ previewScripture: scripture });
        if (scripture) {
          get().addToHistory(scripture);
          get().addSessionEvent({
            type: 'preview',
            label: `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`,
            scripture,
          });
          if (lastIntentAt) {
            get().addLatencySample({ intentToPreviewMs: now - lastIntentAt });
          }
          lastPreviewAt = now;
        }
        
        const { liveScripture } = get();
        const differs = !scripture || !liveScripture || 
          scripture.book !== liveScripture.book || 
          scripture.chapter !== liveScripture.chapter || 
          scripture.verse !== liveScripture.verse ||
          scripture.endVerse !== liveScripture.endVerse ||
          get().version !== liveScripture.version;
          
        get().setLiveOutputState({ previewDiffersFromLive: differs });
      },
      
      setLive: (scripture) => {
        if (get().isLiveFrozen) {
          get().logActivity('Cannot update live: Output is frozen', 'warning');
          return;
        }
        if (transitionTimer) {
          clearTimeout(transitionTimer);
          transitionTimer = null;
        }
        set({ transitionRuntime: null });
        set({ liveScripture: scripture });

        // Sync confirmedRef so the AI interpreter always knows what's on screen
        if (scripture) {
          const now = Date.now();
          const label = `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`;
          get().addSessionEvent({ type: 'live', label, scripture });
          if (lastPreviewAt) {
            get().addLatencySample({ previewToLiveMs: now - lastPreviewAt });
          }
          if (lastFinalTranscriptAt) {
            get().addLatencySample({ totalToLiveMs: now - lastFinalTranscriptAt });
          }
          const confirmed: ConfirmedRef = {
            book:        scripture.book,
            chapter:     scripture.chapter,
            verseStart:  scripture.verse,
            verseEnd:    scripture.endVerse,
            translation: scripture.version,
            updatedAt:   Date.now(),
          };
          set({ confirmedRef: confirmed });
        } else {
          set({ confirmedRef: null });
        }

        // Update liveOutputState with primary (main) output info for the status panel
        const { themes: _themes, activeThemeId: _aid, outputTargets: _ot } = get();
        const _mainTarget = _ot.find(t => t.id === 'main') ?? _ot[0];
        const _mainTheme = _themes.find(t => t.id === (_mainTarget?.themeId ?? _aid));
        const _ps2 = _mainTheme?.settings ?? get().settings.presentation;
        get().setLiveOutputState({
          currentScripture: scripture,
          previewDiffersFromLive: false,
          currentTheme: (_ps2?.theme as any) || 'dark',
          currentLayout: (_mainTheme?.elements ? 'custom' : _ps2?.layout) as any || 'full-scripture',
        });

        if (scripture) {
          const { settings, themes, activeThemeId, outputTargets, providerStatuses } = get();
          const content = {
            reference: `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`,
            text: scripture.text,
            version: scripture.version,
          };

          const enabledTargets = outputTargets.filter(t => t.enabled);

          // Helper: build a themed payload for any target — copies the exact theme
          // attached to the output so every property (including backgroundStyle)
          // is faithfully transmitted to the renderer.
          const buildPayload = (target: typeof enabledTargets[0]) => {
            const resolvedTheme = themes.find(t => t.id === (target.themeId ?? activeThemeId));
            const ps = resolvedTheme?.settings ?? settings.presentation;
            const elements = resolvedTheme?.elements;
            return {
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              type: 'scripture' as const,
              content,
              presentation: {
                theme: ps?.theme as any || 'dark',
                layout: (elements ? 'custom' : ps?.layout) as any || 'full-scripture',
                broadcastSafe: ps?.broadcastSafe ?? false,
                backgroundStyle: ps?.backgroundStyle ?? 'solid',
                fontFamily: ps?.fontFamily ?? 'serif',
                fontScale: ps?.fontScale ?? 1,
                textAlignment: ps?.textAlignment ?? 'center',
                padding: ps?.padding ?? 48,
                backgroundColor: ps?.backgroundColor ?? '',
                backgroundOpacity: ps?.backgroundOpacity ?? 100,
                textColor: ps?.textColor ?? '',
                referenceColor: ps?.referenceColor ?? '',
                textShadow: ps?.textShadow ?? false,
                verseQuotes: ps?.verseQuotes ?? false,
              },
              visibility: {
                reference: ps?.referenceVisible ?? true,
                version: ps?.versionVisible ?? true,
              },
              ...(elements ? { elements } : {}),
            };
          };

          if (typeof window !== 'undefined' && window.electronAPI) {
            // Send per-target payload to every enabled channel.
            // Window targets route to their own window id.
            // NDI targets route to per-target offscreen ids: "__ndi__:<targetId>".
            for (const target of enabledTargets) {
              const routeId = target.type === 'ndi' ? `__ndi__:${target.id}` : target.id;
              window.electronAPI.sendToLive(routeId, buildPayload(target));
            }

            // Backward compatibility: if no explicit NDI targets are enabled but the
            // legacy global NDI provider is active, feed the legacy route "__ndi__".
            const hasEnabledNDITarget = enabledTargets.some(t => t.type === 'ndi');
            if (!hasEnabledNDITarget && providerStatuses?.ndi?.status === 'active') {
              const fallbackTarget = enabledTargets.find(t => t.id === 'main')
                ?? enabledTargets.filter(t => !t.type || t.type === 'window')[0]
                ?? enabledTargets[0];
              if (fallbackTarget) {
                window.electronAPI.sendToLive('__ndi__', buildPayload(fallbackTarget));
              }
            }
          }

          // 3. Also notify other output providers (OBS WebSocket, etc.) using
          //    the main window target's theme as the reference payload.
          const primaryTarget = enabledTargets.find(t => t.id === 'main')
            ?? enabledTargets.filter(t => !t.type || t.type === 'window')[0]
            ?? enabledTargets[0];
          if (primaryTarget) {
            import('../lib/output/OutputProviderManager').then(({ outputManager }) => {
              outputManager.updateAll(buildPayload(primaryTarget));
            });
          }

          // 4. Optional OBS scene automation: switch configured OBS targets when
          //    scripture goes live so operators can cut to scripture scenes instantly.
          const obsAutomation = settings.obsAutomation;
          const hasEnabledObsTargets = Array.isArray(obsAutomation?.targets)
            && obsAutomation.targets.some((target) => target?.enabled && target?.host && target?.sceneName);
          if (
            typeof window !== 'undefined'
            && obsAutomation?.enabled
            && obsAutomation.triggerOnGoLive !== false
            && hasEnabledObsTargets
          ) {
            const runObsTrigger = async () => {
              if (window.electronAPI?.obsTriggerGoLive) {
                try {
                  return await window.electronAPI.obsTriggerGoLive({
                    enabled: obsAutomation.enabled,
                    triggerOnGoLive: obsAutomation.triggerOnGoLive,
                    targets: obsAutomation.targets,
                    reference: content.reference,
                  });
                } catch (err: any) {
                  // Mixed-version dev/prod sessions can miss IPC handlers; fall back to direct WS.
                  if (!isMissingObsHandlerError(err)) throw err;
                }
              }
              return triggerObsGoLiveDirect({
                enabled: obsAutomation.enabled,
                triggerOnGoLive: obsAutomation.triggerOnGoLive,
                targets: obsAutomation.targets,
              });
            };

            runObsTrigger().then((result: any) => {
              const rows = Array.isArray(result?.results) ? result.results : [];
              if (rows.length === 0) return;
              const successCount = rows.filter((row: any) => row?.ok).length;
              const failed = rows.filter((row: any) => !row?.ok);
              if (failed.length === 0) {
                get().logActivity(`OBS scene switched on ${successCount} target${successCount === 1 ? '' : 's'}.`, 'success');
                return;
              }
              get().logActivity(
                `OBS scene switch: ${successCount}/${rows.length} succeeded.`,
                'warning',
                failed.slice(0, 3).map((row: any) => `${row?.targetName || row?.targetId}: ${row?.message || 'Unknown error'}`),
              );
            }).catch((err: any) => {
              get().logActivity(`OBS trigger failed: ${err?.message || 'Unknown error'}`, 'error');
            });
          }
        } else {
          get().clearLive();
        }
      },
      
      clearLive: () => {
        if (get().isLiveFrozen) {
          get().logActivity('Cannot clear live: Output is frozen', 'warning');
          return;
        }
        if (transitionTimer) {
          clearTimeout(transitionTimer);
          transitionTimer = null;
        }
        set({ liveScripture: null });
        set({ transitionRuntime: null });
        get().addSessionEvent({ type: 'clear', label: 'Clear live output', scripture: null });
        get().setLiveOutputState({ currentScripture: null, previewDiffersFromLive: get().previewScripture !== null });
        // Clear all enabled output windows.
        const { outputTargets, providerStatuses } = get();
        if (typeof window !== 'undefined' && window.electronAPI) {
          for (const target of outputTargets.filter(t => t.enabled)) {
            const routeId = target.type === 'ndi' ? `__ndi__:${target.id}` : target.id;
            window.electronAPI!.sendToLive(routeId, { type: 'clear' });
          }

          // Backward compatibility for legacy global NDI provider route.
          const hasEnabledNDITarget = outputTargets.some(t => t.enabled && t.type === 'ndi');
          if (!hasEnabledNDITarget && providerStatuses?.ndi?.status === 'active') {
            window.electronAPI!.sendToLive('__ndi__', { type: 'clear' });
          }
        }
        import('../lib/output/OutputProviderManager').then(({ outputManager }) => {
          outputManager.clearAll();
        });
        get().logActivity('Cleared live output', 'info');
      },
      
      logActivity: (message, type = 'info', details) => set((state) => ({
        activityLog: [{
          id: Math.random().toString(36).substring(2, 9),
          timestamp: Date.now(),
          message,
          type,
          details
        }, ...state.activityLog].slice(0, 100)
      })),
      
      addToHistory: (scripture) => set((state) => {
        const newHistory = [scripture, ...state.history.filter(s => 
          !(s.book === scripture.book && s.chapter === scripture.chapter && s.verse === scripture.verse && s.endVerse === scripture.endVerse)
        )].slice(0, 50);
        return { history: newHistory };
      }),
      
      nextVerse: () => {
        const { previewScripture, liveScripture } = get();
        if (previewScripture) {
          const next = getNextVerse(previewScripture);
          if (next) {
            get().setPreview(next);
            // If something is already live, navigation arrows also drive the live output
            if (liveScripture) get().setLive(next);
          }
        }
      },

      prevVerse: () => {
        const { previewScripture, liveScripture } = get();
        if (previewScripture) {
          const prev = getPrevVerse(previewScripture);
          if (prev) {
            get().setPreview(prev);
            // If something is already live, navigation arrows also drive the live output
            if (liveScripture) get().setLive(prev);
          }
        }
      },
      
      addTranscript: (transcript) => {
        // Upsert into the display transcripts list (kept for the Feed panel)
        set((state) => {
          const existingIdx = state.transcripts.findIndex(t => t.id === transcript.id);
          let newTranscripts = [...state.transcripts];
          if (existingIdx >= 0) {
            newTranscripts[existingIdx] = transcript;
          } else {
            newTranscripts.push(transcript);
          }
          return { transcripts: newTranscripts.slice(-50) };
        });

        if (!transcript.isFinal) return;

        const ingestAt = Date.now();
        lastFinalTranscriptAt = ingestAt;
        if (typeof transcript.timestamp === 'number' && Number.isFinite(transcript.timestamp)) {
          get().addLatencySample({
            provider: transcript.provider,
            audioToTranscriptMs: Math.max(0, ingestAt - transcript.timestamp),
          });
        }
        get().addSessionEvent({
          type: 'transcript',
          label: transcript.text.slice(0, 140),
          details: {
            provider: transcript.provider,
            confidence: transcript.confidence,
          },
        });

        // ── Maintain the rolling buffer (last 6 final chunks) ─────────────
        set((state) => ({
          transcriptBuffer: [...state.transcriptBuffer, transcript].slice(-6),
        }));

        const { settings, version, transcriptBuffer, confirmedRef, pendingRef, commands } = get();

        // ── Fast-path: explicit Book C:V detected by the normalizer ───────────
        // The scriptureNormalizer already converted "John ten ten" → "John 10:10"
        // before this point.  If the chunk contains a complete, canonical verse
        // reference AND it differs from what is already confirmed, set it
        // immediately — no AI round-trip needed.  This is deterministic and fast
        // (~0 ms vs ~500 ms AI call) and catches cases where the AI would
        // incorrectly classify an explicit verse mention as sermon commentary.
        // Navigation commands (next_verse, etc.) contain no Book C:V pattern so
        // they fall through to the AI path below unchanged.
        {
          const fastRef = extractNormalizedRef(transcript.text);
          if (fastRef && !fastRefMatchesConfirmed(fastRef, confirmedRef)) {
            const label = `${fastRef.book} ${fastRef.chapter}:${fastRef.verse}${fastRef.endVerse ? `-${fastRef.endVerse}` : ''}`;
            get().logActivity(`⚡ Fast-path: ${label}`, 'success');
            get().processCommand({
              id:         `fast-${Date.now()}`,
              intent:     'OPEN_REFERENCE',
              confidence: 0.95,
              payload:    fastRef,
              timestamp:  Date.now(),
              sourceText: transcript.text,
            });
            return; // reference set — no AI call needed for this chunk
          }
        }

        // ── Content-match verse suggestions ───────────────────────────────
        // Fast-path above returned early when a Book C:V was explicit.
        // If we reach here the transcript has NO explicit verse reference —
        // the preacher may be QUOTING scripture without naming it.
        // Run a content-similarity search: if ≥35 % of a verse's distinctive
        // content words appear in this chunk, suggest that verse.
        // Results go to the SUGGEST tab for operator approval, not live display.
        {
          const latestReferenceCommand = commands.find((c) => c.intent === 'OPEN_REFERENCE');
          const inSuggestionCooldown = Boolean(
            latestReferenceCommand &&
            (Date.now() - latestReferenceCommand.timestamp) < settings.suggestionCooldownMs,
          );

          if (!inSuggestionCooldown) {
            const matches = searchVersesByContent(transcript.text, version);
            for (const m of matches) {
              const scripture = getScripture(m.book, m.chapter, m.verse, version);
              if (scripture) {
                const pct = Math.round(m.score * 100);
                get().logActivity(
                  `Suggest: ${m.book} ${m.chapter}:${m.verse} (${pct}% match, ${m.matchCount} words)`,
                  'info',
                );
                get().addSuggestion(scripture, m.score);
              }
            }
          }
        }

        // ── AI path (ChatGPT interpreter) ─────────────────────────────────
        if (settings.chatgptApiKey) {
          // Skip AI entirely for very short/filler chunks (< 4 chars after trim).
          // Single noise words like "um", "uh", "ah" are not worth an API call.
          if (transcript.text.trim().length < 4) return;

          const hasPendingRef = Boolean(pendingRef?.book || pendingRef?.chapter || pendingRef?.verseStart);
          if (settings.aiCueGateEnabled && !hasPendingRef && !hasScriptureIntentCue(transcript.text)) {
            return;
          }

          // Read the freshly updated buffer (includes this transcript)
          const buffer = [...transcriptBuffer, transcript].slice(-6);
          // Snapshot the Realtime generation counter at call-time.  If Realtime fires
          // while this async call is in-flight, the counter will advance and the
          // .then() handler will discard the stale batch result instead of overwriting
          // the correct Realtime navigation.
          const seqAtCallTime = get().realtimeCommandSeq;
          get().logActivity(`AI listening: "${transcript.text.slice(0, 60)}${transcript.text.length > 60 ? '...' : ''}"`, 'info');
          referenceStateEngine
            .process(buffer, confirmedRef, pendingRef, settings.chatgptApiKey, version)
            .then((result) => {
              // Discard this result if Realtime fired while we were waiting —
              // Realtime's detection is more authoritative and already applied.
              if (get().realtimeCommandSeq !== seqAtCallTime) {
                get().logActivity('🤖 AI → skipped (Realtime fired during processing)', 'info');
                return;
              }

              // Apply pendingRef update (undefined = no change, null = clear, object = update)
              if (result.pendingRef !== undefined) {
                set({ pendingRef: result.pendingRef });

                // Log partial-reference assembly stages
                const pr = result.pendingRef;
                if (pr) {
                  if (pr.book && !pr.chapter && !pr.verseStart) {
                    get().logActivity(`🤖 AI → 📖 Book: "${pr.book}" — waiting for chapter…`, 'info');
                  } else if (pr.book && pr.chapter && !pr.verseStart) {
                    get().logActivity(`🤖 AI → 📖 ${pr.book} ${pr.chapter} — waiting for verse…`, 'info');
                  } else if (pr.verseStart) {
                    const ref = `${pr.book ?? '?'} ${pr.chapter ?? '?'}:${pr.verseStart}${pr.verseEnd ? `-${pr.verseEnd}` : ''}`;
                    get().logActivity(`🤖 AI → 📖 Partial: ${ref} — resolving…`, 'info');
                  }
                }
              }

              if (result.command) {
                const pct = Math.round(result.command.confidence * 100);
                const intent = result.command.intent;
                const p = result.command.payload;
                let detail: string = intent;
                if (intent === 'OPEN_REFERENCE' && p) {
                  detail = `${p.book ?? ''} ${p.chapter ?? ''}${p.verse != null ? `:${p.verse}` : ''}${p.endVerse ? `-${p.endVerse}` : ''}`.trim();
                } else if (intent === 'SWITCH_VERSION' && p) {
                  detail = `Switch to ${p.version}`;
                }
                get().logActivity(`🤖 AI → ✅ ${detail} (${pct}%)`, 'success');
                get().processCommand(result.command);
              } else if (result.pendingRef === undefined) {
                // No command and no pending update = truly nothing detected
                get().logActivity('🤖 AI → no action', 'info');
              }
            })
            .catch((err) => {
              console.warn('[AI] Both models failed — falling back to rule-based interpreter:', err);
              get().logActivity(`🤖 AI failed — rule-based fallback: ${err?.message ?? err}`, 'warning');
              // Rule-based fallback
              const command = interpretTranscript(transcript.text);
              if (command) get().processCommand(command);
            });
          return;
        }

        // ── Rule-based fallback (no API key configured) ───────────────────
        const command = interpretTranscript(transcript.text);
        if (command) {
          get().processCommand(command);
        }
      },
      
      /**
       * Called by ListeningCoordinator when the OpenAI Realtime API fires a
       * detect_scripture_command function call.
       *
       * Realtime is the PREVIEW layer only — it updates the operator preview panel
       * immediately (~1 s latency) so the operator can see what's coming.
       * The ChatGPT batch path is the AUTHORITATIVE layer that drives auto-live.
       *
       * No book-verification guards needed here: a wrong preview is harmless —
       * the operator ignores it and the batch path provides the correct reference.
       */
      processRealtimeSignal: (aiResponse: AIResponse) => {
        if (aiResponse.command === 'no_action') return;

        const { version, previewScripture } = get();

        const label = aiResponse.book
          ? `${aiResponse.book}${aiResponse.chapter ? ` ${aiResponse.chapter}` : ''}${aiResponse.verse != null ? `:${aiResponse.verse}` : ''}`
          : aiResponse.command;
        get().logActivity(`⚡ Realtime: "${label}" (${Math.round(aiResponse.confidence * 100)}%)`, 'info');

        let scripture: ReturnType<typeof getScripture> = null;

        if (aiResponse.command === 'set_reference' || aiResponse.command === 'jump_to_verse') {
          const book    = aiResponse.book    ?? previewScripture?.book    ?? null;
          const chapter = aiResponse.chapter ?? previewScripture?.chapter ?? null;
          const verse   = aiResponse.verse   ?? 1;
          if (book && chapter) {
            scripture = getScripture(book, chapter, verse, version, aiResponse.verseEnd);
          }
        } else if (aiResponse.command === 'next_verse') {
          scripture = previewScripture ? getNextVerse(previewScripture) : null;
        } else if (aiResponse.command === 'previous_verse') {
          scripture = previewScripture ? getPrevVerse(previewScripture) : null;
        }

        if (!scripture) {
          get().logActivity(
            `⚡ Realtime → verse not found: ${label} (version=${version} — book name mismatch?)`,
            'warning',
          );
          return;
        }

        const ref = `${scripture.book} ${scripture.chapter}:${scripture.verse}`;

        // Route based on isExplicit flag set by the Realtime model itself:
        //   true  → speaker said the book name aloud → fast preview path
        //   false → reference inferred from verse content/theme → Suggestions panel
        // Default to true when absent (nav commands, legacy) so behaviour is
        // never accidentally restrictive.
        const isExplicit = aiResponse.isExplicit !== false;

        if (isExplicit) {
          get().setPreview(scripture);
          get().logActivity(`⚡ Realtime → preview: ${ref}`, 'success');
        } else {
          get().addSuggestion(scripture, aiResponse.confidence);
          get().logActivity(`⚡ Realtime → suggested: ${ref} (content inference — awaiting approval)`, 'info');
        }

        // Flush the rolling buffer + advance seq so any batch call already
        // in-flight discards its stale result instead of overwriting a fresh result.
        set((state) => ({
          transcriptBuffer: [],
          realtimeCommandSeq: state.realtimeCommandSeq + 1,
        }));
      },

      processCommand: (command) => {
        const { settings, previewScripture, liveScripture, version, isAutoPaused, isLiveFrozen, mode } = get();
        const now = Date.now();
        lastIntentAt = now;
        if (lastFinalTranscriptAt) {
          get().addLatencySample({ transcriptToIntentMs: now - lastFinalTranscriptAt });
        }
        get().addSessionEvent({
          type: 'command',
          label: `${command.intent} (${Math.round(command.confidence * 100)}%)`,
          details: command.payload,
        });
        set((state) => ({ commands: [command, ...state.commands].slice(0, 50) }));
        
        const result = executeCommand(command, previewScripture, version, settings);
        
        const logType = result.confidence >= settings.highConfidenceThreshold ? 'success' : (result.confidence >= settings.mediumConfidenceThreshold ? 'warning' : 'error');
        get().logActivity(`Command: ${command.intent} - ${result.notes}`, logType, { command, result });

        if (result.confidence < settings.mediumConfidenceThreshold) {
          return; // Low confidence, do nothing
        }

        if (result.scripture) {
          get().setPreview(result.scripture);
          if (command.intent === 'SWITCH_VERSION') {
            set({ version: command.payload.version });
          }

          const guardrailReason = result.canUpdateLive
            ? getAutoLiveGuardrailReason(settings, liveScripture, result.scripture, command)
            : null;
          const forceApprovalByGuardrail = Boolean(guardrailReason);
          const mustRequireApproval = result.requiresApproval || forceApprovalByGuardrail;

          if (mustRequireApproval) {
            if (forceApprovalByGuardrail && guardrailReason) {
              get().logActivity(`🛡️ Guardrail held auto-live: ${guardrailReason}`, 'warning');
            }
            set((state) => ({
              pendingCommands: [
                ...state.pendingCommands,
                {
                  ...command,
                  payload: {
                    ...command.payload,
                    resultScripture: result.scripture,
                    ...(guardrailReason ? { guardrailReason } : {}),
                  },
                },
              ],
            }));
          } else if (result.canUpdateLive && mode === 'auto' && !isAutoPaused && !isLiveFrozen) {
            get().goLiveWithTransition(result.scripture);
          }
        }
      },
      
      executeCommand: (_command) => {
        // Legacy method kept for compatibility, now handled in processCommand directly
      },
      
      approveCommand: (id) => {
        const cmd = get().pendingCommands.find(c => c.id === id);
        if (cmd) {
          set((state) => ({ pendingCommands: state.pendingCommands.filter(c => c.id !== id) }));
          get().logActivity(`Approved command: ${cmd.intent}`, 'success');
          
          const { isAutoPaused, isLiveFrozen, mode } = get();
          if (cmd.payload?.resultScripture) {
            get().setPreview(cmd.payload.resultScripture);
            if (mode === 'auto' && !isAutoPaused && !isLiveFrozen) {
              get().goLiveWithTransition(cmd.payload.resultScripture);
            }
          }
        }
      },
      
      rejectCommand: (id) => {
        set((state) => ({ pendingCommands: state.pendingCommands.filter(c => c.id !== id) }));
        get().logActivity(`Rejected command`, 'info');
      },

      // ── Realtime Suggestions ──────────────────────────────────────────────

      addSuggestion: (scripture, confidence) => {
        set((state) => {
          if (isSameScriptureRef(state.previewScripture, scripture) || isSameScriptureRef(state.liveScripture, scripture)) {
            return {};
          }

          const existing = state.suggestions.find((s) => isSameScriptureRef(s.scripture, scripture));
          if (existing) {
            return {
              suggestions: state.suggestions.map((s) => {
                if (s.id !== existing.id) return s;
                return {
                  ...s,
                  confidence: Math.max(s.confidence, confidence),
                  timestamp: Date.now(),
                };
              }),
            };
          }

          return {
            suggestions: [
              { id: crypto.randomUUID(), scripture, confidence, timestamp: Date.now() },
              // Keep latest 10 only - older unactioned suggestions expire naturally.
              ...state.suggestions,
            ].slice(0, 10),
          };
        });
      },

      approveSuggestion: (id) => {
        const suggestion = get().suggestions.find(s => s.id === id);
        if (!suggestion) return;
        set((state) => ({ suggestions: state.suggestions.filter(s => s.id !== id) }));
        get().setPreview(suggestion.scripture);
        const ref = `${suggestion.scripture.book} ${suggestion.scripture.chapter}:${suggestion.scripture.verse}`;
        get().logActivity(`✅ Suggestion approved → preview: ${ref}`, 'success');
      },

      dismissSuggestion: (id) => {
        set((state) => ({ suggestions: state.suggestions.filter(s => s.id !== id) }));
      },

      queueScripture: (scripture) => {
        set((state) => {
          const duplicate = state.queue.some((q) => isSameScriptureRef(q.scripture, scripture));
          if (duplicate) return {};

          return {
            queue: [
              ...state.queue,
              { id: crypto.randomUUID(), scripture, queuedAt: Date.now() },
            ].slice(-30),
          };
        });
        const ref = `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`;
        get().addSessionEvent({ type: 'queue', label: `Queued ${ref}`, scripture });
      },

      queuePreview: () => {
        const scripture = get().previewScripture;
        if (!scripture) return;
        get().queueScripture(scripture);
        const ref = `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`;
        get().logActivity(`Queued: ${ref}`, 'info');
      },

      removeQueuedReference: (id) => {
        set((state) => ({ queue: state.queue.filter((q) => q.id !== id) }));
      },

      clearQueue: () => {
        set({ queue: [] });
      },

      sendQueuedReference: (id) => {
        const state = get();
        if (state.isLiveFrozen) {
          state.logActivity('Cannot send queued item: live output is frozen', 'warning');
          return;
        }
        const idx = state.queue.findIndex((q) => q.id === id);
        if (idx < 0) return;

        const next = state.queue[idx];
        const rest = state.queue.filter((q) => q.id !== id);
        set({ queue: rest });

        get().setPreview(next.scripture);
        get().goLiveWithTransition(next.scripture);

        const ref = `${next.scripture.book} ${next.scripture.chapter}:${next.scripture.verse}${next.scripture.endVerse ? `-${next.scripture.endVerse}` : ''}`;
        get().logActivity(`Queue live: ${ref}`, 'success');
      },

      sendNextQueuedLive: () => {
        const next = get().queue[0];
        if (!next) return;
        get().sendQueuedReference(next.id);
      },

      updateRunSheetAuto: (updates) => {
        set((state) => ({
          runSheetAuto: {
            ...state.runSheetAuto,
            ...updates,
            intervalSec: Math.max(3, Math.min(600, Math.round(updates.intervalSec ?? state.runSheetAuto.intervalSec))),
          },
        }));
        get().saveCurrentToActiveProfile();
      },

      setTransitionSettings: (updates) => {
        set((state) => ({
          transitionSettings: {
            ...state.transitionSettings,
            ...updates,
            durationMs: Math.max(0, Math.min(5000, Math.round(updates.durationMs ?? state.transitionSettings.durationMs))),
          },
        }));
        get().saveCurrentToActiveProfile();
      },

      goLiveWithTransition: (scripture, styleOverride) => {
        if (!scripture) return;
        if (transitionTimer) {
          clearTimeout(transitionTimer);
          transitionTimer = null;
        }

        const state = get();
        const style = (styleOverride ?? state.transitionSettings.style) as typeof state.transitionSettings.style;
        const durationMs = Math.max(0, Math.min(5000, state.transitionSettings.durationMs || 0));

        if (style === 'cut' || durationMs === 0) {
          set({ transitionRuntime: null });
          state.setLive(scripture);
          return;
        }

        const startedAt = Date.now();
        set({
          transitionRuntime: {
            active: true,
            style,
            startedAt,
            endsAt: startedAt + durationMs,
          },
        });
        state.logActivity(
          style === 'stinger'
            ? `Transition: ${state.transitionSettings.stingerLabel} (${durationMs} ms)`
            : `Transition: ${style} (${durationMs} ms)`,
          'info',
        );

        transitionTimer = setTimeout(() => {
          transitionTimer = null;
          set({ transitionRuntime: null });
          get().setLive(scripture);
        }, durationMs);
      },

      addThemeAsset: (asset) => {
        const id = crypto.randomUUID();
        set((state) => ({
          themeAssets: [
            {
              id,
              name: asset.name,
              type: asset.type,
              dataUrl: asset.dataUrl,
              mimeType: asset.mimeType,
              createdAt: Date.now(),
            },
            ...state.themeAssets,
          ].slice(0, 120),
        }));
        get().logActivity(`Theme asset added: ${asset.name}`, 'success');
        return id;
      },

      removeThemeAsset: (id) => {
        set((state) => ({ themeAssets: state.themeAssets.filter((asset) => asset.id !== id) }));
      },

      addLatencySample: (sample) => {
        const now = Date.now();
        set((state) => ({
          latencySamples: [
            {
              id: crypto.randomUUID(),
              timestamp: now,
              ...sample,
            },
            ...state.latencySamples,
          ].slice(0, 400),
        }));
      },

      clearLatencySamples: () => set({ latencySamples: [] }),

      addSessionEvent: (event) => {
        set((state) => ({
          sessionEvents: [
            {
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              ...event,
            },
            ...state.sessionEvents,
          ].slice(0, 500),
        }));
      },

      clearSessionEvents: () => set({ sessionEvents: [] }),

      replaySessionEvent: (id) => {
        const event = get().sessionEvents.find((entry) => entry.id === id);
        if (!event) return;
        if (event.type === 'clear') {
          get().clearLive();
          return;
        }
        if (event.scripture) {
          get().setPreview(event.scripture);
          if (event.type === 'live') {
            get().goLiveWithTransition(event.scripture, 'cut');
          }
        }
      },

      setOnboardingCompleted: (value) => set({ onboardingCompleted: value }),

      // Live Output Actions
      setLiveOutputState: (state) => set((s) => ({ liveOutputState: { ...s.liveOutputState, ...state } })),
      setTargetDisplay: (displayId) => {
        set((state) => ({ settings: { ...state.settings, targetDisplayId: displayId } }));
        get().setLiveOutputState({ targetDisplayId: displayId });
        get().saveCurrentToActiveProfile();
      },
      setLiveWindowBounds: (windowId, bounds) => {
        if (windowId === 'main') get().setLiveOutputState({ windowBounds: bounds });
      },
      setLiveWindowOpen: (isOpen) => get().setLiveOutputState({ isWindowOpen: isOpen, windowStatus: isOpen ? 'open' : 'closed' }),
      setLiveWindowStatus: (windowId, status) => {
        // Update the matching output target's windowOpen field
        set(state => ({
          outputTargets: state.outputTargets.map(t =>
            t.id === windowId
              ? { ...t, windowOpen: status === 'open' || status === 'moved' }
              : t
          ),
        }));
        // For the primary window also update the shared liveOutputState (used by status panel)
        if (windowId === 'main') {
          get().setLiveOutputState({
            windowStatus: status,
            isWindowOpen: status === 'open' || status === 'moved',
          });
        }
      },
      updatePresentationSettings: (settings) => {
        set((state) => ({ 
          settings: { 
            ...state.settings, 
            presentation: { ...(state.settings?.presentation || {}), ...settings } as any
          } 
        }));
        get().setLiveOutputState({ 
          currentTheme: settings?.theme || get().settings?.presentation?.theme || 'dark',
          currentLayout: settings?.layout || get().settings?.presentation?.layout || 'full-scripture'
        });
        get().saveCurrentToActiveProfile();
      },
      setAvailableDisplays: (displays) => set({ availableDisplays: displays }),
      updateHotkey: (action, hotkey) => {
        set((state) => ({
          settings: {
            ...state.settings,
            hotkeys: { ...(state.settings?.hotkeys || {}), [action]: hotkey }
          }
        }));
        get().saveCurrentToActiveProfile();
      },
      removeHotkey: (action) => {
        set((state) => {
          const newHotkeys = { ...(state.settings?.hotkeys || {}) };
          delete newHotkeys[action];
          return { settings: { ...state.settings, hotkeys: newHotkeys } };
        });
        get().saveCurrentToActiveProfile();
      },

      setOutputSettings: (settings) => set((state) => ({ 
        outputSettings: { ...state.outputSettings, ...settings } 
      })),
      registerProvider: (info) => set((state) => ({ 
        providerStatuses: { ...state.providerStatuses, [info.id]: info } 
      })),
      setProviderStatus: (id, status, errorMessage) => set((state) => ({
        providerStatuses: {
          ...state.providerStatuses,
          [id]: { ...state.providerStatuses[id], status, errorMessage }
        }
      })),
      addOutputLog: (log) => set((state) => ({ 
        outputLogs: [log, ...state.outputLogs].slice(0, 100) 
      })),
      addParsingDiagnostic: (diagnostic) => set((state) => ({
        parsingDiagnostics: [diagnostic, ...state.parsingDiagnostics].slice(0, 50)
      }))
    }),
    {
      name: 'scriptureflow-settings',
      partialize: (state) => ({
        settings: state.settings,
        isMockMode: state.isMockMode,
        outputSettings: state.outputSettings,
        themes: state.themes,
        activeThemeId: state.activeThemeId,
        voiceProfiles: state.voiceProfiles,
        activeVoiceProfileId: state.activeVoiceProfileId,
        userProfiles: state.userProfiles,
        activeUserProfileId: state.activeUserProfileId,
        queue: state.queue,
        runSheetAuto: state.runSheetAuto,
        transitionSettings: state.transitionSettings,
        themeAssets: state.themeAssets,
        latencySamples: state.latencySamples,
        sessionEvents: state.sessionEvents,
        onboardingCompleted: state.onboardingCompleted,
        // Persist targets but reset runtime windowOpen to false
        outputTargets: state.outputTargets.map(t => ({ ...t, windowOpen: false })),
      }),
      merge: (persistedState: any, currentState) => {
        const mergedSettings: Settings = {
          ...currentState.settings,
          ...(persistedState.settings || {}),
          presentation: {
            ...(currentState.settings?.presentation || {}),
            ...(persistedState.settings?.presentation || {}),
            verseQuotes: false,
          },
          hotkeys: {
            ...(currentState.settings?.hotkeys || {}),
            ...(persistedState.settings?.hotkeys || {}),
          },
          remoteControl: {
            ...(currentState.settings?.remoteControl || {}),
            ...(persistedState.settings?.remoteControl || {}),
          },
          obsAutomation: {
            ...(currentState.settings?.obsAutomation || {}),
            ...(persistedState.settings?.obsAutomation || {}),
            triggerOnGoLive: persistedState.settings?.obsAutomation?.triggerOnGoLive ?? currentState.settings?.obsAutomation?.triggerOnGoLive ?? true,
            targets: Array.isArray(persistedState.settings?.obsAutomation?.targets)
              ? persistedState.settings.obsAutomation.targets
              : (currentState.settings?.obsAutomation?.targets || []),
          },
        };

        const mergedOutputTargets: OutputTarget[] = persistedState.outputTargets?.length
          ? persistedState.outputTargets.map((t: any) => ({ ...t, windowOpen: false }))
          : cloneOutputTargets(currentState.outputTargets);

        const migratedProfile = buildUserProfileSnapshot({
          settings: mergedSettings,
          version: persistedState.version || currentState.version,
          mode: persistedState.mode || currentState.mode,
          runSheetAuto: {
            ...DEFAULT_RUNSHEET_AUTO,
            ...(persistedState.runSheetAuto || {}),
          },
          transitionSettings: {
            ...DEFAULT_TRANSITION_SETTINGS,
            ...(persistedState.transitionSettings || {}),
          },
          activeThemeId: persistedState.activeThemeId || null,
          activeVoiceProfileId: persistedState.activeVoiceProfileId || currentState.activeVoiceProfileId,
          outputTargets: mergedOutputTargets,
        }, 'Default Profile', DEFAULT_USER_PROFILE_ID, undefined);

        const persistedProfiles = Array.isArray(persistedState.userProfiles)
          ? persistedState.userProfiles.map((profile: any, index: number) => {
              const name = typeof profile?.name === 'string' && profile.name.trim()
                ? profile.name.trim()
                : `Profile ${index + 1}`;
              const settings = profile?.settings
                ? {
                    ...mergedSettings,
                    ...profile.settings,
                    presentation: {
                      ...(mergedSettings.presentation || {}),
                      ...(profile.settings?.presentation || {}),
                      verseQuotes: false,
                    },
                    hotkeys: {
                      ...(mergedSettings.hotkeys || {}),
                      ...(profile.settings?.hotkeys || {}),
                    },
                    remoteControl: {
                      ...(mergedSettings.remoteControl || {}),
                      ...(profile.settings?.remoteControl || {}),
                    },
                    obsAutomation: {
                      ...(mergedSettings.obsAutomation || {}),
                      ...(profile.settings?.obsAutomation || {}),
                      triggerOnGoLive: profile.settings?.obsAutomation?.triggerOnGoLive ?? mergedSettings.obsAutomation?.triggerOnGoLive ?? true,
                      targets: Array.isArray(profile.settings?.obsAutomation?.targets)
                        ? profile.settings.obsAutomation.targets
                        : (mergedSettings.obsAutomation?.targets || []),
                    },
                  }
                : mergedSettings;

              return buildUserProfileSnapshot({
                settings,
                version: profile?.version || migratedProfile.version,
                mode: profile?.mode || migratedProfile.mode,
                runSheetAuto: {
                  ...DEFAULT_RUNSHEET_AUTO,
                  ...(profile?.runSheetAuto || {}),
                },
                transitionSettings: {
                  ...DEFAULT_TRANSITION_SETTINGS,
                  ...(profile?.transitionSettings || {}),
                },
                activeThemeId: profile?.activeThemeId ?? migratedProfile.activeThemeId,
                activeVoiceProfileId: profile?.activeVoiceProfileId ?? migratedProfile.activeVoiceProfileId,
                outputTargets: Array.isArray(profile?.outputTargets) && profile.outputTargets.length > 0
                  ? profile.outputTargets.map((t: any) => ({ ...t, windowOpen: false }))
                  : mergedOutputTargets,
              }, name, profile?.id, typeof profile?.avatarDataUrl === 'string' ? profile.avatarDataUrl : undefined);
            })
          : [];

        const userProfiles = persistedProfiles.length > 0 ? persistedProfiles : [migratedProfile];
        const activeUserProfileId = userProfiles.some((profile) => profile.id === persistedState.activeUserProfileId)
          ? persistedState.activeUserProfileId
          : userProfiles[0].id;
        const activeProfile = userProfiles.find((profile) => profile.id === activeUserProfileId) ?? userProfiles[0];

        return {
          ...currentState,
          ...persistedState,
          outputSettings: {
            ...currentState.outputSettings,
            ...(persistedState.outputSettings || {}),
          },
          themes: (persistedState.themes || []).map((theme: any) => ({
            ...theme,
            settings: theme.settings ? { ...theme.settings, verseQuotes: false } : theme.settings,
            elements: normalizeThemeElements(theme.elements),
          })),
          voiceProfiles: Array.isArray(persistedState.voiceProfiles) && persistedState.voiceProfiles.length > 0
            ? persistedState.voiceProfiles
            : currentState.voiceProfiles,
          activeVoiceProfileId: activeProfile.activeVoiceProfileId || currentState.activeVoiceProfileId,
          userProfiles,
          activeUserProfileId,
          queue: Array.isArray(persistedState.queue) ? persistedState.queue : currentState.queue,
          runSheetAuto: {
            ...DEFAULT_RUNSHEET_AUTO,
            ...(activeProfile.runSheetAuto || {}),
          },
          transitionSettings: {
            ...DEFAULT_TRANSITION_SETTINGS,
            ...(activeProfile.transitionSettings || {}),
          },
          transitionRuntime: null,
          themeAssets: Array.isArray(persistedState.themeAssets) ? persistedState.themeAssets : currentState.themeAssets,
          latencySamples: Array.isArray(persistedState.latencySamples) ? persistedState.latencySamples : currentState.latencySamples,
          sessionEvents: Array.isArray(persistedState.sessionEvents) ? persistedState.sessionEvents : currentState.sessionEvents,
          onboardingCompleted: typeof persistedState.onboardingCompleted === 'boolean'
            ? persistedState.onboardingCompleted
            : currentState.onboardingCompleted,
          outputTargets: cloneOutputTargets(activeProfile.outputTargets).map((target) => ({ ...target, windowOpen: false })),
          settings: cloneSettings(activeProfile.settings),
          version: activeProfile.version,
          mode: activeProfile.mode,
          activeThemeId: activeProfile.activeThemeId,
        };
      }
    }
  )
);



