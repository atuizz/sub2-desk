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
    class="w-10 h-6 flex items-center rounded-full p-0.5 transition-colors duration-200 focus:outline-none"
    :class="[
      modelValue ? 'bg-[#34c759]' : 'bg-[#e5e5ea] dark:bg-[#39393d]',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
    ]"
    @click="toggle"
  >
    <div
      class="bg-white w-5 h-5 rounded-full shadow-md transform transition-transform duration-200"
      :class="{ 'translate-x-4': modelValue }"
    ></div>
  </button>
</template>
