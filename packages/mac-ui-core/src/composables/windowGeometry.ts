import type { WindowRect } from '../types';

export const COMPACT_WINDOW_BREAKPOINT = 640;

export interface WindowViewport {
  width: number;
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
}

export interface WindowWorkArea extends WindowRect {
  compact: boolean;
}

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : min, min), max);
}

/** Layout zoom changes innerWidth; pinch zoom must not rearrange the desktop. */
export function readWindowViewport(): WindowViewport {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  const visual = window.visualViewport;
  const useVisual = visual && Math.abs(visual.scale - 1) < 0.01;
  return {
    width: useVisual ? Math.min(window.innerWidth, visual.width) : window.innerWidth,
    height: useVisual ? Math.min(window.innerHeight, visual.height) : window.innerHeight,
    offsetLeft: useVisual ? visual.offsetLeft : 0,
    offsetTop: useVisual ? visual.offsetTop : 0
  };
}

/** Keep this contract aligned with the host's 28px menu and bottom Dock. */
export function getWindowWorkArea(viewport: WindowViewport): WindowWorkArea {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const compact = width <= COMPACT_WINDOW_BREAKPOINT;
  const side = compact ? 0 : Math.min(10, (width - 1) / 2);
  const top = Math.min(34, height - 1);
  const bottom = Math.min(compact ? 86 : 96, height - top - 1);
  return {
    x: (viewport.offsetLeft ?? 0) + side,
    y: (viewport.offsetTop ?? 0) + top,
    w: Math.max(1, width - side * 2),
    h: Math.max(1, height - top - bottom),
    compact
  };
}

export function fillWorkArea(area: WindowWorkArea): WindowRect {
  return { x: area.x, y: area.y, w: area.w, h: area.h };
}

/** App minimums are preferences: the actual viewport is always the hard limit. */
export function clampWindowRect(rect: WindowRect, area: WindowWorkArea, minW = 1, minH = 1): WindowRect {
  const w = clamp(rect.w, Math.min(Math.max(1, minW), area.w), area.w);
  const h = clamp(rect.h, Math.min(Math.max(1, minH), area.h), area.h);
  return {
    x: clamp(rect.x, area.x, area.x + area.w - w),
    y: clamp(rect.y, area.y, area.y + area.h - h),
    w, h
  };
}

export function repositionWindowRect(
  rect: WindowRect, previous: WindowWorkArea, next: WindowWorkArea, minW = 1, minH = 1
): WindowRect {
  const centerX = (rect.x + rect.w / 2 - previous.x) / previous.w;
  const centerY = (rect.y + rect.h / 2 - previous.y) / previous.h;
  return clampWindowRect({
    ...rect,
    x: next.x + centerX * next.w - rect.w / 2,
    y: next.y + centerY * next.h - rect.h / 2
  }, next, minW, minH);
}

/** The opposite edge stays anchored, even when a pointer moves beyond an edge. */
export function resizeWindowRect(
  initial: WindowRect, direction: ResizeDirection, dx: number, dy: number,
  area: WindowWorkArea, minW: number, minH: number
): WindowRect {
  const rect = clampWindowRect(initial, area, minW, minH);
  let left = rect.x;
  let top = rect.y;
  let right = left + rect.w;
  let bottom = top + rect.h;
  const widthFloor = Math.min(Math.max(1, minW), area.w);
  const heightFloor = Math.min(Math.max(1, minH), area.h);
  if (direction.includes('w')) left = clamp(left + dx, area.x, right - widthFloor);
  if (direction.includes('e')) right = clamp(right + dx, left + widthFloor, area.x + area.w);
  if (direction.includes('n')) top = clamp(top + dy, area.y, bottom - heightFloor);
  if (direction.includes('s')) bottom = clamp(bottom + dy, top + heightFloor, area.y + area.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
