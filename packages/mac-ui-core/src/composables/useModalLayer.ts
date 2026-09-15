import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';

interface ModalLayer {
  root: HTMLElement;
  panel: HTMLElement;
  owner: HTMLElement | null;
  active: Ref<boolean>;
  busy: () => boolean;
  dismiss: () => void;
  enter?: (event: KeyboardEvent) => void;
  initialFocus?: () => string;
  lastFocus: HTMLElement | null;
}

// One keyboard dispatcher for every Sheet/Alert, including multiple app windows.
const layers: ModalLayer[] = [];
let activeLayer: ModalLayer | undefined;
let sequence = 0;
const focusableSelector = [
  'button', 'a[href]', 'input:not([type="hidden"])', 'select', 'textarea',
  '[tabindex]', '[contenteditable="true"]',
].join(',');

function visible(element: HTMLElement) {
  if (!element.isConnected || !element.getClientRects().length) return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true' ||
        style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
}

function available(layer: ModalLayer) {
  return visible(layer.root) &&
    (!layer.owner || layer.owner.classList.contains('window-active'));
}

function topLayer() {
  const eligible = layers.filter(available).sort((a, b) => {
    const az = Number(getComputedStyle(a.owner ?? a.root).zIndex) || 0;
    const bz = Number(getComputedStyle(b.owner ?? b.root).zIndex) || 0;
    return az - bz ||
      (Number(getComputedStyle(a.root).zIndex) || 0) - (Number(getComputedStyle(b.root).zIndex) || 0) ||
      layers.indexOf(a) - layers.indexOf(b);
  });
  return eligible[eligible.length - 1];
}

function focusables(layer: ModalLayer) {
  return Array.from(layer.panel.querySelectorAll<HTMLElement>(focusableSelector))
    .filter(element => element.tabIndex >= 0 &&
      !element.matches(':disabled, [aria-disabled="true"]') && visible(element));
}

function focusLayer(layer: ModalLayer) {
  const preferred = layer.lastFocus && visible(layer.lastFocus) &&
    !layer.lastFocus.matches(':disabled') ? layer.lastFocus : null;
  const initial = layer.initialFocus
    ? Array.from(layer.panel.querySelectorAll<HTMLElement>(layer.initialFocus()))
      .find(element => visible(element) && !element.matches(':disabled')) : null;
  const target = preferred ?? initial ?? focusables(layer)[0] ?? layer.panel;
  target.focus({ preventScroll: true });
}

function refreshLayers() {
  const next = topLayer();
  layers.forEach(layer => { layer.active.value = layer === next; });
  if (activeLayer === next) return;
  activeLayer = next;
  if (next) focusLayer(next);
}

function belongsToWindow(layer: ModalLayer, target: EventTarget | null) {
  return target === document.body || target === document.documentElement ||
    (target instanceof Node && (layer.owner ?? layer.root).contains(target));
}

function consume(event: KeyboardEvent) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function handleKeydown(event: KeyboardEvent) {
  if (!['Tab', 'Escape', 'Enter'].includes(event.key) || event.isComposing ||
      event.keyCode === 229) return;
  const top = topLayer();
  const source = event.target instanceof Node && top?.panel.contains(event.target)
    ? top : layers.find(layer => event.target instanceof Node && layer.panel.contains(event.target));
  // A minimized/background window may still own document.activeElement.
  if (source && source !== top) {
    consume(event);
    if (top) focusLayer(top);
    return;
  }
  if (!top || !belongsToWindow(top, event.target)) return;

  if (event.key === 'Tab') {
    const items = focusables(top);
    const index = items.indexOf(document.activeElement as HTMLElement);
    consume(event);
    if (!items.length) top.panel.focus({ preventScroll: true });
    else {
      const next = index < 0 ? (event.shiftKey ? items.length - 1 : 0)
        : (index + (event.shiftKey ? -1 : 1) + items.length) % items.length;
      items[next].focus({ preventScroll: true });
    }
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (top.busy() || event.repeat) {
    consume(event);
    return;
  }
  if (event.key === 'Escape') {
    consume(event);
    top.dismiss();
    return;
  }
  // Never let a desktop-level Enter handler see an attached dialog's keystroke.
  event.stopPropagation();
  if (!top.panel.contains(document.activeElement)) {
    consume(event);
    focusLayer(top);
    return;
  }
  top.enter?.(event);
}

function handleFocus(event: FocusEvent) {
  const top = topLayer();
  if (!top || !(event.target instanceof HTMLElement)) return;
  if (top.panel.contains(event.target)) top.lastFocus = event.target;
  else if (belongsToWindow(top, event.target)) focusLayer(top);
}

export function useModalLayer(options: {
  show: () => boolean;
  loading?: () => boolean;
  dismiss: () => void;
  enter?: (event: KeyboardEvent) => void;
  initialFocus?: () => string;
}) {
  const root = ref<HTMLElement | null>(null);
  const panel = ref<HTMLElement | null>(null);
  const active = ref(false);
  const busy = ref(false);
  const id = `mac-modal-${++sequence}`;
  let layer: ModalLayer | undefined;
  let observer: MutationObserver | undefined;
  let restoreTarget: HTMLElement | null = null;

  function isBusy() {
    // Existing callers can keep their MacButton loading prop in the slot.
    return Boolean(options.loading?.() || panel.value?.querySelector(
      '[aria-busy="true"], [data-loading="true"], button:disabled .animate-spin',
    ));
  }

  function syncState() {
    busy.value = isBusy();
    refreshLayers();
  }

  function release() {
    observer?.disconnect();
    observer = undefined;
    if (!layer) return;
    const closing = layer;
    const shouldRestore = activeLayer === closing;
    const target = restoreTarget;
    layers.splice(layers.indexOf(closing), 1);
    layer = undefined;
    active.value = false;
    refreshLayers();
    if (!layers.length) {
      document.removeEventListener('keydown', handleKeydown, true);
      document.removeEventListener('focusin', handleFocus, true);
    }
    void nextTick(() => {
      if (!shouldRestore || (closing.owner &&
          (!visible(closing.owner) || !closing.owner.classList.contains('window-active')))) return;
      const top = topLayer();
      if (target && visible(target) && !target.matches(':disabled') &&
          (!top || top.panel.contains(target))) target.focus({ preventScroll: true });
      else if (top) focusLayer(top);
    });
  }

  watch([options.show, root, panel], ([show]) => {
    if (!show || !root.value || !panel.value) {
      release();
      return;
    }
    if (layer) return;
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    layer = {
      root: root.value, panel: panel.value,
      owner: root.value.closest<HTMLElement>('.window'),
      active, busy: isBusy, dismiss: options.dismiss, enter: options.enter,
      initialFocus: options.initialFocus, lastFocus: null,
    };
    if (!layers.length) {
      document.addEventListener('keydown', handleKeydown, true);
      document.addEventListener('focusin', handleFocus, true);
    }
    layers.push(layer);
    observer = new MutationObserver(syncState);
    // Watch only this layer's ancestry and controls, not the whole desktop.
    for (let node: HTMLElement | null = root.value; node; node = node.parentElement) {
      observer.observe(node, {
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden'],
      });
    }
    observer.observe(panel.value, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'aria-busy', 'data-loading'],
    });
    syncState();
  }, { flush: 'post', immediate: true });

  if (options.loading) watch(options.loading, syncState, { flush: 'post' });
  onBeforeUnmount(release);

  function canInteract() {
    return Boolean(layer && topLayer() === layer && !isBusy());
  }

  function guardInteraction(event: Event) {
    if (canInteract()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  return { root, panel, active, busy, id, canInteract, guardInteraction };
}
