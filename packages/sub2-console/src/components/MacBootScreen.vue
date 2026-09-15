<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { useSystemAudio } from '@sub2-mac/core';

const props = defineProps<{
  isBooting: boolean;
}>();

const emit = defineEmits<{
  (e: 'bootCompleted'): void;
}>();

const audio = useSystemAudio();
const progress = ref(0);
let animationTimer: any = null;
let completionTimer: ReturnType<typeof setTimeout> | null = null;
function stopBootSequence() {
  if (animationTimer !== null) cancelAnimationFrame(animationTimer);
  if (completionTimer !== null) clearTimeout(completionTimer);
  animationTimer = null;
  completionTimer = null;
}

function runBootSequence() {
  stopBootSequence();
  progress.value = 0;
  audio.playBootChord();

  const startTime = performance.now();
  const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;

  function step(currentTime: number) {
    const elapsed = currentTime - startTime;
    const t = duration === 0 ? 1 : Math.min(1, elapsed / duration);

    // Apple boot non-linear easing: quick initial, steady crawl, slight hold, finish
    let eased = 0;
    if (t < 0.25) {
      eased = (t / 0.25) * 35; // 0 to 35%
    } else if (t < 0.7) {
      eased = 35 + ((t - 0.25) / 0.45) * 45; // 35 to 80%
    } else if (t < 0.85) {
      eased = 80 + ((t - 0.7) / 0.15) * 8; // slight crawl 80 to 88%
    } else {
      eased = 88 + ((t - 0.85) / 0.15) * 12; // final sprint to 100%
    }

    progress.value = Math.min(100, eased);

    if (t < 1) {
      animationTimer = requestAnimationFrame(step);
    } else {
      completionTimer = setTimeout(() => {
        emit('bootCompleted');
      }, 100);
    }
  }

  animationTimer = requestAnimationFrame(step);
}

watch(
  () => props.isBooting,
  (val) => {
    if (val) {
      runBootSequence();
    } else stopBootSequence();
  },
  { immediate: true }
);

onUnmounted(stopBootSequence);
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-all duration-700 ease-out"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-105 filter blur-md"
  >
    <div
      v-if="isBooting"
      class="fixed inset-0 z-[99999] bg-black flex flex-col items-center justify-center select-none cursor-default"
    >
      <!-- Pure White Apple Emblem -->
      <div class="w-16 h-20 flex items-center justify-center mb-12">
        <svg class="w-16 h-20 fill-white drop-shadow-sm" viewBox="0 0 32 32">
          <path d="M8 4h16a4 4 0 0 1 4 4v4h-5V9H9v5h14a5 5 0 0 1 5 5v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4h5v3h14v-5H9a5 5 0 0 1-5-5V8a4 4 0 0 1 4-4Z"/>
        </svg>
      </div>

      <!-- Authentic Apple Progress Bar -->
      <div class="w-[180px] h-[5px] rounded-full bg-[#2c2c2e] overflow-hidden p-0 shadow-inner">
        <div
          class="h-full bg-white rounded-full transition-all duration-75 ease-linear"
          :style="{ width: `${progress}%` }"
        ></div>
      </div>
    </div>
  </Transition>
</template>
