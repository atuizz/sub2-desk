<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core'
import { scheduledTestsAPI } from '@/api/admin/scheduledTests'
import { accountsAPI } from '@/api/admin/accounts'
import { operationError } from './oauth'
import type { Account, ScheduledTestPlan, ScheduledTestResult } from '@/types'
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ close: [] }>()
const plans = ref<ScheduledTestPlan[]>([])
const models = ref<{ id: string; display_name?: string }[]>([])
const ready = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const modelError = ref('')
const editing = ref<number | null | undefined>(undefined)
const defaults = () => ({ model_id: '', cron_expression: '*/30 * * * *', enabled: true, max_results: 100, auto_recover: false })
const form = ref(defaults())
const pendingDelete = ref<ScheduledTestPlan | null>(null)
const resultPlan = ref<number | null>(null)
const results = ref<ScheduledTestResult[]>([])
const resultsBusy = ref(false)
const resultsError = ref('')
let disposed = false
let resultVersion = 0
onBeforeUnmount(() => { disposed = true; resultVersion++ })
function message(e: unknown) {
  const status = (e as { response?: { status?: number }; status?: number })?.response?.status ?? (e as { status?: number })?.status
  if (status === 404 || status === 405 || status === 501) return '当前后端未提供计划测试接口，暂时无法使用。'
  return operationError(e, '请求失败，请重试。')
}
async function readPlans() {
  ready.value = false
  const data = await scheduledTestsAPI.listByAccount(props.account.id)
  if (!disposed) { plans.value = data; ready.value = true }
}
async function load() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await readPlans() }
  catch (e) { if (!disposed) error.value = message(e) }
  finally { if (!disposed) busy.value = false }
}
async function loadModels() {
  modelError.value = ''
  try { const data = await accountsAPI.getAvailableModels(props.account.id); if (!disposed) models.value = data }
  catch { if (!disposed) modelError.value = '模型列表加载失败，可重试或手动填写模型 ID。' }
}
function edit(plan?: ScheduledTestPlan) {
  if (busy.value || !ready.value) return
  editing.value = plan?.id ?? null
  form.value = plan ? { model_id: plan.model_id, cron_expression: plan.cron_expression, enabled: plan.enabled,
    max_results: plan.max_results, auto_recover: plan.auto_recover } : defaults()
  error.value = ''; notice.value = ''
}
async function mutate(action: () => Promise<unknown>, success: string) {
  if (busy.value || !ready.value) return
  busy.value = true; error.value = ''; notice.value = ''
  let written = false
  try {
    await action(); written = true
    if (disposed) return
    editing.value = undefined; pendingDelete.value = null; notice.value = success
    await readPlans()
  } catch (e) {
    if (!disposed) {
      if (written) { ready.value = false; error.value = '操作已成功，但列表刷新失败，请重新读取。' }
      else error.value = message(e)
    }
  } finally { if (!disposed) busy.value = false }
}
async function save() {
  if (busy.value || !ready.value || editing.value === undefined) return
  const payload = { ...form.value, model_id: form.value.model_id.trim(), cron_expression: form.value.cron_expression.trim() }
  if (!payload.model_id || payload.cron_expression.split(/\s+/).length !== 5 || !Number.isInteger(payload.max_results) || payload.max_results < 1) {
    error.value = '请填写模型、五字段 cron 和正整数保留条数。'; return
  }
  const id = editing.value
  await mutate(() => id === null ? scheduledTestsAPI.create({ account_id: props.account.id, ...payload }) : scheduledTestsAPI.update(id, payload), '计划已保存。')
}
async function history(id: number) {
  const version = ++resultVersion
  resultPlan.value = id; results.value = []; resultsBusy.value = true; resultsError.value = ''
  try {
    const data = await scheduledTestsAPI.listResults(id, 20)
    if (!disposed && version === resultVersion) results.value = data
  } catch (e) { if (!disposed && version === resultVersion) resultsError.value = message(e) }
  finally { if (!disposed && version === resultVersion) resultsBusy.value = false }
}
async function remove() {
  const plan = pendingDelete.value
  if (!plan) return
  await mutate(() => scheduledTestsAPI.delete(plan.id), '计划已删除。')
  if (!pendingDelete.value && resultPlan.value === plan.id) { resultVersion++; resultPlan.value = null; results.value = [] }
}
onMounted(() => { void load(); void loadModels() })
</script>
<template>
  <MacSheet :show="true" :title="`计划测试 · ${account.name}`" :loading="busy" @close="emit('close')">
    <div class="plans">
      <p>按服务器时间定期发送模型测试请求，可能产生用量。自动恢复会在测试成功后恢复账号调度。</p>
      <p v-if="busy" role="status">正在处理…</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <MacButton v-if="!ready && !busy" @click="load">重新读取</MacButton>
      <MacButton :disabled="!ready || busy" @click="edit()">添加计划</MacButton>
      <form v-if="editing !== undefined" @submit.prevent="save">
        <fieldset :disabled="busy || !ready">
          <legend>{{ editing === null ? '添加计划' : '编辑计划' }}</legend>
          <label>测试模型<input v-model="form.model_id" :list="`account-models-${account.id}`" required autocomplete="off" /></label>
          <datalist :id="`account-models-${account.id}`"><option v-for="m in models" :key="m.id" :value="m.id">{{ m.display_name || m.id }}</option></datalist>
          <p v-if="modelError">{{ modelError }} <button type="button" @click="loadModels">重试</button></p>
          <label>测试周期<select :value="form.cron_expression" @change="form.cron_expression = ($event.target as HTMLSelectElement).value"><option value="*/30 * * * *">每30分钟</option><option value="0 * * * *">每小时</option><option value="0 8 * * *">每天08:00</option><option :value="form.cron_expression">自定义</option></select></label>
          <label>Cron（分 时 日 月 周）<input v-model="form.cron_expression" required spellcheck="false" /></label>
          <label>保留结果条数<input v-model.number="form.max_results" type="number" min="1" step="1" required /></label>
          <label class="check"><input v-model="form.enabled" type="checkbox" />启用计划</label>
          <label class="check"><input v-model="form.auto_recover" type="checkbox" />测试成功后自动恢复</label>
          <div class="actions"><MacButton @click="editing = undefined">取消编辑</MacButton><MacButton variant="primary" type="submit" :loading="busy">保存计划</MacButton></div>
        </fieldset>
      </form>
      <p v-if="ready && !plans.length">尚无计划测试。</p>
      <article v-for="plan in plans" :key="plan.id">
        <strong>{{ plan.model_id }}</strong><p>{{ plan.cron_expression }} · {{ plan.enabled ? '已启用' : '已暂停' }} · 保留 {{ plan.max_results }} 条</p>
        <p>上次：{{ plan.last_run_at || '尚未执行' }}<br />下次：{{ plan.next_run_at || '未安排' }}</p>
        <div class="actions">
          <MacButton size="sm" :disabled="busy || !ready" @click="edit(plan)">编辑</MacButton>
          <MacButton size="sm" :disabled="busy || !ready" @click="mutate(() => scheduledTestsAPI.update(plan.id, { enabled: !plan.enabled }), plan.enabled ? '计划已暂停。' : '计划已启用。')">{{ plan.enabled ? '暂停' : '启用' }}</MacButton>
          <MacButton size="sm" :disabled="busy" @click="history(plan.id)">最近结果</MacButton>
          <MacButton size="sm" :disabled="busy || !ready" @click="pendingDelete = plan">删除</MacButton>
        </div>
        <section v-if="resultPlan === plan.id" aria-label="测试结果">
          <p v-if="resultsBusy" role="status">正在读取结果…</p>
          <p v-else-if="resultsError" role="alert">{{ resultsError }} <button type="button" @click="history(plan.id)">重试</button></p>
          <p v-else-if="!results.length">暂无执行结果。</p>
          <details v-for="r in results" :key="r.id"><summary>{{ r.started_at }} · {{ r.status }} · {{ r.latency_ms }} ms</summary><pre>{{ r.error_message || r.response_text || '无响应正文' }}</pre></details>
        </section>
      </article>
    </div>
    <template #footer><MacButton :disabled="busy" @click="emit('close')">完成</MacButton></template>
  </MacSheet>
  <MacAlertSheet :show="!!pendingDelete" title="删除计划测试？" :message="`将停止 ${pendingDelete?.model_id || ''} 的定期测试。`" confirm-text="删除计划" danger :loading="busy" @confirm="remove" @cancel="!busy && (pendingDelete = null)" />
</template>
<style scoped>
.plans{display:grid;gap:14px;min-width:0}.plans p{margin:0;line-height:1.6;color:var(--text-secondary)}fieldset{display:grid;gap:12px;border:1px solid var(--border-color);border-radius:10px;padding:14px;min-width:0}label{display:grid;gap:6px}input:not([type=checkbox]),select{width:100%;box-sizing:border-box;min-width:0;padding:7px 9px;border:1px solid var(--border-color);border-radius:7px;background:var(--input-bg,transparent);color:inherit}.check{display:flex;align-items:center;gap:8px}.actions{display:flex;flex-wrap:wrap;gap:6px}article{display:grid;gap:8px;border-top:1px solid var(--border-color);padding-top:14px;min-width:0}.plans .error{color:#d14343}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px}summary{cursor:pointer;padding:8px 0}input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #007aff;outline-offset:2px}
</style>
