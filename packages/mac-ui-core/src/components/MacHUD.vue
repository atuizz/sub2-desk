<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';

const props = withDefaults(
  defineProps<{
    type?: 'volume' | 'brightness';
    value: number; // 0 - 100
    visible?: boolean;
  }>(),
  {
    type: 'volume',
    value: 70,
    visible: false
  }
);

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void;
}>();

const isShowing = ref(props.visible);
let timer: ReturnType<typeof setTimeout> | null = null;

function triggerShow() {
  isShowing.value = true;
  emit('update:visible', true);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    isShowing.value = false;
    emit('update:visible', false);
  }, 2200);
}

watch(
  () => props.value,
  () => {
    triggerShow();
  }
);

watch(
  () => props.visible,
  val => {
    isShowing.value = val;
    if (val) triggerShow();
  }
);

onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <Transition
    enter-active-class="transition duration-250 ease-out"
    enter-from-class="opacity-0 translate-y-[-8px] scale-95"
    enter-to-class="opacity-100 translate-y-0 scale-100"
    leave-active-class="transition duration-300 ease-in"
    leave-from-class="opacity-100 translate-y-0 scale-100"
    leave-to-class="opacity-0 translate-y-[-8px] scale-95"
  >
    <div
      v-if="isShowing"
      class="fixed top-9 right-4 z-50 pointer-events-none select-none"
    >
      <!-- macOS Tahoe 26 Top-Right Liquid Glass Pill HUD -->
      <div
        class="h-7 px-3 rounded-full flex items-center gap-2.5 shadow-[0_12px_28px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.1)] border border-white/60 dark:border-white/20 backdrop-blur-xl bg-white/45 dark:bg-[#18181c]/65 text-[var(--text-primary)]"
      >
        <!-- Icon -->
        <div class="w-3.5 h-3.5 flex items-center justify-center shrink-0 opacity-80">
          <!-- Volume Icon -->
          <svg
            v-if="type === 'volume'"
            class="w-3.5 h-3.5 fill-current"
            viewBox="0 0 24 24"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path
              v-if="value > 0"
              d="M15.54 8.46a5 5 0 0 1 0 7.07"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
            <path
              v-if="value > 50"
              d="M19.07 4.93a10 10 0 0 1 0 14.14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            />
          </svg>

          <!-- Brightness Sun Icon -->
          <svg
            v-else
            class="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        </div>

        <!-- Horizontal Capsule Progress Track -->
        <div class="w-32 h-1.5 rounded-full bg-black/15 dark:bg-white/20 overflow-hidden relative">
          <div
            class="h-full bg-black/75 dark:bg-white rounded-full transition-all duration-150 ease-out"
            :style="{ width: `${Math.min(100, Math.max(0, value))}%` }"
          />
        </div>

        <!-- Percent Label -->
        <span class="text-[10px] font-mono opacity-60 w-6 text-right">{{ value }}%</span>
      </div>
    </div>
  </Transition>
</template>
