<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { WindowInstance, WindowRect } from '../types';
import { useWindowManager } from '../composables/useWindowManager';
import { clampWindowRect, getWindowWorkArea, readWindowViewport, resizeWindowRect, type ResizeDirection } from '../composables/windowGeometry';
import MacTrafficLights from './MacTrafficLights.vue';
import MacAlertSheet from './MacAlertSheet.vue';

const props = defineProps<{ win: WindowInstance }>();
const emit = defineEmits<{
  (e: 'focus'): void;
  (e: 'close'): void;
  (e: 'minimize'): void;
  (e: 'maximize'): void;
}>();
const manager = useWindowManager();
const standaloneArea = ref(getWindowWorkArea(readWindowViewport()));
const workArea = computed(() => manager?.workArea.value ?? standaloneArea.value);
const isCompact = computed(() => workArea.value.compact);
const isVisible = computed(() => !props.win.isMinimized && (!isCompact.value || props.win.isFocused));
const interaction = ref<'drag' | 'resize' | null>(null);
const resizeDirections: ResizeDirection[] = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'];
const interactiveSelector = 'button, a, input, textarea, select, [role="button"], [contenteditable="true"], [data-no-drag]';
let pointerId: number | null = null;
let captureTarget: HTMLElement | null = null;
let startX = 0;
let startY = 0;
let initialRect: WindowRect = { x: 0, y: 0, w: 0, h: 0 };
let resizeDirection: ResizeDirection = 'se';

function focusWindow() { if (!props.win.isFocused) emit('focus'); }
function isInteractiveTarget(event: Event): boolean {
  return event.target instanceof Element && Boolean(event.target.closest(interactiveSelector));
}

function beginInteraction(event: PointerEvent, kind: 'drag' | 'resize', direction?: ResizeDirection) {
  if (event.button !== 0 || !event.isPrimary || props.win.isMaximized || isCompact.value) return;
  if (kind === 'drag' && isInteractiveTarget(event)) return;
  event.preventDefault();
  event.stopPropagation();
  stopInteraction();
  focusWindow();
  pointerId = event.pointerId;
  captureTarget = event.currentTarget as HTMLElement;
  startX = event.clientX;
  startY = event.clientY;
  initialRect = clampWindowRect(props.win.rect, workArea.value, props.win.minW, props.win.minH);
  if (direction) resizeDirection = direction;
  interaction.value = kind;
  // Capture keeps touch/pen/mouse on the original handle, including over iframes.
  try { captureTarget.setPointerCapture(pointerId); } catch { /* Window listeners remain the fallback. */ }
  captureTarget.addEventListener('lostpointercapture', stopInteraction);
  window.addEventListener('pointermove', movePointer, { passive: false });
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  window.addEventListener('blur', stopInteraction);
  window.addEventListener('keydown', handleInteractionKey);
}

function movePointer(event: PointerEvent) {
  if (event.pointerId !== pointerId || !interaction.value) return;
  if (event.cancelable) event.preventDefault();
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  props.win.rect = interaction.value === 'drag'
    ? clampWindowRect({ ...initialRect, x: initialRect.x + dx, y: initialRect.y + dy }, workArea.value, props.win.minW, props.win.minH)
    : resizeWindowRect(initialRect, resizeDirection, dx, dy, workArea.value, props.win.minW, props.win.minH);
}

function endPointer(event: PointerEvent) {
  if (event.pointerId !== pointerId) return;
  if (event.type === 'pointerup') movePointer(event);
  stopInteraction();
}

function handleInteractionKey(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  props.win.rect = clampWindowRect(initialRect, workArea.value, props.win.minW, props.win.minH);
  event.preventDefault();
  event.stopPropagation();
  stopInteraction();
}

function stopInteraction() {
  const target = captureTarget;
  const id = pointerId;
  captureTarget = null;
  pointerId = null;
  interaction.value = null;
  target?.removeEventListener('lostpointercapture', stopInteraction);
  if (id !== null && target?.hasPointerCapture(id)) target.releasePointerCapture(id);
  window.removeEventListener('pointermove', movePointer);
  window.removeEventListener('pointerup', endPointer);
  window.removeEventListener('pointercancel', endPointer);
  window.removeEventListener('blur', stopInteraction);
  window.removeEventListener('keydown', handleInteractionKey);
}

function maximizeFromTitlebar(event: MouseEvent) {
  if (isInteractiveTarget(event) || isCompact.value) return;
  stopInteraction();
  emit('maximize');
}

function handleViewportChange() {
  stopInteraction();
  if (!manager) standaloneArea.value = getWindowWorkArea(readWindowViewport());
}

watch(() => [props.win.isMinimized, props.win.isMaximized, props.win.isFocused, isCompact.value], () => {
  // Gaining focus on pointerdown must not cancel the interaction just started.
  if (props.win.isMinimized || props.win.isMaximized || !props.win.isFocused || isCompact.value) stopInteraction();
});
onMounted(() => {
  window.addEventListener('resize', handleViewportChange, { passive: true });
  window.visualViewport?.addEventListener('resize', handleViewportChange, { passive: true });
  window.visualViewport?.addEventListener('scroll', handleViewportChange, { passive: true });
});
onUnmounted(() => {
  stopInteraction();
  window.removeEventListener('resize', handleViewportChange);
  window.visualViewport?.removeEventListener('resize', handleViewportChange);
  window.visualViewport?.removeEventListener('scroll', handleViewportChange);
});
</script>

<template>
  <section
    v-show="isVisible"
    class="window mac-window window-opening"
    :class="{
      'window-active': win.isFocused, 'window-inactive': !win.isFocused,
      'window-compact': isCompact, 'window-maximized': win.isMaximized,
      'window-interacting': interaction !== null
    }"
    :style="{
      left: `${isCompact ? workArea.x : win.rect.x}px`, top: `${isCompact ? workArea.y : win.rect.y}px`,
      width: `${isCompact ? workArea.w : win.rect.w}px`, height: `${isCompact ? workArea.h : win.rect.h}px`,
      zIndex: win.zIndex
    }"
    role="region"
    :aria-label="win.title"
    :data-window-id="win.id"
    :data-window-focused="win.isFocused"
    :data-window-state="isCompact ? 'compact' : win.isMaximized ? 'maximized' : 'normal'"
    @pointerdown.capture="focusWindow"
    @focusin="focusWindow"
  >
    <header class="mac-window-titlebar" @pointerdown="beginInteraction($event, 'drag')" @dblclick="maximizeFromTitlebar">
      <MacTrafficLights
        :is-focused="win.isFocused" :is-maximized="win.isMaximized || isCompact"
        @close="emit('close')" @minimize="emit('minimize')" @maximize="emit('maximize')"
      />
      <div class="mac-window-title">
        <img v-if="win.icon" :src="win.icon" alt="" draggable="false" />
        <span>{{ win.title }}</span>
      </div>
      <div class="mac-window-titlebar-spacer" aria-hidden="true"></div>
    </header>
    <div class="mac-window-body"><slot /></div>
    <MacAlertSheet v-if="manager" :show="manager.drafts.prompt.value?.windowId === win.id"
      class="mac-window-draft-prompt"
      :title="manager.drafts.busy.value ? '正在提交，请稍候' : '放弃未保存的更改？'"
      :message="manager.drafts.busy.value ? '操作完成前不能关闭。你可以返回并等待结果。' : `${manager.drafts.prompt.value?.action}后，未保存的内容将丢失。`"
      :danger="!manager.drafts.busy.value" :confirm-disabled="manager.drafts.busy.value"
      :confirm-text="`放弃更改并${manager.drafts.prompt.value?.action ?? '关闭'}`" cancel-text="继续编辑"
      @confirm="manager.drafts.confirm" @cancel="manager.drafts.cancel" />
    <template v-if="!win.isMaximized && !isCompact">
      <div
        v-for="direction in resizeDirections" :key="direction"
        class="mac-window-resize" :class="`resize-${direction}`"
        :data-resize-direction="direction" aria-hidden="true"
        @pointerdown="beginInteraction($event, 'resize', direction)"
      ></div>
    </template>
  </section>
</template>

<style scoped>
.mac-window-draft-prompt { z-index: 1000; }
.mac-window {
  container-type: inline-size; container-name: app-window;
  position: absolute; display: flex; flex-direction: column; box-sizing: border-box;
  min-width: 0; min-height: 0; overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.5); border-radius: 24px;
  background: var(--window-bg, #f6f6f8);
  backdrop-filter: var(--vibrancy-window, blur(24px) saturate(125%));
  -webkit-backdrop-filter: var(--vibrancy-window, blur(24px) saturate(125%));
  box-shadow: var(--shadow-window);
  /* Never interpolate geometry during drag/resize. */
  transition: box-shadow 180ms ease, border-color 180ms ease;
}
.window-inactive {
  border-color: rgba(255, 255, 255, 0.38);
  box-shadow: 0 12px 36px -14px rgba(15, 23, 42, 0.2), 0 2px 8px rgba(15, 23, 42, 0.06), 0 0 0 0.5px rgba(30, 41, 59, 0.1);
}
.window-maximized, .window-compact { border-radius: 14px; }
.mac-window-titlebar {
  position: relative; display: flex; align-items: center; justify-content: space-between;
  flex: 0 0 44px; min-width: 0; padding: 0 13px;
  border-bottom: 1px solid var(--border-subtle, rgba(30, 41, 59, 0.08));
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.66), rgba(255, 255, 255, 0.28));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
  cursor: default; user-select: none; touch-action: none;
}
.mac-window-title {
  position: absolute; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; justify-content: center; gap: 6px;
  max-width: calc(100% - 180px); color: var(--text-primary, #1d1d1f);
  font-size: 13px; font-weight: 600; line-height: 18px; letter-spacing: -0.01em;
  pointer-events: none; transition: color 180ms ease;
}
.mac-window-title span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mac-window-title img { flex: 0 0 16px; width: 16px; height: 16px; object-fit: contain; }
.mac-window-titlebar-spacer { width: 64px; }
.window-inactive .mac-window-title { color: var(--text-tertiary, #86868b); }
.window-inactive .mac-window-titlebar { background: rgba(245, 245, 247, 0.36); }
.window-inactive .mac-window-title img { opacity: 0.6; }
.mac-window-body {
  position: relative; display: flex; flex: 1 1 0%; flex-direction: column;
  min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain;
}
.window-interacting { transition: none; user-select: none; }
.window-interacting .mac-window-body { pointer-events: none; }
.mac-window-resize { position: absolute; z-index: 5; touch-action: none; user-select: none; }
.resize-n, .resize-s { left: 14px; right: 14px; height: 5px; }
.resize-n { top: 0; cursor: n-resize; }
.resize-s { bottom: 0; cursor: s-resize; }
.resize-w, .resize-e { top: 14px; bottom: 14px; width: 5px; }
.resize-w { left: 0; cursor: w-resize; }
.resize-e { right: 0; cursor: e-resize; }
.resize-nw, .resize-ne, .resize-sw, .resize-se { width: 12px; height: 12px; }
.resize-nw { top: 0; left: 0; cursor: nw-resize; }
.resize-ne { top: 0; right: 0; cursor: ne-resize; }
.resize-sw { bottom: 0; left: 0; cursor: sw-resize; }
.resize-se { bottom: 0; right: 0; cursor: se-resize; }
.mac-window-titlebar :deep(button:focus-visible) { outline: 2px solid var(--accent-color, #007aff); outline-offset: 4px; }
.dark .mac-window {
  border-color: rgba(255, 255, 255, 0.14);
  box-shadow: 0 28px 72px -18px rgba(0, 0, 0, 0.65), 0 8px 24px -8px rgba(0, 0, 0, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.1);
}
.dark .window-inactive {
  border-color: rgba(255, 255, 255, 0.09); box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.42);
}
.dark .mac-window-titlebar {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.065), rgba(255, 255, 255, 0.015));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07);
}
.dark .window-inactive .mac-window-titlebar { background: rgba(0, 0, 0, 0.08); }
@keyframes winOpen {
  from { opacity: 0; transform: translateY(5px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.window-opening { animation: winOpen 180ms cubic-bezier(0.2, 0.75, 0.25, 1); }
.window-interacting { animation: none; }
@media (max-width: 640px) {
  .mac-window-titlebar { flex-basis: 44px; padding: 0 10px; }
  .mac-window-title { max-width: calc(100% - 164px); }
  .mac-window-titlebar :deep(.traffic-light) { position: relative; width: 16px; height: 16px; }
  .mac-window-titlebar :deep(.traffic-light)::after { content: ''; position: absolute; inset: -4px; border-radius: 50%; }
  .window-compact.window-inactive { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .mac-window, .window-opening, .mac-window-title { animation: none; transition: none; }
  .mac-window-titlebar :deep(.traffic-light) { transition: none; }
}
</style>
