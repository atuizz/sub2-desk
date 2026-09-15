<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
}>();
</script>

<template>
  <div class="space-y-1.5">
    <div v-if="title || description" class="px-0.5">
      <div v-if="title" class="text-[13px] font-semibold tracking-tight text-[var(--text-primary)]">
        {{ title }}
      </div>
      <div v-if="description" class="text-[11px] text-[var(--text-tertiary)]">
        {{ description }}
      </div>
    </div>

    <div
      class="rounded-[10px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[0_1px_2px_rgba(0,0,0,0.03)] divide-y divide-[var(--border-subtle)] overflow-hidden"
    >
      <slot />
    </div>
  </div>
</template>
