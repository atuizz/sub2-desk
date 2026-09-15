import { accountsAPI } from '@/api/admin/accounts'
import { mapOAuthResult, type OAuthResult } from './oauth'
import type { CreateAccountRequest } from '@/types'

export type BatchMethod = 'refresh_token' | 'mobile_refresh_token' | 'codex_session' | 'agent_identity' | 'codex_pat' | 'cookie'
export type BatchSettings = Omit<CreateAccountRequest, 'credentials'> & { credential_extras?: Record<string, unknown>; update_existing?: boolean }
export type BatchStatus = 'pending' | 'exchanging' | 'saving' | 'created' | 'updated' | 'skipped' | 'exchange_failed' | 'save_failed' | 'unknown'
export interface BatchRow { index: number; status: BatchStatus; message: string; accountId?: number }
export const MOBILE_CLIENT_ID = 'app_LlGpXReQgckcGGUo2JrYvtJK'
export function batchMethods(platform: string): BatchMethod[] {
  return platform === 'openai' ? ['refresh_token', 'mobile_refresh_token', 'codex_session', 'agent_identity', 'codex_pat'] : platform === 'anthropic' ? ['cookie'] : []
}
export function parseBatch(method: BatchMethod, content: string): string[] {
  if (!content.trim()) throw new Error('请填写授权信息。')
  let entries: string[]
  if (method === 'codex_session' || method === 'agent_identity') {
    let values: unknown[]
    try { const parsed = JSON.parse(content); values = Array.isArray(parsed) ? parsed : [parsed] }
    catch {
      try { values = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => JSON.parse(s)) }
      catch { throw new Error('请输入有效的 JSON 对象、对象数组或每行一个 JSON 对象。') }
    }
    if (!values.length || values.some(v => !v || typeof v !== 'object' || Array.isArray(v))) throw new Error('每条导入记录必须是 JSON 对象。')
    if (method === 'agent_identity' && values.some(v => {
      const r = v as Record<string, unknown>, identity = r.agent_identity ?? r.agentIdentity
      return String(r.auth_mode ?? r.authMode).toLowerCase() !== 'agentidentity' && (!identity || typeof identity !== 'object' || Array.isArray(identity))
    })) throw new Error('Agent Identity 记录须包含 agent_identity 对象或 auth_mode=agentidentity。')
    entries = values.map(v => JSON.stringify(v))
  } else entries = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
  // Avoid duplicating identical secrets pasted twice within one batch.
  entries = [...new Set(entries)]
  if (!entries.length) throw new Error('没有可导入的记录。')
  return entries
}
function safeFailure(error: unknown, saving: boolean): { status: BatchStatus; message: string } {
  const e = error as { status?: number; response?: { status?: number } }
  const status = e?.status ?? e?.response?.status
  // Write timeouts/5xx/invalid responses may have committed. Never automatically replay.
  if (saving && !(status && [400, 401, 403, 404, 405, 422, 429].includes(status))) {
    return { status: 'unknown', message: '保存结果未知，请先核对账号列表；此项不会自动重试。' }
  }
  const message = status === 404 || status === 405 ? '当前后端未提供此接口。'
    : status === 401 || status === 403 ? '认证或权限不足。'
      : status === 429 ? '请求受限，请稍后重试。'
        : saving ? '服务器拒绝保存，可重试失败项。' : '授权兑换失败，请检查输入或稍后重试。'
  // Do not surface arbitrary provider responses which can echo credentials.
  return { status: saving ? 'save_failed' : 'exchange_failed', message }
}

export function createBatchAuthorization(method: BatchMethod, content: string, settings: BatchSettings) {
  if (!batchMethods(settings.platform).includes(method) || !['oauth', 'setup-token'].includes(settings.type)) throw new Error('此账号类型不支持所选批量授权。')
  const config: BatchSettings = JSON.parse(JSON.stringify(settings))
  // Import endpoints accept credential_extras, never existing account secrets.
  const allowedExtras = ['model_mapping', 'compact_model_mapping', 'temp_unschedulable_enabled', 'temp_unschedulable_rules', 'intercept_warmup_requests']
  config.credential_extras = Object.fromEntries(Object.entries(config.credential_extras || {}).filter(([key]) => allowedExtras.includes(key)))
  const raw = parseBatch(method, content)
  const values = new Map(raw.map((v, i) => [i + 1, v]))
  const tokens = new Map<number, OAuthResult>()
  const rows: BatchRow[] = raw.map((_, i) => ({ index: i + 1, status: 'pending', message: '等待处理' }))
  raw.fill('')
  let busy = false, disposed = false
  const importMode = method === 'codex_session' || method === 'agent_identity'
  const directWrite = importMode || method === 'codex_pat'
  const snapshot = () => rows.map(r => ({ ...r }))
  const dispose = () => { disposed = true; values.clear(); tokens.clear() }
  async function run(notify: (rows: BatchRow[]) => void = () => {}) {
    if (busy || disposed) return
    busy = true
    const report = () => { if (!disposed) notify(snapshot()) }
    try {
      for (const row of rows) {
        if (disposed) break
        if (!['pending', 'exchange_failed', 'save_failed'].includes(row.status)) continue
        let saving = directWrite
        try {
          const input = values.get(row.index) || ''
          const { platform, type, credential_extras, update_existing, ...common } = config
          const name = rows.length > 1 ? `${config.name} #${row.index}` : config.name
          if (importMode) {
            row.status = 'saving'; row.message = '正在导入'; report()
            const result = await accountsAPI.importCodexSession({ ...common, name, content: input, credential_extras, update_existing: update_existing ?? true })
            if (disposed) break
            if ([result.created, result.updated, result.skipped, result.failed].some(v => !Number.isInteger(v) || v < 0) || result.created + result.updated + result.skipped + result.failed !== 1) throw new Error('Invalid import outcome')
            const successful = result.created + result.updated
            row.status = result.created ? 'created' : result.updated ? 'updated' : result.skipped ? 'skipped' : 'save_failed'
            row.message = result.created ? '已创建' : result.updated ? '已更新现有账号' : result.skipped ? '已跳过' : '导入失败，请检查此条记录。'
            row.accountId = result.items?.[0]?.account_id
            if (successful && result.warnings?.length) row.message += '（服务端返回警告，请核对账号配置）'
          } else if (method === 'codex_pat') {
            row.status = 'saving'; row.message = '正在创建'; report()
            const result = await accountsAPI.createOpenAICodexPAT({ ...common, name, access_token: input, credential_extras })
            if (disposed) break
            if (!result?.id) throw new Error('Missing account')
            row.status = 'created'; row.message = '已创建'; row.accountId = result.id
          } else {
            if (!tokens.has(row.index)) {
              row.status = 'exchanging'; row.message = '正在兑换授权'; report()
              const clientId = method === 'mobile_refresh_token' ? MOBILE_CLIENT_ID : undefined
              const response = method === 'cookie'
                ? await accountsAPI.exchangeCode(type === 'setup-token' ? '/admin/accounts/setup-token-cookie-auth' : '/admin/accounts/cookie-auth', { session_id: '', code: input, ...(config.proxy_id ? { proxy_id: config.proxy_id } : {}) })
                : await accountsAPI.refreshOpenAIToken(input, config.proxy_id, '/admin/openai/refresh-token', clientId)
              if (disposed) break
              const result = mapOAuthResult(platform, response)
              if (clientId) result.credentials.client_id = clientId
              if (method === 'cookie') for (const key of ['cookie', 'session_key', 'sessionKey', 'code', 'password', 'session_id']) delete result.credentials[key]
              tokens.set(row.index, result); values.delete(row.index)
            }
            const result = tokens.get(row.index)!
            saving = true; row.status = 'saving'; row.message = '正在保存账号'; report()
            const account = await accountsAPI.create({ ...common, name, platform, type,
              credentials: { ...result.credentials, ...credential_extras }, extra: { ...result.extra, ...config.extra } })
            if (disposed) break
            if (!account?.id) throw new Error('Missing account')
            row.status = 'created'; row.message = '已创建'; row.accountId = account.id
          }
          if (['created', 'updated', 'skipped'].includes(row.status)) { tokens.delete(row.index); values.delete(row.index) }
        } catch (e) {
          if (disposed) break
          Object.assign(row, safeFailure(e, saving))
          if (row.status === 'unknown') { tokens.delete(row.index); values.delete(row.index) }
        }
        report()
      }
    } finally { busy = false }
  }
  return { snapshot, run, dispose, isBusy: () => busy }
}
