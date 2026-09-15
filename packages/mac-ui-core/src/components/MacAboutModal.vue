<script setup lang="ts">
defineProps<{
  isOpen: boolean;
  systemSpec?: {
    name: string;
    version: string;
    build: string;
    darwinKernel: string;
    chip: string;
    memory: string;
    model: string;
    serial: string;
  };
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'openSettings'): void;
}>();
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 scale-95 translate-y-2"
    enter-to-class="opacity-100 scale-100 translate-y-0"
    leave-active-class="transition-all duration-150 ease-in"
    leave-from-class="opacity-100 scale-100 translate-y-0"
    leave-to-class="opacity-0 scale-95 translate-y-2"
  >
    <div
      v-if="isOpen"
      class="fixed inset-0 z-[70000] flex items-center justify-center p-4 select-none pointer-events-auto"
      @click.self="emit('close')"
    >
      <!-- Backdrop Dimmer -->
      <div class="fixed inset-0 bg-black/25 dark:bg-black/45 backdrop-blur-[2px] -z-10" @click="emit('close')"></div>

      <!-- About This Mac Window (macOS Tahoe Liquid Glass Spec) -->
      <div
        class="tahoe-liquid-card liquid-surface-gloss w-[310px] sm:w-[330px] rounded-[22px] overflow-hidden flex flex-col text-[var(--text-primary)] shadow-[0_28px_70px_rgba(0,15,45,0.4)] border border-white/60 dark:border-white/20 relative"
        :style="{
          background: 'var(--liquid-glass-bg)'
        }"
        @click.stop
      >
        <!-- Liquid Glass Top Highlight -->
        <div class="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/95 dark:via-white/40 to-transparent pointer-events-none rounded-t-[22px] z-10"></div>
        <!-- Title Bar -->
        <div class="h-9 px-3.5 flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center gap-1.5">
            <button
              id="about-modal-close"
              data-test="about-modal-close"
              class="w-3 h-3 rounded-full bg-[#ff5f56] hover:brightness-90 flex items-center justify-center text-[8px] text-[#4c0000] group"
              @click="emit('close')"
            >
              <svg class="w-2 h-2 opacity-0 group-hover:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div class="w-3 h-3 rounded-full bg-[#ffbd2e]/50"></div>
            <div class="w-3 h-3 rounded-full bg-[#27c93f]/50"></div>
          </div>
          <span class="text-[12px] font-medium text-[var(--text-secondary)]">关于 Sub2-Mac</span>
          <div class="w-10"></div>
        </div>

        <!-- Window Body -->
        <div class="p-6 flex flex-col items-center text-center">
          <!-- Metallic Apple Logo with Tahoe Blue Spectral Glow -->
          <div class="relative mb-3.5">
            <div class="absolute -inset-2 rounded-full bg-gradient-to-tr from-sky-400/20 to-blue-600/25 blur-lg pointer-events-none"></div>
            <div class="w-16 h-16 rounded-full bg-gradient-to-b from-white/90 to-white/40 dark:from-white/20 dark:to-white/5 border border-white/60 dark:border-white/20 shadow-md flex items-center justify-center">
              <svg class="w-9 h-9 fill-current text-[var(--text-primary)] drop-shadow-sm" viewBox="0 0 32 32">
                <path d="M8 4h16a4 4 0 0 1 4 4v4h-5V9H9v5h14a5 5 0 0 1 5 5v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4h5v3h14v-5H9a5 5 0 0 1-5-5V8a4 4 0 0 1 4-4Z"/>
              </svg>
            </div>
          </div>

          <!-- macOS Tahoe Header -->
          <div class="text-[20px] font-bold tracking-tight text-[var(--text-primary)] leading-tight">
            {{ systemSpec?.name || 'Sub2-Mac' }}
          </div>
          <div class="text-[12px] text-[var(--text-secondary)] mb-4">
            版本 {{ systemSpec?.version || '—' }} ({{ systemSpec?.build || 'Web' }})
          </div>

          <!-- Specs Card -->
          <div class="w-full rounded-[12px] bg-black/[0.03] dark:bg-white/[0.05] border border-[var(--border-subtle)] p-3 text-[12px] space-y-1.5 text-left mb-5">
            <div class="flex justify-between">
              <span class="text-[var(--text-secondary)]">系统架构</span>
              <span class="font-medium text-[var(--text-primary)] text-right">{{ systemSpec?.model || 'Sub2API Core Server' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--text-secondary)]">控制台版本</span>
              <span class="font-medium text-[var(--text-primary)] text-right">{{ systemSpec?.version || '0.2.0' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--text-secondary)]">界面技术</span>
              <span class="font-medium text-[var(--text-primary)] text-right">{{ systemSpec?.darwinKernel || 'Go Standard Engine' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--text-secondary)]">数据来源</span>
              <span class="font-medium text-[var(--text-primary)] text-right">{{ systemSpec?.memory || 'PostgreSQL · Redis' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-[var(--text-secondary)]">站点地址</span>
              <span class="font-mono text-[11px] text-[var(--text-tertiary)]">{{ systemSpec?.serial || '127.0.0.1:8000' }}</span>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="w-full flex items-center justify-center gap-2.5">
            <button
              class="flex-1 py-1.5 px-3 rounded-[8px] text-[12px] font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border border-[var(--border-subtle)] transition-colors text-[var(--text-primary)]"
              @click="emit('openSettings'); emit('close')"
            >
              更多信息...
            </button>
            <button
              class="flex-1 py-1.5 px-3 rounded-[8px] text-[12px] font-medium bg-[#007aff] text-white hover:bg-[#0071eb] shadow-xs transition-colors"
              @click="emit('openSettings'); emit('close')"
            >
              系统设置
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>
