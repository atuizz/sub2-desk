import { version as consoleVersion } from '../../package.json';
import { defineStore } from 'pinia';
import { ref, watch, onScopeDispose } from 'vue';
import { extraWallpaperIds } from '../assets/wallpapers';

export type WallpaperName = 'monaco-f1' | 'tahoe' | 'tahoe-night' | 'sequoia' | 'sonoma' | 'monterey' | 'ventura' | 'galaxy' | 'glass-dawn' | 'glass-midnight' | 'glass-lake' | 'tahoe-hd' | 'tahoe-dark-hd' | 'tahoe-beach-hd';
export type AppearanceMode = 'light' | 'dark' | 'system';
export const ACCENT_COLORS: Record<string, string> = { multicolor: '#007aff', blue: '#007aff', purple: '#9454c9', pink: '#d63272', red: '#d93732', orange: '#bc6500', yellow: '#987400', green: '#248344', graphite: '#626269' };

export interface SystemSpec {
  name: string;
  version: string;
  build: string;
  darwinKernel: string;
  chip: string;
  memory: string;
  model: string;
  serial: string;
}

export const useSystemStore = defineStore('system', () => {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem('sub2-desktop-preferences') || '{}') || {}; } catch { /* use defaults */ }
  const isLocked = ref(true);
  const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
  const appearance = ref<AppearanceMode>(['light', 'dark', 'system'].includes(saved.appearance as string) ? saved.appearance as AppearanceMode : saved.isDark === true ? 'dark' : 'light');
  const isDark = ref(appearance.value === 'system' ? systemAppearance.matches : appearance.value === 'dark');
  const volume = ref(typeof saved.volume === 'number' ? Math.min(100, Math.max(0, saved.volume)) : 35);
  const brightness = ref(typeof saved.brightness === 'number' ? Math.min(100, Math.max(35, saved.brightness)) : 100);
  const accentColor = ref(typeof saved.accentColor === 'string' && Object.prototype.hasOwnProperty.call(ACCENT_COLORS, saved.accentColor) ? saved.accentColor : 'blue');
  const showDesktopWidgets = ref(saved.showDesktopWidgets !== false);
  const wallpaperNames: WallpaperName[] = ['monaco-f1', 'tahoe', 'tahoe-night', 'sequoia', 'sonoma', 'monterey', 'ventura', 'galaxy', ...extraWallpaperIds as WallpaperName[]];
  const wallpaper = ref<WallpaperName>(wallpaperNames.includes(saved.wallpaper as WallpaperName) ? saved.wallpaper as WallpaperName : 'tahoe');
  const workspaceMode = ref<'user' | 'admin'>('user');
  const latency = ref(0);
  const connectionStatus = ref<'unknown' | 'online' | 'offline'>('unknown');

  // macOS Tahoe 26 Specific Appearance States
  const showMenubarBackground = ref(true); // Default to full macOS Tahoe 26 Liquid Glass menubar
  type DockIconTheme = 'default' | 'dark' | 'transparent' | 'tinted';
  const dockThemes: DockIconTheme[] = ['default', 'dark', 'transparent', 'tinted'];
  const dockIconTheme = ref<DockIconTheme>(dockThemes.includes(saved.dockIconTheme as DockIconTheme) ? saved.dockIconTheme as DockIconTheme : 'default');
  const sidebarIconSize = ref<'small' | 'medium' | 'large'>('medium');
  const hudState = ref<{ visible: boolean; type: 'volume' | 'brightness'; value: number }>({
    visible: false,
    type: 'volume',
    value: 75
  });

  function triggerHUD(type: 'volume' | 'brightness', val: number) {
    if (type === 'volume') volume.value = val;
    else brightness.value = val;
    hudState.value = { visible: true, type, value: val };
  }

  const systemSpec: SystemSpec = {
    name: 'Sub2 Desk',
    version: consoleVersion,
    build: 'Web',
    darwinKernel: 'Vue 3 · TypeScript',
    chip: 'Sub2API Compatible Backend',
    memory: '外部 Sub2API 服务',
    model: '浏览器桌面控制台',
    serial: window.location.host
  };

  watch([isDark, appearance, wallpaper, dockIconTheme, volume, brightness, accentColor, showDesktopWidgets], () => {
    document.documentElement.classList.toggle('dark', isDark.value);
    document.documentElement.style.colorScheme = isDark.value ? 'dark' : 'light';
    for (const token of ['--accent', '--color-accent']) document.documentElement.style.setProperty(token, ACCENT_COLORS[accentColor.value] ?? ACCENT_COLORS.blue);
    try { localStorage.setItem('sub2-desktop-preferences', JSON.stringify({ isDark: isDark.value, appearance: appearance.value, wallpaper: wallpaper.value, dockIconTheme: dockIconTheme.value, volume: volume.value, brightness: brightness.value, accentColor: accentColor.value, showDesktopWidgets: showDesktopWidgets.value })); } catch { /* storage may be unavailable */ }
  }, { immediate: true, flush: 'sync' });

  function setAppearance(mode: AppearanceMode) {
    appearance.value = mode;
    isDark.value = mode === 'system' ? systemAppearance.matches : mode === 'dark';
    if (wallpaper.value === 'tahoe' && isDark.value) wallpaper.value = 'tahoe-night';
    else if (wallpaper.value === 'tahoe-night' && !isDark.value) wallpaper.value = 'tahoe';
  }
  function onSystemAppearanceChange() { if (appearance.value === 'system') setAppearance('system'); }
  systemAppearance.addEventListener('change', onSystemAppearanceChange);
  onScopeDispose(() => systemAppearance.removeEventListener('change', onSystemAppearanceChange));

  function unlock() {
    isLocked.value = false;
  }

  function lock() {
    isLocked.value = true;
  }

  function toggleTheme() {
    setAppearance(isDark.value ? 'light' : 'dark');
  }

  function setWorkspaceMode(mode: 'user' | 'admin') {
    workspaceMode.value = mode;
  }

  function setWallpaper(wp: WallpaperName) {
    wallpaper.value = wp;
  }

  return {
    isLocked,
    isDark,
    appearance,
    setAppearance,
    accentColor,
    showDesktopWidgets,
    volume,
    brightness,
    wallpaper,
    workspaceMode,
    latency,
    connectionStatus,
    showMenubarBackground,
    dockIconTheme,
    sidebarIconSize,
    hudState,
    triggerHUD,
    systemSpec,
    unlock,
    lock,
    toggleTheme,
    setWorkspaceMode,
    setWallpaper
  };
});
