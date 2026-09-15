<script setup lang="ts">
import { nextTick, ref } from 'vue';
import MacButton from './MacButton.vue';
import { useModalLayer } from '../composables/useModalLayer';
import { useDraftRegistration } from '../composables/useDraftRegistration';
const props = withDefaults(defineProps<{
  show: boolean; title: string; message?: string; confirmText?: string; cancelText?: string;
  danger?: boolean; loading?: boolean; confirmDisabled?: boolean; icon?: 'danger' | 'warning' | 'info';
}>(), { confirmText: '好', cancelText: '取消', danger: false, loading: false, icon: 'danger' });
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancel'): void }>();
const confirming = ref(false);
const { root, panel, active, busy, id, canInteract, guardInteraction } = useModalLayer({
  show: () => props.show, loading: () => props.loading || confirming.value, dismiss: () => emit('cancel'),
  initialFocus: () => props.danger ? '[data-alert-cancel]' : '[data-alert-confirm]',
  enter: (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('textarea, input, select, [contenteditable="true"]')) return;
    event.preventDefault();
    const button = target?.closest<HTMLButtonElement>('button');
    // Enter respects the focused choice, especially the safe default on deletion.
    if (button) button.click();
    else confirm();
  },
});
useDraftRegistration(root, () => false, () => props.show && Boolean(props.loading));
function cancel() { if (canInteract()) emit('cancel'); }
async function confirm() {
  if (!canInteract() || confirming.value || props.confirmDisabled) return;
  confirming.value = true;
  try {
    emit('confirm');
    // Close the synchronous double-click gap before the parent's loading update.
    await nextTick();
  } finally { confirming.value = false; }
}
</script>

<template>
  <Transition name="mac-alert">
    <div v-if="show" ref="root" class="mac-alert-overlay" data-mac-modal-layer
      @click.self="cancel" @click.capture="guardInteraction" @submit.capture="guardInteraction">
      <section ref="panel" class="mac-alert-panel" role="alertdialog" :aria-modal="active ? 'true' : undefined"
        :aria-labelledby="`${id}-title`" :aria-describedby="message ? `${id}-message` : undefined"
        :aria-busy="busy" tabindex="-1" @click.stop>
        <div class="mac-alert-content">
          <div class="mac-alert-icon" :class="danger ? 'is-danger' : icon === 'info' ? 'is-info' : 'is-warning'" aria-hidden="true">
            <svg v-if="danger || icon !== 'info'" width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.3 4.3a2 2 0 0 1 3.4 0l7.2 12.4a2 2 0 0 1-1.7 3H4.8a2 2 0 0 1-1.7-3L10.3 4.3ZM12 9v4m0 3h.01" />
            </svg>
            <svg v-else width="27" height="27" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65">
              <circle cx="12" cy="12" r="9" /><path stroke-linecap="round" d="M12 11v6m0-10h.01" />
            </svg>
          </div>
          <div class="mac-alert-copy">
            <h3 :id="`${id}-title`">{{ title }}</h3>
            <p v-if="message" :id="`${id}-message`">{{ message }}</p>
            <slot />
          </div>
        </div>
        <footer class="mac-alert-actions">
          <MacButton data-alert-cancel :disabled="busy" @click="cancel">{{ cancelText }}</MacButton>
          <MacButton data-alert-confirm :variant="danger ? 'destructive' : 'primary'"
            :disabled="confirmDisabled"
            :loading="loading || confirming" @click="confirm">{{ confirmText }}</MacButton>
        </footer>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.mac-alert-overlay {
  position: absolute; inset: 0; z-index: 70; display: flex; align-items: center; justify-content: center;
  min-width: 0; min-height: 0; padding: 20px clamp(8px, 3%, 24px) 16px;
  background: rgb(14 18 27 / 22%); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
}
.mac-alert-panel {
  display: flex; flex-direction: column; box-sizing: border-box; width: 100%; max-width: 410px; min-width: 0; min-height: 0;
  max-height: 100%; overflow: hidden; color: var(--text-primary, #242428);
  background: var(--window-bg-solid, #f5f5f7); border: 1px solid var(--border-color, rgb(0 0 0 / 12%));
  border-radius: 16px; outline: none;
  box-shadow: 0 24px 64px -20px rgb(0 0 0 / 42%), 0 4px 12px rgb(0 0 0 / 12%), inset 0 1px 0 rgb(255 255 255 / 65%);
}
.mac-alert-content { display: flex; align-items: flex-start; gap: 16px; min-height: 0; padding: 24px 24px 20px; overflow: auto; overscroll-behavior: contain; }
.mac-alert-icon {
  display: grid; place-items: center; flex: 0 0 48px; height: 48px; border: 1px solid rgb(128 128 140 / 9%); border-radius: 13px;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 28%), 0 2px 4px rgb(0 0 0 / 4%);
}
.is-danger { color: #e34641; background: rgb(255 59 48 / 9%); }
.is-warning { color: #c08b20; background: rgb(242 174 37 / 11%); }
.is-info { color: #087cef; background: rgb(0 122 255 / 10%); }
.mac-alert-copy { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mac-alert-copy h3 { margin: 2px 0 8px; font-size: 14px; font-weight: 650; line-height: 1.4; letter-spacing: -.02em; }
.mac-alert-copy p { margin: 0; color: var(--text-secondary, #62626b); font-size: 12px; line-height: 1.65; white-space: pre-line; }
.mac-alert-actions { display: flex; flex: 0 0 auto; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 0 24px 20px; }
.mac-alert-actions :deep(button) { min-width: 78px; }
.mac-alert-enter-active, .mac-alert-leave-active { transition: opacity 180ms ease; }
.mac-alert-enter-active .mac-alert-panel { transition: transform 220ms cubic-bezier(.2,.8,.2,1); }
.mac-alert-leave-active .mac-alert-panel { transition: transform 140ms ease; }
.mac-alert-enter-from, .mac-alert-leave-to { opacity: 0; }
.mac-alert-enter-from .mac-alert-panel { transform: translateY(-12px) scale(.97); }
.mac-alert-leave-to .mac-alert-panel { transform: translateY(-6px) scale(.98); }
@media (max-width: 600px) {
  .mac-alert-overlay { align-items: flex-end; padding: 12px 8px; }
  .mac-alert-content { padding: 20px 16px 16px; gap: 12px; }
  .mac-alert-actions { padding: 0 16px 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .mac-alert-enter-active, .mac-alert-leave-active,
  .mac-alert-enter-active .mac-alert-panel, .mac-alert-leave-active .mac-alert-panel { transition: none; }
}
</style>
