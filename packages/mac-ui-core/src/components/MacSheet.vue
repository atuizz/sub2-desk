<script setup lang="ts">
import { ref, watch } from 'vue';
import MacAlertSheet from './MacAlertSheet.vue';
import { useModalLayer } from '../composables/useModalLayer';
import { useDraftRegistration } from '../composables/useDraftRegistration';
defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<{ show: boolean; title: string; loading?: boolean; protectChanges?: boolean; dirty?: boolean; }>(), { loading: false, protectChanges: false, dirty: undefined });
const emit = defineEmits<{ (e: 'close'): void }>();
const touched = ref(false), discardPrompt = ref(false);
watch(() => props.show, () => { touched.value = false; discardPrompt.value = false; }, { flush: 'sync' });
function markChanged() { if (props.protectChanges && canInteract()) touched.value = true; }
const { root, panel, active, busy, id, canInteract, guardInteraction } = useModalLayer({
  show: () => props.show, loading: () => props.loading, dismiss: close,
  initialFocus: () => '[autofocus], input:not([type="hidden"]), textarea, select',
  enter: (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    // Preserve native form submission and multiline/editable controls.
    if (target?.closest('form, textarea, select, [contenteditable="true"], button, a[href]')) return;
    const primary = panel.value?.querySelector<HTMLButtonElement>(
      '.mac-sheet-footer button.mac-button--primary:not(:disabled)',
    );
    if (primary) {
      event.preventDefault();
      primary.click();
    }
  },
});
useDraftRegistration(root,
  () => props.show && Boolean(props.dirty ?? (props.protectChanges && touched.value)),
  () => props.show && Boolean(props.loading || busy.value));
function close() {
  if (!canInteract()) return;
  if (props.dirty ?? (props.protectChanges && touched.value)) discardPrompt.value = true;
  else emit('close');
}
function discard() {
  if (!props.show || props.loading || busy.value) return;
  discardPrompt.value = false;
  touched.value = false;
  emit('close');
}
</script>

<template>
  <Transition name="mac-sheet">
    <div v-if="show" ref="root" v-bind="$attrs" class="mac-sheet-overlay" data-mac-modal-layer
      @click.self="close" @click.capture="guardInteraction" @submit.capture="guardInteraction">
      <section ref="panel" class="mac-sheet-panel" role="dialog" :aria-modal="active ? 'true' : undefined"
        :aria-labelledby="`${id}-title`" :aria-busy="busy" tabindex="-1" @click.stop>
        <header class="mac-sheet-header">
          <h3 :id="`${id}-title`">{{ title }}</h3>
          <button type="button" class="mac-sheet-close" :disabled="busy" aria-label="关闭对话框" @click="close">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </button>
        </header>
        <div class="mac-sheet-body" @input="markChanged" @change="markChanged"><slot :close="close" /></div>
        <footer v-if="$slots.footer" class="mac-sheet-footer"><slot name="footer" :close="close" /></footer>
      </section>
    </div>
  </Transition>
  <MacAlertSheet :show="show && discardPrompt" title="放弃未保存的更改？"
    message="关闭后，本次填写的内容将丢失。" confirm-text="放弃更改" cancel-text="继续编辑"
    danger :loading="loading" @cancel="discardPrompt = false" @confirm="discard" />
</template>

<style scoped>
.mac-sheet-overlay {
  position: absolute; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center;
  min-width: 0; min-height: 0; padding: 12px clamp(8px, 3%, 24px) 16px;
  background: rgb(14 18 27 / 20%); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
}
.mac-sheet-panel {
  display: flex; flex-direction: column; box-sizing: border-box; width: 100%; max-width: 520px; min-width: 0; min-height: 0;
  max-height: 100%; overflow: hidden; color: var(--text-primary, #242428); font-size: 13px;
  background: var(--window-bg-solid, #f5f5f7); border: 1px solid var(--border-color, rgb(0 0 0 / 12%));
  border-radius: 14px; outline: none; transform-origin: 50% 0;
  box-shadow: 0 24px 64px -20px rgb(0 0 0 / 38%), 0 4px 12px rgb(0 0 0 / 12%), inset 0 1px 0 rgb(255 255 255 / 55%);
}
.mac-sheet-header {
  display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 16px;
  min-height: 52px; padding: 12px 18px; border-bottom: 1px solid var(--border-subtle, rgb(0 0 0 / 7%));
}
.mac-sheet-header h3 {
  margin: 0; min-width: 0; font-size: 13px; line-height: 1.4; font-weight: 650; letter-spacing: -.015em; overflow-wrap: anywhere;
}
.mac-sheet-close {
  display: grid; place-items: center; flex: 0 0 26px; height: 26px; border: 0; border-radius: 50%;
  color: var(--text-secondary, #66666e); background: rgb(128 128 140 / 12%); transition: background 120ms, color 120ms;
}
.mac-sheet-close:hover:not(:disabled) { background: rgb(128 128 140 / 23%); color: var(--text-primary); }
.mac-sheet-close:focus-visible { outline: 3px solid rgb(0 122 255 / 45%); outline-offset: 2px; }
.mac-sheet-close:disabled { cursor: wait; opacity: .45; }
.mac-sheet-body {
  flex: 1 1 auto; min-height: 0; min-width: 0; padding: 20px; overflow: auto;
  overscroll-behavior: contain; scrollbar-gutter: stable; overflow-wrap: anywhere;
}
/* Legacy slots already own their padding. Keep one spacing layer. */
.mac-sheet-body:has(> .p-5:only-child), .mac-sheet-body:has(> .p-6:only-child) { padding: 0; }
.mac-sheet-body :deep(> .p-5:only-child), .mac-sheet-body :deep(> .p-6:only-child) { max-height: none; overflow: visible; }
.mac-sheet-footer {
  display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--border-subtle, rgb(0 0 0 / 7%)); background: rgb(128 128 140 / 4%);
}
.mac-sheet-enter-active, .mac-sheet-leave-active { transition: opacity 180ms ease; }
.mac-sheet-enter-active .mac-sheet-panel { transition: transform 240ms cubic-bezier(.2,.8,.2,1), opacity 180ms ease; }
.mac-sheet-leave-active .mac-sheet-panel { transition: transform 140ms ease, opacity 140ms ease; }
.mac-sheet-enter-from, .mac-sheet-leave-to { opacity: 0; }
.mac-sheet-enter-from .mac-sheet-panel { transform: translateY(-16px) scale(.98); opacity: 0; }
.mac-sheet-leave-to .mac-sheet-panel { transform: translateY(-8px) scale(.99); opacity: 0; }
@media (max-width: 600px) {
  .mac-sheet-overlay { padding: 8px; }
  .mac-sheet-header, .mac-sheet-footer { padding: 12px 14px; }
  .mac-sheet-body { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .mac-sheet-enter-active, .mac-sheet-leave-active,
  .mac-sheet-enter-active .mac-sheet-panel, .mac-sheet-leave-active .mac-sheet-panel { transition: none; }
}
</style>
