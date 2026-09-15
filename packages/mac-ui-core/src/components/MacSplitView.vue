<script setup lang="ts">
withDefaults(
  defineProps<{
    sidebarWidth?: number;
    minSidebarWidth?: number;
  }>(),
  {
    sidebarWidth: 210,
    minSidebarWidth: 160
  }
);
</script>

<template>
  <div class="mac-split-view flex h-full w-full overflow-hidden">
    <!-- Sidebar -->
    <aside
      class="h-full flex-shrink-0 border-r border-[var(--border-color)] overflow-y-auto select-none p-2 flex flex-col"
      :style="{
        width: `${sidebarWidth}px`,
        background: 'var(--sidebar-bg)',
        backdropFilter: 'var(--vibrancy-sidebar)',
        WebkitBackdropFilter: 'var(--vibrancy-sidebar)'
      }"
    >
      <slot name="sidebar" />
    </aside>

    <!-- Main Content Area -->
    <main class="flex-1 min-w-0 h-full overflow-y-auto flex flex-col bg-[var(--content-bg)]">
      <slot />
    </main>
  </div>
</template>

<style scoped>
@media (max-width:640px) { .mac-split-view { flex-direction:column; } aside { width:100% !important; height:auto; max-height:140px; flex-direction:row; overflow:auto; border-right:0; border-bottom:1px solid var(--border-color); } main { min-height:0; } }
</style>
