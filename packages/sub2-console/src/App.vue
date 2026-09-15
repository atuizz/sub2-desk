<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import {
  createWindowManager,
  provideWindowManager,
  MacMenubar,
  MacDock,
  MacWindow,
  MacSpotlight,
  MacAboutModal,
  MacHUD,
  MacSheet,
  useSystemAudio
} from '@sub2-mac/core';
import { useSystemStore, type WallpaperName } from './stores/system';
import { useAuthStore } from './stores/auth';
import { ALL_APPS } from './apps/manifest';
import { extraWallpaperIds } from './assets/wallpapers';
import { useCardShopStore } from './stores/cardShop';
import { validateDesktopFiles } from './desktop-file-drop';
import { desktopTarget } from './desktop-routes';
import announcementsAPI from './api/announcements';
import MacLockscreen from './components/MacLockscreen.vue';
import MacContextMenu from './components/MacContextMenu.vue';
import MacBootScreen from './components/MacBootScreen.vue';
import MacDesktopWidgets from './components/MacDesktopWidgets.vue';
import MacQuickLook from './components/MacQuickLook.vue';
import MacLaunchpad from './components/MacLaunchpad.vue';
import MacDesktopIcons from './components/MacDesktopIcons.vue';
import AdminComplianceSheet from './components/AdminComplianceSheet.vue';
import { adminComplianceAPI, type AdminComplianceStatus } from './api/admin/compliance';

const systemStore = useSystemStore();
const authStore = useAuthStore();
const cardShopStore = useCardShopStore();
const officialConsoleUrl = computed(() => {
  try {
    const value = new URL(import.meta.env.VITE_OFFICIAL_CONSOLE_URL || '');
    return ['http:', 'https:'].includes(value.protocol) && !value.username && !value.password ? value.href : '';
  } catch { return ''; }
});
const complianceVisible = ref(false);
const complianceStatus = ref<AdminComplianceStatus | null>(null);
const complianceLoading = ref(false), complianceError = ref('');
const complianceIdentity = computed(() => authStore.isAdmin ? `${authStore.sessionRevision}:${authStore.user?.id}` : '');
let complianceGeneration = 0;

async function checkAdminCompliance() {
  if (!complianceIdentity.value || complianceLoading.value) return;
  const current = ++complianceGeneration, identity = complianceIdentity.value;
  complianceLoading.value = true; complianceError.value = ''; complianceStatus.value = null;
  try {
    const status = await adminComplianceAPI.getStatus();
    if (current !== complianceGeneration || identity !== complianceIdentity.value) return;
    if (typeof status?.required !== 'boolean' || !status.version || !status.ack_phrase_zh?.trim() || !status.ack_phrase_en?.trim()) {
      throw new Error('合规确认信息不完整，请重新读取。');
    }
    complianceStatus.value = status;
    complianceVisible.value = status.required;
  } catch {
    if (current !== complianceGeneration || identity !== complianceIdentity.value) return;
    complianceError.value = '合规确认信息读取失败，请重试后再提交。';
    complianceVisible.value = true;
  } finally {
    if (current === complianceGeneration) complianceLoading.value = false;
  }
}

function closeAdminCompliance() {
  complianceVisible.value = false;
  complianceGeneration++; complianceStatus.value = null; complianceLoading.value = false;
}
function handleComplianceAccepted() {
  closeAdminCompliance();
  window.dispatchEvent(new CustomEvent('admin-compliance-accepted'));
}
function handleComplianceRequired() {
  if (!complianceIdentity.value) return;
  complianceVisible.value = true;
  // The 423 metadata intentionally omits acknowledgement phrases.
  void checkAdminCompliance();
}
watch(complianceIdentity, () => {
  complianceGeneration++; complianceStatus.value = null; complianceVisible.value = false;
  complianceLoading.value = false; complianceError.value = '';
  void checkAdminCompliance();
}, { immediate: true, flush: 'sync' });
onUnmounted(() => { complianceGeneration++; });
const audio = useSystemAudio();
watch(() => systemStore.volume, value => { audio.volume.value = value / 100; audio.enabled.value = value > 0; }, { immediate: true });
const wm = createWindowManager();
provideWindowManager(wm);

// macOS Tahoe Cold Boot State
const urlParams = new URLSearchParams(window.location.search);
const isBooting = ref(!urlParams.has('noboot') && sessionStorage.getItem('sub2_booted') !== 'true');

const developmentPreview = import.meta.env.DEV && urlParams.has('unlocked');
if (developmentPreview) {
  systemStore.unlock();
}

function handleBootCompleted() {
  isBooting.value = false;
  sessionStorage.setItem('sub2_booted', 'true');
}

const showDesktopHardDrives = ref(true);

async function triggerReboot() {
  if (!await wm.closeAllWindows('重新启动')) return;
  sessionStorage.removeItem('sub2_booted');
  systemStore.lock();
  isBooting.value = true;
}

async function handleLogout() {
  if (!await wm.closeAllWindows('退出登录')) return;
  audio.playClick();
  authStore.logout();
  systemStore.lock();
}

// About This Mac Modal
const aboutModalOpen = ref(false);
const shortcutsOpen = ref(false);
function hideOtherWindows() {
  const active = wm.activeWindow.value?.id;
  if (!active) return;
  for (const win of [...wm.windows.value]) if (win.id !== active) wm.minimizeWindow(win.id);
}

// Spotlight Search
const spotlightVisible = ref(false);
function toggleSpotlight() {
  spotlightVisible.value = !spotlightVisible.value;
}

// Quick Look Overlay
const quickLookVisible = ref(false);

// Desktop Icons selection
const selectedDesktopItem = ref<string | null>(null);
function selectDesktopItem(id: string, e?: MouseEvent) {
  e?.stopPropagation();
  selectedDesktopItem.value = id;
}
function clearDesktopSelection() {
  selectedDesktopItem.value = null;
}

// Register all foundation applications
wm.registerApps(ALL_APPS.filter(app => app.id !== 'card_shop'));
watch(() => cardShopStore.shops.length, count => {
  if (count) wm.registerApp(ALL_APPS.find(app => app.id === 'card_shop')!);
  else {
    for (const win of [...wm.windows.value]) if (win.appId === 'card_shop') wm.closeWindow(win.id);
    delete wm.registeredApps.value.card_shop;
  }
}, { immediate: true });
watch(() => authStore.user?.id, () => { void cardShopStore.load(); }, { immediate: true });
if (import.meta.env.DEV) (window as any).__wm = wm;

// Default Dock Pinned Apps: Authentic User & System essentials (NO admin apps by default, Safari & Terminal removed)
const defaultDockOrderIds = [
  // 1. macOS Tahoe Native Essentials
  'finder',              // 访达
  'launchpad',           // 启动台
  // 2. 用户核心应用 (Sub2API User Apps in authentic order)
  'dashboard',           // 仪表盘
  'keychain',            // API 密钥
  'activity',            // 使用记录
  'network',             // 可用渠道
  'subscriptions',       // 我的订阅
  'wallet',              // 购买与充值
  'voucher',             // 卡券兑换
  'appstore',            // 模型广场
  // 3. 系统设置
  'settings'             // 系统设置
];

// Administrator Desktop Applications (Authentic Sub2API Admin Console Sequence)
const adminDesktopApps = computed(() => {
  if (!authStore.isAdmin) return [];
  const adminIds = [
    'ops',                 // 运维监控 · /admin/ops
    'admin_usage',
    'users',               // 用户管理 · /admin/users
    'groups',              // 分组管理 · /admin/groups
    'channels',            // 渠道管理 · /admin/channels
    'admin_subscriptions', // 订阅管理 · /admin/subscriptions
    'accounts',            // 账号管理 · /admin/accounts
    'plugins',             // 插件管理 · /admin/plugins
    'announcements',       // 公告管理 · /admin/announcements
    'proxies',             // IP管理 · /admin/proxies
    'security',            // 风控中心 · /admin/security-audit
    'commerce'             // 订单管理 · /admin/orders + /admin/redeem
  ];
  return adminIds
    .map(id => wm.registeredApps.value[id])
    .filter((app): app is NonNullable<typeof app> => Boolean(app));
});

// Available apps for current user
const availableApps = computed(() => {
  if (authStore.isAdmin) {
    return ALL_APPS.filter(app => wm.registeredApps.value[app.id]);
  }
  return ALL_APPS.filter(app => app.category === 'user' && wm.registeredApps.value[app.id]);
});

// Admin view mode toggle ('all' | 'user_only')
const adminViewMode = ref<'all' | 'user_only'>('all');
const desktopShortcutApps = computed(() => {
  const shop = wm.registeredApps.value.card_shop;
  const shortcuts = shop ? [{ ...shop, name: cardShopStore.shops.length === 1 ? cardShopStore.shops[0]!.name : '小铺' }] : [];
  return [...shortcuts, ...(authStore.isAdmin && adminViewMode.value === 'all' ? adminDesktopApps.value : [])];
});
let lastShopRefresh = 0;
function refreshShopOnReturn() {
  if (document.hidden || cardShopStore.loading || Date.now() - lastShopRefresh < 30000) return;
  lastShopRefresh = Date.now();
  void cardShopStore.reload();
}

// Dynamic Dock Apps: Default pinned essentials + any running open windows (inserted before settings)
const dockApps = computed(() => {
  const openAppIds = wm.windows.value.map(w => w.appId);
  const activeIds = [...defaultDockOrderIds];
  if (cardShopStore.shops.length) activeIds.splice(activeIds.indexOf('wallet') + 1, 0, 'card_shop');
  for (const id of openAppIds) {
    if (!activeIds.includes(id)) {
      const settingsIdx = activeIds.indexOf('settings');
      if (settingsIdx !== -1) {
        activeIds.splice(settingsIdx, 0, id);
      } else {
        activeIds.push(id);
      }
    }
  }
  return activeIds
    .map(id => wm.registeredApps.value[id])
    .filter((app): app is NonNullable<typeof app> => Boolean(app));
});

// Running app IDs (Finder active by default + any open windows)
const runningAppIds = computed(() => {
  const windowAppIds = wm.windows.value.map(w => w.appId);
  return Array.from(new Set(['finder', ...windowAppIds]));
});

const launchpadVisible = ref(false);
// All callers, including Finder and cross-app links, share the same policy.
const openRegisteredApp = wm.openApp;
wm.openApp = (appId, customData) => {
  const app = wm.registeredApps.value[appId];
  if (!app) return null;
  if (!developmentPreview && (!authStore.isAuthenticated || systemStore.isLocked)) return null;
  if (app.category === 'admin' && !authStore.isAdmin && !developmentPreview) return null;
  return openRegisteredApp(appId, customData);
};
watch(() => [authStore.user?.id, authStore.user?.role] as const, ([id, role], [oldId, oldRole]) => {
  if (oldId && (id !== oldId || role !== oldRole)) {
    wm.forceCloseAllWindows();
    launchpadVisible.value = false;
    spotlightVisible.value = false;
    if (!id) systemStore.lock();
  }
});

function launchApp(appId: string, customData?: any) {
  audio.playClick();
  if (appId === 'downloads') appId = 'finder';
  if (!developmentPreview && (!authStore.isAuthenticated || systemStore.isLocked)) return;
  if (appId === 'launchpad') {
    launchpadVisible.value = !launchpadVisible.value;
    return;
  }
  wm.openApp(appId, customData);
}

// Desktop Context Menu
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

function handleContextMenu(e: MouseEvent) {
  // Only trigger if clicking on the desktop itself
  if ((e.target as HTMLElement).closest('.window') || (e.target as HTMLElement).closest('nav') || (e.target as HTMLElement).closest('header')) {
    return;
  }
  contextMenuX.value = Math.min(e.clientX, window.innerWidth - 200);
  contextMenuY.value = Math.min(e.clientY, window.innerHeight - 180);
  contextMenuVisible.value = true;
}

function closeContextMenu() {
  contextMenuVisible.value = false;
}

const wallpapers: WallpaperName[] = ['monaco-f1', 'tahoe', 'tahoe-night', 'sequoia', 'sonoma', 'monterey', 'ventura', ...extraWallpaperIds as WallpaperName[]];
function cycleWallpaper() {
  const index = wallpapers.indexOf(systemStore.wallpaper);
  systemStore.setWallpaper(wallpapers[(index + 1) % wallpapers.length]!);
}

// Global Keyboard Shortcuts
function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const target = e.target instanceof HTMLElement ? e.target : null;
  const isInput = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));

  if (systemStore.isLocked) return;
  if ((e.metaKey || e.ctrlKey) && wm.activeWindow.value) {
    if (e.key.toLowerCase() === 'w') { e.preventDefault(); wm.closeWindow(wm.activeWindow.value.id); return; }
    if (e.key.toLowerCase() === 'm') { e.preventDefault(); wm.minimizeWindow(wm.activeWindow.value.id); return; }
    if (!isInput && e.key.toLowerCase() === 'h') { e.preventDefault(); if (e.altKey) hideOtherWindows(); else wm.minimizeWindow(wm.activeWindow.value.id); return; }
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); launchApp('settings'); return; }
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a' && !isInput) { e.preventDefault(); launchApp('launchpad'); return; }
  // ⌘+Space / Ctrl+Space: Spotlight
  if ((e.metaKey || e.ctrlKey) && e.code === 'Space') {
    e.preventDefault();
    toggleSpotlight();
    return;
  }

  // Spacebar Quick Look (when not typing in form)
  if (!isInput && selectedDesktopItem.value && target?.closest('.desktop-apps') && e.code === 'Space' && !spotlightVisible.value && !systemStore.isLocked) {
    e.preventDefault();
    quickLookVisible.value = !quickLookVisible.value;
    return;
  }

  // Smart Clipboard Paste on Desktop (⌘V)
  if (!isInput && (e.metaKey || e.ctrlKey) && (e.key === 'v' || e.key === 'V') && !systemStore.isLocked) {
    handleDesktopPaste();
  }
}

async function handleDesktopPaste() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    const trimmed = text.trim();

    // If matches voucher pattern
    if (/^SUB2-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/i.test(trimmed)) {
      launchApp('voucher');
    }
    // If matches API key pattern
    else if (trimmed.startsWith('sk-') || trimmed.startsWith('sb-')) {
      launchApp('keychain');
    }
    // If matches JSON configuration
    else if (trimmed.startsWith('{') && trimmed.endsWith('}') && authStore.isAdmin) {
      launchApp('settings');
    }
  } catch {
    // Clipboard permission not granted
  }
}

function handleDesktopClick() { closeContextMenu(); clearDesktopSelection(); }
const draggingFiles = ref(false);
const fileDropNotice = ref('');
let dragDepth = 0;
let dropNoticeTimer: ReturnType<typeof setTimeout> | undefined;
function isFileDrag(event: DragEvent) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
function resetFileDrag() { dragDepth = 0; draggingFiles.value = false; }
function dragFilesEnter(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault(); dragDepth++; draggingFiles.value = true;
}
function dragFilesOver(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = authStore.isAdmin && !systemStore.isLocked ? 'copy' : 'none';
}
function dragFilesLeave(event: DragEvent) { if (isFileDrag(event) && --dragDepth <= 0) resetFileDrag(); }
function dropFiles(event: DragEvent) {
  resetFileDrag();
  if (!isFileDrag(event) || event.defaultPrevented) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  const directory = Array.from(event.dataTransfer?.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory);
  const problem = !authStore.isAdmin || systemStore.isLocked ? '请先以管理员身份登录，再拖入账号文件。'
    : directory ? '请拖入 JSON 文件，暂不支持文件夹。' : validateDesktopFiles(files);
  if (problem) {
    fileDropNotice.value = problem;
    if (dropNoticeTimer) clearTimeout(dropNoticeTimer);
    dropNoticeTimer = setTimeout(() => { fileDropNotice.value = ''; }, 7000);
    return;
  }
  fileDropNotice.value = '';
  launchApp('accounts', { importFiles: files });
}
onMounted(() => {
  window.addEventListener('focus', refreshShopOnReturn);
  document.addEventListener('visibilitychange', refreshShopOnReturn);
  document.addEventListener('dragenter', dragFilesEnter);
  document.addEventListener('dragover', dragFilesOver);
  document.addEventListener('dragleave', dragFilesLeave);
  document.addEventListener('drop', dropFiles);
  document.addEventListener('drop', resetFileDrag, true);
  document.addEventListener('dragend', resetFileDrag);
  window.addEventListener('blur', resetFileDrag);
  window.addEventListener('click', handleDesktopClick);
  window.addEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('admin-compliance-required', handleComplianceRequired);
  if (import.meta.env.DEV) (window as any).__macOS = {
    systemStore,
    authStore,
    wm,
    launchApp,
    toggleSpotlight,
    isBooting
  };

  const target = desktopTarget(new URL(location.href));
  const autoApp = urlParams.get('app') || target?.app;
  if (autoApp) {
    let opened = false;
    watch(() => [authStore.isLoading, authStore.isAuthenticated, systemStore.isLocked, Boolean(wm.registeredApps.value[autoApp])], () => {
      if (opened || authStore.isLoading) return;
      if (!wm.registeredApps.value[autoApp]) return;
      if (!developmentPreview && (!authStore.isAuthenticated || systemStore.isLocked)) return;
      opened = true;
      launchApp(autoApp, target?.data);
    }, { immediate: true });
  }
  let announcementOwner: number | undefined;
  watch(() => [authStore.user?.id, authStore.isAuthenticated, systemStore.isLocked, isBooting.value], async () => {
    if (!authStore.isAuthenticated) { announcementOwner = undefined; return; }
    if (systemStore.isLocked || isBooting.value || announcementOwner === authStore.user?.id) return;
    const owner = authStore.user?.id;
    announcementOwner = owner;
    try {
      const notices = await announcementsAPI.list(true);
      if (authStore.user?.id !== owner || systemStore.isLocked || !authStore.isAuthenticated) return;
      if (notices.some(n => n.notify_mode === 'popup' && !n.read_at)) launchApp('user_announcements');
    } catch { /* The announcements app exposes retry without blocking desktop startup. */ }
  }, { immediate: true });
});

onUnmounted(() => {
  window.removeEventListener('focus', refreshShopOnReturn);
  document.removeEventListener('visibilitychange', refreshShopOnReturn);
  document.removeEventListener('dragenter', dragFilesEnter);
  document.removeEventListener('dragover', dragFilesOver);
  document.removeEventListener('dragleave', dragFilesLeave);
  document.removeEventListener('drop', dropFiles);
  document.removeEventListener('drop', resetFileDrag, true);
  document.removeEventListener('dragend', resetFileDrag);
  window.removeEventListener('blur', resetFileDrag);
  if (dropNoticeTimer) clearTimeout(dropNoticeTimer);
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('click', handleDesktopClick);
  window.removeEventListener('admin-compliance-required', handleComplianceRequired);
});
</script>

<template>
  <div
    class="fixed inset-0 w-full h-full overflow-hidden select-none font-sans"
    @contextmenu.prevent="handleContextMenu"
    @click="clearDesktopSelection"
  >
    <!-- Dedicated Wallpaper Background Layer -->
    <div v-if="draggingFiles" class="fixed inset-3 z-[10000] pointer-events-none rounded-2xl border-2 border-blue-400 bg-blue-500/10 flex items-center justify-center" aria-hidden="true">
      <div class="rounded-2xl bg-white/95 dark:bg-slate-900/95 px-8 py-6 shadow-xl text-center text-[var(--text-primary)]"><strong class="text-lg">{{ authStore.isAdmin && !systemStore.isLocked ? '松开以预览账号文件' : '登录管理员后可导入账号' }}</strong><p class="text-sm mt-2">JSON · 校验与预览后再确认导入</p></div>
    </div>
    <div v-if="fileDropNotice" role="status" class="fixed top-12 left-1/2 -translate-x-1/2 z-[10001] max-w-[90vw] rounded-xl bg-white dark:bg-slate-900 shadow-xl px-5 py-3 text-sm text-[var(--text-primary)]">{{ fileDropNotice }}</div>
    <div class="absolute inset-0 -z-10 pointer-events-none overflow-hidden select-none bg-[#0a192f]">
      <div
        class="w-full h-full bg-cover bg-center transition-opacity duration-500 ease-in-out"
        :style="{
          backgroundImage: `url(/assets/${systemStore.wallpaper}.jpg)`
        }"
      ></div>
    </div>

    <!-- Top System Menubar -->
    <MacMenubar
      :active-app-name="wm.activeAppName.value"
      :workspace-mode="systemStore.workspaceMode"
      :latency="systemStore.latency"
      :connection-status="systemStore.connectionStatus"
      :is-dark="systemStore.isDark"
      :show-background="systemStore.showMenubarBackground"
      :volume="systemStore.volume"
      :brightness="systemStore.brightness"
      :balance="authStore.user?.balance"
      :is-admin="authStore.isAdmin"
      :admin-view-mode="adminViewMode"
      :widgets-visible="systemStore.showDesktopWidgets"
      :open-windows="wm.windows.value"
      :official-console-url="officialConsoleUrl"
      @hide-other-windows="hideOtherWindows"
      @focus-window="wm.focusWindow"
      @show-shortcuts="shortcutsOpen = true"
      @toggle-widgets="systemStore.showDesktopWidgets = !systemStore.showDesktopWidgets"
      @show-all-windows="wm.windows.value.forEach(win => wm.focusWindow(win.id))"
      @toggle-admin-mode="adminViewMode = (adminViewMode === 'all' ? 'user_only' : 'all')"
      @update:volume="val => systemStore.triggerHUD('volume', val)"
      @update:brightness="val => systemStore.triggerHUD('brightness', val)"
      @toggle-theme="systemStore.toggleTheme"
      @lock="systemStore.lock"
      @logout="handleLogout"
      @restart="triggerReboot"
      @shutdown="triggerReboot"
      @minimize-window="wm.activeWindow.value && wm.minimizeWindow(wm.activeWindow.value.id)"
      @maximize-window="wm.activeWindow.value && wm.toggleMaximizeWindow(wm.activeWindow.value.id)"
      @close-window="wm.activeWindow.value && wm.closeWindow(wm.activeWindow.value.id)"
      @open-app="launchApp"
      @open-spotlight="toggleSpotlight"
      @open-about="aboutModalOpen = true"
    />

    <!-- Desktop overview -->
    <MacDesktopWidgets
      v-if="systemStore.showDesktopWidgets"
      :balance="authStore.user?.balance"
      :latency="systemStore.latency"
      @open-app="launchApp"
    />

    <MacDesktopIcons v-if="showDesktopHardDrives && desktopShortcutApps.length"
      :apps="desktopShortcutApps" :selected="selectedDesktopItem" :appearance="systemStore.dockIconTheme"
      @select="id => selectDesktopItem(id)" @launch="launchApp" />

    <!-- Active Windows Layer -->
    <template v-for="win in wm.windows.value" :key="win.id">
      <MacWindow
        :win="win"
        @focus="wm.focusWindow(win.id)"
        @close="wm.closeWindow(win.id)"
        @minimize="wm.minimizeWindow(win.id)"
        @maximize="wm.toggleMaximizeWindow(win.id)"
      >
        <!-- Dynamic App Content Component Injection -->
        <component
          :is="wm.registeredApps.value[win.appId]?.component"
          v-if="wm.registeredApps.value[win.appId]?.component"
          :win="win"
        />
        <div v-else class="flex-1 flex flex-col items-center justify-center p-8 text-[var(--text-tertiary)] bg-[var(--window-bg-solid)]">
          <img :src="win.icon" class="w-16 h-16 object-contain opacity-70 mb-3" alt="" />
          <h3 class="font-semibold text-[15px] text-[var(--text-primary)] mb-1">{{ win.title }}</h3>
          <p class="text-xs">原生应用组件已就绪</p>
        </div>
      </MacWindow>
    </template>

    <!-- Bottom Dock with Cosine Physics Wave -->
    <MacDock
      :apps="dockApps"
      :running-app-ids="runningAppIds"
      :active-app-id="wm.activeWindow.value?.appId"
      :dock-icon-theme="systemStore.dockIconTheme"
      @launch="launchApp"
    />

    <!-- macOS Tahoe 26 Top-Right Capsule Liquid Glass HUD -->
    <MacHUD
      :type="systemStore.hudState.type"
      :value="systemStore.hudState.value"
      :visible="systemStore.hudState.visible"
      @update:visible="val => systemStore.hudState.visible = val"
    />

    <!-- Quick Look Overlay (Spacebar preview) -->
    <div class="desktop-dimmer" :style="{ opacity: (100 - systemStore.brightness) / 100 * 0.7 }" aria-hidden="true"></div>
    <MacQuickLook
      :visible="quickLookVisible"
      @close="quickLookVisible = false"
      @open-app="appId => { quickLookVisible = false; launchApp(appId); }"
    />

    <!-- Spotlight Search Overlay -->
    <MacSpotlight
      :visible="spotlightVisible"
      :apps="availableApps"
      @close="spotlightVisible = false"
      @launch="launchApp"
    />

    <!-- Launchpad Fullscreen Overlay -->
    <MacLaunchpad
      :visible="launchpadVisible"
      :apps="availableApps"
      @close="launchpadVisible = false"
      @launch="launchApp"
    />

    <!-- Desktop Context Menu -->
    <MacContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      @close="closeContextMenu"
      @change-wallpaper="cycleWallpaper"
      @open-app="launchApp"
      @quick-look="quickLookVisible = true"
      @toggle-theme="systemStore.toggleTheme"
      @about="aboutModalOpen = true"
    />

    <!-- macOS Tahoe About This Mac Modal -->
    <MacAboutModal
      :is-open="aboutModalOpen"
      :system-spec="systemStore.systemSpec"
      @close="aboutModalOpen = false"
      @open-settings="launchApp('settings')"
    />

    <!-- Fullscreen Lockscreen Layer -->
    <MacLockscreen
      @restart="triggerReboot"
      @shutdown="triggerReboot"
    />

    <!-- macOS Tahoe Cold Boot Experience -->
    <MacBootScreen
      :is-booting="isBooting"
      @boot-completed="handleBootCompleted"
    />

    <div v-if="shortcutsOpen" class="fixed inset-0 z-[56000]">
      <MacSheet :show="shortcutsOpen" title="键盘快捷键" @close="shortcutsOpen = false">
        <p class="text-xs text-[var(--text-secondary)] mb-4">macOS 使用 ⌘，Windows / Linux 使用 Ctrl。</p>
        <dl class="desktop-shortcuts">
          <div><dt>搜索应用</dt><dd>⌘ / Ctrl + 空格</dd></div>
          <div><dt>关闭当前窗口</dt><dd>⌘ / Ctrl + W</dd></div>
          <div><dt>最小化当前窗口</dt><dd>⌘ / Ctrl + M</dd></div>
          <div><dt>隐藏当前窗口</dt><dd>⌘ / Ctrl + H</dd></div>
          <div><dt>隐藏其他窗口</dt><dd>⌥ / Alt + ⌘ / Ctrl + H</dd></div>
          <div><dt>打开系统设置</dt><dd>⌘ / Ctrl + ,</dd></div>
          <div><dt>打开启动台</dt><dd>⇧ / Shift + ⌘ / Ctrl + A</dd></div>
          <div><dt>关闭弹层</dt><dd>Esc</dd></div>
        </dl>
      </MacSheet>
    </div>
    <AdminComplianceSheet
      :show="complianceVisible"
      :status="complianceStatus"
      :identity="complianceIdentity"
      :status-loading="complianceLoading"
      :status-error="complianceError"
      @retry="checkAdminCompliance"
      @close="closeAdminCompliance"
      @accepted="handleComplianceAccepted"
    />
  </div>
</template>

<style scoped>
.desktop-shortcuts { font-size:12px; }
.desktop-shortcuts > div { display:flex; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid var(--border-subtle); }
.desktop-shortcuts dd { color:var(--text-secondary); text-align:right; }
</style>
