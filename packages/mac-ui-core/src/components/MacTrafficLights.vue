<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    isFocused?: boolean;
    isMaximized?: boolean;
  }>(),
  {
    isFocused: true,
    isMaximized: false
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'minimize'): void;
  (e: 'maximize'): void;
}>();

const isHovered = ref(false);
</script>

<template>
  <div
    class="flex items-center gap-2 px-1 group select-none"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <!-- Close -->
    <button
      data-test="traffic-close"
      class="traffic-light traffic-close-btn w-3 h-3 rounded-full flex items-center justify-center transition-all focus:outline-none shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.75)]"
      :class="[
        isFocused
          ? 'bg-[#ff5f56] border border-[#e0443e] active:scale-90'
          : 'bg-[#dcdcdc] dark:bg-[#3e3e42] border border-black/10 dark:border-white/10'
      ]"
      title="关闭 (⌘W)"
      @click.stop="emit('close')"
    >
      <svg
        v-if="isFocused && isHovered"
        class="w-[7px] h-[7px] text-[#4d0000] opacity-80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3.5"
        stroke-linecap="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    </button>

    <!-- Minimize -->
    <button
      class="traffic-light w-3 h-3 rounded-full flex items-center justify-center transition-all focus:outline-none shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.75)]"
      :class="[
        isFocused
          ? 'bg-[#ffbd2e] border border-[#dea123] active:scale-90'
          : 'bg-[#dcdcdc] dark:bg-[#3e3e42] border border-black/10 dark:border-white/10'
      ]"
      title="最小化 (⌘M)"
      @click.stop="emit('minimize')"
    >
      <svg
        v-if="isFocused && isHovered"
        class="w-[7px] h-[7px] text-[#5e3c00] opacity-80"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="4"
        stroke-linecap="round"
      >
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    </button>

    <!-- Maximize / Fullscreen -->
    <button
      class="traffic-light w-3 h-3 rounded-full flex items-center justify-center transition-all focus:outline-none shadow-[inset_0_1px_0.5px_rgba(255,255,255,0.75)]"
      :class="[
        isFocused
          ? 'bg-[#27c93f] border border-[#1aab29] active:scale-90'
          : 'bg-[#dcdcdc] dark:bg-[#3e3e42] border border-black/10 dark:border-white/10'
      ]"
      :title="isMaximized ? '还原' : '全屏显示'"
      @click.stop="emit('maximize')"
    >
      <svg
        v-if="isFocused && isHovered"
        class="w-[6px] h-[6px] text-[#004d11] opacity-80"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M4 4h7v2H6.41l5.3 5.3-1.42 1.41L5 7.41V12H3V4h1zm16 16h-7v-2h4.59l-5.3-5.3 1.42-1.41L19 16.59V12h2v8h-1z"/>
      </svg>
    </button>
  </div>
</template>
