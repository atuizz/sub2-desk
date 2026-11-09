<template>
  <div
    v-if="state?.eligible"
    class="opencode-go-cell min-w-0 max-w-full space-y-1"
    data-testid="opencode-go-usage-cell"
  >
    <div
      v-for="window in windows"
      v-show="window.value"
      :key="window.key"
      data-testid="opencode-go-window"
      class="space-y-0.5"
    >
      <div class="flex items-baseline justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
        <span>{{ window.label }}</span>
        <span class="tabular-nums">已用 {{ formatPercent(window.value!.percent) }}<span v-if="window.value!.resets_at">，{{ formatTime(window.value!.resets_at) }} 重置</span></span>
      </div>
      <div class="h-1 overflow-hidden rounded bg-black/10 dark:bg-white/15" role="progressbar" :aria-valuenow="window.value!.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="`${window.label}用量`">
        <div class="h-full rounded" :class="window.bar" :style="{ width: `${Math.min(100, Math.max(0, window.value!.percent))}%` }" />
      </div>
    </div>
    <span
      v-if="snapshot && snapshot.status !== 'ok'"
      class="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium"
      :class="snapshot.status === 'unauthorized'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'"
      data-testid="opencode-go-status-badge"
      :title="snapshot.last_error || ''"
    >
      {{ statusLabel }}
    </span>
    <p v-if="snapshot?.fetched_at" class="text-[10px] text-gray-400 dark:text-gray-500">
      更新时间 {{ formatTime(snapshot.fetched_at) }}
    </p>
    <p v-else-if="state" class="text-[10px] text-gray-400 dark:text-gray-500">
      尚未刷新
    </p>
    <p v-if="errorText" role="alert" class="text-[10px] text-red-600 dark:text-red-400">{{ errorText }}</p>
    <div class="flex flex-wrap items-center gap-1.5 pt-0.5">
      <button
        type="button"
        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
        :disabled="refreshing"
        data-testid="opencode-go-usage-query"
        @click="refreshUsage"
      >
        <svg
          class="h-2.5 w-2.5"
          :class="{ 'animate-spin': refreshing }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        查询
      </button>
      <label class="inline-flex cursor-pointer items-center gap-1 text-[10px] text-gray-500 dark:text-gray-400">
        <input
          type="checkbox"
          data-testid="opencode-go-auto-refresh"
          :checked="state.auto_refresh_enabled"
          :disabled="refreshing || savingAutoRefresh"
          @change="toggleAutoRefresh(($event.target as HTMLInputElement).checked)"
        />
        自动刷新用量
      </label>
    </div>
    <p class="text-[10px] text-gray-400 dark:text-gray-500">只有账号开关和全局开关同时启用时才会定时刷新。</p>
  </div>
  <span v-else-if="state" class="text-sm text-gray-400 dark:text-dark-500">-</span>
  <div v-else class="opencode-go-cell min-w-0 max-w-full space-y-1" data-testid="opencode-go-usage-cell">
    <p class="text-[10px] text-gray-400 dark:text-gray-500">尚未读取用量</p>
    <p v-if="errorText" role="alert" class="text-[10px] text-red-600 dark:text-red-400">{{ errorText }}</p>
    <button
      type="button"
      class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
      :disabled="refreshing"
      data-testid="opencode-go-usage-query"
      @click="loadInitial"
    >
      查询
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  getOpenCodeGoUsage,
  refreshOpenCodeGoUsage,
  setOpenCodeGoUsageAutoRefresh
} from '@/api/admin/accounts'
import type { Account, OpenCodeGoUsageState, OpenCodeGoUsageWindow } from '@/types'

const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ updated: [state: OpenCodeGoUsageState] }>()
const state = ref(props.account.opencode_go_usage)
const refreshing = ref(false)
const savingAutoRefresh = ref(false)
const errorText = ref('')
const snapshot = computed(() => state.value?.snapshot)
const statusLabel = computed(() => {
  if (snapshot.value?.status === 'unauthorized') return '会话已过期'
  if (snapshot.value?.status === 'failed') return '刷新失败'
  return '正常'
})
const windows = computed<Array<{ key: string; label: string; bar: string; value?: OpenCodeGoUsageWindow }>>(() => [
  { key: 'rolling', label: '5h', bar: 'bg-indigo-500', value: snapshot.value?.data?.rolling },
  { key: 'weekly', label: '7d', bar: 'bg-emerald-500', value: snapshot.value?.data?.weekly },
  { key: 'monthly', label: '1m', bar: 'bg-amber-500', value: snapshot.value?.data?.monthly }
])

watch(() => props.account.opencode_go_usage, (next) => {
  state.value = next
})

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

function readRefreshError(e: unknown): string {
  const err = e as {
    status?: number
    code?: string
    reason?: string
    message?: string
    retry_after_seconds?: number
    response?: { status?: number; data?: { code?: string; message?: string; retry_after_seconds?: number } }
  }
  const code = err?.response?.data?.code ?? err?.code ?? err?.reason ?? ''
  if (code === 'OPENCODE_GO_USAGE_REFRESH_RATE_LIMITED') {
    const seconds = err?.response?.data?.retry_after_seconds ?? err?.retry_after_seconds
    return typeof seconds === 'number' ? `刷新过于频繁，请在 ${seconds} 秒后重试。` : '刷新过于频繁，请稍后重试。'
  }
  if ((err?.response?.status ?? err?.status) === 403 || code === 'forbidden') {
    return '上游返回 403：可能是订阅缺失/失效，也可能是 WAF 或访问策略拦截，请结合网络路径与 HTTP 状态排查。'
  }
  return err?.response?.data?.message || err?.message || '刷新 OpenCode Go 用量失败'
}

async function refreshUsage() {
  if (refreshing.value) return
  refreshing.value = true
  errorText.value = ''
  try {
    const next = await refreshOpenCodeGoUsage(props.account.id)
    state.value = next
    emit('updated', next)
  } catch (e) {
    errorText.value = readRefreshError(e)
  } finally {
    refreshing.value = false
  }
}

async function toggleAutoRefresh(enabled: boolean) {
  if (savingAutoRefresh.value || refreshing.value || !state.value) return
  const previous = state.value.auto_refresh_enabled
  if (previous === enabled) return
  savingAutoRefresh.value = true
  errorText.value = ''
  try {
    const next = await setOpenCodeGoUsageAutoRefresh(props.account.id, enabled)
    state.value = next
    emit('updated', next)
  } catch {
    errorText.value = '更新自动刷新设置失败'
  } finally {
    savingAutoRefresh.value = false
  }
}

// 列表未返回用量状态时（state 缺失），点「查询」用只读 GET 拉取一次；
// POST 刷新会返回最新快照，平时不需要再调 GET。
async function loadInitial() {
  if (state.value || refreshing.value) return
  refreshing.value = true
  errorText.value = ''
  try {
    const next = await getOpenCodeGoUsage(props.account.id)
    state.value = next
    emit('updated', next)
  } catch (e) {
    errorText.value = readRefreshError(e)
  } finally {
    refreshing.value = false
  }
}
</script>
