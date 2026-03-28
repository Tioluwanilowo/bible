export type GuideOrientation = 'vertical' | 'horizontal';

export interface SmartGuide {
  id: string;
  orientation: GuideOrientation;
  position: number; // percent position on canvas axis (0-100)
  source: 'element' | 'canvas';
}

export interface CanvasBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
}

export interface DragBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AlignmentCandidate {
  axis: 'x' | 'y';
  value: number;
  source: 'element' | 'canvas';
}

interface SnapInput {
  dragBounds: DragBounds;
  candidates: AlignmentCandidate[];
  thresholdX: number;
  thresholdY: number;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: SmartGuide[];
}

const DEFAULT_TEXT_HEIGHT = {
  scripture: 20,
  reference: 10,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function dedupeGuides(guides: SmartGuide[]): SmartGuide[] {
  const seen = new Set<string>();
  const result: SmartGuide[] = [];
  for (const guide of guides) {
    const key = `${guide.orientation}:${guide.position.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(guide);
  }
  return result;
}

/**
 * Build normalized canvas bounds for all draggable objects in the editor.
 * Values are in percentages (0-100), which keeps logic independent from canvas pixel size.
 */
export function getElementBounds(elements: {
  scripture: { x: number; y: number; width: number; height?: number; visible: boolean };
  reference: { x: number; y: number; width: number; height?: number; visible: boolean };
  boxes?: Array<{ id: string; x: number; y: number; width: number; height: number; visible: boolean }>;
}): CanvasBounds[] {
  const bounds: CanvasBounds[] = [];

  bounds.push({
    id: 'scripture',
    x: elements.scripture.x,
    y: elements.scripture.y,
    width: elements.scripture.width,
    height: elements.scripture.height ?? DEFAULT_TEXT_HEIGHT.scripture,
    visible: elements.scripture.visible,
  });

  bounds.push({
    id: 'reference',
    x: elements.reference.x,
    y: elements.reference.y,
    width: elements.reference.width,
    height: elements.reference.height ?? DEFAULT_TEXT_HEIGHT.reference,
    visible: elements.reference.visible,
  });

  for (const box of elements.boxes ?? []) {
    bounds.push({
      id: `box:${box.id}`,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      visible: box.visible,
    });
  }

  return bounds;
}

/**
 * Returns all edge/center alignment targets from other objects plus canvas centers.
 */
export function getAlignmentCandidates(
  allBounds: CanvasBounds[],
  draggingId: string,
): AlignmentCandidate[] {
  const others = allBounds.filter((bounds) => bounds.id !== draggingId && bounds.visible);
  const candidates: AlignmentCandidate[] = [];

  for (const bounds of others) {
    candidates.push({ axis: 'x', value: bounds.x, source: 'element' });
    candidates.push({ axis: 'x', value: bounds.x + bounds.width / 2, source: 'element' });
    candidates.push({ axis: 'x', value: bounds.x + bounds.width, source: 'element' });
    candidates.push({ axis: 'y', value: bounds.y, source: 'element' });
    candidates.push({ axis: 'y', value: bounds.y + bounds.height / 2, source: 'element' });
    candidates.push({ axis: 'y', value: bounds.y + bounds.height, source: 'element' });
  }

  // Canvas center guides
  candidates.push({ axis: 'x', value: 50, source: 'canvas' });
  candidates.push({ axis: 'y', value: 50, source: 'canvas' });

  return candidates;
}

/**
 * Compute snapped drag position and temporary guide lines.
 * Chooses the closest valid candidate on each axis to avoid snap fighting.
 */
export function getSnapPosition({
  dragBounds,
  candidates,
  thresholdX,
  thresholdY,
}: SnapInput): SnapResult {
  let snappedX = dragBounds.x;
  let snappedY = dragBounds.y;
  const guides: SmartGuide[] = [];

  const xAnchors = [
    { name: 'left', value: dragBounds.x, offset: 0 },
    { name: 'center', value: dragBounds.x + dragBounds.width / 2, offset: dragBounds.width / 2 },
    { name: 'right', value: dragBounds.x + dragBounds.width, offset: dragBounds.width },
  ] as const;

  const yAnchors = [
    { name: 'top', value: dragBounds.y, offset: 0 },
    { name: 'center', value: dragBounds.y + dragBounds.height / 2, offset: dragBounds.height / 2 },
    { name: 'bottom', value: dragBounds.y + dragBounds.height, offset: dragBounds.height },
  ] as const;

  type AxisMatch = {
    distance: number;
    snappedValue: number;
    candidate: AlignmentCandidate;
  } | null;

  let bestX: AxisMatch = null;
  let bestY: AxisMatch = null;

  for (const candidate of candidates) {
    if (candidate.axis === 'x') {
      for (const anchor of xAnchors) {
        const snappedValue = candidate.value - anchor.offset;
        const distance = Math.abs(snappedValue - dragBounds.x);
        if (distance > thresholdX) continue;
        if (!bestX || distance < bestX.distance) {
          bestX = { distance, snappedValue, candidate };
        }
      }
    } else {
      for (const anchor of yAnchors) {
        const snappedValue = candidate.value - anchor.offset;
        const distance = Math.abs(snappedValue - dragBounds.y);
        if (distance > thresholdY) continue;
        if (!bestY || distance < bestY.distance) {
          bestY = { distance, snappedValue, candidate };
        }
      }
    }
  }

  if (bestX) {
    snappedX = clamp(bestX.snappedValue, 0, 100 - dragBounds.width);
    guides.push({
      id: `guide-v-${bestX.candidate.value.toFixed(3)}`,
      orientation: 'vertical',
      position: bestX.candidate.value,
      source: bestX.candidate.source,
    });
  }

  if (bestY) {
    snappedY = clamp(bestY.snappedValue, 0, 100 - dragBounds.height);
    guides.push({
      id: `guide-h-${bestY.candidate.value.toFixed(3)}`,
      orientation: 'horizontal',
      position: bestY.candidate.value,
      source: bestY.candidate.source,
    });
  }

  return {
    x: snappedX,
    y: snappedY,
    guides: dedupeGuides(guides),
  };
}
