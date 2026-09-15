import { accountsAPI } from '@/api/admin/accounts'
import gemini from '@/api/admin/gemini'
import antigravity from '@/api/admin/antigravity'
import grok from '@/api/admin/grok'

export interface OAuthOptions {
  platform: string
  type: 'oauth' | 'setup-token'
  proxy_id?: number
  project_id?: string
  oauth_type?: 'code_assist' | 'google_one' | 'ai_studio'
  tier_id?: string
}
export interface OAuthSession { auth_url: string; session_id: string; state?: string }
export interface OAuthResult { credentials: Record<string, unknown>; extra?: Record<string, unknown> }
export function operationError(error: unknown, fallback: string) {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : fallback
}

export function supportsOAuth(platform: string) {
  return ['anthropic', 'openai', 'gemini', 'antigravity', 'grok'].includes(platform)
}
function endpoints(options: OAuthOptions) {
  if (!supportsOAuth(options.platform) || (options.type === 'setup-token' && options.platform !== 'anthropic')) {
    throw new Error('此平台暂不支持交互式授权。')
  }
  return options.platform === 'openai'
    ? ['/admin/openai/generate-auth-url', '/admin/openai/exchange-code']
    : options.type === 'setup-token'
      ? ['/admin/accounts/generate-setup-token-url', '/admin/accounts/exchange-setup-token-code']
      : ['/admin/accounts/generate-auth-url', '/admin/accounts/exchange-code']
}
export async function startOAuth(options: OAuthOptions): Promise<OAuthSession> {
  const [endpoint] = endpoints(options)
  if (options.platform === 'gemini' && options.oauth_type === 'ai_studio' && (await gemini.getCapabilities()).ai_studio_oauth_enabled !== true) throw new Error('服务器尚未配置 AI Studio 自定义 OAuth client。')
  const proxy = options.proxy_id ? { proxy_id: options.proxy_id } : {}
  const response = options.platform === 'gemini'
    ? await gemini.generateAuthUrl({ ...proxy, project_id: options.project_id, oauth_type: options.oauth_type, tier_id: options.tier_id })
    : options.platform === 'grok' ? await grok.generateAuthUrl(proxy)
    : options.platform === 'antigravity'
      ? await antigravity.generateAuthUrl(proxy)
      : await accountsAPI.generateAuthUrl(endpoint!, proxy)
  const url = new URL(response.auth_url)
  if (url.protocol !== 'https:' || url.username || url.password || !response.session_id) throw new Error('授权服务返回了无效链接，请重新生成。')
  const state = ('state' in response ? response.state as string : '') || url.searchParams.get('state') || ''
  if (options.platform !== 'anthropic' && !state) throw new Error('授权会话缺少 state，请重新生成。')
  return { ...response, state }
}
export function parseCallback(input: string, session: OAuthSession, platform: string) {
  let code = input.trim()
  let state = session.state || ''
  if (/^https?:\/\//i.test(code)) {
    const callback = new URL(code)
    if (callback.searchParams.has('error')) throw new Error('授权被取消或拒绝，请重新授权。')
    const returnedState = callback.searchParams.get('state') || ''
    if (state && returnedState !== state) throw new Error('回调与当前授权会话不匹配，请使用本次授权结果。')
    state = returnedState || state
    code = callback.searchParams.get('code') || ''
  }
  if (!session.session_id || !code || (platform !== 'anthropic' && !state)) throw new Error('请先生成授权链接，再填写授权码或完整回调地址。')
  return { session_id: session.session_id, code, ...(platform !== 'anthropic' ? { state } : {}) }
}
export function mapOAuthResult(platform: string, token: Record<string, unknown>): OAuthResult {
  if (typeof token.access_token !== 'string' || !token.access_token.trim()) throw new Error('授权响应缺少有效凭据，请重新授权。')
  if (platform === 'anthropic') {
    const extra = Object.fromEntries(['org_uuid', 'account_uuid', 'email_address'].filter(k => token[k]).map(k => [k, token[k]]))
    return { credentials: { ...token }, extra }
  }
  if (platform === 'grok') {
    // Only OAuth output is persisted: never copy password/SSO cookie or a raw response.
    const keys = ['access_token', 'refresh_token', 'token_type', 'id_token', 'expires_at', 'client_id', 'scope', 'email', 'sub', 'team_id', 'subscription_tier', 'entitlement_status']
    return {
      credentials: Object.fromEntries(keys.filter(k => token[k] !== undefined && token[k] !== null && token[k] !== '').map(k => [k, token[k]])),
      extra: Object.fromEntries(['email', 'subscription_tier', 'entitlement_status'].filter(k => token[k]).map(k => [k, token[k]]))
    }
  }
  const keys = platform === 'openai'
    ? ['access_token', 'refresh_token', 'expires_at', 'id_token', 'email', 'chatgpt_account_id', 'chatgpt_user_id', 'organization_id', 'plan_type', 'subscription_expires_at', 'client_id']
    : platform === 'gemini'
      ? ['access_token', 'refresh_token', 'token_type', 'expires_at', 'scope', 'project_id', 'oauth_type', 'tier_id']
      : ['access_token', 'refresh_token', 'token_type', 'expires_at', 'project_id', 'email', 'plan_type']
  const credentials = Object.fromEntries(keys.filter(k => token[k] !== undefined && token[k] !== null && token[k] !== '').map(k => [k, token[k]]))
  if (platform !== 'openai' && typeof credentials.expires_at === 'number') credentials.expires_at = String(Math.floor(credentials.expires_at))
  const extra = platform === 'gemini' && token.extra && typeof token.extra === 'object' && !Array.isArray(token.extra)
    ? token.extra as Record<string, unknown>
    : platform === 'openai' ? Object.fromEntries(['email', 'name', 'privacy_mode'].filter(k => token[k]).map(k => [k, token[k]])) : undefined
  return { credentials, extra }
}
export async function finishOAuth(options: OAuthOptions, session: OAuthSession, input: string): Promise<OAuthResult> {
  const [, endpoint] = endpoints(options)
  const payload = { ...parseCallback(input, session, options.platform), ...(options.proxy_id ? { proxy_id: options.proxy_id } : {}) }
  const token = options.platform === 'gemini'
    ? await gemini.exchangeCode({ ...payload, state: payload.state!, oauth_type: options.oauth_type, tier_id: options.tier_id })
    : options.platform === 'grok' ? await grok.exchangeCode({ ...payload, state: payload.state! })
    : options.platform === 'antigravity'
      ? await antigravity.exchangeCode({ ...payload, state: payload.state! })
      : await accountsAPI.exchangeCode(endpoint!, payload)
  return mapOAuthResult(options.platform, token)
}

export type GrokAuthMethod = 'manual' | 'refresh_token' | 'sso_cookie' | 'email_password'
export async function grokPasswordCapability() { return (await grok.getCapabilities()).password_auth_enabled === true }
export async function finishGrokInput(method: Exclude<GrokAuthMethod, 'manual'>, input: string, proxyId?: number): Promise<OAuthResult> {
  if (!input.trim()) throw new Error('请填写授权信息。')
  if (method === 'email_password') {
    const split = input.indexOf('----')
    if (split < 1 || !input.slice(split + 4)) throw new Error('请填写邮箱和密码。')
  }
  const result = method === 'refresh_token' ? await grok.refreshGrokToken(input.trim(), proxyId)
    : method === 'sso_cookie' ? await grok.validateSSOToken(input.trim(), proxyId)
      : await grok.authorizePassword(input, proxyId)
  return mapOAuthResult('grok', result)
}

// Present in the official v0.2.1 route. The backend merges extra and invalidates
// token caches; never write the redacted GET credentials back via generic update.
export async function saveReauthorization(id: number, type: 'oauth' | 'setup-token', result: OAuthResult) {
  const credentials = Object.fromEntries(Object.entries(result.credentials).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  return accountsAPI.applyOAuthCredentials(id, { type, credentials, ...(result.extra ? { extra: result.extra } : {}) })
}
