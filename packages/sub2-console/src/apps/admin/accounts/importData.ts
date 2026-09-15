import type { AdminDataPayload, AdminDataImportResult } from '@/types'
import { validateDesktopFiles, validateJsonRequestBody, MAX_IMPORT_FILE_BYTES } from '../../../desktop-file-drop'

export const MAX_IMPORT_BYTES = MAX_IMPORT_FILE_BYTES
export const MAX_IMPORT_FILES = 10
export interface ImportFile { name: string; size: number; type?: string; webkitRelativePath?: string; text(): Promise<string> }
export interface ImportSummary { files: number; bytes: number; accounts: number; proxies: number; platforms: Record<string, number>; types: Record<string, number> }
export interface ImportState { phase: 'idle' | 'reading' | 'ready' | 'submitting' | 'complete' | 'partial' | 'failed' | 'unknown' | 'invalid'; message: string; summary: ImportSummary | null; result: Omit<AdminDataImportResult, 'errors'> | null }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0
export function parseAccountExport(text: string): AdminDataPayload {
  let data: unknown
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw Error('JSON 格式错误，请重新导出文件。') }
  if (!record(data) || !Array.isArray(data.accounts) || !Array.isArray(data.proxies)) throw Error('不是账号导出文件：需要 accounts 和 proxies 数组。')
  if (data.type !== undefined && !['', 'sub2api-data', 'sub2api-bundle'].includes(data.type as string)) throw Error('不支持此导出类型，请选择官方账号导出的 JSON。')
  if (data.version !== undefined && ![0, 1].includes(data.version as number)) throw Error('不支持此导出版本，请先核对版本兼容性。')
  if (!data.accounts.length && !data.proxies.length) throw Error('文件中没有可导入的账号或代理。')
  if (data.accounts.length > 10000 || data.proxies.length > 10000) throw Error('单次最多预览 10,000 个账号或代理，请拆分导出。')
  if (!data.accounts.every(a => record(a) && typeof a.name === 'string' && a.name.trim() && typeof a.platform === 'string' && a.platform && typeof a.type === 'string' && a.type && record(a.credentials) && positive(a.concurrency) && positive(a.priority))) throw Error('账号结构不完整，请使用官方账号导出文件。')
  if (!data.proxies.every(p => record(p) && typeof p.proxy_key === 'string' && p.proxy_key && typeof p.host === 'string' && typeof p.protocol === 'string' && positive(p.port) && Number(p.port) > 0 && Number(p.port) <= 65535)) throw Error('代理结构不完整，请重新导出。')
  return data as unknown as AdminDataPayload
}
export function validateImportResult(value: unknown, summary: ImportSummary): Omit<AdminDataImportResult, 'errors'> {
  if (!record(value)) throw Error('unknown')
  const keys = ['account_created', 'account_failed', 'proxy_created', 'proxy_reused', 'proxy_failed'] as const
  if (!keys.every(k => positive(value[k])) || Number(value.account_created) + Number(value.account_failed) !== summary.accounts || Number(value.proxy_created) + Number(value.proxy_reused) + Number(value.proxy_failed) !== summary.proxies) throw Error('unknown')
  // Never retain server error bodies: they can echo credentials or proxy URLs.
  return Object.fromEntries(keys.map(k => [k, value[k]])) as unknown as Omit<AdminDataImportResult, 'errors'>
}
export function createAccountImport(
  send: (payload: { data: AdminDataPayload; skip_default_group_bind: boolean }) => Promise<AdminDataImportResult>,
  changed: (state: ImportState) => void,
  fingerprint: (text: string) => Promise<string> = async text => {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
  }
) {
  let generation = 0, disposed = false, payload: AdminDataPayload | null = null, signatures: string[] = []
  const submitted = new Set<string>()
  let state: ImportState = { phase: 'idle', message: '', summary: null, result: null }
  const publish = (patch: Partial<ImportState>) => { state = { ...state, ...patch }; if (!disposed) changed({ ...state }) }
  function clear() { generation++; payload = null; signatures = [] }
  function cancel() { if (state.phase === 'submitting') return false; clear(); publish({ phase: 'idle', message: '', summary: null, result: null }); return true }
  async function select(files: ImportFile[], directory = false) {
    if (disposed || state.phase === 'submitting') return
    clear(); const current = generation
    publish({ phase: 'reading', message: '正在本地检查文件…', summary: null, result: null })
    try {
      if (directory || files.some(f => f.webkitRelativePath)) throw Error('不支持文件夹，请选择文件夹中的 JSON 文件。')
      const invalid = validateDesktopFiles(files)
      if (invalid) throw Error(invalid)
      if (files.some(f => !Number.isFinite(f.size))) throw Error('文件大小无效，请重新选择。')
      const parts: AdminDataPayload[] = [], hashes: string[] = []
      let actualBytes = 0
      for (let i = 0; i < files.length; i++) {
        let text: string
        try { text = await files[i]!.text() } catch { throw Error(`第 ${i + 1} 个文件读取失败，请重新选择。`) }
        if (disposed || current !== generation) return
        const byteLength = new TextEncoder().encode(text).byteLength; actualBytes += byteLength
        if (byteLength > MAX_IMPORT_BYTES || actualBytes > 50 * 1024 * 1024) throw Error('文件内容超过大小限制，已停止读取。')
        let part: AdminDataPayload
        try { part = parseAccountExport(text) } catch (e) { throw Error(`第 ${i + 1} 个文件：${(e as Error).message}`) }
        const hash = await fingerprint(JSON.stringify(part))
        if (disposed || current !== generation) return
        if (hashes.includes(hash)) throw Error('选择中包含重复文件；请移除重复项。')
        if (submitted.has(hash)) throw Error('本窗口已经提交过此文件，请先核对账号列表，避免重复导入。')
        parts.push(part); hashes.push(hash)
      }
      const first = parts[0]!
      const merged: AdminDataPayload = parts.length === 1 ? first : { type: 'sub2api-data', version: 1, exported_at: new Date().toISOString(), accounts: parts.flatMap(p => p.accounts), proxies: parts.flatMap(p => p.proxies), skipped_shadows: parts.reduce((n, p) => n + (positive(p.skipped_shadows) ? Number(p.skipped_shadows) : 0), 0) }
      // Cross-file proxy key collisions cannot be silently assigned to accounts.
      const proxyKeys = new Set<string>()
      for (const proxy of merged.proxies) { if (proxyKeys.has(proxy.proxy_key)) throw Error('文件中存在重复代理引用，请分别核对导出内容后再导入。'); proxyKeys.add(proxy.proxy_key) }
      const platforms: Record<string, number> = {}, types: Record<string, number> = {}
      for (const account of merged.accounts) {
        const p = ['anthropic','openai','gemini','antigravity','deepseek','grok','kimi','zhipu'].includes(account.platform) ? account.platform : 'other'
        const t = ['apikey','oauth','setup-token','bedrock','service_account','upstream'].includes(account.type) ? account.type : 'other'
        platforms[p] = (platforms[p] || 0) + 1; types[t] = (types[t] || 0) + 1
      }
      validateJsonRequestBody({ data: merged, skip_default_group_bind: false })
      payload = merged; signatures = hashes
      publish({ phase: 'ready', message: '检查完成，尚未上传。', summary: { files: files.length, bytes: files.reduce((n, f) => n + f.size, 0), accounts: merged.accounts.length, proxies: merged.proxies.length, platforms, types } })
    } catch (e) { if (!disposed && current === generation) { payload = null; signatures = []; publish({ phase: 'invalid', message: (e as Error).message, summary: null }) } }
  }
  async function confirm(skipDefaultGroup: boolean) {
    if (disposed || state.phase !== 'ready' || !payload || !state.summary) return
    const data = payload, summary = state.summary, current = generation
    signatures.forEach(hash => submitted.add(hash)); payload = null; signatures = []
    publish({ phase: 'submitting', message: '正在导入，请勿重复提交。' })
    try {
      const response = await send({ data, skip_default_group_bind: skipDefaultGroup })
      if (disposed || current !== generation) return
      const result = validateImportResult(response, summary)
      const failed = result.account_failed + result.proxy_failed
      publish({ result, phase: failed ? result.account_created + result.proxy_created + result.proxy_reused > 0 ? 'partial' : 'failed' : 'complete', message: failed ? '导入存在失败项。已完成部分不会回滚，请勿重新提交整个文件。' : '导入完成。' })
    } catch { if (!disposed && current === generation) publish({ phase: 'unknown', message: '导入结果无法确认。请求可能已经写入，请先刷新账号与代理列表核对；本窗口禁止重发同一文件。', result: null }) }
  }
  return { select, confirm, cancel, dispose() { disposed = true; clear(); submitted.clear() } }
}
