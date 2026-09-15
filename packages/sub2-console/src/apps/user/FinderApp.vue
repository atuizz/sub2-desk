<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed } from 'vue';
import { MacAppIcon, MacSearchField, MacSegmented, useWindowManager, type WindowInstance } from '@sub2-mac/core';
import { useAuthStore } from '../../stores/auth';
import { ALL_APPS } from '../manifest';

defineProps<{
  win?: WindowInstance;
}>();

const wm = useWindowManager();
const authStore = useAuthStore();

type SectionId = 'all' | 'user' | 'admin' | 'tools';
const currentSection = ref<SectionId>('all');
const viewMode = ref<'grid' | 'list'>('grid');
const selectedAppId = ref<string | null>(null);
const searchQuery = ref('');

const sidebarSections = computed(() => {
  const sections = [
    {
      title: '应用程序',
      items: [
        { id: 'all' as SectionId, name: '全部应用', icon: 'app' },
        { id: 'user' as SectionId, name: '用户服务', icon: 'user' }
      ]
    }
  ];

  if (authStore.isAdmin) {
    sections[0].items.push({ id: 'admin' as SectionId, name: '系统管理', icon: 'settings' });
  }

  sections[0].items.push({ id: 'tools' as SectionId, name: '实用工具', icon: 'tool' });

  return sections;
});

const sectionTitleMap: Record<SectionId, string> = {
  all: '全部应用',
  user: '用户服务',
  admin: '系统管理',
  tools: '实用工具'
};

const visibleApps = computed(() => {
  // Filter apps according to user permissions
  let list = ALL_APPS.filter(app => {
    if (app.id === 'launchpad' || app.id === 'finder') return false;
    if (app.id === 'card_shop' && !wm?.registeredApps.value.card_shop) return false;
    if (app.category === 'admin' && !authStore.isAdmin) return false;
    return true;
  });

  // Filter by section
  if (currentSection.value === 'user') {
    list = list.filter(app => app.category === 'user' && app.id !== 'terminal' && app.id !== 'safari');
  } else if (currentSection.value === 'admin') {
    list = list.filter(app => app.category === 'admin');
  } else if (currentSection.value === 'tools') {
    list = list.filter(app => app.id === 'terminal' || app.id === 'safari');
  }

  // Filter by search query
  const q = searchQuery.value.trim().toLowerCase();
  if (q) {
    list = list.filter(app =>
      app.name.toLowerCase().includes(q) ||
      (app.title && app.title.toLowerCase().includes(q)) ||
      app.id.toLowerCase().includes(q)
    );
  }

  return list;
});

function handleAppClick(appId: string) {
  selectedAppId.value = appId;
}

function handleAppDblClick(appId: string) {
  if (wm) {
    wm.openApp(appId);
  }
}
</script>

<template>
  <div class="finder-app">
    <aside class="finder-sidebar">
      <h3>应用程序</h3>
      <template v-for="section in sidebarSections" :key="section.title">
        <button v-for="item in section.items" :key="item.id" type="button" :aria-current="currentSection === item.id ? 'page' : undefined" @click="currentSection = item.id">
          <img :src="getAppIcon(item.id === 'admin' ? 'settings' : item.id === 'tools' ? 'terminal' : item.id === 'user' ? 'users' : 'launchpad')" alt="" />{{ item.name }}
        </button>
      </template>
      <div class="finder-account"><strong>{{ authStore.user?.username || '当前工作空间' }}</strong><span>{{ authStore.isAdmin ? '管理员' : '用户服务' }}</span></div>
    </aside>
    <main class="finder-main">
      <header class="finder-toolbar"><div><h2>{{ sectionTitleMap[currentSection] }}</h2><span>{{ visibleApps.length }} 个应用</span></div><MacSegmented v-model="viewMode" :options="[{ label:'图标', value:'grid' },{ label:'列表', value:'list' }]" /><MacSearchField v-model="searchQuery" placeholder="搜索应用" /></header>
      <div class="finder-mobile-sections"><button v-for="item in sidebarSections[0].items" :key="item.id" type="button" :aria-pressed="currentSection === item.id" @click="currentSection = item.id">{{ item.name }}</button></div>
      <div class="finder-content">
        <div v-if="!visibleApps.length" class="finder-empty"><h3>未找到应用</h3><p>试试其他名称，或切换分类。</p><button type="button" @click="searchQuery = ''; currentSection = 'all'">显示全部应用</button></div>
        <div v-else-if="viewMode === 'grid'" class="finder-grid">
          <button v-for="app in visibleApps" :key="app.id" type="button" :aria-label="app.name" :aria-pressed="selectedAppId === app.id" @click="handleAppClick(app.id)" @dblclick="handleAppDblClick(app.id)" @keydown.enter.stop.prevent="handleAppDblClick(app.id)">
            <MacAppIcon :src="app.icon" :size="72" /><span>{{ app.name }}</span>
          </button>
        </div>
        <table v-else class="finder-list"><thead><tr><th>名称</th><th>分类</th><th></th></tr></thead><tbody>
          <tr v-for="app in visibleApps" :key="app.id" tabindex="0" :class="{ selected: selectedAppId === app.id }" @click="handleAppClick(app.id)" @dblclick="handleAppDblClick(app.id)" @keydown.enter.stop.prevent="handleAppDblClick(app.id)">
            <td><MacAppIcon :src="app.icon" :size="32" /><span>{{ app.name }}</span></td><td>{{ app.category === 'admin' ? '管理工具' : '用户服务' }}</td><td><button type="button" :aria-label="'打开' + app.name" @click.stop="handleAppDblClick(app.id)">打开</button></td>
          </tr>
        </tbody></table>
      </div>
      <footer><span>{{ visibleApps.length }} 个项目{{ selectedAppId ? ' · 已选择 1 项' : '' }}</span><span>双击或按 Enter 打开</span></footer>
    </main>
  </div>
</template>
<style scoped>
.finder-app { display:flex;flex:1;min-width:0;min-height:0;height:100%;font-family:var(--font-mac);background:var(--content-bg);color:var(--text-primary); }
.finder-sidebar { width:180px;flex-shrink:0;padding:22px 10px 12px;display:flex;flex-direction:column;gap:4px;background:var(--sidebar-bg);border-right:1px solid var(--border-subtle); }
.finder-sidebar h3 { font-size:11px;font-weight:600;color:var(--text-tertiary);padding:0 10px 6px; }
.finder-sidebar button { display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:8px;font-size:12px;text-align:left; }
.finder-sidebar img { width:24px;height:24px;object-fit:contain; }
.finder-sidebar button:hover { background:var(--control-bg); }.finder-sidebar button[aria-current="page"] { background:var(--sidebar-selection);font-weight:550; }
.finder-account { margin-top:auto;padding:10px;font-size:11px;border-top:1px solid var(--border-subtle);display:flex;flex-direction:column;gap:5px;overflow:hidden; }.finder-account strong { font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }.finder-account span { color:var(--text-tertiary); }
.finder-main { display:flex;flex-direction:column;flex:1;min-width:0;min-height:0; }
.finder-toolbar { min-height:64px;padding:12px 18px;display:flex;align-items:center;gap:16px;border-bottom:1px solid var(--border-subtle);background:var(--window-bg-solid); }.finder-toolbar>div:first-child { margin-right:auto;min-width:90px; }.finder-toolbar h2 { font-size:15px;font-weight:600; }.finder-toolbar>div:first-child>span { font-size:10px;color:var(--text-tertiary); }.finder-toolbar :deep(.mac-search-field) { width:160px; }
.finder-content { min-height:0;overflow:auto;flex:1; }.finder-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px 4px;padding:22px 18px; }.finder-grid button { display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 3px 12px;border-radius:10px;font-size:12px; }.finder-grid button:hover { background:var(--bg-surface-subtle); }.finder-grid button[aria-pressed="true"] { background:color-mix(in srgb,var(--accent) 10%,transparent); }.finder-grid button[aria-pressed="true"]>span:last-child { color:var(--accent); }
.finder-list { width:100%;border-collapse:collapse;font-size:12px; }.finder-list th { text-align:left;font-size:11px;font-weight:500;color:var(--text-secondary);padding:9px 18px;background:var(--bg-surface-subtle);position:sticky;top:0; }.finder-list td { padding:6px 18px;border-bottom:1px solid var(--border-subtle); }.finder-list td:first-child { display:flex;align-items:center;gap:8px; }.finder-list tr:nth-child(even) { background:var(--bg-surface-subtle); }.finder-list tr.selected { background:color-mix(in srgb,var(--accent) 10%,transparent); }.finder-list td:nth-child(2) { color:var(--text-secondary); }.finder-list td:last-child { text-align:right;color:var(--accent); }
footer { display:flex;justify-content:space-between;gap:10px;min-height:30px;align-items:center;padding:0 16px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-tertiary);background:var(--window-bg-solid); }.finder-empty { text-align:center;padding:70px 15px;font-size:12px;color:var(--text-secondary); }.finder-empty h3 { font-size:15px;font-weight:600;color:var(--text-primary); }.finder-empty p { margin:8px 0 15px; }.finder-empty button { color:var(--accent); }.finder-mobile-sections { display:none; }
@container app-window (max-width:680px) { .finder-sidebar { width:150px; }.finder-toolbar { flex-wrap:wrap;gap:10px; }.finder-toolbar :deep(.mac-search-field) { width:100%; }.finder-grid { grid-template-columns:repeat(auto-fill,minmax(90px,1fr));padding:14px 10px; } }
@container app-window (max-width:500px) { .finder-sidebar { display:none; }.finder-mobile-sections { display:flex;gap:6px;overflow:auto;flex-shrink:0;padding:8px 12px;border-bottom:1px solid var(--border-subtle); }.finder-mobile-sections button { padding:5px 8px;border-radius:6px;white-space:nowrap;font-size:11px;color:var(--text-secondary); }.finder-mobile-sections button[aria-pressed="true"] { color:var(--accent);background:var(--control-bg); }.finder-toolbar { padding:12px 14px; }footer>span:last-child { display:none; }.finder-list td,.finder-list th { padding-left:10px;padding-right:10px; } }
</style>
