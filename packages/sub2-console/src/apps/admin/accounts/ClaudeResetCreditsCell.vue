<template>
  <div class="claude-reset-cell space-y-1">
    <!--
      与上游 ClaudeResetCreditsCell.vue 同行布局：父组件的用量区共用同一操作行。
      「次数」按钮只读查询；只有查询到可兑换额度、且操作员在二次确认中确认后，
      橙色「重置」按钮才会消耗一次重置（不可逆）。
    -->
    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-if="visible"
        type="button"
        data-testid="claude-reset-count"
        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
        :disabled="loading || redeeming"
        :title="countButtonTitle"
        @click="refresh"
      >
        <svg
          class="h-2.5 w-2.5"
          :class="{ 'animate-spin': loading }"
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
        次数<span v-if="status" class="ml-0.5 tabular-nums">{{ totalResets }}</span>
      </button>

      <button
        v-if="visible"
        type="button"
        data-testid="claude-reset-redeem"
        class="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-orange-600 transition-colors hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
        :disabled="redeeming || loading || !canRedeem"
        :title="redeemButtonTitle"
        @click="openRedeemConfirm"
      >
        <svg
          class="h-2.5 w-2.5"
          :class="{ 'animate-spin': redeeming }"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M20 12a8 8 0 11-2.343-5.657L20 8m0 0V4m0 4h-4"
          />
        </svg>
        重置
      </button>
    </div>

    <div v-if="visible && status && (primaryCredit || !status.eligible || cooldownActive)" class="flex flex-wrap items-center gap-1">
      <span
        v-if="primaryCredit?.expires_at"
        data-testid="claude-reset-expiry"
        class="inline-flex max-w-full items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] leading-4 text-gray-600 tabular-nums dark:bg-dark-800 dark:text-gray-300"
        :title="creditTitle"
      >
        到期 {{ formatTime(primaryCredit.expires_at, 'short') }}
      </span>
      <span
        v-if="status.eligible && totalResets > 0 && status.available_count === 0"
        data-testid="claude-reset-not-usable"
        class="text-[10px] text-gray-500 dark:text-gray-400"
      >
        暂不可用
      </span>
      <span v-if="!status.eligible" class="text-[10px] text-amber-600 dark:text-amber-400">
        此账号当前不可使用重置
      </span>
      <span v-if="cooldownActive" data-testid="claude-reset-cooldown" class="text-[10px] text-amber-600 dark:text-amber-400">
        冷却至 {{ formatTime(status.cooldown_until!, 'short') }}
      </span>
      <span
        v-if="primaryCredit?.blocking?.length"
        data-testid="claude-reset-blocking"
        class="text-[10px] font-medium text-red-600 dark:text-red-400"
        :title="blockingTitle"
      >
        暂不可兑换（受阻：{{ windowLabels(primaryCredit.blocking) }}）
      </span>
    </div>

    <div v-if="visible && status && status.weekly_resets_at" class="flex flex-wrap items-center gap-1">
      <span
        data-testid="claude-reset-weekly"
        class="inline-flex max-w-full items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] leading-4 text-gray-600 tabular-nums dark:bg-dark-800 dark:text-gray-300"
        :title="`每周重置时间（推测）：${formatTime(status.weekly_resets_at, 'full')}`"
      >
        每周重置（推测） {{ formatTime(status.weekly_resets_at, 'short') }}
      </span>
    </div>

    <details v-if="visible && status && status.credits.length" class="text-[10px] text-gray-500 dark:text-gray-400">
      <summary class="cursor-pointer text-blue-600 dark:text-blue-400">重置额度详情</summary>
      <ul class="mt-1 space-y-1">
        <li v-for="(credit, index) in status.credits" :key="`${credit.label}-${index}`" class="break-words">
          <span class="font-medium text-gray-600 dark:text-gray-300">{{ credit.label }}</span>
          <span>：剩余 {{ credit.resets_left }} 次</span>
          <span v-if="credit.starts_at"> · 生效 {{ formatTime(credit.starts_at, 'short') }}</span>
          <span v-if="credit.expires_at"> · 到期 {{ formatTime(credit.expires_at, 'short') }}</span>
          <span v-if="credit.clears.length"> · 可清除 {{ windowLabels(credit.clears) }}</span>
          <span v-if="percentUsedText(credit)"> · 已用 {{ percentUsedText(credit) }}</span>
          <span> · {{ credit.redeemable ? '可兑换' : '不可用' }}</span>
          <span v-if="credit.use_requires_limit"> · 需达到限额后才能使用</span>
          <span v-if="credit.blocking.length" class="font-medium text-red-600 dark:text-red-400"> · 受阻，暂不可兑换：{{ windowLabels(credit.blocking) }}</span>
        </li>
      </ul>
    </details>

    <div v-if="visible && error" role="alert" class="text-[10px] text-red-600 dark:text-red-400">
      无法查询重置次数
    </div>
    <div
      v-if="visible && redeemFeedback"
      data-testid="claude-reset-feedback"
      :role="redeemFeedback.kind === 'success' ? 'status' : 'alert'"
      class="text-[10px]"
      :class="feedbackClass"
      :title="redeemFeedback.text"
    >
      {{ redeemFeedback.text }}
    </div>

    <MacAlertSheet
      v-if="visible"
      :show="showRedeemConfirm"
      title="确认使用 Claude 重置"
      :message="confirmMessage"
      danger
      confirm-text="重置"
      cancel-text="取消"
      :loading="redeeming"
      @confirm="confirmRedeem"
      @cancel="showRedeemConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MacAlertSheet } from '@sub2-mac/core'
import {
  getClaudeResetCredits,
  redeemClaudeResetCredit
} from '@/api/admin/claudeResetCredits'
import type { Account, ClaudeResetCredit, ClaudeResetCredits, ClaudeResetOutcome } from '@/types'

const props = defineProps<{ account: Account }>()
// Fired after a redemption attempt so the parent can refresh the usage row.
const emit = defineEmits<{ redeemed: [outcome: ClaudeResetOutcome] }>()
const status = ref<ClaudeResetCredits | null>(null)
const loading = ref(false)
const error = ref(false)
const redeeming = ref(false)
const showRedeemConfirm = ref(false)
const redeemFeedback = ref<{ kind: 'success' | 'warning' | 'error'; text: string } | null>(null)
// One key per operator confirmation. It survives a failed request so retrying the
// same confirmation replays server-side instead of claiming a second reset.
let pendingKey: string | null = null
let generation = 0

const visible = computed(() => props.account.platform === 'anthropic' && props.account.type === 'oauth')

watch(() => [props.account.id, props.account.platform, props.account.type], () => {
  generation++
  status.value = null
  loading.value = false
  error.value = false
  redeeming.value = false
  showRedeemConfirm.value = false
  redeemFeedback.value = null
  pendingKey = null
})

// 与 OpenAIQuotaResetCell 的到期时间格式保持一致
const formatTime = (value: string, style: 'short' | 'full'): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const options: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  if (style === 'full') options.year = 'numeric'
  return new Intl.DateTimeFormat(undefined, options).format(date)
}

// 与 Codex 的「次数」一致：显示持有的剩余次数，而不是此刻可兑换的次数
const totalResets = computed(() => (status.value?.credits ?? []).reduce((sum, c) => sum + c.resets_left, 0))

// 优先展示下一张会被使用的券（仅它可能 redeemable），否则取最早到期的一张
const primaryCredit = computed(() => {
  const credits = status.value?.credits ?? []
  return credits.find(c => c.redeemable) ?? [...credits].sort((a, b) => expiryMs(a.expires_at) - expiryMs(b.expires_at))[0] ?? null
})

// 缺失或无法解析的到期时间排在最后
function expiryMs(value?: string): number {
  const ms = value ? new Date(value).getTime() : NaN
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

// 仅在冷却时间仍在未来时提示（后端已清理过期值，这里防御性再判断一次）
const cooldownActive = computed(() => {
  const until = status.value?.cooldown_until
  return !!until && new Date(until).getTime() > Date.now()
})

// weekly_resets_at：后端自 Anthropic cedar_ember 用量块原样透传的顶层字段
// （backend/internal/service/claude_reset_credits.go:39,62,199），上游未给字段定义、
// 上游前端只在类型里声明、从不在任何页面渲染（无别处展示）。
// 按字段名理解为下一次每周重置时间（推断，未证实），仅在后端返回时展示，用 formatTime 按本地时区格式化。

const creditTitle = computed(() => {
  const credit = primaryCredit.value
  if (!credit) return ''
  const lines = [credit.label]
  if (credit.expires_at) lines.push(`重置次数到期时间：${formatTime(credit.expires_at, 'full')}`)
  if (credit.clears.length) lines.push(`可清除窗口：${windowLabels(credit.clears)}`)
  if (credit.use_requires_limit) lines.push('需达到限额后才能使用')
  if (credit.blocking.length) lines.push(`受阻，暂不可兑换：${windowLabels(credit.blocking)}`)
  return lines.join('\n')
})

// blocking：后端自 Anthropic cedar_ember 用量块原样透传的每张卡受阻原因
// （backend/internal/service/claude_reset_credits.go:29,54,212；
// claudeResetGrantRedeemable 要求 len(blocking)==0，任一受阻值都会使该卡不可兑换，
// 兑换侧同样以 CLAUDE_RESET_NOT_AVAILABLE 拒绝且不发兑换请求）。
// 取值是不透明的上游字符串（后端无枚举；测试用例里出现过 "seven_day" 与 "x"），
// 已知窗口名按 windowLabels 翻译，未知值原样展示，不猜含义。
const blockingTitle = computed(() => {
  const credit = primaryCredit.value
  if (!credit?.blocking?.length) return ''
  return `该重置卡当前受阻，暂不可兑换：${windowLabels(credit.blocking)}`
})

// 已知窗口显示为可读名称，未知窗口原样显示
const windowKeys: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  seven_day_overage_included: '7d 超额'
}
function windowLabels(windows?: string[]): string {
  return (windows ?? []).map(w => windowKeys[w] ?? w).join(', ')
}

// percent_used 按窗口原样展示，不推断窗口语义
function percentUsedText(credit: ClaudeResetCredit): string {
  return Object.entries(credit.percent_used ?? {})
    .map(([window, value]) => `${windowKeys[window] ?? window} ${value}%`)
    .join('、')
}

const countButtonTitle = computed(() => {
  if (!status.value) return '点击查询 Claude 剩余重置次数（只读，不会消耗）'
  return [
    '点击刷新 Claude 剩余重置次数（只读，不会消耗）',
    `查询时间：${formatTime(status.value.fetched_at, 'full')}`
  ].join('\n')
})

const canRedeem = computed(() => (status.value?.available_count ?? 0) > 0)

const redeemButtonTitle = computed(() => {
  if (!status.value) return '请先点「次数」查询；查询到可用的重置后才能使用'
  if (!canRedeem.value) return '当前没有可立即使用的重置'
  return '消耗 1 次重置，清除限额窗口（需确认）'
})

const confirmMessage = computed(() => {
  const next = status.value?.credits.find(c => c.redeemable)
  return `将消耗 1 次重置次数，立即恢复 ${windowLabels(next?.clears) || '—'} 窗口，剩余 ${Math.max(totalResets.value - 1, 0)} 次。此操作不可逆，消耗后无法恢复，确定继续吗？`
})

const feedbackClass = computed(() => {
  switch (redeemFeedback.value?.kind) {
    case 'success': return 'text-emerald-600 dark:text-emerald-400'
    case 'warning': return 'text-amber-600 dark:text-amber-400'
    default: return 'text-red-600 dark:text-red-400'
  }
})

function newOperationKey(accountID: number): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `claude-reset-${accountID}-${id}`
}

function openRedeemConfirm() {
  if (redeeming.value || loading.value || !canRedeem.value) return
  showRedeemConfirm.value = true
}

function outcomeFeedback(result: ClaudeResetOutcome): { kind: 'success' | 'warning' | 'error'; text: string } {
  switch (result.outcome) {
    case 'reset':
      return { kind: 'success', text: `重置成功，已清除：${windowLabels(result.cleared) || '—'}` }
    case 'already_used':
      return { kind: 'warning', text: '该重置已被使用，正在刷新确认' }
    case 'cooldown':
      return {
        kind: 'warning',
        text: result.cooldown_until
          ? `重置处于冷却中，冷却至 ${formatTime(result.cooldown_until, 'short')}`
          : '重置处于冷却中，请稍后再试'
      }
    case 'not_limited':
      return { kind: 'warning', text: '当前未达到限额，无需重置，未消耗次数' }
    case 'ineligible':
      return { kind: 'error', text: '此账号当前不可使用重置' }
    default:
      if (result.reason === 'upstream_unavailable') return { kind: 'warning', text: '重置服务暂时不可用，未确认消耗，请稍后再试' }
      return { kind: 'warning', text: '结果未确认，已阻止再次兑换，请稍后查询' }
  }
}

// Refusals issued before any claim was sent: the next attempt is a new confirmation.
const preClaimRefusals = new Set(['CLAUDE_RESET_BUSY', 'CLAUDE_RESET_NOT_AVAILABLE', 'CLAUDE_RESET_UNRESOLVED', 'CLAUDE_RESET_UPSTREAM_UNAVAILABLE'])

function errorText(e: unknown): string {
  const err = e as { reason?: string; message?: string }
  switch (err?.reason) {
    case 'CLAUDE_RESET_UNRESOLVED': return '结果未确认，已阻止再次兑换，请稍后查询'
    case 'CLAUDE_RESET_BUSY': return '另一个重置正在进行中，请稍后再试'
    case 'CLAUDE_RESET_NOT_AVAILABLE': return '当前没有可立即使用的重置，未消耗次数'
    case 'CLAUDE_RESET_UPSTREAM_UNAVAILABLE': return '重置服务暂时不可用，未确认消耗，请稍后再试'
    case 'IDEMPOTENCY_IN_PROGRESS': return '该重置请求仍在处理中，请稍后查询结果'
    case 'IDEMPOTENCY_RETRY_BACKOFF': return '该重置请求刚刚失败，请稍后再试'
    default: return err?.message || '重置请求失败'
  }
}

async function confirmRedeem() {
  showRedeemConfirm.value = false
  if (redeeming.value || loading.value || !canRedeem.value) return
  const accountID = props.account.id
  const current = generation
  pendingKey ??= newOperationKey(accountID)
  redeeming.value = true
  redeemFeedback.value = null
  try {
    const result = await redeemClaudeResetCredit(accountID, pendingKey)
    if (current !== generation) return
    // A definite server answer ends this confirmation; the next one gets a new key.
    pendingKey = null
    redeemFeedback.value = outcomeFeedback(result)
    redeeming.value = false
    emit('redeemed', result)
    await refresh()
  } catch (e) {
    if (current !== generation) return
    // Transport or unknown errors keep the key so a retry replays server-side.
    if (preClaimRefusals.has((e as { reason?: string })?.reason ?? '')) pendingKey = null
    redeemFeedback.value = { kind: 'error', text: errorText(e) }
  } finally {
    if (current === generation) redeeming.value = false
  }
}

async function refresh() {
  if (loading.value || redeeming.value) return
  const current = ++generation
  loading.value = true
  error.value = false
  try {
    const result = await getClaudeResetCredits(props.account.id)
    if (current === generation) status.value = result
  } catch {
    if (current === generation) { error.value = true; status.value = null }
  } finally {
    if (current === generation) loading.value = false
  }
}
</script>
