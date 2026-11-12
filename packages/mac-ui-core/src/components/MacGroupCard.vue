<script setup lang="ts">
defineProps<{
  title?: string;
  description?: string;
}>();
</script>

<template>
  <div class="mac-group-card space-y-2.5">
    <div v-if="title || description" class="px-0.5">
      <div v-if="title" class="text-[14px] font-semibold tracking-tight text-[var(--text-primary)]">
        {{ title }}
      </div>
      <div v-if="description" class="text-[12px] text-[var(--text-secondary)] mt-1">
        {{ description }}
      </div>
    </div>

    <div
      class="mac-group-card-body rounded-[12px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-[0_2px_4px_rgba(25,45,75,0.035)] divide-y divide-[var(--border-subtle)] overflow-hidden"
    >
      <slot />
    </div>
  </div>
</template>
