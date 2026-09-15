<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    modelValue?: string;
    placeholder?: string;
  }>(),
  {
    modelValue: '',
    placeholder: '搜索'
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
  (e: 'clear'): void;
}>();

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  emit('update:modelValue', target.value);
}

function clear() {
  emit('update:modelValue', '');
  emit('clear');
}
</script>

<template>
  <div
    class="mac-search-field"
  >
    <!-- Magnifying glass icon -->
    <svg class="w-3.5 h-3.5 text-[var(--text-tertiary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>

    <input
      :value="modelValue"
      type="search"
      :aria-label="placeholder"
      :placeholder="placeholder"
      class="flex-1 min-w-0 bg-transparent outline-none text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] leading-tight"
      @input="onInput"
    />

    <!-- Clear button -->
    <button
      v-if="modelValue"
      type="button"
      aria-label="清除搜索"
      class="w-3.5 h-3.5 rounded-full bg-black/20 dark:bg-white/20 hover:bg-black/30 dark:hover:bg-white/30 flex items-center justify-center shrink-0 transition-colors"
      @click="clear"
    >
      <svg class="w-2 h-2 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.mac-search-field { height:30px; min-width:0; padding:0 9px; border-radius:8px; background:var(--control-bg); border:1px solid var(--control-border); display:flex; align-items:center; gap:7px; transition:border-color 120ms ease,box-shadow 120ms ease; }
.mac-search-field:focus-within { border-color:var(--accent); box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent); background:var(--bg-surface); }
input::-webkit-search-cancel-button { display:none; }
</style>
