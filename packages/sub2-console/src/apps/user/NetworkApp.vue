<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import './app-polish.css';
import { MacButton, MacSheet, type WindowInstance } from '@sub2-mac/core';
import ModelPricingSheet from './ModelPricingSheet.vue';
import userChannelsAPI, {
  type UserAvailableChannel,
  type UserChannelPlatformSection,
  type UserAvailableGroup,
  type UserSupportedModel
} from '../../api/channels';
import userGroupsAPI from '../../api/groups';
import { channelMonitorUserAPI, type UserMonitorView, type UserMonitorDetail } from '../../api/channelMonitor';

defineProps<{
  win?: WindowInstance;
}>();

const activeTab = ref<'available' | 'monitor'>('available');
const searchQuery = ref('');
const loading = ref(false);
const channelsError = ref('');
const monitorError = ref('');
const ratesError = ref('');
let disposed = false;
let detailRequest = 0;
const monitorTarget = ref<UserMonitorView | null>(null);
const monitorDetail = ref<UserMonitorDetail | null>(null);
const detailLoading = ref(false);
const detailError = ref('');
onBeforeUnmount(() => { disposed = true; detailRequest++; });
function monitorStatus(status: string) {
  return ({ operational: '正常', degraded: '降级', failed: '不可用', error: '检测失败' } as Record<string, string>)[status] || '未检测';
}
function availability(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}
async function inspectMonitor(item: UserMonitorView) {
  const request = ++detailRequest;
  monitorTarget.value = item;
  monitorDetail.value = null;
  detailLoading.value = true;
  detailError.value = '';
  try {
    const result = await channelMonitorUserAPI.status(item.id);
    if (request === detailRequest) monitorDetail.value = result;
  } catch {
    if (request === detailRequest) detailError.value = '监控详情加载失败，请重试。';
  } finally { if (request === detailRequest) detailLoading.value = false; }
}
function closeMonitor() { detailRequest++; monitorTarget.value = null; monitorDetail.value = null; detailLoading.value = false; }


// 1. Available Channels State
const channels = ref<UserAvailableChannel[]>([]);
const userGroupRates = ref<Record<number, number>>({});

// 2. Channel Monitor State
const monitorList = ref<UserMonitorView[]>([]);
const monitorLoading = ref(false);

// Active Model Pricing Popover/Sheet
const activePricingModel = ref<{
  model: UserSupportedModel;
  platform?: string;
} | null>(null);

async function loadChannelsData() {
  if (loading.value) return;
  loading.value = true;
  channelsError.value = '';
  ratesError.value = '';
  try {
    const [list, rates] = await Promise.all([
      userChannelsAPI.getAvailable(),
      userGroupsAPI.getUserGroupRates().catch(() => { if (!disposed) ratesError.value = '专属倍率加载失败，暂显示分组默认倍率。'; return {} as Record<number, number>; })
    ]);
    if (disposed) return;
    channels.value = list || [];
    userGroupRates.value = rates || {};
  } catch (err) {
    if (disposed) return;
    channelsError.value = '可用渠道加载失败。';
    console.error('Failed to load available channels:', err);
    // Keep the last successfully loaded channels.
  } finally {
    loading.value = false;
  }
}

async function loadMonitorData() {
  if (monitorLoading.value) return;
  monitorLoading.value = true;
  monitorError.value = '';
  try {
    const res = await channelMonitorUserAPI.list();
    if (disposed) return;
    monitorList.value = res?.items || [];
  } catch (err) {
    if (disposed) return;
    monitorError.value = '渠道监控加载失败。';
    console.error('Failed to load channel monitor status:', err);
    // Keep the last successfully loaded monitor snapshot.
  } finally {
    monitorLoading.value = false;
  }
}

function refreshCurrent() {
  if (activeTab.value === 'available') {
    loadChannelsData();
  } else {
    loadMonitorData();
  }
}

// Search Filtering for Available Channels
const filteredChannels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return channels.value;

  return channels.value
    .map(ch => {
      const nameHit = (ch.name || '').toLowerCase().includes(q);
      const descHit = (ch.description || '').toLowerCase().includes(q);
      if (nameHit || descHit) return ch;

      const matchingSections = (ch.platforms || []).filter(
        p =>
          (p.platform || '').toLowerCase().includes(q) ||
          (p.groups || []).some(g => (g.name || '').toLowerCase().includes(q)) ||
          (p.supported_models || []).some(m => (m.name || '').toLowerCase().includes(q))
      );
      if (matchingSections.length === 0) return null;
      return { ...ch, platforms: matchingSections };
    })
    .filter((ch): ch is UserAvailableChannel => ch !== null);
});

// Search Filtering for Monitor List
const filteredMonitorList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return monitorList.value;
  return monitorList.value.filter(
    m =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.provider || '').toLowerCase().includes(q) ||
      (m.primary_model || '').toLowerCase().includes(q) ||
      (m.group_name || '').toLowerCase().includes(q)
  );
});

// Helpers
function exclusiveGroups(section: UserChannelPlatformSection): UserAvailableGroup[] {
  return (section.groups || []).filter(g => g.is_exclusive);
}

function publicGroups(section: UserChannelPlatformSection): UserAvailableGroup[] {
  return (section.groups || []).filter(g => !g.is_exclusive);
}

function hasPeakRate(group: UserAvailableGroup): boolean {
  return group.peak_rate_enabled && group.peak_rate_multiplier > 0;
}

function platformBadgeClass(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'anthropic':
      return 'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/20';
    case 'openai':
      return 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
    case 'gemini':
      return 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/20';
    case 'deepseek':
      return 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border-indigo-500/20';
    case 'grok':
    case 'xai':
      return 'text-slate-700 dark:text-slate-300 bg-slate-500/10 border-slate-500/20';
    default:
      return 'text-purple-700 dark:text-purple-300 bg-purple-500/10 border-purple-500/20';
  }
}

function formatPriceUnit(price: number | null | undefined, unit: string = '/ 1M token'): string {
  if (price == null) return '-';
  return `$${(price * 1000000).toFixed(4)} ${unit}`;
}

onMounted(() => {
  loadChannelsData();
});
</script>

<template>
  <div class="user-app-polish network-app relative h-full flex flex-col bg-[#f8f9fa] dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] select-none text-[13px] overflow-hidden">
    <!-- Window Top Header Bar -->
    <div class="app-toolbar h-12 px-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-white/75 dark:bg-[#252528]/80 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-2.5">
        <img  :src="getAppIcon('network')" class="w-7 h-7 drop-shadow-sm shrink-0" alt="Channels" />
        <div>
          <h1 class="app-title">可用渠道</h1>
          <div class="text-[10px] text-black/45 dark:text-white/45">查看您可访问的渠道与其支持的模型、定价</div>
        </div>
      </div>

      <!-- Segmented Tabs & Actions -->
      <div class="app-actions">
        <div class="flex items-center p-0.5 bg-black/[0.05] dark:bg-white/[0.08] rounded-lg text-xs">
          <button
            @click="activeTab = 'available'; if (channels.length === 0) loadChannelsData();"
            :class="activeTab === 'available' ? 'bg-white dark:bg-[#323236] text-black dark:text-white shadow-xs font-medium' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            class="px-3 py-1 rounded-md transition-all"
          >
            可用渠道
          </button>
          <button
            @click="activeTab = 'monitor'; if (monitorList.length === 0) loadMonitorData();"
            :class="activeTab === 'monitor' ? 'bg-white dark:bg-[#323236] text-black dark:text-white shadow-xs font-medium' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
            class="px-3 py-1 rounded-md transition-all"
          >
            渠道状态
          </button>
        </div>

        <button
          @click="refreshCurrent"
          :disabled="loading || monitorLoading"
          class="h-7 px-2.5 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition-all text-xs flex items-center gap-1 text-black/75 dark:text-white/80"
          title="刷新"
        >
          <svg class="w-3.5 h-3.5" :class="(loading || monitorLoading) ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span class="hidden sm:inline">刷新</span>
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="px-4 py-2.5 border-b border-black/[0.05] dark:border-white/[0.06] bg-white/40 dark:bg-white/[0.02] flex items-center justify-between shrink-0">
      <div class="relative w-72 max-w-full">
        <svg class="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          aria-label="搜索渠道或模型" placeholder="搜索渠道或模型..."
          class="w-full h-7 pl-8 pr-3 bg-white dark:bg-[#2c2c2e] border border-black/10 dark:border-white/10 rounded-md text-xs placeholder:text-black/35 dark:placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:focus:ring-blue-400/30 transition-all"
        />
        <button
          v-if="searchQuery"
          aria-label="清除搜索" @click="searchQuery = ''"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 text-xs"
        >
          ✕
        </button>
      </div>
      <div class="text-[11px] text-black/45 dark:text-white/45">
        <template v-if="activeTab === 'available'">
          共 {{ filteredChannels.length }} 个可用渠道
        </template>
        <template v-else>
          共 {{ filteredMonitorList.length }} 个监控节点
        </template>
      </div>
    </div>

    <!-- Main Content Area -->
    <div class="app-content flex-1 overflow-y-auto">
      <div v-if="activeTab === 'available' && ratesError" class="app-notice" data-tone="error" role="alert"><span>{{ ratesError }}</span><button :disabled="loading" @click="loadChannelsData">重试</button></div>
      <div v-if="activeTab === 'available' && channelsError && channels.length" class="app-notice" data-tone="error" role="alert"><span>{{ channelsError }} 当前显示上次加载的数据。</span><button :disabled="loading" @click="loadChannelsData">重试</button></div>
      <div v-if="activeTab === 'monitor' && monitorError && monitorList.length" class="app-notice" data-tone="error" role="alert"><span>{{ monitorError }} 当前显示上次加载的数据。</span><button :disabled="monitorLoading" @click="loadMonitorData">重试</button></div>
      <!-- 1. Available Channels View -->
      <template v-if="activeTab === 'available'">
        <!-- Loading State -->
        <div v-if="loading && !channels.length" class="h-64 flex flex-col items-center justify-center gap-3 text-black/40 dark:text-white/40">
          <svg class="w-6 h-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle class="opacity-25" cx="12" cy="12" r="10" />
            <path class="opacity-75" d="M4 12a8 8 0 018-8v8H4z" fill="currentColor" />
          </svg>
          <span class="text-xs">正在拉取可用渠道与定价矩阵...</span>
        </div>

        <div v-else-if="channelsError && !channels.length" class="app-empty" role="alert"><strong>{{ channelsError }}</strong><p>连接恢复后即可重新查看分组与模型定价。</p><button class="app-retry" @click="loadChannelsData">重新加载</button></div>
        <!-- Empty State -->
        <div
          v-else-if="filteredChannels.length === 0"
          class="h-64 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center shadow-xs"
        >
          <div class="w-12 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-black/35 dark:text-white/35 flex items-center justify-center mb-3">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 00-2.15-1.588H6.91a2.25 2.25 0 00-2.15 1.588L2.35 12.677a2.25 2.25 0 00-.1.661z" />
            </svg>
          </div>
          <h3 class="text-sm font-semibold text-black/80 dark:text-white/80">{{ searchQuery ? '没有匹配的渠道' : '暂无可用渠道' }}</h3>
          <p class="text-xs text-black/45 dark:text-white/45 mt-1 max-w-sm">
            {{ searchQuery ? '请调整搜索关键词，或清除筛选查看全部渠道。' : '当前账户暂无可用渠道，请联系管理员确认分组权限。' }}
          </p>
        </div>

        <!-- Channels Table -->
        <div v-else class="app-table-scroll rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <table class="app-table w-full min-w-[760px] text-left border-collapse">
            <thead>
              <tr class="border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-[11px] font-medium text-black/50 dark:text-white/50">
                <th class="w-[180px] px-4 py-2.5 text-center">渠道名</th>
                <th class="w-[200px] px-4 py-2.5">描述</th>
                <th class="w-[120px] px-4 py-2.5">平台</th>
                <th class="px-4 py-2.5">我可访问的分组</th>
                <th class="px-4 py-2.5">支持模型</th>
              </tr>
            </thead>
            <tbody
              v-for="(channel, chIdx) in filteredChannels"
              :key="`${channel.name}-${chIdx}`"
              class="border-b border-black/[0.08] dark:border-white/[0.08] last:border-b-0 divide-y divide-black/[0.04] dark:divide-white/[0.04]"
            >
              <tr
                v-for="(section, secIdx) in (channel.platforms || [])"
                :key="`${channel.name}-${section.platform}-${secIdx}`"
                class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
              >
                <!-- 渠道名 (Rowspan) -->
                <td
                  v-if="secIdx === 0"
                  :rowspan="channel.platforms.length || 1"
                  class="px-4 py-3 text-center align-middle font-medium text-black dark:text-white border-r border-black/[0.05] dark:border-white/[0.05]"
                >
                  <div class="font-semibold text-xs text-black/90 dark:text-white/90">{{ channel.name }}</div>
                </td>

                <!-- 描述 (Rowspan) -->
                <td
                  v-if="secIdx === 0"
                  :rowspan="channel.platforms.length || 1"
                  class="px-4 py-3 align-middle text-xs text-black/55 dark:text-white/55 border-r border-black/[0.05] dark:border-white/[0.05]"
                >
                  <span v-if="channel.description">{{ channel.description }}</span>
                  <span v-else class="text-black/30 dark:text-white/30">-</span>
                </td>

                <!-- 平台徽章 -->
                <td class="px-4 py-3 align-top">
                  <span
                    :class="[
                      'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium border uppercase tracking-wider',
                      platformBadgeClass(section.platform)
                    ]"
                  >
                    {{ section.platform }}
                  </span>
                </td>

                <!-- 分组：专属分组 (Shield) + 公开分组 (Globe) -->
                <td class="px-4 py-3 align-top">
                  <div class="flex flex-col gap-2">
                    <!-- 专属分组 -->
                    <div v-if="exclusiveGroups(section).length > 0" class="flex flex-wrap items-center gap-1.5">
                      <span
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400 bg-purple-500/10 dark:bg-purple-400/10 px-1.5 py-0.5 rounded border border-purple-500/20"
                        title="管理员授权给你的专属分组"
                      >
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        专属
                      </span>
                      <div
                        v-for="g in exclusiveGroups(section)"
                        :key="`ex-${g.id}`"
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-xs"
                      >
                        <span class="font-medium text-black/85 dark:text-white/85">{{ g.name }}</span>
                        <span class="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-semibold">
                          {{ (userGroupRates[g.id] ?? g.rate_multiplier).toFixed(2) }}x
                        </span>
                        <span
                          v-if="hasPeakRate(g)"
                          class="inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded"
                          :title="`高峰时段 ${g.peak_start}-${g.peak_end} 倍率 ×${g.peak_rate_multiplier}`"
                        >
                          高峰 ×{{ g.peak_rate_multiplier }}
                        </span>
                      </div>
                    </div>

                    <!-- 公开分组 -->
                    <div v-if="publicGroups(section).length > 0" class="flex flex-wrap items-center gap-1.5">
                      <span
                        class="inline-flex items-center gap-0.5 text-[10px] font-medium text-black/50 dark:text-white/50 bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded border border-black/10 dark:border-white/10"
                        title="对所有用户公开的分组"
                      >
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                        </svg>
                        公开
                      </span>
                      <div
                        v-for="g in publicGroups(section)"
                        :key="`pub-${g.id}`"
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/[0.04] dark:bg-white/[0.06] border border-black/10 dark:border-white/10 text-xs"
                      >
                        <span class="font-medium text-black/85 dark:text-white/85">{{ g.name }}</span>
                        <span class="text-[10px] font-mono text-teal-600 dark:text-teal-400 font-semibold">
                          {{ (userGroupRates[g.id] ?? g.rate_multiplier).toFixed(2) }}x
                        </span>
                        <span
                          v-if="hasPeakRate(g)"
                          class="inline-flex items-center gap-0.5 text-[9px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded"
                          :title="`高峰时段 ${g.peak_start}-${g.peak_end} 倍率 ×${g.peak_rate_multiplier}`"
                        >
                          高峰 ×{{ g.peak_rate_multiplier }}
                        </span>
                      </div>
                    </div>

                    <span v-if="(section.groups || []).length === 0" class="text-xs text-black/30 dark:text-white/30">-</span>
                  </div>
                </td>

                <!-- 支持模型 Chips -->
                <td class="px-4 py-3 align-top">
                  <div class="flex flex-wrap gap-1.5">
                    <button
                      v-for="m in (section.supported_models || [])"
                      :key="`${section.platform}-${m.name}`"
                      @click="activePricingModel = { model: m, platform: section.platform }"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.04] hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-xs text-black/85 dark:text-white/85 group cursor-pointer"
                    >
                      <span>{{ m.name }}</span>
                      <svg class="w-3 h-3 text-black/30 dark:text-white/30 group-hover:text-blue-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                    </button>
                    <span v-if="(section.supported_models || []).length === 0" class="text-xs text-black/30 dark:text-white/30">
                      未配置模型
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- 2. Channel Monitor View -->
      <template v-else>
        <!-- Loading -->
        <div v-if="monitorLoading && !monitorList.length" class="h-64 flex flex-col items-center justify-center gap-3 text-black/40 dark:text-white/40">
          <svg class="w-6 h-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle class="opacity-25" cx="12" cy="12" r="10" />
            <path class="opacity-75" d="M4 12a8 8 0 018-8v8H4z" fill="currentColor" />
          </svg>
          <span class="text-xs">正在查询渠道探针状态与可用率...</span>
        </div>

        <div v-else-if="monitorError && !monitorList.length" class="app-empty" role="alert"><strong>{{ monitorError }}</strong><button class="app-retry" @click="loadMonitorData">重新加载</button></div>
        <!-- Empty -->
        <div
          v-else-if="filteredMonitorList.length === 0"
          class="h-64 rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center shadow-xs"
        >
          <div class="w-12 h-12 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-black/35 dark:text-white/35 flex items-center justify-center mb-3">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
          </div>
          <h3 class="text-sm font-semibold text-black/80 dark:text-white/80">{{ searchQuery ? '没有匹配的监控节点' : '暂无渠道状态监控数据' }}</h3>
          <p class="text-xs text-black/45 dark:text-white/45 mt-1 max-w-sm">
            系统尚未收集到可展示的渠道实时可用率或探针指标。
          </p>
        </div>

        <!-- Monitor Table -->
        <div v-else class="app-table-scroll rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.03)]">
          <table class="app-table w-full min-w-[760px] text-left border-collapse">
            <thead>
              <tr class="border-b border-black/[0.08] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-[11px] font-medium text-black/50 dark:text-white/50">
                <th class="px-4 py-2.5">渠道名称</th>
                <th class="px-4 py-2.5">上游服务商</th>
                <th class="px-4 py-2.5">核心基准模型</th>
                <th class="px-4 py-2.5">探针状态</th>
                <th class="px-4 py-2.5">当前延迟</th>
                <th class="px-4 py-2.5">7天可用率</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              <tr
                v-for="item in filteredMonitorList"
                :key="item.id"
                class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
              >
                <td class="px-4 py-3 font-medium text-xs"><button class="text-blue-600 dark:text-blue-400 hover:underline text-left" :aria-label="`查看 ${item.name} 监控详情`" @click="inspectMonitor(item)">{{ item.name }}</button></td>
                <td class="px-4 py-3">
                  <span class="px-1.5 py-0.5 rounded text-[11px] font-medium uppercase bg-black/[0.05] dark:bg-white/[0.08]">
                    {{ item.provider }}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs font-mono text-black/70 dark:text-white/70">{{ item.primary_model === 'quota' ? '配额检查' : item.primary_model }}</td>
                <td class="px-4 py-3">
                  <span
                    :class="item.primary_status === 'operational' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' : item.primary_status === 'failed' ? 'bg-red-500/10 text-red-600 border-red-500/20' : 'bg-black/5 dark:bg-white/10 text-black/60 dark:text-white/60 border-black/10'"
                    class="px-2 py-0.5 rounded border text-[10px] font-semibold uppercase"
                  >
                    {{ monitorStatus(item.primary_status) }}
                  </span>
                </td>
                <td class="px-4 py-3 text-xs font-mono">
                  <span v-if="item.primary_latency_ms != null">{{ item.primary_latency_ms }} ms</span>
                  <span v-else class="text-black/30 dark:text-white/30">-</span>
                </td>
                <td class="px-4 py-3 text-xs font-semibold">
                  <span :class="item.availability_7d >= 99 ? 'text-emerald-600' : 'text-amber-600'">
                    {{ availability(item.availability_7d) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>

    <MacSheet :show="monitorTarget !== null" :title="monitorTarget?.name || '监控详情'" @close="closeMonitor">
      <p v-if="detailLoading" role="status">正在读取监控详情…</p>
      <div v-else-if="detailError" role="alert"><p>{{ detailError }}</p><MacButton v-if="monitorTarget" @click="inspectMonitor(monitorTarget)">重试</MacButton></div>
      <div v-else-if="monitorDetail" class="monitor-inspector">
        <p>{{ monitorDetail.group_name }} · {{ monitorDetail.provider }}</p>
        <p v-if="!monitorDetail.models.length">暂无模型监控记录。</p>
        <section v-for="model in monitorDetail.models" :key="model.model">
          <h4>{{ model.model === 'quota' ? '配额检查' : model.model }} <span>{{ monitorStatus(model.latest_status) }}</span></h4>
          <dl><dt>当前延迟</dt><dd>{{ model.latest_latency_ms == null ? '—' : `${model.latest_latency_ms} ms` }}</dd><dt>7 天平均延迟</dt><dd>{{ model.avg_latency_7d_ms == null ? '—' : `${model.avg_latency_7d_ms} ms` }}</dd><dt>7 / 15 / 30 天可用率</dt><dd>{{ availability(model.availability_7d) }} / {{ availability(model.availability_15d) }} / {{ availability(model.availability_30d) }}</dd></dl>
        </section>
      </div>
      <template #footer><MacButton @click="closeMonitor">完成</MacButton></template>
    </MacSheet>
    <ModelPricingSheet :model="activePricingModel?.model || null" @close="activePricingModel = null" />
  </div>
</template>

<style scoped>
.monitor-inspector { display:grid;gap:14px;font-size:12px; }.monitor-inspector>p { color:var(--text-secondary); }.monitor-inspector section { border:1px solid var(--border-subtle);border-radius:8px;padding:12px; }.monitor-inspector h4 { display:flex;justify-content:space-between;gap:12px;font-weight:600;overflow-wrap:anywhere; }.monitor-inspector h4 span { font-size:11px;color:var(--text-secondary);flex-shrink:0; }.monitor-inspector dl { display:grid;grid-template-columns:auto 1fr;gap:8px;font-size:11px;margin-top:12px; }.monitor-inspector dt { color:var(--text-secondary); }.monitor-inspector dd { text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums; }
</style>
