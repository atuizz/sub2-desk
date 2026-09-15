import type { ChannelModelPricing, PricingInterval } from '../../../api/admin/channels'
import type { PlatformQuotaUpdateItem } from '../../../api/admin/users'
import type { UpdatePolicyGroup, AttributeDefinition } from '../../../types/admin-policies'

export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) }
export function changedFields<T extends object>(before: T, after: T): Partial<T> {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(before[key as keyof T]))) as Partial<T>
}
export function nullableNumber(value: string, scale = 1): number | null {
  if (value.trim() === '') return null
  const n = Number(value) / scale
  if (!Number.isFinite(n) || n < 0) throw new Error('请输入非负有限数字，留空表示未设置。')
  return n
}
export function ids(value: string): number[] {
  if (!value.trim()) return []
  const result = value.split(/[,，\s]+/).filter(Boolean).map(Number)
  if (result.some(n => !Number.isSafeInteger(n) || n <= 0) || new Set(result).size !== result.length)
    throw new Error('ID 须为不重复的正整数。')
  return result
}
export function models(value: string): string[] { return value.split(/[,，\n]+/).map(s => s.trim()).filter(Boolean) }
export function routing(rows: { model: string; accounts: string }[]): Record<string, number[]> {
  const result: Record<string, number[]> = {}
  for (const row of rows) {
    const key = row.model.trim()
    if (!key || ['__proto__', 'prototype', 'constructor'].includes(key) || Object.prototype.hasOwnProperty.call(result, key)) throw new Error('路由模型不能为空或重复。')
    const accounts = ids(row.accounts)
    if (!accounts.length) throw new Error('每条模型路由至少指定一个账号 ID。')
    result[key] = accounts
  }
  return result
}
export function validateGroup(patch: UpdatePolicyGroup): void {
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) throw new Error('额度、倍率与策略数值须为非负数字。')
    if (key.startsWith('fallback_group_id') && value != null && (!Number.isSafeInteger(value) || Number(value) <= 0)) throw new Error('回退分组 ID 须为正整数或留空。')
  }
  if (patch.model_allowlist) {
    const list = patch.model_allowlist.models
    if (list.some(m => !m.trim() || (m.includes('*') && (!m.endsWith('*') || m.slice(0,-1).includes('*')))) || new Set(list).size !== list.length)
      throw new Error('白名单模型不能重复；通配符只能出现在末尾。')
    if (patch.model_allowlist.enabled && !list.length) throw new Error('启用白名单前请至少添加一个模型。')
  }
}
export const tokenPrices = [
  ['input_price', '输入'], ['output_price', '输出'], ['cache_write_price', '缓存写入'],
  ['cache_write_1h_price', '缓存写入（1小时）'], ['cache_read_price', '缓存读取'],
] as const
export const multipliers = [
  ['input_multiplier', '输入倍率'], ['output_multiplier', '输出倍率'],
  ['cache_write_multiplier', '缓存写入倍率'], ['cache_read_multiplier', '缓存读取倍率'],
] as const
export function newInterval(): PricingInterval {
  return { min_tokens: 0, max_tokens: null, tier_label: '', input_price: null, output_price: null,
    cache_write_price: null, cache_read_price: null, input_multiplier: null, output_multiplier: null,
    cache_write_multiplier: null, cache_read_multiplier: null, per_request_price: null, sort_order: 0 }
}
export function newPricing(): ChannelModelPricing {
  return { platform: 'openai', models: [], billing_mode: 'token', input_price: null, output_price: null,
    cache_write_price: null, cache_read_price: null, image_input_price: null, image_output_price: null,
    per_request_price: null, intervals: [], time_pricing: null }
}
export function validatePricing(pricing: ChannelModelPricing[]): void {
  const seen = new Set<string>()
  const patterns: { platform: string; prefix: string; wildcard: boolean }[] = []
  for (const p of pricing) {
    if (!p.platform || !p.models.length) throw new Error('每条定价须指定平台和模型。')
    for (const model of p.models) {
      const key = `${p.platform}:${model.toLowerCase()}`
      if (!model.trim() || seen.has(key)) throw new Error('同平台定价模型不能重复。')
      seen.add(key)
      const wildcard = model.endsWith('*'), prefix = (wildcard ? model.slice(0,-1) : model).toLowerCase()
      if (prefix.includes('*')) throw new Error('模型通配符只能出现在末尾。')
      if (patterns.some(old => old.platform === p.platform &&
        (old.wildcard && prefix.startsWith(old.prefix) || wildcard && old.prefix.startsWith(prefix)))) throw new Error('同平台定价模型模式不能重叠。')
      patterns.push({ platform: p.platform, prefix, wildcard })
    }
    for (const row of [p, ...(p.intervals || [])]) {
      for (const [key, value] of Object.entries(row)) {
        if ((key.endsWith('_price') || key.endsWith('_multiplier')) && value != null &&
          (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new Error('价格与倍率须为非负有限数字。')
      }
    }
    const sorted = [...(p.intervals || [])].sort((a,b) => a.min_tokens - b.min_tokens)
    sorted.forEach((iv, i) => {
      if (!Number.isSafeInteger(iv.sort_order) || iv.sort_order < 0) throw new Error('阶梯排序须为非负整数。')
      if (!Number.isSafeInteger(iv.min_tokens) || iv.min_tokens < 0 ||
        (iv.max_tokens != null && (!Number.isSafeInteger(iv.max_tokens) || iv.max_tokens <= iv.min_tokens))) throw new Error('阶梯 Token 上限须大于下限；留空表示无限。')
      if (p.billing_mode === 'token' && i > 0 && (sorted[i-1].max_tokens == null || iv.min_tokens < sorted[i-1].max_tokens!)) throw new Error('Token 阶梯不能重叠，无上限段须放在最后。')
    })
    if (p.time_pricing) {
      try { new Intl.DateTimeFormat('en', { timeZone: p.time_pricing.timezone }) } catch { throw new Error('请填写有效的 IANA 时区。') }
      if (!p.time_pricing.timezone.trim() || !p.time_pricing.periods.length) throw new Error('启用时段定价后至少添加一个时段。')
      const seconds = (s: string) => { if (!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(s)) throw new Error('时段格式须为 HH:mm:ss。'); const [h,m,v] = s.split(':').map(Number); return h*3600+m*60+v }
      const periods = p.time_pricing.periods.map(v => {
        const start = seconds(v.start_time), end = seconds(v.end_time) || 86400
        if (start >= end || v.start_time === v.end_time) throw new Error('结束时间须晚于开始时间；00:00:00 可表示日末。')
        if (!Number.isFinite(v.multiplier) || v.multiplier <= 0 || !/^\d+(?:\.\d{1,2})?$/.test(String(v.multiplier))) throw new Error('时段倍率须大于零且最多两位小数。')
        return { start, end }
      }).sort((a,b) => a.start-b.start)
      if (periods.some((v,i) => i > 0 && v.start < periods[i-1].end)) throw new Error('定价时段不能重叠。')
    }
  }
}
export function quotaPayload(rows: PlatformQuotaUpdateItem[]): PlatformQuotaUpdateItem[] {
  const seen = new Set<string>()
  return rows.map(row => {
    if (!row.platform || ['daily_limit_usd','weekly_limit_usd','monthly_limit_usd'].some(key => !Object.prototype.hasOwnProperty.call(row,key))) throw new Error('平台额度数据不完整，请重新读取。')
    if (seen.has(row.platform)) throw new Error('每个平台只能配置一条额度。')
    seen.add(row.platform)
    for (const n of [row.daily_limit_usd, row.weekly_limit_usd, row.monthly_limit_usd])
      if (n != null && (!Number.isFinite(n) || n < 0)) throw new Error('平台额度须为非负数字，留空表示不限。')
    return { platform: row.platform, daily_limit_usd: row.daily_limit_usd, weekly_limit_usd: row.weekly_limit_usd, monthly_limit_usd: row.monthly_limit_usd }
  })
}
export function validateAttributes(definitions: AttributeDefinition[], values: Record<number,string>): void {
  for (const d of definitions) {
    const value = values[d.id] ?? '', v = d.validation
    if (d.required && (!value.trim() || (d.type === 'multi_select' && value === '[]'))) throw new Error(`${d.name} 为必填项。`)
    if (!value) continue
    if(d.type==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new Error(`${d.name} 邮箱格式不正确。`)
    if(d.type==='url'){try{new URL(value)}catch{throw new Error(`${d.name} 请填写完整的网址。`)}}
    if(d.type==='multi_select'){
      let selected:unknown
      try{selected=JSON.parse(value)}catch{throw new Error(`${d.name} 多选值格式无效。`)}
      if(!Array.isArray(selected) || selected.some(v=>typeof v!=='string') || d.required && !selected.length)throw new Error(`${d.name} 请选择有效选项。`)
    }
    if (v?.min_length != null && value.length < v.min_length || v?.max_length != null && value.length > v.max_length) throw new Error(`${d.name} 长度不符合要求。`)
    if (d.type === 'number' && (!Number.isFinite(Number(value)) || v?.min != null && Number(value) < v.min || v?.max != null && Number(value) > v.max)) throw new Error(`${d.name} 数值超出范围。`)
    if (v?.pattern && !new RegExp(v.pattern).test(value)) throw new Error(v.message || `${d.name} 格式不符合要求。`)
  }
}
