<script setup lang="ts">
import { ref } from 'vue';
import { MacAppIcon, type AppDefinition } from '@sub2-mac/core';
const props = defineProps<{ apps: AppDefinition[]; selected?: string | null; appearance?: 'default' | 'dark' | 'transparent' | 'tinted' }>();
const emit = defineEmits<{ (e: 'select', id: string): void; (e: 'launch', id: string): void }>();
const grid = ref<HTMLElement | null>(null);
function move(event: KeyboardEvent, index: number) {
  const rows = Math.max(1, Math.floor((grid.value?.clientHeight || 540) / 94));
  const delta: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, ArrowLeft: rows, ArrowRight: -rows };
  if (!(event.key in delta)) return;
  event.preventDefault();
  const next = Math.max(0, Math.min(props.apps.length - 1, index + delta[event.key]));
  grid.value?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  if (props.apps[next]) emit('select', props.apps[next].id);
}
</script>
<template>
  <nav ref="grid" class="desktop-apps" aria-label="管理员桌面应用">
    <button v-for="(app, index) in apps" :key="app.id" type="button" :aria-label="app.name" :aria-pressed="selected === app.id"
      @click.stop="emit('select', app.id)" @dblclick.stop="emit('launch', app.id)" @keydown.enter.stop.prevent="emit('launch', app.id)" @keydown="move($event,index)">
      <MacAppIcon :src="app.icon" :size="66" :appearance="appearance" />
      <span>{{ app.name }}</span>
    </button>
  </nav>
</template>
<style scoped>
.desktop-apps { position:absolute; top:45px; right:18px; bottom:102px; display:grid; grid-auto-flow:column; grid-template-rows:repeat(auto-fill,94px); grid-auto-columns:90px; column-gap:8px; direction:rtl; z-index:0; }
button { width:90px;height:90px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;direction:ltr;gap:0;border-radius:10px; }
button > span:last-child { color:white;font-size:11px;font-weight:500;line-height:15px;max-width:88px;padding:2px 6px;border-radius:5px;text-shadow:0 1px 3px #000000a6;overflow-wrap:anywhere; }
button:hover { background:#ffffff0d; }
button[aria-pressed="true"] > span:first-child { background:#ffffff20;border-radius:12px; }
button[aria-pressed="true"] > span:last-child { background:#2469c7;text-shadow:none; }
button:focus-visible { outline:2px solid #ffffffa6;outline-offset:1px; }
@media(max-width:1099px) { .desktop-apps { display:none; } }
</style>
