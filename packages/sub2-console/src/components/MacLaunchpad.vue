<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { MacAppIcon, MacSearchField, type AppDefinition } from '@sub2-mac/core';
const props = defineProps<{ visible: boolean; apps: AppDefinition[] }>();
const emit = defineEmits<{ (e:'close'):void;(e:'launch',id:string):void }>();
const query=ref('');const category=ref('all');const root=ref<HTMLElement|null>(null);let previousFocus:HTMLElement|null=null;
const apps = computed(() => props.apps.filter(app=>app.id!=='launchpad'));
const hasAdmin = computed(()=>apps.value.some(app=>app.category==='admin'));
const filteredApps = computed(()=>apps.value.filter(app=>(category.value==='all'||app.category===category.value)&&(app.name+app.title+app.id).toLowerCase().includes(query.value.trim().toLowerCase())));
watch(()=>props.visible,async visible=>{if(visible){previousFocus=document.activeElement as HTMLElement;query.value='';category.value='all';await nextTick();root.value?.querySelector<HTMLInputElement>('input')?.focus();}else previousFocus?.focus({preventScroll:true});});
function launch(id:string){emit('launch',id);emit('close');}
function onKey(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();emit('close');}
  if(event.key==='Enter'&&event.target instanceof HTMLInputElement){event.preventDefault();event.stopPropagation();if(filteredApps.value[0])launch(filteredApps.value[0].id);}
  if(event.key==='Tab'){
    const items=Array.from(root.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]')||[]).filter(el=>el.getClientRects().length);
    const i=items.indexOf(document.activeElement as HTMLElement);
    if((event.shiftKey&&i<=0)||(!event.shiftKey&&i===items.length-1)){event.preventDefault();items[event.shiftKey?items.length-1:0]?.focus();}
  }
}
</script>
<template>
  <Transition name="app-launcher"><div v-if="visible" class="launcher-overlay" @click.self="emit('close')">
    <section ref="root" class="launcher-panel" role="dialog" aria-modal="true" aria-label="应用程序" @keydown="onKey">
      <header><div><h1>应用程序</h1><p>{{ apps.length }} 个应用，尽在你的工作空间</p></div><button type="button" class="launcher-close" aria-label="关闭应用程序" @click="emit('close')">关闭 <kbd>esc</kbd></button></header>
      <div class="launcher-toolbar"><div class="launcher-tabs" role="group" aria-label="应用分类"><button v-for="item in [{id:'all',name:'全部'},{id:'user',name:'用户服务'},...(hasAdmin?[{id:'admin',name:'管理工具'}]:[])]" :key="item.id" type="button" :aria-pressed="category===item.id" @click="category=item.id">{{ item.name }}</button></div><MacSearchField v-model="query" placeholder="搜索应用" /></div>
      <div class="launcher-content"><div v-if="filteredApps.length" class="launcher-grid"><button v-for="app in filteredApps" :key="app.id" type="button" :aria-label="app.name" @click="launch(app.id)"><MacAppIcon :src="app.icon" :size="78" /><span>{{ app.name }}</span></button></div><div v-else class="launcher-empty"><h2>未找到应用</h2><p>试试其他名称，或切换分类。</p></div></div>
      <footer><span>选择一个应用开始工作</span><span><kbd>↵</kbd> 打开 <kbd>esc</kbd> 关闭</span></footer>
    </section>
  </div></Transition>
</template>
<style scoped>
.launcher-overlay{position:fixed;inset:28px 0 0;z-index:55000;display:flex;align-items:center;justify-content:center;padding:30px 24px 90px;background:#101b3329;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}
.launcher-panel{width:940px;max-width:100%;max-height:100%;display:flex;flex-direction:column;min-height:0;border-radius:28px;border:1px solid var(--material-panel-border);background:var(--material-panel);backdrop-filter:var(--vibrancy-panel);-webkit-backdrop-filter:var(--vibrancy-panel);color:var(--text-primary);box-shadow:var(--shadow-modal);overflow:hidden;}
header{padding:27px 30px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;}h1{font-size:23px;letter-spacing:-.6px;font-weight:600;}header p{font-size:12px;color:var(--text-secondary);margin-top:6px;}.launcher-close{font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;}
kbd{font-family:inherit;font-size:10px;color:var(--text-tertiary);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 4px;}
.launcher-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 30px 15px;border-bottom:1px solid var(--border-subtle);}.launcher-tabs{display:flex;gap:4px;}.launcher-tabs button{padding:6px 12px;border-radius:8px;font-size:12px;color:var(--text-secondary);white-space:nowrap;}.launcher-tabs button[aria-pressed=true]{background:var(--sidebar-selection);color:var(--text-primary);font-weight:550;}.launcher-toolbar :deep(.mac-search-field){width:230px;}
.launcher-content{min-height:0;overflow:auto;flex:1;}.launcher-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px 4px;padding:20px 24px 28px;}.launcher-grid button{display:flex;flex-direction:column;align-items:center;padding:10px 2px 14px;gap:4px;border-radius:14px;font-size:12px;}.launcher-grid button:hover{background:var(--control-bg);}.launcher-grid button>span:last-child{max-width:100%;overflow-wrap:anywhere;}.launcher-empty{text-align:center;padding:70px 20px;color:var(--text-secondary);font-size:12px;}.launcher-empty h2{font-size:17px;color:var(--text-primary);margin-bottom:8px;}
footer{padding:13px 30px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;gap:12px;font-size:10px;color:var(--text-tertiary);}
.app-launcher-enter-active,.app-launcher-leave-active{transition:opacity 180ms ease;}.app-launcher-enter-active .launcher-panel,.app-launcher-leave-active .launcher-panel{transition:transform 180ms ease;}.app-launcher-enter-from,.app-launcher-leave-to{opacity:0;}.app-launcher-enter-from .launcher-panel,.app-launcher-leave-to .launcher-panel{transform:translateY(12px) scale(.975);}
@media(max-width:750px){.launcher-grid{grid-template-columns:repeat(4,minmax(0,1fr));}.launcher-toolbar{flex-wrap:wrap;gap:12px;}.launcher-toolbar :deep(.mac-search-field){width:100%;}}
@media(max-width:500px){.launcher-overlay{padding:10px 8px 78px;}.launcher-panel{border-radius:22px;}header{padding:20px 18px 16px;}header h1{font-size:21px;}header p{font-size:11px;}.launcher-toolbar{padding:0 18px 14px;}.launcher-grid{grid-template-columns:repeat(3,minmax(0,1fr));padding:12px 10px 18px;gap:4px;}.launcher-grid button{font-size:11px;}.launcher-grid :deep(.mac-app-icon){width:68px!important;height:68px!important;}footer{padding:12px 18px;}footer>span:last-child{display:none;}}
</style>
