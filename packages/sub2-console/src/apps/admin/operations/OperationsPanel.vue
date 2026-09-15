<script setup lang="ts">
import RecordDetails from './RecordDetails.vue';
import AdvancedSettingsSheet from './AdvancedSettingsSheet.vue';
const advancedSettingsOpen=ref(false);
import TrafficAnalysis from './TrafficAnalysis.vue';
import CapacityPanel from './CapacityPanel.vue';
import AlertSettingsSheet from './AlertSettingsSheet.vue';
const alertSettings = ref<'email' | 'runtime' | null>(null);
import LogMaintenanceSheet from './LogMaintenanceSheet.vue';
const logMaintenance = ref<{ platform?: string; level?: string; q?: string } | null>(null);
function openLogMaintenance() { logMaintenance.value = { platform: platform.value || undefined, level: level.value || undefined, q: query.value || undefined }; }
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import { opsAPI, type AlertRule, type AlertEvent, type OpsErrorLog, type OpsErrorDetail,
  type OpsAdvancedSettings, type OpsSystemLog, type OpsRequestDetail, type OpsThroughputTrendPoint, type OpsConcurrencyStatsResponse } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
import AdminFeedback from '../AdminFeedback.vue';
import { opsPlatforms, optionalGroupId } from './platforms';
type Tab = 'requests' | 'errors' | 'upstream' | 'logs' | 'rules' | 'events' | 'traffic';
const props = defineProps<{ tab: Tab; preferences?: OpsAdvancedSettings | null }>();
const emit=defineEmits<{preferences:[value:OpsAdvancedSettings]}>();
const page = ref(1), total = ref(0), loading = ref(false), error = ref(''), notice = ref('');
const query = ref(''), platform = ref(''), range = ref<'5m' | '30m' | '1h' | '6h' | '24h'>('1h');
const groupId = ref('');
const groupFilterVisible = computed(() => ['requests', 'errors', 'upstream', 'events'].includes(props.tab));
const status = ref(''), level = ref(''), kind = ref<'all' | 'success' | 'error'>('all');
const rows = ref<Array<OpsErrorLog | OpsSystemLog | OpsRequestDetail>>([]);
const rules = ref<AlertRule[]>([]), events = ref<AlertEvent[]>([]), points = ref<OpsThroughputTrendPoint[]>([]);
const concurrency = ref<OpsConcurrencyStatsResponse | null>(null);
const cursors = ref<Array<{ before_fired_at: string; before_id: number } | undefined>>([undefined]);
const hasMoreEvents = ref(false);
let epoch = 0, detailEpoch = 0;
const analysisRevision=ref(0);let autoTimer:ReturnType<typeof setInterval>|undefined;let lastAuto=Date.now();
function autoRefresh(){const p=props.preferences;if(!p?.auto_refresh_enabled||loading.value||busy.value||draft.value||pending.value||document.hidden)return;const seconds=p.auto_refresh_interval_seconds;if(!Number.isFinite(seconds)||seconds<1)return;if(Date.now()-lastAuto>=seconds*1000){lastAuto=Date.now();void load();}}
onMounted(()=>{autoTimer=setInterval(autoRefresh,1000);});

const detail = ref<Record<string, unknown> | null>(null), detailOpen = ref(false), detailLoading = ref(false), detailError = ref('');
const detailSource = ref<{ id: number; tab: Tab } | null>(null);
const linked = ref<OpsErrorDetail[]>([]), linkedPage = ref(1), linkedTotal = ref<number | null>(null), linkedLoading = ref(false), linkedError = ref('');
const silence = ref<{ rule_id: number; platform: string; group: string; region: string; minutes: number; reason: string } | null>(null), silenceError = ref('');
const draft = ref<AlertRule | null>(null), filtersText = ref('{}'), formError = ref(''), busy = ref(false);
const rulePlatform = ref(''), ruleGroup = ref('');
const pending = ref<{ title: string; action: () => Promise<unknown> } | null>(null);
const metrics = [
  ['success_rate','成功率'], ['error_rate','错误率'], ['upstream_error_rate','上游错误率'],
  ['cpu_usage_percent','CPU 使用率'], ['memory_usage_percent','内存使用率'], ['concurrency_queue_depth','并发队列深度'],
  ['group_available_accounts','分组可用账号数'], ['group_available_ratio','分组可用账号比例'],
  ['group_rate_limit_ratio','分组限流比例'], ['account_rate_limited_count','限流账号数'],
  ['account_error_count','异常账号数'], ['account_error_ratio','异常账号比例'],
  ['account_temp_unscheduled_count','临时不可调度账号数'], ['overload_account_count','过载账号数'],
] as const;
const maxQps = computed(() => Math.max(1, ...points.value.map(p => p.qps)));
function metricLabel(metric: string) { return metrics.find(m => m[0] === metric)?.[1] || metric; }
function parameters() { return { page: page.value, page_size: 25, time_range: range.value, platform: platform.value || undefined, q: query.value || undefined, ...(groupFilterVisible.value ? { group_id: optionalGroupId(groupId.value) } : {}) }; }
async function load() {
  const version = ++epoch; loading.value = true; error.value = '';
  const tab = props.tab;
  try {
    if (tab === 'rules') {
      const data = await opsAPI.listAlertRules(); if (!Array.isArray(data)) throw new Error('告警规则响应无效'); if (version === epoch) rules.value = data;
    } else if (tab === 'events') {
      const data = await opsAPI.listAlertEvents({ time_range: range.value, platform: platform.value || undefined, group_id: optionalGroupId(groupId.value),
        status: status.value || undefined, severity: level.value || undefined, limit: 26, ...cursors.value[page.value - 1] });
      if (version !== epoch) return;
      if (!Array.isArray(data)) throw new Error('告警事件响应无效');
      events.value = data.slice(0, 25); hasMoreEvents.value = data.length > 25;
    } else if (tab === 'traffic') {
      const result = await Promise.allSettled([opsAPI.getThroughputTrend(parameters()), opsAPI.getConcurrencyStats(platform.value || undefined)]);
      if (version !== epoch) return;
      const trendOK = result[0].status === 'fulfilled' && Array.isArray(result[0].value?.points);
      const concurrencyOK = result[1].status === 'fulfilled' && typeof result[1].value?.enabled === 'boolean';
      if (trendOK && result[0].status === 'fulfilled') points.value = result[0].value.points;
      if (concurrencyOK && result[1].status === 'fulfilled') concurrency.value = result[1].value;
      if (!trendOK || !concurrencyOK) error.value = '趋势或并发数据未完整加载，请重试。';
    } else {
      const params = parameters();
      const data = tab === 'logs' ? await opsAPI.listSystemLogs({ ...params, level: level.value || undefined })
        : tab === 'requests' ? await opsAPI.listRequestDetails({ ...params, kind: kind.value })
        : await (tab === 'upstream' ? opsAPI.listUpstreamErrors : opsAPI.listRequestErrors)({ ...params, resolved: status.value || undefined });
      if (version !== epoch) return;
      if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0) throw new Error('列表响应无效，请确认后端支持该运维入口');
      total.value = data.total;
      if (page.value > 1 && (page.value - 1) * 25 >= data.total) { page.value = Math.max(1, Math.ceil(data.total / 25)); return await load(); }
      rows.value = data.items;
    }
  } catch (err) { if (version === epoch) error.value = adminError(err, '数据读取失败。此后端可能未启用或尚不支持该功能，请重试。'); }
  finally { if (version === epoch) { loading.value = false;lastAuto=Date.now();if(tab==='traffic')analysisRevision.value++; } }
}
function search() { page.value = 1; cursors.value = [undefined]; void load(); }
function next() {
  if (props.tab === 'events') {
    const last = events.value[events.value.length - 1]; if (!last || !hasMoreEvents.value) return;
    cursors.value[page.value] = { before_fired_at: last.fired_at, before_id: last.id };
  }
  page.value++; void load();
}
function closeDetail() { detailEpoch++; detailOpen.value = false; detail.value = null; detailSource.value = null; linked.value = []; linkedPage.value = 1; linkedTotal.value = null; linkedLoading.value = false; linkedError.value = ''; }
async function loadLinked() {
  const source = detailSource.value; if (!source || source.tab !== 'errors' || linkedLoading.value) return;
  const version = detailEpoch; linkedLoading.value = true; linkedError.value = '';
  try {
    const data = await opsAPI.listRequestErrorUpstreamErrors(source.id, { page: linkedPage.value, page_size: 25 }, { include_detail: true });
    if (version !== detailEpoch) return;
    if (!Array.isArray(data.items) || !Number.isSafeInteger(data.total)) throw new Error('关联上游错误响应无效');
    linked.value = data.items; linkedTotal.value = data.total;
  } catch (err) { if (version === detailEpoch) linkedError.value = adminError(err, '关联上游错误读取失败'); }
  finally { if (version === detailEpoch) linkedLoading.value = false; }
}
function openSilence(event: AlertEvent) {
  silenceError.value = '';
  silence.value = { rule_id: event.rule_id, platform: String(event.dimensions?.platform ?? ''), group: String(event.dimensions?.group_id ?? ''),
    region: String(event.dimensions?.region ?? ''), minutes: 60, reason: '' };
}
async function saveSilence() {
  if (!silence.value || busy.value) return;
  silenceError.value = '';
  try {
    const value = silence.value, group = value.group ? Number(value.group) : undefined;
    if (group !== undefined && (!Number.isSafeInteger(group) || group < 1)) throw new Error('分组 ID 应为正整数');
    if (!Number.isFinite(value.minutes) || value.minutes < 1 || value.minutes > 1440) throw new Error('静默时长应介于1和1440分钟');
    busy.value = true;
    await opsAPI.createAlertSilence({ rule_id: value.rule_id, platform: value.platform, group_id: group, region: value.region || undefined,
      until: new Date(Date.now() + value.minutes * 60000).toISOString(), reason: value.reason.trim() || undefined });
    silence.value = null; notice.value = '已设置告警静默，到期后自动恢复通知';
  } catch (err) { silenceError.value = adminError(err, '静默设置失败'); }
  finally { busy.value = false; }
}
async function readDetail() {
  const source = detailSource.value; if (!source) return;
  const version = ++detailEpoch; detailLoading.value = true; detailError.value = '';
  try {
    const data = source.tab === 'events' ? await opsAPI.getAlertEvent(source.id)
      : source.tab === 'upstream' ? await opsAPI.getUpstreamErrorDetail(source.id) : await opsAPI.getRequestErrorDetail(source.id);
    if (version !== detailEpoch) return;
    detail.value = { ...data };
  } catch (err) { if (version === detailEpoch) detailError.value = adminError(err, '详情读取失败'); }
  finally { if (version === detailEpoch) detailLoading.value = false; }
}
function showRow(row: OpsErrorLog | OpsSystemLog | OpsRequestDetail) {
  closeDetail(); detailOpen.value = true; detailError.value = ''; detailLoading.value = false;
  if (props.tab === 'errors' || props.tab === 'upstream') { detailSource.value = { id: (row as OpsErrorLog).id, tab: props.tab }; void readDetail(); }
  else if (props.tab === 'requests' && (row as OpsRequestDetail).error_id) {
    detailSource.value = { id: (row as OpsRequestDetail).error_id!, tab: 'errors' }; void readDetail();
  } else detail.value = { ...row };
}
function showEvent(event: AlertEvent) { closeDetail(); detailOpen.value = true; detailSource.value = { id: event.id, tab: 'events' }; void readDetail(); }
function edit(rule?: AlertRule) {
  formError.value = '';
  draft.value = rule ? JSON.parse(JSON.stringify(rule)) : { name: '', enabled: true, metric_type: 'error_rate', operator: '>', threshold: 5,
    window_minutes: 5, sustained_minutes: 1, severity: 'warning', cooldown_minutes: 30, notify_email: false };
  filtersText.value = JSON.stringify(draft.value?.filters ?? {}, null, 2);
  rulePlatform.value = String(draft.value?.filters?.platform ?? ''); ruleGroup.value = String(draft.value?.filters?.group_id ?? '');
}
async function saveRule() {
  if (!draft.value || busy.value) return;
  formError.value = '';
  try {
    const value = draft.value;
    if (!value.name.trim()) throw new Error('请输入规则名称');
    for (const key of ['threshold','window_minutes','sustained_minutes','cooldown_minutes'] as const) {
      if (!Number.isFinite(value[key]) || value[key] < 0 || (key === 'window_minutes' && value[key] < 1)) throw new Error('阈值和时间窗口必须为有效非负数，窗口至少1分钟');
    }
    const filters = JSON.parse(filtersText.value);
    if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new Error('筛选范围必须为 JSON 对象');
    if (rulePlatform.value) filters.platform = rulePlatform.value; else delete filters.platform;
    if (ruleGroup.value) {
      const group = Number(ruleGroup.value);
      if (!Number.isSafeInteger(group) || group < 1) throw new Error('分组 ID 应为正整数');
      filters.group_id = group;
    } else delete filters.group_id;
    if (value.metric_type.startsWith('group_') && !filters.group_id) throw new Error('分组指标必须指定分组 ID');
    const payload: AlertRule = { name: value.name.trim(), description: value.description, enabled: value.enabled,
      metric_type: value.metric_type, operator: value.operator, threshold: value.threshold, window_minutes: value.window_minutes,
      sustained_minutes: value.sustained_minutes, severity: value.severity, cooldown_minutes: value.cooldown_minutes, notify_email: value.notify_email, filters };
    busy.value = true;
    if (value.id != null) await opsAPI.updateAlertRule(value.id, payload); else await opsAPI.createAlertRule(payload);
    draft.value = null; notice.value = '告警规则已保存'; await load();
  } catch (err) { formError.value = adminError(err, '规则保存失败'); }
  finally { busy.value = false; }
}
async function execute() {
  if (!pending.value || busy.value) return;
  busy.value = true; error.value = '';
  try { await pending.value.action(); pending.value = null; closeDetail(); notice.value = '操作已完成'; await load(); }
  catch (err) { error.value = adminError(err, '操作失败，请重试'); }
  finally { busy.value = false; }
}
function resolveError() {
  const source = detailSource.value, value = detail.value as unknown as OpsErrorDetail;
  if (!source || !value || !['errors','upstream'].includes(source.tab)) return;
  pending.value = { title: value.resolved ? '重新打开此错误？' : '标记此错误已解决？',
    action: () => (source.tab === 'upstream' ? opsAPI.updateUpstreamErrorResolved : opsAPI.updateRequestErrorResolved)(source.id, !value.resolved) };
}
watch(() => props.tab, () => {
  closeDetail(); rows.value = []; events.value = []; rules.value = []; points.value = []; concurrency.value = null;
  status.value = ''; level.value = ''; query.value = ''; notice.value = ''; total.value = 0; search();
}, { immediate: true });
onUnmounted(() => { epoch++; detailEpoch++;clearInterval(autoTimer); });
</script>
<template>
  <section class="operations-panel admin-content flex-1 overflow-y-auto p-4 space-y-3">
    <form class="admin-filters flex flex-wrap gap-2" @submit.prevent="search">
      <template v-if="tab !== 'rules'">
        <label>时间<select v-model="range"><option value="5m">5分钟</option><option value="30m">30分钟</option><option value="1h">1小时</option><option value="6h">6小时</option><option value="24h">24小时</option></select></label>
        <label>平台<select v-model="platform" aria-label="筛选平台"><option value="">全部</option><option v-for="[id, name] in opsPlatforms" :key="id" :value="id">{{ name }}</option></select></label>
        <label v-if="groupFilterVisible">分组编号<input v-model="groupId" type="number" min="1" step="1" placeholder="全部" /></label>
        <label v-if="['errors','upstream'].includes(tab)">状态<select v-model="status"><option value="">全部</option><option value="false">未解决</option><option value="true">已解决</option></select></label>
        <label v-if="tab === 'events'">状态<select v-model="status"><option value="">全部</option><option value="firing">告警中</option><option value="resolved">已恢复</option><option value="manual_resolved">手动解决</option></select></label>
        <label v-if="tab === 'logs'">级别<select v-model="level"><option value="">全部</option><option>debug</option><option>info</option><option>warn</option><option>error</option></select></label>
        <label v-if="tab === 'events'">级别<select v-model="level"><option value="">全部</option><option>info</option><option>warning</option><option>critical</option></select></label>
        <label v-if="tab === 'requests'">请求<select v-model="kind"><option value="all">全部</option><option value="success">成功</option><option value="error">错误</option></select></label>
        <label v-if="!['events','traffic'].includes(tab)">搜索<input v-model="query" placeholder="请求或消息关键词" /></label>
      </template>
      <MacButton type="submit" size="sm" :disabled="loading">{{ loading ? '读取中…' : '查询 / 刷新' }}</MacButton>
      <MacButton v-if="tab === 'logs'" size="sm" @click="openLogMaintenance">运行配置与清理</MacButton>
      <MacButton v-if="tab === 'rules'" variant="primary" size="sm" @click="edit()">新增告警规则</MacButton>
    </form>
    <MacButton size="sm" @click="advancedSettingsOpen=true">运维高级设置</MacButton>
    <AdvancedSettingsSheet v-if="advancedSettingsOpen" @close="advancedSettingsOpen=false" @saved="emit('preferences',$event)" />
    <AdminFeedback :loading="loading" :error="error" :notice="notice" @retry="load" @dismiss="notice = ''" />
    <template v-if="tab === 'rules'">
      <p v-if="!loading && !error && !rules.length">暂无告警规则，新增规则后由后端评估阈值。</p>
      <div v-for="rule in rules" :key="rule.id" class="admin-card p-3 space-y-2">
        <div class="flex flex-wrap justify-between gap-2"><strong>{{ rule.name }}</strong><span>{{ rule.enabled ? '已启用' : '已停用' }} · {{ rule.severity }}</span></div>
        <p>{{ metricLabel(rule.metric_type) }} {{ rule.operator }} {{ rule.threshold }} · 窗口 {{ rule.window_minutes }} 分钟 · 持续 {{ rule.sustained_minutes }} 分钟</p>
        <div class="flex flex-wrap gap-2"><MacButton size="sm" @click="edit(rule)">编辑</MacButton><MacButton size="sm" :disabled="busy" @click="pending = { title: rule.enabled ? '停用规则？' : '启用规则？', action: () => opsAPI.updateAlertRule(rule.id!, { enabled: !rule.enabled }) }">{{ rule.enabled ? '停用' : '启用' }}</MacButton><MacButton size="sm" variant="destructive" @click="pending = { title: '永久删除告警规则？', action: () => opsAPI.deleteAlertRule(rule.id!) }">删除</MacButton></div>
      </div>
    </template>
    <template v-else-if="tab === 'traffic'">
      <TrafficAnalysis :platform="platform" :range="range" :show-tokens="preferences?.display_openai_token_stats" :refresh-revision="analysisRevision" />
      <CapacityPanel :platform="platform" :refresh-revision="analysisRevision" />
      <div class="admin-card p-3"><h3>吞吐趋势</h3><p v-if="!loading && !error && !points.length">暂无趋势样本</p>
        <div v-for="point in points" :key="point.bucket_start" class="trend-row"><time>{{ point.bucket_start }}</time><meter :value="point.qps" :max="maxQps" min="0" :aria-label="point.bucket_start + ' QPS'" /><span>{{ point.qps.toFixed(2) }} QPS · {{ point.tps.toFixed(2) }} TPS</span></div>
      </div>
      <div class="admin-card p-3"><h3>并发与排队</h3><p v-if="concurrency && !concurrency.enabled">后端未启用并发统计</p>
        <template v-if="concurrency?.enabled"><div v-for="(entries, scope) in { 平台: concurrency.platform, 分组: concurrency.group, 账号: concurrency.account }" :key="scope"><h4>{{ scope }}</h4><div v-for="(item, id) in entries" :key="id" class="flex flex-wrap justify-between border-b py-2"><span>{{ scope }} #{{ id }}</span><span>使用 {{ item.current_in_use }} / {{ item.max_capacity }} · 排队 {{ item.waiting_in_queue }} · {{ item.load_percentage }}%</span></div></div></template>
      </div>
    </template>
    <template v-else-if="tab === 'events'">
      <p v-if="!loading && !error && !events.length">没有符合条件的告警事件。</p>
      <div v-for="event in events" :key="event.id" class="admin-card p-3 space-y-2"><strong>{{ event.title || '告警 #' + event.id }}</strong><p>{{ event.fired_at }} · {{ event.status }} · {{ event.severity }}</p><p>{{ event.description }}</p><div class="flex flex-wrap gap-2"><MacButton size="sm" @click="showEvent(event)">详情</MacButton><MacButton size="sm" @click="openSilence(event)">静默通知</MacButton><MacButton v-if="event.status === 'firing'" size="sm" @click="pending = { title: '手动解决此告警？', action: () => opsAPI.updateAlertEventStatus(event.id, 'manual_resolved') }">标记已解决</MacButton></div></div>
    </template>
    <template v-else>
      <div class="admin-card admin-table-scroll"><table class="admin-table"><thead><tr><th>时间 / 请求</th><th>平台 / 模型</th><th>状态 / 级别</th><th>消息</th><th>操作</th></tr></thead><tbody>
        <tr v-for="(row, index) in rows" :key="index"><td>{{ row.created_at }}<div class="break-all">{{ row.request_id || '—' }}</div></td><td>{{ row.platform || '—' }}<div>{{ row.model || '—' }}</div></td><td>{{ 'level' in row ? row.level : row.status_code ?? '—' }}</td><td class="message-cell">{{ row.message || '—' }}</td><td><MacButton size="sm" @click="showRow(row)">详情</MacButton></td></tr>
        <tr v-if="!loading && !error && !rows.length"><td colspan="5">没有符合条件的记录。</td></tr>
      </tbody></table></div>
    </template>
    <div v-if="!['rules','traffic'].includes(tab)" class="admin-footer flex flex-wrap gap-3"><span>{{ tab === 'events' ? '按告警触发时间翻页' : '共 ' + total + ' 条' }}</span><MacButton size="sm" :disabled="loading || page <= 1" @click="page--; load()">上一页</MacButton><span>第 {{ page }} 页</span><MacButton size="sm" :disabled="loading || !!error || (tab === 'events' ? !hasMoreEvents : page * 25 >= total)" @click="next">下一页</MacButton></div>
    <div v-if="tab === 'rules' || tab === 'events'" class="flex flex-wrap gap-2"><MacButton @click="alertSettings = 'email'">邮件告警配置</MacButton><MacButton @click="alertSettings = 'runtime'">告警运行参数</MacButton></div>
    <AlertSettingsSheet v-if="alertSettings" :mode="alertSettings" :key="alertSettings" @close="alertSettings = null" />
    <LogMaintenanceSheet v-if="logMaintenance" :filters="logMaintenance" @close="logMaintenance = null" @changed="load" />
    <MacSheet :show="detailOpen" title="记录详情" @close="closeDetail"><AdminFeedback :loading="detailLoading" :error="detailError" @retry="readDetail" /><RecordDetails v-if="detail" :record="detail" />
      <section v-if="detail && detailSource?.tab === 'errors'" class="mt-4 space-y-2">
        <MacButton size="sm" :disabled="linkedLoading" @click="loadLinked">{{ linkedLoading ? '读取中…' : '查看关联上游错误' }}</MacButton>
        <p v-if="linkedError" role="alert">{{ linkedError }}</p><p v-if="linkedTotal === 0">此请求没有关联上游错误。</p>
        <details v-for="row in linked" :key="row.id"><summary>上游错误 #{{ row.id }} · {{ row.status_code }} · {{ row.account_name }}</summary><RecordDetails :record="row" /></details>
        <div v-if="linkedTotal != null && linkedTotal > 25" class="flex flex-wrap gap-2"><MacButton size="sm" :disabled="linkedLoading || linkedPage <= 1" @click="linkedPage--; loadLinked()">上一页</MacButton><span>{{ linkedPage }} · 共 {{ linkedTotal }} 条</span><MacButton size="sm" :disabled="linkedLoading || linkedPage * 25 >= linkedTotal" @click="linkedPage++; loadLinked()">下一页</MacButton></div>
      </section><template #footer><MacButton v-if="detail && detailSource && ['errors','upstream'].includes(detailSource.tab)" @click="resolveError">{{ detail.resolved ? '重新打开' : '标记已解决' }}</MacButton><MacButton @click="closeDetail">关闭</MacButton></template></MacSheet>
    <MacSheet protect-changes :show="!!draft" :title="draft?.id ? '编辑告警规则' : '新增告警规则'" :loading="busy" @close="draft = null">
      <form v-if="draft" id="ops-rule-form" class="rule-form" @submit.prevent="saveRule">
        <label>名称<input v-model="draft.name" required maxlength="200" /></label><label>说明<textarea v-model="draft.description" /></label>
        <label>指标<select v-model="draft.metric_type"><option v-for="metric in metrics" :key="metric[0]" :value="metric[0]">{{ metric[1] }}</option></select></label>
        <label>比较<select v-model="draft.operator"><option v-for="op in ['>','>=','<','<=','==','!=']" :key="op">{{ op }}</option></select></label>
        <label>阈值<input v-model.number="draft.threshold" type="number" min="0" step="any" required /></label>
        <label>窗口（分钟）<input v-model.number="draft.window_minutes" type="number" min="1" required /></label><label>持续（分钟）<input v-model.number="draft.sustained_minutes" type="number" min="0" required /></label><label>冷却（分钟）<input v-model.number="draft.cooldown_minutes" type="number" min="0" required /></label>
        <label>级别<select v-model="draft.severity"><option value="info">信息</option><option value="warning">警告</option><option value="critical">严重</option></select></label>
        <label><input v-model="draft.enabled" type="checkbox" />启用规则</label><label><input v-model="draft.notify_email" type="checkbox" />发送邮件通知</label>
        <label>适用平台<select v-model="rulePlatform"><option value="">全部平台</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option></select></label>
        <label>分组 ID（分组指标必填）<input v-model="ruleGroup" type="number" min="1" /></label>
        <details><summary>高级筛选范围（保留官方维度）</summary><label>筛选对象 JSON<textarea v-model="filtersText" rows="5" spellcheck="false" /></label></details>
        <p v-if="formError" role="alert">{{ formError }}</p>
      </form><template #footer="{ close }"><MacButton :disabled="busy" @click="close">取消</MacButton><MacButton variant="primary" :disabled="busy" @click="saveRule">保存规则</MacButton></template>
    </MacSheet>
    <MacSheet protect-changes :show="!!silence" title="静默告警通知" :loading="busy" @close="silence = null">
      <form v-if="silence" class="rule-form" @submit.prevent="saveSilence">
        <p>静默规则 #{{ silence.rule_id }} 的指定范围；不会将事件标记为已解决。</p>
        <label>平台<select v-model="silence.platform"><option value="">全部</option><option v-for="[id, name] in opsPlatforms" :key="id" :value="id">{{ name }}</option></select></label>
        <label>分组 ID（可选）<input v-model="silence.group" type="number" min="1" /></label><label>区域（可选）<input v-model="silence.region" /></label>
        <label>静默时长（分钟）<input v-model.number="silence.minutes" type="number" min="1" max="1440" /></label><label>原因<textarea v-model="silence.reason" /></label><p v-if="silenceError" role="alert">{{ silenceError }}</p>
      </form><template #footer="{ close }"><MacButton :disabled="busy" @click="close">取消</MacButton><MacButton variant="primary" :disabled="busy" @click="saveSilence">确认静默</MacButton></template>
    </MacSheet>
    <MacAlertSheet :show="!!pending" :title="pending?.title || ''" :message="error || '此操作会更新后端记录。'" :loading="busy" confirm-text="确认" @confirm="execute" @cancel="pending = null" />
  </section>
</template>
<style scoped>
.operations-panel { font-size: 12px; }
label { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
input, select, textarea { min-width: 0; max-width: 100%; border: 1px solid var(--border-color); border-radius: 6px; padding: 6px; background: var(--window-bg-solid); color: var(--text-primary); }
.rule-form { display: grid; gap: 12px; }.rule-form label { justify-content: space-between; }.rule-form textarea { width: 100%; }
.message-cell { max-width: 300px; overflow-wrap: anywhere; }.trend-row { display: flex; flex-wrap: wrap; gap: 8px; padding: 6px 0; }.trend-row meter { flex: 1; min-width: 60px; }
</style>
