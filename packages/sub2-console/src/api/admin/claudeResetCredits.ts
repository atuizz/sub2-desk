/**
 * Claude Reset Credits API endpoints
 * Claude native reset credits (upstream v0.2.11新增).
 */

import { apiClient } from '../client'
import type {
  ClaudeResetCredits,
  ClaudeResetOutcome
} from '@/types'

// 与上游一致：以上类型由 @/types 提供，此处再导出以保持
// `from '@/api/admin/claudeResetCredits'` 引用路径可用。
export type {
  ClaudeResetCredit,
  ClaudeResetCredits,
  ClaudeResetOutcome,
  ClaudeResetOutcomeKind
} from '@/types'

export async function getClaudeResetCredits(id: number): Promise<ClaudeResetCredits> {
  const { data } = await apiClient.get<ClaudeResetCredits>(`/admin/accounts/${id}/claude/reset-credits`)
  return data
}

// Consumes one reset credit (irreversible). The server picks the grant; the key
// identifies one operator confirmation and must be reused when retrying it.
export async function redeemClaudeResetCredit(id: number, idempotencyKey: string): Promise<ClaudeResetOutcome> {
  const { data } = await apiClient.post<ClaudeResetOutcome>(`/admin/accounts/${id}/claude/reset-credits/redeem`, undefined, {
    headers: { 'Idempotency-Key': idempotencyKey }
  })
  return data
}

export const claudeResetCreditsAPI = {
  getClaudeResetCredits,
  redeemClaudeResetCredit
}

export default claudeResetCreditsAPI
