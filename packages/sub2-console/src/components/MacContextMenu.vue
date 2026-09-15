<script setup lang="ts">
import { version } from '../../package.json';
defineProps<{
  visible: boolean;
  x: number;
  y: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'changeWallpaper'): void;
  (e: 'openApp', appId: string): void;
  (e: 'quickLook'): void;
  (e: 'toggleTheme'): void;
  (e: 'about'): void;
}>();
</script>

<template>
  <div
    v-if="visible"
    class="fixed z-[55000] w-52 py-1.5 rounded-[12px] border border-black/10 dark:border-white/15 bg-white/85 dark:bg-[#28282a]/92 backdrop-blur-2xl shadow-2xl text-[13px] text-[var(--text-primary)] select-none font-sans"
    :style="{ left: `${x}px`, top: `${y}px` }"
    @click.stop
  >
    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('quickLook'); emit('close')"
    >
      <span>快速查看运行态</span>
      <span class="text-[11px] opacity-60 font-mono">Space</span>
    </button>
    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('openApp', 'keychain'); emit('close')"
    >
      <span>管理 API 密钥</span>
      <span class="text-[11px] opacity-60 font-mono">⌘N</span>
    </button>
    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('openApp', 'network'); emit('close')"
    >
      <span>网络与节点体检</span>
      <span class="text-[11px] opacity-60">Ping</span>
    </button>
    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('openApp', 'wallet'); emit('close')"
    >
      <span>Sub2 钱包收银台</span>
      <span class="text-[11px] opacity-60">$</span>
    </button>

    <div class="my-1 border-b border-black/10 dark:border-white/10"></div>

    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('changeWallpaper'); emit('close')"
    >
      <span>更换 5K 动态壁纸</span>
      <span class="text-[11px] opacity-60">Tahoe</span>
    </button>
    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('toggleTheme'); emit('close')"
    >
      <span>切换深浅外观</span>
      <span class="text-[11px] opacity-60 font-mono">⌘D</span>
    </button>

    <div class="my-1 border-b border-black/10 dark:border-white/10"></div>

    <button
      class="w-full px-3 py-1.5 text-left flex items-center justify-between hover:bg-[var(--accent)] hover:text-white transition-colors"
      @click="emit('about'); emit('close')"
    >
      <span>关于 Sub2 Desk...</span>
      <span class="text-[11px] opacity-60 font-mono">v{{ version }}</span>
    </button>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
