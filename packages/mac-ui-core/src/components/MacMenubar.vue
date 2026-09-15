<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import MacControlCenter from './MacControlCenter.vue';
import MacMenubarGlass from './MacMenubarGlass.vue';

const props = withDefaults(
  defineProps<{
    activeAppName?: string;
    workspaceMode?: 'user' | 'admin';
    latency?: number;
    connectionStatus?: 'unknown' | 'online' | 'offline';
    isDark?: boolean;
    showBackground?: boolean;
    volume?: number;
    brightness?: number;
    balance?: number;
    isAdmin?: boolean;
    adminViewMode?: 'all' | 'user_only';
    widgetsVisible?: boolean;
    openWindows?: { id: string; title: string; isFocused: boolean; isMinimized: boolean }[];
    officialConsoleUrl?: string;
  }>(),
  {
    activeAppName: '访达',
    workspaceMode: 'user',
    latency: 0,
    connectionStatus: 'unknown',
    isDark: false,
    showBackground: true,
    volume: 75,
    brightness: 85,

    isAdmin: false,
    adminViewMode: 'all',
    widgetsVisible: true,
    openWindows: () => []
  }
);

const emit = defineEmits<{
  (e: 'toggleTheme'): void;
  (e: 'toggleWidgets'): void;
  (e: 'showAllWindows'): void;
  (e: 'toggleMode'): void;
  (e: 'toggleAdminMode'): void;
  (e: 'openSpotlight'): void;
  (e: 'openControlCenter'): void;
  (e: 'lock'): void;
  (e: 'logout'): void;
  (e: 'restart'): void;
  (e: 'shutdown'): void;
  (e: 'openAbout'): void;
  (e: 'openApp', appId: string): void;
  (e: 'minimizeWindow'): void;
  (e: 'maximizeWindow'): void;
  (e: 'closeWindow'): void;
  (e: 'hideOtherWindows'): void;
  (e: 'focusWindow', id: string): void;
  (e: 'showShortcuts'): void;
  (e: 'update:volume', val: number): void;
  (e: 'update:brightness', val: number): void;
}>();

const clockText = ref('');
let timer: any = null;

function updateClock() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const day = dayNames[now.getDay()];
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  clockText.value = `${month}月${date}日 ${day} ${hours}:${minutes}`;
}

const activeMenu = ref<string | null>(null);
const editFeedback = ref('');
let editingTarget: HTMLInputElement | HTMLTextAreaElement | null = null;
let editingSelection: [number | null, number | null] = [null, null];
function rememberEditingTarget() {
  const el = document.activeElement;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    editingTarget = el;
    editingSelection = [el.selectionStart, el.selectionEnd];
  }
}
async function edit(command: 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll') {
  if (!editingTarget?.isConnected) { editFeedback.value = '请先选择要编辑的输入框'; return; }
  editingTarget.focus();
  if (editingSelection[0] !== null && editingSelection[1] !== null) editingTarget.setSelectionRange(...editingSelection as [number, number]);
  try {
    if (command === 'paste') {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
    } else if (command === 'selectAll') editingTarget.select();
    else if (!document.execCommand(command)) { editFeedback.value = '请使用对应键盘快捷键'; return; }
    closeMenu();
  } catch { editFeedback.value = '浏览器限制此操作，请使用键盘快捷键'; }
}

function toggleMenu(menu: string) {
  editFeedback.value = '';
  activeMenu.value = activeMenu.value === menu ? null : menu;
}

function handleMenuHover(menu: string) {
  if (activeMenu.value !== null && activeMenu.value !== 'control-center') {
    activeMenu.value = menu;
  }
}

function closeMenu() {
  activeMenu.value = null;
}
function handleMenuKey(event: KeyboardEvent) {
  if (activeMenu.value && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
  }
}

// Control Center interactive sliders
const displayBrightness = ref(85);
const soundVolume = ref(75);

onMounted(() => {
  updateClock();
  timer = setInterval(updateClock, 1000);
  window.addEventListener('click', closeMenu);
  window.addEventListener('keydown', handleMenuKey);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
  window.removeEventListener('click', closeMenu);
  window.removeEventListener('keydown', handleMenuKey);
});
</script>

<template>
  <header
    @pointerdown.capture="rememberEditingTarget"
    class="mac-menubar fixed top-0 left-0 right-0 h-[28px] px-2 sm:px-3 flex items-center justify-between text-[13px] z-[50000] select-none transition-colors duration-200 overflow-visible whitespace-nowrap text-white"
    :style="showBackground ? {
      background: 'transparent',
      borderBottom: '0.5px solid var(--material-menubar-border)',
      boxShadow: 'var(--shadow-menubar)'
    } : {
      background: 'transparent'
    }"
  >
    <MacMenubarGlass v-if="showBackground" />
    <!-- Left App Menus -->
    <div class="flex items-center h-full">
      <!--  Apple Menu -->
      <div class="relative h-full flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'apple' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          aria-label="Sub2-Mac 菜单" @click.stop="toggleMenu('apple')"
          @mouseenter="handleMenuHover('apple')"
        >
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 32 32">
            <path d="M8 4h16a4 4 0 0 1 4 4v4h-5V9H9v5h14a5 5 0 0 1 5 5v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4h5v3h14v-5H9a5 5 0 0 1-5-5V8a4 4 0 0 1 4-4Z"/>
          </svg>
        </button>

        <!-- Apple Dropdown -->
        <div
          v-if="activeMenu === 'apple'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-56 py-1.5 rounded-[12px] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('openAbout'); closeMenu()">
            <span>关于 Sub2-Mac...</span>
          </button>
          <button class="menu-item" @click="emit('openApp', 'dashboard'); closeMenu()">
            <span>仪表盘...</span>
          </button>
          <a v-if="officialConsoleUrl" class="menu-item" :href="officialConsoleUrl" target="_blank" rel="noopener noreferrer" @click="closeMenu()"><span>原版完整控制台 ↗</span></a>
          <div class="menu-separator"></div>
          <template v-if="isAdmin">
            <button class="menu-item" @click="emit('openApp', 'ops'); closeMenu()">
              <span>运维监控...</span>
            </button>
          </template>
          <button class="menu-item" @click="emit('openApp', 'settings'); closeMenu()">
            <span>系统设置...</span>
          </button>
          <button class="menu-item" @click="emit('openApp', 'appstore'); closeMenu()">
            <span>模型广场...</span>
          </button>
          <button class="menu-item" @click="emit('openApp', 'keychain'); closeMenu()">
            <span>API 密钥...</span>
          </button>
          <div class="menu-separator"></div>
          <template v-if="isAdmin">
            <button class="menu-item" @click="emit('toggleAdminMode'); closeMenu()">
              <span>{{ adminViewMode === 'all' ? '切换为：普通用户视图' : '切换为：管理员全量视图' }}</span>
              <span class="menu-shortcut">⌥⌘A</span>
            </button>
            <div class="menu-separator"></div>
          </template>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('restart'); closeMenu()">
            <span>重新载入桌面...</span>
          </button>

          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('lock'); closeMenu()">
            <span>锁定屏幕</span>
            <span class="menu-shortcut">⌃⌘Q</span>
          </button>
          <button class="menu-item" @click="emit('logout'); closeMenu()">
            <span>退出登录...</span>
            <span class="menu-shortcut">⇧⌘Q</span>
          </button>
        </div>
      </div>

      <!-- Active App Menu (Bold) -->
      <div class="relative h-full flex items-center">
        <button
          class="px-2.5 h-[22px] rounded-[var(--radius-xs)] font-bold text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'app' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('app')"
          @mouseenter="handleMenuHover('app')"
        >
          {{ activeAppName }}
        </button>

        <div
          v-if="activeMenu === 'app'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-52 py-1.5 rounded-[12px] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('openAbout'); closeMenu()">
            <span>关于 {{ activeAppName }}</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('openApp', 'settings'); closeMenu()">
            <span>设置...</span>
            <span class="menu-shortcut">⌘,</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('minimizeWindow'); closeMenu()">
            <span>隐藏 {{ activeAppName }}</span>
            <span class="menu-shortcut">⌘H</span>
          </button>
          <button class="menu-item" @click="emit('hideOtherWindows'); closeMenu()">
            <span>隐藏其他</span>
            <span class="menu-shortcut">⌥⌘H</span>
          </button>
          <button class="menu-item" @click="emit('showAllWindows'); closeMenu()">
            <span>全部显示</span>
          </button>
        </div>
      </div>

      <!-- File Menu -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'file' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('file')"
          @mouseenter="handleMenuHover('file')"
        >
          文件
        </button>

        <div
          v-if="activeMenu === 'file'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-48 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('openApp', 'finder'); closeMenu()">
            <span>打开访达</span>
            <span class="menu-shortcut">⌘N</span>
          </button>
          <button class="menu-item" @click="emit('openApp', 'terminal'); closeMenu()">
            <span>打开终端</span>
            <span class="menu-shortcut">⌘T</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('closeWindow'); closeMenu()">
            <span>关闭当前窗口</span>
            <span class="menu-shortcut">⌘W</span>
          </button>
        </div>
      </div>

      <!-- Edit Menu -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'edit' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('edit')"
          @mouseenter="handleMenuHover('edit')"
        >
          编辑
        </button>

        <div
          v-if="activeMenu === 'edit'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-44 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="edit('undo')">
            <span>撤销</span>
            <span class="menu-shortcut">⌘Z</span>
          </button>
          <button class="menu-item" @click="edit('redo')">
            <span>重做</span>
            <span class="menu-shortcut">⇧⌘Z</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="edit('cut')">
            <span>剪切</span>
            <span class="menu-shortcut">⌘X</span>
          </button>
          <button class="menu-item" @click="edit('copy')">
            <span>拷贝</span>
            <span class="menu-shortcut">⌘C</span>
          </button>
          <button class="menu-item" @click="edit('paste')">
            <span>粘贴</span>
            <span class="menu-shortcut">⌘V</span>
          </button>
          <button class="menu-item" @click="edit('selectAll')">
            <span>全选</span>
            <span class="menu-shortcut">⌘A</span>
          </button>
          <p v-if="editFeedback" role="status" class="px-3 py-2 text-xs text-[var(--text-secondary)] whitespace-normal">{{ editFeedback }}</p>
        </div>
      </div>

      <!-- View Menu -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'view' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('view')"
          @mouseenter="handleMenuHover('view')"
        >
          显示
        </button>

        <div
          v-if="activeMenu === 'view'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-48 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('toggleTheme'); closeMenu()">
            <span>切换外观 (深/浅)</span>
            <span class="menu-shortcut">⌘D</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('maximizeWindow'); closeMenu()">
            <span>最大化 / 还原</span>
            <span class="menu-shortcut">⌃⌘F</span>
          </button>
        </div>
      </div>

      <!-- Go Menu (前往) -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'go' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('go')"
          @mouseenter="handleMenuHover('go')"
        >
          前往
        </button>

        <div
          v-if="activeMenu === 'go'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-52 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('openApp', 'finder'); closeMenu()"><span>所有应用</span><span class="menu-shortcut">⇧⌘A</span></button>
          <button class="menu-item" @click="emit('openApp', 'activity'); closeMenu()"><span>使用记录</span></button>
          <button class="menu-item" @click="emit('openApp', 'keychain'); closeMenu()"><span>API 密钥</span></button>
          <button class="menu-item" @click="emit('openApp', 'network'); closeMenu()"><span>可用渠道</span></button>
          <button class="menu-item" @click="emit('openApp', 'settings'); closeMenu()"><span>系统设置</span><span class="menu-shortcut">⌘,</span></button>
        </div>
      </div>

      <!-- Window Menu -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'window' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('window')"
          @mouseenter="handleMenuHover('window')"
        >
          窗口
        </button>

        <div
          v-if="activeMenu === 'window'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-48 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('minimizeWindow'); closeMenu()">
            <span>最小化</span>
            <span class="menu-shortcut">⌘M</span>
          </button>
          <button class="menu-item" @click="emit('maximizeWindow'); closeMenu()">
            <span>缩放</span>
          </button>
          <div class="menu-separator"></div>
          <button class="menu-item" @click="emit('showAllWindows'); closeMenu()">
            <span>前置全部窗口</span>
          </button>
          <div v-if="openWindows.length" class="menu-separator"></div>
          <button v-for="win in openWindows" :key="win.id" class="menu-item" @click="emit('focusWindow', win.id); closeMenu()"><span>{{ win.isFocused ? '✓ ' : '' }}{{ win.title }}</span><span v-if="win.isMinimized" class="menu-shortcut">已最小化</span></button>
        </div>
      </div>

      <!-- Help Menu -->
      <div class="relative h-full hidden sm:flex items-center">
        <button
          class="px-2 h-[22px] rounded-[var(--radius-xs)] text-[13px] flex items-center transition-all focus:outline-none"
          :class="activeMenu === 'help' ? 'bg-white/25' : 'hover:bg-white/15 active:bg-white/25'"
          @click.stop="toggleMenu('help')"
          @mouseenter="handleMenuHover('help')"
        >
          帮助
        </button>

        <div
          v-if="activeMenu === 'help'"
          class="menu-dropdown liquid-glass-dropdown absolute top-[28px] left-0 w-52 py-1.5 rounded-[var(--radius-md)] text-[13px] text-[var(--text-primary)] z-[50001]"
          @click.stop
        >
          <button class="menu-item" @click="emit('openApp', 'safari'); closeMenu()">
            <span>Sub2API 帮助文档</span>
          </button>
          <a v-if="officialConsoleUrl" class="menu-item" :href="officialConsoleUrl" target="_blank" rel="noopener noreferrer" @click="closeMenu()"><span>原版完整控制台 ↗</span></a>
          <button class="menu-item" @click="emit('showShortcuts'); closeMenu()">
            <span>macOS 键盘快捷键</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Right Tray Section -->
    <div class="flex items-center gap-1 sm:gap-2 text-xs text-white shrink-0">
      <!-- Relay Latency Pill -->
      <button type="button"
        class="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-white/25 bg-white/15 text-white text-[11px] font-medium backdrop-blur-md shadow-xs transition-colors hover:bg-white/25 cursor-pointer"
        title="后端连接 · 点击查看可用渠道"
        aria-label="后端连接，查看可用渠道"
        @click="emit('openApp', 'network')"
      >
        <span class="w-1.5 h-1.5 rounded-full" :class="connectionStatus === 'online' ? 'bg-emerald-300' : connectionStatus === 'offline' ? 'bg-amber-300' : 'bg-white/50'"></span>
        <span>{{ connectionStatus === 'offline' ? '连接中断' : latency > 0 ? latency + ' ms' : '等待连接' }}</span>
      </button>

      <!-- Anycast Gateway Health Icon -->
      <button type="button"
        class="hidden lg:block px-1.5 py-0.5 cursor-pointer rounded-[var(--radius-xs)] text-white hover:bg-white/15 transition-colors" 
        title="查看后端连接"
        aria-label="查看后端连接"
        @click="emit('openApp', 'network')"
      >
        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>
      </button>

      <!-- Sub2API Account Balance Pill (Replaced generic laptop battery) -->
      <button type="button"
        class="hidden sm:flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-white/25 bg-white/15 text-white text-[11px] font-medium backdrop-blur-md shadow-xs cursor-pointer hover:bg-white/25 transition-colors" 
        title="当前账户可用额度 · 点击打开钱包充值"
        :aria-label="typeof balance === 'number' ? `账户余额 ${balance.toFixed(2)} 美元，打开钱包` : '账户余额暂不可用，打开钱包'"
        @click="emit('openApp', 'wallet')"
      >
        <span class="font-mono font-semibold">{{ typeof balance === 'number' ? '$' + balance.toFixed(2) : '—' }}</span>
      </button>

      <!-- Apple Intelligence / Tahoe Siri Orb -->
      <button type="button"
        class="hidden sm:flex w-4 h-4 rounded-full tahoe-siri-orb flex items-center justify-center p-[2px] cursor-pointer hover:scale-110 transition-transform shadow-[0_0_8px_rgba(43,108,255,0.4)]"
        title="搜索应用"
        aria-label="搜索应用"
        @click.stop="emit('openSpotlight')"
      >
        <span class="w-full h-full rounded-full bg-white/80 dark:bg-black/60 backdrop-blur-xs flex items-center justify-center" aria-hidden="true">
          <span class="w-1.5 h-1.5 rounded-full bg-sky-400 shadow-xs"></span>
        </span>
      </button>

      <!-- macOS Tahoe Control Center Toggle -->
      <div class="relative">
        <button
          class="px-1.5 py-1 rounded-[var(--radius-xs)] text-white hover:bg-white/15 transition-colors focus:outline-none flex items-center"
          :class="activeMenu === 'control-center' ? 'bg-white/25' : ''"
          title="控制中心"
          @click.stop="toggleMenu('control-center')"
        >
          <!-- Authentic macOS Control Center Sliders Icon -->
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="7" rx="3.5" />
            <circle cx="16" cy="7.5" r="2" fill="currentColor" />
            <rect x="2" y="13" width="20" height="7" rx="3.5" />
            <circle cx="8" cy="16.5" r="2" fill="currentColor" />
          </svg>
        </button>

        <MacControlCenter
          :model-value="activeMenu === 'control-center'"
          :volume="volume"
          :brightness="brightness"
          :is-dark="isDark"
          :connection-status="connectionStatus"
          :latency="latency"
          :widgets-visible="widgetsVisible"
          @update:model-value="(val: boolean) => { if (!val) closeMenu(); }"
          @toggle-theme="emit('toggleTheme')"
          @toggle-widgets="emit('toggleWidgets')"
          @open-app="(id: string) => emit('openApp', id)"
          @lock="emit('lock')"
          @update:volume="(val: number) => emit('update:volume', val)"
          @update:brightness="(val: number) => emit('update:brightness', val)"
          @click.stop
        />
      </div>

      <!-- Live Clock -->
      <div class="font-medium text-[12.5px] cursor-default px-1.5 py-0.5 rounded-[var(--radius-xs)] text-white hover:bg-white/15 transition-colors">
        {{ clockText }}
      </div>
    </div>
  </header>
</template>

<style scoped>
header button:focus-visible, header a:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
@media (max-width: 640px) { header > div:first-child { min-width: 0; } header > div:first-child > div:nth-child(2) { max-width: 110px; overflow: hidden; } }
.menu-dropdown {
  animation: menuFadeIn 0.12s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes menuFadeIn {
  from {
    opacity: 0;
    transform: translateY(-4px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.menu-item {
  width: 100%;
  padding: 4px 10px;
  text-align: left;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: var(--radius-sm);
  margin: 1px 0;
  transition: background-color 0.1s ease, color 0.1s ease;
  font-size: 13px;
  cursor: default;
}

.menu-item:hover {
  background: var(--accent);
  color: white;
}

.menu-separator {
  margin: 4px 6px;
  border-bottom: 0.5px solid rgba(0, 0, 0, 0.1);
}

.dark .menu-separator {
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.12);
}

.menu-shortcut {
  font-size: 11px;
  opacity: 0.65;
  font-family: var(--font-mono);
}

.menu-item:hover .menu-shortcut {
  opacity: 0.9;
  color: white;
}
</style>
