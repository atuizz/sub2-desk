<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  src: string;
  /** Use an empty alt when the parent already displays or labels the app name. */
  alt?: string;
  size?: number;
  appearance?: 'default' | 'dark' | 'transparent' | 'tinted';
  /** Opt in for standalone previews; icons inside buttons inherit parent hover. */
  interactive?: boolean;
}>(), { alt: '', size: 48, appearance: 'default', interactive: false });

const emit = defineEmits<{ (event: 'load', value: Event): void; (event: 'error', value: Event): void }>();
const failed = ref(false);
const dimension = computed(() => `${Number.isFinite(props.size) ? Math.max(12, props.size) : 48}px`);
watch(() => props.src, () => { failed.value = false; });
function onLoad(event: Event) { failed.value = false; emit('load', event); }
function onError(event: Event) { failed.value = true; emit('error', event); }
</script>

<template>
  <span
    class="mac-app-icon"
    :class="[`mac-app-icon--${appearance}`, { 'is-interactive': interactive, 'has-error': failed }]"
    :style="{ width: dimension, height: dimension }"
    :role="failed && alt ? 'img' : undefined"
    :aria-label="failed && alt ? `${alt}，图标未加载` : undefined"
    :aria-hidden="!alt ? 'true' : undefined"
  >
    <img
      :src="src"
      :alt="failed ? '' : alt"
      width="256"
      height="256"
      draggable="false"
      decoding="async"
      @load="onLoad"
      @error="onError"
    />
    <span v-if="failed" class="mac-app-icon-fallback" aria-hidden="true">{{ alt.slice(0, 2) }}</span>
  </span>
</template>

<style scoped>
.mac-app-icon {
  position: relative;
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  isolation: isolate;
  vertical-align: middle;
  line-height: 0;
  user-select: none;
  -webkit-user-select: none;
}
.mac-app-icon::before {
  content: '';
  position: absolute;
  inset: 9%;
  z-index: -1;
  border-radius: 24%;
  pointer-events: none;
}
.mac-app-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 1;
  /* The asset retains its original colour, highlight and alpha shadow. */
  filter: none;
  transform-origin: center;
  transition: transform 160ms cubic-bezier(.2,.8,.2,1);
  pointer-events: none;
  -webkit-user-drag: none;
}
.mac-app-icon--dark::before {
  background: #25262a;
  box-shadow: 0 0 0 .6px rgb(255 255 255 / 20%), 0 2px 5px rgb(0 0 0 / 18%);
}
.mac-app-icon--transparent::before { background: transparent; }
.mac-app-icon--transparent img { filter: drop-shadow(0 1px 1px rgb(0 0 0 / 16%)); }
.mac-app-icon--tinted::before {
  background: rgb(0 122 255 / 16%);
  background: color-mix(in srgb, var(--mac-icon-tint, var(--accent, #007aff)) 18%, transparent);
  box-shadow: 0 0 0 .75px rgb(0 122 255 / 22%), 0 2px 5px rgb(0 0 0 / 8%);
}
@media (hover: hover) and (pointer: fine) {
  .mac-app-icon.is-interactive:hover img,
  :global(button:not(:disabled):not([aria-disabled="true"]):hover .mac-app-icon img),
  :global(a:hover .mac-app-icon img) { transform: translateY(-1px) scale(1.035); }
}
:global(button:focus-visible .mac-app-icon img),
:global(a:focus-visible .mac-app-icon img) { transform: scale(1.035); }
.mac-app-icon.has-error img { visibility: hidden; }
.mac-app-icon-fallback {
  position: absolute;
  inset: 9%;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-color, rgb(128 128 140 / 18%));
  border-radius: 24%;
  color: var(--text-secondary, #66666e);
  background: var(--window-bg-solid, #eeeef0);
  font: 500 10px/1.2 system-ui, sans-serif;
}
@media (prefers-reduced-motion: reduce) {
  .mac-app-icon img { transition: none; transform: none !important; }
}
@media (forced-colors: active) {
  .mac-app-icon::before { outline: 1px solid CanvasText; }
}
</style>
