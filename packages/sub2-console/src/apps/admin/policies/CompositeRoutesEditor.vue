<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { MacAlertSheet } from '@sub2-mac/core'
import * as api from '../../../api/admin/groups'
import type { CompositeModelRoute, CompositeModelRouteInput, CompositeRouteDecision, CompositeRouteEndpoint } from '../../../types'
import { copy } from './policy-contract'
const props = defineProps<{ groupId: number; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const rows = ref<CompositeModelRoute[]>([]), ready = ref(false), loading = ref(false), busy = ref(false)
const error = ref(''), notice = ref(''), editingId = ref<number | null>(null), pendingDelete = ref<CompositeModelRoute | null>(null)
const endpoints: CompositeRouteEndpoint[] = ['any','messages','count_tokens','responses','chat_completions','embeddings','images','gemini']
const platforms = ['anthropic','openai','gemini','antigravity','grok','kimi','zhipu','deepseek'] as const
const blank = (): CompositeModelRouteInput => ({public_model:'',match_type:'exact',target_platform:'openai',upstream_model:'',endpoint:'any',priority:100,enabled:true,notes:''})
const form = ref(blank()), previewModel = ref(''), previewEndpoint = ref<CompositeRouteEndpoint>('any'), decision = ref<CompositeRouteDecision | null>(null)
let alive = true
onUnmounted(() => { alive = false })
function message(e: unknown) { return e instanceof Error ? e.message : '请求失败，请重试。' }
function lock(value: boolean) { busy.value = value; emit('busy',value) }
async function load() {
  if (loading.value || busy.value || props.disabled) return
  loading.value = true; ready.value = false; error.value = ''
  try { const data = await api.listCompositeRoutes(props.groupId); if (!alive) return; if (!Array.isArray(data)) throw Error('路由响应不完整。'); rows.value=data;ready.value=true }
  catch(e) { if(alive) error.value=`路由读取失败，暂不可保存。${message(e)}` }
  finally { if(alive) loading.value=false }
}
function edit(row: CompositeModelRoute) {
  if(busy.value || props.disabled) return
  editingId.value=row.id
  form.value=copy({public_model:row.public_model,match_type:row.match_type,target_platform:row.target_platform,upstream_model:row.upstream_model,endpoint:row.endpoint,priority:row.priority,enabled:row.enabled,notes:row.notes})
  error.value='';notice.value=''
}
function reset() { editingId.value=null;form.value=blank() }
async function save() {
  if(!ready.value || busy.value || props.disabled) return
  error.value='';notice.value=''
  const data=copy(form.value);data.public_model=data.public_model.trim()
  if(!data.public_model || !Number.isSafeInteger(data.priority) || Number(data.priority)<0) {error.value='请填写公开模型和非负整数优先级。';return}
  lock(true)
  try {
    const result = editingId.value == null ? await api.createCompositeRoute(props.groupId,data) : await api.updateCompositeRoute(props.groupId,editingId.value,data)
    if(!alive) return
    const index=rows.value.findIndex(r=>r.id===result.id)
    if(index<0) rows.value.push(result);else rows.value[index]=result
    reset();decision.value=null;notice.value='路由已保存。'
  } catch(e) {if(alive) error.value=message(e)} finally {lock(false)}
}
async function remove() {
  if(!pendingDelete.value || !ready.value || busy.value || props.disabled) return
  const id=pendingDelete.value.id;lock(true);error.value=''
  try {await api.deleteCompositeRoute(props.groupId,id);if(!alive)return;rows.value=rows.value.filter(r=>r.id!==id);if(editingId.value===id)reset();pendingDelete.value=null;decision.value=null;notice.value='路由已删除。'}
  catch(e){if(alive)error.value=message(e)}finally{lock(false)}
}
async function preview() {
  if(!ready.value || busy.value || props.disabled || !previewModel.value.trim()) return
  lock(true);decision.value=null;error.value=''
  try {const result=await api.previewCompositeRoute(props.groupId,{model:previewModel.value.trim(),endpoint:previewEndpoint.value});if(alive)decision.value=result}
  catch(e){if(alive)error.value=message(e)}finally{lock(false)}
}
onMounted(load)
</script>
<template>
  <section class="policy-panel">
    <p v-if="loading" role="status">读取复合路由…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <button type="button" :disabled="loading || busy || disabled" @click="load">重新读取路由</button>
    <p v-if="ready && !rows.length">尚未配置复合路由。</p>
    <div v-for="row in rows" :key="row.id" class="row"><strong>{{ row.public_model }}</strong><p>{{ row.match_type }} · {{ row.endpoint }} → {{ row.target_platform }} / {{ row.upstream_model || '沿用请求模型' }} · 优先级 {{ row.priority }} · {{ row.enabled ? '启用' : '停用' }}</p>
      <button type="button" :disabled="busy || disabled || !ready" @click="edit(row)">编辑</button><button type="button" :disabled="busy || disabled || !ready" @click="error='';pendingDelete = row">删除</button>
    </div>
    <form @submit.prevent="save"><fieldset :disabled="!ready || busy || disabled" class="policy-panel">
      <strong>{{ editingId == null ? '添加路由' : '编辑路由' }}</strong><div class="fields">
        <label>公开模型<input v-model="form.public_model" required /></label>
        <label>匹配方式<select v-model="form.match_type"><option value="exact">精确</option><option value="prefix">前缀</option></select></label>
        <label>目标平台<select v-model="form.target_platform"><option v-for="p in platforms" :key="p">{{ p }}</option></select></label>
        <label>上游模型<input v-model="form.upstream_model" placeholder="留空沿用请求模型" /></label>
        <label>端点<select v-model="form.endpoint"><option v-for="e in endpoints" :key="e">{{ e }}</option></select></label>
        <label>优先级<input v-model.number="form.priority" type="number" min="0" step="1" required /></label>
      </div><label>备注<input v-model="form.notes" /></label><label><input v-model="form.enabled" type="checkbox" />启用路由</label>
      <div class="actions"><button type="submit">保存路由</button><button type="button" @click="reset">清空表单</button></div>
    </fieldset></form>
    <form class="row" @submit.prevent="preview"><fieldset :disabled="!ready || busy || disabled" class="policy-panel">
      <strong>测试已保存的路由匹配</strong><label>请求模型<input v-model="previewModel" required /></label><label>请求端点<select v-model="previewEndpoint"><option v-for="e in endpoints" :key="e">{{ e }}</option></select></label><button type="submit">预览匹配结果</button>
    </fieldset></form>
    <div v-if="decision" role="status"><strong>{{ decision.matched ? '匹配成功' : '未匹配' }}</strong><p>{{ decision.target_platform }} / {{ decision.upstream_model }} · {{ decision.source }}</p><p v-if="decision.reason">{{ decision.reason }}</p></div>
    <MacAlertSheet :show="!!pendingDelete" title="删除复合路由？" :message="`将删除 ${pendingDelete?.public_model || ''} 的已保存路由。${error ? ' 删除失败：' + error : ''}`" danger confirm-text="删除路由" :loading="busy" @confirm="remove" @cancel="!busy && (pendingDelete = null)" />
  </section>
</template>
<style scoped src="./policy-panel.css"></style>
