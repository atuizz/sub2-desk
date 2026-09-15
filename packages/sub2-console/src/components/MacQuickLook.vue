<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import { useSystemStore } from '../stores/system';

const props = defineProps<{
  visible: boolean;
  target?: string | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'openApp', appId: string): void;
}>();

const authStore = useAuthStore();
const systemStore = useSystemStore();

function handleKey(e: KeyboardEvent) {
  if (props.visible && (e.code === 'Space' || e.code === 'Escape')) {
    e.preventDefault();
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKey);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey);
});
</script>

<template>
  <transition
    enter-active-class="transition duration-180 ease-out"
    enter-from-class="opacity-0 scale-95"
    leave-active-class="transition duration-140 ease-in"
    leave-to-class="opacity-0 scale-95"
  >
    <div 
      v-if="visible"
      class="fixed inset-0 z-[60000] flex items-center justify-center pointer-events-none"
    >
      <!-- Quick Look Glass Window -->
      <div 
        class="w-[520px] max-w-[calc(100vw-24px)] rounded-2xl bg-white/75 dark:bg-[#1e1e1e]/80 backdrop-blur-2xl border border-white/40 dark:border-white/10 shadow-2xl overflow-hidden pointer-events-auto flex flex-col text-[#1d1d1f] dark:text-[#f5f5f7] transition-all"
      >
        <!-- Quick Look Header Bar -->
        <div class="h-10 px-4 flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02]">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold">快速查看 (Quick Look)</span>
            <span class="text-[10px] px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10 font-mono text-black/50 dark:text-white/50">Spacebar</span>
          </div>

          <div class="flex items-center gap-2">
            <button 
              @click="emit('openApp', 'activity')"
              class="text-xs px-2.5 py-1 rounded-md bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
            >
              在应用中打开
            </button>
            <button 
              @click="emit('close')"
              class="w-6 h-6 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center text-xs text-black/60 dark:text-white/60"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Preview Body -->
        <div class="p-6 space-y-4">
          <!-- Big Icon & Title -->
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#007aff] to-[#5856d6] shadow-lg flex items-center justify-center text-white text-2xl font-bold">
              ⚡
            </div>
            <div>
              <h3 class="text-base font-bold">当前账户与连接</h3>
              <p class="text-xs text-black/50 dark:text-white/50 mt-0.5 font-mono">
                {{ authStore.isAdmin ? '管理员' : '标准用户视角' }}
              </p>
            </div>
          </div>

          <!-- Quick Telemetry Grid -->
          <div class="grid grid-cols-2 gap-3 pt-2">
            <div class="p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06]">
              <span class="text-[11px] text-black/50 dark:text-white/50 block mb-1">当前账户余额</span>
              <span class="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {{ authStore.user?.balance != null ? '$' + authStore.user.balance.toFixed(2) : '—' }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06]">
              <span class="text-[11px] text-black/50 dark:text-white/50 block mb-1">后端连接延迟</span>
              <span class="text-lg font-bold font-mono text-blue-500">
                {{ systemStore.connectionStatus === 'online' ? systemStore.latency + ' ms' : '暂不可用' }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06]">
              <span class="text-[11px] text-black/50 dark:text-white/50 block mb-1">登录状态</span>
              <span class="text-base font-semibold font-mono text-black/80 dark:text-white/80">
                {{ authStore.isAuthenticated ? '已登录' : '未登录' }}
              </span>
            </div>

            <div class="p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06]">
              <span class="text-[11px] text-black/50 dark:text-white/50 block mb-1">并发调用上限</span>
              <span class="text-base font-semibold font-mono text-purple-500">
                {{ authStore.user?.concurrency ?? '—' }} 并发
              </span>
            </div>
          </div>

          <!-- Quick Tip -->
          <div class="text-[11px] text-black/40 dark:text-white/40 text-center pt-2">
            再次轻按 <kbd class="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono">空格键</kbd> 或 <kbd class="px-1.5 py-0.5 rounded bg-black/10 dark:bg-white/10 font-mono">Esc</kbd> 退出预览
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
kbd {
  font-size: 10px;
}
</style>
