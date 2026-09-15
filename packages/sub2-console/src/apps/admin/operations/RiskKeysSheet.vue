<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import { riskControlAPI, type ContentModerationConfig, type UpdateContentModerationConfig, type ContentModerationAPIKeyStatus, type ContentModerationTestAuditResult } from '../../../api/admin/riskControl';
import { adminError } from '../admin-feedback';
import RecordDetails from './RecordDetails.vue';
const emit = defineEmits<{ close: []; changed: [] }>();
const config = ref<ContentModerationConfig | null>(null), input = ref(''), mode = ref<'append' | 'replace'>('append');
const deleted = ref<string[]>([]), clear = ref(false), prompt = ref(''), images = ref('');
const loading = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const tested = ref<ContentModerationAPIKeyStatus[]>([]), audit = ref<ContentModerationTestAuditResult | null>(null);
const pending = ref<UpdateContentModerationConfig | null>(null);
let epoch = 0;
async function load() {
 const version = ++epoch; loading.value = true; error.value = ''; config.value = null;
 try { const data = await riskControlAPI.getConfig(); if(version !== epoch) return;
  if(!data || !Array.isArray(data.api_key_statuses)) throw new Error('密钥池状态不完整');
  config.value = data; input.value = ''; deleted.value = []; clear.value = false; mode.value = 'append';
 } catch(err) { if(version === epoch) error.value = adminError(err,'密钥池读取失败'); }
 finally { if(version === epoch) loading.value = false; }
}
function keys() { return [...new Set(input.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean))]; }
function prepare() {
 if(!config.value || busy.value || loading.value) return; error.value = '';notice.value = '';
 try {
  const list = keys();
  if(clear.value && (list.length || deleted.value.length)) throw new Error('清空密钥池不能同时追加、替换或删除单个密钥');
  if(mode.value === 'replace' && !clear.value && (!list.length || deleted.value.length)) throw new Error('替换模式需要新密钥，不能同时删除旧密钥');
  const allowed = new Set(config.value.api_key_statuses.filter(k => k.configured).map(k => k.key_hash));
  if(deleted.value.some(hash => !allowed.has(hash))) throw new Error('待删除密钥不在当前密钥池中，请重新读取');
  if(!clear.value && !list.length && !deleted.value.length) throw new Error('没有待保存的密钥变更');
  pending.value = clear.value ? {clear_api_key:true} : { ...(list.length ? {api_keys:list,api_keys_mode:mode.value} : {}), ...(deleted.value.length ? {delete_api_key_hashes:[...deleted.value]} : {}) };
 } catch(err) { error.value = adminError(err,'密钥变更无效'); }
}
function cancel() { pending.value = null; }
async function save() {
 if(!pending.value || busy.value) return; busy.value = true; error.value = ''; const version = epoch;
 try {
  const payload = JSON.parse(JSON.stringify(pending.value));
  await riskControlAPI.updateConfig(payload); if(version !== epoch) return;
  pending.value = null; input.value = ''; deleted.value = []; clear.value = false; tested.value = []; audit.value = null;
  notice.value = '密钥池已更新'; emit('changed'); await load();
 } catch(err) { if(version === epoch) error.value = adminError(err,'密钥池保存失败'); }
 finally { busy.value = false; }
}
async function probe(useInput: boolean) {
 if(!config.value || busy.value || loading.value) return;error.value = '';notice.value = '';const version = epoch;
 try {
  const list = useInput ? keys() : [];
  if(useInput && !list.length) throw new Error('请先填写待测试密钥');
  if(!useInput && (clear.value || deleted.value.length || mode.value === 'replace')) throw new Error('请先保存或取消现有密钥池变更后再探测');
  if(!useInput && !config.value.api_key_count) throw new Error('当前没有已保存密钥');
  const imageList = images.value.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  for(const image of imageList) { const url = new URL(image); if(!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('图片地址必须为不含凭据的 HTTP(S) URL'); }
  busy.value = true;
  const result = await riskControlAPI.testAPIKeys({ api_keys:list,base_url:config.value.base_url,model:config.value.model,timeout_ms:config.value.timeout_ms,proxy_id:config.value.proxy_id ?? 0,prompt:prompt.value,images:imageList });
  if(version !== epoch) return;
  if(!Array.isArray(result.items)) throw new Error('探测结果不完整');
  tested.value = result.items; audit.value = result.audit_result ?? null;
  notice.value = `已完成 ${result.items.length} 个密钥探测，请查看每项状态；不表示全部通过`;
 } catch(err) { if(version === epoch) error.value = adminError(err,'密钥探测失败'); }
 finally { if(version === epoch) busy.value = false; }
}
onMounted(load);onUnmounted(() => {epoch++;input.value='';pending.value=null;tested.value=[];});
</script>
<template>
 <MacSheet :show="true" title="审核密钥池与探测" :loading="busy" @close="emit('close')">
  <p v-if="loading" role="status">正在读取密钥池…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><MacButton v-if="!config" :disabled="loading" @click="load">重试</MacButton>
  <div v-if="config" class="keys-form">
   <p>已配置 {{ config.api_key_count }} 个密钥；仅展示脱敏状态。</p>
   <div v-for="key in config.api_key_statuses" :key="key.key_hash" class="admin-card p-3"><strong>{{ key.masked }}</strong><p>{{ key.status }} · {{ key.last_http_status }} · {{ key.last_latency_ms }} ms</p><p>{{ key.last_error }}</p><p v-if="key.frozen_until">冻结至 {{ key.frozen_until }}</p><label><input v-model="deleted" type="checkbox" :value="key.key_hash" :disabled="!key.configured || clear || mode === 'replace'" />保存时移除此密钥</label></div>
   <label>写入方式<select v-model="mode"><option value="append">追加</option><option value="replace">替换整个密钥池</option></select></label>
   <label>新密钥（每行一个）<textarea v-model="input" rows="4" autocomplete="off" spellcheck="false" :disabled="clear" /></label><label><input v-model="clear" type="checkbox" />清空密钥池</label>
   <MacButton variant="primary" :disabled="busy" @click="prepare">检查并保存密钥变更</MacButton>
   <h4>探测</h4><p>使用已保存的审核地址、模型、超时和代理。测试输入仅用于本次探测。</p><label>测试内容<textarea v-model="prompt" /></label><label>图片 URL（每行一个，可空）<textarea v-model="images" /></label>
   <div class="flex flex-wrap gap-2"><MacButton :disabled="busy" @click="probe(false)">探测已保存密钥</MacButton><MacButton :disabled="busy" @click="probe(true)">探测新输入密钥</MacButton></div>
   <div v-for="(key,index) in tested" :key="index" class="admin-card p-3"><p>{{ key.masked }} · {{ key.status }} · HTTP {{ key.last_http_status }} · {{ key.last_latency_ms }} ms</p><p>{{ key.last_error }}</p></div>
   <RecordDetails v-if="audit" :record="audit" />
  </div><template #footer><MacButton :disabled="busy" @click="emit('close')">关闭</MacButton></template>
 </MacSheet>
 <MacAlertSheet :show="!!pending" title="确认修改审核密钥池？" :message="error || (pending?.clear_api_key ? '将清空全部审核密钥。' : `方式：${pending?.api_keys_mode === 'replace' ? '替换整个池' : '追加/移除'}，新增 ${pending?.api_keys?.length || 0} 个，移除 ${pending?.delete_api_key_hashes?.length || 0} 个。`)" danger :loading="busy" confirm-text="保存变更" @confirm="save" @cancel="cancel" />
</template>
<style scoped>.keys-form { display:grid;gap:12px; }label { display:flex;flex-wrap:wrap;gap:8px;align-items:center; }textarea,select { min-width:0;max-width:100%;padding:6px;background:var(--window-bg-solid);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px; }textarea { width:100%; }</style>
