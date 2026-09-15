<script setup lang="ts">
export interface SegmentOption {
  label: string;
  value: string;
}

const props = defineProps<{
  options: SegmentOption[];
  modelValue: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void;
}>();
</script>

<template>
  <div
    class="mac-segmented inline-flex p-0.5 rounded-[8px] select-none"
    role="group"
    aria-label="视图选项"
  >
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      :aria-pressed="modelValue === opt.value"
      class="px-3 py-1 text-[12px] font-medium rounded-[6px] transition-all duration-150 focus:outline-none"
      :class="[
        modelValue === opt.value
          ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold'
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
      ]"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>

<style scoped>
.mac-segmented { background:var(--control-bg); border:1px solid var(--control-border); max-width:100%; }
button { min-height:25px; white-space:nowrap; }
button[aria-pressed="true"] { box-shadow:0 1px 3px #00000014,0 0 0 .5px #00000005; }
</style>
