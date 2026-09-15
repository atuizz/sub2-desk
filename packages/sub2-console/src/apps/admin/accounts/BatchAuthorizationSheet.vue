<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { MacSheet, MacButton } from '@sub2-mac/core'
import { batchMethods, createBatchAuthorization, type BatchMethod, type BatchSettings, type BatchRow } from './batchAuthorization'
const props = defineProps<{ settings: BatchSettings }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const methods = batchMethods(props.settings.platform)
const method = ref<BatchMethod>(methods[0]!)
const labels: Record<BatchMethod, string> = { refresh_token: 'OpenAI Refresh Token', mobile_refresh_token: 'OpenAI Mobile RT', codex_session: 'Codex Session / auth.json', agent_identity: 'Agent Identity', codex_pat: 'Codex Personal Access Token', cookie: 'Anthropic Cookie' }
const content = ref(''), error = ref(''), busy = ref(false), updateExisting = ref(true)
const rows = ref<BatchRow[]>([])
let batch: ReturnType<typeof createBatchAuthorization> | null = null
let disposed = false
const jsonMode = computed(() => ['codex_session', 'agent_identity'].includes(method.value))
const canRetry = computed(() => rows.value.some(r => ['exchange_failed', 'save_failed'].includes(r.status)))
const totals = computed(() => ({ created: rows.value.filter(r => r.status === 'created').length, updated: rows.value.filter(r => r.status === 'updated').length, skipped: rows.value.filter(r => r.status === 'skipped').length, failed: rows.value.filter(r => ['exchange_failed', 'save_failed'].includes(r.status)).length, unknown: rows.value.filter(r => r.status === 'unknown').length }))
watch(method, () => { content.value = ''; error.value = '' })
onBeforeUnmount(() => { disposed = true; batch?.dispose(); content.value = '' })
async function submit() {
  if (busy.value || disposed || (batch && !canRetry.value)) return
  error.value = ''
  try {
    if (!batch) {
      batch = createBatchAuthorization(method.value, content.value, { ...props.settings, update_existing: updateExisting.value })
      content.value = ''; rows.value = batch.snapshot()
    }
    busy.value = true
    await batch.run(value => { rows.value = value })
    if (!disposed && rows.value.some(r => ['created', 'updated', 'unknown'].includes(r.status))) emit('saved')
  } catch { if (!disposed) error.value = '输入格式或授权类型不正确，请检查 JSON/每行一条记录及 Agent Identity 格式。' }
  finally { if (!disposed) busy.value = false }
}
</script>
<template>
  <MacSheet :show="true" :title="`批量授权 · ${settings.name}`" :loading="busy" :dirty="!!content.trim() || canRetry" @close="emit('close')">
    <div class="batch-auth">
      <p>使用已填写的账号名称、代理、分组和高级设置；多条记录按序号命名。此操作会创建账号。</p>
      <label>导入方式<select v-model="method" :disabled="busy || rows.length > 0"><option v-for="m in methods" :key="m" :value="m">{{ labels[m] }}</option></select></label>
      <template v-if="!rows.length">
        <label>{{ jsonMode ? 'JSON 对象、数组或每行一个 JSON 对象' : '每行一条授权信息' }}<textarea v-model="content" rows="7" spellcheck="false" autocomplete="off" autocapitalize="off" :disabled="busy" /></label>
        <label v-if="jsonMode" class="check"><input v-model="updateExisting" type="checkbox" :disabled="busy" />匹配已有账号时更新（关闭则由服务器跳过）</label>
        <p v-if="method === 'mobile_refresh_token'">使用官方 Mobile RT 客户端标识兑换。</p>
        <p v-if="method === 'cookie'">Cookie 仅用于兑换 OAuth/Setup Token，不保存到账号凭据。</p>
      </template>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="rows.length">
        <p role="status">创建 {{ totals.created }} · 更新 {{ totals.updated }} · 跳过 {{ totals.skipped }} · 失败 {{ totals.failed }} · 结果未知 {{ totals.unknown }}</p>
        <ol><li v-for="row in rows" :key="row.index">#{{ row.index }} {{ row.message }}<span v-if="row.accountId"> · 账号 #{{ row.accountId }}</span></li></ol>
        <p v-if="totals.unknown">结果未知项不会重试，请先核对账号列表，避免重复创建。</p>
        <p v-if="canRetry">仅重试明确失败项；已兑换的凭据直接重试保存，成功项不会再次提交。关闭窗口会清除待重试信息。</p>
      </template>
    </div>
    <template #footer="{close}"><MacButton :disabled="busy" @click="close">关闭</MacButton><MacButton variant="primary" :loading="busy" :disabled="rows.length > 0 ? !canRetry : !content.trim()" @click="submit">{{ rows.length ? '仅重试失败项' : '授权并创建' }}</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.batch-auth{display:grid;gap:14px;min-width:0}.batch-auth label{display:grid;gap:6px}.batch-auth .check{display:flex;gap:8px;align-items:center}.batch-auth textarea,.batch-auth select{width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--input-bg,transparent);color:inherit}.batch-auth textarea{resize:vertical}.batch-auth p{margin:0;line-height:1.6;color:var(--text-secondary)}ol{padding-left:0;list-style:none;display:grid;gap:8px}li{overflow-wrap:anywhere}textarea:focus-visible,select:focus-visible{outline:2px solid #007aff;outline-offset:2px}
</style>
