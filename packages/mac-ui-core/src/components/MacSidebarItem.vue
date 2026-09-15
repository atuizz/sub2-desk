<script setup lang="ts">
defineProps<{
  active?: boolean;
  title: string;
  badge?: string | number;
}>();

const emit = defineEmits<{
  (e: 'click'): void;
}>();
</script>

<template>
  <button
    type="button"
    :aria-current="active ? 'page' : undefined"
    class="mac-sidebar-item w-full h-8 px-2 rounded-[8px] text-[13px] flex items-center gap-2 cursor-pointer transition-colors select-none group text-left"
    :class="active ? 'is-active font-medium' : 'text-[var(--text-primary)] hover:bg-black/5 dark:hover:bg-white/5'"
    @click="emit('click')"
  >
    <!-- Left Icon / Badge slot: Standardized 24px column for absolute text alignment -->
    <div class="w-6 h-6 shrink-0 flex items-center justify-center">
      <slot name="icon" />
    </div>

    <!-- Label -->
    <span class="flex-1 truncate tracking-tight">{{ title }}</span>

    <!-- Optional Right Badge or Chevron -->
    <div v-if="badge !== undefined || $slots.right" class="shrink-0 flex items-center">
      <slot name="right">
        <span
          v-if="badge !== undefined"
          class="text-[11px] px-1.5 py-0.2 rounded-full font-medium"
          :class="active ? 'bg-white/20 text-white' : 'bg-black/5 dark:bg-white/10 text-[var(--text-secondary)]'"
        >
          {{ badge }}
        </span>
      </slot>
    </div>
  </button>
</template>

<style scoped>
.mac-sidebar-item.is-active { background:var(--sidebar-selection); color:var(--text-primary); }
.mac-sidebar-item.is-active::before { content:''; position:absolute; }
</style>
