<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted } from 'vue';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';
import { useAuthStore } from '../../stores/auth';
import { redeemAPI, type RedeemHistoryItem } from '../../api/redeem';
import { formatDateTime } from '../../utils/format';

defineProps<{
  win?: WindowInstance;
}>();

const authStore = useAuthStore();
const user = computed(() => authStore.user);

const redeemCode = ref('');
const submitting = ref(false);
const redeemResult = ref<{
  message: string;
  type: string;
  value: number;
  new_balance?: number;
  new_concurrency?: number;
  group_name?: string;
  validity_days?: number;
} | null>(null);
const errorMessage = ref('');

const history = ref<RedeemHistoryItem[]>([]);
const loadingHistory = ref(false);
const historyError = ref('');

async function handleRedeem() {
  const code = redeemCode.value.trim();
  if (!code || submitting.value) return;

  submitting.value = true;
  redeemResult.value = null;
  errorMessage.value = '';

  try {
    const res = await redeemAPI.redeem(code);
    redeemResult.value = res;
    redeemCode.value = '';
    // Refresh user profile for updated balance/concurrency
    await authStore.fetchCurrentUser();
    // Refresh history
    await loadHistory();
  } catch (err: any) {
    console.error('Redeem failed:', err);
    errorMessage.value = err?.response?.data?.message || err?.message || '兑换失败，请检查兑换码后重试。';
  } finally {
    submitting.value = false;
  }
}

async function loadHistory() {
  loadingHistory.value = true;
  historyError.value = '';
  try {
    const data = await redeemAPI.getHistory();
    history.value = data || [];
  } catch (err) {
    historyError.value = '兑换记录加载失败。';
    console.error('Failed to load redeem history:', err);
    history.value = [];
  } finally {
    loadingHistory.value = false;
  }
}

function refreshAll() {
  authStore.fetchCurrentUser();
  loadHistory();
}

function isBalanceType(type: string): boolean {
  return type === 'balance' || type.includes('balance');
}

function isSubscriptionType(type: string): boolean {
  return type === 'subscription' || type.includes('subscription');
}

function getHistoryItemTitle(item: RedeemHistoryItem): string {
  if (item.type === 'balance') return '余额充值（卡密兑换）';
  if (item.type === 'concurrency') return '并发提升（卡密兑换）';
  if (item.type === 'subscription') {
    return item.group?.name ? '专属订阅 - ' + item.group.name : '订阅已指派';
  }
  if (item.type === 'admin_balance_add') return '管理员余额入账';
  if (item.type === 'admin_balance_deduct') return '管理员余额扣除';
  if (item.type === 'admin_concurrency_add') return '并发提升（管理员）';
  if (item.type === 'admin_concurrency_reduce') return '并发削减（管理员）';
  if (item.type === 'affiliate_transfer') return '推广联盟返利转入';
  return item.type;
}

function formatHistoryValue(item: RedeemHistoryItem): string {
  if (isBalanceType(item.type)) {
    return (item.value >= 0 ? '+$' : '-$') + Math.abs(item.value).toFixed(2);
  }
  if (isSubscriptionType(item.type)) {
    return (item.validity_days || 0) + ' 天有效期';
  }
  return (item.value >= 0 ? '+' : '') + item.value;
}

onMounted(() => {
  loadHistory();
});
</script>

<template>
  <div class="user-app-polish voucher-app h-full flex flex-col bg-[#f6f6f8] dark:bg-[#1e1e20] text-[#1d1d1f] dark:text-[#f5f5f7] select-none text-[13px] overflow-hidden font-sans">
    <!-- macOS AppKit Style Window Header -->
    <div class="app-toolbar h-12 px-5 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-white/70 dark:bg-[#28282a]/70 backdrop-blur-xl shrink-0 z-10">
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('voucher')" alt="卡券兑换" class="w-7 h-7 object-contain drop-shadow-sm" />
        <div>
          <h1 class="app-title">卡券兑换</h1>
          <div class="text-[10.5px] text-black/45 dark:text-white/45">输入充值卡密、优惠码以即时充值余额或开通订阅</div>
        </div>
      </div>

      <!-- User Balance & Concurrency Capsule -->
      <div class="app-actions">
        <div class="flex items-center gap-3 px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.08] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono">
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] text-black/45 dark:text-white/45">当前余额</span>
            <span class="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">${{ (user?.balance || 0).toFixed(2) }}</span>
          </div>
          <div class="w-px h-3 bg-black/10 dark:bg-white/10"></div>
          <div class="flex items-center gap-1.5">
            <span class="text-[11px] text-black/45 dark:text-white/45">并发配额</span>
            <span class="font-semibold text-[#007aff] dark:text-[#0a84ff] tabular-nums">{{ user?.concurrency || 5 }}</span>
          </div>
        </div>

        <button
          @click="refreshAll"
          :disabled="loadingHistory || submitting"
          class="w-7 h-7 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center text-black/65 dark:text-white/75"
          title="刷新账户资产与记录"
        >
          <svg class="w-3.5 h-3.5" :class="loadingHistory ? 'animate-spin' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Main Content Area: Split View (Upper Redeem Card + Lower NSTableView) -->
    <div class="voucher-body flex-1 flex flex-col overflow-hidden">
      <!-- Upper Section: Apple Gift Card Hologram & Redeem Input -->
      <div class="voucher-entry p-6 border-b border-black/[0.06] dark:border-white/[0.06] bg-gradient-to-b from-black/[0.015] to-transparent shrink-0">
        <div class="max-w-xl mx-auto flex flex-col items-center">
          <!-- Authentic Apple Style Gift Card -->
          <div class="w-full max-w-[420px] h-[160px] rounded-[18px] bg-gradient-to-tr from-[#1f2329] via-[#2a2f38] to-[#141619] p-5 text-white shadow-xl relative overflow-hidden border border-white/15 mb-5 select-none transition-transform hover:scale-[1.01] duration-300">
            <!-- Holographic Sheen Reflection -->
            <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(255,255,255,0.22),transparent_65%)] pointer-events-none"></div>
            <div class="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/40 to-transparent pointer-events-none"></div>

            <div class="relative z-10 flex flex-col justify-between h-full">
              <!-- Card Header -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <div class="w-7 h-7 rounded-lg bg-white/15 backdrop-blur-md flex items-center justify-center border border-white/20">
                    <svg class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.85c.66-.82 1.11-1.96.99-3.1-.96.04-2.12.64-2.8 1.44-.6.69-1.12 1.83-.98 2.95 1.08.08 2.13-.56 2.79-1.29z"/>
                    </svg>
                  </div>
                  <span class="text-xs font-semibold tracking-wider text-white/90">SUB2API DEVELOPER CARD</span>
                </div>
                <!-- Chip Graphic -->
                <div class="w-8 h-6 rounded bg-gradient-to-r from-amber-200 to-amber-400 border border-amber-500/40 opacity-85 flex items-center justify-center">
                  <div class="w-6 h-4 border-y border-amber-700/30"></div>
                </div>
              </div>

              <!-- Card Number/Code Display -->
              <div class="space-y-1">
                <div class="text-[10px] text-white/50 tracking-widest font-mono uppercase">Voucher Passcode</div>
                <div class="app-long-value text-[17px] font-mono tracking-widest font-semibold text-white/95">
                  {{ redeemCode ? redeemCode.toUpperCase() : '•••• •••• •••• ••••' }}
                </div>
              </div>

              <!-- Card Footer -->
              <div class="flex items-center justify-between text-[10px] text-white/60 font-mono">
                <span>ACCOUNT: {{ user?.email || 'DEVELOPER' }}</span>
                <span>INSTANT SETTLEMENT</span>
              </div>
            </div>
          </div>

          <!-- Apple Style Code Input Field & Action Button -->
          <div class="w-full max-w-[420px] flex items-center gap-2">
            <div class="relative flex-1">
              <input
                v-model="redeemCode"
                type="text"
                placeholder="输入兑换码" aria-label="兑换码" autocomplete="off" spellcheck="false"
                :disabled="submitting"
                class="w-full h-9 pl-3.5 pr-8 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-black/30 text-xs font-mono tracking-wider uppercase text-black dark:text-white placeholder:text-black/35 dark:placeholder:text-white/35 focus:outline-none focus:ring-2 focus:ring-[#007aff]/40 focus:border-[#007aff] transition-all shadow-xs"
                @keydown.enter.prevent="handleRedeem"
              />
              <button
                v-if="redeemCode"
                @click="redeemCode = ''"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 text-xs"
              >
                ✕
              </button>
            </div>

            <button
              type="button"
              :disabled="!redeemCode.trim() || submitting"
              @click="handleRedeem"
              class="h-9 px-5 rounded-lg bg-[#007aff] hover:bg-[#0062cc] active:bg-[#0051a8] disabled:opacity-40 disabled:pointer-events-none text-white font-medium text-xs flex items-center justify-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
            >
              <svg v-if="submitting" class="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle class="opacity-25" cx="12" cy="12" r="10" />
                <path class="opacity-75" d="M4 12a8 8 0 018-8v8H4z" fill="currentColor" />
              </svg>
              <span>{{ submitting ? '正在兑换...' : '立即兑换' }}</span>
            </button>
          </div>

          <!-- Native macOS Status Feedback Toast / Alert -->
          <div v-if="redeemResult" class="mt-3.5 w-full max-w-[420px] p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2.5 animate-in fade-in slide-in-from-top-1">
            <svg class="w-4 h-4 text-emerald-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div class="flex-1 truncate">
              <span class="font-semibold">兑换成功：</span>
              <span>{{ redeemResult.message }}</span>
              <span v-if="redeemResult.type === 'balance'" class="font-bold ml-1">+${{ (redeemResult.value || 0).toFixed(2) }}</span>
            </div>
          </div>

          <div v-if="errorMessage" class="mt-3.5 w-full max-w-[420px] p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs flex items-center gap-2.5 animate-in fade-in slide-in-from-top-1">
            <svg class="w-4 h-4 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span class="flex-1">{{ errorMessage }}</span>
          </div>
        </div>
      </div>

      <!-- Lower Section: Full-Width Native macOS NSTableView (Redemption Records) -->
      <div class="voucher-history flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1a1a1c]">
        <!-- Table Section Header -->
        <div class="px-5 py-2.5 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between bg-black/[0.015] dark:bg-white/[0.02]">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-xs text-black/80 dark:text-white/80">兑换流水与入账记录</span>
            <span class="px-1.5 py-0.2 rounded text-[10.5px] font-mono bg-black/[0.05] dark:bg-white/[0.08] text-black/60 dark:text-white/60">
              共 {{ history.length }} 笔
            </span>
          </div>
          <span class="text-[11px] text-black/40 dark:text-white/40">支持卡密、优惠码及返利转入记录</span>
        </div>

        <!-- Table Container -->
        <div class="app-table-scroll flex-1 overflow-y-auto">
          <div v-if="historyError" class="app-notice" data-tone="error" role="alert"><span>{{ historyError }}</span><button @click="loadHistory" :disabled="loadingHistory">重试</button></div>
          <div v-if="loadingHistory" class="app-empty" role="status">正在读取兑换记录…</div>
          <!-- Empty State -->
          <div v-else-if="history.length === 0 && !historyError" class="h-48 flex flex-col items-center justify-center text-center p-6 text-black/40 dark:text-white/40">
            <img src="/assets/voucher.png" alt="Empty" class="w-10 h-10 object-contain opacity-30 grayscale mb-2" />
            <div class="text-xs font-medium">暂无兑换记录</div>
            <div class="text-[11px] text-black/35 dark:text-white/35 mt-0.5">在上方输入兑换码即可为当前账户充值</div>
          </div>

          <!-- Native macOS NSTableView Structure -->
          <table v-else-if="history.length" class="app-table w-full min-w-[660px] text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.03] text-[11px] font-semibold text-black/55 dark:text-white/55 sticky top-0 backdrop-blur-md z-10">
                <th class="px-5 py-2">业务类型</th>
                <th class="px-4 py-2">关联卡密 / 代号</th>
                <th class="px-4 py-2">变动额度</th>
                <th class="px-4 py-2">生效状态</th>
                <th class="px-5 py-2 text-right">交易时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04] text-[12.5px]">
              <tr
                v-for="item in history"
                :key="item.id"
                class="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <!-- Title / Type -->
                <td class="px-5 py-2.5 font-medium text-black/90 dark:text-white/90">
                  <div class="flex items-center gap-2">
                    <span
                      class="w-1.5 h-1.5 rounded-full"
                      :class="isBalanceType(item.type) ? 'bg-emerald-500' : isSubscriptionType(item.type) ? 'bg-purple-500' : 'bg-blue-500'"
                    ></span>
                    <span>{{ getHistoryItemTitle(item) }}</span>
                  </div>
                </td>

                <!-- Code / Identifier -->
                <td class="px-4 py-2.5 font-mono text-[11.5px] text-black/60 dark:text-white/60">
                  {{ item.code || '-' }}
                </td>

                <!-- Value -->
                <td class="px-4 py-2.5 font-mono font-semibold tabular-nums">
                  <span :class="isBalanceType(item.type) ? (item.value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500') : 'text-[#007aff] dark:text-[#0a84ff]'">
                    {{ formatHistoryValue(item) }}
                  </span>
                </td>

                <!-- Status Pill -->
                <td class="px-4 py-2.5">
                  <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    已入账
                  </span>
                </td>

                <!-- Time -->
                <td class="px-5 py-2.5 text-right font-mono text-[11px] text-black/45 dark:text-white/45">
                  {{ formatDateTime(item.created_at) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
