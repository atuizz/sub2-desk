import type { Account } from '@/types'

/**
 * OpenAI 自动用卡（autoResetCredit）运行态。
 *
 * 与上游 v0.2.20 `frontend/src/components/account/OpenAIQuotaResetCell.vue`
 * 的 autoResetState 区块同语义，字段全部来自账号 `extra`：
 * - `auto_reset_credit_enabled`（boolean）：总开关；仅 OpenAI OAuth 母账号有效
 *   （后端 `backend/internal/service/openai_quota_auto_reset_config.go`
 *   `ResolveOpenAIAutoResetCreditConfig` / `isOpenAIAutoResetCreditAccount`）。
 * - `auto_reset_credit_5h_threshold` / `auto_reset_credit_7d_threshold`
 *   （number，0–1 比例，默认 1.0，最小 0.001）：两个窗口独立判断，任一达到
 *   自身阈值即触发；编辑入口在 `platform-controls.ts`（0–1 数值，空值跟随
 *   系统），上游编辑框显示为百分比（×100 / ÷100），落库格式一致。
 * - `codex_auto_reset_credit_state`（运行态，只读）：后端服务写入，管理端
 *   保存时必须剥离（上游 EditAccountModal 保存时
 *   `delete newExtra.codex_auto_reset_credit_state`；后端
 *   `normalizeOpenAIAutoResetCreditExtra` 同样删除该键）。desk 从不写该键：
 *   `applyPlatform` 只写被改动的 controls。
 *
 * 本模块只做展示态解析，不发请求、不写 extra。
 */

export type AutoResetCreditStatus =
  | 'checking'
  | 'available'
  | 'resetting'
  | 'success'
  | 'no_credit'
  | 'failed'

export interface AutoResetCreditState {
  status?: AutoResetCreditStatus
  trigger_window?: string
  available_count?: number
  checked_at?: string
  last_result_at?: string
  error_code?: string
}

const validAutoResetStatuses: ReadonlySet<string> = new Set([
  'checking',
  'available',
  'resetting',
  'success',
  'no_credit',
  'failed',
])

/**
 * 仅当开关开启且运行态 status 合法时返回运行态，否则返回 null（不展示）。
 * 与上游 `autoResetState` computed 完全一致。
 */
export function resolveAutoResetCreditState(
  account: Pick<Account, 'extra'>,
): AutoResetCreditState | null {
  if (account.extra?.auto_reset_credit_enabled !== true) return null
  const state = account.extra?.codex_auto_reset_credit_state
  if (!state || typeof state !== 'object' || !validAutoResetStatuses.has(String(state.status))) {
    return null
  }
  return state as AutoResetCreditState
}

/** 上游 i18n `admin.accounts.openaiQuotaReset.autoStatus.*` 的中文文案。 */
export const AUTO_RESET_CREDIT_STATUS_LABELS: Record<AutoResetCreditStatus, string> = {
  checking: '检测中',
  available: '卡可用',
  resetting: '自动重置中',
  success: '自动重置成功',
  no_credit: '无卡',
  failed: '自动重置失败',
}

/** 与上游 `autoResetStateClass` 同色的徽标样式。 */
export function autoResetCreditStateClass(status: AutoResetCreditStatus): string {
  switch (status) {
    case 'available':
      return 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'success':
      return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    case 'no_credit':
    case 'failed':
      return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'resetting':
      return 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    default:
      return 'bg-gray-100 text-gray-600 dark:bg-dark-800 dark:text-gray-300'
  }
}

/** 与上游 `formatResetCreditExpiry` 一致：short 为月-日 时:分，full 补年份。 */
export function formatResetCreditExpiry(value: string, style: 'short' | 'full'): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  const options: Intl.DateTimeFormatOptions = {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }
  if (style === 'full') {
    options.year = 'numeric'
  }

  return new Intl.DateTimeFormat(undefined, options).format(date)
}
