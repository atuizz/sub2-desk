<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { MacAlertSheet } from '@sub2-mac/core'
import * as api from '../../../api/admin/users'
import type { AttributeDefinition } from '../../../types/admin-policies'
import { copy, changedFields, quotaPayload, validateAttributes } from './policy-contract'
import PolicyNumber from './PolicyNumber.vue'
const props = defineProps<{ userId: number; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const usage=ref<api.PlatformQuotaItem[]>([])
const pendingReset=ref<{platform:api.PlatformQuotaPlatform;window:api.PlatformQuotaWindow}|null>(null)
const quotaWindows:api.PlatformQuotaWindow[]=['daily','weekly','monthly']
const windowNames={daily:'日',weekly:'周',monthly:'月'}
const quotas = ref<api.PlatformQuotaUpdateItem[]>([]), quotaBase = ref<api.PlatformQuotaUpdateItem[]>([])
const definitions = ref<AttributeDefinition[]>([]), values = ref<Record<number,string>>({}), attrBase = ref<Record<number,string>>({})
const quotaReady = ref(false), attrReady = ref(false), quotaLoading = ref(false), attrLoading = ref(false)
const quotaError = ref(''), attrError = ref(''), quotaNotice = ref(''), attrNotice = ref(''), busy = ref(false)
const platforms: api.PlatformQuotaPlatform[] = ['anthropic','openai','gemini','antigravity','grok']
const windows = [['daily_limit_usd','每日额度（美元）'],['weekly_limit_usd','每周额度（美元）'],['monthly_limit_usd','每月额度（美元）']] as const
let alive = true
onUnmounted(() => { alive = false })
const quotaDirty = computed(() => JSON.stringify(quotas.value) !== JSON.stringify(quotaBase.value))
const attrDirty = computed(() => Object.keys(changedFields(attrBase.value, values.value)).length > 0)
function errorText(error: unknown) { return error instanceof Error ? error.message : '请求失败，请重试。' }
async function loadQuotas() {
  if (quotaLoading.value || busy.value) return
  quotaLoading.value = true; quotaReady.value = false; quotaError.value = ''
  try {
    const result = await api.getPlatformQuotas(props.userId)
    if (!alive) return
    if (!Array.isArray(result.platform_quotas)) throw new Error('平台额度响应不完整。')
    const data = quotaPayload(result.platform_quotas)
    usage.value=copy(result.platform_quotas)
    quotas.value = data; quotaBase.value = copy(data); quotaReady.value = true
  } catch (e) { if (alive) quotaError.value = `平台额度无法读取，暂不可保存。${errorText(e)}` }
  finally { if (alive) quotaLoading.value = false }
}
async function loadAttributes() {
  if (attrLoading.value || busy.value) return
  attrLoading.value = true; attrReady.value = false; attrError.value = ''
  try {
    const [defs, attrs] = await Promise.all([api.listAttributeDefinitions(), api.getAttributeValues(props.userId)])
    if (!alive) return
    if (!Array.isArray(defs) || !Array.isArray(attrs)) throw new Error('用户属性响应不完整。')
    definitions.value = defs.filter(d => d.enabled).sort((a,b) => a.display_order-b.display_order)
    values.value = Object.fromEntries(attrs.map(v => [v.attribute_id, v.value]))
    attrBase.value = copy(values.value); attrReady.value = true
  } catch (e) { if (alive) attrError.value = `用户属性无法读取，暂不可保存。${errorText(e)}` }
  finally { if (alive) attrLoading.value = false }
}
function lock(value: boolean) { busy.value = value; emit('busy', value) }
async function saveQuotas() {
  if (!quotaReady.value || busy.value || props.disabled || !quotaDirty.value) return
  quotaError.value = ''; quotaNotice.value = ''
  try {
    const payload = quotaPayload(quotas.value)
    lock(true)
    const result=await api.updatePlatformQuotas(props.userId, payload)
    if(alive && Array.isArray(result?.platform_quotas))usage.value=copy(result.platform_quotas)
    if (!alive) return
    quotaBase.value = copy(payload); quotaNotice.value = '平台额度已保存。'
  } catch (e) { if (alive) quotaError.value = errorText(e) }
  finally { lock(false) }
}
async function resetUsage() {
  if(!quotaReady.value || busy.value || props.disabled || !pendingReset.value)return
  const target={...pendingReset.value};lock(true);quotaError.value='';quotaNotice.value=''
  try {
    const result=await api.resetPlatformQuotaWindow(props.userId,target.platform,target.window)
    if(!alive)return
    if(!Array.isArray(result.platform_quotas))throw Error('重置返回的数据不完整，请重新读取用量。')
    usage.value=copy(result.platform_quotas)
    pendingReset.value=null;quotaNotice.value=`${target.platform} 的${windowNames[target.window]}用量已重置；未保存的限额草稿已保留。`
  }catch(e){if(alive)quotaError.value=errorText(e)}finally{lock(false)}
}
function usageFor(platform:string,window:api.PlatformQuotaWindow){const row=usage.value.find(r=>r.platform===platform);return row?.[`${window}_usage_usd`]}
async function saveAttributes() {
  if (!attrReady.value || busy.value || props.disabled || !attrDirty.value) return
  attrError.value = ''; attrNotice.value = ''
  try {
    validateAttributes(definitions.value, values.value)
    const payload = changedFields(attrBase.value, values.value) as Record<number,string>
    lock(true)
    await api.updateAttributeValues(props.userId, payload)
    if (!alive) return
    attrBase.value = copy(values.value); attrNotice.value = '用户属性已保存。'
  } catch (e) { if (alive) attrError.value = errorText(e) }
  finally { lock(false) }
}
function selected(id: number, option: string) { try { const v = JSON.parse(values.value[id] || '[]'); return Array.isArray(v) && v.includes(option) } catch { return false } }
function toggle(id: number, option: string, checked: boolean) {
  let existing: string[] = []
  try { const v = JSON.parse(values.value[id] || '[]'); if (Array.isArray(v)) existing = v } catch { /* recover malformed selection on explicit edit only */ }
  values.value[id] = JSON.stringify(checked ? [...new Set([...existing,option])] : existing.filter(v => v !== option))
}
onMounted(() => { void loadQuotas(); void loadAttributes() })
</script>
<template>
  <div class="user-policies">
    <details><summary>平台额度{{ quotaDirty ? ' · 未保存' : '' }}</summary>
      <p v-if="quotaLoading" role="status">正在读取平台额度…</p>
      <p v-if="quotaError" role="alert">{{ quotaError }}</p><p v-if="quotaNotice" role="status">{{ quotaNotice }}</p>
      <button v-if="!quotaReady" type="button" :disabled="quotaLoading || busy || disabled" @click="loadQuotas">重试读取额度</button>
      <fieldset :disabled="!quotaReady || busy || disabled">
        <p>留空不限，零按原值提交。移除平台后取消该平台额度限制。</p>
        <div v-for="(row,i) in quotas" :key="i" class="tier">
          <label>平台<select v-model="row.platform"><option v-if="!platforms.includes(row.platform)" :value="row.platform">{{ row.platform }}</option><option v-for="p in platforms" :key="p" :value="p">{{ p }}</option></select></label>
          <div class="fields"><PolicyNumber v-for="[key,label] in windows" :key="key" v-model="row[key]" :label="label" /></div>
          <div v-for="window in quotaWindows" :key="window"><span>{{ windowNames[window] }}已用：{{ usageFor(row.platform,window) == null ? '—' : '$' + usageFor(row.platform,window) }}</span><button type="button" :disabled="usageFor(row.platform,window)==null" @click="quotaError='';pendingReset={platform:row.platform,window}">重置{{ windowNames[window] }}用量</button></div>
          <button type="button" @click="quotas.splice(i,1)">移除此平台额度</button>
        </div>
        <button type="button" :disabled="platforms.every(p => quotas.some(q => q.platform === p))" @click="quotas.push({ platform: platforms.find(p => !quotas.some(q => q.platform === p))!, daily_limit_usd: null, weekly_limit_usd: null, monthly_limit_usd: null })">添加平台额度</button>
        <button type="button" :disabled="!quotaDirty" @click="saveQuotas">保存平台额度</button>
      </fieldset>
    </details>
    <details><summary>用户属性{{ attrDirty ? ' · 未保存' : '' }}</summary>
      <p v-if="attrLoading" role="status">正在读取属性定义与值…</p><p v-if="attrError" role="alert">{{ attrError }}</p><p v-if="attrNotice" role="status">{{ attrNotice }}</p>
      <button v-if="!attrReady" type="button" :disabled="attrLoading || busy || disabled" @click="loadAttributes">重试读取属性</button>
      <form @submit.prevent="saveAttributes"><fieldset :disabled="!attrReady || busy || disabled">
        <p v-if="attrReady && !definitions.length">暂无已启用的用户属性。</p>
        <div v-for="d in definitions" :key="d.id" class="attribute">
          <label>{{ d.name }}{{ d.required ? ' *' : '' }}
            <textarea v-if="d.type === 'textarea'" v-model="values[d.id]" :required="d.required" :placeholder="d.placeholder" />
            <select v-else-if="d.type === 'select'" v-model="values[d.id]" :required="d.required"><option value="">未设置</option><option v-for="o in d.options" :key="o.value" :value="o.value">{{ o.label }}</option></select>
            <input v-else-if="d.type !== 'multi_select'" v-model="values[d.id]" :type="d.type" :required="d.required" :placeholder="d.placeholder" :min="d.validation?.min" :max="d.validation?.max" step="any" />
          </label>
          <fieldset v-if="d.type === 'multi_select'"><legend>{{ d.name }}选项</legend><label v-for="o in d.options" :key="o.value"><input type="checkbox" :checked="selected(d.id,o.value)" @change="toggle(d.id,o.value,($event.target as HTMLInputElement).checked)" />{{ o.label }}</label></fieldset>
          <p v-if="d.description">{{ d.description }}</p>
        </div>
        <button type="submit" :disabled="!attrDirty">保存用户属性</button>
      </fieldset></form>
    </details>
    <MacAlertSheet :show="!!pendingReset" title="重置平台已用额度？" :message="`将重置 ${pendingReset?.platform || ''} 的${pendingReset ? windowNames[pendingReset.window] : ''}用量窗口，恢复该周期可用额度；不会保存限额草稿。${quotaError ? ' 重置失败：' + quotaError : ''}`" danger confirm-text="重置用量" :loading="busy" @confirm="resetUsage" @cancel="!busy && (pendingReset=null)" />
  </div>
</template>
<style scoped>
.user-policies { display: grid; gap: 12px; padding: 0 20px 20px; font-size: 12px; min-width: 0; }
details { border-top: 1px solid var(--border-color); padding-top: 12px; } summary { cursor: pointer; font-weight: 600; }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; } fieldset:disabled { opacity: .55; }
.fields { display: grid; grid-template-columns: repeat(auto-fit,minmax(130px,1fr)); gap: 10px; margin: 10px 0; }
.tier, .attribute { margin: 12px 0; padding-top: 10px; border-top: 1px solid var(--border-color); }
label { display: block; color: var(--text-secondary); } p { margin: 8px 0; line-height: 1.6; color: var(--text-secondary); }
input:not([type=checkbox]),select,textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--content-bg); color: var(--text-primary); margin-top: 5px; }
button { color: var(--accent); padding: 8px; } button:disabled { opacity: .5; } [role=alert] { color: var(--status-danger, #d64545); }
</style>
