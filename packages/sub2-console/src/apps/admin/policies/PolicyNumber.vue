<script setup lang="ts">
withDefaults(defineProps<{ modelValue?: number | null; label: string; scale?: number; integer?: boolean }>(), { scale: 1 })
const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>()
</script>
<template>
  <label class="policy-number">{{ label }}
    <input type="number" min="0" :step="integer ? '1' : 'any'" :value="modelValue == null ? '' : modelValue * scale"
      placeholder="未设置" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value === '' ? null : Number(($event.target as HTMLInputElement).value) / scale)" />
  </label>
</template>
<style scoped>
.policy-number { display: grid; gap: 5px; min-width: 0; color: var(--text-secondary); }
input { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--content-bg); color: var(--text-primary); }
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
</style>
