<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { MacButton, MacSheet } from '@sub2-mac/core'
import { accountsAPI } from '@/api/admin/accounts'
import { createAccountImport, type ImportState } from './importData'
import PlatformMark from './PlatformMark.vue'
const props = defineProps<{ show: boolean; files: File[]; directory?: boolean }>()
const emit = defineEmits<{ close: []; changed: []; consumed: []; busy: [value: boolean] }>()
const state = ref<ImportState>({ phase: 'idle', message: '', summary: null, result: null })
const skipDefault = ref(true)
const labels: Record<string, string> = { anthropic:'Anthropic', openai:'OpenAI', gemini:'Gemini', antigravity:'Antigravity', deepseek:'DeepSeek', grok:'Grok · xAI', kimi:'Kimi', zhipu:'智谱 GLM', other:'其他平台' }
const typeNames: Record<string, string> = { apikey:'API 密钥', oauth:'OAuth 授权', 'setup-token':'Setup Token', bedrock:'AWS Bedrock', service_account:'服务账号', upstream:'上游转发', other:'其他类别' }
const importer = createAccountImport(payload => accountsAPI.importData(payload), next => {
  state.value = next; emit('busy', next.phase === 'submitting')
  if (['complete','partial','failed','unknown'].includes(next.phase)) emit('changed')
})
function close() { if (importer.cancel()) emit('close') }
async function select(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || []); input.value = ''
  if (files.length) await importer.select(files)
}
watch(() => props.files, async files => { if (props.show && (files.length || props.directory)) { await importer.select(files, props.directory); if (props.files === files) emit('consumed') } }, { immediate: true })
watch(() => props.show, show => { if (!show) importer.cancel() })
onUnmounted(() => { importer.dispose(); emit('busy', false) })
</script>
<template>
  <MacSheet :show="show" :dirty="state.phase === 'ready'" title="导入账号" :loading="state.phase === 'submitting'" @close="close">
    <div class="account-import">
      <nav class="import-progress" aria-label="文件导入进度"><span :aria-current="['idle','reading','invalid'].includes(state.phase) ? 'step' : undefined">1 选择文件</span><span :aria-current="state.phase === 'ready' ? 'step' : undefined">2 校验预览</span><span :aria-current="['submitting','complete','partial','failed','unknown'].includes(state.phase) ? 'step' : undefined">3 导入结果</span></nav>
      <p>选择官方导出的 JSON，或将文件拖入账号窗口。最多 10 个文件，每个不超过 20 MB，合计不超过 50 MB。</p>
      <label v-if="['idle','reading','invalid','ready'].includes(state.phase)" class="import-picker">{{ state.phase === 'ready' ? '重新选择文件' : '选择 JSON 文件' }}<input type="file" accept=".json,application/json" multiple :disabled="state.phase === 'submitting'" @change="select" /></label>
      <p v-if="state.message" :role="['invalid','unknown','partial','failed'].includes(state.phase) ? 'alert' : 'status'" :data-phase="state.phase">{{ state.message }}</p>
      <template v-if="state.summary">
        <div class="import-totals"><div><strong>{{ state.summary.accounts }}</strong><span>个账号</span></div><div><strong>{{ state.summary.proxies }}</strong><span>个代理</span></div><div><strong>{{ state.summary.files }}</strong><span>个文件</span></div></div>
        <div class="import-breakdown"><div v-for="(count, platform) in state.summary.platforms" :key="platform"><PlatformMark :platform="String(platform)" /><span>{{ labels[platform] || '其他平台' }}</span><strong>{{ count }}</strong></div></div>
        <p class="import-types"><span v-for="(count, kind) in state.summary.types" :key="kind">{{ typeNames[kind] || '其他类别' }} {{ count }}</span></p>
        <p>预览不显示账号密钥、代理密码或原始 JSON。确认后将创建账号及相关代理。</p>
      </template>
      <label v-if="state.phase === 'ready'" class="import-option"><input v-model="skipDefault" type="checkbox" />跳过默认分组绑定<span>导入后自行安排账号分组</span></label>
      <dl v-if="state.result" class="import-result"><dt>账号新增</dt><dd>{{ state.result.account_created }}</dd><dt>账号失败</dt><dd>{{ state.result.account_failed }}</dd><dt>代理新增 / 复用</dt><dd>{{ state.result.proxy_created }} / {{ state.result.proxy_reused }}</dd><dt>代理失败</dt><dd>{{ state.result.proxy_failed }}</dd></dl>
      <p v-if="['partial','failed'].includes(state.phase)">错误明细可能包含凭据，因此不在此展示。请核对已有账号，仅为未完成项准备新的导入文件。</p>
    </div>
    <template #footer="{ close: guardedClose }"><MacButton :disabled="state.phase === 'submitting'" @click="guardedClose">{{ ['complete','partial','failed','unknown'].includes(state.phase) ? '关闭' : '取消' }}</MacButton><MacButton variant="primary" :disabled="state.phase !== 'ready'" :loading="state.phase === 'submitting'" @click="importer.confirm(skipDefault)">确认导入</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.account-import{display:grid;gap:16px;font-size:12px;line-height:1.65;min-width:0}.account-import p{color:var(--text-secondary);overflow-wrap:anywhere}.import-picker{display:grid;gap:8px;font-weight:600}.import-picker input{max-width:100%;min-width:0;font-weight:400}.import-picker input::file-selector-button{padding:7px 12px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-surface);color:var(--text-primary);margin-right:10px}.import-totals{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--border-subtle);border-radius:10px;padding:14px}.import-totals>div{display:grid;gap:2px;text-align:center}.import-totals strong{font-size:24px;font-weight:600;font-variant-numeric:tabular-nums}.import-totals span{color:var(--text-secondary)}.import-breakdown{display:grid;gap:8px}.import-breakdown>div{display:flex;align-items:center;gap:10px}.import-breakdown strong{margin-left:auto}.import-types{display:flex;flex-wrap:wrap;gap:6px 14px}.import-option{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.import-option span{width:100%;padding-left:23px;color:var(--text-tertiary)}.import-result{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px;background:var(--bg-surface-subtle);border-radius:9px}.account-import [role=alert]{color:var(--color-danger);padding:10px;border:1px solid var(--border-color);border-radius:8px}.account-import [data-phase=partial]{color:var(--text-primary)}
</style>
<style scoped>.import-progress{display:flex;justify-content:space-between;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--text-tertiary)}.import-progress [aria-current=step]{color:var(--accent);font-weight:600}</style>
