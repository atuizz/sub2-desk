<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import { opsAPI, type OpsRuntimeLogConfig, type OpsSystemLogSinkHealth, type OpsSystemLogCleanupRequest } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
import RecordDetails from './RecordDetails.vue';
const props = defineProps<{ filters: OpsSystemLogCleanupRequest }>();
const emit = defineEmits<{ close: []; changed: [] }>();
const config = ref<OpsRuntimeLogConfig | null>(null), health = ref<OpsSystemLogSinkHealth | null>(null);
const persistenceKnown = computed(() => typeof config.value?.persist_access_logs === 'boolean');
const loading = ref(false), busy = ref(false), error = ref(''), healthError = ref(''), notice = ref('');
const start = ref(''), end = ref('');
const pending = ref<'reset' | 'cleanup' | null>(null);
const cleanupRequest = ref<OpsSystemLogCleanupRequest | null>(null);
let epoch = 0;
async function load() {
  const version = ++epoch; loading.value = true; error.value = ''; healthError.value = ''; config.value = null;
  const [settings, sink] = await Promise.allSettled([opsAPI.getRuntimeLogConfig(), opsAPI.getSystemLogSinkHealth()]);
  if (version !== epoch) return;
  if (settings.status === 'fulfilled' && settings.value && ['debug','info','warn','error'].includes(settings.value.level)) config.value = { ...settings.value };
  else error.value = settings.status === 'rejected' ? adminError(settings.reason, '日志配置读取失败') : '日志配置响应无效';
  if (sink.status === 'fulfilled' && Number.isFinite(sink.value?.queue_depth)) health.value = sink.value;
  else { health.value = null; healthError.value = sink.status === 'rejected' ? adminError(sink.reason, '写入健康读取失败') : '写入健康响应无效'; }
  loading.value = false;
}
function payload(): OpsRuntimeLogConfig {
  const c = config.value; if (!c) throw new Error('请先读取日志配置');
  if (!persistenceKnown.value) throw new Error('未能读取访问日志持久化状态，请重新读取配置后再保存。');
  for (const key of ['sampling_initial','sampling_thereafter','retention_days'] as const)
    if (!Number.isSafeInteger(c[key]) || c[key] < 1) throw new Error('采样参数与保留天数应为正整数');
  if (c.retention_days > 3650) throw new Error('保留时间最多3650天');
  return { level: c.level, persist_access_logs: c.persist_access_logs, enable_sampling: c.enable_sampling, sampling_initial: c.sampling_initial,
    sampling_thereafter: c.sampling_thereafter, caller: c.caller, stacktrace_level: c.stacktrace_level, retention_days: c.retention_days };
}
async function save() {
  if (busy.value || loading.value || !config.value) return;
  error.value = ''; notice.value = ''; const version = epoch;
  try {
    const data = payload(); busy.value = true; const result = await opsAPI.updateRuntimeLogConfig(data);
    if (version !== epoch) return;
    config.value = result; notice.value = '日志运行配置已保存'; emit('changed');
  } catch (err) { if (version === epoch) error.value = adminError(err, '日志配置保存失败'); }
  finally { if (version === epoch) busy.value = false; }
}
function prepareCleanup() {
  error.value = ''; notice.value = '';
  const from = new Date(start.value), to = new Date(end.value);
  if (!start.value || !end.value || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) { error.value = '请选择有效的起止时间，结束时间应晚于开始时间'; return; }
  const f = props.filters;
  cleanupRequest.value = { start_time: from.toISOString(), end_time: to.toISOString(), platform: f.platform, level: f.level, q: f.q };
  pending.value = 'cleanup';
}
async function confirm() {
  if (busy.value || !pending.value) return;
  busy.value = true; error.value = ''; const version = epoch;
  try {
    if (pending.value === 'reset') {
      const result = await opsAPI.resetRuntimeLogConfig(); if (version !== epoch) return;
      config.value = result; notice.value = '已恢复后端默认日志配置';
    } else {
      if (!cleanupRequest.value) throw new Error('清理范围尚未确认');
      const result = await opsAPI.cleanupSystemLogs({ ...cleanupRequest.value }); if (version !== epoch) return;
      notice.value = `已清理 ${result.deleted} 条系统日志`;
    }
    pending.value = null; cleanupRequest.value = null; emit('changed');
  } catch (err) { if (version === epoch) error.value = adminError(err, '操作失败，请重试'); }
  finally { if (version === epoch) busy.value = false; }
}
onMounted(load); onUnmounted(() => { epoch++; });
</script>
<template>
  <MacSheet :show="true" title="系统日志维护" :loading="busy" @close="emit('close')">
    <div class="log-maintenance">
      <p v-if="loading" role="status">正在读取日志配置和写入状态…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
      <MacButton :disabled="busy || loading" @click="load">重新读取配置与健康状态</MacButton>
      <form v-if="config" @submit.prevent="save"><h4>运行配置</h4>
        <label>日志级别<select v-model="config.level" aria-label="日志级别"><option>debug</option><option>info</option><option>warn</option><option>error</option></select></label>
        <label><input v-model="config.persist_access_logs" type="checkbox" :disabled="busy || loading || !persistenceKnown" />持久化访问日志</label>
        <p v-if="!persistenceKnown" role="status">未能读取访问日志持久化状态，请重新读取配置后再保存。</p>
        <label><input v-model="config.enable_sampling" type="checkbox" />启用采样</label>
        <label>初始保留数量<input v-model.number="config.sampling_initial" type="number" min="1" /></label><label>后续采样间隔<input v-model.number="config.sampling_thereafter" type="number" min="1" /></label>
        <label><input v-model="config.caller" type="checkbox" />记录调用位置</label><label>堆栈级别<select v-model="config.stacktrace_level"><option value="none">不记录</option><option value="error">错误</option><option value="fatal">致命错误</option></select></label>
        <label>保留天数<input v-model.number="config.retention_days" type="number" min="1" max="3650" /></label>
        <div class="flex flex-wrap gap-2"><MacButton variant="primary" :disabled="busy || loading || !persistenceKnown" @click="save">保存配置</MacButton><MacButton :disabled="busy || loading" @click="error = ''; pending = 'reset'">恢复后端默认</MacButton></div>
      </form>
      <section><h4>日志写入健康</h4><p v-if="healthError" role="alert">{{ healthError }}</p><RecordDetails v-if="health" :record="health" /></section>
      <form @submit.prevent="prepareCleanup"><h4>按范围清理</h4><p>平台：{{ filters.platform || '全部' }} · 级别：{{ filters.level || '全部' }} · 关键词：{{ filters.q || '不限' }}</p>
        <label>开始时间<input v-model="start" type="datetime-local" required /></label><label>结束时间<input v-model="end" type="datetime-local" required /></label>
        <MacButton variant="destructive" :disabled="busy || loading" @click="prepareCleanup">检查清理范围</MacButton>
      </form>
    </div><template #footer><MacButton :disabled="busy" @click="emit('close')">关闭</MacButton></template>
  </MacSheet>
  <MacAlertSheet :show="!!pending" :title="pending === 'reset' ? '恢复后端默认日志配置？' : '永久清理选定范围的系统日志？'"
    :message="error || (pending === 'cleanup' ? `时间范围 ${cleanupRequest?.start_time} 至 ${cleanupRequest?.end_time}，平台 ${cleanupRequest?.platform || '全部'}，级别 ${cleanupRequest?.level || '全部'}，关键词 ${cleanupRequest?.q || '不限'}。删除后不能恢复。` : '当前运行时日志配置将被后端默认值替换。')"
    danger :loading="busy" confirm-text="确认执行" @confirm="confirm" @cancel="pending = null" />
</template>
<style scoped>.log-maintenance, form, section { display: grid; gap: 12px; } form, section { padding-top: 12px; border-top: 1px solid var(--border-color); } h4 { font-weight: 600; } label { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } input, select { min-width: 0; max-width: 100%; padding: 6px; color: var(--text-primary); background: var(--window-bg-solid); border: 1px solid var(--border-color); border-radius: 6px; }</style>
