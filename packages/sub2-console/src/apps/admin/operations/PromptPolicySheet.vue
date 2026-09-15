<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { promptAuditAPI, type PromptAuditConfig, type PromptAuditEndpointDraft, type PromptAuditUpdateRequest } from '../../../api/admin/promptAudit';
import { adminError } from '../admin-feedback';
const emit = defineEmits<{ close: []; saved: [] }>();
const config = ref<PromptAuditConfig | null>(null), endpoints = ref<PromptAuditEndpointDraft[]>([]);
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref(''), groupText = ref(''), scannerText = ref('');
const probing = ref<string | null>(null);
let epoch = 0;
async function load() {
  const version = ++epoch; loading.value = true; config.value = null; endpoints.value = []; error.value = '';
  try {
    const data = await promptAuditAPI.getConfig(); if (version !== epoch) return;
    config.value = data; groupText.value = data.group_ids.join(','); scannerText.value = data.scanners.join('\n');
    endpoints.value = data.endpoints.map(e => ({ ...e, token: '', clear_token: false }));
  } catch (err) { if (version === epoch) error.value = adminError(err, '读取提示词审计配置失败'); }
  finally { if (version === epoch) loading.value = false; }
}
function add() {
  endpoints.value.push({ id: crypto.randomUUID(), name: '', protocol: 'openai_compatible', base_url: '', model: '',
    timeout_ms: 10000, input_limit: 32000, enabled: true, has_token: false, token_status: 'missing', token: '', clear_token: false });
}
function validateEndpoint(endpoint: PromptAuditEndpointDraft) {
  if (!endpoint.name.trim() || !endpoint.model.trim()) throw new Error('请填写节点名称和模型');
  const url = new URL(endpoint.base_url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('节点地址应为不含凭据的 HTTP(S) 地址');
  if (!Number.isSafeInteger(endpoint.timeout_ms) || endpoint.timeout_ms < 1 || !Number.isSafeInteger(endpoint.input_limit) || endpoint.input_limit < 1) throw new Error('超时和输入上限应为正整数');
  if (endpoint.clear_token && endpoint.token.trim()) throw new Error('不能同时清除和替换节点密钥');
}
function payload(): PromptAuditUpdateRequest {
  const c = config.value; if (!c) throw new Error('请先读取配置');
  const group_ids = groupText.value.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (group_ids.some(n => !Number.isSafeInteger(n) || n < 1) || (!c.all_groups && !group_ids.length)) throw new Error('请填写有效分组 ID，或选择全部分组');
  if (!Number.isSafeInteger(c.worker_count) || c.worker_count < 1 || !Number.isSafeInteger(c.queue_capacity) || c.queue_capacity < 1) throw new Error('工作线程和队列容量应为正整数');
  const scanners = [...new Set(scannerText.value.split('\n').map(s => s.trim()).filter(Boolean))];
  if (c.enabled && (!scanners.length || !endpoints.value.some(e => e.enabled))) throw new Error('启用审计需要扫描分类和至少一个启用节点');
  endpoints.value.forEach(validateEndpoint);
  return { expected_config_version: c.config_version, enabled: c.enabled, blocking_enabled: c.blocking_enabled,
    blocking_latest_turn_only: c.blocking_latest_turn_only, store_pass_events: c.store_pass_events, strategy: 'priority',
    worker_count: c.worker_count, queue_capacity: c.queue_capacity, scanners, all_groups: c.all_groups,
    group_ids: c.all_groups ? [] : [...new Set(group_ids)], endpoints: endpoints.value.map(e => ({ id: e.id,
      name: e.name.trim(), protocol: 'openai_compatible', base_url: e.base_url.trim(), model: e.model.trim(),
      token: e.token.trim() || undefined, clear_token: e.clear_token, timeout_ms: e.timeout_ms, input_limit: e.input_limit, enabled: e.enabled })) };
}
async function save() {
  if (saving.value || probing.value || !config.value) return;
  const version = epoch; error.value = '';
  try {
    const value = payload(); saving.value = true;
    await promptAuditAPI.updateConfig(value); if (version !== epoch) return;
    endpoints.value.forEach(e => { e.token = ''; }); emit('saved'); emit('close');
  } catch (err) { if (version === epoch) error.value = adminError(err, '配置保存失败；若版本冲突请关闭后重新读取，保留你的修改记录。'); }
  finally { if (version === epoch) saving.value = false; }
}
async function probe(endpoint: PromptAuditEndpointDraft) {
  if (probing.value || saving.value) return;
  const version = epoch; error.value = ''; notice.value = '';
  try {
    validateEndpoint(endpoint); probing.value = endpoint.id;
    const result = await promptAuditAPI.probeEndpoint({ ...endpoint });
    if (version === epoch) {
      if (result.ok) notice.value = `${endpoint.name}：连接通过 · ${result.latency_ms} ms`;
      else error.value = result.message || '节点连接未通过';
    }
  } catch (err) { if (version === epoch) error.value = adminError(err, '节点测试失败'); }
  finally { if (version === epoch) probing.value = null; }
}
function move(index: number, offset: number) {
  const target = index + offset; if (target < 0 || target >= endpoints.value.length) return;
  const item = endpoints.value.splice(index, 1)[0]!; endpoints.value.splice(target, 0, item);
}
onMounted(load); onUnmounted(() => { epoch++; endpoints.value.forEach(e => { e.token = ''; }); });
</script>
<template>
  <MacSheet :show="true" title="提示词审计策略与节点" :loading="saving || !!probing" @close="emit('close')">
    <p v-if="loading" role="status">正在读取配置…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><MacButton v-if="!loading && !config" @click="load">重试</MacButton>
    <form v-if="config" class="prompt-policy" @submit.prevent="save">
      <label><input v-model="config.enabled" type="checkbox" />启用提示词审计</label><label><input v-model="config.blocking_enabled" type="checkbox" />同步拦截</label><label><input v-model="config.blocking_latest_turn_only" type="checkbox" />仅检查最新一轮输入</label><label><input v-model="config.store_pass_events" type="checkbox" />保存通过事件</label>
      <label>工作线程<input v-model.number="config.worker_count" type="number" min="1" /></label><label>队列容量<input v-model.number="config.queue_capacity" type="number" min="1" /></label>
      <label><input v-model="config.all_groups" type="checkbox" />全部分组</label><label v-if="!config.all_groups">分组 ID<input v-model="groupText" /></label>
      <label>扫描分类（每行一个）<textarea v-model="scannerText" rows="4" /></label>
      <div class="flex justify-between"><h4>审计节点 · 按排列优先使用</h4><MacButton size="sm" @click="add">添加节点</MacButton></div>
      <fieldset v-for="(endpoint, index) in endpoints" :key="endpoint.id"><legend>节点 {{ index + 1 }}</legend>
        <label>名称<input v-model="endpoint.name" /></label><label>接口地址<input v-model="endpoint.base_url" type="url" /></label><label>模型<input v-model="endpoint.model" /></label>
        <label>新密钥<input v-model="endpoint.token" type="password" autocomplete="new-password" :placeholder="endpoint.has_token ? '留空保留已配置密钥' : '尚未配置'" /></label><label><input v-model="endpoint.clear_token" type="checkbox" />清除已保存密钥</label>
        <label>超时（毫秒）<input v-model.number="endpoint.timeout_ms" type="number" min="1" /></label><label>输入上限<input v-model.number="endpoint.input_limit" type="number" min="1" /></label><label><input v-model="endpoint.enabled" type="checkbox" />启用节点</label>
        <div class="flex flex-wrap gap-2"><MacButton size="sm" :disabled="!!probing || saving" @click="probe(endpoint)">测试连接</MacButton><MacButton size="sm" :disabled="index === 0" @click="move(index, -1)">上移</MacButton><MacButton size="sm" :disabled="index === endpoints.length - 1" @click="move(index, 1)">下移</MacButton><MacButton size="sm" variant="destructive" @click="endpoints.splice(index, 1)">移除</MacButton></div>
      </fieldset>
      <p class="text-xs">节点调整在保存后生效；测试连接会使用当前填写的节点信息。</p>
    </form>
    <template #footer><MacButton :disabled="saving || !!probing" @click="emit('close')">取消</MacButton><MacButton variant="primary" :disabled="saving || loading || !!probing || !config" @click="save">保存配置</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.prompt-policy, fieldset { display: grid; gap: 12px; } fieldset { border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; } label { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } input, textarea { min-width: 0; max-width: 100%; padding: 6px; color: var(--text-primary); background: var(--window-bg-solid); border: 1px solid var(--border-color); border-radius: 6px; } textarea { width: 100%; }
</style>
