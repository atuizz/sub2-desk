<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { opsAPI, type EmailNotificationConfig, type OpsAlertRuntimeSettings } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
const props = defineProps<{ mode: 'email' | 'runtime' }>();
const emit = defineEmits<{ close: [] }>();
const email = ref<EmailNotificationConfig | null>(null), runtime = ref<OpsAlertRuntimeSettings | null>(null);
const loading = ref(false), saving = ref(false), error = ref(''), notice = ref('');
const recipients = ref(''), reportRecipients = ref('');
let epoch = 0;
const reportFields = [ ['daily_summary_enabled','daily_summary_schedule','每日摘要'], ['weekly_summary_enabled','weekly_summary_schedule','每周摘要'], ['error_digest_enabled','error_digest_schedule','错误摘要'], ['account_health_enabled','account_health_schedule','账号健康报告'] ] as const;
const thresholdFields = [['sla_percent_min','最低 SLA（%）'],['ttft_p99_ms_max','首字延迟 P99（毫秒）'],['request_error_rate_percent_max','请求错误率上限（%）'],['upstream_error_rate_percent_max','上游错误率上限（%）']] as const;
async function load() {
 const version = ++epoch; loading.value = true; error.value = ''; email.value = null; runtime.value = null;
 try {
  if (props.mode === 'email') {
   const data = await opsAPI.getEmailNotificationConfig(); if (version !== epoch) return;
   if (!data?.alert || !data.report || !Array.isArray(data.alert.recipients) || !Array.isArray(data.report.recipients)) throw new Error('邮件配置响应不完整');
   email.value = JSON.parse(JSON.stringify(data)); recipients.value = data.alert.recipients.join('\n'); reportRecipients.value = data.report.recipients.join('\n');
  } else {
   const data = await opsAPI.getAlertRuntimeSettings(); if (version !== epoch) return;
   if (!data?.distributed_lock || !data.silencing || !data.thresholds) throw new Error('告警运行配置响应不完整');
   runtime.value = JSON.parse(JSON.stringify(data)); runtime.value!.silencing.entries ??= [];
   for(const entry of runtime.value!.silencing.entries) entry.severities ??= [];
  }
 } catch (err) { if(version === epoch) error.value = adminError(err,'配置读取失败'); }
 finally { if(version === epoch) loading.value = false; }
}
function addresses(text: string) {
 const values = [...new Set(text.split(/[\s,;，；]+/).filter(Boolean))];
 if(values.some(v => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) throw new Error('收件人邮箱格式无效');
 return values;
}
function number(value: unknown, min: number, max = Infinity) { if(typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('数值超出允许范围'); }
function emailPayload() {
 if(!email.value) throw new Error('请先读取邮件配置');
 const value: EmailNotificationConfig = JSON.parse(JSON.stringify(email.value));
 value.alert.recipients = addresses(recipients.value); value.report.recipients = addresses(reportRecipients.value);
 if((value.alert.enabled && !value.alert.recipients.length) || (value.report.enabled && !value.report.recipients.length)) throw new Error('启用通知必须填写收件人');
 number(value.alert.rate_limit_per_hour,0); number(value.alert.batching_window_seconds,0);
 number(value.report.error_digest_min_count,0); number(value.report.account_health_error_rate_threshold,0,100);
 for(const [enabled,schedule] of reportFields) if(value.report.enabled && value.report[enabled] && value.report[schedule].trim().split(/\s+/).length < 5) throw new Error('启用的报告需要有效 Cron 时间表（至少5段）');
 return value;
}
function runtimePayload() {
 if(!runtime.value) throw new Error('请先读取运行参数');
 const value: OpsAlertRuntimeSettings = JSON.parse(JSON.stringify(runtime.value));
 number(value.evaluation_interval_seconds,1,86400);
 if(value.distributed_lock.enabled) { if(!value.distributed_lock.key.startsWith('ops:')) throw new Error('锁名称必须以 ops: 开头'); number(value.distributed_lock.ttl_seconds,1,86400); }
 for(const [key] of thresholdFields) { const v = value.thresholds[key]; if(v != null) number(v,0,key === 'ttft_p99_ms_max' ? Infinity : 100); }
 const silence = value.silencing;
 if(silence.enabled) {
  if(silence.global_until_rfc3339 && !Number.isFinite(Date.parse(silence.global_until_rfc3339))) throw new Error('全局静默到期时间无效');
  for(const entry of silence.entries || []) {
   if(!entry.until_rfc3339 || !Number.isFinite(Date.parse(entry.until_rfc3339))) throw new Error('静默条目必须填写有效到期时间');
   if(entry.rule_id != null && (!Number.isSafeInteger(entry.rule_id) || entry.rule_id < 1)) throw new Error('规则 ID 必须为正整数');
   if(entry.severities?.some(s => !['P0','P1','P2','P3'].includes(s))) throw new Error('静默级别仅支持 P0–P3');
  }
 }
 return value;
}
async function save() {
 if(saving.value || loading.value) return; const version = epoch; error.value = ''; notice.value = '';
 try {
  const value = props.mode === 'email' ? emailPayload() : runtimePayload(); saving.value = true;
  if(props.mode === 'email') await opsAPI.updateEmailNotificationConfig(value as EmailNotificationConfig);
  else await opsAPI.updateAlertRuntimeSettings(value as OpsAlertRuntimeSettings);
  if(version === epoch) notice.value = '配置已保存';
 } catch(err) { if(version === epoch) error.value = adminError(err,'保存失败'); }
 finally { if(version === epoch) saving.value = false; }
}
function setThreshold(key: keyof OpsAlertRuntimeSettings['thresholds'], event: Event) { if(runtime.value) { const v = (event.target as HTMLInputElement).value; runtime.value.thresholds[key] = v === '' ? null : Number(v); } }
onMounted(load); onUnmounted(() => { epoch++; });
</script>
<template>
 <MacSheet :show="true" :title="mode === 'email' ? '邮件告警与报告' : '告警运行参数'" :loading="saving" @close="emit('close')">
  <p v-if="loading" role="status">正在读取配置…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><MacButton v-if="!email && !runtime" :disabled="loading" @click="load">重试读取</MacButton>
  <form @submit.prevent="save">
   <template v-if="email">
    <h4>告警邮件</h4><label><input v-model="email.alert.enabled" type="checkbox" />启用告警邮件</label><label>收件人（每行一个）<textarea v-model="recipients" /></label>
    <label>最低级别<select v-model="email.alert.min_severity"><option value="">全部</option><option value="info">信息</option><option value="warning">警告</option><option value="critical">严重</option></select></label>
    <label>每小时上限<input v-model.number="email.alert.rate_limit_per_hour" type="number" min="0" /></label><label>合并窗口（秒）<input v-model.number="email.alert.batching_window_seconds" type="number" min="0" /></label><label><input v-model="email.alert.include_resolved_alerts" type="checkbox" />包含恢复通知</label>
    <h4>定时报告</h4><label><input v-model="email.report.enabled" type="checkbox" />启用报告</label><label>报告收件人<textarea v-model="reportRecipients" /></label>
    <div v-for="[enabled,schedule,label] in reportFields" :key="enabled"><label><input v-model="email.report[enabled]" type="checkbox" />{{ label }}</label><label>时间表（Cron）<input v-model="email.report[schedule]" placeholder="0 9 * * *" /></label></div>
    <label>错误摘要最少数量<input v-model.number="email.report.error_digest_min_count" type="number" min="0" /></label><label>账号健康错误率阈值<input v-model.number="email.report.account_health_error_rate_threshold" type="number" min="0" max="100" /></label>
   </template>
   <template v-if="runtime">
    <label>评估间隔（秒）<input v-model.number="runtime.evaluation_interval_seconds" type="number" min="1" max="86400" /></label>
    <label><input v-model="runtime.distributed_lock.enabled" type="checkbox" />启用分布式锁</label><label>锁名称<input v-model="runtime.distributed_lock.key" /></label><label>锁有效期（秒）<input v-model.number="runtime.distributed_lock.ttl_seconds" type="number" min="1" max="86400" /></label>
    <h4>指标阈值（留空不设置）</h4><label v-for="[key,label] in thresholdFields" :key="key">{{ label }}<input :value="runtime.thresholds[key]" type="number" min="0" step="any" @input="setThreshold(key,$event)" /></label>
    <h4>静默配置</h4><label><input v-model="runtime.silencing.enabled" type="checkbox" />启用静默</label><label>全局到期时间（RFC3339，可空）<input v-model="runtime.silencing.global_until_rfc3339" placeholder="2026-09-12T18:00:00+08:00" /></label><label>全局原因<input v-model="runtime.silencing.global_reason" /></label>
    <fieldset v-for="(entry,index) in runtime.silencing.entries" :key="index"><label>规则 ID（可空）<input :value="entry.rule_id" type="number" min="1" @input="entry.rule_id = ($event.target as HTMLInputElement).value ? Number(($event.target as HTMLInputElement).value) : undefined" /></label><label>到期时间<input v-model="entry.until_rfc3339" /></label><label>原因<input v-model="entry.reason" /></label><label v-for="severity in ['P0','P1','P2','P3']" :key="severity"><input v-model="entry.severities" type="checkbox" :value="severity" />{{ severity }}</label><MacButton @click="runtime.silencing.entries?.splice(index,1)">移除条目</MacButton></fieldset>
    <MacButton @click="runtime.silencing.entries?.push({ until_rfc3339: '', reason: '', severities: [] })">添加静默条目</MacButton>
   </template>
  </form><template #footer><MacButton :disabled="saving" @click="emit('close')">关闭</MacButton><MacButton variant="primary" :disabled="saving || loading || (!email && !runtime)" @click="save">保存配置</MacButton></template>
 </MacSheet>
</template>
<style scoped>form,fieldset { display:grid; gap:12px; } h4 { margin-top:14px; font-weight:600; } label { display:flex; flex-wrap:wrap; gap:8px; align-items:center; } input,select,textarea { min-width:0; max-width:100%; padding:6px; background:var(--window-bg-solid);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px; } textarea { width:100%; }</style>
