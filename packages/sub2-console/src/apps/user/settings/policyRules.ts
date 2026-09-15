import type { BetaPolicyRule, OpenAIFastPolicyRule } from '../../../api/admin/settings';

export type PolicyKind = 'beta' | 'fast';
export type PolicyRule = Omit<OpenAIFastPolicyRule, 'service_tier'> & {
  service_tier?: OpenAIFastPolicyRule['service_tier'];
  beta_token?: BetaPolicyRule['beta_token'];
  [key: string]: unknown;
};
export interface PolicyDocument { rules: PolicyRule[]; [key: string]: unknown }
export interface PolicyRow { id: number; rule: PolicyRule; original: string | null }
export const copyPolicy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function readPolicy(value: unknown, kind: PolicyKind): PolicyDocument {
  const key = kind === 'beta' ? 'beta_token' : 'service_tier';
  if (!record(value) || !Array.isArray(value.rules) || value.rules.some(rule => !record(rule) || typeof rule[key] !== 'string' || typeof rule.action !== 'string' || typeof rule.scope !== 'string')) {
    throw new Error('未能读取完整规则，请重新读取后再编辑。');
  }
  for (const rule of value.rules as Record<string, unknown>[]) {
    if (rule.model_whitelist != null && (!Array.isArray(rule.model_whitelist) || rule.model_whitelist.some(item => typeof item !== 'string'))) throw new Error('模型范围返回格式无效，请重新读取规则。');
    if (kind === 'fast' && rule.user_ids != null && (!Array.isArray(rule.user_ids) || rule.user_ids.some(item => !Number.isSafeInteger(item) || item <= 0))) throw new Error('用户范围返回格式无效，请重新读取规则。');
  }
  return copyPolicy(value) as PolicyDocument;
}

export function policyPayload(baseline: PolicyDocument, rows: PolicyRow[], kind: PolicyKind): PolicyDocument {
  const actions = kind === 'fast' ? ['pass', 'filter', 'block', 'force_priority'] : ['pass', 'filter', 'block'];
  for (const { rule, original } of rows) {
    // Keep unedited future rules exactly as received, even after another row is removed.
    if (original === JSON.stringify(rule)) continue;
    if (kind === 'beta' && !rule.beta_token?.trim()) throw new Error('请填写 Beta 功能标记。');
    if (kind === 'fast' && !['all', 'priority', 'flex', 'ultrafast'].includes(rule.service_tier || '')) throw new Error('请选择有效的服务档位。');
    if (!actions.includes(rule.action) || !['all', 'oauth', 'apikey', 'bedrock'].includes(rule.scope)) throw new Error('请选择有效的处理方式与账号范围。');
    if (rule.fallback_action && !actions.includes(rule.fallback_action)) throw new Error('请选择有效的未匹配处理方式。');
    if (rule.model_whitelist != null && (!Array.isArray(rule.model_whitelist) || rule.model_whitelist.some(value => typeof value !== 'string' || !value.trim()))) throw new Error('模型范围不能包含空项。');
    if (kind === 'fast' && rule.user_ids != null && (!Array.isArray(rule.user_ids) || rule.user_ids.some(value => !Number.isSafeInteger(value) || value <= 0) || new Set(rule.user_ids).size !== rule.user_ids.length)) throw new Error('用户 ID 须为不重复的正整数。');
  }
  return { ...copyPolicy(baseline), rules: rows.map(row => copyPolicy(row.rule)) };
}
