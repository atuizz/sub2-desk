import { onBeforeUnmount, watch, type Ref } from 'vue';
import { useWindowManager } from './useWindowManager';

export function useDraftRegistration(root: Ref<HTMLElement | null>, dirty: () => boolean, busy: () => boolean) {
  const manager = useWindowManager();
  let release: (() => void) | undefined;
  watch(root, element => {
    release?.();
    release = undefined;
    const windowId = element?.closest<HTMLElement>('[data-window-id]')?.dataset.windowId;
    if (manager && windowId) release = manager.drafts.register({ windowId, dirty, busy });
  }, { flush: 'post' });
  onBeforeUnmount(() => release?.());
}
