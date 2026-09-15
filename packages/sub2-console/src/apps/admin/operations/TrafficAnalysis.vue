<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { opsAPI, type OpsLatencyHistogramResponse, type OpsErrorDistributionResponse, type OpsErrorTrendResponse, type OpsRealtimeTrafficSummaryResponse, type OpsOpenAITokenStatsResponse, type OpsOpenAITokenStatsTimeRange } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
import { createLiveConnection } from './liveConnection';
const props = defineProps<{ platform: string; range: '5m' | '30m' | '1h' | '6h' | '24h';showTokens?:boolean;refreshRevision?:number }>();
const latency = ref<OpsLatencyHistogramResponse | null>(null), distribution = ref<OpsErrorDistributionResponse | null>(null), trend = ref<OpsErrorTrendResponse | null>(null), realtime = ref<OpsRealtimeTrafficSummaryResponse | null>(null), tokens = ref<OpsOpenAITokenStatsResponse | null>(null);
const errors = ref<Record<string,string>>({}), loading = ref(false), liveLoading = ref(false), tokenLoading = ref(false), auto = ref(false), updated = ref('');
const tokenRange = ref<OpsOpenAITokenStatsTimeRange>('1h'), tokenPage = ref(1);
const socketEnabled=ref(false), socketStatus=ref('closed'), socketError=ref('');
const socketLabels:Record<string,string>={connecting:'连接中',connected:'已连接',reconnecting:'重连中',offline:'网络离线',closed:'已断开',paused:'后台暂停',disabled:'后端未启用'};
let connection:ReturnType<typeof createLiveConnection>|null=null;
function visibilityChanged(){connection?.visibilityChanged();}
function setSocket(){if(socketEnabled.value) auto.value=false;connection?.setEnabled(socketEnabled.value);}
function setPolling(){if(auto.value){socketEnabled.value=false;connection?.setEnabled(false);}}
let epoch = 0, liveEpoch = 0, tokenEpoch = 0;
let timer: ReturnType<typeof setInterval> | undefined;
function validRows(value: unknown): boolean { return Array.isArray(value); }
async function loadCharts() {
 const version = ++epoch;loading.value = true; const params = {time_range:props.range,platform:props.platform || undefined};
 const results = await Promise.allSettled([opsAPI.getLatencyHistogram(params),opsAPI.getErrorDistribution(params),opsAPI.getErrorTrend(params)]);
 if(version !== epoch) return;
 const names=['latency','distribution','trend'];
 results.forEach((result,index) => {
  const name=names[index]!;
  if(result.status === 'rejected') {errors.value[name]=adminError(result.reason,'统计读取失败');return;}
  const data = result.value;
  const rows = index === 0 ? (data as OpsLatencyHistogramResponse)?.buckets : index === 1 ? (data as OpsErrorDistributionResponse)?.items : (data as OpsErrorTrendResponse)?.points;
  if(!validRows(rows)) {errors.value[name]='统计响应不完整';return;}
  errors.value[name]='';
  if(index===0) latency.value=data as OpsLatencyHistogramResponse;else if(index===1) distribution.value=data as OpsErrorDistributionResponse;else trend.value=data as OpsErrorTrendResponse;
 });loading.value=false;
}
async function loadLive() {
 if(liveLoading.value) return;const version=++liveEpoch;liveLoading.value=true;
 try {
  const data=await opsAPI.getRealtimeTrafficSummary('1min',props.platform || undefined);
  if(version !== liveEpoch) return;
  if(!data || typeof data.enabled !== 'boolean' || (data.enabled && (!data.summary || !Number.isFinite(data.summary.qps?.current) || !Number.isFinite(data.summary.tps?.current)))) throw new Error('实时统计响应无效');
  realtime.value=data;errors.value.live='';updated.value=new Date().toLocaleTimeString();
 } catch(err) {if(version === liveEpoch) errors.value.live=adminError(err,'实时统计读取失败，保留上次快照');}
 finally {if(version === liveEpoch) liveLoading.value=false;}
}
async function loadTokens() {
 if(props.showTokens===false)return;
 const version=++tokenEpoch;tokenLoading.value=true;
 try {
  const data=await opsAPI.getOpenAITokenStats({time_range:tokenRange.value,platform:'openai',page:tokenPage.value,page_size:25});
  if(version !== tokenEpoch) return;
  if(!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw new Error('Token统计响应无效');
  if(tokenPage.value>1 && (tokenPage.value-1)*25>=data.total){tokenPage.value=Math.max(1,Math.ceil(data.total/25));return await loadTokens();}
  tokens.value=data;errors.value.tokens='';
 } catch(err) {if(version === tokenEpoch) errors.value.tokens=adminError(err,'Token统计读取失败');}
 finally {if(version===tokenEpoch)tokenLoading.value=false;}
}
function refresh() {void loadCharts();void loadLive();void loadTokens();}
function poll() { if(auto.value && !document.hidden && !liveLoading.value) void loadLive(); }
function width(value: number, total: number) {return Math.min(100,Math.max(0,total>0?value/total*100:0))+'%';}
function fmt(value: number | null | undefined) {return typeof value === 'number' && Number.isFinite(value)?value.toFixed(2):'—';}
watch(() => [props.platform,props.range],()=>{epoch++;liveEpoch++;tokenEpoch++;liveLoading.value=false;latency.value=null;distribution.value=null;trend.value=null;realtime.value=null;updated.value='';errors.value={};refresh();});
watch(()=>props.showTokens,value=>{tokenEpoch++;tokenLoading.value=false;if(value===false){tokens.value=null;errors.value.tokens='';}else void loadTokens();});
watch(()=>props.refreshRevision,()=>refresh());
onMounted(()=>{connection=createLiveConnection({visible:()=>!document.hidden,status:value=>{socketStatus.value=value;},refresh:()=>{void loadLive();},error:value=>{socketError.value=value;}});document.addEventListener('visibilitychange',visibilityChanged);refresh();timer=setInterval(poll,5000);});
onUnmounted(()=>{epoch++;liveEpoch++;tokenEpoch++;clearInterval(timer);connection?.dispose();connection=null;document.removeEventListener('visibilitychange',visibilityChanged);});
</script>
<template>
 <section class="analysis space-y-3">
  <div class="flex flex-wrap gap-2"><h3>分布与实时统计</h3><MacButton size="sm" :disabled="loading || tokenLoading || liveLoading" @click="refresh">刷新统计</MacButton></div>
  <div class="admin-card p-3 space-y-2"><h4>实时吞吐 · 最近1分钟</h4><label><input v-model="auto" type="checkbox" @change="setPolling" />每5秒刷新（后台标签暂停）</label><label><input v-model="socketEnabled" type="checkbox" @change="setSocket" />WebSocket推送刷新</label><div v-if="socketEnabled" class="flex flex-wrap gap-2"><span>{{ socketLabels[socketStatus] || socketStatus }}（连接成功不等于统计有效）</span><MacButton size="sm" @click="connection?.reconnect()">重新连接</MacButton></div><p v-if="socketError && socketEnabled" role="alert">{{ socketError }}</p><p v-if="errors.live" role="alert">{{ errors.live }}</p>
   <p v-if="realtime && !realtime.enabled">后端未启用实时统计</p>
   <table v-if="realtime?.enabled && realtime.summary" class="admin-table"><thead><tr><th>指标</th><th>当前</th><th>峰值</th><th>平均</th></tr></thead><tbody><tr v-for="key in (['qps','tps'] as const)" :key="key"><th>{{ key.toUpperCase() }}</th><td>{{ fmt(realtime.summary[key].current) }}</td><td>{{ fmt(realtime.summary[key].peak) }}</td><td>{{ fmt(realtime.summary[key].avg) }}</td></tr></tbody></table><p v-if="updated">快照读取于 {{ updated }}</p><p v-else-if="!errors.live">{{ liveLoading ? '读取中…' : '尚无实时样本' }}</p>
  </div>
  <div class="admin-card p-3"><h4>请求延迟分布</h4><p v-if="errors.latency" role="alert">{{ errors.latency }}</p><p v-if="latency">共 {{ latency.total_requests }} 个请求</p>
   <div v-for="bucket in latency?.buckets || []" :key="bucket.range" class="distribution-row"><span>{{ bucket.range }}</span><div class="bar-track"><div :style="{width:width(bucket.count,latency?.total_requests || 0)}" /></div><span>{{ bucket.count }}</span></div><p v-if="latency && !latency.buckets.length">暂无延迟样本</p>
  </div>
  <div class="admin-card p-3"><h4>错误状态码分布</h4><p v-if="errors.distribution" role="alert">{{ errors.distribution }}</p>
   <div v-for="item in distribution?.items || []" :key="item.status_code" class="distribution-row"><span>HTTP {{ item.status_code }}</span><div class="bar-track"><div :style="{width:width(item.total,distribution?.total || 0)}" /></div><span>{{ item.total }} · SLA {{ item.sla }} · 业务限制 {{ item.business_limited }}</span></div><p v-if="distribution && !distribution.items.length">暂无错误样本</p>
  </div>
  <div class="admin-card p-3"><h4>错误趋势</h4><p v-if="errors.trend" role="alert">{{ errors.trend }}</p><div v-for="point in trend?.points || []" :key="point.bucket_start" class="distribution-row"><time>{{ point.bucket_start }}</time><div class="bar-track"><div :style="{width:width(point.error_count_sla,Math.max(1,point.error_count_total))}" /></div><span>总计 {{ point.error_count_total }} · SLA {{ point.error_count_sla }} · 429 {{ point.upstream_429_count }} · 529 {{ point.upstream_529_count }}</span></div><p class="text-xs">条形显示每个时间桶内 SLA 错误占全部错误的比例。</p></div>
  <div v-if="showTokens!==false" class="admin-card p-3"><h4>OpenAI Token统计 · 按模型</h4><label>时间<select v-model="tokenRange" @change="tokenPage=1;loadTokens()"><option value="30m">30分钟</option><option value="1h">1小时</option><option value="1d">1天</option><option value="15d">15天</option><option value="30d">30天</option></select></label><p v-if="errors.tokens" role="alert">{{ errors.tokens }}</p>
   <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>模型</th><th>请求</th><th>输出Token</th><th>平均Token/秒</th><th>平均首字（ms）</th><th>平均耗时（ms）</th></tr></thead><tbody><tr v-for="item in tokens?.items || []" :key="item.model"><td>{{ item.model }}</td><td>{{ item.request_count }}</td><td>{{ item.total_output_tokens }}</td><td>{{ fmt(item.avg_tokens_per_sec) }}</td><td>{{ fmt(item.avg_first_token_ms) }}</td><td>{{ fmt(item.avg_duration_ms) }}</td></tr></tbody></table></div><p v-if="tokens && !tokens.items.length">暂无模型样本</p>
   <div class="flex flex-wrap gap-2"><MacButton :disabled="tokenLoading || tokenPage<=1" @click="tokenPage--;loadTokens()">上一页</MacButton><span>{{ tokenPage }} · 共 {{ tokens?.total ?? '—' }} 项</span><MacButton :disabled="tokenLoading || !!errors.tokens || !tokens || tokenPage*25>=tokens.total" @click="tokenPage++;loadTokens()">下一页</MacButton></div>
  </div>
 </section>
</template>
<style scoped>h3,h4 {font-weight:600;} .distribution-row {display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 0;font-size:12px;} .bar-track {flex:1;min-width:60px;height:9px;background:var(--border-color);border-radius:4px;overflow:hidden;} .bar-track div {height:100%;background:var(--accent-color,#007aff);} label {display:flex;gap:8px;align-items:center;} select {background:var(--window-bg-solid);color:var(--text-primary);padding:6px;border-radius:6px;}</style>
