import React, { useRef, useState, useLayoutEffect } from 'react';
import { PresentationSettings, ThemeElements } from '../types';

interface ScriptureDisplayProps {
  text: string;
  reference: string;
  version: string;
  settings: PresentationSettings;
  showReference: boolean;
  showVersion: boolean;
  /** When provided, renders elements at absolute canvas positions (0-100%) */
  elements?: ThemeElements;
}

const FONT_MAP: Record<string, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Courier New", Courier, monospace',
};

function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

export default function ScriptureDisplay({
  text,
  reference,
  version,
  settings,
  showReference,
  showVersion,
  elements,
}: ScriptureDisplayProps) {
  const {
    theme = 'dark',
    layout = 'full-scripture',
    fontFamily = 'serif',
    fontScale = 1,
    textAlignment = 'center',
    backgroundColor = '',
    backgroundOpacity = 100,
    textColor = '',
    referenceColor = '',
    textShadow = false,
    verseQuotes = false,
    broadcastSafe = false,
    padding = 48,
    backgroundStyle = 'solid',
  } = settings;

  const isLight = theme === 'light';
  const isChroma = theme === 'chroma-green';
  // Transparent if the theme is explicitly 'transparent' OR the backgroundStyle
  // override is set to 'transparent' — either setting on the output must be honoured.
  const isTransparent = theme === 'transparent' || backgroundStyle === 'transparent';

  const resolvedText = textColor || (isLight || isChroma ? '#000000' : '#ffffff');
  const resolvedRef = referenceColor || (isLight ? '#374151' : '#a1a1aa');
  const resolvedBg = backgroundColor || (isLight ? '#ffffff' : isChroma ? '#00FF00' : '#000000');

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
  };

  if (isTransparent) {
    containerStyle.background = 'transparent';
  } else {
    containerStyle.background =
      backgroundOpacity < 100
        ? hexToRgba(resolvedBg, backgroundOpacity)
        : resolvedBg;
  }

  const shadow = textShadow ? '0 2px 16px rgba(0,0,0,0.95), 0 1px 4px rgba(0,0,0,0.8)' : 'none';
  const font = FONT_MAP[fontFamily] || FONT_MAP.serif;
  const pad = broadcastSafe ? 96 : padding;
  const align = textAlignment as React.CSSProperties['textAlign'];
  const flexAlign =
    textAlignment === 'left' ? 'flex-start' : textAlignment === 'right' ? 'flex-end' : 'center';
  // 'justify' maps to CSS text-align: justify; flexAlign stays center for container

  const verseStyle: React.CSSProperties = {
    color: resolvedText,
    fontFamily: font,
    fontSize: 64 * fontScale,
    lineHeight: 1.4,
    textAlign: align,
    textShadow: shadow,
    margin: 0,
    fontWeight: fontFamily === 'sans' ? 600 : 400,
  };

  const refStyle: React.CSSProperties = {
    color: resolvedRef,
    fontFamily: FONT_MAP.sans,
    fontSize: 32 * fontScale,
    textAlign: align,
    textShadow: textShadow ? '0 1px 8px rgba(0,0,0,0.8)' : 'none',
    margin: 0,
    fontWeight: 500,
    letterSpacing: '0.02em',
  };

  const displayText = verseQuotes ? `\u201c${text}\u201d` : text;
  const displayRef = showVersion ? `${reference}\u2002\u2022\u2002${version}` : reference;

  // ── Hoist element config so hooks can reference them unconditionally ──
  const sc = elements?.scripture ?? { x: 5, y: 28, width: 90, visible: true };
  const rf = elements?.reference ?? { x: 20, y: 72, width: 60, visible: true };
  const scFontPx = sc.fontSize ?? 64 * fontScale;
  const rfFontPx = rf.fontSize ?? 32 * fontScale;

  // ── Auto font-size: binary search the largest font (vw) that fits the container ──
  const scContainerRef = useRef<HTMLDivElement>(null);
  const rfContainerRef = useRef<HTMLDivElement>(null);
  const [scAdjustedFont, setScAdjustedFont] = useState<string | null>(null);
  const [rfAdjustedFont, setRfAdjustedFont] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!sc.autoFontSize || !sc.height || !scContainerRef.current) {
      setScAdjustedFont(null);
      return;
    }
    const actualP = scContainerRef.current.firstElementChild as HTMLElement | null;
    if (!actualP) return;

    // Compute box dimensions from percentage values + viewport size.
    // window.innerWidth/Height is always correct (1920×1080 in the NDI window,
    // actual window size in the live window) and doesn't depend on CSS layout.
    const canvasW = window.innerWidth  || 1920;
    const canvasH = window.innerHeight || 1080;
    const boxW = Math.round(canvasW * sc.width  / 100);
    const boxH = Math.round(canvasH * sc.height / 100);
    if (boxW === 0 || boxH === 0) return;

    // Use a detached probe element so the measurement is completely independent of
    // the flex container's layout state.  Measuring p.scrollHeight in-place while the
    // flex parent is not laid out (common in the NDI offscreen renderer) gives
    // inconsistent results — a detached probe with explicit dimensions is reliable.
    const cs = window.getComputedStyle(actualP);
    const probe = document.createElement('p');
    probe.style.cssText =
      `position:fixed;top:-9999px;left:-9999px;` +
      `visibility:hidden;pointer-events:none;` +
      `margin:0;padding:0;border:0;` +
      `width:${boxW}px;line-height:1.4;` +
      `font-family:${cs.fontFamily};font-weight:${cs.fontWeight};` +
      (sc.autoWidth ? 'white-space:nowrap;' : 'white-space:normal;');
    probe.textContent = displayText;
    document.body.appendChild(probe);

    const configuredVw = (scFontPx / 1920) * 100;
    const MIN_VW = 0.5;
    let lo = MIN_VW, hi = 30, bestVw = MIN_VW;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      probe.style.fontSize = `${mid}vw`;
      if (probe.scrollHeight <= boxH) { bestVw = mid; lo = mid; }
      else { hi = mid; }
    }
    document.body.removeChild(probe);

    setScAdjustedFont(bestVw > MIN_VW + 0.1 ? `${bestVw}vw` : `${configuredVw}vw`);
  }, [sc.autoFontSize, sc.height, sc.width, displayText, scFontPx]);

  useLayoutEffect(() => {
    if (!rf.autoFontSize || !rf.height || !rfContainerRef.current) {
      setRfAdjustedFont(null);
      return;
    }
    const actualP = rfContainerRef.current.firstElementChild as HTMLElement | null;
    if (!actualP) return;

    // Same detached-probe approach as the scripture element above.
    const canvasW = window.innerWidth  || 1920;
    const canvasH = window.innerHeight || 1080;
    const boxW = Math.round(canvasW * rf.width  / 100);
    const boxH = Math.round(canvasH * rf.height / 100);
    if (boxW === 0 || boxH === 0) return;

    const cs = window.getComputedStyle(actualP);
    const probe = document.createElement('p');
    probe.style.cssText =
      `position:fixed;top:-9999px;left:-9999px;` +
      `visibility:hidden;pointer-events:none;` +
      `margin:0;padding:0;border:0;` +
      `width:${boxW}px;line-height:1.4;` +
      `font-family:${cs.fontFamily};font-weight:${cs.fontWeight};` +
      (rf.autoWidth ? 'white-space:nowrap;' : 'white-space:normal;');
    probe.textContent = displayRef;
    document.body.appendChild(probe);

    const configuredVw = (rfFontPx / 1920) * 100;
    const MIN_VW = 0.5;
    let lo = MIN_VW, hi = 30, bestVw = MIN_VW;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      probe.style.fontSize = `${mid}vw`;
      if (probe.scrollHeight <= boxH) { bestVw = mid; lo = mid; }
      else { hi = mid; }
    }
    document.body.removeChild(probe);

    setRfAdjustedFont(bestVw > MIN_VW + 0.1 ? `${bestVw}vw` : `${configuredVw}vw`);
  }, [rf.autoFontSize, rf.height, rf.width, displayRef, rfFontPx]);

  // ── Custom absolute-position layout (from Theme Designer drag-drop) ──
  if (elements || layout === 'custom') {
    // Per-element style resolution — fall back to global settings when not overridden.
    // Font sizes are stored as absolute px at 1920px reference width; we convert to
    // vw so they scale correctly at any actual viewport/window width.
    const scFont    = sc.fontFamily ? FONT_MAP[sc.fontFamily] : font;
    const rfFont    = rf.fontFamily ? FONT_MAP[rf.fontFamily] : FONT_MAP.sans;
    const scColor   = sc.textColor  || resolvedText;
    const rfColor   = rf.textColor  || resolvedRef;
    const scAlign   = (sc.textAlignment || textAlignment) as React.CSSProperties['textAlign'];
    const rfAlign   = (rf.textAlignment || textAlignment) as React.CSSProperties['textAlign'];

    const scStyle: React.CSSProperties = {
      color: scColor,
      fontFamily: scFont,
      fontSize: scAdjustedFont ?? `${(scFontPx / 1920) * 100}vw`,
      lineHeight: 1.4,
      textAlign: scAlign,
      textShadow: shadow,
      margin: 0,
      fontWeight: (sc.fontFamily ?? fontFamily) === 'sans' ? 600 : 400,
      ...(sc.autoWidth ? { whiteSpace: 'nowrap' } : {}),
    };

    const rfOverrideStyle: React.CSSProperties = {
      color: rfColor,
      fontFamily: rfFont,
      fontSize: rfAdjustedFont ?? `${(rfFontPx / 1920) * 100}vw`,
      lineHeight: 1.4,
      textAlign: rfAlign,
      textShadow: textShadow ? '0 1px 8px rgba(0,0,0,0.8)' : 'none',
      margin: 0,
      fontWeight: 500,
      letterSpacing: '0.02em',
      ...(rf.autoWidth ? { whiteSpace: 'nowrap' } : {}),
    };

    return (
      <div style={containerStyle}>
        {sc.visible && (
          <div
            ref={scContainerRef}
            style={{
              position: 'absolute',
              left: `${sc.x}%`,
              top: `${sc.y}%`,
              width: `${sc.width}%`,
              height: sc.height !== undefined ? `${sc.height}%` : 'auto',
              overflow: sc.height !== undefined ? 'hidden' : 'visible',
              // Vertical alignment within fixed-height box
              ...(sc.height !== undefined ? {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: sc.verticalAlignment === 'bottom' ? 'flex-end'
                  : sc.verticalAlignment === 'middle' ? 'center'
                  : 'flex-start',
              } : {}),
            }}
          >
            <p style={scStyle}>{displayText}</p>
          </div>
        )}
        {showReference && rf.visible && (
          <div
            ref={rfContainerRef}
            style={{
              position: 'absolute',
              left: `${rf.x}%`,
              top: `${rf.y}%`,
              width: `${rf.width}%`,
              height: rf.height !== undefined ? `${rf.height}%` : 'auto',
              overflow: rf.height !== undefined ? 'hidden' : 'visible',
              // Vertical alignment within fixed-height box
              ...(rf.height !== undefined ? {
                display: 'flex',
                flexDirection: 'column',
                justifyContent: rf.verticalAlignment === 'bottom' ? 'flex-end'
                  : rf.verticalAlignment === 'middle' ? 'center'
                  : 'flex-start',
              } : {}),
            }}
          >
            <p style={rfOverrideStyle}>{displayRef}</p>
          </div>
        )}
      </div>
    );
  }

  // ── Full Scripture (flex-based) ──
  if (layout === 'full-scripture') {
    return (
      <div style={containerStyle}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: flexAlign,
            justifyContent: 'center',
            height: '100%',
            maxWidth: 1600,
            margin: '0 auto',
            padding: pad,
            textAlign: align,
          }}
        >
          <p style={{ ...verseStyle, marginBottom: 48 }}>{displayText}</p>
          {showReference && <p style={refStyle}>{displayRef}</p>}
        </div>
      </div>
    );
  }

  // ── Lower Third ──
  if (layout === 'lower-third') {
    const panelBg = isTransparent
      ? 'transparent'
      : isLight
      ? 'rgba(255,255,255,0.92)'
      : 'rgba(0,0,0,0.85)';

    return (
      <div style={containerStyle}>
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: `0 ${pad}px ${pad}px`,
          }}
        >
          <div
            style={{
              background: panelBg,
              backdropFilter: 'blur(16px)',
              borderRadius: 24,
              padding: '40px 56px',
              border: isLight ? '1px solid rgba(0,0,0,0.08)' : '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <p style={{ ...verseStyle, fontSize: 48 * fontScale, marginBottom: 16 }}>{displayText}</p>
            {showReference && <p style={refStyle}>{displayRef}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── Reference Only ──
  return (
    <div style={containerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent:
            flexAlign === 'flex-start' ? 'flex-start' : flexAlign === 'flex-end' ? 'flex-end' : 'center',
          height: '100%',
          padding: pad,
        }}
      >
        <p
          style={{
            ...refStyle,
            fontSize: 72 * fontScale,
            fontWeight: 700,
            letterSpacing: '-0.01em',
          }}
        >
          {displayRef}
        </p>
      </div>
    </div>
  );
}
