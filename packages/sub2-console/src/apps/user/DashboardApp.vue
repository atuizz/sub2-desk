<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import './app-polish.css';
import { MacSegmented, useWindowManager, type WindowInstance } from '@sub2-mac/core';
import { useAuthStore } from '../../stores/auth';
import { useSystemStore } from '../../stores/system';
import {
  usageAPI,
  type UserDashboardStats,
  type PlatformDashboardStats
} from '../../api/usage';
import { dashboardAPI as adminDashboardAPI } from '../../api/admin/dashboard';
import { getMyPlatformQuotas } from '../../api/user';
import type {
  TrendDataPoint,
  ModelStat,
  UsageLog,
  PlatformQuotaItem,
  DashboardStats
} from '../../types';
import {
  formatBalance,
  formatCost,
  formatTokens,
  formatNumber,
  formatDuration,
  formatDateTime,
  formatDateLocalInput
} from '../../utils/format';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Doughnut, Line } from 'vue-chartjs';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const props = defineProps<{
  win?: WindowInstance;
}>();

const wm = useWindowManager();
const authStore = useAuthStore();
const systemStore = useSystemStore();

// View Mode: 'platform' (Admin Platform Overview) vs 'personal' (Developer Center)
const viewMode = ref<'platform' | 'personal'>(authStore.isAdmin ? 'platform' : 'personal');

const personalChartView = ref('trend');
const loading = ref(true);
const statsError = ref('');
const chartError = ref('');
const recentError = ref('');
const loadingCharts = ref(false);
const loadingUsage = ref(false);
const contentRef = ref<HTMLElement | null>(null);
const initialPositionRestored = ref(false);
let restoreFrame: number | null = null;
let disposed = false;
let statsVersion = 0, chartVersion = 0, recentVersion = 0;

function restoreDashboardPosition() {
  const element = contentRef.value;
  if (!element) return;
  initialPositionRestored.value = true;
  element.scrollTop = 0;
  element.scrollLeft = 0;
}

function scheduleDashboardPositionRestore() {
  nextTick(() => {
    restoreDashboardPosition();
    if (typeof window === 'undefined') return;
    if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
    restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = null;
      restoreDashboardPosition();
    });
  });
}

// User Personal State
const userStats = ref<UserDashboardStats | null>(null);
const userTrendData = ref<TrendDataPoint[]>([]);
const userModelStats = ref<ModelStat[]>([]);
const recentUsage = ref<UsageLog[]>([]);
const platformQuotas = ref<PlatformQuotaItem[]>([]);

// Admin Platform State
const adminStats = ref<DashboardStats | null>(null);
const adminRealtime = ref<{
  active_requests: number;
  requests_per_minute: number;
  average_response_time: number;
  error_rate: number;
} | null>(null);
const adminTrendData = ref<TrendDataPoint[]>([]);
const adminModelStats = ref<ModelStat[]>([]);

// Time range filter (default: last 7 days)
const datePreset = ref<'7d' | '30d' | '90d' | 'custom'>('7d');
const startDate = ref(formatDateLocalInput(new Date(Date.now() - 6 * 86400000)));
const endDate = ref(formatDateLocalInput(new Date()));
const granularity = ref<'day' | 'hour'>('day');

function selectPreset(preset: '7d' | '30d' | '90d') {
  datePreset.value = preset;
  const days = preset === '7d' ? 6 : preset === '30d' ? 29 : 89;
  startDate.value = formatDateLocalInput(new Date(Date.now() - days * 86400000));
  endDate.value = formatDateLocalInput(new Date());
  loadCharts();
}

async function loadStats() {
  const version = ++statsVersion;
  loading.value = true;
  statsError.value = '';
  try {
    if (viewMode.value === 'platform' && authStore.isAdmin) {
      const [statsData, realtimeData] = await Promise.allSettled([
        adminDashboardAPI.getStats(),
        adminDashboardAPI.getRealtimeMetrics()
      ]);
      if (disposed || version !== statsVersion) return;
      if (statsData.status === 'fulfilled') {
        adminStats.value = statsData.value;
      } else { statsError.value = '运营统计加载失败，请重试。'; }
      if (realtimeData.status === 'fulfilled') {
        adminRealtime.value = realtimeData.value;
      } else { statsError.value += ' 实时指标暂时无法读取。'; }
    } else {
      const data = await usageAPI.getDashboardStats();
      if (disposed || version !== statsVersion) return;
      userStats.value = data;
    }
  } catch (error) {
    if (disposed || version !== statsVersion) return;
    statsError.value = '概览暂时无法加载，请检查连接后重试。';
    console.error('Failed to load dashboard stats:', error);
  } finally {
    if (!disposed && version === statsVersion) loading.value = false;
  }
}

async function loadCharts() {
  const version = ++chartVersion;
  loadingCharts.value = true;
  chartError.value = '';
  try {
    if (viewMode.value === 'platform' && authStore.isAdmin) {
      const [trendRes, modelRes] = await Promise.all([
        adminDashboardAPI.getUsageTrend({
          start_date: startDate.value,
          end_date: endDate.value,
          granularity: granularity.value
        }),
        adminDashboardAPI.getModelStats({
          start_date: startDate.value,
          end_date: endDate.value
        })
      ]);
      if (disposed || version !== chartVersion) return;
      adminTrendData.value = trendRes.trend || [];
      adminModelStats.value = modelRes.models || [];
    } else {
      const [trendRes, modelRes] = await Promise.all([
        usageAPI.getDashboardTrend({
          start_date: startDate.value,
          end_date: endDate.value,
          granularity: granularity.value
        }),
        usageAPI.getDashboardModels({
          start_date: startDate.value,
          end_date: endDate.value
        })
      ]);
      if (disposed || version !== chartVersion) return;
      userTrendData.value = trendRes.trend || [];
      userModelStats.value = modelRes.models || [];
    }
  } catch (error) {
    if (disposed || version !== chartVersion) return;
    chartError.value = '图表更新失败，当前显示上次已加载的数据。';
    console.error('Failed to load charts:', error);
  } finally {
    if (!disposed && version === chartVersion) loadingCharts.value = false;
  }
}

async function loadRecent() {
  const version = ++recentVersion;
  if (viewMode.value === 'personal' || !authStore.isAdmin) {
    loadingUsage.value = true;
    recentError.value = '';
    try {
      const res = await usageAPI.getByDateRange(startDate.value, endDate.value);
      if (disposed || version !== recentVersion) return;
      recentUsage.value = res.items ? res.items.slice(0, 5) : [];
    } catch (error) {
      if (disposed || version !== recentVersion) return;
      recentError.value = '最近使用记录加载失败。';
      console.error('Failed to load recent usage:', error);
    } finally {
      if (!disposed && version === recentVersion) loadingUsage.value = false;
    }
  }
}

async function loadPlatformQuotas() {
  if (viewMode.value === 'personal' || !authStore.isAdmin) {
    try {
      const data = await getMyPlatformQuotas();
      platformQuotas.value = data.platform_quotas || [];
    } catch {
      platformQuotas.value = [];
    }
  }
}

function refreshAll() {
  loadStats();
  loadCharts();
  loadRecent();
  loadPlatformQuotas();
}

function switchViewMode(mode: 'platform' | 'personal') {
  if (viewMode.value === mode) return;
  viewMode.value = mode;
  refreshAll();
}

function openApp(appId: string) {
  wm?.openApp(appId);
}

// Chart.js Computed Configurations
const isDark = computed(() => systemStore.isDark);

const currentModelStats = computed<ModelStat[]>(() => {
  return viewMode.value === 'platform' && authStore.isAdmin
    ? adminModelStats.value
    : userModelStats.value;
});

const currentTrendData = computed<TrendDataPoint[]>(() => {
  return viewMode.value === 'platform' && authStore.isAdmin
    ? adminTrendData.value
    : userTrendData.value;
});

const doughnutData = computed(() => {
  if (!currentModelStats.value || currentModelStats.value.length === 0) return null;
  const labels = currentModelStats.value.map((m: ModelStat) => m.model);
  const data = currentModelStats.value.map((m: ModelStat) => m.total_tokens);
  const colors = [
    '#007aff', '#34c759', '#ff9500', '#ff3b30',
    '#af52de', '#ff2d55', '#00c7be', '#5856d6'
  ];
  return {
    labels,
    datasets: [{
      data,
      backgroundColor: colors.slice(0, labels.length),
      borderWidth: 0,
      hoverOffset: 6
    }]
  };
});

const doughnutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: isDark.value ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
      titleColor: isDark.value ? '#f5f5f7' : '#1d1d1f',
      bodyColor: isDark.value ? '#f5f5f7' : '#1d1d1f',
      borderColor: isDark.value ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      callbacks: {
        label: (context: any) => ` ${context.label}: ${formatTokens(context.parsed)} tokens`
      }
    }
  },
  cutout: '68%'
}));

const lineChartData = computed(() => {
  if (!currentTrendData.value || currentTrendData.value.length === 0) return null;
  return {
    labels: currentTrendData.value.map((d: TrendDataPoint) => d.date),
    datasets: [
      {
        label: 'Input',
        data: currentTrendData.value.map((d: TrendDataPoint) => d.input_tokens),
        borderColor: '#007aff',
        backgroundColor: '#007aff18',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      },
      {
        label: 'Output',
        data: currentTrendData.value.map((d: TrendDataPoint) => d.output_tokens),
        borderColor: '#34c759',
        backgroundColor: '#34c75918',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      },
      {
        label: 'Cache Creation',
        data: currentTrendData.value.map((d: TrendDataPoint) => d.cache_creation_tokens),
        borderColor: '#ff9500',
        backgroundColor: '#ff950018',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      },
      {
        label: 'Cache Read',
        data: currentTrendData.value.map((d: TrendDataPoint) => d.cache_read_tokens),
        borderColor: '#00c7be',
        backgroundColor: '#00c7be18',
        fill: true,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 2
      }
    ]
  };
});

const lineOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    intersect: false,
    mode: 'index' as const
  },
  scales: {
    x: {
      grid: {
        color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
      },
      ticks: {
        color: isDark.value ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
        font: { size: 10 }
      }
    },
    y: {
      grid: {
        color: isDark.value ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
      },
      ticks: {
        color: isDark.value ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
        font: { size: 10 },
        callback: (val: any) => formatTokens(val)
      }
    }
  },
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: isDark.value ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
        usePointStyle: true,
        pointStyle: 'circle',
        padding: 12,
        font: { size: 11 }
      }
    },
    tooltip: {
      backgroundColor: isDark.value ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)',
      titleColor: isDark.value ? '#f5f5f7' : '#1d1d1f',
      bodyColor: isDark.value ? '#f5f5f7' : '#1d1d1f',
      borderColor: isDark.value ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
      borderWidth: 1
    }
  }
}));

const platformCards = computed<PlatformDashboardStats[]>(() => {
  return userStats.value?.by_platform || [];
});

// Missing and non-finite statistics are unavailable, not zero or a healthy 100%.
function isAvailableStat(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function displayStat(
  value: unknown,
  formatter: (value: number) => string = String,
  prefix = '',
  suffix = ''
): string {
  return isAvailableStat(value) ? `${prefix}${formatter(value)}${suffix}` : '—';
}

function displayPercent(value: unknown, digits: number, trimZero = false): string {
  return displayStat(value, n => trimZero ? String(Number(n.toFixed(digits))) : n.toFixed(digits), '', '%');
}

const displayNumber = (value: unknown) => displayStat(value, formatNumber);
const displayTokens = (value: unknown) => displayStat(value, formatTokens);
const displayDuration = (value: unknown) => displayStat(value, formatDuration);
const displayCost = (value: unknown) => displayStat(value, formatCost, '$');
const displayBalance = (value: unknown) => displayStat(value, formatBalance, '$');

const poolHealthRate = computed(() => {
  const total = adminStats.value?.total_accounts;
  const normal = adminStats.value?.normal_accounts;
  if (!isAvailableStat(total) || total === 0 || !isAvailableStat(normal)) return null;
  const rate = (normal / total) * 100;
  return isAvailableStat(rate) ? rate : null;
});

const grossMargin = computed(() => {
  const revenue = adminStats.value?.total_actual_cost;
  const cost = adminStats.value?.total_account_cost;
  if (!isAvailableStat(revenue) || revenue === 0 || !isAvailableStat(cost)) return null;
  const margin = ((revenue - cost) / revenue) * 100;
  return isAvailableStat(margin) ? margin : null;
});

const abnormalAccountCount = computed(() => {
  const counts = [
    adminStats.value?.error_accounts,
    adminStats.value?.ratelimit_accounts,
    adminStats.value?.overload_accounts
  ];
  if (!counts.every(isAvailableStat)) return null;
  return counts.reduce((sum, value) => sum + value, 0);
});

onMounted(() => {
  scheduleDashboardPositionRestore();
  refreshAll();
});

watch([loading, userStats, adminStats], () => {
  scheduleDashboardPositionRestore();
}, { flush: 'post' });

watch(() => [props.win?.focusRevision, props.win?.isFocused, props.win?.isMinimized] as const,
  ([, focused, minimized]) => {
    if (focused && !minimized) scheduleDashboardPositionRestore();
  }, { flush: 'post' });

watch(viewMode, scheduleDashboardPositionRestore);

onUnmounted(() => {
  disposed = true;
  if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
  restoreFrame = null;
});
</script>

<template>
  <div class="user-app-polish dashboard-app h-full flex flex-col bg-[#f5f5f7] dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] select-none overflow-hidden font-sans" :class="{ 'dashboard-personal': viewMode === 'personal' }">
    <!-- macOS Tahoe Navigation & Filter Bar -->
    <div class="app-toolbar h-13 px-5 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between bg-white/70 dark:bg-[#252527]/70 backdrop-blur-xl shrink-0 gap-4">
      <!-- Title & Icon -->
      <div class="flex items-center gap-3 min-w-0">
        <img :src="getAppIcon('dashboard')" class="w-8 h-8 rounded-xl drop-shadow-md shrink-0" alt="Dashboard" />
        <div>
          <div class="flex items-center gap-2">
            <h1 class="text-sm font-semibold tracking-tight text-black/90 dark:text-white/90">
              {{ viewMode === 'platform' ? '平台运营总览' : '开发者中心' }}
            </h1>
            <span
              v-if="authStore.isAdmin && viewMode === 'platform'"
              class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#007aff]/10 text-[#007aff] dark:bg-[#007aff]/20 dark:text-[#38bdf8] border border-[#007aff]/20"
            >
              全站集群
            </span>
          </div>
          <p class="text-[11px] text-black/45 dark:text-white/45 truncate">
            {{ viewMode === 'platform' ? 'Sub2API 集群运行状况与业务统计' : '欢迎回来！这是您个人账户与 API 的用量概览。' }}
          </p>
        </div>
      </div>

      <!-- Segmented Control for Admin (Platform vs Personal) -->
      <div v-if="authStore.isAdmin" class="app-filterbar flex items-center p-0.5 rounded-[9px] bg-black/[0.06] dark:bg-white/[0.08] border border-black/[0.04] dark:border-white/[0.06] text-xs shadow-inner shrink-0">
        <button
          class="px-3.5 py-1 rounded-[7px] text-[12px] font-medium flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
          :class="viewMode === 'platform' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="switchViewMode('platform')"
        >
          <svg class="w-3.5 h-3.5 text-blue-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
          <span class="whitespace-nowrap">平台运营总览</span>
        </button>
        <button
          class="px-3.5 py-1 rounded-[7px] text-[12px] font-medium flex items-center gap-1.5 transition-all whitespace-nowrap shrink-0"
          :class="viewMode === 'personal' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="switchViewMode('personal')"
        >
          <svg class="w-3.5 h-3.5 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span class="whitespace-nowrap">开发者中心</span>
        </button>
      </div>

      <!-- Controls: Date Presets, Custom Range, Granularity & Refresh -->
      <div class="app-actions">
        <!-- Date Presets -->
        <div class="flex items-center p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.06] text-xs">
          <button
            class="px-2 py-1 rounded-[6px] font-medium text-[11.5px] transition-all"
            :class="datePreset === '7d' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            @click="selectPreset('7d')"
          >
            近 7 天
          </button>
          <button
            class="px-2 py-1 rounded-[6px] font-medium text-[11.5px] transition-all"
            :class="datePreset === '30d' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            @click="selectPreset('30d')"
          >
            近 30 天
          </button>
          <button
            class="px-2 py-1 rounded-[6px] font-medium text-[11.5px] transition-all"
            :class="datePreset === '90d' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            @click="selectPreset('90d')"
          >
            近 90 天
          </button>
        </div>

        <!-- Custom Date Range -->
        <div class="app-filterbar flex items-center gap-1 text-xs text-black/60 dark:text-white/60">
          <input
            type="date"
            v-model="startDate"
            @change="loadCharts"
            class="h-7 px-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <span class="text-[10px]">至</span>
          <input
            type="date"
            v-model="endDate"
            @change="loadCharts"
            class="h-7 px-1.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-[11px] font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <!-- Granularity -->
        <div class="flex items-center p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.06] text-xs">
          <button
            class="px-2 py-1 rounded-[6px] text-[11px] transition-all"
            :class="granularity === 'day' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            @click="granularity = 'day'; loadCharts()"
          >
            天
          </button>
          <button
            class="px-2 py-1 rounded-[6px] text-[11px] transition-all"
            :class="granularity === 'hour' ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            @click="granularity = 'hour'; loadCharts()"
          >
            时
          </button>
        </div>

        <!-- Refresh Button -->
        <button
          @click="refreshAll"
          :disabled="loading || loadingCharts"
          class="h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 text-xs font-medium flex items-center gap-1.5 transition-all text-black/80 dark:text-white/80"
          title="刷新数据"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading || loadingCharts }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden lg:inline text-[11.5px]">刷新</span>
        </button>
      </div>
    </div>

    <!-- Scrollable Content Body -->
    <div ref="contentRef" class="app-content flex-1 min-h-0 overflow-y-auto space-y-4" :aria-busy="loading || loadingCharts">
      <div v-if="loading" class="app-empty" role="status"><strong>正在读取概览</strong><p>账户用量与运行指标即将显示。</p></div>
      <div v-if="statsError" class="app-notice" data-tone="error" role="alert"><span>{{ statsError }}</span><button @click="refreshAll" :disabled="loading">重试</button></div>
      <div v-if="chartError" class="app-notice" data-tone="error" role="alert"><span>{{ chartError }}</span><button @click="loadCharts" :disabled="loadingCharts">重试图表</button></div>
      <div v-if="recentError" class="app-notice" data-tone="error" role="alert"><span>{{ recentError }}</span><button @click="loadRecent" :disabled="loadingUsage">重试记录</button></div>
      <template v-if="!loading && !statsError">

      <!-- ============================================================== -->
      <!-- VIEW MODE 1: PLATFORM OVERVIEW (Admin Only)                    -->
      <!-- ============================================================== -->
      <template v-if="viewMode === 'platform' && authStore.isAdmin">
        <!-- ROW 1: 4 High-Dimension Integrated Platform Metric Centers -->
        <div class="app-metric-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
          <!-- Center 1: 商业营收与计费 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-purple-500/10 dark:bg-purple-400/15 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="12" y1="1" x2="12" y2="23" />
                      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                    </svg>
                  </div>
                  <span class="text-xs font-semibold text-black/75 dark:text-white/75">累计实际费用</span>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono font-medium">
                  毛利 {{ displayPercent(grossMargin, 1) }}
                </span>
              </div>
              <div class="my-1.5">
                <p class="text-2xl font-bold font-mono tracking-tight text-purple-600 dark:text-purple-400">
                  {{ displayCost(adminStats?.total_actual_cost) }}
                </p>
                <p class="text-[11px] text-black/45 dark:text-white/45 mt-0.5 truncate">
                  标准计费: {{ displayCost(adminStats?.total_cost) }}
                </p>
              </div>
            </div>
            <div class="pt-2.5 mt-2 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 font-mono">
              <span>今日扣费: {{ displayCost(adminStats?.today_actual_cost) }}</span>
              <span>上游支出: {{ displayCost(adminStats?.today_account_cost) }}</span>
            </div>
          </div>

          <!-- Center 2: 算力资源与账户池 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                      <line x1="6" y1="6" x2="6.01" y2="6" stroke-width="3" />
                      <line x1="6" y1="18" x2="6.01" y2="18" stroke-width="3" />
                    </svg>
                  </div>
                  <span class="text-xs font-semibold text-black/75 dark:text-white/75">上游账号</span>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono font-medium">
                  健康度 {{ displayPercent(poolHealthRate, 1, true) }}
                </span>
              </div>
              <div class="my-1.5">
                <div class="flex items-baseline gap-1.5">
                  <p class="text-2xl font-bold font-mono tracking-tight text-black/90 dark:text-white/90">
                    {{ displayNumber(adminStats?.total_accounts) }}
                  </p>
                  <span class="text-xs text-black/45 dark:text-white/45">个账号</span>
                </div>
                <p class="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 truncate font-medium">
                  {{ displayNumber(adminStats?.normal_accounts) }} 正常 · {{ displayNumber(abnormalAccountCount) }} 异常/限流
                </p>
              </div>
            </div>
            <div class="pt-2.5 mt-2 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 font-mono">
              <span>今日支出: {{ displayCost(adminStats?.today_account_cost) }}</span>
              <span>累计成本: {{ displayCost(adminStats?.total_account_cost) }}</span>
            </div>
          </div>

          <!-- Center 3: 用户规模与密钥 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-indigo-500/10 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                      <circle cx="9" cy="7" r="4" />
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                    </svg>
                  </div>
                  <span class="text-xs font-semibold text-black/75 dark:text-white/75">用户与密钥</span>
                </div>
                <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                  {{ displayNumber(adminStats?.active_api_keys) }} 活跃密钥
                </span>
              </div>
              <div class="my-1.5">
                <div class="flex items-baseline gap-1.5">
                  <p class="text-2xl font-bold font-mono tracking-tight text-black/90 dark:text-white/90">
                    {{ displayNumber(adminStats?.total_users) }}
                  </p>
                  <span class="text-xs text-black/45 dark:text-white/45">位全站用户</span>
                </div>
                <p class="text-[11px] text-blue-600 dark:text-blue-400 mt-0.5 truncate font-medium">
                  {{ displayStat(adminStats?.today_new_users, formatNumber, '+') }} 今日新增 · {{ displayNumber(adminStats?.active_users) }} 活跃
                </p>
              </div>
            </div>
            <div class="pt-2.5 mt-2 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 font-mono">
              <span>密钥总数: {{ displayNumber(adminStats?.total_api_keys) }}</span>
              <span>活跃密钥: {{ displayNumber(adminStats?.active_api_keys) }}</span>
            </div>
          </div>

          <!-- Center 4: 实时网关状态与吞吐 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all flex flex-col justify-between">
            <div>
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                  <span class="text-xs font-semibold text-black/75 dark:text-white/75">实时请求</span>
                </div>
                <span class="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Active</span>
                </span>
              </div>
              <div class="my-1.5">
                <div class="flex items-baseline gap-2">
                  <p class="text-2xl font-bold font-mono tracking-tight text-blue-600 dark:text-blue-400">
                    {{ displayNumber(adminRealtime?.requests_per_minute) }} <span class="text-sm font-semibold">RPM</span>
                  </p>
                  <span class="text-xs font-mono text-black/50 dark:text-white/50">/ {{ displayNumber(adminRealtime?.active_requests) }} 并发</span>
                </div>
                <p class="text-[11px] text-black/45 dark:text-white/45 mt-0.5 truncate font-mono">
                  今日: {{ displayNumber(adminStats?.today_requests) }} 次 ({{ displayTokens(adminStats?.today_tokens) }} Tokens)
                </p>
              </div>
            </div>
            <div class="pt-2.5 mt-2 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 font-mono">
              <span>响应: {{ displayStat(adminRealtime?.average_response_time, String, '', ' ms') }}</span>
              <span>错误率: {{ displayPercent(adminRealtime?.error_rate, 2) }}</span>
            </div>
          </div>
        </div>

        <!-- ROW 2: Platform Charts (Token Usage Trend & Model Breakdown) -->
        <div class="app-chart-grid dashboard-chart-grid grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Chart 1: 全站热门模型调用分布 -->
          <div class="app-panel dashboard-chart-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold text-black/80 dark:text-white/80">模型用量分布</h3>
              <span class="text-[11px] text-black/40 dark:text-white/40">Tokens 占比</span>
            </div>

            <div class="flex-1 min-h-[200px] flex flex-col sm:flex-row items-center gap-4">
              <div class="w-40 h-40 shrink-0 relative flex items-center justify-center">
                <Doughnut v-if="doughnutData" :data="doughnutData" :options="doughnutOptions" />
                <div v-else class="h-full flex flex-col items-center justify-center text-center p-3">
                  <div class="w-10 h-10 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center text-black/30 dark:text-white/30 mb-2">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                    </svg>
                  </div>
                  <span class="text-xs text-black/45 dark:text-white/45 font-medium">暂无模型调用数据</span>
                </div>
              </div>

              <div class="flex-1 w-full min-w-0 max-h-48 overflow-y-auto pr-1">
                <table v-if="adminModelStats.length > 0" class="w-full text-[11px]">
                  <thead>
                    <tr class="text-black/45 dark:text-white/45 border-b border-black/[0.06] dark:border-white/[0.08]">
                      <th class="pb-1.5 text-left font-medium">模型</th>
                      <th class="pb-1.5 text-right font-medium">请求</th>
                      <th class="pb-1.5 text-right font-medium">Tokens</th>
                      <th class="pb-1.5 text-right font-medium">实际实收</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    <tr v-for="m in adminModelStats" :key="m.model" class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td class="py-1.5 font-mono font-medium truncate max-w-[110px]" :title="m.model">{{ m.model }}</td>
                      <td class="py-1.5 text-right font-mono text-black/60 dark:text-white/60">{{ displayNumber(m.requests) }}</td>
                      <td class="py-1.5 text-right font-mono text-black/60 dark:text-white/60">{{ displayTokens(m.total_tokens) }}</td>
                      <td class="py-1.5 text-right font-mono text-purple-600 dark:text-purple-400 font-semibold">{{ displayCost(m.actual_cost) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="h-full flex flex-col items-center justify-center py-6 text-center text-xs text-black/40 dark:text-white/40">
                  <p class="text-xs font-medium text-black/50 dark:text-white/50">周期内无模型消耗明细</p>
                  <p class="text-[10.5px] text-black/50 dark:text-white/55 mt-0.5">当平台发生 API 路由调用时将自动聚合</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Chart 2: 全平台 Token 消耗趋势 -->
          <div class="app-panel dashboard-chart-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold text-black/80 dark:text-white/80">全站 Token 使用趋势</h3>
              <span class="text-[11px] text-black/40 dark:text-white/40">按时间聚合</span>
            </div>

            <div class="flex-1 min-h-[200px] relative flex flex-col justify-center">
              <Line v-if="lineChartData" :data="lineChartData" :options="lineOptions" />
              <div v-else class="h-full flex flex-col items-center justify-center text-center p-4">
                <div class="w-10 h-10 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center text-black/30 dark:text-white/30 mb-2">
                  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                </div>
                <p class="text-xs font-medium text-black/50 dark:text-white/50">暂无 Token 消耗趋势</p>
                <p class="text-[10.5px] text-black/50 dark:text-white/55 mt-0.5">系统尚未检测到上游 Token 流量流转</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ROW 3: Admin Quick Navigation & Dispatch (Pure macOS Tahoe 快捷访问 Style) -->
        <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <div class="flex items-center justify-between mb-3.5">
            <div class="flex items-center gap-2">
              <h3 class="text-xs font-semibold text-black/85 dark:text-white/85 tracking-tight">管理入口</h3>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-[#007aff]/10 text-[#007aff] dark:bg-[#007aff]/20 dark:text-[#38bdf8] font-medium font-mono">快捷访问</span>
            </div>
            <span class="text-[11px] text-black/40 dark:text-white/40">快捷直达系统核心套件</span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <!-- 1. 账户池 (Correct Squircle Icon: accounts.svg) -->
            <button
              @click="openApp('accounts')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('accounts')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Accounts" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">账户池</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">算力与轮询</span>
            </button>

            <!-- 2. 用户管理 (Correct Squircle Icon: users.svg) -->
            <button
              @click="openApp('users')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('users')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Users" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">用户中心</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">权限与配额</span>
            </button>

            <!-- 3. 网关核心 (apps.png) -->
            <button
              @click="openApp('channels')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('channels')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Gateway" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">网关服务</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">路由与防封</span>
            </button>

            <!-- 4. 充值卡管理 (voucher.png) -->
            <button
              @click="openApp('voucher')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('voucher')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Voucher" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">兑换码</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">批卡与充值</span>
            </button>

            <!-- 5. 实时运维大屏 (activity.png) -->
            <button
              @click="openApp('ops')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('ops')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Ops" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">运维大屏</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">实时全链路</span>
            </button>

            <!-- 6. 系统设置 (settings.png) -->
            <button
              @click="openApp('settings')"
              class="flex flex-col items-center justify-center p-3.5 rounded-2xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] hover:bg-white/90 dark:hover:bg-white/[0.08] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] active:scale-[0.97] transition-all text-center group shadow-xs"
            >
              <img :src="getAppIcon('settings')" class="w-10 h-10 drop-shadow-sm mb-2 group-hover:scale-105 transition-transform" alt="Settings" />
              <span class="text-xs font-semibold text-black/85 dark:text-white/85">全局设置</span>
              <span class="text-[10px] text-black/40 dark:text-white/40 mt-0.5 font-mono">安全与配置</span>
            </button>
          </div>
        </div>
      </template>

      <!-- ============================================================== -->
      <!-- VIEW MODE 2: DEVELOPER CENTER (User Default & Admin Personal)   -->
      <!-- ============================================================== -->
      <template v-else>
        <!-- ROW 1: Core User Stats (4 Cards) -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <!-- Card 1: 余额 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/10 dark:bg-emerald-400/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <line x1="2" y1="10" x2="22" y2="10" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between">
                  <p class="text-xs font-medium text-black/50 dark:text-white/50">账户余额</p>
                  <button
                    @click="openApp('voucher')"
                    class="text-[11px] font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 font-mono hover:underline"
                  >
                    充值
                  </button>
                </div>
                <p class="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 truncate">
                  {{ displayBalance(authStore.user?.balance) }}
                </p>
                <p class="text-[11px] text-black/45 dark:text-white/45">当前可用</p>
              </div>
            </div>
          </div>

          <!-- Card 2: API 密钥 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 2l-2 2m-1.5 1.5L14 9a5.5 5.5 0 1 1-3.5-3.5l3.5-3.5m0 0L16 4m2-2l2 2" />
                  <circle cx="7.5" cy="16.5" r="2.5" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center justify-between">
                  <p class="text-xs font-medium text-black/50 dark:text-white/50">API 密钥</p>
                  <button
                    @click="openApp('keychain')"
                    class="text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 font-mono hover:underline"
                  >
                    新建
                  </button>
                </div>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                  {{ displayNumber(userStats?.total_api_keys) }}
                </p>
                <p class="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium font-mono">
                  {{ displayNumber(userStats?.active_api_keys) }} 处于激活状态
                </p>
              </div>
            </div>
          </div>

          <!-- Card 3: 今日请求 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-indigo-500/10 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">今日请求</p>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                  {{ displayNumber(userStats?.today_requests) }}
                </p>
                <p class="text-[11px] text-black/45 dark:text-white/45 truncate font-mono">
                  总计: {{ displayNumber(userStats?.total_requests) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Card 4: 今日消费 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-500/10 dark:bg-purple-400/15 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">今日消费</p>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90 truncate">
                  <span class="text-purple-600 dark:text-purple-400" title="实际">{{ displayCost(userStats?.today_actual_cost) }}</span>
                  <span class="text-xs font-normal text-black/40 dark:text-white/40" title="标准"> / {{ displayCost(userStats?.today_cost) }}</span>
                </p>
                <p class="text-[11px] text-black/45 dark:text-white/45 truncate font-mono">
                  总计: <span class="text-purple-600 dark:text-purple-400 font-semibold">{{ displayCost(userStats?.total_actual_cost) }}</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- ROW 2: Token Stats & Performance (4 Cards) -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <!-- Card 5: 今日 Token -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500/10 dark:bg-amber-400/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                  <line x1="12" y1="22.08" x2="12" y2="12" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">今日 Tokens</p>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                  {{ displayTokens(userStats?.today_tokens) }}
                </p>
                <p class="text-[10px] text-black/45 dark:text-white/45 truncate font-mono">
                  入: {{ displayTokens(userStats?.today_input_tokens) }} · 出: {{ displayTokens(userStats?.today_output_tokens) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Card 6: 累计 Token -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-cyan-500/10 dark:bg-cyan-400/15 text-cyan-600 dark:text-cyan-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <ellipse cx="12" cy="5" rx="9" ry="3" />
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">累计 Tokens</p>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                  {{ displayTokens(userStats?.total_tokens) }}
                </p>
                <p class="text-[10px] text-black/45 dark:text-white/45 truncate font-mono">
                  全周期 API 调用总量
                </p>
              </div>
            </div>
          </div>

          <!-- Card 7: 性能指标 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-violet-500/10 dark:bg-violet-400/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">速率指标</p>
                <div class="flex items-baseline gap-1.5">
                  <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                    {{ displayTokens(userStats?.rpm) }}
                  </p>
                  <span class="text-[11px] text-black/45 dark:text-white/45 font-mono">RPM</span>
                </div>
                <div class="flex items-baseline gap-1.5">
                  <p class="text-xs font-semibold font-mono text-violet-600 dark:text-violet-400">
                    {{ displayTokens(userStats?.tpm) }}
                  </p>
                  <span class="text-[10px] text-black/45 dark:text-white/45 font-mono">TPM</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 8: 平均响应 -->
          <div class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-rose-500/10 dark:bg-rose-400/15 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium text-black/50 dark:text-white/50">响应延迟</p>
                <p class="text-xl font-bold font-mono text-black/90 dark:text-white/90">
                  {{ displayDuration(userStats?.average_duration_ms) }}
                </p>
                <p class="text-[11px] text-black/45 dark:text-white/45">接口平均耗时</p>
              </div>
            </div>
          </div>
        </div>

        <!-- ROW 3: Platform Breakdown (If any) -->
        <div v-if="platformCards.length > 0" class="app-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-xs font-semibold text-black/80 dark:text-white/80">按平台拆分</h3>
            <span class="text-[11px] text-black/40 dark:text-white/40 font-mono">{{ platformCards.length }} 个平台</span>
          </div>
          <div class="app-metric-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              v-for="item in platformCards"
              :key="item.platform"
              class="p-3.5 rounded-xl border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.03]"
            >
              <div class="flex items-center justify-between">
                <span class="text-xs font-semibold text-black/90 dark:text-white/90 capitalize">{{ item.platform }}</span>
                <span class="font-mono text-xs text-purple-600 dark:text-purple-400 font-bold">{{ displayCost(item.total_actual_cost) }}</span>
              </div>
              <div class="mt-2 space-y-1 text-[11px]">
                <div class="flex items-center justify-between text-black/60 dark:text-white/60">
                  <span>今日消费</span>
                  <span class="font-mono text-black/90 dark:text-white/90">{{ displayCost(item.today_actual_cost) }}</span>
                </div>
                <div class="flex items-center justify-between text-black/60 dark:text-white/60">
                  <span>请求</span>
                  <span class="font-mono">{{ displayNumber(item.total_requests) }}</span>
                </div>
                <div class="flex items-center justify-between text-black/60 dark:text-white/60">
                  <span>Token</span>
                  <span class="font-mono">{{ displayTokens(item.total_tokens) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="dashboard-analysis-control">
          <strong>用量分析</strong>
          <MacSegmented v-model="personalChartView" :options="[{ label: '趋势', value: 'trend' }, { label: '模型分布', value: 'models' }, { label: '并排比较', value: 'both' }]" />
        </div>
        <!-- ROW 4: Dual Charts (Model Distribution & Token Usage Trend) -->
        <div class="app-chart-grid dashboard-chart-grid grid grid-cols-1 lg:grid-cols-2 gap-4" :style="personalChartView !== 'both' ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined">
          <!-- Chart 1: 模型分布 -->
          <div v-if="personalChartView !== 'trend'" class="app-panel dashboard-chart-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold text-black/80 dark:text-white/80">模型消耗分布</h3>
              <span class="text-[11px] text-black/40 dark:text-white/40">Tokens 占比</span>
            </div>

            <div class="flex-1 min-h-[200px] flex flex-col sm:flex-row items-center gap-4">
              <div class="w-40 h-40 shrink-0 relative flex items-center justify-center">
                <Doughnut v-if="doughnutData" :data="doughnutData" :options="doughnutOptions" />
                <div v-else class="h-full flex items-center justify-center text-xs text-black/40 dark:text-white/40">
                  暂无数据
                </div>
              </div>

              <div class="flex-1 w-full min-w-0 max-h-48 overflow-y-auto pr-1">
                <table v-if="userModelStats.length > 0" class="w-full text-[11px]">
                  <thead>
                    <tr class="text-black/45 dark:text-white/45 border-b border-black/[0.06] dark:border-white/[0.08]">
                      <th class="pb-1.5 text-left font-medium">模型</th>
                      <th class="pb-1.5 text-right font-medium">请求</th>
                      <th class="pb-1.5 text-right font-medium">Token</th>
                      <th class="pb-1.5 text-right font-medium">扣费</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                    <tr v-for="m in userModelStats" :key="m.model" class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td class="py-1.5 font-mono font-medium truncate max-w-[110px]" :title="m.model">{{ m.model }}</td>
                      <td class="py-1.5 text-right font-mono text-black/60 dark:text-white/60">{{ displayNumber(m.requests) }}</td>
                      <td class="py-1.5 text-right font-mono text-black/60 dark:text-white/60">{{ displayTokens(m.total_tokens) }}</td>
                      <td class="py-1.5 text-right font-mono text-purple-600 dark:text-purple-400 font-semibold">{{ displayCost(m.actual_cost) }}</td>
                    </tr>
                  </tbody>
                </table>
                <div v-else class="h-full flex flex-col items-center justify-center py-6 text-center text-xs text-black/40 dark:text-white/40">
                  暂无模型用量记录
                </div>
              </div>
            </div>
          </div>

          <!-- Chart 2: Token 使用趋势 -->
          <div v-if="personalChartView !== 'models'" class="app-panel dashboard-chart-panel p-4.5 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="flex items-center justify-between mb-3">
              <h3 class="text-xs font-semibold text-black/80 dark:text-white/80">Token 使用趋势</h3>
              <span class="text-[11px] text-black/40 dark:text-white/40">时序图</span>
            </div>

            <div class="flex-1 min-h-[200px] relative">
              <Line v-if="lineChartData" :data="lineChartData" :options="lineOptions" />
              <div v-else class="h-full flex flex-col items-center justify-center text-xs text-black/40 dark:text-white/40">
                暂无数据
              </div>
            </div>
          </div>
        </div>

        <!-- ROW 5: Recent Usage (2/3) + Quick Actions (1/3) -->
        <div class="dashboard-bottom-grid grid grid-cols-1 lg:grid-cols-3 gap-4 pb-2">
          <!-- Recent Usage (2/3) -->
          <div class="app-panel dashboard-bottom-panel lg:col-span-2 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="dashboard-section-header flex min-h-9 items-center justify-between pb-3 mb-2 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div class="dashboard-section-title flex min-w-0 flex-wrap items-center gap-2">
                <h2 class="shrink-0 text-xs font-semibold text-black/85 dark:text-white/85">最近使用日志</h2>
                <span class="dashboard-date-range max-w-full px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-[10.5px] text-black/60 dark:text-white/60 font-medium font-mono">{{ startDate }} 至 {{ endDate }}</span>
              </div>
              <button
                @click="openApp('activity')"
                class="dashboard-section-action shrink-0 text-xs text-blue-500 hover:text-blue-600 font-medium flex items-center gap-1 transition-colors font-mono whitespace-nowrap"
              >
                查看全部
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div v-if="loadingUsage" class="app-empty" role="status">正在读取使用记录…</div>
            <div v-else-if="recentUsage.length === 0" class="flex-1 py-10 flex flex-col items-center justify-center text-center">
              <div class="w-12 h-12 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center text-black/30 dark:text-white/30 mb-3">
                <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
              </div>
              <h4 class="text-xs font-semibold text-black/80 dark:text-white/80 mb-0.5">暂无调用记录</h4>
              <p class="text-[11px] text-black/45 dark:text-white/45 max-w-xs leading-relaxed">
                发起 API 请求后，调用明细将实时记录在此处。
              </p>
            </div>

            <div v-else class="space-y-2">
              <div
                v-for="log in recentUsage"
                :key="log.id"
                class="flex items-center justify-between p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.04] dark:hover:bg-white/[0.05] transition-colors"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <div class="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-600 flex items-center justify-center shrink-0">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                  <div class="min-w-0">
                    <p class="text-xs font-mono font-semibold text-black/90 dark:text-white/90 truncate">{{ log.model }}</p>
                    <p class="text-[10px] text-black/45 dark:text-white/45 font-mono">{{ formatDateTime(log.created_at) }}</p>
                  </div>
                </div>

                <div class="text-right shrink-0">
                  <p class="text-xs font-mono font-semibold">
                    <span class="text-purple-600 dark:text-purple-400" title="实际">{{ displayCost(log.actual_cost) }}</span>
                  </p>
                  <p class="text-[10.5px] text-black/45 dark:text-white/45 font-mono">
                    {{ displayNumber(log.input_tokens + log.output_tokens) }} tokens
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Developer Quick Actions (1/3) -->
          <div class="app-panel dashboard-bottom-panel lg:col-span-1 rounded-2xl bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl border border-black/[0.06] dark:border-white/[0.08] shadow-[0_2px_12px_rgba(0,0,0,0.03)] flex flex-col">
            <div class="dashboard-section-header flex min-h-9 items-center pb-3 mb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <h2 class="text-xs font-semibold text-black/85 dark:text-white/85">快捷操作</h2>
            </div>

            <div class="space-y-2.5 flex-1">
              <!-- 1. 创建 API 密钥 -->
              <button
                @click="openApp('keychain')"
                class="w-full flex items-center gap-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.05] dark:hover:bg-white/[0.07] transition-all text-left group active:scale-[0.99] shadow-xs"
              >
                <img :src="getAppIcon('keychain')" class="w-9 h-9 drop-shadow-sm shrink-0 group-hover:scale-105 transition-transform" alt="Key" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-semibold text-black/90 dark:text-white/90">API 密钥管理</p>
                  <p class="text-[11px] text-black/45 dark:text-white/45 truncate">创建并管理接口秘钥</p>
                </div>
                <svg class="w-4 h-4 text-black/30 dark:text-white/30 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <!-- 2. 查看使用记录 -->
              <button
                @click="openApp('activity')"
                class="w-full flex items-center gap-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.05] dark:hover:bg-white/[0.07] transition-all text-left group active:scale-[0.99] shadow-xs"
              >
                <img :src="getAppIcon('activity')" class="w-9 h-9 drop-shadow-sm shrink-0 group-hover:scale-105 transition-transform" alt="Activity" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-semibold text-black/90 dark:text-white/90">调用日志明细</p>
                  <p class="text-[11px] text-black/45 dark:text-white/45 truncate">审查调用耗时与 Tokens</p>
                </div>
                <svg class="w-4 h-4 text-black/30 dark:text-white/30 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <!-- 3. 兑换码充值 -->
              <button
                @click="openApp('voucher')"
                class="w-full flex items-center gap-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.05] dark:hover:bg-white/[0.07] transition-all text-left group active:scale-[0.99] shadow-xs"
              >
                <img :src="getAppIcon('voucher')" class="w-9 h-9 drop-shadow-sm shrink-0 group-hover:scale-105 transition-transform" alt="Voucher" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-semibold text-black/90 dark:text-white/90">兑换码充值</p>
                  <p class="text-[11px] text-black/45 dark:text-white/45 truncate">使用充值卡充入账户余额</p>
                </div>
                <svg class="w-4 h-4 text-black/30 dark:text-white/30 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>

              <!-- 4. 账户安全设置 -->
              <button
                @click="openApp('settings')"
                class="w-full flex items-center gap-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] hover:bg-black/[0.05] dark:hover:bg-white/[0.07] transition-all text-left group active:scale-[0.99] shadow-xs"
              >
                <img :src="getAppIcon('settings')" class="w-9 h-9 drop-shadow-sm shrink-0 group-hover:scale-105 transition-transform" alt="Settings" />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-semibold text-black/90 dark:text-white/90">个人与安全</p>
                  <p class="text-[11px] text-black/45 dark:text-white/45 truncate">修改密码与双因素认证</p>
                </div>
                <svg class="w-4 h-4 text-black/30 dark:text-white/30 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
      </template>
    </div>
  </div>
</template>

<style scoped>
.dashboard-analysis-control { display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px; }

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
