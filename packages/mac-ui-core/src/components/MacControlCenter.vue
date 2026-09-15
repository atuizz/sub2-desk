<script setup lang="ts">
import { computed } from 'vue';
const props = withDefaults(defineProps<{
  modelValue: boolean; volume?: number; brightness?: number; isDark?: boolean;
  connectionStatus?: 'unknown' | 'online' | 'offline'; latency?: number; widgetsVisible?: boolean;
}>(), { volume: 35, brightness: 100, isDark: false, connectionStatus: 'unknown', latency: 0, widgetsVisible: true });
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void; (e: 'update:volume', value: number): void;
  (e: 'update:brightness', value: number): void; (e: 'toggleTheme'): void;
  (e: 'toggleWidgets'): void; (e: 'openApp', id: string): void; (e: 'lock'): void;
}>();
const statusText = computed(() => props.connectionStatus === 'online' ? '已连接' : props.connectionStatus === 'offline' ? '连接中断' : '等待连接');
function open(id: string) { emit('openApp', id); emit('update:modelValue', false); }
</script>

<template>
  <Transition name="control-center">
    <section v-if="modelValue" class="control-center-panel" role="region" aria-label="控制中心" @keydown.esc.stop="emit('update:modelValue', false)">
      <header><span>控制中心</span><button type="button" class="control-settings" @click="open('settings')">系统设置<span aria-hidden="true"> ›</span></button></header>
      <div class="control-grid">
        <button type="button" class="control-tile connection-tile" @click="open('network')">
          <img src="/assets/network.svg" alt="" />
          <strong>后端连接</strong>
          <span><i :class="connectionStatus" />{{ statusText }}</span>
          <small>{{ connectionStatus === 'online' && latency > 0 ? latency + ' ms 往返延迟' : '查看可用渠道' }}</small>
        </button>
        <div class="control-stack">
          <button type="button" class="control-tile compact-tile" :aria-pressed="isDark" @click="emit('toggleTheme')">
            <img src="/assets/settings.png" alt="" /><span><strong>深色外观</strong><small>{{ isDark ? '已开启' : '已关闭' }}</small></span>
          </button>
          <button type="button" class="control-tile compact-tile" :aria-pressed="widgetsVisible" @click="emit('toggleWidgets')">
            <img src="/assets/apps.png" alt="" /><span><strong>桌面小组件</strong><small>{{ widgetsVisible ? '显示' : '隐藏' }}</small></span>
          </button>
        </div>
      </div>
      <div class="control-slider">
        <label for="desktop-brightness">桌面亮度 <output>{{ brightness }}%</output></label>
        <input id="desktop-brightness" aria-label="桌面亮度" type="range" min="35" max="100" :value="brightness" @input="emit('update:brightness', Number(($event.target as HTMLInputElement).value))" />
      </div>
      <div class="control-slider">
        <label for="desktop-volume">界面音量 <output>{{ volume }}%</output></label>
        <input id="desktop-volume" aria-label="界面音量" type="range" min="0" max="100" :value="volume" @input="emit('update:volume', Number(($event.target as HTMLInputElement).value))" />
      </div>
      <footer><button type="button" @click="open('settings')">外观与桌面</button><button type="button" @click="emit('lock'); emit('update:modelValue', false)">锁定屏幕</button></footer>
    </section>
  </Transition>
</template>

<style scoped>
.control-center-panel { position:fixed; top:36px; right:10px; width:336px; max-width:calc(100vw - 20px); padding:16px; border-radius:24px; border:1px solid var(--material-panel-border); color:var(--text-primary); background:var(--material-panel); backdrop-filter:var(--vibrancy-panel); -webkit-backdrop-filter:var(--vibrancy-panel); box-shadow:var(--shadow-modal); display:flex; flex-direction:column; gap:12px; max-height:calc(100dvh - 48px); overflow:auto; }
header { display:flex; align-items:center; justify-content:space-between; padding:0 2px 2px; font-size:13px; font-weight:600; }
.control-settings { font-size:11px; font-weight:400; color:var(--text-secondary); }
.control-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.control-tile { border:1px solid var(--material-tile-border); border-radius:16px; background:var(--material-tile); text-align:left; transition:background 150ms ease; box-shadow:0 1px 2px #00000004,inset 0 1px 0 #ffffff30; }
.control-tile:hover { background:var(--bg-surface); }
.connection-tile { padding:14px; display:flex; align-items:flex-start; flex-direction:column; gap:6px; }
.connection-tile img { width:32px; height:32px; margin-bottom:6px; object-fit:contain; }
.control-tile strong { font-size:12px; font-weight:600; }
.control-tile small { display:block; font-size:10px; color:var(--text-secondary); line-height:1.4; }
.connection-tile > span { display:flex; gap:5px; align-items:center; font-size:11px; color:var(--text-secondary); }
i { width:5px; height:5px; border-radius:50%; background:var(--text-tertiary); } i.online { background:#32a663; } i.offline { background:#c98932; }
.control-stack { display:flex; flex-direction:column; gap:10px; }
.compact-tile { display:flex; align-items:center; gap:9px; padding:12px 10px; flex:1; }
.compact-tile img { width:28px; height:28px; object-fit:contain; }
.compact-tile span { display:flex; flex-direction:column; gap:4px; }
.control-tile[aria-pressed="true"] { background:color-mix(in srgb, var(--accent) 9%, var(--material-tile)); }
.control-slider { padding:13px 14px; background:var(--material-tile); border:1px solid var(--material-tile-border); border-radius:16px; }
.control-slider label { display:flex; align-items:center; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:11px; }
output { font-size:11px; color:var(--text-secondary); font-weight:400; font-variant-numeric:tabular-nums; }
input { width:100%; height:8px; display:block; accent-color:var(--accent); cursor:pointer; }
footer { display:flex; justify-content:space-between; padding:2px 4px 0; font-size:11px; color:var(--text-secondary); }
footer button:hover,.control-settings:hover { color:var(--accent); }
.control-center-enter-active,.control-center-leave-active { transition:opacity 160ms ease,transform 160ms ease; transform-origin:top right; }
.control-center-enter-from,.control-center-leave-to { opacity:0; transform:translateY(-6px) scale(.97); }
@media(prefers-reduced-motion:reduce) { .control-center-enter-active,.control-center-leave-active,.control-tile { transition:none; } }
</style>
