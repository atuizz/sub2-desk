<script setup lang="ts">
const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

function toggle(event: MouseEvent) {
  if (props.disabled) return;
  emit('update:modelValue', !props.modelValue);
  // Bubble the same edit signal as native inputs to an enclosing protected Sheet.
  event.currentTarget?.dispatchEvent(new Event('change', { bubbles: true }));
}
</script>

<template>
  <button
    type="button"
    role="switch" :aria-checked="modelValue" :disabled="disabled"
    class="mac-toggle"
    @click="toggle"
  >
    <span class="mac-toggle-thumb" aria-hidden="true"></span>
  </button>
</template>

<style scoped>
/* Own the geometry: table and form button rules must not flatten this control. */
.mac-toggle.mac-toggle {
  position:relative; display:inline-flex; align-items:center; flex:0 0 auto;
  width:34px; height:20px; min-height:20px; padding:2px; border:0; border-radius:999px;
  vertical-align:middle; background:var(--toggle-off,#b9c0cb);
  box-shadow:inset 0 1px 2px #111c2d1a; cursor:pointer;
  transition:background 160ms ease,box-shadow 160ms ease;
}
.mac-toggle[aria-checked=true] { background:var(--accent,#2468df); box-shadow:inset 0 1px 2px #12396c26; }
.mac-toggle-thumb { width:16px; height:16px; flex:none; border-radius:50%; background:linear-gradient(#fff,#f5f7fb); box-shadow:0 1px 2px #102b4a40,0 0 0 .5px #00000008; transform:translateX(0); transition:transform 160ms cubic-bezier(.2,.8,.2,1); }
.mac-toggle[aria-checked=true] .mac-toggle-thumb { transform:translateX(14px); }
.mac-toggle:focus-visible { outline:3px solid color-mix(in srgb,var(--accent,#2468df) 30%,transparent);outline-offset:3px; }
.mac-toggle:disabled { opacity:.45;cursor:not-allowed; }
@media(pointer:coarse) { .mac-toggle::before { content:'';position:absolute;inset:-10px -5px; } }
@media(prefers-reduced-motion:reduce) { .mac-toggle,.mac-toggle-thumb { transition:none; } }
</style>
