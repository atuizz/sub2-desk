import { computed, shallowRef, watch } from 'vue';

export interface WindowDraft {
  windowId: string;
  dirty: () => boolean;
  busy: () => boolean;
}

/** Per desktop, UI-only guards. Visibility is deliberately not part of draft lifetime. */
export function createDraftRegistry(focusWindow: (id: string) => void) {
  const entries = shallowRef<WindowDraft[]>([]);
  const prompt = shallowRef<{ windowId: string; action: string; scope?: string } | null>(null);
  let pending: { perform: () => void; resolve: (allowed: boolean) => void } | undefined;
  let disposed = false;
  const protectedEntries = computed(() => entries.value.filter(entry => entry.dirty() || entry.busy()));
  const selected = computed(() => protectedEntries.value.filter(entry =>
    !prompt.value?.scope || entry.windowId === prompt.value.scope));
  const busy = computed(() => selected.value.some(entry => entry.busy()));

  function cancel() {
    const request = pending;
    pending = undefined;
    prompt.value = null;
    request?.resolve(false);
  }

  function register(entry: WindowDraft) {
    if (disposed) return () => {};
    entries.value = [...entries.value, entry];
    return () => {
      // Unmount/replacement must never approve a stale destructive request.
      if (prompt.value && (!prompt.value.scope || prompt.value.scope === entry.windowId)) cancel();
      entries.value = entries.value.filter(item => item !== entry);
    };
  }

  function run(action: string, perform: () => void, scope?: string): boolean | Promise<boolean> {
    if (disposed || pending) return false;
    const affected = protectedEntries.value.filter(entry => !scope || entry.windowId === scope);
    if (!affected.length) { perform(); return true; }
    const windowId = affected.find(entry => entry.busy())?.windowId ?? affected[0].windowId;
    const result = new Promise<boolean>(resolve => { pending = { perform, resolve }; });
    prompt.value = { windowId, action, scope };
    focusWindow(windowId);
    return result;
  }

  function confirm() {
    // Re-read all live getters at the actual decision, including newly busy siblings.
    if (!pending || busy.value || disposed) return;
    const request = pending;
    pending = undefined;
    prompt.value = null;
    try { request.perform(); request.resolve(true); }
    catch (error) { request.resolve(false); throw error; }
  }

  function forget(windowId?: string) {
    if (!windowId || prompt.value?.windowId === windowId || !prompt.value?.scope) cancel();
    entries.value = windowId ? entries.value.filter(entry => entry.windowId !== windowId) : [];
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!protectedEntries.value.length) return;
    event.preventDefault();
    event.returnValue = '';
  }
  // Only retain the native listener while needed (also avoids needless bfcache exclusion).
  const stop = watch(() => protectedEntries.value.length > 0, needed => {
    if (typeof window === 'undefined') return;
    window.removeEventListener('beforeunload', beforeUnload);
    if (needed) window.addEventListener('beforeunload', beforeUnload);
  }, { flush: 'sync' });

  function dispose() {
    disposed = true;
    cancel();
    entries.value = [];
    stop();
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', beforeUnload);
  }
  return { register, run, prompt, busy, confirm, cancel, forget, dispose };
}
