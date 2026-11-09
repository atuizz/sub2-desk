<template>
  <section
    data-testid="grok-model-diagnostics"
    class="min-w-0 max-w-full overflow-hidden rounded-xl border border-gray-200 bg-white text-sm text-gray-700 dark:border-dark-600 dark:bg-dark-800 dark:text-gray-200"
  >
    <div
      data-testid="grok-diagnostics-summary"
      class="flex flex-wrap items-center justify-between gap-3 p-4"
    >
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">
            上游模型目录
          </h3>
          <p data-testid="grok-diagnostics-state" :class="stateClass">{{ headline }}</p>
        </div>
        <p class="mt-1 text-xs text-gray-500 dark:text-dark-400">
          <span v-if="modelCountLabel">{{ modelCountLabel }}</span>
          <span v-if="catalogHost">{{ modelCountLabel ? ' · ' : '' }}{{ catalogHost }}</span>
          <span data-testid="grok-diagnostics-last-success">
            {{ modelCountLabel || catalogHost ? ' · ' : '' }}上次成功：{{ lastSuccessRelative }}
          </span>
        </p>
      </div>
      <button
        v-if="canSync"
        type="button"
        data-testid="grok-diagnostics-sync"
        class="rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/10"
        title="同步已保存配置的上游目录"
        aria-label="同步目录 — 同步已保存配置的上游目录"
        :disabled="syncing || loading"
        @click="requestSync"
      >
        {{ syncing ? '正在加载…' : '同步目录' }}
      </button>
    </div>

    <p v-if="loading" class="px-4 pb-3 text-xs text-gray-500 dark:text-dark-400">
      正在加载…
    </p>
    <p
      v-if="refreshFailed"
      data-testid="grok-diagnostics-refresh-failed"
      class="px-4 pb-3 text-xs text-red-600 dark:text-red-400"
    >
      无法获取最新状态
    </p>

    <div
      v-if="showFailureNotice || showFallbackNotice || showStateNotice || showPreviousValid"
      class="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <p v-if="showFailureNotice" class="flex items-start gap-2">
        <span aria-hidden="true" class="mt-0.5 shrink-0 font-bold">!</span>
        <span>{{ attemptErrorLabel }}</span>
      </p>
      <p v-if="showFallbackNotice" class="flex items-start gap-2">
        <span aria-hidden="true" class="mt-0.5 shrink-0 font-bold">!</span>
        <span>本次未获得实时目录，仅用已配置模型补充能力信息。</span>
      </p>
      <p v-if="showPreviousValid">上次成功的目录仍在有效期内。</p>
      <p v-if="effectiveState === 'stale'">目录已过期，重新同步后再比较映射。</p>
      <p v-if="effectiveState === 'source_changed'">来源已变更，请重新同步。</p>
      <p v-if="effectiveState === 'unknown'">暂无可信目录，不能判断当前映射差异。</p>
    </div>

    <div
      v-if="missingMappings.length > 0"
      class="mx-4 mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-200"
    >
      <p data-testid="grok-diagnostics-missing-summary" class="flex items-start gap-2">
        <span aria-hidden="true" class="mt-0.5 shrink-0 font-bold">!</span>
        <span>{{ missingMappings.length }} 个映射目标未在当前目录中发现</span>
      </p>
      <p class="mt-1">仅作提醒，不会阻断请求或删除映射。</p>
      <button
        type="button"
        data-testid="grok-diagnostics-difference-toggle"
        class="mt-2 inline-flex items-center gap-1 font-medium"
        :aria-expanded="differencesOpen"
        :aria-controls="differencesId"
        @click="differencesOpen = !differencesOpen"
      >
        <span aria-hidden="true" class="inline-block transition-transform" :class="differencesOpen ? 'rotate-90' : ''">›</span>
        {{ differencesOpen ? '收起差异' : '查看差异' }}
      </button>
      <div
        v-if="differencesOpen"
        :id="differencesId"
        data-testid="grok-diagnostics-difference-list"
        class="mt-2 space-y-2"
      >
        <p>未在该账号此端点的当前目录中发现 请求不会被阻断</p>
        <p v-if="attemptStatus === 'configured_fallback'">
          上次成功：{{ lastSuccessRelative }}
        </p>
        <ul class="space-y-2">
          <li v-for="(item, index) in missingMappings" :key="`${item.requested}-${index}`">
            <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:items-start sm:gap-3">
              <div class="min-w-0 break-all font-mono text-xs">{{ item.requested }}</div>
              <div class="flex min-w-0 items-start gap-1">
                <span v-if="item.upstream" aria-hidden="true" class="mt-0.5 shrink-0">→</span>
                <div class="min-w-0">
                  <div v-if="item.upstream" class="min-w-0 break-all font-mono text-xs">{{ item.upstream }}</div>
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <div class="border-t border-gray-200 dark:border-dark-600">
      <button
        type="button"
        data-testid="grok-diagnostics-details-toggle"
        class="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-gray-800 dark:text-gray-100"
        :aria-expanded="detailsOpen"
        :aria-controls="detailsId"
        @click="detailsOpen = !detailsOpen"
      >
        <span aria-hidden="true" class="inline-block transition-transform" :class="detailsOpen ? 'rotate-90' : ''">›</span>
        目录详情
      </button>
      <div
        v-if="detailsOpen"
        :id="detailsId"
        data-testid="grok-diagnostics-details"
        class="border-t border-gray-200 p-4 dark:border-dark-600"
      >
        <dl class="space-y-3 text-xs">
          <div>
            <dt class="text-gray-500 dark:text-dark-400">
              {{ effectiveState !== 'fresh' ? '历史目录来源' : '目录来源' }}
            </dt>
            <dd data-testid="grok-diagnostics-endpoint" class="min-w-0 break-all font-mono text-xs">
              {{ diagnostics?.endpoint || '未知' }}
            </dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-dark-400">最后成功</dt>
            <dd>{{ observedTime(diagnostics?.fetched_at) }}</dd>
          </div>
          <div>
            <dt class="text-gray-500 dark:text-dark-400">最近尝试</dt>
            <dd data-testid="grok-diagnostics-last-attempt" class="min-w-0 break-all">
              <template v-if="diagnostics?.last_attempt">
                {{ attemptLabel }}
                <template v-if="attemptDetail"> {{ attemptDetail }}</template>
                {{ observedTime(diagnostics.last_attempt.finished_at) }}
              </template>
              <template v-else>未知</template>
            </dd>
          </div>
        </dl>

        <div class="mt-4">
          <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ effectiveState !== 'fresh' ? '历史目录' : '上游目录' }}
          </h4>
          <ul class="mt-1 max-h-48 space-y-1 overflow-y-auto">
            <li
              v-for="model in diagnostics?.models ?? []"
              :key="model"
              data-testid="grok-diagnostics-model"
              class="min-w-0 break-all font-mono text-xs"
            >
              {{ model }}
            </li>
          </ul>
        </div>

        <div class="mt-4" data-testid="grok-diagnostics-mappings">
          <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
            已保存配置核对
          </h4>
          <p v-if="hasFreshGaps" class="mt-1 text-xs text-gray-500 dark:text-dark-400">
            请求不会被阻断
          </p>
          <div class="mt-2 hidden text-xs text-gray-500 dark:text-dark-400 sm:grid sm:grid-cols-2 sm:gap-3">
            <span>请求模型</span>
            <span>转发至</span>
          </div>
          <ul class="mt-2 space-y-2">
            <li v-for="(item, index) in diagnostics?.mappings ?? []" :key="`${item.requested}-${index}`">
              <div class="grid grid-cols-1 gap-1 sm:grid-cols-2 sm:items-start sm:gap-3">
                <div class="min-w-0 break-all font-mono text-xs">{{ item.requested }}</div>
                <div class="flex min-w-0 items-start gap-1">
                  <span v-if="item.upstream" aria-hidden="true" class="mt-0.5 shrink-0">→</span>
                  <div class="min-w-0">
                    <div v-if="item.upstream" class="min-w-0 break-all font-mono text-xs">{{ item.upstream }}</div>
                    <div v-if="mappingStatus(item)" class="text-xs">{{ mappingStatus(item) }}</div>
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <p
      v-if="dirty"
      data-testid="grok-diagnostics-dirty"
      class="flex items-start gap-2 px-4 py-3 text-xs text-gray-500 dark:text-dark-400"
    >
      <span aria-hidden="true" class="mt-0.5 shrink-0">ⓘ</span>
      <span>诊断基于已保存配置。当前修改尚未保存，保存后请重新同步。</span>
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { formatDateTime } from '@/utils/format'
import type { GrokModelDiagnosticItem, GrokModelDiagnostics } from '@/types'

const props = defineProps<{
  diagnostics: GrokModelDiagnostics | null
  loading?: boolean
  dirty?: boolean
  refreshFailed?: boolean
  canSync?: boolean
  syncing?: boolean
}>()

const emit = defineEmits<{
  sync: []
}>()

const nowMs = ref(Date.now())
const detailsOpen = ref(false)
const differencesOpen = ref(false)
const instanceId = useId()
const detailsId = 'grok-catalog-' + instanceId
const differencesId = 'grok-differences-' + instanceId
const RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/
const ATTEMPT_LABELS: Record<string, string> = {
  success: '同步成功',
  failed: '同步失败',
  configured_fallback: '使用已配置模型补充能力'
}
const ERROR_LABELS: Record<string, string> = {
  configuration: '上游配置不可用',
  http_error: '上游请求失败',
  transport: '连接上游失败',
  invalid_response: '无法识别返回的目录',
  empty_catalog: '未获得有效模型目录',
  too_large: '目录超过读取上限',
  persistence: '目录保存失败'
}

function ownedLabel(table: Record<string, string>, value: string | undefined): string | undefined {
  if (!value || !Object.prototype.hasOwnProperty.call(table, value)) return undefined
  return table[value]
}

let timer: ReturnType<typeof setInterval> | undefined

onMounted(() => {
  timer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== undefined) clearInterval(timer)
})

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
    return leap ? 29 : 28
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

function parseCatalogTime(value: string | undefined): number | null {
  if (!value) return null
  const match = RFC3339_RE.exec(value.trim())
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = Number(match[6])
  const offsetHour = match[7] === undefined ? 0 : Number(match[7])
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8])
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    return null
  }
  const parsed = Date.parse(match[0])
  return Number.isFinite(parsed) ? parsed : null
}

// 上游 formatRelativeTime 的 desk 版：刚刚 / x 分钟前 / x 小时前 / x 天前
function formatRelativeTime(value: string | undefined): string {
  const time = parseCatalogTime(value)
  if (time === null || time > nowMs.value) return '未知'
  const diffMins = Math.floor((nowMs.value - time) / 60000)
  if (diffMins >= 60 * 24) return `${Math.floor(diffMins / (60 * 24))} 天前`
  if (diffMins >= 60) return `${Math.floor(diffMins / 60)} 小时前`
  if (diffMins >= 1) return `${diffMins} 分钟前`
  return '刚刚'
}

const fetchedMs = computed(() => parseCatalogTime(props.diagnostics?.fetched_at))
const expiresMs = computed(() => parseCatalogTime(props.diagnostics?.expires_at))
const fetchedUsable = computed(() => fetchedMs.value !== null && fetchedMs.value <= nowMs.value)

const effectiveState = computed(() => {
  const diagnostics = props.diagnostics
  if (!diagnostics) return 'unknown'
  if (diagnostics.state === 'fresh') {
    if (!fetchedUsable.value || expiresMs.value === null) return 'unknown'
    if (nowMs.value >= expiresMs.value) return 'stale'
    return 'fresh'
  }
  if (diagnostics.state === 'stale' || diagnostics.state === 'source_changed') {
    if (!fetchedUsable.value) return 'unknown'
    return diagnostics.state
  }
  return 'unknown'
})

const attemptStatus = computed(() => props.diagnostics?.last_attempt?.status ?? '')

const missingMappings = computed(() => effectiveState.value === 'fresh'
  ? (props.diagnostics?.mappings ?? []).filter(item => item.status === 'not_listed')
  : [])

const catalogHost = computed(() => {
  try { return new URL(props.diagnostics?.endpoint ?? '').host }
  catch { return '' }
})

const lastSuccessRelative = computed(() => formatRelativeTime(props.diagnostics?.fetched_at))

const modelCountLabel = computed(() => {
  const count = props.diagnostics?.models?.length ?? 0
  if (effectiveState.value === 'fresh') {
    return `${count} 个模型`
  }
  if (effectiveState.value === 'stale' || effectiveState.value === 'source_changed') {
    return `${count} 个历史模型`
  }
  return ''
})

const headline = computed(() => {
  if (effectiveState.value === 'stale') return '历史目录'
  if (effectiveState.value === 'source_changed') return '来源已变更'
  if (effectiveState.value === 'unknown') return '未知'
  if (attemptStatus.value === 'failed') return '同步失败'
  if (attemptStatus.value === 'configured_fallback') return '使用已配置模型补充能力'
  return '当前有效'
})

const stateClass = computed(() => {
  const attention = effectiveState.value !== 'fresh'
    || attemptStatus.value === 'failed'
    || attemptStatus.value === 'configured_fallback'
  if (!attention && effectiveState.value === 'fresh') {
    return 'text-xs font-medium text-emerald-700 dark:text-emerald-300'
  }
  if (effectiveState.value === 'unknown' && attemptStatus.value !== 'failed' && attemptStatus.value !== 'configured_fallback') {
    return 'text-xs font-medium text-gray-500 dark:text-dark-400'
  }
  return 'text-xs font-medium text-amber-800 dark:text-amber-200'
})

const attemptLabel = computed(() => {
  const status = props.diagnostics?.last_attempt?.status
  if (!status) return ''
  return ownedLabel(ATTEMPT_LABELS, status) ?? '状态未知'
})

const attemptErrorLabel = computed(() => {
  const attempt = props.diagnostics?.last_attempt
  if (!attempt || attempt.status !== 'failed') return ''
  return ownedLabel(ERROR_LABELS, attempt.error_code) ?? '同步未成功，请稍后重试'
})

const attemptDetail = computed(() => {
  if (attemptStatus.value === 'configured_fallback') {
    return '本次未获得实时目录，仅用已配置模型补充能力信息。'
  }
  return attemptErrorLabel.value
})

const showFailureNotice = computed(() => attemptStatus.value === 'failed')
const showFallbackNotice = computed(() => attemptStatus.value === 'configured_fallback')
const showPreviousValid = computed(() => effectiveState.value === 'fresh'
  && (attemptStatus.value === 'failed' || attemptStatus.value === 'configured_fallback'))
const showStateNotice = computed(() => effectiveState.value === 'stale'
  || effectiveState.value === 'source_changed'
  || effectiveState.value === 'unknown')
const hasFreshGaps = computed(() => missingMappings.value.length > 0)

function observedTime(value: string | undefined): string {
  const parsed = parseCatalogTime(value)
  if (parsed === null || parsed > nowMs.value) return '未知'
  return formatDateTime(value)
}

function mappingStatus(item: GrokModelDiagnosticItem): string {
  if (item.status === 'out_of_scope') return '不在此文本目录范围内'
  if (item.status === 'unverifiable') return '无法逐项核验'
  if (item.status === 'not_listed') {
    return effectiveState.value === 'fresh'
      ? '未在该账号此端点的当前目录中发现'
      : '历史记录，需重新同步后核验'
  }
  if (item.status === 'listed') {
    return effectiveState.value === 'fresh'
      ? '当前目录中已发现'
      : '历史记录，需重新同步后核验'
  }
  return ''
}

function requestSync() {
  if (props.syncing || props.loading) return
  emit('sync')
}
</script>
