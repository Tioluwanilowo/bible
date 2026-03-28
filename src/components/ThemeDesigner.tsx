import React, { useRef, useEffect, useState, useCallback } from 'react';
import {
  X, Layers, AlignLeft, AlignCenter, AlignRight, AlignJustify, Eye, EyeOff,
  Zap, Monitor, Plus, Copy, Trash2, Pencil, Maximize2, ArrowUp, ArrowDown, Square, Upload, Image as ImageIcon,
  AlignStartVertical, AlignCenterVertical, AlignEndVertical,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { DEFAULT_ELEMENTS, Theme, ThemeElements, ThemeBoxLayer, ElementPosition, PresentationSettings, SNAP_PRESETS, ThemeAsset } from '../types';
import {
  getElementBounds,
  getAlignmentCandidates,
  getSnapPosition,
  type SmartGuide,
} from '../lib/canvas/smartGuides';

// ─── Sample verses ───────────────────────────────────────────────
const SAMPLE_VERSES = [
  { text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.', reference: 'John 3:16', version: 'KJV' },
  { text: 'I can do all things through Christ which strengtheneth me.', reference: 'Philippians 4:13', version: 'KJV' },
  { text: 'The Lord is my shepherd; I shall not want.', reference: 'Psalm 23:1', version: 'KJV' },
  { text: 'Trust in the Lord with all thine heart; and lean not unto thine own understanding.', reference: 'Proverbs 3:5', version: 'KJV' },
];

const FONT_MAP: Record<string, string> = {
  serif: 'Georgia,"Times New Roman",serif',
  sans:  'system-ui,-apple-system,"Segoe UI",sans-serif',
  mono:  '"Courier New",Courier,monospace',
};

function hexToRgba(hex: string, opacity: number): string {
  const normalized = (hex || '#000000').replace('#', '');
  const safe = normalized.length === 6 ? normalized : '000000';
  const r = parseInt(safe.slice(0, 2), 16) || 0;
  const g = parseInt(safe.slice(2, 4), 16) || 0;
  const b = parseInt(safe.slice(4, 6), 16) || 0;
  const clamped = Math.max(0, Math.min(100, opacity));
  return `rgba(${r},${g},${b},${clamped / 100})`;
}

// ─── Shared UI helpers ────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center space-x-2 mb-2.5">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{title}</h3>
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const c = value || '#ffffff';
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center space-x-2">
        <span className="text-xs text-zinc-500 font-mono">{c.toUpperCase()}</span>
        <label className="relative cursor-pointer">
          <input type="color" value={c} onChange={e => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
          <div className="w-7 h-7 rounded-md border-2 border-zinc-600 shadow-inner" style={{ background: c }} />
        </label>
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-xs text-zinc-400">{label}</span>
        <span className="text-xs text-indigo-400 font-mono">{format ? format(value) : value}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full accent-indigo-500 h-1.5" />
    </div>
  );
}

function NumberInput({ label, value, min, max, step = 1, format, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  format?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-zinc-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(Math.max(min, Math.min(max, parseFloat(e.target.value) || min)))}
          className="w-16 bg-zinc-950 border border-zinc-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 text-right"
        />
        {format && <span className="text-xs text-zinc-500">{format}</span>}
      </div>
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: {
  label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <div>
        <p className="text-xs text-zinc-300">{label}</p>
        {desc && <p className="text-[10px] text-zinc-600 mt-0.5">{desc}</p>}
      </div>
      <button onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-600' : 'bg-zinc-700'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </button>
    </div>
  );
}

function AlignGrid({
  hAlign,
  vAlign,
  hasHeight,
  onHChange,
  onVChange,
}: {
  hAlign: 'left' | 'center' | 'right' | 'justify';
  vAlign?: 'top' | 'middle' | 'bottom';
  hasHeight: boolean;
  onHChange: (v: 'left' | 'center' | 'right' | 'justify') => void;
  onVChange: (v: 'top' | 'middle' | 'bottom') => void;
}) {
  const hOptions: { v: 'left' | 'center' | 'right' | 'justify'; Icon: React.ElementType }[] = [
    { v: 'left',    Icon: AlignLeft },
    { v: 'center',  Icon: AlignCenter },
    { v: 'right',   Icon: AlignRight },
    { v: 'justify', Icon: AlignJustify },
  ];
  const vOptions: { v: 'top' | 'middle' | 'bottom'; Icon: React.ElementType }[] = [
    { v: 'top',    Icon: AlignStartVertical },
    { v: 'middle', Icon: AlignCenterVertical },
    { v: 'bottom', Icon: AlignEndVertical },
  ];
  return (
    <div className="space-y-1">
      {/* Horizontal */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-800">
        {hOptions.map(({ v, Icon }, i) => (
          <button key={v} onClick={() => onHChange(v)}
            className={`flex-1 py-1.5 flex items-center justify-center transition-colors ${hAlign === v ? 'bg-indigo-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-white'} ${i < 3 ? 'border-r border-zinc-800' : ''}`}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
      {/* Vertical — grayed out when no fixed height */}
      <div className={`flex rounded-lg overflow-hidden border border-zinc-800 ${!hasHeight ? 'opacity-40 pointer-events-none' : ''}`}>
        {vOptions.map(({ v, Icon }, i) => (
          <button key={v} onClick={() => onVChange(v)}
            title={hasHeight ? undefined : 'Enable Fixed Height to use vertical alignment'}
            className={`flex-1 py-1.5 flex items-center justify-center transition-colors ${vAlign === v ? 'bg-indigo-600 text-white' : 'bg-zinc-950 text-zinc-400 hover:text-white'} ${i < 2 ? 'border-r border-zinc-800' : ''}`}>
            <Icon className="w-3.5 h-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Drag Canvas ─────────────────────────────────────────────────
const SMART_SNAP_THRESHOLD_PX = 6;

interface DragCanvasProps {
  theme: Theme;
  sampleVerse: { text: string; reference: string; version: string };
  selectedElement: 'scripture' | 'reference' | null;
  activeBoxId: string | null;
  onSelectElement: (el: 'scripture' | 'reference' | null) => void;
  onSelectBox: (boxId: string | null) => void;
  onElementsChange: (elements: ThemeElements) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read selected file'));
    reader.readAsDataURL(file);
  });
}

function DragCanvas({ theme, sampleVerse, selectedElement, activeBoxId, onSelectElement, onSelectBox, onElementsChange }: DragCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'scripture' | 'reference' | null>(null);
  const [draggingBoxId, setDraggingBoxId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<'scripture' | 'reference' | null>(null);
  const [hovered, setHovered] = useState<'scripture' | 'reference' | null>(null);
  const [smartGuides, setSmartGuides] = useState<SmartGuide[]>([]);
  const [canvasPx, setCanvasPx] = useState(600);
  const dragMeta = useRef<{
    startMouseX: number; startMouseY: number;
    startElemX: number; startElemY: number;
    canvasBounds: DOMRect;
    element: 'scripture' | 'reference';
  } | null>(null);
  const boxDragMeta = useRef<{
    startMouseX: number;
    startMouseY: number;
    startBoxX: number;
    startBoxY: number;
    boxId: string;
    canvasBounds: DOMRect;
  } | null>(null);
  const resizeMeta = useRef<{
    startMouseX: number;
    startMouseY: number;
    startWidth: number;
    startHeight: number;
    canvasBounds: DOMRect;
    element: 'scripture' | 'reference';
    direction: 'width' | 'height';
  } | null>(null);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setCanvasPx(e[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clearSmartGuides = useCallback(() => {
    setSmartGuides([]);
  }, []);

  const handleMouseDown = (element: 'scripture' | 'reference', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearSmartGuides();
    onSelectElement(element);
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    dragMeta.current = {
      startMouseX: e.clientX, startMouseY: e.clientY,
      startElemX: theme.elements[element].x, startElemY: theme.elements[element].y,
      canvasBounds: bounds, element,
    };
    setDragging(element);
  };

  const handleBoxMouseDown = (boxId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearSmartGuides();
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const box = (theme.elements.boxes ?? []).find((candidate) => candidate.id === boxId);
    if (!box) return;
    onSelectElement(null);
    onSelectBox(boxId);
    boxDragMeta.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBoxX: box.x,
      startBoxY: box.y,
      boxId,
      canvasBounds: bounds,
    };
    setDraggingBoxId(boxId);
  };

  useEffect(() => {
    if (!dragging) return;
    const handleMove = (e: MouseEvent) => {
      const meta = dragMeta.current;
      if (!meta) return;
      const { startMouseX, startMouseY, startElemX, startElemY, canvasBounds, element } = meta;
      const dragElement = theme.elements[element];
      const w = dragElement.width;
      const h = dragElement.height ?? (element === 'scripture' ? 20 : 10);
      let newX = startElemX + ((e.clientX - startMouseX) / canvasBounds.width) * 100;
      let newY = startElemY + ((e.clientY - startMouseY) / canvasBounds.height) * 100;
      newX = Math.max(0, Math.min(100 - w, newX));
      newY = Math.max(0, Math.min(100 - h, newY));

      const allBounds = getElementBounds(theme.elements);
      const candidates = getAlignmentCandidates(allBounds, element);
      const thresholdX = (SMART_SNAP_THRESHOLD_PX / canvasBounds.width) * 100;
      const thresholdY = (SMART_SNAP_THRESHOLD_PX / canvasBounds.height) * 100;
      const snap = getSnapPosition({
        dragBounds: { id: element, x: newX, y: newY, width: w, height: h },
        candidates,
        thresholdX,
        thresholdY,
      });

      setSmartGuides(snap.guides);
      onElementsChange({
        ...theme.elements,
        [element]: {
          ...dragElement,
          x: Math.round(snap.x * 10) / 10,
          y: Math.round(snap.y * 10) / 10,
        },
      });
    };
    const handleUp = () => { setDragging(null); clearSmartGuides(); dragMeta.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [dragging, theme.elements, onElementsChange, clearSmartGuides]);

  useEffect(() => {
    if (!draggingBoxId) return;
    const handleMove = (e: MouseEvent) => {
      const meta = boxDragMeta.current;
      if (!meta) return;
      const boxes = theme.elements.boxes ?? [];
      const active = boxes.find((box) => box.id === meta.boxId);
      if (!active) return;

      let newX = meta.startBoxX + ((e.clientX - meta.startMouseX) / meta.canvasBounds.width) * 100;
      let newY = meta.startBoxY + ((e.clientY - meta.startMouseY) / meta.canvasBounds.height) * 100;
      newX = Math.max(0, Math.min(100 - active.width, newX));
      newY = Math.max(0, Math.min(100 - active.height, newY));
      const allBounds = getElementBounds(theme.elements);
      const candidates = getAlignmentCandidates(allBounds, `box:${meta.boxId}`);
      const thresholdX = (SMART_SNAP_THRESHOLD_PX / meta.canvasBounds.width) * 100;
      const thresholdY = (SMART_SNAP_THRESHOLD_PX / meta.canvasBounds.height) * 100;
      const snap = getSnapPosition({
        dragBounds: {
          id: `box:${meta.boxId}`,
          x: newX,
          y: newY,
          width: active.width,
          height: active.height,
        },
        candidates,
        thresholdX,
        thresholdY,
      });

      setSmartGuides(snap.guides);

      onElementsChange({
        ...theme.elements,
        boxes: boxes.map((box) => (
          box.id === meta.boxId
            ? { ...box, x: Math.round(snap.x * 10) / 10, y: Math.round(snap.y * 10) / 10 }
            : box
        )),
      });
    };
    const handleUp = () => {
      setDraggingBoxId(null);
      clearSmartGuides();
      boxDragMeta.current = null;
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [draggingBoxId, theme.elements, onElementsChange, clearSmartGuides]);

  // ── Resize (right-edge = width, bottom-edge = height) ────────────────────────────────
  const handleResizeDown = (element: 'scripture' | 'reference', direction: 'width' | 'height', e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearSmartGuides();
    onSelectElement(element);
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    resizeMeta.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startWidth: theme.elements[element].width,
      startHeight: theme.elements[element].height ?? 30,
      canvasBounds: bounds,
      element,
      direction,
    };
    setResizing(element);
  };

  useEffect(() => {
    if (!resizing) return;
    const handleMove = (e: MouseEvent) => {
      const meta = resizeMeta.current;
      if (!meta) return;
      const { startMouseX, startMouseY, startWidth, startHeight, canvasBounds, element, direction } = meta;
      const el = theme.elements[element];
      if (direction === 'width') {
        const deltaPercent = ((e.clientX - startMouseX) / canvasBounds.width) * 100;
        const newWidth = Math.max(5, Math.min(100 - el.x, startWidth + deltaPercent));
        onElementsChange({ ...theme.elements, [element]: { ...el, width: Math.round(newWidth * 10) / 10 } });
      } else {
        const deltaPercent = ((e.clientY - startMouseY) / canvasBounds.height) * 100;
        const newHeight = Math.max(5, Math.min(95 - el.y, startHeight + deltaPercent));
        onElementsChange({ ...theme.elements, [element]: { ...el, height: Math.round(newHeight * 10) / 10 } });
      }
    };
    const handleUp = () => { setResizing(null); clearSmartGuides(); resizeMeta.current = null; };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp); };
  }, [resizing, theme.elements, onElementsChange, clearSmartGuides]);

  const { settings, elements } = theme;
  const ps = settings;
  const isLight = ps.theme === 'light';
  const isChroma = ps.theme === 'chroma-green';
  const isTransparent = ps.theme === 'transparent';
  const globalBg = ps.backgroundColor || (isLight ? '#ffffff' : isChroma ? '#00FF00' : '#000000');
  const op = (ps.backgroundOpacity ?? 100) / 100;
  const r = parseInt(globalBg.slice(1, 3), 16) || 0;
  const g = parseInt(globalBg.slice(3, 5), 16) || 0;
  const b = parseInt(globalBg.slice(5, 7), 16) || 0;

  const getBg = (): React.CSSProperties => {
    if (isTransparent) return { background: 'repeating-conic-gradient(#333 0% 25%, #1a1a1a 0% 50%) 0 0 / 20px 20px' };
    return { background: op < 1 ? `rgba(${r},${g},${b},${op})` : globalBg };
  };

  // Resolve per-element styles, falling back to global settings
  const resolveEl = (el: ElementPosition, kind: 'scripture' | 'reference') => {
    const globalTextColor = ps.textColor || (isLight || isChroma ? '#000000' : '#ffffff');
    const globalRefColor = ps.referenceColor || (isLight ? '#374151' : '#a1a1aa');
    const fallbackColor = kind === 'scripture' ? globalTextColor : globalRefColor;
    const fallbackFont = FONT_MAP[ps.fontFamily ?? 'serif'];
    const fallbackSize = kind === 'scripture' ? 64 * (ps.fontScale ?? 1) : 32 * (ps.fontScale ?? 1);
    const fallbackAlign = (ps.textAlignment ?? 'center') as React.CSSProperties['textAlign'];
    return {
      color: el.textColor || fallbackColor,
      font: el.fontFamily ? FONT_MAP[el.fontFamily] : fallbackFont,
      size: Math.round(((el.fontSize ?? fallbackSize) * canvasPx) / 1920),
      align: (el.textAlignment || fallbackAlign) as React.CSSProperties['textAlign'],
    };
  };

  const shadow = ps.textShadow ? '0 2px 16px rgba(0,0,0,0.95)' : 'none';
  const displayText = (ps.verseQuotes ?? true) ? `\u201c${sampleVerse.text}\u201d` : sampleVerse.text;
  const displayRef = (ps.versionVisible ?? true) ? `${sampleVerse.reference}\u2002\u2022\u2002${sampleVerse.version}` : sampleVerse.reference;

  const makeBox = (kind: 'scripture' | 'reference', label: string, displayStr: string) => {
    const el = elements[kind];
    const { color, font, size, align } = resolveEl(el, kind);
    const isSelected = selectedElement === kind;
    const isHov = hovered === kind || dragging === kind;
    const borderColor = kind === 'scripture' ? '#6366f1' : '#f59e0b';
    const tagBg = kind === 'scripture' ? '#6366f1' : '#f59e0b';
    const tagColor = kind === 'scripture' ? '#fff' : '#000';

    const isActiveOp = dragging === kind || resizing === kind;
    return el.visible ? (
      <div
        key={kind}
        style={{
          position: 'absolute',
          left: `${el.x}%`,
          top: `${el.y}%`,
          width: `${el.width}%`,
          height: el.height !== undefined ? `${el.height}%` : 'auto',
          cursor: dragging === kind ? 'grabbing' : 'grab',
          userSelect: 'none',
          outline: (isSelected || isHov) ? `2px solid ${borderColor}` : '2px solid transparent',
          outlineOffset: 4,
          borderRadius: el.borderRadius ?? 0,
          overflow: el.height !== undefined || (el.textHighlightOpacity ?? 0) > 0 ? 'hidden' : 'visible',
          zIndex: el.zIndex ?? (kind === 'scripture' ? DEFAULT_ELEMENTS.scripture.zIndex : DEFAULT_ELEMENTS.reference.zIndex),
          background: hexToRgba(el.textHighlightColor || '#000000', el.textHighlightOpacity ?? 0),
          // Vertical alignment inside fixed-height box
          ...(el.height !== undefined ? {
            display: 'flex',
            flexDirection: 'column' as const,
            justifyContent: el.verticalAlignment === 'bottom' ? 'flex-end'
              : el.verticalAlignment === 'middle' ? 'center'
              : 'flex-start',
          } : {}),
        }}
        onMouseDown={e => handleMouseDown(kind, e)}
        onMouseEnter={() => setHovered(kind)}
        onMouseLeave={() => !isActiveOp && setHovered(null)}
      >
        <p style={{
          color, fontFamily: font, fontSize: size, lineHeight: 1.4, textAlign: align,
          textShadow: shadow, margin: 0,
          fontWeight: el.fontFamily === 'sans' || ps.fontFamily === 'sans' ? 600 : 400,
          ...(el.autoWidth ? { whiteSpace: 'nowrap' } : {}),
        }}>
          {displayStr}
        </p>
        {isHov && (
          <div style={{ position: 'absolute', top: -18, left: 0, background: tagBg, color: tagColor, fontSize: 9, padding: '1px 5px', borderRadius: 3, fontFamily: 'system-ui,sans-serif', whiteSpace: 'nowrap' }}>
            ✥ {label} · {Math.round(el.x)}%, {Math.round(el.y)}%
            {' · '}{Math.round(el.width)}% wide
            {el.height !== undefined ? ` · ${Math.round(el.height)}% tall` : ''}
            {el.autoWidth ? ' · single-line' : ''}
            {el.autoFontSize ? ' · auto-size' : ''}
            {' · '}{el.fontSize ?? '—'}px
          </div>
        )}
        {/* Width resize handle — right edge */}
        {!el.autoWidth && (
          <div
            style={{
              position: 'absolute',
              right: -10,
              top: '50%',
              transform: 'translateY(-50%)',
              width: 20,
              height: el.height !== undefined ? '100%' : undefined,
              minHeight: 32,
              cursor: 'col-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
            onMouseDown={e => handleResizeDown(kind, 'width', e)}
          >
            {(isSelected || isHov) && (
              <div style={{
                width: 4,
                height: 28,
                background: borderColor,
                borderRadius: 3,
                opacity: resizing === kind ? 1 : 0.75,
                boxShadow: '0 0 0 2px rgba(0,0,0,0.5)',
              }} />
            )}
          </div>
        )}
        {/* Height resize handle — bottom edge (only when fixed height is enabled) */}
        {el.height !== undefined && (
          <div
            style={{
              position: 'absolute',
              bottom: -10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: '100%',
              height: 20,
              cursor: 'row-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
            onMouseDown={e => handleResizeDown(kind, 'height', e)}
          >
            {(isSelected || isHov) && (
              <div style={{
                width: 28,
                height: 4,
                background: borderColor,
                borderRadius: 3,
                opacity: resizing === kind ? 1 : 0.75,
                boxShadow: '0 0 0 2px rgba(0,0,0,0.5)',
              }} />
            )}
          </div>
        )}
      </div>
    ) : null;
  };

  const renderSmartGuides = () => smartGuides.map((guide) => {
    const baseColor = guide.source === 'canvas' ? 'rgba(34,211,238,0.9)' : 'rgba(129,140,248,0.9)';
    const glow = guide.source === 'canvas' ? 'rgba(34,211,238,0.45)' : 'rgba(129,140,248,0.45)';
    if (guide.orientation === 'vertical') {
      return (
        <div
          key={guide.id}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${guide.position}%`,
            width: 1,
            background: baseColor,
            boxShadow: `0 0 0 1px ${glow}`,
            pointerEvents: 'none',
            zIndex: 10000,
          }}
        />
      );
    }

    return (
      <div
        key={guide.id}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: `${guide.position}%`,
          height: 1,
          background: baseColor,
          boxShadow: `0 0 0 1px ${glow}`,
          pointerEvents: 'none',
          zIndex: 10000,
        }}
      />
    );
  });

  return (
    <div ref={canvasRef} onClick={() => { onSelectElement(null); onSelectBox(null); clearSmartGuides(); }}
      style={{ position: 'relative', aspectRatio: '16/9', width: '100%', overflow: 'hidden', borderRadius: 8, ...getBg() }}>
      {renderSmartGuides()}
      {(elements.boxes ?? []).filter(box => box.visible !== false).map((box, idx) => {
        const selected = activeBoxId === box.id;
        return (
          <div
            key={box.id}
            onMouseDown={(e) => handleBoxMouseDown(box.id, e)}
            style={{
              position: 'absolute',
              left: `${box.x}%`,
              top: `${box.y}%`,
              width: `${box.width}%`,
              height: `${box.height}%`,
              zIndex: box.zIndex ?? (10 + idx),
              cursor: draggingBoxId === box.id ? 'grabbing' : 'grab',
              borderRadius: box.borderRadius ?? 0,
              backgroundColor: hexToRgba(box.fillColor || '#000000', box.fillOpacity ?? 0),
              backgroundImage: box.imageUrl ? `url("${box.imageUrl}")` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
              outline: selected ? '2px dashed #22c55e' : '1px dashed rgba(34,197,94,0.5)',
              outlineOffset: selected ? 2 : 0,
              boxShadow: selected ? '0 0 0 1px rgba(34,197,94,0.35)' : 'none',
            }}
          />
        );
      })}
      {makeBox('scripture', 'Scripture', displayText)}
      {(ps.referenceVisible ?? true) && makeBox('reference', 'Reference', displayRef)}
    </div>
  );
}

// ─── Theme Card ────────────────────────────────────────────────────
const ThemeCard: React.FC<{
  theme: Theme; isActive: boolean;
  onSelect: () => void; onDuplicate: () => void; onDelete: () => void;
  onRename: (name: string) => void;
}> = function ThemeCard({ theme, isActive, onSelect, onDuplicate, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(theme.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => { const t = draft.trim(); if (t) onRename(t); else setDraft(theme.name); setEditing(false); };
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  return (
    <div onClick={onSelect} className={`group relative rounded-lg px-3 py-2.5 cursor-pointer transition-all ${isActive ? 'bg-indigo-600/20 border border-indigo-500/50' : 'hover:bg-zinc-800 border border-transparent'}`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-indigo-400' : 'bg-zinc-600'}`} />
        {editing ? (
          <input ref={inputRef} value={draft} onChange={e => setDraft(e.target.value)}
            onBlur={commit} onClick={e => e.stopPropagation()}
            onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(theme.name); setEditing(false); } }}
            className="flex-1 bg-transparent text-xs text-white border-b border-indigo-400 outline-none py-0.5" />
        ) : (
          <span className="flex-1 text-xs text-zinc-200 truncate">{theme.name}</span>
        )}
      </div>
      <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-1">
        <button onClick={e => { e.stopPropagation(); setEditing(true); }} className="p-1 text-zinc-500 hover:text-white rounded"><Pencil className="w-3 h-3" /></button>
        <button onClick={e => { e.stopPropagation(); onDuplicate(); }} className="p-1 text-zinc-500 hover:text-white rounded"><Copy className="w-3 h-3" /></button>
        <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-1 text-zinc-500 hover:text-red-400 rounded"><Trash2 className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

// ─── Right Panel: per-element style or global style ───────────────
type PanelTab = 'scripture' | 'reference' | 'boxes' | 'background';

function ElementPanel({ el, kind, theme, onUpdate }: {
  el: ElementPosition;
  kind: 'scripture' | 'reference';
  theme: Theme;
  onUpdate: (updates: Partial<ElementPosition>) => void;
}) {
  const ps = theme.settings;
  const accent = kind === 'scripture' ? 'text-indigo-400' : 'text-amber-400';
  const globalFontSize = kind === 'scripture' ? Math.round(64 * (ps.fontScale ?? 1)) : Math.round(32 * (ps.fontScale ?? 1));
  const defaultZ = kind === 'scripture'
    ? (DEFAULT_ELEMENTS.scripture.zIndex ?? 20)
    : (DEFAULT_ELEMENTS.reference.zIndex ?? 30);

  return (
    <div className="space-y-4">
      {/* Font */}
      <div>
        <SectionHeader title="Font" />
        <div className="space-y-2.5">
          <div>
            <span className="text-xs text-zinc-400 block mb-1.5">Family</span>
            <select value={el.fontFamily ?? ps.fontFamily ?? 'serif'} onChange={e => onUpdate({ fontFamily: e.target.value as any })}
              className="w-full bg-zinc-950 border border-zinc-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500">
              <option value="serif">Serif (Georgia)</option>
              <option value="sans">Sans-serif (System)</option>
              <option value="mono">Monospace</option>
            </select>
          </div>
          <NumberInput label="Size (px)" value={el.fontSize ?? globalFontSize} min={8} max={300} step={1} format="px"
            onChange={v => onUpdate({ fontSize: v })} />
        </div>
      </div>

      {/* Width */}
      <div>
        <SectionHeader title="Width" />
        <div className="space-y-2.5">
          {/* Slider + number input — disabled when single-line is on */}
          <div className={el.autoWidth ? 'opacity-40 pointer-events-none' : ''}>
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs text-zinc-400">Width</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={Math.round(el.width)}
                  min={5}
                  max={100}
                  step={1}
                  onChange={e => onUpdate({ width: Math.max(5, Math.min(100, parseInt(e.target.value) || 5)) })}
                  className="w-14 bg-zinc-950 border border-zinc-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 text-right tabular-nums"
                />
                <span className="text-xs text-zinc-500">%</span>
              </div>
            </div>
            <input
              type="range" min={5} max={100} step={1} value={el.width}
              onChange={e => onUpdate({ width: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 h-1.5"
            />
          </div>
          {/* Single Line toggle */}
          <Toggle
            label="Single Line"
            desc="Box expands horizontally to fit text (no wrap)"
            checked={el.autoWidth ?? false}
            onChange={v => onUpdate({ autoWidth: v })}
          />
        </div>
      </div>

      {/* Height */}
      <div>
        <SectionHeader title="Height" />
        <div className="space-y-2.5">
          <Toggle
            label="Fixed Height"
            desc="Constrain element to a set vertical height"
            checked={el.height !== undefined}
            onChange={v => onUpdate({ height: v ? 30 : undefined, autoFontSize: v ? el.autoFontSize : undefined })}
          />
          {el.height !== undefined && (
            <>
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-xs text-zinc-400">Height</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={Math.round(el.height)}
                      min={5}
                      max={90}
                      step={1}
                      onChange={e => onUpdate({ height: Math.max(5, Math.min(90, parseInt(e.target.value) || 5)) })}
                      className="w-14 bg-zinc-950 border border-zinc-700 text-white text-xs rounded px-2 py-1 focus:outline-none focus:border-indigo-500 text-right tabular-nums"
                    />
                    <span className="text-xs text-zinc-500">%</span>
                  </div>
                </div>
                <input
                  type="range" min={5} max={90} step={1} value={el.height}
                  onChange={e => onUpdate({ height: parseFloat(e.target.value) })}
                  className="w-full accent-indigo-500 h-1.5"
                />
              </div>
              <Toggle
                label="Auto Size"
                desc="Font scales automatically to fill the width × height box"
                checked={el.autoFontSize ?? false}
                onChange={v => onUpdate({ autoFontSize: v })}
              />
            </>
          )}
        </div>
      </div>

      {/* Alignment */}
      <div>
        <SectionHeader title="Alignment" />
        <AlignGrid
          hAlign={(el.textAlignment ?? ps.textAlignment ?? 'center') as 'left' | 'center' | 'right' | 'justify'}
          vAlign={el.verticalAlignment}
          hasHeight={el.height !== undefined}
          onHChange={v => onUpdate({ textAlignment: v })}
          onVChange={v => onUpdate({ verticalAlignment: v })}
        />
      </div>

      {/* Color */}
      <div>
        <SectionHeader title="Text" />
        <div className="space-y-2.5">
          <ColorPicker
            label="Color"
            value={el.textColor || (kind === 'scripture'
              ? ps.textColor || (ps.theme === 'light' ? '#000000' : '#ffffff')
              : ps.referenceColor || (ps.theme === 'light' ? '#374151' : '#a1a1aa'))}
            onChange={v => onUpdate({ textColor: v })}
          />
          <button onClick={() => onUpdate({ textColor: '' })}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2">
            Reset to theme default
          </button>
          <ColorPicker
            label="Highlight"
            value={el.textHighlightColor || '#000000'}
            onChange={v => onUpdate({ textHighlightColor: v })}
          />
          <SliderRow
            label="Highlight Opacity"
            value={el.textHighlightOpacity ?? 0}
            min={0}
            max={100}
            format={v => `${v}%`}
            onChange={v => onUpdate({ textHighlightOpacity: v })}
          />
          <NumberInput
            label="Corner Radius"
            value={el.borderRadius ?? 0}
            min={0}
            max={220}
            step={1}
            format="px"
            onChange={v => onUpdate({ borderRadius: v })}
          />
        </div>
      </div>

      {/* Layer */}
      <div>
        <SectionHeader title="Layer" />
        <div className="space-y-2.5">
          <NumberInput
            label="Z Index"
            value={el.zIndex ?? defaultZ}
            min={-100}
            max={500}
            step={1}
            onChange={v => onUpdate({ zIndex: v })}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => onUpdate({ zIndex: (el.zIndex ?? defaultZ) - 1 })}
              className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center gap-1"
            >
              <ArrowDown className="w-3 h-3" /> Backward
            </button>
            <button
              onClick={() => onUpdate({ zIndex: (el.zIndex ?? defaultZ) + 1 })}
              className={`text-xs px-2.5 py-1.5 rounded text-white flex items-center justify-center gap-1 ${kind === 'scripture' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-amber-600 hover:bg-amber-500'}`}
            >
              <ArrowUp className="w-3 h-3" /> Forward
            </button>
          </div>
        </div>
      </div>

      {/* Position info */}
      <div>
        <SectionHeader title="Position" />
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="X" value={Math.round(el.x)} min={0} max={99} format="%" onChange={v => onUpdate({ x: v })} />
          <NumberInput label="Y" value={Math.round(el.y)} min={0} max={90} format="%" onChange={v => onUpdate({ y: v })} />
        </div>
      </div>

      {/* Visibility */}
      <div>
        <SectionHeader title="Visibility" />
        <Toggle label="Visible" checked={el.visible} onChange={v => onUpdate({ visible: v })} />
      </div>
    </div>
  );
}

function BoxPanel({
  boxes,
  activeBoxId,
  onSelectBox,
  onAddBox,
  onUpdateBox,
  onDeleteBox,
  themeAssets,
  onUploadAsset,
  onRemoveAsset,
}: {
  boxes: ThemeBoxLayer[];
  activeBoxId: string | null;
  onSelectBox: (id: string) => void;
  onAddBox: () => void;
  onUpdateBox: (id: string, updates: Partial<ThemeBoxLayer>) => void;
  onDeleteBox: (id: string) => void;
  themeAssets: ThemeAsset[];
  onUploadAsset: (file: File) => Promise<void>;
  onRemoveAsset: (assetId: string) => void;
}) {
  const assetInputRef = useRef<HTMLInputElement | null>(null);
  const activeBox = boxes.find((box) => box.id === activeBoxId) ?? null;
  const selectedAsset = themeAssets.find((asset) => asset.dataUrl === (activeBox?.imageUrl || '')) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <SectionHeader title="Box Layers" />
        <div className="space-y-2.5">
          <button
            onClick={onAddBox}
            className="w-full text-xs px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add Box Layer
          </button>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {boxes.length === 0 && (
              <p className="text-xs text-zinc-500">No box layers yet. Add one to start.</p>
            )}
            {boxes.map((box, idx) => (
              <button
                key={box.id}
                onClick={() => onSelectBox(box.id)}
                className={`w-full px-2.5 py-1.5 rounded text-xs flex items-center justify-between border ${activeBoxId === box.id ? 'border-emerald-500/70 bg-emerald-900/20 text-emerald-200' : 'border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-900'}`}
              >
                <span className="truncate">Box {idx + 1}</span>
                <span className="text-[10px] text-zinc-500">z{box.zIndex}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeBox && (
        <>
          <div>
            <SectionHeader title="Layer" />
            <div className="space-y-2.5">
              <NumberInput
                label="Z Index"
                value={activeBox.zIndex}
                min={-100}
                max={500}
                step={1}
                onChange={(v) => onUpdateBox(activeBox.id, { zIndex: v })}
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => onUpdateBox(activeBox.id, { zIndex: activeBox.zIndex - 1 })}
                  className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 flex items-center justify-center gap-1"
                >
                  <ArrowDown className="w-3 h-3" /> Backward
                </button>
                <button
                  onClick={() => onUpdateBox(activeBox.id, { zIndex: activeBox.zIndex + 1 })}
                  className="text-xs px-2.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center gap-1"
                >
                  <ArrowUp className="w-3 h-3" /> Forward
                </button>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="Style" />
            <div className="space-y-2.5">
              <ColorPicker
                label="Fill Color"
                value={activeBox.fillColor}
                onChange={(v) => onUpdateBox(activeBox.id, { fillColor: v })}
              />
              <SliderRow
                label="Fill Opacity"
                value={activeBox.fillOpacity}
                min={0}
                max={100}
                format={(v) => `${v}%`}
                onChange={(v) => onUpdateBox(activeBox.id, { fillOpacity: v })}
              />
              <NumberInput
                label="Corner Radius"
                value={activeBox.borderRadius}
                min={0}
                max={240}
                step={1}
                format="px"
                onChange={(v) => onUpdateBox(activeBox.id, { borderRadius: v })}
              />
              <div>
                <span className="text-xs text-zinc-400 block mb-1.5">Theme Asset (Image)</span>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={selectedAsset?.id || ''}
                      onChange={(e) => {
                        const selected = themeAssets.find((asset) => asset.id === e.target.value);
                        onUpdateBox(activeBox.id, { imageUrl: selected?.dataUrl || '' });
                      }}
                      className="flex-1 bg-zinc-950 border border-zinc-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">No asset selected</option>
                      {themeAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => assetInputRef.current?.click()}
                      className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs"
                      title="Upload image asset"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      Upload
                    </button>
                  </div>
                  <input
                    ref={assetInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.currentTarget.value = '';
                      if (!file) return;
                      try {
                        await onUploadAsset(file);
                      } catch (error) {
                        console.warn('[ThemeDesigner] Failed to upload asset:', error);
                      }
                    }}
                  />

                  {selectedAsset && (
                    <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 p-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span className="text-[11px] text-zinc-300 truncate" title={selectedAsset.name}>
                          {selectedAsset.name}
                        </span>
                      </div>
                      <button
                        onClick={() => onRemoveAsset(selectedAsset.id)}
                        className="text-[10px] text-red-300 hover:text-red-200"
                      >
                        Remove Asset
                      </button>
                    </div>
                  )}

                  <div>
                    <span className="text-xs text-zinc-400 block mb-1.5">Image URL (Optional)</span>
                    <input
                      type="text"
                      value={activeBox.imageUrl || ''}
                      onChange={(e) => onUpdateBox(activeBox.id, { imageUrl: e.target.value })}
                      placeholder="https://... or pasted data URL"
                      className="w-full bg-zinc-950 border border-zinc-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={() => onUpdateBox(activeBox.id, { imageUrl: '' })}
                      className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2 mt-1.5"
                    >
                      Clear image
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <SectionHeader title="Position" />
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="X"
                value={Math.round(activeBox.x)}
                min={0}
                max={95}
                format="%"
                onChange={(v) => onUpdateBox(activeBox.id, { x: v })}
              />
              <NumberInput
                label="Y"
                value={Math.round(activeBox.y)}
                min={0}
                max={95}
                format="%"
                onChange={(v) => onUpdateBox(activeBox.id, { y: v })}
              />
              <NumberInput
                label="Width"
                value={Math.round(activeBox.width)}
                min={1}
                max={100}
                format="%"
                onChange={(v) => onUpdateBox(activeBox.id, { width: v })}
              />
              <NumberInput
                label="Height"
                value={Math.round(activeBox.height)}
                min={1}
                max={100}
                format="%"
                onChange={(v) => onUpdateBox(activeBox.id, { height: v })}
              />
            </div>
          </div>

          <div>
            <SectionHeader title="Visibility" />
            <div className="space-y-2.5">
              <Toggle
                label="Visible"
                checked={activeBox.visible}
                onChange={(v) => onUpdateBox(activeBox.id, { visible: v })}
              />
              <button
                onClick={() => onDeleteBox(activeBox.id)}
                className="w-full text-xs px-3 py-2 rounded-lg bg-red-900/30 text-red-300 border border-red-500/40 hover:bg-red-900/45"
              >
                Delete Box
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BackgroundPanel({ ps, up }: { ps: PresentationSettings; up: (p: Partial<PresentationSettings>) => void }) {
  return (
    <div className="space-y-4">
      {/* Background */}
      <div>
        <SectionHeader title="Background" />
        <div className="space-y-2.5">
          <select value={ps.theme} onChange={e => up({ theme: e.target.value as any })}
            className="w-full bg-zinc-950 border border-zinc-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500">
            <option value="dark">Dark</option>
            <option value="light">Light</option>
            <option value="transparent">Transparent (OBS)</option>
            <option value="chroma-green">Chroma Green</option>
          </select>
          {ps.theme !== 'transparent' && ps.theme !== 'chroma-green' && (
            <>
              <ColorPicker label="Color" value={ps.backgroundColor || (ps.theme === 'light' ? '#ffffff' : '#000000')}
                onChange={v => up({ backgroundColor: v })} />
              <SliderRow label="Opacity" value={ps.backgroundOpacity ?? 100} min={0} max={100}
                format={v => `${v}%`} onChange={v => up({ backgroundOpacity: v })} />
            </>
          )}
        </div>
      </div>

      {/* Global defaults */}
      <div>
        <SectionHeader title="Global Defaults" />
        <p className="text-[10px] text-zinc-500 mb-2.5">These apply to elements that don't have their own overrides.</p>
        <div className="space-y-2.5">
          <select value={ps.fontFamily ?? 'serif'} onChange={e => up({ fontFamily: e.target.value as any })}
            className="w-full bg-zinc-950 border border-zinc-800 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500">
            <option value="serif">Serif (Georgia)</option>
            <option value="sans">Sans-serif</option>
            <option value="mono">Monospace</option>
          </select>
          <SliderRow label="Scale" value={ps.fontScale ?? 1} min={0.5} max={2} step={0.05}
            format={v => `${v.toFixed(2)}×`} onChange={v => up({ fontScale: v })} />
        </div>
      </div>

      {/* Reference */}
      <div>
        <SectionHeader title="Reference" />
        <div className="space-y-1.5">
          <Toggle label="Show Reference" checked={ps.referenceVisible ?? true} onChange={v => up({ referenceVisible: v })} />
          <Toggle label="Show Version" checked={ps.versionVisible ?? true} onChange={v => up({ versionVisible: v })} />
        </div>
      </div>

      {/* Effects */}
      <div>
        <SectionHeader title="Effects" />
        <div className="space-y-1">
          <Toggle label="Text Shadow" desc="Adds depth on video backgrounds" checked={ps.textShadow ?? false} onChange={v => up({ textShadow: v })} />
          <Toggle label='Verse Quotes' desc='Wrap verse in \u201c\u201d' checked={ps.verseQuotes ?? true} onChange={v => up({ verseQuotes: v })} />
          <Toggle label="Broadcast Safe" desc="Extra padding for OBS / streaming" checked={ps.broadcastSafe ?? false} onChange={v => up({ broadcastSafe: v })} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────
interface ThemeDesignerProps { onClose: () => void; }

export default function ThemeDesigner({ onClose }: ThemeDesignerProps) {
  const {
    themes, activeThemeId, addTheme, duplicateTheme, updateTheme, deleteTheme, setActiveTheme,
    previewScripture, goLiveWithTransition,
    themeAssets, addThemeAsset, removeThemeAsset,
  } = useStore();

  const [sampleIdx, setSampleIdx] = useState(0);
  const [panelTab, setPanelTab] = useState<PanelTab>('scripture');
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);

  // Auto-create default theme if empty
  useEffect(() => {
    const { themes: ct, activeThemeId: ca } = useStore.getState();
    if (ct.length === 0) { const id = addTheme('Default Theme'); setActiveTheme(id); }
    else if (!ca) setActiveTheme(ct[0].id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTheme = themes.find(t => t.id === activeThemeId) ?? themes[0];

  const up = useCallback((partial: Partial<PresentationSettings>) => {
    if (!activeTheme) return;
    updateTheme(activeTheme.id, { settings: { ...activeTheme.settings, ...partial } });
  }, [activeTheme, updateTheme]);

  const upEl = useCallback((kind: 'scripture' | 'reference', updates: Partial<ElementPosition>) => {
    if (!activeTheme) return;
    updateTheme(activeTheme.id, {
      elements: { ...activeTheme.elements, [kind]: { ...activeTheme.elements[kind], ...updates } },
    });
  }, [activeTheme, updateTheme]);

  const upElements = useCallback((elements: ThemeElements) => {
    if (!activeTheme) return;
    updateTheme(activeTheme.id, { elements });
  }, [activeTheme, updateTheme]);

  const upBoxes = useCallback((boxes: ThemeBoxLayer[]) => {
    if (!activeTheme) return;
    updateTheme(activeTheme.id, { elements: { ...activeTheme.elements, boxes } });
  }, [activeTheme, updateTheme]);

  const addBox = useCallback(() => {
    if (!activeTheme) return;
    const maxZ = Math.max(
      activeTheme.elements.scripture.zIndex ?? (DEFAULT_ELEMENTS.scripture.zIndex ?? 20),
      activeTheme.elements.reference.zIndex ?? (DEFAULT_ELEMENTS.reference.zIndex ?? 30),
      ...(activeTheme.elements.boxes ?? []).map((box) => box.zIndex ?? 0),
    );
    const newBox: ThemeBoxLayer = {
      id: crypto.randomUUID(),
      x: 10,
      y: 10,
      width: 30,
      height: 20,
      visible: true,
      zIndex: maxZ + 1,
      fillColor: '#000000',
      fillOpacity: 40,
      borderRadius: 0,
      imageUrl: '',
    };
    upBoxes([...(activeTheme.elements.boxes ?? []), newBox]);
    setPanelTab('boxes');
    setActiveBoxId(newBox.id);
  }, [activeTheme, upBoxes]);

  const updateBox = useCallback((boxId: string, updates: Partial<ThemeBoxLayer>) => {
    if (!activeTheme) return;
    upBoxes((activeTheme.elements.boxes ?? []).map((box) => (
      box.id === boxId ? { ...box, ...updates } : box
    )));
  }, [activeTheme, upBoxes]);

  const deleteBox = useCallback((boxId: string) => {
    if (!activeTheme) return;
    const next = (activeTheme.elements.boxes ?? []).filter((box) => box.id !== boxId);
    upBoxes(next);
    setActiveBoxId(next[0]?.id ?? null);
  }, [activeTheme, upBoxes]);

  const applySnap = (preset: keyof typeof SNAP_PRESETS) => {
    if (!activeTheme) return;
    const p = SNAP_PRESETS[preset];
    updateTheme(activeTheme.id, {
      elements: {
        scripture: { ...activeTheme.elements.scripture, ...p.scripture },
        reference: { ...activeTheme.elements.reference, ...p.reference },
        boxes: activeTheme.elements.boxes ?? [],
      },
    });
  };

  useEffect(() => {
    if (!activeTheme || panelTab !== 'boxes') return;
    const boxes = activeTheme.elements.boxes ?? [];
    if (boxes.length === 0) {
      setActiveBoxId(null);
      return;
    }
    if (!activeBoxId || !boxes.some((box) => box.id === activeBoxId)) {
      setActiveBoxId(boxes[0].id);
    }
  }, [activeTheme, panelTab, activeBoxId]);

  const sampleVerse = previewScripture
    ? { text: previewScripture.text, reference: `${previewScripture.book} ${previewScripture.chapter}:${previewScripture.verse}`, version: previewScripture.version }
    : SAMPLE_VERSES[sampleIdx];

  const uploadThemeAsset = useCallback(async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    addThemeAsset({
      name: file.name,
      type: 'image',
      dataUrl,
      mimeType: file.type || 'application/octet-stream',
    });
  }, [addThemeAsset]);

  if (!activeTheme) return null;
  const ps = activeTheme.settings;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="p-1.5 bg-indigo-600/20 rounded-lg"><Layers className="w-4 h-4 text-indigo-400" /></div>
          <h2 className="text-sm font-semibold text-white">Theme Designer</h2>
          <span className="text-xs text-zinc-600 hidden sm:block">
            Drag <span className="text-indigo-400">Scripture</span> &amp; <span className="text-amber-400">Reference</span> and stack color/image box layers
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={() => { if (previewScripture) goLiveWithTransition(previewScripture); }} disabled={!previewScripture}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors">
            <Zap className="w-3.5 h-3.5" /><span>Apply to Live</span>
          </button>
          <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Theme Library */}
        <div className="w-52 shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/40">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Themes</span>
            <button onClick={() => { const id = addTheme(`Theme ${themes.length + 1}`); setActiveTheme(id); }}
              className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded" title="New Theme">
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {themes.map(t => (
              <ThemeCard key={t.id} theme={t} isActive={t.id === activeThemeId}
                onSelect={() => setActiveTheme(t.id)}
                onDuplicate={() => { const id = duplicateTheme(t.id); setActiveTheme(id); }}
                onDelete={() => deleteTheme(t.id)}
                onRename={name => updateTheme(t.id, { name })} />
            ))}
            {themes.length === 0 && <p className="text-xs text-zinc-600 text-center mt-6">No themes yet.<br />Click + to create one.</p>}
          </div>
        </div>

        {/* Center: Canvas */}
        <div className="flex-1 flex flex-col bg-zinc-900 overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-xs text-zinc-500 mr-1">Snap:</span>
              {(['top', 'middle', 'lowerThird'] as const).map(p => (
                <button key={p} onClick={() => applySnap(p)}
                  className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors">
                  {p === 'top' ? 'Top' : p === 'middle' ? 'Middle' : 'Lower Third'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={addBox}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors text-emerald-300 bg-emerald-900/30 hover:bg-emerald-800/40"
              >
                <Square className="w-3 h-3" /> Add Box
              </button>
              <button onClick={() => { upEl('scripture', { visible: !activeTheme.elements.scripture.visible }); }}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${activeTheme.elements.scripture.visible ? 'text-indigo-300 bg-indigo-900/30' : 'text-zinc-500 bg-zinc-800'}`}>
                {activeTheme.elements.scripture.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Scripture
              </button>
              <button onClick={() => { upEl('reference', { visible: !activeTheme.elements.reference.visible }); }}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${activeTheme.elements.reference.visible ? 'text-amber-300 bg-amber-900/30' : 'text-zinc-500 bg-zinc-800'}`}>
                {activeTheme.elements.reference.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />} Reference
              </button>
              <span className="text-xs text-emerald-400">
                {(activeTheme.elements.boxes ?? []).length} box layer{(activeTheme.elements.boxes ?? []).length === 1 ? '' : 's'}
              </span>
              <span className="text-xs text-zinc-600 flex items-center gap-1"><Monitor className="w-3 h-3" /> 1920×1080</span>
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 flex flex-col items-center justify-center p-5 gap-3 overflow-hidden">
            <div className="w-full max-w-5xl shadow-2xl">
              <DragCanvas
                theme={activeTheme}
                sampleVerse={sampleVerse}
                selectedElement={panelTab === 'scripture' || panelTab === 'reference' ? panelTab : null}
                activeBoxId={activeBoxId}
                onSelectElement={el => { if (el) setPanelTab(el); }}
                onSelectBox={(boxId) => {
                  setActiveBoxId(boxId);
                  if (boxId) setPanelTab('boxes');
                }}
                onElementsChange={upElements}
              />
            </div>

            {/* Position readouts */}
            <div className="flex gap-5 text-xs flex-wrap justify-center">
              <span className="text-indigo-400 cursor-pointer hover:text-indigo-300" onClick={() => setPanelTab('scripture')}>
                <span className="inline-block w-2 h-2 rounded-sm bg-indigo-500 mr-1.5" />
                Scripture: {Math.round(activeTheme.elements.scripture.x)}%, {Math.round(activeTheme.elements.scripture.y)}%
                {activeTheme.elements.scripture.autoWidth ? ' · single-line' : ` · ${activeTheme.elements.scripture.width}% wide`}
                {activeTheme.elements.scripture.height !== undefined ? ` · ${Math.round(activeTheme.elements.scripture.height)}% tall` : ''}
                {activeTheme.elements.scripture.autoFontSize ? ' · auto-size' : ''}
                {' · '}{activeTheme.elements.scripture.fontSize ?? 64}px
              </span>
              <span className="text-amber-400 cursor-pointer hover:text-amber-300" onClick={() => setPanelTab('reference')}>
                <span className="inline-block w-2 h-2 rounded-sm bg-amber-500 mr-1.5" />
                Reference: {Math.round(activeTheme.elements.reference.x)}%, {Math.round(activeTheme.elements.reference.y)}%
                {activeTheme.elements.reference.autoWidth ? ' · single-line' : ` · ${activeTheme.elements.reference.width}% wide`}
                {activeTheme.elements.reference.height !== undefined ? ` · ${Math.round(activeTheme.elements.reference.height)}% tall` : ''}
                {activeTheme.elements.reference.autoFontSize ? ' · auto-size' : ''}
                {' · '}{activeTheme.elements.reference.fontSize ?? 32}px
              </span>
              <span className="text-emerald-400 cursor-pointer hover:text-emerald-300" onClick={() => setPanelTab('boxes')}>
                <span className="inline-block w-2 h-2 rounded-sm bg-emerald-500 mr-1.5" />
                Boxes: {(activeTheme.elements.boxes ?? []).length}
                {activeBoxId ? ` · selected ${Math.max(1, (activeTheme.elements.boxes ?? []).findIndex((b) => b.id === activeBoxId) + 1)}` : ''}
              </span>
            </div>

            {/* Sample picker */}
            {!previewScripture ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Preview verse:</span>
                <select value={sampleIdx} onChange={e => setSampleIdx(parseInt(e.target.value))}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-2.5 py-1 focus:outline-none focus:border-indigo-500">
                  {SAMPLE_VERSES.map((v, i) => <option key={i} value={i}>{v.reference} — {v.text.slice(0, 40)}…</option>)}
                </select>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Previewing: <span className="text-zinc-300">{previewScripture.book} {previewScripture.chapter}:{previewScripture.verse} ({previewScripture.version})</span>
              </p>
            )}
          </div>
        </div>

        {/* Right: Style panel with tabs */}
        <div className="w-64 shrink-0 border-l border-zinc-800 flex flex-col bg-zinc-900/40">
          {/* Tabs */}
          <div className="flex border-b border-zinc-800 shrink-0">
            {([
              { id: 'scripture', label: 'Scripture', color: 'text-indigo-400' },
              { id: 'reference', label: 'Reference', color: 'text-amber-400' },
              { id: 'boxes', label: 'Boxes', color: 'text-emerald-400' },
              { id: 'background', label: 'BG & FX', color: 'text-zinc-400' },
            ] as const).map(tab => (
              <button key={tab.id} onClick={() => setPanelTab(tab.id)}
                className={`flex-1 py-2 text-xs font-medium transition-colors border-b-2 ${panelTab === tab.id ? `${tab.color} border-current` : 'text-zinc-500 border-transparent hover:text-zinc-300'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto p-4">
            {panelTab === 'scripture' && (
              <ElementPanel el={activeTheme.elements.scripture} kind="scripture" theme={activeTheme}
                onUpdate={u => upEl('scripture', u)} />
            )}
            {panelTab === 'reference' && (
              <ElementPanel el={activeTheme.elements.reference} kind="reference" theme={activeTheme}
                onUpdate={u => upEl('reference', u)} />
            )}
            {panelTab === 'boxes' && (
              <BoxPanel
                boxes={activeTheme.elements.boxes ?? []}
                activeBoxId={activeBoxId}
                onSelectBox={(id) => setActiveBoxId(id)}
                onAddBox={addBox}
                onUpdateBox={updateBox}
                onDeleteBox={deleteBox}
                themeAssets={themeAssets.filter((asset) => asset.type === 'image')}
                onUploadAsset={uploadThemeAsset}
                onRemoveAsset={removeThemeAsset}
              />
            )}
            {panelTab === 'background' && (
              <BackgroundPanel ps={ps} up={up} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
