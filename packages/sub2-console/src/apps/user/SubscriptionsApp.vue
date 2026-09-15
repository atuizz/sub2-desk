<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';
import subscriptionsAPI from '../../api/subscriptions';
import type { UserSubscription } from '../../types';
import { formatDateTime } from '../../utils/format';
import { MacSearchField, MacSegmented, useWindowManager } from '@sub2-mac/core';

defineProps<{
  win?: WindowInstance;
}>();

const wm = useWindowManager();
const subscriptions = ref<UserSubscription[]>([]);
const loading = ref(false);
const loadError = ref('');
const search = ref('');
const statusFilter = ref('all');
const selectedId = ref<number | null>(null);
const now = ref(Date.now());
let disposed = false;
let clock: ReturnType<typeof setInterval> | undefined;
onBeforeUnmount(() => { disposed = true; clearInterval(clock); });
const filteredSubscriptions = computed(() => subscriptions.value.filter(sub => {
  const q = search.value.trim().toLowerCase();
  const status = subscriptionStatus(sub);
  return (statusFilter.value === 'all' || (statusFilter.value === 'active' ? status === 'active' : status !== 'active'))
    && (!q || `${sub.group?.name || ''} ${sub.group?.platform || ''} ${sub.group_id}`.toLowerCase().includes(q));
}));
const selectedSubscription = computed(() => filteredSubscriptions.value.find(sub => sub.id === selectedId.value) || filteredSubscriptions.value[0]);
function subscriptionStatus(sub: UserSubscription): string {
  if (sub.status !== 'active') return sub.status;
  if (sub.expires_at && new Date(sub.expires_at).getTime() <= now.value) return 'expired';
  if (new Date(sub.starts_at).getTime() > now.value) return 'scheduled';
  return 'active';
}
function statusLabel(sub: UserSubscription): string {
  return ({ active: '有效', expired: '已过期', revoked: '已撤销', suspended: '已暂停', scheduled: '未生效' } as Record<string, string>)[subscriptionStatus(sub)] || '未知状态';
}

async function loadSubscriptions() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await subscriptionsAPI.getMySubscriptions();
    if (disposed) return;
    subscriptions.value = res || [];
  } catch (err) {
    if (disposed) return;
    loadError.value = '订阅加载失败，请稍后重试。';
    console.error('Failed to load subscriptions:', err);
    // Retain the last successful subscriptions for a recoverable refresh.
  } finally {
    loading.value = false;
  }
}

function platformAccentClass(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'anthropic': return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20';
    case 'openai': return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    case 'gemini': return 'text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20';
    case 'deepseek': return 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
    default: return 'text-purple-600 dark:text-purple-400 bg-purple-500/10 border-purple-500/20';
  }
}

function platformDotClass(platform?: string): string {
  switch (platform?.toLowerCase()) {
    case 'anthropic': return 'bg-amber-500';
    case 'openai': return 'bg-emerald-500';
    case 'gemini': return 'bg-blue-500';
    case 'deepseek': return 'bg-indigo-500';
    default: return 'bg-purple-500';
  }
}

function getProgressWidth(used?: number, limit?: number | null): string {
  if (!limit || limit === 0) return '0%';
  const pct = Math.min(((used || 0) / limit) * 100, 100);
  return `${pct}%`;
}

function getProgressBarClass(used?: number, limit?: number | null): string {
  if (!limit || limit === 0) return 'bg-gray-400';
  const pct = ((used || 0) / limit) * 100;
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function formatExpiration(expiresAt?: string | null): { text: string; isExpired: boolean; isWarning: boolean } {
  if (!expiresAt) return { text: '无到期时间', isExpired: false, isWarning: false };
  const exp = new Date(expiresAt);
  if (!Number.isFinite(exp.getTime())) return { text: '到期时间未知', isExpired: false, isWarning: true };
  const diffMs = exp.getTime() - now.value;
  if (diffMs <= 0) {
    return { text: '已过期', isExpired: true, isWarning: true };
  }
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const dateStr = formatDateTime(expiresAt);
  if (days <= 1) {
    return { text: `24 小时内到期 (${dateStr})`, isExpired: false, isWarning: true };
  }
  if (days <= 3) {
    return { text: `剩余 ${days} 天 (${dateStr})`, isExpired: false, isWarning: true };
  }
  return { text: `剩余 ${days} 天 (${dateStr})`, isExpired: false, isWarning: false };
}

function formatResetCountdown(windowStart?: string | null, windowHours: number = 24): string {
  if (!windowStart) return '等待首次使用';
  const start = new Date(windowStart);
  const end = new Date(start.getTime() + windowHours * 60 * 60 * 1000);
  if (!Number.isFinite(end.getTime())) return '重置时间未知';
  const diffMs = end.getTime() - now.value;
  if (diffMs <= 0) return '即将重置';
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}天 ${hours % 24}小时后重置`;
  }
  if (hours > 0) return `${hours}小时 ${mins}分后重置`;
  return `${mins}分钟后重置`;
}

function dailyWindowLabel(sub: UserSubscription): string {
  const start = new Date(sub.starts_at).getTime();
  const end = sub.expires_at ? new Date(sub.expires_at).getTime() : NaN;
  if (Number.isFinite(start) && Number.isFinite(end) && end <= start + 86_400_000) {
    return end <= now.value ? '额度已结束' : '本次额度随订阅到期结束';
  }
  return formatResetCountdown(sub.daily_window_start, 24);
}

function openWallet() {
  wm?.openApp('wallet', { tab: 'subscription' });
}

onMounted(() => {
  loadSubscriptions();
  clock = setInterval(() => { now.value = Date.now(); }, 60_000);
});
</script>

<template>
  <div class="user-app-polish subscriptions-app h-full flex flex-col bg-[#f8f9fa] dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] select-none text-[13px] overflow-hidden">
    <!-- Top Window Header -->
    <div class="app-toolbar h-12 px-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-white/75 dark:bg-[#252528]/80 backdrop-blur-md shrink-0">
      <div class="flex items-center gap-2.5">
        <img  :src="getAppIcon('subscriptions')" alt="Subscriptions" class="w-7 h-7 object-contain drop-shadow-sm" />
        <div>
          <h1 class="app-title">我的订阅</h1>
          <div class="text-[11px] text-black/50 dark:text-white/50 mt-0.5">查看您的订阅计划和用量</div>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button type="button" class="app-retry" @click="openWallet">购买订阅</button>
        <button
          type="button"
          class="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black dark:text-white flex items-center gap-1.5 transition-colors disabled:opacity-50"
          :disabled="loading"
          @click="loadSubscriptions"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>刷新</span>
        </button>
      </div>
    </div>

    <div class="subscription-filterbar">
      <MacSegmented v-model="statusFilter" :options="[{ label: '全部', value: 'all' }, { label: '有效', value: 'active' }, { label: '其他', value: 'inactive' }]" />
      <MacSearchField v-model="search" placeholder="搜索订阅或平台" />
    </div>
    <div v-if="loadError && subscriptions.length" class="app-notice" data-tone="error" role="alert"><span>{{ loadError }} 当前显示上次加载的订阅。</span><button :disabled="loading" @click="loadSubscriptions">重试</button></div>
    <!-- Workspace Body -->
    <div class="subscription-workspace flex-1 min-h-0 overflow-auto">
      <!-- Loading State -->
      <div v-if="loading && !subscriptions.length" class="py-20 flex flex-col items-center justify-center gap-2 text-black/40 dark:text-white/40">
        <svg class="w-6 h-6 animate-spin text-[#007aff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span class="text-xs font-medium">正在加载您的订阅套餐...</span>
      </div>

      <div v-else-if="loadError && !subscriptions.length" class="app-empty" role="alert"><strong>暂时无法显示订阅</strong><p>{{ loadError }}</p><button class="app-retry" @click="loadSubscriptions">重新加载</button></div>
      <!-- Empty State -->
      <div
        v-else-if="subscriptions.length === 0"
        class="h-full flex flex-col items-center justify-center p-12 text-center rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs select-none"
      >
        <div class="w-16 h-16 rounded-full bg-black/[0.03] dark:bg-white/[0.05] flex items-center justify-center mb-4 text-black/30 dark:text-white/30">
          <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="2" y="5" width="20" height="14" rx="2" />
            <line x1="2" y1="10" x2="22" y2="10" />
          </svg>
        </div>
        <h3 class="text-base font-semibold text-black/90 dark:text-white/90 mb-1.5">
          暂无订阅
        </h3>
        <p class="text-xs text-black/50 dark:text-white/50 max-w-sm leading-relaxed mb-5">
          已购买或由管理员分配的订阅会显示在这里。
        </p>
        <button
          type="button"
          class="px-4 py-1.5 rounded-lg bg-[#007aff] hover:bg-[#0071e3] text-xs font-medium text-white shadow-xs transition-colors"
          @click="openWallet"
        >
          前往充值与购买
        </button>
      </div>

      <div v-else-if="!filteredSubscriptions.length" class="app-empty"><strong>没有匹配的订阅</strong><button class="app-retry" @click="search = ''; statusFilter = 'all'">清除筛选</button></div>
      <div v-else class="subscription-split">
        <nav class="subscription-list" aria-label="订阅列表">
          <button v-for="sub in filteredSubscriptions" :key="sub.id" type="button" :aria-pressed="selectedSubscription?.id === sub.id" @click="selectedId = sub.id">
            <span class="subscription-list-title">{{ sub.group?.name || `分组 #${sub.group_id}` }}</span>
            <span>{{ statusLabel(sub) }} · {{ sub.group?.platform || '未提供平台' }}</span>
            <small>{{ formatExpiration(sub.expires_at).text }}</small>
          </button>
        </nav>
        <div class="subscription-detail">
      <!-- Selected subscription retains its quota and billing details. -->
      <div v-if="selectedSubscription">
        <div
          v-for="sub in [selectedSubscription]"
          :key="sub.id"
          class="subscription-card rounded-2xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs overflow-hidden shadow-2xs flex flex-col"
        >
          <!-- Card Header -->
          <div class="app-section-heading p-4 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between bg-black/[0.01]">
            <div class="flex items-center gap-3">
              <span class="w-2 h-2 rounded-full shrink-0" :class="platformDotClass(sub.group?.platform)" />
              <div>
                <div class="flex items-center gap-2">
                  <span class="app-long-value text-[14px] font-semibold text-black/90 dark:text-white/90">
                    {{ sub.group?.name || `Group #${sub.group_id}` }}
                  </span>
                  <span
                    v-if="sub.group?.platform"
                    class="px-2 py-0.5 rounded-md border text-[11px] font-medium uppercase font-mono"
                    :class="platformAccentClass(sub.group?.platform)"
                  >
                    {{ sub.group.platform }}
                  </span>
                </div>
                <div v-if="sub.group?.description" class="text-xs text-black/50 dark:text-white/50 mt-0.5">
                  {{ sub.group.description }}
                </div>
                <div class="text-[11px] text-black/40 dark:text-white/40 mt-1 flex items-center gap-2 font-mono">
                  <span>倍率: ×{{ sub.group?.rate_multiplier ?? 1 }}</span>
                </div>
              </div>
            </div>

            <!-- Status badge & action -->
            <div class="flex items-center gap-2">
              <span
                class="px-2 py-0.5 rounded-full text-xs font-medium"
                :class="subscriptionStatus(sub) === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-black/5 dark:bg-white/10 text-black/50 dark:text-white/50'"
              >
                {{ statusLabel(sub) }}
              </span>
              <button
                v-if="subscriptionStatus(sub) === 'active' || subscriptionStatus(sub) === 'expired'"
                type="button"
                class="px-2.5 py-1 rounded-lg bg-[#007aff] hover:bg-[#0071e3] text-xs font-medium text-white shadow-xs transition-colors"
                @click="openWallet"
              >
                查看可购套餐
              </button>
            </div>
          </div>

          <!-- Usage Progress & Expiration -->
          <div class="p-4 space-y-4">
            <p v-if="!sub.group" class="text-xs text-[var(--text-secondary)]">分组信息暂未提供，无法判断额度上限。</p>
            <!-- Expiration Line -->
            <div class="flex items-center justify-between text-xs pb-1 border-b border-black/[0.04] dark:border-white/[0.04]">
              <span class="text-black/50 dark:text-white/50">到期时间</span>
              <span
                class="app-long-value font-mono text-right ml-3"
                :class="{
                  'text-red-600 dark:text-red-400 font-semibold': formatExpiration(sub.expires_at).isExpired,
                  'text-amber-600 dark:text-amber-400': formatExpiration(sub.expires_at).isWarning,
                  'text-black/80 dark:text-white/80': !formatExpiration(sub.expires_at).isWarning
                }"
              >
                {{ formatExpiration(sub.expires_at).text }}
              </span>
            </div>

            <!-- Daily Limit -->
            <div v-if="sub.group?.daily_limit_usd" class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-black/70 dark:text-white/70">每日</span>
                <span class="font-mono text-black/60 dark:text-white/60">
                  ${{ (sub.daily_usage_usd || 0).toFixed(2) }} / ${{ sub.group.daily_limit_usd.toFixed(2) }}
                </span>
              </div>
              <div class="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden relative">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="getProgressBarClass(sub.daily_usage_usd, sub.group.daily_limit_usd)"
                  :style="{ width: getProgressWidth(sub.daily_usage_usd, sub.group.daily_limit_usd) }"
                />
              </div>
              <div class="text-[10.5px] text-black/45 dark:text-white/45 font-mono">
                {{ dailyWindowLabel(sub) }}
              </div>
            </div>

            <!-- Weekly Limit -->
            <div v-if="sub.group?.weekly_limit_usd" class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-black/70 dark:text-white/70">每周</span>
                <span class="font-mono text-black/60 dark:text-white/60">
                  ${{ (sub.weekly_usage_usd || 0).toFixed(2) }} / ${{ sub.group.weekly_limit_usd.toFixed(2) }}
                </span>
              </div>
              <div class="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden relative">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="getProgressBarClass(sub.weekly_usage_usd, sub.group.weekly_limit_usd)"
                  :style="{ width: getProgressWidth(sub.weekly_usage_usd, sub.group.weekly_limit_usd) }"
                />
              </div>
              <div class="text-[10.5px] text-black/45 dark:text-white/45 font-mono">
                {{ formatResetCountdown(sub.weekly_window_start, 168) }}
              </div>
            </div>

            <!-- Monthly Limit -->
            <div v-if="sub.group?.monthly_limit_usd" class="space-y-1.5">
              <div class="flex items-center justify-between text-xs">
                <span class="font-medium text-black/70 dark:text-white/70">每月</span>
                <span class="font-mono text-black/60 dark:text-white/60">
                  ${{ (sub.monthly_usage_usd || 0).toFixed(2) }} / ${{ sub.group.monthly_limit_usd.toFixed(2) }}
                </span>
              </div>
              <div class="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden relative">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="getProgressBarClass(sub.monthly_usage_usd, sub.group.monthly_limit_usd)"
                  :style="{ width: getProgressWidth(sub.monthly_usage_usd, sub.group.monthly_limit_usd) }"
                />
              </div>
              <div class="text-[10.5px] text-black/45 dark:text-white/45 font-mono">
                {{ formatResetCountdown(sub.monthly_window_start, 720) }}
              </div>
            </div>

            <!-- Unlimited Quota Indicator -->
            <div
              v-if="sub.group && !sub.group.daily_limit_usd && !sub.group?.weekly_limit_usd && !sub.group?.monthly_limit_usd"
              class="flex items-center justify-center py-5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-emerald-500/5 border border-emerald-500/15"
            >
              <div class="flex items-center gap-3">
                <span class="text-3xl text-emerald-600 dark:text-emerald-400">∞</span>
                <div>
                  <div class="text-xs font-semibold text-emerald-700 dark:text-emerald-300">无限制</div>
                  <div class="text-[11px] text-emerald-600/70 dark:text-emerald-400/70">该订阅套餐未设置额度上限</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
    <footer class="subscription-status" role="status">{{ loading ? '正在刷新…' : `${filteredSubscriptions.length} 项订阅` }}<span v-if="selectedSubscription">已选择 #{{ selectedSubscription.id }}</span></footer>
  </div>
</template>

<style scoped>
.subscription-filterbar { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:9px 14px;border-bottom:1px solid var(--border-subtle);flex-shrink:0; }.subscription-filterbar :deep(.mac-search-field) { width:210px;max-width:100%; }
.subscription-split { display:flex;min-height:100%; }.subscription-list { width:210px;flex-shrink:0;padding:8px;border-right:1px solid var(--border-subtle);background:var(--sidebar-bg); }.subscription-list button { display:grid;gap:5px;width:100%;text-align:left;padding:10px;border-radius:7px;font-size:11px;margin-bottom:3px; }.subscription-list button[aria-pressed="true"] { background:var(--sidebar-selection); }.subscription-list button:focus-visible { outline:2px solid var(--accent);outline-offset:-2px; }.subscription-list-title { font-size:12px;font-weight:600;overflow-wrap:anywhere; }.subscription-list button>span:nth-child(2),.subscription-list small { color:var(--text-secondary);font-size:10px;overflow-wrap:anywhere; }
.subscription-detail { flex:1;min-width:0;padding:16px; }.subscription-status { display:flex;justify-content:space-between;gap:10px;padding:7px 14px;border-top:1px solid var(--border-subtle);font-size:10px;color:var(--text-secondary);flex-shrink:0; }
@container app-window (max-width:600px) { .subscription-split { flex-direction:column; }.subscription-list { width:100%;display:flex;overflow:auto;border-right:0;border-bottom:1px solid var(--border-subtle); }.subscription-list button { width:180px;flex-shrink:0; }.subscription-detail { padding:12px; }.subscription-detail .app-section-heading { flex-wrap:wrap;gap:10px; } }
</style>
