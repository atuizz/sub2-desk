<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import { opsAPI, type OpsAdvancedSettings } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
const emit = defineEmits<{close:[];saved:[value:OpsAdvancedSettings]}>();
const config = ref<OpsAdvancedSettings|null>(null), pending = ref<OpsAdvancedSettings|null>(null);
const loading=ref(false),busy=ref(false),error=ref(''),notice=ref('');
const fields=[['error_log_retention_days','错误日志'],['minute_metrics_retention_days','分钟指标'],['hourly_metrics_retention_days','小时指标']] as const;
const booleanFields=[['ignore_count_tokens_errors','忽略 Count Tokens 错误'],['ignore_context_canceled','忽略客户端取消请求'],['ignore_no_available_accounts','忽略无可用账号错误'],['ignore_invalid_api_key_errors','忽略无效 API Key 错误'],['ignore_insufficient_balance_errors','忽略余额不足错误'],['display_alert_events','概览展示告警事件'],['display_openai_token_stats','展示 OpenAI Token 统计'],['auto_refresh_enabled','自动刷新运维数据']] as const;
const quotaFields=[['default_threshold_5h','5小时窗口'],['default_threshold_7d','7天窗口']] as const;
function quotaPercent(key:'default_threshold_5h'|'default_threshold_7d'){const value=config.value?.openai_account_quota_auto_pause?.[key];return typeof value==='number'?Math.round(value*100000)/1000:'';}
function setQuota(key:'default_threshold_5h'|'default_threshold_7d',event:Event){if(!config.value?.openai_account_quota_auto_pause)return;const text=(event.target as HTMLInputElement).value;config.value.openai_account_quota_auto_pause[key]=text.trim()===''?NaN:Number(text)/100;}
let epoch=0;
async function load(){const version=++epoch;loading.value=true;error.value='';config.value=null;
 try{const data=await opsAPI.getAdvancedSettings();if(version!==epoch)return;if(!data?.data_retention || !data.aggregation)throw new Error('高级配置响应不完整');config.value=JSON.parse(JSON.stringify(data));}
 catch(err){if(version===epoch)error.value=adminError(err,'高级配置读取失败');}finally{if(version===epoch)loading.value=false;}}
function prepare(){if(!config.value || busy.value || loading.value)return;error.value='';notice.value='';
 try{const data:OpsAdvancedSettings=JSON.parse(JSON.stringify(config.value));for(const [key] of fields){const n=data.data_retention[key];if(!Number.isInteger(n)||n<0||n>365)throw new Error('保留天数必须为0至365的整数');}
 for(const [key] of booleanFields)if(data[key]!==undefined && typeof data[key]!=='boolean')throw new Error('开关值无效，请重新读取');
 if(data.openai_account_quota_auto_pause){for(const [key] of quotaFields){const n=data.openai_account_quota_auto_pause[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1)throw new Error('配额自动暂停阈值必须为0至100%的有效数值');}}
 if(data.auto_refresh_interval_seconds!==undefined && (!Number.isInteger(data.auto_refresh_interval_seconds)||data.auto_refresh_interval_seconds<1||data.auto_refresh_interval_seconds>86400))throw new Error('自动刷新间隔必须为1至86400秒整数');
 if(data.data_retention.cleanup_enabled && data.data_retention.cleanup_schedule.trim().split(/\s+/).length<5)throw new Error('启用清理必须填写有效Cron计划（至少5段）');pending.value=data;
 }catch(err){error.value=adminError(err,'高级配置无效');}}
async function save(){if(!pending.value||busy.value)return;busy.value=true;error.value='';const version=epoch;
 try{const result=await opsAPI.updateAdvancedSettings(JSON.parse(JSON.stringify(pending.value)));if(version!==epoch)return;config.value=result;pending.value=null;notice.value='高级设置已保存';emit('saved',result);}
 catch(err){if(version===epoch)error.value=adminError(err,'保存失败');}finally{if(version===epoch)busy.value=false;}}
onMounted(load);onUnmounted(()=>{epoch++;pending.value=null;});
</script>
<template>
 <MacSheet :show="true" title="运维高级设置" :loading="busy" @close="emit('close')">
  <p v-if="loading" role="status">读取中…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><MacButton v-if="!config" :disabled="loading" @click="load">重新读取</MacButton>
  <form v-if="config" @submit.prevent="prepare"><label><input v-model="config.data_retention.cleanup_enabled" type="checkbox" />启用定期清理</label><label>清理时间表（Cron）<input v-model="config.data_retention.cleanup_schedule" placeholder="0 3 * * *" /></label>
   <label v-for="[key,label] in fields" :key="key">{{ label }}保留天数<input v-model.number="config.data_retention[key]" type="number" min="0" max="365" /></label><p>0 表示每次定时清理时清空该类全部历史。缩短保留期可能在后续清理时删除历史记录。</p>
   <label><input v-model="config.aggregation.aggregation_enabled" type="checkbox" />启用指标聚合</label><p>由后端聚合分钟/小时指标，用于历史统计查询。</p>
   <h4>错误记录与显示偏好</h4><p>错误忽略由后端生效；展示和自动刷新偏好保存后同步到当前运维窗口。</p>
   <div v-for="[key,label] in booleanFields" :key="key"><label v-if="typeof config[key] === 'boolean'"><input v-model="config[key]" type="checkbox" />{{ label }}</label><p v-else class="text-xs">{{ label }}：当前后端未提供此设置</p></div>
   <label v-if="config.auto_refresh_interval_seconds !== undefined">自动刷新间隔（秒）<input v-model.number="config.auto_refresh_interval_seconds" type="number" min="1" max="86400" list="ops-refresh-options" /><datalist id="ops-refresh-options"><option value="15"/><option value="30"/><option value="60"/></datalist></label>
   <h4>OpenAI配额自动暂停</h4><p>达到已用配额阈值时由后端暂停调度；填0关闭该窗口的全局默认阈值，账号独立阈值优先。</p>
   <template v-if="config.openai_account_quota_auto_pause"><label v-for="[key,label] in quotaFields" :key="key">{{ label }}阈值（%）<input :value="quotaPercent(key)" type="number" min="0" max="100" step="0.1" @input="setQuota(key,$event)" /></label></template><p v-else>当前后端未提供配额自动暂停配置。</p>
  </form><template #footer><MacButton :disabled="busy" @click="emit('close')">关闭</MacButton><MacButton variant="primary" :disabled="busy||loading||!config" @click="prepare">检查并保存</MacButton></template>
 </MacSheet>
 <MacAlertSheet :show="!!pending" title="更新运维高级设置？" :message="error || `定期清理：${pending?.data_retention.cleanup_enabled ? '开启' : '关闭'}，错误日志/分钟指标/小时指标保留：${pending?.data_retention.error_log_retention_days}/${pending?.data_retention.minute_metrics_retention_days}/${pending?.data_retention.hourly_metrics_retention_days} 天。0天表示定时清理时清空该类全部历史。历史数据清理后不可恢复。错误忽略、显示偏好及配额自动暂停也将按当前草稿保存。`" danger :loading="busy" confirm-text="保存设置" @confirm="save" @cancel="pending=null" />
</template>
<style scoped>form{display:grid;gap:14px;}label{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}input{min-width:0;max-width:100%;padding:6px;background:var(--window-bg-solid);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;}</style>
