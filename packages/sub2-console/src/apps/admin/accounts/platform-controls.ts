import type { Account } from '@/types'
import { isHeaderOverrideCapable, validateHeaderOverrideRows, buildHeaderOverridesObject, splitHeaderOverridesObject, type HeaderOverrideRow } from './header-overrides'
export { isHeaderOverrideCapable }
type Scope = Pick<Account, 'platform' | 'type' | 'credentials' | 'extra'>
export interface Control { key: string; label: string; choices?: string[]; numeric?: boolean; scope: (p: string, t: string) => boolean; credential?: boolean }
const openai = (p: string) => p === 'openai'
const oaOAuth = (p: string, t: string) => p === 'openai' && t === 'oauth'
const oaKey = (p: string, t: string) => p === 'openai' && t === 'apikey'
const claude = (p: string, t: string) => p === 'anthropic' && ['oauth', 'setup-token'].includes(t)
const claudeKey = (p: string, t: string) => p === 'anthropic' && t === 'apikey'
export const controls: Control[] = [
  { key: 'tier_id', label: 'AI Studio 配额层级', choices: ['', 'aistudio_free', 'aistudio_paid'], scope: (p,t) => p === 'gemini' && t === 'apikey', credential: true },
  { key: 'auto_pause_5h_disabled', label: '禁用 5 小时配额自动暂停', scope: oaOAuth },
  { key: 'auto_pause_7d_disabled', label: '禁用 7 天配额自动暂停', scope: oaOAuth },
  { key: 'auto_reset_credit_enabled', label: '允许自动消耗配额重置次数', scope: oaOAuth },
  ...['auto_pause_5h_threshold', 'auto_pause_7d_threshold', 'auto_reset_credit_5h_threshold', 'auto_reset_credit_7d_threshold'].map((key, i) => ({ key, label: ['5 小时暂停阈值', '7 天暂停阈值', '5 小时自动重置阈值', '7 天自动重置阈值'][i]! + '（比例 0–1，空值跟随系统）', numeric: true, scope: oaOAuth })),
  { key: 'mixed_scheduling', label: '允许混合调度', scope: p => p === 'antigravity' },
  { key: 'allow_overages', label: '允许超额使用', scope: p => p === 'antigravity' },
  { key: 'intercept_warmup_requests', label: '拦截预热请求', scope: () => true, credential: true },
  { key: 'enable_tls_fingerprint', label: '启用 TLS 指纹', scope: claude },
  { key: 'session_id_masking_enabled', label: '掩蔽 Session ID', scope: claude },
  { key: 'cache_ttl_override_enabled', label: '覆写缓存 TTL', scope: claude },
  { key: 'openai_passthrough', label: 'OpenAI 请求透传', scope: openai },
  { key: 'openai_long_context_billing_enabled', label: '长上下文计费', scope: openai },
  { key: 'openai_responses_flatten_namespaces', label: '展平工具命名空间', scope: oaOAuth },
  { key: 'codex_cli_only', label: '仅允许 Codex CLI', scope: oaOAuth },
  { key: 'codex_cli_only_allow_app_server', label: '同时允许 Codex App Server', scope: oaOAuth },
  { key: 'codex_fingerprint_mode', label: 'Codex 指纹模式', choices: ['off', 'device', 'session', 'full'], scope: oaOAuth },
  { key: 'openai_compact_mode', label: 'Compact 支持', choices: ['auto', 'force_on', 'force_off'], scope: openai },
  { key: 'openai_responses_mode', label: '文本请求协议', choices: ['auto', 'force_responses', 'force_chat_completions'], scope: oaKey },
  { key: 'openai_oauth_responses_websockets_v2_mode', label: 'OAuth WebSocket 模式', choices: ['off', 'ctx_pool', 'passthrough'], scope: oaOAuth },
  { key: 'openai_apikey_responses_websockets_v2_mode', label: 'API Key WebSocket 模式', choices: ['off', 'ctx_pool', 'passthrough'], scope: oaKey },
  { key: 'images_url_to_b64_json', label: '图片 URL 转 Base64', scope: oaKey },
  { key: 'anthropic_passthrough', label: 'Anthropic 请求透传', scope: claudeKey },
  { key: 'anthropic_apikey_auth_scheme', label: 'API Key 认证方式', choices: ['x_api_key', 'authorization_bearer'], scope: claudeKey },
  { key: 'web_search_emulation', label: '联网搜索模拟', choices: ['default', 'disabled', 'enabled'], scope: claudeKey },
]
export interface PlatformControls { capabilities: string[]; customErrors: boolean; errorCodes: string; tempEnabled: boolean; tempRules: { error_code: number; keywords: string; duration_minutes: number; description: string }[]; imageTool: string; values: Record<string, boolean | string | number>; headersEnabled: boolean; headers: HeaderOverrideRow[]; tlsProfile: number | null; ttl: string; baseUrl: string; baseUrlEnabled: boolean; projectId: string }
export function platformForm(account?: Account): PlatformControls {
  const e = account?.extra ?? {}, c = account?.credentials ?? {}
  const values = Object.fromEntries(controls.map(d => [d.key, (d.credential ? c[d.key] : e[d.key] ?? (account as unknown as Record<string, unknown> | undefined)?.[d.key]) ?? d.choices?.[0] ?? (d.numeric ? '' : false)])) as PlatformControls['values']
  if (e.openai_oauth_passthrough === true) values.openai_passthrough = true
  return { capabilities: Array.isArray(c.openai_capabilities) ? c.openai_capabilities as string[] : ['chat_completions', 'embeddings'], customErrors: c.custom_error_codes_enabled === true, errorCodes: Array.isArray(c.custom_error_codes) ? c.custom_error_codes.join(', ') : '', tempEnabled: c.temp_unschedulable_enabled === true, tempRules: Array.isArray(c.temp_unschedulable_rules) ? c.temp_unschedulable_rules.map((r: any) => ({ ...r, keywords: Array.isArray(r.keywords) ? r.keywords.join('\n') : '' })) : [], imageTool: e.codex_image_generation_explicit_tool_policy === 'strip' ? 'strip' : (e.codex_image_generation_bridge ?? e.codex_image_generation_bridge_enabled) === true ? 'enabled' : (e.codex_image_generation_bridge ?? e.codex_image_generation_bridge_enabled) === false ? 'disabled' : 'default', values, headersEnabled: c.header_override_enabled === true, headers: splitHeaderOverridesObject(c.header_overrides), tlsProfile: Number(e.tls_fingerprint_profile_id ?? account?.tls_fingerprint_profile_id) || null, ttl: String(e.cache_ttl_override_target ?? account?.cache_ttl_override_target ?? '5m'), baseUrl: String(e.custom_base_url ?? ''), baseUrlEnabled: e.custom_base_url_enabled === true, projectId: String(c.antigravity_project_id ?? '') }
}
export function applyPlatform(form: PlatformControls, initial: PlatformControls, current: Scope) {
  const credentials = { ...current.credentials }, extra = { ...current.extra }
  let cc = false, ec = false
  const put = (key: string, value: unknown, credential = false) => { const target = credential ? credentials : extra; if (value === undefined) delete target[key]; else target[key] = value; if (credential) cc = true; else ec = true }
  for (const d of controls) if (d.scope(current.platform, current.type) && form.values[d.key] !== initial.values[d.key]) {
    const value = form.values[d.key]
    if (d.numeric ? (value !== '' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)) : d.choices ? !d.choices.includes(String(value)) : typeof value !== 'boolean') throw new Error(`${d.label}无效。`)
    put(d.key, value === '' ? undefined : value, d.credential)
    if (d.key === 'openai_passthrough') put('openai_oauth_passthrough', undefined)
    if (d.key.endsWith('_websockets_v2_mode')) { put(d.key.replace(/_mode$/, '_enabled'), value !== 'off'); put('responses_websockets_v2_enabled', undefined); put('openai_ws_enabled', undefined) }
  }
  if (isHeaderOverrideCapable(current.platform, current.type) && (form.headersEnabled !== initial.headersEnabled || JSON.stringify(form.headers) !== JSON.stringify(initial.headers))) {
    const error = form.headersEnabled && validateHeaderOverrideRows(form.headers)
    if (error) throw new Error(`请求头无效：${error}。请检查名称、重复项及值。`)
    put('header_override_enabled', form.headersEnabled, true)
    put('header_overrides', form.headersEnabled ? buildHeaderOverridesObject(form.headers) : undefined, true)
  }
  if (claude(current.platform, current.type)) {
    if (form.tlsProfile !== initial.tlsProfile || form.values.enable_tls_fingerprint !== initial.values.enable_tls_fingerprint) {
      if (form.tlsProfile !== null && (!Number.isInteger(form.tlsProfile) || form.tlsProfile < -1 || form.tlsProfile === 0)) throw new Error('TLS 指纹配置无效。')
      put('tls_fingerprint_profile_id', form.values.enable_tls_fingerprint ? form.tlsProfile ?? undefined : undefined)
    }
    if (form.ttl !== initial.ttl || form.values.cache_ttl_override_enabled !== initial.values.cache_ttl_override_enabled) {
      if (!['5m', '1h'].includes(form.ttl)) throw new Error('缓存 TTL 无效。')
      put('cache_ttl_override_target', form.values.cache_ttl_override_enabled ? form.ttl : undefined)
    }
    if (form.baseUrl !== initial.baseUrl || form.baseUrlEnabled !== initial.baseUrlEnabled) {
      if (form.baseUrlEnabled) { const url = new URL(form.baseUrl.trim()); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入有效服务地址。') }
      put('custom_base_url_enabled', form.baseUrlEnabled); put('custom_base_url', form.baseUrlEnabled ? form.baseUrl.trim() : undefined)
    }
  }
  if (current.platform === 'antigravity' && form.projectId !== initial.projectId) put('antigravity_project_id', form.projectId.trim() || undefined, true)
  if (oaKey(current.platform, current.type) && JSON.stringify(form.capabilities) !== JSON.stringify(initial.capabilities)) {
    if (!form.capabilities.length || form.capabilities.some(v => !['chat_completions', 'embeddings'].includes(v))) throw new Error('至少选择一种端点能力。')
    put('openai_capabilities', [...new Set(form.capabilities)], true)
    if (!form.capabilities.includes('chat_completions')) put('openai_responses_mode', undefined)
  }
  if (oaOAuth(current.platform, current.type) && form.imageTool !== initial.imageTool) {
    if (!['default', 'enabled', 'disabled', 'strip'].includes(form.imageTool)) throw new Error('生图工具策略无效。')
    put('codex_image_generation_bridge_enabled', undefined)
    put('codex_image_generation_bridge', ['enabled', 'disabled'].includes(form.imageTool) ? form.imageTool === 'enabled' : undefined)
    put('codex_image_generation_explicit_tool_policy', form.imageTool === 'strip' ? 'strip' : undefined)
  }
  if (current.type === 'apikey' && (form.customErrors !== initial.customErrors || form.errorCodes !== initial.errorCodes)) {
    const codes = form.errorCodes.trim() ? [...new Set(form.errorCodes.trim().split(/[,\s]+/).map(Number))] : []
    if (form.customErrors && (!codes.length || codes.some(n => !Number.isInteger(n) || n < 100 || n > 599))) throw new Error('请填写有效的 HTTP 状态码（100–599）。')
    put('custom_error_codes_enabled', form.customErrors, true); put('custom_error_codes', form.customErrors ? codes : undefined, true)
  }
  if (form.tempEnabled !== initial.tempEnabled || JSON.stringify(form.tempRules) !== JSON.stringify(initial.tempRules)) {
    const rules = form.tempRules.map(r => ({ ...r, description: r.description.trim(), keywords: r.keywords.split(/[\n,]+/).map(v => v.trim()).filter(Boolean) }))
    if (form.tempEnabled && (!rules.length || rules.some(r => !Number.isInteger(r.error_code) || r.error_code < 100 || r.error_code > 599 || !Number.isInteger(r.duration_minutes) || r.duration_minutes < 1 || !r.keywords.length))) throw new Error('暂停调度规则须包含有效状态码、关键词和正整数分钟。')
    put('temp_unschedulable_enabled', form.tempEnabled, true); put('temp_unschedulable_rules', form.tempEnabled ? rules : undefined, true)
  }
  return { ...(cc ? { credentials } : {}), ...(ec ? { extra } : {}) }
}
