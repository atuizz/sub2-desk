<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import type { AppDefinition } from '../types';
import MacAppIcon from './MacAppIcon.vue';

const props = defineProps<{
  visible: boolean;
  apps: AppDefinition[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'launch', appId: string): void;
}>();

const query = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const selectedIndex = ref(0);

const filteredApps = computed(() => {
  if (!query.value.trim()) {
    return props.apps.slice(0, 6);
  }
  const q = query.value.toLowerCase().trim();
  return props.apps.filter(app => {
    return app.name.toLowerCase().includes(q) || (app.title && app.title.toLowerCase().includes(q));
  });
});

watch(() => props.visible, (val) => {
  if (val) {
    query.value = '';
    selectedIndex.value = 0;
    nextTick(() => {
      inputRef.value?.focus();
    });
  }
});

watch(query, () => {
  selectedIndex.value = 0;
});

function handleKeyDown(e: KeyboardEvent) {
  if (!props.visible) return;

  if (e.key === 'Escape') {
    emit('close');
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (filteredApps.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % filteredApps.value.length;
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (filteredApps.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + filteredApps.value.length) % filteredApps.value.length;
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredApps.value[selectedIndex.value]) {
      launchItem(filteredApps.value[selectedIndex.value].id);
    }
  }
}

function launchItem(appId: string) {
  emit('launch', appId);
  emit('close');
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});
</script>

<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-[60000] flex justify-center items-start pt-[16vh] bg-black/20 backdrop-blur-[2px] select-none"
    @click.self="emit('close')"
  >
    <div
      class="spotlight-box w-[680px] rounded-[var(--radius-xl)] overflow-hidden flex flex-col relative"
      role="dialog"
      aria-modal="true"
      aria-label="聚焦搜索"
      :style="{
        background: 'var(--material-panel)',
        backdropFilter: 'var(--vibrancy-panel)',
        WebkitBackdropFilter: 'var(--vibrancy-panel)',
        boxShadow: 'var(--shadow-modal)',
        border: '0.5px solid var(--material-panel-border)'
      }"
    >
      <!-- Liquid Knife-Edge Top Highlight -->
      <div class="absolute top-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/95 dark:via-white/40 to-transparent pointer-events-none rounded-t-[var(--radius-xl)] z-10"></div>

      <!-- Search Bar -->
      <div class="h-[58px] px-5 flex items-center gap-3.5 border-b border-[var(--border-subtle)]">
        <svg class="w-5 h-5 text-[var(--text-primary)] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          aria-label="聚焦搜索"
          placeholder="聚焦搜索..."
          class="w-full bg-transparent text-[19px] font-medium text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none border-none tracking-[-0.01em]"
        />
        <span class="text-[11px] px-2 py-0.5 rounded-[var(--radius-sm)] bg-black/8 dark:bg-white/12 text-[var(--text-secondary)] font-medium font-mono shrink-0 border border-[var(--border-subtle)]">
          esc 关闭
        </span>
      </div>

      <!-- Quick Results List (Dual Column Layout) -->
      <div v-if="filteredApps.length > 0" class="flex min-h-[300px] max-h-[380px] overflow-hidden">
        <!-- Left: Results List -->
        <div class="w-[58%] p-2.5 flex flex-col gap-1 overflow-y-auto border-r border-[var(--border-subtle)]">
          <div class="text-[11px] font-bold text-[var(--text-tertiary)] uppercase tracking-wider px-3 pt-1.5 pb-1">
            应用程序
          </div>
          <div
            v-for="(app, idx) in filteredApps"
            :key="app.id"
            class="px-3 py-2.5 rounded-[var(--radius-md)] flex items-center justify-between cursor-pointer transition-all"
            :class="selectedIndex === idx ? 'bg-[var(--accent)] text-white shadow-xs' : 'hover:bg-black/6 dark:hover:bg-white/10 text-[var(--text-primary)]'"
            @click="launchItem(app.id)"
            @mouseenter="selectedIndex = idx"
          >
            <div class="flex items-center gap-3 min-w-0">
              <MacAppIcon :src="app.icon" :size="36" />
              <div class="flex flex-col min-w-0">
                <span class="font-bold text-[14px] truncate" :class="selectedIndex === idx ? 'text-white' : 'text-[var(--text-primary)]'">{{ app.name }}</span>
                <span
                  class="text-[12px] truncate font-medium"
                  :class="selectedIndex === idx ? 'text-white/90' : 'text-[var(--text-secondary)]'"
                >
                  {{ app.title }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Dedicated App Detail Preview Panel -->
        <div class="w-[42%] p-6 flex flex-col items-center justify-between text-center bg-black/[0.03] dark:bg-white/[0.03] select-none">
          <div class="flex flex-col items-center pt-3">
            <div class="w-20 h-20 mb-3.5 flex items-center justify-center drop-shadow-xl shrink-0">
              <MacAppIcon
                :src="filteredApps[selectedIndex]?.icon"
                :alt="filteredApps[selectedIndex]?.name"
                :size="88"
              />
            </div>
            <h4 class="text-[18px] font-bold text-[var(--text-primary)] leading-tight mb-1.5">
              {{ filteredApps[selectedIndex]?.name }}
            </h4>
            <p class="text-[13px] font-medium text-[var(--text-secondary)] line-clamp-3 px-2 mb-3 leading-relaxed">
              {{ filteredApps[selectedIndex]?.title }}
            </p>
            <span class="text-[11px] font-semibold font-mono px-3 py-1 rounded-full bg-black/8 dark:bg-white/12 text-[var(--text-primary)] border border-[var(--border-subtle)]">
              {{ filteredApps[selectedIndex]?.category === 'admin' ? '管理工具' : '应用程序' }}
            </span>
          </div>

          <button
            class="w-full py-2 px-4 rounded-[var(--radius-md)] text-[13px] font-bold bg-[#007aff] hover:bg-[#0062cc] text-white shadow-md transition-all active:scale-[0.98]"
            @click="launchItem(filteredApps[selectedIndex].id)"
          >
            打开应用
          </button>
        </div>
      </div>

      <!-- No Match State -->
      <div v-else class="p-8 text-center text-[13px] font-medium text-[var(--text-secondary)]">
        未找到匹配的 Sub2 应用或功能
      </div>
    </div>
  </div>
</template>

<style scoped>
.spotlight-box {
  max-width: calc(100vw - 24px);
  animation: spotlightPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
@media (max-width:540px) {
  .spotlight-box > div.flex.min-h-\[300px\] > div:first-child { width:100%;border-right:0; }
  .spotlight-box > div.flex.min-h-\[300px\] > div:last-child { display:none; }
}

@keyframes spotlightPop {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(-10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
