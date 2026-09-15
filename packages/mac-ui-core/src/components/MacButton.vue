<script setup lang="ts">
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'default' | 'glass' | 'destructive'; size?: 'sm' | 'md' | 'lg';
  disabled?: boolean; loading?: boolean;
}>(), { variant: 'default', size: 'md', disabled: false, loading: false });
const emit = defineEmits<{ (e: 'click', evt: MouseEvent): void }>();
function onClick(event: MouseEvent) {
  if (props.disabled || props.loading) { event.preventDefault(); return; }
  emit('click', event);
}
</script>

<template>
  <button type="button" class="mac-button"
    :class="[`mac-button--${size}`, `mac-button--${variant}`, { 'is-loading': loading }]"
    :disabled="disabled || loading" :aria-disabled="disabled || loading" :aria-busy="loading" @click="onClick">
    <svg v-if="loading" class="mac-button-spinner" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="2" opacity=".25" />
      <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
    <slot />
  </button>
</template>

<style scoped>
.mac-button {
  display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; gap: 6px; min-width: 0;
  box-sizing: border-box; border: 1px solid var(--border-subtle, rgb(0 0 0 / 12%));
  color: var(--text-primary, #26262b); background: var(--window-bg-solid, #fff);
  box-shadow: 0 1px 2px rgb(0 0 0 / 7%), inset 0 1px 0 rgb(255 255 255 / 40%);
  font-family: inherit; font-weight: 500; line-height: 1; white-space: nowrap; user-select: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent; transition: background 120ms ease, box-shadow 120ms ease, filter 120ms ease, opacity 120ms ease;
}
.mac-button--sm { height: 24px; padding: 0 9px; font-size: 11px; border-radius: 6px; }
.mac-button--md { height: 28px; padding: 0 12px; font-size: 12px; border-radius: 7px; }
.mac-button--lg { height: 34px; padding: 0 16px; font-size: 13px; border-radius: 8px; }
.mac-button--primary, .mac-button--destructive {
  color: white; border-color: rgb(0 0 0 / 9%); font-weight: 600;
  box-shadow: 0 1px 2px rgb(0 0 0 / 12%), inset 0 1px 0 rgb(255 255 255 / 20%);
}
.mac-button--primary { background: var(--accent, #007aff); background-image: linear-gradient(rgb(255 255 255 / 10%), transparent); }
.mac-button--destructive { background: linear-gradient(#f15b53, #e33e36); }
.mac-button--glass { background: rgb(255 255 255 / 35%); border-color: rgb(255 255 255 / 35%); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.mac-button:hover:not(:disabled) { filter: brightness(.97); }
.mac-button:active:not(:disabled) { filter: brightness(.92); box-shadow: inset 0 1px 2px rgb(0 0 0 / 12%); }
.mac-button:focus { outline: none; }
.mac-button:focus-visible { outline: 3px solid rgb(0 122 255 / 45%); outline-offset: 2px; }
.mac-button:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
.mac-button.is-loading { cursor: wait; opacity: .75; }
.mac-button-spinner { width: 13px; height: 13px; flex-shrink: 0; animation: mac-button-spin 700ms linear infinite; }
.dark .mac-button--default { background: #3a3a3f; border-color: rgb(255 255 255 / 9%); box-shadow: 0 1px 2px rgb(0 0 0 / 20%), inset 0 1px 0 rgb(255 255 255 / 6%); }
.dark .mac-button--glass { background: rgb(255 255 255 / 9%); border-color: rgb(255 255 255 / 12%); }
.dark .mac-button:hover:not(:disabled) { filter: brightness(1.1); }
@keyframes mac-button-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .mac-button { transition: none; } .mac-button-spinner { animation-duration: 1500ms; } }
@media (pointer: coarse) { .mac-button { min-height: 36px; } }
</style>
