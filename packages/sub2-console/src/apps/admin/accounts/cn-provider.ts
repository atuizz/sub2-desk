// Endpoint data from official v0.2.4 frontend/components/account/credentialsBuilder.ts.
// Kept local: no runtime dependency on the upstream checkout.
export type CnAccountMode = 'payg' | 'coding'
export type CnProviderPlatform = 'kimi' | 'zhipu' | 'deepseek' | 'minimax'

/** deepseek / kimi / minimax 支持原生 responses；adaptive 会按入站协议选择原生端点。 */
export type CnApiProtocol = 'adaptive' | 'chat_completions' | 'anthropic' | 'responses'
export type CnNativeApiProtocol = Exclude<CnApiProtocol, 'adaptive'>

export function isCNProviderPlatform(platform: string): platform is CnProviderPlatform {
  return platform === 'kimi' || platform === 'zhipu' || platform === 'deepseek' || platform === 'minimax'
}

/** DeepSeek、Kimi 与 MiniMax 提供原生 Responses 端点。 */
export function cnSupportsNativeResponses(platform: string): boolean {
  return platform === 'deepseek' || platform === 'kimi' || platform === 'minimax'
}

export interface CnBaseUrlPreset {
  mode: CnAccountMode
  protocol: CnApiProtocol
  /** 专有名词，不参与 i18n */
  label: string
  url: string
}

/** 各供应商按账号类型 × API 协议分档的快捷端点（点击快速填充，输入框仍可自由填写）。 */
export const CN_BASE_URL_PRESETS: Record<CnProviderPlatform, CnBaseUrlPreset[]> = {
  kimi: [
    { mode: 'payg', protocol: 'chat_completions', label: 'Moonshot', url: 'https://api.moonshot.cn/v1' },
    { mode: 'payg', protocol: 'anthropic', label: 'Moonshot Anthropic', url: 'https://api.moonshot.cn/anthropic' },
    { mode: 'payg', protocol: 'responses', label: 'Moonshot Responses', url: 'https://api.moonshot.cn/v1' },
    { mode: 'coding', protocol: 'chat_completions', label: 'Kimi For Coding', url: 'https://api.kimi.com/coding/v1' },
    { mode: 'coding', protocol: 'anthropic', label: 'Kimi Coding Anthropic', url: 'https://api.kimi.com/coding' },
    { mode: 'coding', protocol: 'responses', label: 'Kimi Coding Responses', url: 'https://api.kimi.com/coding/v1' }
  ],
  zhipu: [
    { mode: 'payg', protocol: 'chat_completions', label: 'GLM PaaS', url: 'https://open.bigmodel.cn/api/paas/v4' },
    { mode: 'payg', protocol: 'anthropic', label: 'GLM Anthropic', url: 'https://open.bigmodel.cn/api/anthropic' },
    { mode: 'coding', protocol: 'chat_completions', label: 'GLM Coding', url: 'https://open.bigmodel.cn/api/coding/paas/v4' },
    { mode: 'coding', protocol: 'anthropic', label: 'GLM Coding Anthropic', url: 'https://open.bigmodel.cn/api/anthropic' }
  ],
  deepseek: [
    { mode: 'payg', protocol: 'chat_completions', label: 'DeepSeek', url: 'https://api.deepseek.com' },
    { mode: 'payg', protocol: 'anthropic', label: 'DeepSeek Anthropic', url: 'https://api.deepseek.com/anthropic' },
    { mode: 'payg', protocol: 'responses', label: 'DeepSeek Responses', url: 'https://api.deepseek.com' }
  ],
  minimax: [
    { mode: 'payg', protocol: 'chat_completions', label: 'MiniMax CN', url: 'https://api.minimaxi.com/v1' },
    { mode: 'payg', protocol: 'anthropic', label: 'MiniMax CN Anthropic', url: 'https://api.minimaxi.com/anthropic' },
    { mode: 'payg', protocol: 'responses', label: 'MiniMax CN Responses', url: 'https://api.minimaxi.com/v1' },
    { mode: 'payg', protocol: 'chat_completions', label: 'MiniMax Intl', url: 'https://api.minimax.io/v1' },
    { mode: 'payg', protocol: 'anthropic', label: 'MiniMax Intl Anthropic', url: 'https://api.minimax.io/anthropic' },
    { mode: 'payg', protocol: 'responses', label: 'MiniMax Intl Responses', url: 'https://api.minimax.io/v1' },
    { mode: 'coding', protocol: 'chat_completions', label: 'MiniMax Coding CN', url: 'https://api.minimaxi.com/v1' },
    { mode: 'coding', protocol: 'anthropic', label: 'MiniMax Coding CN Anthropic', url: 'https://api.minimaxi.com/anthropic' },
    { mode: 'coding', protocol: 'responses', label: 'MiniMax Coding CN Responses', url: 'https://api.minimaxi.com/v1' },
    { mode: 'coding', protocol: 'chat_completions', label: 'MiniMax Coding Intl', url: 'https://api.minimax.io/v1' },
    { mode: 'coding', protocol: 'anthropic', label: 'MiniMax Coding Intl Anthropic', url: 'https://api.minimax.io/anthropic' },
    { mode: 'coding', protocol: 'responses', label: 'MiniMax Coding Intl Responses', url: 'https://api.minimax.io/v1' }
  ]
}

/** 返回指定供应商 + 账号类型 + API 协议的默认 base url。 */
export function defaultCNBaseUrl(
  platform: string,
  mode: CnAccountMode,
  protocol: CnApiProtocol = 'chat_completions'
): string {
  if (protocol === 'anthropic') {
    switch (platform) {
      case 'kimi':
        return mode === 'coding' ? 'https://api.kimi.com/coding' : 'https://api.moonshot.cn/anthropic'
      case 'zhipu':
        return 'https://open.bigmodel.cn/api/anthropic'
      case 'deepseek':
        return 'https://api.deepseek.com/anthropic'
      case 'minimax':
        return 'https://api.minimaxi.com/anthropic'
      default:
        return ''
    }
  }
  // responses：Kimi / DeepSeek / MiniMax 的 base 与 chat_completions 相同（端点路径差异由后端处理）。
  switch (platform) {
    case 'kimi':
      return mode === 'coding' ? 'https://api.kimi.com/coding/v1' : 'https://api.moonshot.cn/v1'
    case 'zhipu':
      return mode === 'coding'
        ? 'https://open.bigmodel.cn/api/coding/paas/v4'
        : 'https://open.bigmodel.cn/api/paas/v4'
    case 'deepseek':
      return 'https://api.deepseek.com'
    case 'minimax':
      return 'https://api.minimaxi.com/v1'
    default:
      return ''
  }
}

/** 返回自适应模式下需要配置的原生协议及其默认端点。 */
export function defaultCNAdaptiveBaseUrls(
  platform: CnProviderPlatform,
  mode: CnAccountMode
): Record<CnNativeApiProtocol, string> {
  return {
    chat_completions: defaultCNBaseUrl(platform, mode, 'chat_completions'),
    anthropic: defaultCNBaseUrl(platform, mode, 'anthropic'),
    responses: cnSupportsNativeResponses(platform) ? defaultCNBaseUrl(platform, mode, 'responses') : ''
  }
}

export interface CNProviderForm {
  /** Prevent a stale draft being saved after the parent changes platforms. */
  platform: CnProviderPlatform
  account_mode: CnAccountMode
  api_protocol: CnApiProtocol
  base_url: string
  api_base_urls: Record<CnNativeApiProtocol, string>
  /** New/replacement key only. Existing secrets are never hydrated into the form. */
  api_key: string
  zhipu_organization: string
  zhipu_project: string
}

/** Structural type accepts the existing Account; no shared API types need changing. */
export interface CNAccountSource {
  platform: string
  type: string
  credentials: Readonly<Record<string, unknown>>
  credentials_status?: Readonly<Record<string, boolean>>
}
export interface CNBuildOptions { current?: CNAccountSource; initial?: CNProviderForm }
export interface CNCredentialsPatch { set: Record<string, unknown>; remove: string[] }
export type CNProviderErrors = Partial<Record<'platform' | 'account_mode' | 'api_protocol' | 'api_key' | 'base_url' | 'chat_completions' | 'anthropic' | 'responses' | 'zhipu_project', string>>

const text = (value: unknown): string => typeof value === 'string' ? value : ''
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function cnHasExistingApiKey(account?: CNAccountSource): boolean {
  return account?.credentials_status?.has_api_key ?? Boolean(text(account?.credentials.api_key).trim())
}
function requirePlatform(platform: string): asserts platform is CnProviderPlatform {
  if (!isCNProviderPlatform(platform)) throw new Error('请选择 MiniMax、Kimi、Zhipu GLM 或 DeepSeek。')
}
function requireAccount(platform: string, account?: CNAccountSource) {
  if (account && (account.platform !== platform || account.type !== 'apikey')) throw new Error('账号平台或类型已变化，请重新读取账号。')
}
export function cnNativeProtocols(platform: string): CnNativeApiProtocol[] {
  requirePlatform(platform)
  return cnSupportsNativeResponses(platform) ? ['chat_completions', 'anthropic', 'responses'] : ['chat_completions', 'anthropic']
}
export function cnAccountModes(platform: string): CnAccountMode[] {
  requirePlatform(platform)
  return platform === 'deepseek' ? ['payg'] : ['payg', 'coding']
}
export function cnProtocols(platform: string): CnApiProtocol[] { return ['adaptive', ...cnNativeProtocols(platform)] }

/** Create defaults to payg/adaptive; legacy edit defaults to chat_completions. No writes. */
export function cnProviderForm(platform: string, account?: CNAccountSource): CNProviderForm {
  requirePlatform(platform); requireAccount(platform, account)
  const c = account?.credentials ?? {}
  const mode = platform !== 'deepseek' && c.account_mode === 'coding' ? 'coding' : 'payg'
  const protocol = account
    ? cnProtocols(platform).includes(c.api_protocol as CnApiProtocol) ? c.api_protocol as CnApiProtocol : 'chat_completions'
    : 'adaptive'
  const urls = defaultCNAdaptiveBaseUrls(platform, mode)
  const stored = record(c.api_base_urls)
  for (const key of cnNativeProtocols(platform)) if (text(stored[key]).trim()) urls[key] = text(stored[key])
  const legacyProtocol = protocol === 'adaptive' ? 'chat_completions' : protocol
  const base = text(c.base_url)
  if (base.trim() && !text(stored[legacyProtocol]).trim()) urls[legacyProtocol] = base
  return {
    platform, account_mode: mode, api_protocol: protocol,
    base_url: protocol === 'adaptive' ? urls.chat_completions : base || defaultCNBaseUrl(platform, mode, protocol),
    api_base_urls: urls, api_key: '',
    zhipu_organization: platform === 'zhipu' ? text(c.zhipu_organization) : '',
    zhipu_project: platform === 'zhipu' ? text(c.zhipu_project) : ''
  }
}
export function cloneCNProviderForm(form: CNProviderForm): CNProviderForm {
  return { ...form, api_base_urls: { ...form.api_base_urls } }
}

/** Call only for an explicit user selection; never watch hydrated edit fields. */
export function changeCNAccountMode(form: CNProviderForm, mode: CnAccountMode): CNProviderForm {
  if (!cnAccountModes(form.platform).includes(mode)) throw new Error('DeepSeek 仅支持按量付费。')
  const next = cloneCNProviderForm(form)
  if (mode === form.account_mode) return next
  next.account_mode = mode
  if (form.api_protocol === 'adaptive') {
    const previous = defaultCNAdaptiveBaseUrls(form.platform, form.account_mode)
    const defaults = defaultCNAdaptiveBaseUrls(form.platform, mode)
    for (const key of cnNativeProtocols(form.platform)) {
      if (!form.api_base_urls[key].trim() || form.api_base_urls[key].trim() === previous[key]) next.api_base_urls[key] = defaults[key]
    }
    next.base_url = next.api_base_urls.chat_completions
  } else next.base_url = defaultCNBaseUrl(form.platform, mode, form.api_protocol)
  return next
}
export function changeCNProtocol(form: CNProviderForm, protocol: CnApiProtocol): CNProviderForm {
  if (!cnProtocols(form.platform).includes(protocol)) throw new Error('当前供应商不支持该原生协议。')
  const next = cloneCNProviderForm(form)
  if (protocol === form.api_protocol) return next
  next.api_protocol = protocol
  if (protocol === 'adaptive') {
    const defaults = defaultCNAdaptiveBaseUrls(form.platform, form.account_mode)
    for (const key of cnNativeProtocols(form.platform)) if (!next.api_base_urls[key].trim()) next.api_base_urls[key] = defaults[key]
    if (form.api_protocol !== 'adaptive' && form.base_url.trim()) next.api_base_urls[form.api_protocol] = form.base_url
    next.base_url = next.api_base_urls.chat_completions
  } else next.base_url = form.api_protocol === 'adaptive'
    ? next.api_base_urls[protocol] || defaultCNBaseUrl(form.platform, form.account_mode, protocol)
    : defaultCNBaseUrl(form.platform, form.account_mode, protocol)
  return next
}
export function selectCNPreset(form: CNProviderForm, preset: CnBaseUrlPreset): CNProviderForm {
  if (!CN_BASE_URL_PRESETS[form.platform].some(p => p.mode === preset.mode && p.protocol === preset.protocol && p.url === preset.url)) throw new Error('该预设不属于当前供应商。')
  const next = changeCNProtocol(changeCNAccountMode(form, preset.mode), preset.protocol)
  next.base_url = preset.url
  return next
}

function routingChanged(form: CNProviderForm, initial?: CNProviderForm): boolean {
  if (!initial) return true
  if (form.account_mode !== initial.account_mode || form.api_protocol !== initial.api_protocol) return true
  return form.api_protocol === 'adaptive'
    ? cnNativeProtocols(form.platform).some(key => form.api_base_urls[key] !== initial.api_base_urls[key])
    : form.base_url !== initial.base_url
}
function endpointError(value: string): boolean {
  // Accept user-controlled relays, preserve paths/queries/trailing slash exactly. No network probes.
  try { const url = new URL(value); return !/^https?:\/\//i.test(value) || !['http:', 'https:'].includes(url.protocol) || !url.hostname || !!url.username || !!url.password || /[\u0000-\u0020\u007f\\]/.test(value) }
  catch { return true }
}
export function validateCNProviderForm(platform: string, form: CNProviderForm, options: CNBuildOptions = {}): CNProviderErrors {
  const errors: CNProviderErrors = {}
  if (!isCNProviderPlatform(platform) || form.platform !== platform || (options.current && (options.current.platform !== platform || options.current.type !== 'apikey')) || (options.initial && options.initial.platform !== platform)) {
    return { platform: '账号平台或草稿已变化，请重新读取账号。' }
  }
  if (options.current && !options.initial) return { platform: '请先保存读取到的表单基线，再编辑账号。' }
  if (options.initial && !options.current) return { platform: '编辑基线缺少对应账号，请重新读取账号。' }
  if (!cnAccountModes(platform).includes(form.account_mode)) errors.account_mode = '该供应商不支持此计费方式。'
  if (!cnProtocols(platform).includes(form.api_protocol)) errors.api_protocol = '该供应商不支持此原生协议。'
  if (!form.api_key.trim() && !cnHasExistingApiKey(options.current)) errors.api_key = '请输入 API Key。'
  if (routingChanged(form, options.initial) && !errors.api_protocol && !errors.account_mode) {
    if (form.api_protocol === 'adaptive') {
      const defaults = defaultCNAdaptiveBaseUrls(platform, form.account_mode)
      for (const key of cnNativeProtocols(platform)) if (endpointError(form.api_base_urls[key].trim() || defaults[key])) errors[key] = '请输入完整的 HTTP(S) 地址，不包含用户名或密码。'
    } else if (endpointError(form.base_url.trim() || defaultCNBaseUrl(platform, form.account_mode, form.api_protocol))) errors.base_url = '请输入完整的 HTTP(S) 地址，不包含用户名或密码。'
  }
  const teamChanged = !options.initial || form.zhipu_organization !== options.initial.zhipu_organization || form.zhipu_project !== options.initial.zhipu_project
  if (platform === 'zhipu' && form.account_mode === 'coding' && teamChanged && form.zhipu_project.trim() && !form.zhipu_organization.trim() && (!options.initial || form.zhipu_organization === options.initial.zhipu_organization)) {
    errors.zhipu_project = '填写项目 ID 时，请同时填写组织 ID。'
  }
  return errors
}

/** Local diff only: do NOT send this object or its `set` directly to the backend. */
export function buildCNProviderPatch(platform: string, form: CNProviderForm, options: CNBuildOptions = {}): CNCredentialsPatch {
  const errors = validateCNProviderForm(platform, form, options)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  const patch: CNCredentialsPatch = { set: {}, remove: [] }
  const put = (key: string, value: unknown) => { patch.set[key] = value }
  if (form.api_key.trim()) put('api_key', form.api_key.trim())
  if (routingChanged(form, options.initial)) {
    put('account_mode', form.account_mode); put('api_protocol', form.api_protocol)
    if (form.api_protocol === 'adaptive') {
      // Preserve unknown endpoint keys from the current account as well.
      const urls: Record<string, unknown> = { ...record(options.current?.credentials.api_base_urls) }
      const defaults = defaultCNAdaptiveBaseUrls(form.platform, form.account_mode)
      for (const key of cnNativeProtocols(form.platform)) urls[key] = form.api_base_urls[key].trim() || defaults[key]
      put('api_base_urls', urls); put('base_url', urls.chat_completions)
    } else {
      put('base_url', form.base_url.trim() || defaultCNBaseUrl(platform, form.account_mode, form.api_protocol))
      if (options.current && 'api_base_urls' in options.current.credentials) patch.remove.push('api_base_urls')
    }
  }
  const initial = options.initial
  const teamChanged = !initial || form.zhipu_organization !== initial.zhipu_organization || form.zhipu_project !== initial.zhipu_project
  if (platform === 'zhipu' && teamChanged && (form.account_mode === 'coding' || options.current)) {
    const org = form.zhipu_organization.trim(), project = form.zhipu_project.trim()
    if (org) {
      put('zhipu_organization', org)
      if (project) put('zhipu_project', project)
      else if (options.current && 'zhipu_project' in options.current.credentials) patch.remove.push('zhipu_project')
    } else if (options.current) for (const key of ['zhipu_organization', 'zhipu_project']) if (key in options.current.credentials) patch.remove.push(key)
  }
  return patch
}

/** Full credentials replacement for the official update API; undefined means omit credentials. */
export function buildCNProviderCredentials(platform: string, form: CNProviderForm, options: CNBuildOptions = {}): Record<string, unknown> | undefined {
  const patch = buildCNProviderPatch(platform, form, options)
  if (options.current && !Object.keys(patch.set).length && !patch.remove.length) return undefined
  const credentials = { ...options.current?.credentials, ...patch.set }
  for (const key of patch.remove) delete credentials[key]
  return credentials
}
