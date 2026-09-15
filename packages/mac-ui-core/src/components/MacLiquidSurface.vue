<script setup lang="ts">
import { computed } from 'vue';
import { LiquidGlassPresets, type LiquidGlassPreset } from '../tokens/materials';

const props = withDefaults(
  defineProps<{
    variant?: 'bar' | 'shelf' | 'panel' | 'hud' | 'tile';
    interactive?: boolean;
    rounded?: string; // e.g. 'rounded-[20px]', 'rounded-full'
  }>(),
  {
    variant: 'panel',
    interactive: false,
    rounded: 'rounded-[18px]'
  }
);

const preset = computed<LiquidGlassPreset>(() => LiquidGlassPresets[props.variant]);
</script>

<template>
  <div
    class="relative overflow-hidden transition-all duration-300 select-none group"
    :class="[
      rounded,
      interactive ? 'hover:scale-[1.01] active:scale-[0.99] cursor-pointer' : ''
    ]"
    :style="{
      backdropFilter: `${preset.backdropBlur} ${preset.backdropSaturate} ${preset.backdropBrightness}`,
      WebkitBackdropFilter: `${preset.backdropBlur} ${preset.backdropSaturate} ${preset.backdropBrightness}`,
      boxShadow: preset.dropShadow
    }"
  >
    <!-- Background Substrate Tint -->
    <div
      class="absolute inset-0 -z-10 transition-colors pointer-events-none"
      :style="{
        backgroundColor: preset.bgLight
      }"
    />
    <div
      class="absolute inset-0 -z-10 transition-colors pointer-events-none hidden dark:block"
      :style="{
        backgroundColor: preset.bgDark
      }"
    />

    <!-- Surface Sheen Meniscus (Top 45% specular gradient) -->
    <div
      class="absolute top-0 left-0 right-0 h-[45%] pointer-events-none -z-5 opacity-70 bg-gradient-to-b from-white/35 dark:from-white/15 to-transparent"
    />

    <!-- Knife-Edge Specular Perimeter Border (1.5px continuous hairline) -->
    <div
      class="absolute inset-0 pointer-events-none rounded-[inherit] border-[1px] border-white/60 dark:border-white/20 shadow-[inset_0_1px_1px_0_rgba(255,255,255,0.7)]"
    />

    <!-- Slot Content -->
    <div class="relative z-10 w-full h-full">
      <slot />
    </div>
  </div>
</template>
