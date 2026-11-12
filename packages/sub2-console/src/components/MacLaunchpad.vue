<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { MacAppIcon, MacSearchField, type AppDefinition } from '@sub2-mac/core';
import { appSections, appPresentation } from '@/apps/presentation';
const props = defineProps<{ visible: boolean; apps: AppDefinition[] }>();
const emit = defineEmits<{ (e:'close'):void;(e:'launch',id:string):void }>();
const query=ref('');const category=ref('all');const root=ref<HTMLElement|null>(null);let previousFocus:HTMLElement|null=null;
const apps = computed(() => props.apps.filter(app=>app.id!=='launchpad'));
const hasAdmin = computed(()=>apps.value.some(app=>app.category==='admin'));
const filteredApps = computed(()=>apps.value.filter(app=>(category.value==='all'||app.category===category.value)&&(app.name+app.title+app.id+(appPresentation[app.id]?.description || '')).toLowerCase().includes(query.value.trim().toLowerCase())));
const sections = computed(() => appSections.map(section => ({ ...section, apps: filteredApps.value.filter(app => (appPresentation[app.id]?.section || 'workspace') === section.id) })).filter(section => section.apps.length));
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
      <div class="launcher-toolbar"><div class="launcher-tabs" role="group" aria-label="应用分类"><button v-for="item in [{id:'all',name:'全部'},{id:'user',name:'用户服务'},...(hasAdmin?[{id:'admin',name:'管理工具'}]:[])]" :key="item.id" type="button" :aria-pressed="category===item.id" @click="category=item.id">{{ item.name }}</button></div><MacSearchField v-model="query" placeholder="搜索应用或用途，如：费率、密钥" /></div>
      <div class="launcher-content">
        <template v-if="filteredApps.length">
          <section v-for="section in sections" :key="section.id" class="launcher-section" :aria-label="section.title">
            <div class="launcher-section-heading"><h2>{{ section.title }} <span>{{ section.apps.length }}</span></h2><p>{{ section.description }}</p></div>
            <div class="launcher-grid">
              <button v-for="app in section.apps" :key="app.id" type="button" :aria-label="app.name" @click="launch(app.id)">
                <MacAppIcon :src="app.icon" :size="48" />
                <span class="launcher-app-copy"><strong>{{ app.name }}</strong><small>{{ appPresentation[app.id]?.description || app.title }}</small></span>
              </button>
            </div>
          </section>
        </template>
        <div v-else class="launcher-empty"><h2>未找到应用</h2><p>试试其他名称、用途，或切换分类。</p></div>
      </div>
      <footer><span>选择一个应用开始工作</span><span><kbd>↵</kbd> 打开 <kbd>esc</kbd> 关闭</span></footer>
    </section>
  </div></Transition>
</template>
<style scoped>
.launcher-overlay{position:fixed;inset:28px 0 0;z-index:55000;display:flex;align-items:center;justify-content:center;padding:30px 24px 90px;background:#101b3329;backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}
.launcher-panel{width:940px;max-width:100%;max-height:100%;display:flex;flex-direction:column;min-height:0;border-radius:28px;border:1px solid var(--material-panel-border);background:var(--material-panel);backdrop-filter:var(--vibrancy-panel);-webkit-backdrop-filter:var(--vibrancy-panel);color:var(--text-primary);box-shadow:var(--shadow-modal);overflow:hidden;}
header{padding:27px 30px 20px;display:flex;align-items:center;justify-content:space-between;gap:20px;}h1{font-size:23px;letter-spacing:-.6px;font-weight:600;}header p{font-size:12px;color:var(--text-secondary);margin-top:6px;}.launcher-close{font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:8px;}
kbd{font-family:inherit;font-size:10px;color:var(--text-tertiary);border:1px solid var(--border-subtle);border-radius:4px;padding:1px 4px;}
.launcher-toolbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 30px 15px;border-bottom:1px solid var(--border-subtle);}.launcher-tabs{display:flex;gap:4px;}.launcher-tabs button{padding:6px 12px;border-radius:8px;font-size:12px;color:var(--text-secondary);white-space:nowrap;}.launcher-tabs button[aria-pressed=true]{background:var(--sidebar-selection);color:var(--text-primary);font-weight:550;}.launcher-toolbar :deep(.mac-search-field){width:290px;}
.launcher-content{min-height:0;overflow:auto;flex:1;padding:6px 26px 22px;overscroll-behavior:contain}
.launcher-section{padding:18px 0 12px}.launcher-section+.launcher-section{border-top:1px solid var(--border-subtle)}
.launcher-section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 8px 10px}.launcher-section-heading h2{font-size:13px;font-weight:650}.launcher-section-heading h2 span{margin-left:5px;color:var(--text-secondary);font-size:11px;font-weight:400}.launcher-section-heading p{font-size:11px;color:var(--text-secondary)}
.launcher-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.launcher-grid button{display:flex;align-items:center;text-align:left;min-width:0;gap:10px;padding:11px 10px;border:1px solid transparent;border-radius:12px}
.launcher-grid button:hover,.launcher-grid button:focus-visible{background:var(--bg-surface);border-color:var(--border-color);box-shadow:0 3px 10px #00000008}
.launcher-grid button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.launcher-app-copy{display:grid;gap:5px;min-width:0}.launcher-app-copy strong{font-size:12px;font-weight:600;overflow-wrap:anywhere}.launcher-app-copy small{font-size:11px;line-height:1.5;color:var(--text-secondary);overflow-wrap:anywhere}
.launcher-empty{text-align:center;padding:70px 20px;color:var(--text-secondary);font-size:12px;}.launcher-empty h2{font-size:17px;color:var(--text-primary);margin-bottom:8px;}
footer{padding:13px 30px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;gap:12px;font-size:10px;color:var(--text-tertiary);}
.app-launcher-enter-active,.app-launcher-leave-active{transition:opacity 180ms ease;}.app-launcher-enter-active .launcher-panel,.app-launcher-leave-active .launcher-panel{transition:transform 180ms ease;}.app-launcher-enter-from,.app-launcher-leave-to{opacity:0;}.app-launcher-enter-from .launcher-panel,.app-launcher-leave-to .launcher-panel{transform:translateY(12px) scale(.975);}
@media(max-width:750px){.launcher-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.launcher-toolbar{flex-wrap:wrap;gap:12px}.launcher-toolbar :deep(.mac-search-field){width:100%}.launcher-section-heading p{display:none}}
@media(max-width:500px){.launcher-overlay{padding:10px 8px 78px}.launcher-panel{border-radius:20px}header{padding:18px 16px 14px}header h1{font-size:21px}.launcher-toolbar{padding:0 16px 14px}.launcher-content{padding:0 8px 12px}.launcher-grid{gap:2px}.launcher-grid button{padding:10px 5px;gap:6px;align-items:flex-start}.launcher-grid :deep(.mac-app-icon){width:36px!important;height:36px!important}.launcher-app-copy small{font-size:10px}footer{padding:12px 16px}footer>span:last-child{display:none}}
@media(prefers-reduced-motion:reduce){.app-launcher-enter-active,.app-launcher-leave-active,.app-launcher-enter-active .launcher-panel,.app-launcher-leave-active .launcher-panel{transition:none}}
</style>
