import { useEffect } from 'react';
import { useStore } from '../store/useStore';

export default function HotkeyManager() {
  const { 
    settings, 
    nextVerse, 
    prevVerse, 
    previewScripture, 
    setLive, 
    clearLive, 
    toggleFreeze, 
    toggleAutoPause 
  } = useStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger hotkeys if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const { hotkeys } = settings;
      if (!hotkeys) return;

      for (const [actionName, config] of Object.entries(hotkeys)) {
        if (e.key.toLowerCase() === config.key.toLowerCase()) {
          const modifiersMatch = config.modifiers.every(mod => {
            if (mod === 'ctrl') return e.ctrlKey;
            if (mod === 'shift') return e.shiftKey;
            if (mod === 'alt') return e.altKey;
            if (mod === 'meta') return e.metaKey;
            return false;
          });

          const noExtraModifiers = !['ctrl', 'shift', 'alt', 'meta'].some(mod => {
            if (config.modifiers.includes(mod as any)) return false;
            if (mod === 'ctrl') return e.ctrlKey;
            if (mod === 'shift') return e.shiftKey;
            if (mod === 'alt') return e.altKey;
            if (mod === 'meta') return e.metaKey;
            return false;
          });

          if (modifiersMatch && noExtraModifiers) {
            e.preventDefault();
            
            switch (actionName) {
              case 'nextVerse':
                nextVerse();
                break;
              case 'prevVerse':
                prevVerse();
                break;
              case 'goLive':
                if (previewScripture) setLive(previewScripture);
                break;
              case 'clearLive':
                clearLive();
                break;
              case 'toggleFreeze':
                toggleFreeze();
                break;
              case 'toggleAutoPause':
                toggleAutoPause();
                break;
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [settings, nextVerse, prevVerse, previewScripture, setLive, clearLive, toggleFreeze, toggleAutoPause]);

  return null;
}
