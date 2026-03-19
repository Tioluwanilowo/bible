import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { outputManager } from '../lib/output/OutputProviderManager';

export default function LiveOutputManager() {
  const {
    setLiveWindowStatus,
    setLiveWindowBounds,
    setAvailableDisplays,
    settings,
    liveScripture,
    outputTargets,
    providerStatuses,
    themes,
    activeThemeId,
  } = useStore();

  // ── One-time initialization ──────────────────────────────────────
  useEffect(() => {
    outputManager.initialize();

    if (window.electronAPI) {
      // Route status events to the correct output target by windowId
      window.electronAPI.onLiveWindowStatusChanged(({ windowId, status }) => {
        setLiveWindowStatus(windowId, status as any);
      });

      // Route bounds events to the correct output target by windowId
      window.electronAPI.onLiveWindowBoundsChanged(({ windowId, bounds }) => {
        setLiveWindowBounds(windowId, bounds);
      });

      // Fetch initial display list
      window.electronAPI.getDisplays().then(setAvailableDisplays);

      // Re-fetch when monitors are plugged / unplugged
      window.electronAPI.onDisplaysChanged(setAvailableDisplays);
    }
  }, [setLiveWindowStatus, setLiveWindowBounds, setAvailableDisplays]);

  // ── Live theme sync ──────────────────────────────────────────────
  // Re-send the full payload whenever settings, themes, or targets change
  // while there is already scripture on the live output.
  useEffect(() => {
    if (!liveScripture) return;

    const content = {
      reference: `${liveScripture.book} ${liveScripture.chapter}:${liveScripture.verse}${liveScripture.endVerse ? `-${liveScripture.endVerse}` : ''}`,
      text: liveScripture.text,
      version: liveScripture.version,
    };

    const enabledTargets = outputTargets.filter(t => t.enabled);

    for (const target of enabledTargets) {
      const resolvedTheme = themes.find(t => t.id === (target.themeId ?? activeThemeId));
      const ps = resolvedTheme?.settings ?? settings.presentation;
      const elements = resolvedTheme?.elements;

      // Copy the exact theme attached to this output — every property including
      // backgroundStyle must be faithfully transmitted so transparency works.
      const payload = {
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

      // NDI targets route to per-target offscreen ids: "__ndi__:<targetId>".
      const routeId = target.type === 'ndi' ? `__ndi__:${target.id}` : target.id;
      window.electronAPI?.sendToLive(routeId, payload);
    }

    // Backward compatibility for legacy global NDI provider route.
    const hasEnabledNDITarget = enabledTargets.some(t => t.type === 'ndi');
    if (!hasEnabledNDITarget && providerStatuses?.ndi?.status === 'active') {
      const fallbackTarget = enabledTargets.find(t => t.id === 'main') ?? enabledTargets[0];
      if (fallbackTarget) {
        const resolvedTheme = themes.find(t => t.id === (fallbackTarget.themeId ?? activeThemeId));
        const ps = resolvedTheme?.settings ?? settings.presentation;
        const elements = resolvedTheme?.elements;
        const legacyPayload = {
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
        window.electronAPI?.sendToLive('__ndi__', legacyPayload);
      }
    }

    // Also push to non-Electron providers (NDI, etc.) using the primary target's theme
    const primaryTarget = enabledTargets.find(t => t.id === 'main') ?? enabledTargets[0];
    if (primaryTarget) {
      const resolvedTheme = themes.find(t => t.id === (primaryTarget.themeId ?? activeThemeId));
      const ps = resolvedTheme?.settings ?? settings.presentation;
      const primaryPayload = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        type: 'scripture' as const,
        content,
        presentation: {
          theme: ps?.theme as any || 'dark',
          layout: ps?.layout as any || 'full-scripture',
          broadcastSafe: ps?.broadcastSafe ?? false,
        },
        visibility: {
          reference: ps?.referenceVisible ?? true,
          version: ps?.versionVisible ?? true,
        },
      };
      outputManager.updateAll(primaryPayload as any);
    }
  }, [
    liveScripture,
    outputTargets,
    providerStatuses,
    themes,
    activeThemeId,
    settings?.presentation,
  ]);

  return null;
}
