import { useEffect, useState } from 'react';
import { OutputPayload } from './types/output';
import ScriptureDisplay from './components/ScriptureDisplay';
import { PresentationSettings } from './types';

function payloadToSettings(payload: OutputPayload): PresentationSettings {
  const p = payload.presentation;
  return {
    theme: p.theme as any,
    layout: p.layout as any,
    fontFamily: p.fontFamily ?? 'serif',
    fontScale: p.fontScale ?? 1,
    textAlignment: p.textAlignment ?? 'center',
    padding: p.padding ?? 48,
    referenceVisible: payload.visibility?.reference ?? true,
    versionVisible: payload.visibility?.version ?? true,
    // Use the exact backgroundStyle from the theme — never hardcode 'solid'.
    // This ensures transparent themes always render with a transparent background.
    backgroundStyle: (p.backgroundStyle ?? 'solid') as 'solid' | 'transparent',
    lowerThirdPosition: 'bottom-center',
    broadcastSafe: p.broadcastSafe ?? false,
    backgroundColor: p.backgroundColor ?? '',
    backgroundOpacity: p.backgroundOpacity ?? 100,
    textColor: p.textColor ?? '',
    referenceColor: p.referenceColor ?? '',
    textShadow: p.textShadow ?? false,
    verseQuotes: p.verseQuotes ?? false,
  };
}

export default function LiveApp() {
  const [payload, setPayload] = useState<OutputPayload | null>(null);

  useEffect(() => {
    // NDI offscreen window has no preload — receive data via window.__ndiUpdate
    // which is called from main.ts using executeJavaScript.
    (window as any).__ndiUpdate = (data: any) => {
      if (!data || data.type === 'clear') {
        setPayload(null);
      } else if (data.type === 'scripture') {
        setPayload(data as OutputPayload);
      }
    };

    if (window.electronAPI) {
      window.electronAPI.onUpdateLive((data: any) => {
        if (!data || data.type === 'clear') {
          setPayload(null);
        } else if (data.type === 'scripture') {
          setPayload(data as OutputPayload);
        } else {
          // Legacy support
          setPayload({
            id: 'legacy',
            timestamp: Date.now(),
            type: 'scripture',
            content: {
              reference: data.endVerse
                ? `${data.book} ${data.chapter}:${data.verse}-${data.endVerse}`
                : `${data.book} ${data.chapter}:${data.verse}`,
              text: data.text,
              version: data.version,
            },
            presentation: { theme: 'dark', layout: 'full-scripture', broadcastSafe: false },
            visibility: { reference: true, version: true },
          });
        }
      });

      window.electronAPI.onUpdateTheme((newTheme: string, newLayout: string) => {
        setPayload(prev =>
          prev
            ? {
                ...prev,
                presentation: {
                  ...prev.presentation,
                  theme: newTheme as any,
                  layout: newLayout as any,
                },
              }
            : null
        );
      });
    }
  }, []);

  if (!payload?.content) {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          background: 'transparent',
        }}
      />
    );
  }

  const settings = payloadToSettings(payload);
  const { content, visibility, elements } = payload;

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ScriptureDisplay
        text={content.text}
        reference={content.reference}
        version={content.version}
        settings={settings}
        showReference={visibility.reference}
        showVersion={visibility.version}
        elements={elements as any}
      />
    </div>
  );
}
