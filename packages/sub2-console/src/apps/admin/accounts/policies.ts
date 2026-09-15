import { platformForm, applyPlatform, type PlatformControls } from './platform-controls'
import type { Account } from '@/types'
export interface MappingRow { from: string; to: string }
export interface Policies {
  platformControls: PlatformControls;
  allowed: string; mappings: MappingRow[]; compact: MappingRow[];
  pool: boolean; retries: number; retryCodes: string;
  quota_limit: number | ''; quota_daily_limit: number | ''; quota_weekly_limit: number | '';
  quota_daily_reset_mode: string; quota_daily_reset_hour: number;
  quota_weekly_reset_mode: string; quota_weekly_reset_day: number; quota_weekly_reset_hour: number; quota_reset_timezone: string;
  windowEnabled: boolean; window_cost_limit: number | ''; window_cost_sticky_reserve: number;
  sessionsEnabled: boolean; max_sessions: number | ''; session_idle_timeout_minutes: number;
  rpmEnabled: boolean; base_rpm: number | ''; rpm_strategy: string; rpm_sticky_buffer: number | ''; user_msg_queue_mode: string;
  notify: Record<string, { enabled: boolean; threshold: number | ''; type: string }>
}
export const quotaDimensions = [{ key: 'daily', label: '日配额' }, { key: 'weekly', label: '周配额' }, { key: 'total', label: '总配额' }] as const
export function mappingAvailable(platform: string, type: string) {
  return platform === 'antigravity' || ['apikey', 'bedrock', 'service_account'].includes(type) || (type === 'oauth' && ['openai', 'grok'].includes(platform))
}
export function quotaAvailable(type: string) { return ['apikey', 'bedrock'].includes(type) }
export function rpmAvailable(platform: string, type: string) { return platform === 'anthropic' && ['oauth', 'setup-token'].includes(type) }
export function mappingLocked(account?: Pick<Account, 'platform' | 'extra'>) { return account?.platform === 'openai' && (account.extra?.openai_passthrough === true || account.extra?.openai_oauth_passthrough === true) }
function rows(value: unknown): MappingRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value).filter(([, to]) => typeof to === 'string').map(([from, to]) => ({ from, to: to as string }))
}
export function policyForm(account?: Account): Policies {
  const c = account?.credentials ?? {}, e = account?.extra ?? {}
  const number = (key: string, fallback: number | '' = '') => typeof e[key] === 'number' ? e[key] as number : fallback
  let modelRows = rows(c.model_mapping)
  if (account?.platform === 'antigravity' && !modelRows.length && Array.isArray(c.model_whitelist)) modelRows = c.model_whitelist.filter(m => typeof m === 'string').map(m => ({ from: m, to: m }))
  const same = account?.platform !== 'antigravity' ? modelRows.filter(r => r.from === r.to) : []
  return {
    platformControls: platformForm(account),
    allowed: same.map(r => r.from).join('\n'), mappings: modelRows.filter(r => !same.includes(r)), compact: rows(c.compact_model_mapping),
    pool: c.pool_mode === true, retries: typeof c.pool_mode_retry_count === 'number' ? c.pool_mode_retry_count : 3,
    retryCodes: Array.isArray(c.pool_mode_retry_status_codes) ? c.pool_mode_retry_status_codes.join(', ') : '',
    quota_limit: number('quota_limit'), quota_daily_limit: number('quota_daily_limit'), quota_weekly_limit: number('quota_weekly_limit'),
    quota_daily_reset_mode: String(e.quota_daily_reset_mode || 'rolling'), quota_daily_reset_hour: Number(e.quota_daily_reset_hour ?? 0),
    quota_weekly_reset_mode: String(e.quota_weekly_reset_mode || 'rolling'), quota_weekly_reset_day: Number(e.quota_weekly_reset_day ?? 1),
    quota_weekly_reset_hour: Number(e.quota_weekly_reset_hour ?? 0), quota_reset_timezone: String(e.quota_reset_timezone || 'UTC'),
    windowEnabled: Number(e.window_cost_limit ?? account?.window_cost_limit) > 0, window_cost_limit: number('window_cost_limit', account?.window_cost_limit ?? ''),
    window_cost_sticky_reserve: Number(e.window_cost_sticky_reserve ?? account?.window_cost_sticky_reserve ?? 10),
    sessionsEnabled: Number(e.max_sessions ?? account?.max_sessions) > 0, max_sessions: number('max_sessions', account?.max_sessions ?? ''),
    session_idle_timeout_minutes: Number(e.session_idle_timeout_minutes ?? account?.session_idle_timeout_minutes ?? 5),
    rpmEnabled: Number(e.base_rpm ?? account?.base_rpm) > 0, base_rpm: number('base_rpm', account?.base_rpm ?? ''),
    rpm_strategy: String(e.rpm_strategy ?? account?.rpm_strategy ?? 'tiered'), rpm_sticky_buffer: number('rpm_sticky_buffer', account?.rpm_sticky_buffer ?? ''),
    user_msg_queue_mode: String(e.user_msg_queue_mode ?? account?.user_msg_queue_mode ?? ''),
    notify: Object.fromEntries(quotaDimensions.map(({ key }) => [key, { enabled: e[`quota_notify_${key}_enabled`] === true,
      threshold: number(`quota_notify_${key}_threshold`), type: String(e[`quota_notify_${key}_threshold_type`] || 'fixed') }]))
  }
}
export function buildMapping(allowed: string, mappings: MappingRow[]): Record<string, string> {
  const result: Record<string, string> = Object.create(null)
  for (const name of allowed.split(/\r?\n/).map(m => m.trim()).filter(Boolean)) {
    if (name.includes('*')) throw new Error('白名单只接受确切模型名，通配符请放在映射来源。')
    result[name] = name
  }
  const seen = new Set<string>()
  for (const row of mappings) {
    const from = row.from.trim(), to = row.to.trim()
    if (!from || !to) throw new Error('每条映射都须填写来源和目标；空行请删除。')
    if ((from.includes('*') && (!from.endsWith('*') || from.indexOf('*') !== from.length - 1)) || to.includes('*')) throw new Error('来源只允许末尾一个 *；目标不能含通配符。')
    if (seen.has(from)) throw new Error(`映射来源重复：${from}`)
    seen.add(from); result[from] = to
  }
  return result
}
export function applyPolicies(form: Policies, initial: Policies, current: Pick<Account, 'platform' | 'type' | 'credentials' | 'extra'>, editing: boolean) {
  const credentials = { ...current.credentials }, extra = { ...current.extra }
  let credentialsChanged = false, extraChanged = false
  const changed = (...keys: (keyof Policies)[]) => keys.some(k => JSON.stringify(form[k]) !== JSON.stringify(initial[k]))
  const number = (value: number | '', label: string, min = 0, integer = false, max = Infinity) => {
    if (value === '' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label}须为${integer ? '整数' : '数值'}，范围 ${min}–${max === Infinity ? '不限' : max}。`)
    return value
  }
  const put = (key: string, value: unknown) => { extraChanged = true; if (value === undefined) delete extra[key]; else extra[key] = value }
  const changedModel = changed('allowed', 'mappings')
  if (mappingAvailable(current.platform, current.type) && changedModel) {
    if (mappingLocked(current) || (current.platform === 'openai' && form.platformControls.values.openai_passthrough === true)) throw new Error('此 OpenAI 账号已启用透传，模型映射不可编辑。')
    const mapping = buildMapping(current.platform === 'antigravity' ? '' : form.allowed, form.mappings)
    if (Object.keys(mapping).length) credentials.model_mapping = mapping
    else delete credentials.model_mapping
    if (current.platform === 'antigravity') delete credentials.model_whitelist
    credentialsChanged = true
  }
  if (current.platform === 'openai' && changed('compact')) {
    const mapping = buildMapping('', form.compact)
    if (Object.keys(mapping).length) credentials.compact_model_mapping = mapping
    else delete credentials.compact_model_mapping
    credentialsChanged = true
  }
  if (quotaAvailable(current.type) && changed('pool', 'retries', 'retryCodes')) {
    if (form.pool) {
      credentials.pool_mode = true; credentials.pool_mode_retry_count = number(form.retries, '池重试次数', 0, true, 10)
      const codes = form.retryCodes.trim() ? [...new Set(form.retryCodes.trim().split(/[,\s]+/).map(v => number(Number(v), '重试状态码', 100, true, 599)))] : []
      if (codes.length) credentials.pool_mode_retry_status_codes = codes; else delete credentials.pool_mode_retry_status_codes
    } else { delete credentials.pool_mode; delete credentials.pool_mode_retry_count; delete credentials.pool_mode_retry_status_codes }
    credentialsChanged = true
  }
  if (quotaAvailable(current.type)) {
    for (const key of ['quota_limit', 'quota_daily_limit', 'quota_weekly_limit'] as const) if (changed(key)) {
      const value = form[key] === '' ? 0 : number(form[key], '配额')
      put(key, value > 0 ? value : undefined)
      if (value === 0 && key !== 'quota_limit') { const prefix = key.replace('_limit', ''); put(`${prefix}_used`, undefined); put(`${prefix}_start`, undefined) }
    }
    for (const dim of ['daily', 'weekly'] as const) {
      const mode = `quota_${dim}_reset_mode` as const, hour = `quota_${dim}_reset_hour` as const
      if (changed(mode, hour) || (dim === 'weekly' && changed('quota_weekly_reset_day'))) {
        if (!['fixed', 'rolling'].includes(form[mode])) throw new Error('请选择滚动或固定重置。')
        put(mode, form[mode] === 'fixed' ? 'fixed' : undefined)
        put(hour, form[mode] === 'fixed' ? number(form[hour], '重置小时', 0, true, 23) : undefined)
        if (dim === 'weekly') put('quota_weekly_reset_day', form[mode] === 'fixed' ? number(form.quota_weekly_reset_day, '重置星期', 0, true, 6) : undefined)
      }
    }
    if (changed('quota_daily_reset_mode', 'quota_weekly_reset_mode', 'quota_reset_timezone')) {
      const fixed = form.quota_daily_reset_mode === 'fixed' || form.quota_weekly_reset_mode === 'fixed'
      if (fixed) { try { new Intl.DateTimeFormat('en', { timeZone: form.quota_reset_timezone }).format() } catch { throw new Error('请输入有效 IANA 时区，如 Asia/Shanghai。') } }
      put('quota_reset_timezone', fixed ? form.quota_reset_timezone : undefined)
    }
    for (const { key } of quotaDimensions) if (JSON.stringify(form.notify[key]) !== JSON.stringify(initial.notify[key])) {
      const n = form.notify[key]!, prefix = `quota_notify_${key}`
      if (n.enabled && !['fixed', 'percentage'].includes(n.type)) throw new Error('预警阈值类型无效。')
      put(`${prefix}_enabled`, n.enabled ? true : undefined)
      put(`${prefix}_threshold_type`, n.enabled ? n.type : undefined)
      put(`${prefix}_threshold`, n.enabled && n.threshold !== '' ? number(n.threshold, '预警阈值', 0, false, n.type === 'percentage' ? 100 : Infinity) : undefined)
    }
  }
  if (rpmAvailable(current.platform, current.type)) {
    if (changed('windowEnabled', 'window_cost_limit', 'window_cost_sticky_reserve')) {
      put('window_cost_limit', form.windowEnabled ? number(form.window_cost_limit, '窗口费用', Number.MIN_VALUE) : undefined)
      put('window_cost_sticky_reserve', form.windowEnabled ? number(form.window_cost_sticky_reserve, '粘性预留') : undefined)
    }
    if (changed('sessionsEnabled', 'max_sessions', 'session_idle_timeout_minutes')) {
      put('max_sessions', form.sessionsEnabled ? number(form.max_sessions, '最大会话数', 1, true) : undefined)
      put('session_idle_timeout_minutes', form.sessionsEnabled ? number(form.session_idle_timeout_minutes, '空闲超时', 1, true) : undefined)
    }
    if (changed('rpmEnabled', 'base_rpm', 'rpm_strategy', 'rpm_sticky_buffer')) {
      if (form.rpmEnabled && !['tiered', 'sticky_exempt'].includes(form.rpm_strategy)) throw new Error('RPM 策略无效。')
      put('base_rpm', form.rpmEnabled ? number(form.base_rpm === '' ? 15 : form.base_rpm, '基础 RPM', 1, true, 1000) : undefined)
      put('rpm_strategy', form.rpmEnabled ? form.rpm_strategy : undefined)
      put('rpm_sticky_buffer', form.rpmEnabled && form.rpm_sticky_buffer !== '' && form.rpm_sticky_buffer !== 0 ? number(form.rpm_sticky_buffer, 'RPM 粘性缓冲', 1, true) : undefined)
    }
    if (changed('user_msg_queue_mode')) {
      if (!['', 'throttle', 'serialize'].includes(form.user_msg_queue_mode)) throw new Error('消息限速模式无效。')
      put('user_msg_queue_mode', form.user_msg_queue_mode || undefined); put('user_msg_queue_enabled', undefined)
    }
  }
  const platform = applyPlatform(form.platformControls, initial.platformControls, { ...current, credentials, extra })
  if (platform.credentials) { Object.keys(credentials).forEach(k => delete credentials[k]); Object.assign(credentials, platform.credentials); credentialsChanged = true }
  if (platform.extra) { Object.keys(extra).forEach(k => delete extra[k]); Object.assign(extra, platform.extra); extraChanged = true }
  return { ...(credentialsChanged || !editing ? { credentials } : {}), ...(extraChanged || (!editing && Object.keys(extra).length) ? { extra } : {}) }
}
