<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { MacButton } from '@sub2-mac/core'
import { list } from '@/api/admin/tlsFingerprintProfile'
import { controls, isHeaderOverrideCapable, type PlatformControls } from './platform-controls'
const form = defineModel<PlatformControls>({ required: true })
const props = defineProps<{ platform: string; type: string; disabled: boolean }>()
const visible = computed(() => controls.filter(d => d.scope(props.platform, props.type)))
const claude = computed(() => props.platform === 'anthropic' && ['oauth', 'setup-token'].includes(props.type))
const profiles = ref<{ id: number; name: string }[]>([]), error = ref('')
const missingProfile = computed(() => !!form.value.tlsProfile && form.value.tlsProfile > 0 && !profiles.value.some(p => p.id === form.value.tlsProfile))
let disposed = false
async function loadProfiles() { error.value = ''; try { const result = await list(); if (!disposed) profiles.value = result } catch { if (!disposed) error.value = '指纹配置读取失败，当前选择保留。' } }
onMounted(loadProfiles)
onBeforeUnmount(() => { disposed = true })
const labels: Record<string, string> = { '': '跟随系统', aistudio_free: '免费', aistudio_paid: '付费', off: '关闭', device: '设备', session: '会话', full: '完整', auto: '自动', force_on: '强制启用', force_off: '强制关闭', ctx_pool: '上下文池', passthrough: '透传', force_responses: 'Responses', force_chat_completions: 'Chat Completions', default: '跟随系统', disabled: '关闭', enabled: '启用', x_api_key: 'X-API-Key', authorization_bearer: 'Authorization Bearer' }
</script>
<template>
  <details><summary>平台与连接控制</summary><fieldset :disabled="disabled">
    <template v-for="d in visible" :key="d.key">
      <label v-if="d.numeric">{{ d.label }}<input v-model.number="form.values[d.key]" type="number" min="0" max="1" step="0.01" /></label>
      <label v-else-if="d.choices">{{ d.label }}<select v-model="form.values[d.key]" :aria-label="d.label"><option v-for="choice in d.choices" :key="choice" :value="choice">{{ labels[choice] || choice }}</option></select></label>
      <label v-else class="check"><input v-model="form.values[d.key]" type="checkbox" />{{ d.label }}</label>
    </template>
    <template v-if="platform === 'openai' && type === 'apikey'"><p>允许的端点能力（至少选择一项）</p><label class="check"><input v-model="form.capabilities" type="checkbox" value="chat_completions" />文本生成</label><label class="check"><input v-model="form.capabilities" type="checkbox" value="embeddings" />Embeddings</label></template>
    <label v-if="platform === 'openai' && type === 'oauth'">Codex 生图工具<select v-model="form.imageTool"><option value="default">跟随系统</option><option value="enabled">启用桥接</option><option value="disabled">关闭桥接</option><option value="strip">移除显式生图工具</option></select></label>
    <template v-if="type === 'apikey'"><label class="check"><input v-model="form.customErrors" type="checkbox" />自定义错误状态码</label><label v-if="form.customErrors">状态码（逗号分隔）<input v-model="form.errorCodes" placeholder="401, 403, 429" /><small>包含 429 或 529 时会改变限流恢复行为，请确认上游要求。</small></label></template>
    <label class="check"><input v-model="form.tempEnabled" type="checkbox" />按错误暂停调度</label><template v-if="form.tempEnabled"><div v-for="(rule, i) in form.tempRules" :key="i" class="rules"><label>HTTP 状态码<input v-model.number="rule.error_code" type="number" min="100" max="599" /></label><label>匹配关键词（逗号分隔）<input v-model="rule.keywords" /></label><label>暂停分钟<input v-model.number="rule.duration_minutes" type="number" min="1" /></label><label>规则说明<input v-model="rule.description" /></label><MacButton size="sm" @click="form.tempRules.splice(i, 1)">删除规则</MacButton></div><MacButton size="sm" @click="form.tempRules.push({ error_code: 429, keywords: '', duration_minutes: 30, description: '' })">添加暂停规则</MacButton></template>
    <template v-if="claude">
      <label v-if="form.values.enable_tls_fingerprint">TLS 指纹配置<select v-model="form.tlsProfile" aria-label="TLS 指纹配置"><option :value="null">默认配置</option><option :value="-1">随机配置</option><option v-if="missingProfile" :value="form.tlsProfile">当前配置 #{{ form.tlsProfile }}</option><option v-for="p in profiles" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="loadProfiles">重试</button></p>
      <label v-if="form.values.cache_ttl_override_enabled">缓存 TTL<select v-model="form.ttl" aria-label="缓存 TTL"><option value="5m">5 分钟</option><option value="1h">1 小时</option></select></label>
      <label class="check"><input v-model="form.baseUrlEnabled" type="checkbox" />自定义服务地址</label><label v-if="form.baseUrlEnabled">服务地址<input v-model="form.baseUrl" placeholder="https://…" /></label>
    </template>
    <label v-if="platform === 'antigravity'">Antigravity 项目 ID<input v-model="form.projectId" /></label>
    <template v-if="isHeaderOverrideCapable(platform, type)">
      <label class="check"><input v-model="form.headersEnabled" type="checkbox" />请求头覆写</label>
      <template v-if="form.headersEnabled"><p>空值表示删除该请求头。认证、会话和传输控制头不可覆写。</p>
        <div v-for="(row, i) in form.headers" :key="i" class="header-row"><label>请求头名称<input v-model="row.name" autocomplete="off" /></label><label>请求头值<input v-model="row.value" type="password" autocomplete="new-password" /></label><MacButton size="sm" @click="form.headers.splice(i, 1)">删除</MacButton></div>
        <MacButton size="sm" @click="form.headers.push({ name: '', value: '' })">添加请求头</MacButton>
      </template>
    </template>
  </fieldset></details>
</template>
<style scoped>
summary{padding:10px 0;font-weight:600;cursor:pointer}fieldset{border:0;display:grid;gap:12px;padding:8px 0;min-width:0}label{display:grid;gap:6px}.check{display:flex;align-items:center;gap:8px}input:not([type=checkbox]),select{width:100%;min-width:0;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--bg-surface);color:inherit}.header-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;align-items:end}p{color:var(--text-secondary);line-height:1.6;margin:0}@media(max-width:440px){.header-row{grid-template-columns:1fr}}
</style>
