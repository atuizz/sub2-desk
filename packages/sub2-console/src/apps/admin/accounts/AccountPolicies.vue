<script setup lang="ts">
import PlatformControls from './PlatformControls.vue'
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { MacButton } from '@sub2-mac/core'
import { accountsAPI } from '@/api/admin/accounts'
import { settingsAPI } from '@/api/admin/settings'
import { mappingAvailable, quotaAvailable, rpmAvailable, quotaDimensions, type Policies } from './policies'
import { operationError } from './oauth'
const form = defineModel<Policies>({ required: true })
const props = defineProps<{ platform: string; type: string; disabled: boolean; passthrough?: boolean }>()
const mode = ref('whitelist')
const defaultBusy = ref(false), error = ref(''), notifyEnabled = ref(false), notifyError = ref('')
const canMap = computed(() => mappingAvailable(props.platform, props.type))
const canQuota = computed(() => quotaAvailable(props.type))
const canRpm = computed(() => rpmAvailable(props.platform, props.type))
let disposed = false
onBeforeUnmount(() => { disposed = true })
async function loadNotify() {
  notifyError.value = ''
  try { const s = await settingsAPI.getSettings(); if (!disposed) notifyEnabled.value = s.account_quota_notify_enabled === true }
  catch { if (!disposed) notifyError.value = '配额预警开关读取失败，已有预警配置保留。' }
}
async function defaults() {
  if (defaultBusy.value || props.disabled) return
  defaultBusy.value = true; error.value = ''
  try {
    const mapping = await accountsAPI.getAntigravityDefaultModelMapping()
    if (disposed || props.platform !== 'antigravity') return
    // Append only; do not replace a mapping the operator has already configured.
    const existing = new Set(form.value.mappings.map(r => r.from))
    for (const [from, to] of Object.entries(mapping)) if (!existing.has(from)) form.value.mappings.push({ from, to })
  } catch (e) { if (!disposed) error.value = operationError(e, '默认映射读取失败。') }
  finally { if (!disposed) defaultBusy.value = false }
}
onMounted(loadNotify)
</script>
<template>
  <div class="policies">
    <PlatformControls v-model="form.platformControls" :platform="platform" :type="type" :disabled="disabled" />
    <details v-if="canMap || platform === 'openai'">
      <summary>模型限制与映射</summary>
      <p v-if="passthrough">此 OpenAI 账号已启用透传，普通模型映射保持原值。</p>
      <fieldset v-if="canMap" :disabled="disabled || passthrough">
        <label v-if="platform !== 'antigravity'">编辑内容<select v-model="mode"><option value="whitelist">白名单</option><option value="mapping">模型映射</option></select></label>
        <p>白名单和映射可同时生效；切换视图保留已填写内容。全部清空表示不限制模型。</p>
        <label v-if="platform !== 'antigravity' && mode === 'whitelist'">允许模型（每行一个确切名称）<textarea v-model="form.allowed" rows="4" spellcheck="false" /></label>
        <template v-if="platform === 'antigravity' || mode === 'mapping'">
          <p>来源支持末尾一个 *，目标填写确切模型名。</p>
          <div v-for="(row, i) in form.mappings" :key="i" class="mapping-row">
            <label>来源<input v-model="row.from" spellcheck="false" /></label><label>目标<input v-model="row.to" spellcheck="false" /></label>
            <MacButton size="sm" :aria-label="`删除映射 ${i + 1}`" @click="form.mappings.splice(i, 1)">删除</MacButton>
          </div>
          <div class="actions"><MacButton size="sm" @click="form.mappings.push({ from: '', to: '' })">添加映射</MacButton><MacButton v-if="platform === 'antigravity'" size="sm" :loading="defaultBusy" @click="defaults">补入官方默认映射</MacButton></div>
          <p v-if="error" role="alert">{{ error }}</p>
        </template>
      </fieldset>
      <fieldset v-if="platform === 'openai'" :disabled="disabled">
        <legend>Compact 模型映射</legend>
        <div v-for="(row, i) in form.compact" :key="i" class="mapping-row"><label>来源<input v-model="row.from" /></label><label>目标<input v-model="row.to" /></label><MacButton size="sm" @click="form.compact.splice(i, 1)">删除</MacButton></div>
        <MacButton size="sm" @click="form.compact.push({ from: '', to: '' })">添加 Compact 映射</MacButton>
      </fieldset>
    </details>
    <details v-if="canQuota">
      <summary>账号池与配额</summary>
      <fieldset :disabled="disabled">
        <label class="check"><input v-model="form.pool" type="checkbox" />账号池模式</label>
        <template v-if="form.pool"><label>失败重试次数<input v-model.number="form.retries" type="number" min="0" max="10" step="1" /></label><label>重试状态码（空值使用 401、403、429）<input v-model="form.retryCodes" placeholder="401, 403, 429" /></label></template>
        <p>配额单位为美元；留空或 0 表示不限额。关闭日/周额度会按官方契约清除相应计数窗口。</p>
        <label>总配额<input v-model.number="form.quota_limit" type="number" min="0" step="0.01" /></label>
        <label>日配额<input v-model.number="form.quota_daily_limit" type="number" min="0" step="0.01" /></label>
        <label>日重置模式<select v-model="form.quota_daily_reset_mode"><option value="rolling">滚动24小时</option><option value="fixed">固定时间</option></select></label>
        <label v-if="form.quota_daily_reset_mode === 'fixed'">日重置小时<input v-model.number="form.quota_daily_reset_hour" type="number" min="0" max="23" step="1" /></label>
        <label>周配额<input v-model.number="form.quota_weekly_limit" type="number" min="0" step="0.01" /></label>
        <label>周重置模式<select v-model="form.quota_weekly_reset_mode"><option value="rolling">滚动7天</option><option value="fixed">固定时间</option></select></label>
        <template v-if="form.quota_weekly_reset_mode === 'fixed'"><label>周重置星期<select v-model.number="form.quota_weekly_reset_day"><option :value="0">星期日</option><option :value="1">星期一</option><option :value="2">星期二</option><option :value="3">星期三</option><option :value="4">星期四</option><option :value="5">星期五</option><option :value="6">星期六</option></select></label><label>周重置小时<input v-model.number="form.quota_weekly_reset_hour" type="number" min="0" max="23" step="1" /></label></template>
        <label v-if="form.quota_daily_reset_mode === 'fixed' || form.quota_weekly_reset_mode === 'fixed'">重置时区<input v-model="form.quota_reset_timezone" placeholder="Asia/Shanghai" /></label>
        <template v-if="notifyEnabled">
          <div v-for="dim in quotaDimensions" :key="dim.key" class="notify-row">
            <label class="check"><input v-model="form.notify[dim.key]!.enabled" type="checkbox" />{{ dim.label }}预警</label>
            <template v-if="form.notify[dim.key]!.enabled"><label>预警阈值<input v-model.number="form.notify[dim.key]!.threshold" type="number" min="0" :max="form.notify[dim.key]!.type === 'percentage' ? 100 : undefined" step="0.01" /></label><label>阈值单位<select v-model="form.notify[dim.key]!.type"><option value="fixed">美元</option><option value="percentage">百分比</option></select></label></template>
          </div>
        </template>
        <p v-if="notifyError" role="alert">{{ notifyError }} <button type="button" @click="loadNotify">重试</button></p>
      </fieldset>
    </details>
    <details v-if="canRpm">
      <summary>窗口费用、会话与 RPM</summary>
      <fieldset :disabled="disabled">
        <label class="check"><input v-model="form.windowEnabled" type="checkbox" />限制5小时窗口费用</label>
        <template v-if="form.windowEnabled"><label>窗口费用上限（美元）<input v-model.number="form.window_cost_limit" type="number" min="0.01" step="0.01" /></label><label>粘性会话预留（美元）<input v-model.number="form.window_cost_sticky_reserve" type="number" min="0" step="0.01" /></label></template>
        <label class="check"><input v-model="form.sessionsEnabled" type="checkbox" />限制活跃会话数</label>
        <template v-if="form.sessionsEnabled"><label>最大会话数<input v-model.number="form.max_sessions" type="number" min="1" step="1" /></label><label>会话空闲超时（分钟）<input v-model.number="form.session_idle_timeout_minutes" type="number" min="1" step="1" /></label></template>
        <label class="check"><input v-model="form.rpmEnabled" type="checkbox" />限制每分钟请求数</label>
        <template v-if="form.rpmEnabled"><label>基础 RPM（留空为15）<input v-model.number="form.base_rpm" type="number" min="1" max="1000" step="1" /></label><label>RPM 策略<select v-model="form.rpm_strategy"><option value="tiered">分层限速</option><option value="sticky_exempt">粘性会话豁免</option></select></label><label v-if="form.rpm_strategy === 'tiered'">粘性缓冲（留空使用默认）<input v-model.number="form.rpm_sticky_buffer" type="number" min="1" step="1" /></label></template>
        <label>用户消息限速（独立于 RPM）<select v-model="form.user_msg_queue_mode"><option value="">关闭</option><option value="throttle">节流</option><option value="serialize">串行</option></select></label>
      </fieldset>
    </details>
  </div>
</template>
<style scoped>
.policies{display:grid;gap:10px;min-width:0}summary{padding:10px 0;font-weight:600;cursor:pointer}fieldset{border:0;display:grid;gap:12px;min-width:0;padding:8px 0}label{display:grid;gap:6px}.check{display:flex;align-items:center;gap:8px}input:not([type=checkbox]),select,textarea{width:100%;min-width:0;box-sizing:border-box;padding:7px 8px;border:1px solid var(--border-color);border-radius:7px;background:var(--input-bg,transparent);color:inherit}.mapping-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:6px;align-items:end}.actions{display:flex;gap:8px;flex-wrap:wrap}p{line-height:1.6;color:var(--text-secondary);margin:0}.notify-row{display:grid;gap:8px;border-top:1px solid var(--border-color);padding-top:10px}textarea{resize:vertical}input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid #007aff;outline-offset:2px}@media(max-width:440px){.mapping-row{grid-template-columns:minmax(0,1fr)}.mapping-row button{justify-self:end}}
</style>
