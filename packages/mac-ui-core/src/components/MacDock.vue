<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { AppDefinition } from '../types';
import MacAppIcon from './MacAppIcon.vue';

const props = withDefaults(
  defineProps<{
    apps: AppDefinition[];
    runningAppIds: string[];
    activeAppId?: string | null;
    dockIconTheme?: 'default' | 'dark' | 'transparent' | 'tinted';
  }>(),
  {
    activeAppId: null,
    dockIconTheme: 'default'
  }
);

const emit = defineEmits<{
  (e: 'launch', appId: string): void;
}>();

const dockNavRef = ref<HTMLElement | null>(null);
const bouncingAppId = ref<string | null>(null);

const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1440);

function handleWindowResize() {
  windowWidth.value = window.innerWidth;
}

const compact = computed(() => windowWidth.value <= 640);
const reducedMotion = ref(false);
const visibleApps = computed(() => {
  if (!compact.value) return props.apps;
  // Consumers determine priority through their app order; core has no business IDs.
  const apps = props.apps.slice(0, 5);
  const active = props.apps.find(app => app.id === props.activeAppId);
  if (active && !apps.some(app => app.id === active.id)) apps[apps.length - 1] = active;
  return apps;
});
const baseSize = computed(() => {
  if (compact.value) return Math.min(48, Math.floor((windowWidth.value - 48) / Math.max(visibleApps.value.length, 1)));
  const count = visibleApps.value.length;
  return Math.max(28, Math.min(56, Math.floor((windowWidth.value - 90) / count)));
});

const maxExtra = computed(() => compact.value || reducedMotion.value ? 0 : Math.round(baseSize.value * 0.42));
const distanceLimit = computed(() => Math.round(baseSize.value * 3.2));
const shelfHeight = computed(() => Math.round(baseSize.value + 10));

let targetMouseX: number | null = null;
let rafId: number | null = null;
let isAnimating = false;

interface ItemPhysics {
  id: string;
  el: HTMLElement | null;
  currentSlotWidth: number;
  currentIconSize: number;
  currentTranslateY: number;
  targetSlotWidth: number;
  targetIconSize: number;
  targetTranslateY: number;
}

const itemsMap = new Map<string, ItemPhysics>();

watch(baseSize, (newSize) => {
  itemsMap.forEach(state => {
    state.currentSlotWidth = newSize;
    state.currentIconSize = newSize;
    state.targetSlotWidth = newSize;
    state.targetIconSize = newSize;
    if (state.el) {
      state.el.style.width = `${newSize}px`;
      const iconBox = state.el.querySelector<HTMLElement>('.dock-icon-box');
      if (iconBox) {
        iconBox.style.width = `${newSize}px`;
        iconBox.style.height = `${newSize}px`;
      }
    }
  });
});

function setItemRef(el: any, id: string) {
  if (!el) {
    itemsMap.delete(id);
    return;
  }
  let existing = itemsMap.get(id);
  if (!existing) {
    existing = {
      id,
      el,
      currentSlotWidth: baseSize.value,
      currentIconSize: baseSize.value,
      currentTranslateY: 0,
      targetSlotWidth: baseSize.value,
      targetIconSize: baseSize.value,
      targetTranslateY: 0
    };
    itemsMap.set(id, existing);
  } else {
    existing.el = el;
  }
}

function updatePhysics() {
  let needsNextFrame = false;

  itemsMap.forEach(state => {
    if (!state.el) return;

    if (targetMouseX !== null) {
      const rect = state.el.getBoundingClientRect();
      const centerX = rect.left + state.currentSlotWidth / 2;
      const dist = Math.abs(targetMouseX - centerX);

      if (dist < distanceLimit.value) {
        const pct = dist / distanceLimit.value;
        // Smooth cosine wave
        const wave = Math.cos(pct * (Math.PI / 2));
        state.targetSlotWidth = baseSize.value + (maxExtra.value + 4) * wave;
        state.targetIconSize = baseSize.value + maxExtra.value * wave;
        state.targetTranslateY = -4 * wave;
      } else {
        state.targetSlotWidth = baseSize.value;
        state.targetIconSize = baseSize.value;
        state.targetTranslateY = 0;
      }
    } else {
      state.targetSlotWidth = baseSize.value;
      state.targetIconSize = baseSize.value;
      state.targetTranslateY = 0;
    }

    // Spring lerp interpolation (0.28 factor for authentic snappy Apple feel)
    const dw = state.targetSlotWidth - state.currentSlotWidth;
    const ds = state.targetIconSize - state.currentIconSize;
    const dy = state.targetTranslateY - state.currentTranslateY;

    if (Math.abs(dw) > 0.08 || Math.abs(ds) > 0.08 || Math.abs(dy) > 0.08) {
      state.currentSlotWidth += dw * 0.28;
      state.currentIconSize += ds * 0.28;
      state.currentTranslateY += dy * 0.28;
      needsNextFrame = true;
    } else {
      state.currentSlotWidth = state.targetSlotWidth;
      state.currentIconSize = state.targetIconSize;
      state.currentTranslateY = state.targetTranslateY;
    }

    // Apply slot layout width (pushes neighbors apart smoothly)
    state.el.style.width = `${state.currentSlotWidth.toFixed(2)}px`;

    // Apply icon size and slight lift to the inner icon container
    const iconBox = state.el.querySelector<HTMLElement>('.dock-icon-box');
    if (iconBox) {
      iconBox.style.width = `${state.currentIconSize.toFixed(2)}px`;
      iconBox.style.height = `${state.currentIconSize.toFixed(2)}px`;
      iconBox.style.transform = `translateY(${state.currentTranslateY.toFixed(2)}px)`;
    }
  });

  if (needsNextFrame) {
    rafId = requestAnimationFrame(updatePhysics);
  } else {
    isAnimating = false;
    rafId = null;
  }
}

function startAnimation() {
  if (!isAnimating) {
    isAnimating = true;
    rafId = requestAnimationFrame(updatePhysics);
  }
}

function handleGlobalMouseMove(e: MouseEvent) {
  if (!dockNavRef.value || compact.value || reducedMotion.value) return;
  const navRect = dockNavRef.value.getBoundingClientRect();

  // Active tracking zone: up to 110px from screen bottom, with 40px horizontal margin
  const inZone =
    e.clientY >= window.innerHeight - 110 &&
    e.clientX >= navRect.left - 40 &&
    e.clientX <= navRect.right + 40;

  if (inZone) {
    dockNavRef.value.style.setProperty('--glass-pointer-x', `${Math.max(0, Math.min(100, (e.clientX - navRect.left) / navRect.width * 100))}%`);
    dockNavRef.value.style.setProperty('--glass-pointer-strength', '1');
    targetMouseX = e.clientX;
    startAnimation();
  } else if (targetMouseX !== null) {
    dockNavRef.value.style.setProperty('--glass-pointer-strength', '0');
    targetMouseX = null;
    startAnimation();
  }
}

function clickItem(appId: string) {
  if (!reducedMotion.value) bouncingAppId.value = appId;
  setTimeout(() => {
    if (bouncingAppId.value === appId) {
      bouncingAppId.value = null;
    }
  }, 950);

  emit('launch', appId);
}

onMounted(() => {
  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.addEventListener('mousemove', handleGlobalMouseMove);
  window.addEventListener('resize', handleWindowResize);
});

onUnmounted(() => {
  window.removeEventListener('mousemove', handleGlobalMouseMove);
  window.removeEventListener('resize', handleWindowResize);
  if (rafId) cancelAnimationFrame(rafId);
});
</script>

<template>
  <div
    class="fixed bottom-0 left-0 right-0 h-[110px] flex items-end justify-center pointer-events-none z-[45000] pb-2 px-2"
  >
    <!-- Dock Shelf: Adaptive height, never stretches vertically -->
    <nav
      ref="dockNavRef"
      class="dock-shelf pointer-events-auto flex items-end px-3 rounded-[var(--radius-dock)] select-none relative overflow-visible max-w-full"
      :style="{
        height: `${shelfHeight}px`,
        background: 'var(--material-dock)',
        backdropFilter: 'var(--vibrancy-dock)',
        WebkitBackdropFilter: 'var(--vibrancy-dock)',
        border: '0.5px solid var(--material-dock-border)',
        boxShadow: 'var(--shadow-dock)'
      }"
    >
      <!-- Tahoe Liquid Glass Top Knife-Edge Specular Reflection -->
      <div class="dock-glass-rim" aria-hidden="true"></div>

      <!-- Convex Surface Meniscus Gloss Layer -->
      <div class="dock-glass-reflection" aria-hidden="true"></div>
      <div class="dock-glass-caustic" aria-hidden="true"></div>

      <!-- Applications list -->
      <div
        v-for="app in visibleApps"
        :key="app.id"
        :ref="(el: unknown) => setItemRef(el, app.id)"
        :data-appid="app.id"
        class="dock-slot group relative flex flex-col items-center justify-end cursor-pointer overflow-visible"
        :style="{
          width: `${baseSize}px`,
          height: `${shelfHeight}px`
        }"
        role="button"
        tabindex="0"
        :aria-label="app.name"
        :aria-pressed="activeAppId === app.id"
        @keydown.enter.prevent="clickItem(app.id)"
        @keydown.space.prevent="clickItem(app.id)"
        @click="clickItem(app.id)"
      >
        <!-- The Floating / Protruding Icon Container with 3D Glass Mirror Reflection -->
        <div
          class="dock-icon-box liquid-icon-reflect flex items-center justify-center will-change-transform mb-[5px] relative"
          :class="{ 'dock-bouncing': bouncingAppId === app.id }"
          :style="{
            width: `${baseSize}px`,
            height: `${baseSize}px`
          }"
        >
          <MacAppIcon :src="app.icon" :alt="app.name" :size="baseSize" :appearance="dockIconTheme" />

          <!-- Authentic Apple Red Notification Badge -->
          <div
            v-if="app.badge"
            class="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#ff3b30] text-white text-[11px] font-bold flex items-center justify-center shadow-[0_2px_4px_rgba(0,0,0,0.35)] border-[1.5px] border-white/90 leading-none z-10"
          >
            {{ app.badge }}
          </div>
        </div>

        <!-- Running Indicator Dot (Glowing Crystal Bead) -->
        <div
          v-if="runningAppIds.includes(app.id)"
          class="dock-running-dot"
        ></div>

        <!-- Apple Glass Tooltip -->
        <div class="dock-tooltip">
          {{ app.name }}
        </div>
      </div>

    </nav>
  </div>
</template>

<style scoped>
.dock-icon-box :deep(.mac-app-icon) { width:100% !important;height:100% !important; }
.dock-shelf { gap:1px; }

.dock-slot:focus-visible { outline: 2px solid white; outline-offset: 3px; border-radius: 12px; }
.dock-slot[aria-pressed="true"] .dock-running-dot { background: white; box-shadow: 0 0 0 1px rgba(255,255,255,.3); }
.dock-slot:focus-visible .dock-tooltip { opacity: 1; visibility: visible; }
.dock-running-dot {
  position: absolute;
  bottom: 2.5px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(20, 20, 20, 0.85);
}

.dark .dock-running-dot {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 3px rgba(255, 255, 255, 0.6);
}

/* Apple native gravity elastic bounce */
@keyframes dockBounce {
  0%, 100% { transform: translateY(0); }
  35% { transform: translateY(-30px) scale(1.04); }
  65% { transform: translateY(0); }
  80% { transform: translateY(-12px); }
  92% { transform: translateY(0); }
}

.dock-bouncing {
  animation: dockBounce 0.85s cubic-bezier(0.28, 0.84, 0.42, 1);
}

/* Apple Sequoia Refined Tooltip */
.dock-tooltip {
  position: absolute;
  bottom: calc(100% + 28px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 4px 11px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.01em;
  white-space: nowrap;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  color: #1d1d1f;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.12);
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 50000;
}

.dock-slot:hover .dock-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.dark .dock-tooltip {
  background: rgba(38, 38, 42, 0.92);
  color: #f5f5f7;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45), 0 0 0 0.5px rgba(255, 255, 255, 0.15);
}

/* macOS Tahoe 26 Dynamic Icon Themes */
.dock-icon-theme-default {
  filter: none;
}

.dock-icon-theme-dark {
  filter: brightness(0.8) contrast(1.2) drop-shadow(0 1px 3px rgba(0, 0, 0, 0.5));
}

.dock-icon-theme-transparent {
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.28)) saturate(60%) brightness(1.25);
  opacity: 0.82;
}

.dock-icon-theme-tinted {
  filter: grayscale(100%) sepia(100%) hue-rotate(190deg) saturate(320%) brightness(0.95);
}
</style>
