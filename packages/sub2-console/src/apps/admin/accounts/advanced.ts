import type { Account, UpdateAccountRequest } from '@/types'
export interface AdvancedForm {
  notes: string; proxy_id: number | null; load_factor: number | ''; rate_multiplier: number;
  expires: string; auto_pause_on_expired: boolean; schedulable: boolean
}
export function advancedForm(account?: Account): AdvancedForm {
  const date = account?.expires_at ? new Date(account.expires_at * 1000) : null
  const expires = date && Number.isFinite(date.getTime())
    ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''
  return { notes: account?.notes ?? '', proxy_id: account?.proxy_id ?? null,
    load_factor: account?.load_factor ?? '', rate_multiplier: account?.rate_multiplier ?? 1,
    expires, auto_pause_on_expired: account?.auto_pause_on_expired ?? true, schedulable: account?.schedulable ?? true }
}
export function advancedPatch(form: AdvancedForm, initial: AdvancedForm, editing: boolean): UpdateAccountRequest {
  const patch: UpdateAccountRequest = {}
  const changed = (key: keyof AdvancedForm) => editing ? form[key] !== initial[key] : key !== 'schedulable'
  if (changed('notes')) patch.notes = form.notes.trim() || null
  if (changed('proxy_id')) {
    if (form.proxy_id !== null && (!Number.isInteger(form.proxy_id) || form.proxy_id < 1)) throw new Error('请选择有效代理。')
    patch.proxy_id = form.proxy_id
  }
  if (changed('load_factor')) {
    if (form.load_factor !== '' && (!Number.isInteger(form.load_factor) || form.load_factor < 1)) throw new Error('调度负载须为正整数，留空使用默认值。')
    patch.load_factor = form.load_factor === '' ? (editing ? 0 : null) : form.load_factor
  }
  if (changed('rate_multiplier')) {
    if (!Number.isFinite(form.rate_multiplier) || form.rate_multiplier < 0) throw new Error('计费倍率须为非负数。')
    patch.rate_multiplier = form.rate_multiplier
  }
  if (changed('expires')) {
    const time = form.expires ? Date.parse(form.expires) : null
    if (time !== null && !Number.isFinite(time)) throw new Error('到期时间无效。')
    patch.expires_at = time === null ? (editing ? 0 : null) : Math.floor(time / 1000)
  }
  if (changed('auto_pause_on_expired')) patch.auto_pause_on_expired = form.auto_pause_on_expired
  if (editing && changed('schedulable')) patch.schedulable = form.schedulable
  return patch
}
