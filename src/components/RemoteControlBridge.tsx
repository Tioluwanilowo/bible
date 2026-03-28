import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { getScripture } from '../lib/bibleEngine';

function referenceLabel(scripture: { book: string; chapter: number; verse: number; endVerse?: number } | null): string {
  if (!scripture) return '';
  return `${scripture.book} ${scripture.chapter}:${scripture.verse}${scripture.endVerse ? `-${scripture.endVerse}` : ''}`;
}

export default function RemoteControlBridge() {
  const {
    settings,
    previewScripture,
    liveScripture,
    queue,
    mode,
    isAutoPaused,
    isLiveFrozen,
  } = useStore();

  useEffect(() => {
    if (!window.electronAPI?.remoteConfigure) return;
    window.electronAPI.remoteConfigure(settings.remoteControl).catch(() => {});
  }, [settings.remoteControl]);

  useEffect(() => {
    if (!window.electronAPI?.remoteStateSync) return;

    const publish = () => {
      const state = useStore.getState();
      window.electronAPI?.remoteStateSync?.({
        mode: state.mode,
        isAutoPaused: state.isAutoPaused,
        isLiveFrozen: state.isLiveFrozen,
        previewReference: referenceLabel(state.previewScripture),
        liveReference: referenceLabel(state.liveScripture),
        queueCount: state.queue.length,
      });
    };

    publish();
    const timer = setInterval(publish, 1000);
    return () => clearInterval(timer);
  }, [previewScripture, liveScripture, queue.length, mode, isAutoPaused, isLiveFrozen]);

  useEffect(() => {
    if (!window.electronAPI?.onRemoteCommand) return;

    const unsubscribe = window.electronAPI.onRemoteCommand(({ type, payload }) => {
      const state = useStore.getState();
      switch (type) {
        case 'goLive':
          if (state.previewScripture) state.goLiveWithTransition(state.previewScripture);
          break;
        case 'clearLive':
          state.clearLive();
          break;
        case 'nextVerse':
          state.nextVerse();
          break;
        case 'prevVerse':
          state.prevVerse();
          break;
        case 'queuePreview':
          state.queuePreview();
          break;
        case 'sendNextQueuedLive':
          state.sendNextQueuedLive();
          break;
        case 'setModeAuto':
          state.setMode('auto');
          break;
        case 'setModeManual':
          state.setMode('manual');
          break;
        case 'toggleAutoPause':
          state.toggleAutoPause();
          break;
        case 'setPreviewReference': {
          const book = String(payload?.book ?? '').trim();
          const chapter = Number(payload?.chapter);
          const verse = Number(payload?.verse);
          const endVerse = payload?.endVerse != null ? Number(payload.endVerse) : undefined;
          if (!book || !Number.isFinite(chapter) || !Number.isFinite(verse)) break;
          const scripture = getScripture(book, chapter, verse, state.version, endVerse);
          if (scripture) {
            state.setPreview(scripture);
            state.logActivity(`Remote preview: ${referenceLabel(scripture)}`, 'success');
          } else {
            state.logActivity(`Remote preview failed: ${book} ${chapter}:${verse}`, 'warning');
          }
          break;
        }
        default:
          break;
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  return null;
}
