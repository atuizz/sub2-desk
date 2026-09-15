<script setup lang="ts">
import { markRaw, onMounted, ref } from 'vue';
import { createWindowManager, provideWindowManager, MacWindow, MacDock, MacButton, type AppDefinition } from '@sub2-mac/core';
import ExampleWorkspace from './ExampleWorkspace.vue';

// Independent consumer: no business APIs, auth store, or Sub2API data types.
const wm = createWindowManager();
provideWindowManager(wm);
const dark = ref(document.documentElement.classList.contains('dark'));
const apps: AppDefinition[] = [
  { id: 'workspace', name: '工作空间', title: '工作空间', icon: '/assets/finder.png', defaultW: 860, defaultH: 570, minW: 480, category: 'system', component: markRaw(ExampleWorkspace) },
  { id: 'library', name: '资源库', title: '资源库', icon: '/assets/apps.png', defaultW: 730, defaultH: 490, minW: 480, category: 'system', component: markRaw(ExampleWorkspace) },
];
wm.registerApps(apps);
function toggleTheme() { dark.value = !dark.value; document.documentElement.classList.toggle('dark', dark.value); }
function launch(id: string) { if (id === 'downloads') id = 'workspace'; wm.openApp(id); }
onMounted(() => { wm.openApp('workspace'); });
</script>
<template>
  <div class="core-preview" :style="{ backgroundImage: `url(/assets/${dark ? 'tahoe-night' : 'tahoe'}.jpg)` }">
    <header class="preview-menubar"><strong>Sub2 Desk <span>组件预览</span></strong><div><button @click="toggleTheme">{{ dark ? '浅色外观' : '深色外观' }}</button><a href="/">返回控制台</a></div></header>
    <aside class="preview-note"><span>DESKTOP KIT</span><h1>熟悉的桌面，<br>流畅的工作。</h1><p>窗口 · 材质 · 焦点 · 交互</p><MacButton @click="launch('library')">打开第二个窗口</MacButton></aside>
    <MacWindow v-for="win in wm.windows.value" :key="win.id" :win="win" @focus="wm.focusWindow(win.id)" @close="wm.closeWindow(win.id)" @minimize="wm.minimizeWindow(win.id)" @maximize="wm.toggleMaximizeWindow(win.id)">
      <component :is="wm.registeredApps.value[win.appId].component" :win="win" />
    </MacWindow>
    <MacDock :apps="apps" :running-app-ids="wm.windows.value.map(w => w.appId)" :active-app-id="wm.activeWindow.value?.appId" @launch="launch" />
  </div>
</template>
<style scoped>
.core-preview { position:fixed; inset:0; background-size:cover; background-position:center; }
.preview-menubar { height:28px; display:flex; justify-content:space-between; align-items:center; padding:0 16px; color:white; background:rgba(255,255,255,.13); backdrop-filter:blur(22px); font-size:12px; border-bottom:1px solid rgba(255,255,255,.12); }
.preview-menubar strong { font-weight:650; } .preview-menubar span { opacity:.65; font-weight:400; margin-left:12px; } .preview-menubar div { display:flex; align-items:center; gap:20px; } .preview-menubar button:hover,.preview-menubar a:hover { opacity:.7; }
.preview-note { position:absolute; left:30px; top:66px; color:white; text-shadow:0 2px 12px rgba(0,0,0,.1); } .preview-note > span { font-size:10px; letter-spacing:3px; opacity:.65; } .preview-note h1 { font-size:28px; font-weight:600; letter-spacing:-1px; line-height:1.4; margin:14px 0 10px; } .preview-note p { font-size:11px; opacity:.65; margin-bottom:20px; }
@media(max-width:1100px) { .preview-note { top:auto; bottom:100px; left:24px; } .preview-note h1,.preview-note p,.preview-note > span { display:none; } }
@media(max-width:640px) { .preview-note { display:none; } .preview-menubar { font-size:11px; padding:0 12px; } .preview-menubar div { gap:12px; } .preview-menubar span { display:none; } }
</style>
