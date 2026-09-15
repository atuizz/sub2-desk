import { ref, computed, inject, provide, getCurrentScope, onScopeDispose, type InjectionKey } from 'vue';
import type { WindowInstance, AppDefinition, WindowRect } from '../types';
import { createDraftRegistry } from './draftRegistry';
import { clampWindowRect, fillWorkArea, getWindowWorkArea, readWindowViewport, repositionWindowRect } from './windowGeometry';

export const WINDOW_MANAGER_KEY: InjectionKey<WindowManager> = Symbol('WINDOW_MANAGER');
export function provideWindowManager(wm: WindowManager) { provide(WINDOW_MANAGER_KEY, wm); }
export function useWindowManager(): WindowManager | undefined { return inject(WINDOW_MANAGER_KEY, undefined); }

export function createWindowManager() {
  const windows = ref<WindowInstance[]>([]);
  const registeredApps = ref<Record<string, AppDefinition>>({});
  const activeWindowId = ref<string | null>(null);
  const workArea = ref(getWindowWorkArea(readWindowViewport()));
  const isCompact = computed(() => workArea.value.compact);
  // Compact mode changes presentation, not the user's desktop arrangement.
  const desktopRects = new Map<string, WindowRect>();
  let desktopArea = workArea.value;
  let highestZ = 100;
  let cascadeOffset = 0;
  let nextWindowId = 0;
  let resizeFrame: number | null = null;
  let disposed = false;
  const drafts = createDraftRegistry(focusWindow);

  function registerApp(app: AppDefinition) { registeredApps.value[app.id] = app; }
  function registerApps(apps: AppDefinition[]) { apps.forEach(registerApp); }
  const activeWindow = computed(() => windows.value.find(w => w.id === activeWindowId.value) || null);
  const activeAppName = computed(() => {
    if (!activeWindow.value) return '访达';
    return registeredApps.value[activeWindow.value.appId]?.name ?? activeWindow.value.title;
  });

  function focusWindow(id: string) {
    const win = windows.value.find(w => w.id === id);
    if (!win) return;
    if (activeWindowId.value !== id || win.isMinimized) win.zIndex = ++highestZ;
    // A repeated Dock click keeps the same focused flag, so expose the activation
    // as a monotonic signal for apps that need to restore transient view state.
    win.focusRevision = (win.focusRevision ?? 0) + 1;
    win.isMinimized = false;
    activeWindowId.value = id;
    windows.value.forEach(w => { w.isFocused = w.id === id; });
  }

  function focusTopWindow() {
    const top = windows.value.filter(w => !w.isMinimized)
      .reduce<WindowInstance | null>((best, w) => !best || w.zIndex > best.zIndex ? w : best, null);
    if (top) focusWindow(top.id);
    else {
      activeWindowId.value = null;
      windows.value.forEach(w => { w.isFocused = false; });
    }
  }

  function openApp(appId: string, customData?: Record<string, any>) {
    const existing = windows.value.find(w => w.appId === appId);
    if (existing) {
      focusWindow(existing.id);
      if (customData) existing.customData = customData;
      return existing;
    }
    const meta = registeredApps.value[appId];
    if (!meta) { console.warn(`[WM] Unknown app: ${appId}`); return null; }
    refreshLayout();
    const area = workArea.value;
    const offset = (cascadeOffset++ % 6) * 26;
    const minW = meta.minW ?? 500;
    const minH = meta.minH ?? 360;
    const rect = area.compact ? fillWorkArea(area) : clampWindowRect({
      x: area.x + (area.w - Math.min(meta.defaultW, area.w)) / 2 + offset,
      y: area.y + (area.h - Math.min(meta.defaultH, area.h)) / 2 + offset,
      w: meta.defaultW, h: meta.defaultH
    }, area, minW, minH);
    const newWin: WindowInstance = {
      id: `${appId}-${Date.now()}-${++nextWindowId}`,
      appId, title: meta.title, icon: meta.icon, rect, minW, minH,
      zIndex: ++highestZ, focusRevision: 0, isMinimized: false, isMaximized: false, isFocused: true,
      category: meta.category, customData
    };
    windows.value.push(newWin);
    focusWindow(newWin.id);
    return windows.value.find(w => w.id === newWin.id)!;
  }

  function forceCloseWindow(id: string) {
    drafts.forget(id);
    const idx = windows.value.findIndex(w => w.id === id);
    if (idx < 0) return;
    const wasActive = activeWindowId.value === id;
    windows.value.splice(idx, 1);
    desktopRects.delete(id);
    if (wasActive) focusTopWindow();
  }

  function closeWindow(id: string) {
    if (!windows.value.some(win => win.id === id)) return false;
    return drafts.run('关闭窗口', () => forceCloseWindow(id), id);
  }

  // Session revocation and teardown must not retain another identity's UI.
  function forceCloseAllWindows() {
    drafts.forget();
    windows.value = [];
    activeWindowId.value = null;
    desktopRects.clear();
  }

  function closeAllWindows(action = '关闭所有窗口') {
    return drafts.run(action, forceCloseAllWindows);
  }

  function minimizeWindow(id: string) {
    const win = windows.value.find(w => w.id === id);
    if (!win) return;
    const wasActive = activeWindowId.value === id;
    win.isMinimized = true;
    win.isFocused = false;
    if (wasActive) focusTopWindow();
  }

  function toggleMaximizeWindow(id: string) {
    const win = windows.value.find(w => w.id === id);
    if (!win) return;
    refreshLayout();
    focusWindow(id);
    // Compact windows already fill the work area. Preserve desktop state.
    if (isCompact.value) return;
    if (win.isMaximized) {
      win.isMaximized = false;
      win.rect = clampWindowRect(win.prevRect ?? win.rect, workArea.value, win.minW, win.minH);
      win.prevRect = undefined;
    } else {
      win.prevRect = { ...win.rect };
      win.rect = fillWorkArea(workArea.value);
      win.isMaximized = true;
    }
  }

  function refreshLayout() {
    if (disposed) return;
    const previous = workArea.value;
    const next = getWindowWorkArea(readWindowViewport());
    if (previous.x === next.x && previous.y === next.y && previous.w === next.w &&
        previous.h === next.h && previous.compact === next.compact) return;
    if (!previous.compact && next.compact) {
      desktopArea = { ...previous };
      windows.value.forEach(win => {
        if (!win.isMaximized) desktopRects.set(win.id, { ...win.rect });
      });
    }
    windows.value.forEach(win => {
      if (next.compact) { win.rect = fillWorkArea(next); return; }
      const originArea = previous.compact ? desktopArea : previous;
      if (win.prevRect) win.prevRect = repositionWindowRect(win.prevRect, originArea, next, win.minW, win.minH);
      if (win.isMaximized) win.rect = fillWorkArea(next);
      else if (previous.compact) {
        const saved = desktopRects.get(win.id);
        const meta = registeredApps.value[win.appId];
        win.rect = saved ? repositionWindowRect(saved, originArea, next, win.minW, win.minH)
          : clampWindowRect({
              x: next.x + (next.w - (meta?.defaultW ?? win.minW)) / 2,
              y: next.y + (next.h - (meta?.defaultH ?? win.minH)) / 2,
              w: meta?.defaultW ?? win.minW, h: meta?.defaultH ?? win.minH
            }, next, win.minW, win.minH);
      } else win.rect = repositionWindowRect(win.rect, previous, next, win.minW, win.minH);
    });
    if (!next.compact) { desktopRects.clear(); desktopArea = { ...next }; }
    workArea.value = next;
  }

  function scheduleLayout() {
    if (disposed || resizeFrame !== null) return;
    resizeFrame = window.requestAnimationFrame(() => { resizeFrame = null; refreshLayout(); });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    drafts.dispose();
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('resize', scheduleLayout);
      window.visualViewport?.removeEventListener('scroll', scheduleLayout);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
    }
    resizeFrame = null;
    desktopRects.clear();
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', scheduleLayout, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleLayout, { passive: true });
    window.visualViewport?.addEventListener('scroll', scheduleLayout, { passive: true });
  }
  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    windows, registeredApps, activeWindow, activeWindowId, activeAppName, workArea, isCompact,
    registerApp, registerApps, openApp, closeWindow, closeAllWindows, forceCloseWindow, forceCloseAllWindows, drafts, focusWindow, minimizeWindow,
    toggleMaximizeWindow, refreshLayout, dispose
  };
}

export type WindowManager = ReturnType<typeof createWindowManager>;
