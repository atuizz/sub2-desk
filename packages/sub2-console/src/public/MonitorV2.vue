<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { MacButton, MacSheet } from '@sub2-mac/core';
import { useAuthStore } from '../stores/auth';
import * as api from '../api/channelMonitorV2';
import type { PublicSettings } from '../types';
import { matrixWindow, readMonitorQuery, writeMonitorQuery, zoomMatrix } from './monitorTimeline';
const props = defineProps<{ settings: PublicSettings & { channel_monitor_hide_user_ranking?: boolean } }>();
const auth = useAuthStore();
const allowed = computed(() => auth.isAuthenticated && props.settings.channel_monitor_enabled && props.settings.channel_monitor_mode === 'v2');
const showThroughput = computed(() => auth.isAdmin || !props.settings.channel_monitor_hide_throughput);
const showUsers = computed(() => auth.isAdmin || !props.settings.channel_monitor_hide_user_ranking);
const initial = readMonitorQuery(typeof window === 'undefined' ? '' : window.location.search, showUsers.value);
const filter = ref<api.MonitorFilter>(initial.filter);
const groupBy = ref<api.MonitorMatrixGroupBy>(initial.groupBy);
const mode = ref<'overall' | 'success' | 'ttft' | 'cache'>(initial.mode);
const view = ref<'pulse' | 'line'>(initial.view);
const tab = ref<'models' | 'errors' | 'users'>(initial.tab);
const autoRefresh = ref(true); const loading = ref(false);
const snapshot = ref<api.MonitorSnapshot | null>(null); const matrix = ref<api.MonitorMatrixResponse | null>(null);
const dimensions = ref<api.MonitorDimensions>({ platforms: [], groups: [], models: [] });
const modelRows = ref<api.MonitorModelRow[]>([]); const errorRows = ref<api.MonitorErrorRow[]>([]); const userRows = ref<api.MonitorUserRow[]>([]);
const errors = ref<Record<string, string>>({});
const selected = ref<{ title: string; bucket: api.MonitorMatrixBucket } | null>(null);
let sequence = 0; let disposed = false; let controller: AbortController | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
const intervalSeconds = computed(() => snapshot.value?.coverage.bootstrap?.active ? 10 : snapshot.value?.config.refresh_interval_seconds === 60 ? 60 : 300);
const groupOptions = computed(() => dimensions.value.groups.filter(item => !filter.value.platforms.length || !item.platform || filter.value.platforms.includes(item.platform)));
const modelOptions = computed(() => dimensions.value.models.filter(item => !filter.value.platforms.length || !item.platform || filter.value.platforms.includes(item.platform)));
const rows = computed(() => (matrix.value?.items || []).filter(row => !groupBy.value.includes('group') || (row.group_id != null && row.group_id > 0)));
const offset = ref(0); const windowSize = ref(60);
const timeline = computed(() => matrixWindow(rows.value, matrix.value?.coverage, offset.value, windowSize.value));
const number = (value: number | null | undefined, suffix = '') => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + suffix;
const percent = (value: number | null | undefined) => value == null ? '—' : number(value * 100, '%');
const healthLabel = (value: string) => ({ healthy: '健康', warning: '警告', critical: '严重', unknown: '样本不足' }[value] || '未知');
function health(bucket: api.MonitorMatrixBucket) {
  const score = mode.value === 'success' ? bucket.health.error_rate_score : mode.value === 'ttft' ? bucket.health.ttft_score : mode.value === 'cache' ? bucket.health.cache_score : bucket.health.score;
  if (score == null && (!bucket.metrics.request_count || mode.value === 'ttft')) return 'unknown';
  if (mode.value === 'ttft' && bucket.metrics.ttft.p50_ms == null) return 'unknown';
  return (mode.value === 'success' ? bucket.health.error_rate : mode.value === 'cache' ? bucket.health.cache : mode.value === 'ttft' ? bucket.health.ttft : bucket.health.overall) || 'unknown';
}
const successRate = (metrics: api.MonitorMetric) => !showThroughput.value || metrics.request_count > 0 ? percent(1 - metrics.error_rate) : '—';
const chart = computed(() => {
  const points = (snapshot.value?.trend || []).map(point => {
    const value = mode.value === 'overall' ? point.health.score : mode.value === 'ttft' ? point.metrics.ttft.p50_ms : mode.value === 'cache' ? point.metrics.cache_rate * 100 : point.metrics.request_count || !showThroughput.value ? (1 - point.metrics.error_rate) * 100 : null;
    return { time: point.bucket_start, value: value != null && Number.isFinite(value) ? value : null };
  });
  const maximum = Math.max(1, ...points.map(point => point.value || 0));
  const segments: string[] = []; let current: string[] = [];
  points.forEach((point, index) => {
    if (point.value == null) { if (current.length) segments.push(current.join(' ')); current = []; }
    else current.push(`${20 + index * 560 / Math.max(1, points.length - 1)},${130 - point.value * 110 / maximum}`);
  });
  if (current.length) segments.push(current.join(' '));
  return { segments, maximum, points };
});
function syncQuery() {
  if (typeof window === 'undefined') return;
  const query = writeMonitorQuery(window.location.search, { filter: filter.value, groupBy: groupBy.value, mode: mode.value, view: view.value, tab: tab.value });
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}${window.location.hash}`);
}
function restoreQuery() {
  const state = readMonitorQuery(window.location.search, showUsers.value);
  filter.value = state.filter; groupBy.value = state.groupBy; mode.value = state.mode; view.value = state.view; tab.value = state.tab;
}
function wheelZoom(event: WheelEvent) {
  if (!event.deltaY || !timeline.value.count) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const next = zoomMatrix(timeline.value.count, timeline.value.begin, windowSize.value, event.deltaY, (event.clientX - rect.left) / Math.max(1, rect.width));
  if (next.size === windowSize.value) return;
  event.preventDefault(); windowSize.value = next.size; offset.value = next.offset;
}
function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
function schedule() {
  stopTimer();
  if (disposed || !allowed.value || !autoRefresh.value || document.hidden) return;
  timer = setTimeout(() => { timer = undefined; if (!loading.value) void reload(); }, intervalSeconds.value * 1000);
}
async function reload(reset = false) {
  const id = ++sequence; controller?.abort(); stopTimer(); controller = new AbortController();
  if (reset) { snapshot.value = null; matrix.value = null; selected.value = null; modelRows.value = []; errorRows.value = []; userRows.value = []; offset.value = 0; }
  if (!allowed.value) dimensions.value = { platforms: [], groups: [], models: [] };
  errors.value = {}; loading.value = false;
  if (disposed || !allowed.value) return;
  loading.value = true;
  const currentFilter: api.MonitorFilter = { ...filter.value, platforms: [...filter.value.platforms], groupIds: [...filter.value.groupIds], models: [...filter.value.models] };
  const activeTab = tab.value === 'users' && !showUsers.value ? 'models' : tab.value;
  const signal = controller.signal; const admin = auth.isAdmin;
  const detailRequest = activeTab === 'models' ? api.getModels(currentFilter, admin, signal) : activeTab === 'errors' ? api.getErrors(currentFilter, admin, signal) : api.getUsers(currentFilter, admin, signal);
  const results = await Promise.allSettled([
    api.getDimensions({ range: currentFilter.range, platforms: [], groupIds: [], models: [] }, admin, signal),
    api.getSnapshot(currentFilter, admin, signal), api.getMatrix(currentFilter, groupBy.value, admin, signal), detailRequest,
  ]);
  if (disposed || id !== sequence) return;
  const labels = ['筛选目录', '汇总', '矩阵', '明细'];
  results.forEach((result, index) => { if (result.status === 'rejected') errors.value[labels[index]] = `${labels[index]}读取失败。刷新可重试；已有内容为上次成功结果。`; });
  if (results[0].status === 'fulfilled') dimensions.value = results[0].value;
  if (results[1].status === 'fulfilled') snapshot.value = results[1].value;
  if (results[2].status === 'fulfilled') matrix.value = results[2].value;
  if (results[3].status === 'fulfilled') {
    if (activeTab === 'models') modelRows.value = results[3].value.items as api.MonitorModelRow[];
    else if (activeTab === 'errors') errorRows.value = results[3].value.items as api.MonitorErrorRow[];
    else userRows.value = results[3].value.items as api.MonitorUserRow[];
  }
  loading.value = false; schedule();
}
function setPlatforms(event: Event) {
  const platforms = Array.from((event.target as HTMLSelectElement).selectedOptions, option => option.value);
  const permitted = (platform?: string) => !platforms.length || !platform || platforms.includes(platform);
  filter.value = { ...filter.value, platforms,
    groupIds: filter.value.groupIds.filter(id => dimensions.value.groups.some(group => group.id === id && permitted(group.platform))),
    models: filter.value.models.filter(name => dimensions.value.models.some(model => model.value === name && permitted(model.platform))) };
}
function clearFilters() { filter.value = { ...filter.value, platforms: [], groupIds: [], models: [] }; }
function drill(row: api.MonitorModelRow) { filter.value = { ...filter.value, platforms: [row.platform], models: [row.model], groupIds: [] }; }
function visibilityChanged() { if (document.hidden) stopTimer(); else if (!loading.value && autoRefresh.value) void reload(); }
watch(() => [JSON.stringify(filter.value), groupBy.value, tab.value, auth.user?.id, auth.token, allowed.value, showUsers.value], () => {
  if (!showUsers.value && tab.value === 'users') tab.value = 'models';
  void reload(true);
}, { immediate: true });
watch(autoRefresh, schedule);
watch(() => [JSON.stringify(filter.value), groupBy.value, mode.value, view.value, tab.value], syncQuery);
onMounted(() => { document.addEventListener('visibilitychange', visibilityChanged); window.addEventListener('popstate', restoreQuery); });
onBeforeUnmount(() => { disposed = true; sequence++; controller?.abort(); stopTimer(); document.removeEventListener('visibilitychange', visibilityChanged); if (typeof window !== 'undefined') window.removeEventListener('popstate', restoreQuery); });
</script>

<template>
  <section class="monitor-v2" aria-label="监控 V2">
    <p v-if="!allowed" class="public-message">当前无法查看监控，请检查登录状态与功能开关。</p>
    <template v-else>
      <div class="public-form">
        <label>时间范围<select aria-label="时间范围" v-model="filter.range"><option value="90m">90 分钟</option><option value="24h">24 小时</option><option value="7d">7 天</option><option value="30d">30 天</option></select></label>
        <label>平台（多选）<select multiple :value="filter.platforms" @change="setPlatforms"><option v-for="item in dimensions.platforms" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
        <label>分组（多选）<select v-model="filter.groupIds" multiple><option v-for="item in groupOptions" :key="item.id" :value="item.id">{{ item.platform }} / {{ item.name }}</option></select></label>
        <label>模型（多选）<select v-model="filter.models" multiple><option v-for="item in modelOptions" :key="`${item.platform}:${item.value}`" :value="item.value">{{ item.label }}</option></select></label>
        <MacButton @click="clearFilters">清除筛选</MacButton><MacButton :disabled="loading" @click="reload()">刷新监控</MacButton>
        <label><span><input v-model="autoRefresh" type="checkbox" /> 自动刷新（{{ intervalSeconds }} 秒）</span></label>
      </div>
      <p v-if="loading" role="status">正在更新监控…</p>
      <p v-for="(message, key) in errors" :key="key" class="public-message public-error" role="alert">{{ message }}</p>
      <template v-if="snapshot">
        <p class="public-message">数据截至 {{ snapshot.coverage.data_through }} · 汇总延迟 {{ number(snapshot.coverage.aggregation_lag_seconds, ' 秒') }}<span v-if="!snapshot.coverage.coverage_complete"> · 数据尚未完整覆盖所选范围</span><span v-if="snapshot.coverage.bootstrap?.active"> · 历史回填 {{ percent(snapshot.coverage.bootstrap.progress_percent / 100) }}</span></p>
        <dl class="public-facts"><dt>整体健康 / 评分</dt><dd>{{ healthLabel(snapshot.health.overall) }} / {{ number(snapshot.health.score) }}</dd><dt>成功率</dt><dd>{{ successRate(snapshot.metrics) }}</dd><dt>首 Token P50 / P90 / P95 / 平均</dt><dd>{{ number(snapshot.metrics.ttft.p50_ms, ' ms') }} / {{ number(snapshot.metrics.ttft.p90_ms, ' ms') }} / {{ number(snapshot.metrics.ttft.p95_ms, ' ms') }} / {{ number(snapshot.metrics.ttft.avg_ms, ' ms') }}</dd><dt>缓存命中率</dt><dd>{{ percent(snapshot.metrics.cache_rate) }}</dd><template v-if="showThroughput"><dt>Token/秒 · RPM</dt><dd>{{ number(snapshot.metrics.tpm / 60) }} · {{ number(snapshot.metrics.rpm) }}</dd></template></dl>
      </template>
      <div class="public-form">
        <label>矩阵分组<select v-model="groupBy"><option value="platform">平台</option><option value="platform_group">平台 / 分组</option><option value="platform_model">平台 / 模型</option><option value="platform_group_model">平台 / 分组 / 模型</option></select></label>
        <label>健康维度<select aria-label="健康维度" v-model="mode"><option value="overall">整体</option><option value="success">成功率</option><option value="ttft">首 Token 延迟</option><option value="cache">缓存</option></select></label>
        <label>展示<select v-model="view"><option value="pulse">状态矩阵</option><option value="line">趋势折线</option></select></label>
      </div>
      <h2>{{ view === 'pulse' ? '状态矩阵' : '时间趋势' }}</h2>
      <template v-if="view === 'pulse'">
        <p v-if="!rows.length && !loading">暂无矩阵记录。</p>
        <div class="public-form"><label>每屏时间格<select v-model.number="windowSize"><option :value="30">30</option><option :value="60">60</option><option :value="120">120</option></select></label><MacButton :disabled="timeline.begin === 0" @click="offset = Math.max(0, timeline.begin - windowSize)">更早</MacButton><MacButton :disabled="timeline.begin + windowSize >= timeline.count" @click="offset = timeline.begin + windowSize">更晚</MacButton><span>{{ timeline.count ? timeline.begin + 1 : 0 }}–{{ Math.min(timeline.count, timeline.begin + windowSize) }} / {{ timeline.count }}</span></div>
        <div class="public-table-wrap"><table class="public-table"><thead><tr><th>平台 / 分组 / 模型</th><th>检查时间线（滚轮缩放，点击查看）</th></tr></thead><tbody><tr v-for="(entry, index) in timeline.rows" :key="index"><th>{{ entry.row.platform }} {{ entry.row.group_name }} {{ entry.row.model }}</th><td><div class="monitor-pulse" @wheel="wheelZoom"><template v-for="slot in entry.slots" :key="slot.time"><button v-if="slot.bucket" :class="['monitor-cell', health(slot.bucket)]" :aria-label="`${slot.bucket.bucket_start} ${healthLabel(health(slot.bucket))}`" :title="`${slot.bucket.bucket_start} ${healthLabel(health(slot.bucket))}`" @click="selected = { title: `${entry.row.platform} ${entry.row.group_name || ''} ${entry.row.model || ''}`, bucket: slot.bucket }">{{ healthLabel(health(slot.bucket)) }}</button><span v-else class="monitor-cell unknown" :title="`${new Date(slot.time).toISOString()} 无记录`">无记录</span></template></div></td></tr></tbody></table></div>
      </template>
      <div v-else>
        <p>纵轴：{{ mode === 'ttft' ? '首 Token P50（ms）' : mode === 'overall' ? '健康评分' : '百分比' }} · 0–{{ number(chart.maximum) }}；横轴：时间。缺失样本不连线。</p>
        <svg v-if="chart.points.length" class="monitor-chart" viewBox="0 0 600 150" role="img" aria-label="监控趋势折线"><path d="M20 10V130H590" fill="none" stroke="currentColor" opacity=".25" /><polyline v-for="(segment, i) in chart.segments" :key="i" :points="segment" fill="none" stroke="var(--accent-color, #007aff)" stroke-width="2" /></svg>
        <div class="public-table-wrap"><table class="public-table"><thead><tr><th>时间</th><th>健康</th><th>成功率</th><th>首 Token P50</th><th>缓存</th></tr></thead><tbody><tr v-for="point in snapshot?.trend || []" :key="point.bucket_start"><td>{{ point.bucket_start }}</td><td>{{ healthLabel(health(point)) }}</td><td>{{ successRate(point.metrics) }}</td><td>{{ number(point.metrics.ttft.p50_ms, ' ms') }}</td><td>{{ percent(point.metrics.cache_rate) }}</td></tr></tbody></table></div></div>
      <h2>监控明细</h2>
      <div class="public-form"><label>明细类型<select v-model="tab"><option value="models">模型</option><option value="errors">错误</option><option v-if="showUsers" value="users">用户排行</option></select></label></div>
      <template v-if="tab === 'models'">
        <p v-if="!modelRows.length && !loading">暂无模型记录。</p>
        <div class="public-table-wrap"><table class="public-table"><thead><tr><th>模型（点击筛选）</th><th>健康</th><th>成功率</th><th>首 Token P50</th><th>缓存率</th><th v-if="showThroughput">Token/秒 · RPM</th></tr></thead><tbody><tr v-for="row in modelRows" :key="`${row.platform}:${row.model}`"><td><MacButton @click="drill(row)">{{ row.platform }} / {{ row.model }}</MacButton></td><td>{{ healthLabel(row.health.overall) }}</td><td>{{ successRate(row.metrics) }}</td><td>{{ number(row.metrics.ttft.p50_ms, ' ms') }}</td><td>{{ percent(row.metrics.cache_rate) }}</td><td v-if="showThroughput">{{ number(row.metrics.tpm / 60) }} · {{ number(row.metrics.rpm) }}</td></tr></tbody></table></div>
      </template>
      <template v-else-if="tab === 'errors'">
        <p v-if="!errorRows.length && !loading">暂无错误记录。</p>
        <details v-for="row in errorRows" :key="row.category"><summary>{{ row.category }} · {{ number(row.count) }} 次 · {{ percent(row.rate) }} {{ row.ignored ? '（不计入健康分）' : '' }}</summary><div class="public-table-wrap"><table class="public-table"><thead><tr><th>平台 / 模型</th><th>状态 / 上游状态</th><th>类型 / 消息</th><th>次数</th></tr></thead><tbody><tr v-for="(item, index) in row.details || []" :key="index"><td>{{ item.platform }} / {{ item.model }}</td><td>{{ item.status_code || '—' }} / {{ item.upstream_status_code || '—' }}</td><td>{{ item.error_type }} {{ item.message }}</td><td>{{ number(item.count) }}</td></tr></tbody></table></div></details>
      </template>
      <template v-else-if="showUsers">
        <p v-if="!userRows.length && !loading">暂无排行记录。</p>
        <div class="public-table-wrap"><table class="public-table"><thead><tr><th>排名 / 用户</th><th>成功率</th><th>首 Token P50</th><th>缓存率</th><th v-if="showThroughput">Token/秒 · RPM</th></tr></thead><tbody><tr v-for="row in userRows" :key="row.rank"><th>{{ row.rank }} · {{ row.display_label }} {{ row.is_self ? '（我）' : '' }}</th><td>{{ successRate(row.metrics) }}</td><td>{{ number(row.metrics.ttft.p50_ms, ' ms') }}</td><td>{{ percent(row.metrics.cache_rate) }}</td><td v-if="showThroughput">{{ number(row.metrics.tpm / 60) }} · {{ number(row.metrics.rpm) }}</td></tr></tbody></table></div>
      </template>
      <MacSheet :show="selected !== null" :title="selected?.title || '检查详情'" @close="selected = null"><template v-if="selected"><p>{{ selected.bucket.bucket_start }}</p><dl class="public-facts"><dt>健康</dt><dd>{{ healthLabel(health(selected.bucket)) }}</dd><dt>错误率</dt><dd>{{ percent(selected.bucket.metrics.error_rate) }}</dd><dt>首 Token P50 / P95</dt><dd>{{ number(selected.bucket.metrics.ttft.p50_ms, ' ms') }} / {{ number(selected.bucket.metrics.ttft.p95_ms, ' ms') }}</dd><dt>缓存命中率</dt><dd>{{ percent(selected.bucket.metrics.cache_rate) }}</dd><template v-if="showThroughput"><dt>请求 / Token/秒</dt><dd>{{ number(selected.bucket.metrics.request_count) }} / {{ number(selected.bucket.metrics.tpm / 60) }}</dd></template></dl></template></MacSheet>
    </template>
  </section>
</template>
<style scoped>
.monitor-v2 { min-width: 0; }.monitor-chart { width: 100%; height: 180px; }.monitor-v2 select[multiple] { min-height: 70px; max-width: 240px; }.monitor-pulse { display: flex; gap: 4px; min-width: 240px; overflow-x: auto; max-width: 65vw; padding: 5px; }
.monitor-cell { flex: 0 0 auto; border: 1px solid var(--border-color, #8885); border-radius: 4px; padding: 6px; font-size: 11px; background: #8882; color: inherit; }.monitor-cell.healthy { border-bottom: 4px solid #309559; }.monitor-cell.warning { border-bottom: 4px solid #b68018; }.monitor-cell.critical { border-bottom: 4px solid #d44040; }.monitor-cell.unknown { border-bottom: 4px solid #888; }
summary { cursor: pointer; padding: 12px 0; overflow-wrap: anywhere; }
</style>
