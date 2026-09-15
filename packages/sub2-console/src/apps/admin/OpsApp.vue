<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import OperationsPanel from './operations/OperationsPanel.vue';
import { opsPlatforms, optionalGroupId } from './operations/platforms';
const opsTab = ref<'overview' | 'requests' | 'errors' | 'upstream' | 'logs' | 'rules' | 'events' | 'traffic'>('overview');
const opsTabs = [{ id: 'overview', label: '概览' }, { id: 'requests', label: '请求' }, { id: 'errors', label: '请求错误' }, { id: 'upstream', label: '上游错误' }, { id: 'logs', label: '系统日志' }, { id: 'rules', label: '告警规则' }, { id: 'events', label: '告警事件' }, { id: 'traffic', label: '趋势与并发' }] as const;
import { adminError } from './admin-feedback';

import { opsAPI, type OpsDashboardOverview, type OpsSystemMetricsSnapshot, type OpsAdvancedSettings, type AlertEvent } from '../../api/admin/ops';

defineProps<{
  win?: WindowInstance;
}>();

const loading = ref(false);
const loadError = ref('');
let loadVersion = 0;
const overview = ref<OpsDashboardOverview | null>(null);
const sysMetrics = computed(() => overview.value?.system_metrics || null);
const timeRange = ref<'5m' | '30m' | '1h' | '6h' | '24h'>('1h');
const platform = ref('');
const groupId = ref('');
const lastRefresh = ref('');
let refreshTimer: any = null;
const preferences=ref<OpsAdvancedSettings|null>(null), preferenceError=ref(''), overviewAlerts=ref<AlertEvent[]>([]), alertError=ref('');
let preferenceEpoch=0, alertEpoch=0, lastAutoRefresh=Date.now();
async function loadPreferences(){const version=++preferenceEpoch;preferenceError.value='';try{const value=await opsAPI.getAdvancedSettings();if(version!==preferenceEpoch)return;if(!value || typeof value.auto_refresh_enabled!=='boolean')throw new Error('自动刷新配置未完整返回');applyPreferences(value);}catch(err){if(version===preferenceEpoch)preferenceError.value=adminError(err,'运维偏好读取失败，自动刷新暂停');}}
function applyPreferences(value:OpsAdvancedSettings){preferenceEpoch++;preferences.value=value;preferenceError.value='';lastAutoRefresh=Date.now();alertEpoch++;overviewAlerts.value=[];alertError.value='';if(value.display_alert_events)void loadOverviewAlerts();}
async function loadOverviewAlerts(){if(!preferences.value?.display_alert_events)return;const version=++alertEpoch;try{const items=await opsAPI.listAlertEvents({limit:5,time_range:timeRange.value,platform:platform.value||undefined});if(version!==alertEpoch)return;if(!Array.isArray(items))throw new Error('告警快照响应无效');overviewAlerts.value=items;alertError.value='';}catch(err){if(version===alertEpoch)alertError.value=adminError(err,'告警快照读取失败');}}
function refreshAutomatically(){const p=preferences.value;if(opsTab.value!=='overview'||!p?.auto_refresh_enabled||loading.value||document.hidden)return;const seconds=p.auto_refresh_interval_seconds;if(!Number.isFinite(seconds)||seconds<1)return;if(Date.now()-lastAutoRefresh>=seconds*1000){lastAutoRefresh=Date.now();void loadDashboard();}}


function fmtPct(v?: number | null) { return v != null ? v.toFixed(1) + '%' : '—'; }
function fmtMs(v?: number | null) { return v != null ? v.toFixed(0) + ' ms' : '- ms'; }
function fmtNum(v?: number | null) { return v != null ? v.toLocaleString() : '—'; }

const healthLabel = computed(() => {
  if (!overview.value || overview.value.health_score == null) return '待采集';
  const score = overview.value.health_score;
  if (overview.value.request_count_total === 0) return '待机';
  if (score >= 90) return '健康';
  if (score >= 70) return '一般';
  return '异常';
});

const healthColor = computed(() => {
  const label = healthLabel.value;
  if (label === '待机' || label === '待采集') return 'text-gray-400';
  if (label === '健康') return 'text-emerald-500';
  if (label === '一般') return 'text-amber-500';
  return 'text-red-500';
});

async function loadDashboard() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const data = await opsAPI.getDashboardOverview({
      time_range: timeRange.value,
      platform: platform.value || undefined,
      group_id: optionalGroupId(groupId.value)
    });
    if (version !== loadVersion) return;
    overview.value = data;
    void loadOverviewAlerts();
    lastRefresh.value = new Date().toLocaleString('zh-CN', { hour12: false });
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '监控数据加载失败，已保留上次快照。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

onMounted(() => {
  loadDashboard();
  void loadPreferences();
  refreshTimer = setInterval(refreshAutomatically, 1000);
});

onUnmounted(() => {
  loadVersion++; preferenceEpoch++; alertEpoch++;
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <div class="admin-polish ops-app h-full flex flex-col select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-2.5">
        <img :src="getAppIcon('ops')" class="w-7 h-7 drop-shadow-sm shrink-0" alt="Ops" />
        <span class="text-xs font-semibold text-gray-900 dark:text-gray-100">运维监控</span>
      </div>
      <div class="flex items-center gap-2">
        <span v-if="lastRefresh" class="text-[10px] text-gray-400 font-mono">快照更新于 {{ lastRefresh }}</span>
      </div>
    </div>

    <nav class="flex flex-wrap gap-1 px-4 py-2 border-b border-black/10 dark:border-white/10" aria-label="运维分类">
      <MacButton v-for="tab in opsTabs" :key="tab.id" size="sm" :variant="opsTab === tab.id ? 'primary' : 'default'" :aria-pressed="opsTab === tab.id" @click="opsTab = tab.id">{{ tab.label }}</MacButton>
    </nav>
    <OperationsPanel v-if="opsTab !== 'overview'" :tab="opsTab" :preferences="preferences" @preferences="applyPreferences" />
    <!-- Content -->
    <AdminFeedback v-if="opsTab === 'overview'" :loading="loading" :error="loadError" @retry="loadDashboard" />
    <div v-if="opsTab === 'overview'" class="admin-content flex-1 overflow-y-auto p-4 space-y-4">

      <div v-if="preferenceError" role="alert" class="flex flex-wrap gap-2">{{ preferenceError }}<MacButton size="sm" @click="loadPreferences">重新读取偏好</MacButton></div>
      <section v-if="preferences?.display_alert_events" class="admin-card p-3 space-y-2"><div class="flex justify-between"><h3>最近告警事件</h3><MacButton size="sm" @click="opsTab='events'">查看全部</MacButton></div><p v-if="alertError" role="alert">{{ alertError }}</p><div v-for="event in overviewAlerts" :key="event.id">{{ event.title||'告警 #'+event.id }} · {{ event.status }} · {{ event.fired_at }}</div><p v-if="!overviewAlerts.length&&!alertError">暂无告警事件</p></section>
      <!-- Header with Filters -->
      <div class="admin-filters">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-xs font-semibold text-black/85 dark:text-white/85">运行概览 · {{ preferences ? preferences.auto_refresh_enabled ? '每 '+preferences.auto_refresh_interval_seconds+' 秒刷新' : '手动刷新' : '刷新设置未读取' }}</span>
          <select v-model="platform" aria-label="概览平台" class="text-xs px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e] focus:outline-none focus:ring-2 focus:ring-blue-500/30" @change="loadDashboard()">
            <option value="">全部平台</option>
            <option v-for="[id, name] in opsPlatforms" :key="id" :value="id">{{ name }}</option>
          </select>
          <label class="text-xs">分组编号<input v-model="groupId" aria-label="概览分组编号" type="number" min="1" step="1" placeholder="全部" class="ml-1 w-20 rounded border border-black/10 dark:border-white/10 bg-transparent px-2 py-1" @change="loadDashboard()" /></label>
          <select v-model="timeRange" class="text-xs px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e] focus:outline-none focus:ring-2 focus:ring-blue-500/30" @change="loadDashboard()">
            <option value="5m">5分钟</option>
            <option value="30m">30分钟</option>
            <option value="1h">近1小时</option>
            <option value="6h">近6小时</option>
            <option value="24h">近24小时</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <MacButton size="sm" :disabled="loading" @click="loadDashboard">
            <svg class="w-3.5 h-3.5 mr-1" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            刷新
          </MacButton>
        </div>
      </div>

      <!-- Realtime QPS/TPS Hero Section -->
      <div class="admin-responsive-grid grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3.5">
        <!-- Left: QPS/TPS Gauge -->
        <div class="admin-card p-4.5">
          <div class="flex items-center gap-2 mb-3">
            <span class="text-xs font-semibold text-black/80 dark:text-white/80">吞吐与健康状态</span>
          </div>
          <div class="flex items-center justify-center gap-8 py-3">
            <!-- Health Ring -->
            <div class="flex flex-col items-center gap-1">
              <div class="w-20 h-20 rounded-full border-4 border-black/10 dark:border-white/15 flex items-center justify-center shadow-inner" :class="healthColor">
                <div class="text-center">
                  <div class="text-sm font-bold font-mono">{{ healthLabel }}</div>
                  <div class="text-[10px] text-black/45 dark:text-white/45">健康状态</div>
                </div>
              </div>
              <div class="text-xs font-medium text-black/60 dark:text-white/60 mt-1">集群健康度</div>
              <div class="text-[10px] font-mono" :class="healthColor">{{ healthLabel }}</div>
            </div>
            <!-- QPS/TPS -->
            <div class="text-center space-y-2">
              <div class="text-xs text-black/45 dark:text-white/45">当前瞬时吞吐</div>
              <div class="text-3xl font-bold font-mono text-black/90 dark:text-white/90 tracking-tight">
                {{ overview?.qps?.current?.toFixed(1) ?? '—' }} <span class="text-xs text-black/40 dark:text-white/40 font-normal">QPS</span>
                &nbsp;
                {{ overview?.tps?.current?.toFixed(1) ?? '—' }} <span class="text-xs text-black/40 dark:text-white/40 font-normal">TPS</span>
              </div>
              <div class="flex items-center gap-6 text-[11px] text-black/50 dark:text-white/50 font-mono">
                <div>
                  <div class="text-[10px]">峰值</div>
                  <div class="font-medium text-black/80 dark:text-white/80">{{ overview?.qps?.peak?.toFixed(1) ?? '—' }} QPS</div>
                  <div class="font-medium text-black/80 dark:text-white/80">{{ overview?.tps?.peak?.toFixed(1) ?? '—' }} TPS</div>
                </div>
                <div>
                  <div class="text-[10px]">平均</div>
                  <div class="font-medium text-black/80 dark:text-white/80">{{ overview?.qps?.avg?.toFixed(1) ?? '—' }} QPS</div>
                  <div class="font-medium text-black/80 dark:text-white/80">{{ overview?.tps?.avg?.toFixed(1) ?? '—' }} TPS</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Metric Cards Grid -->
        <div class="admin-responsive-metrics grid grid-cols-2 gap-2.5 min-w-0">
          <!-- 请求 -->
          <div class="admin-card p-3.5">
            <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
              <span>请求负载</span>
              
            </div>
            <div class="text-xs space-y-1 text-black/75 dark:text-white/75 font-mono">
              <div class="flex justify-between"><span>请求数:</span><span class="font-semibold text-black/90 dark:text-white/90">{{ fmtNum(overview?.request_count_total) }}</span></div>
              <div class="flex justify-between"><span>Token数:</span><span class="font-semibold text-black/90 dark:text-white/90">{{ fmtNum(overview?.token_consumed) }}</span></div>
              <div class="flex justify-between"><span>平均 QPS:</span><span class="font-semibold text-black/90 dark:text-white/90">{{ overview?.qps?.avg?.toFixed(1) ?? '—' }}</span></div>
              <div class="flex justify-between"><span>平均 TPS:</span><span class="font-semibold text-black/90 dark:text-white/90">{{ overview?.tps?.avg?.toFixed(1) ?? '—' }}</span></div>
            </div>
          </div>

          <!-- SLA -->
          <div class="admin-card p-3.5">
            <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
              <span>SLA 可靠性</span>
              
            </div>
            <div class="text-xl font-bold font-mono text-black/90 dark:text-white/90 mb-1">
              {{ overview?.sla != null ? (overview.sla * 100).toFixed(2) + '%' : '—' }}
            </div>
            <div class="text-xs text-black/45 dark:text-white/45 font-mono">异常数: {{ fmtNum(overview?.error_count_sla) }}</div>
          </div>

          <!-- 请求时长 -->
          <div class="admin-card p-3.5">
            <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
              <span>请求延迟</span>
              <span class="text-[10px] text-purple-500 font-mono">Latency</span>
            </div>
            <div class="text-lg font-bold font-mono text-black/90 dark:text-white/90 mb-1">
              {{ fmtMs(overview?.duration?.p99_ms) }} <span class="text-xs font-normal text-black/40 dark:text-white/40">(P99)</span>
            </div>
            <div class="text-[10px] text-black/50 dark:text-white/50 space-y-0.5 font-mono">
              <div>P95: {{ fmtMs(overview?.duration?.p95_ms) }} · P90: {{ fmtMs(overview?.duration?.p90_ms) }}</div>
              <div>Avg: {{ fmtMs(overview?.duration?.avg_ms) }} · Max: {{ fmtMs(overview?.duration?.max_ms) }}</div>
            </div>
          </div>

          <!-- 请求错误 -->
          <div class="admin-card p-3.5">
            <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
              <span>请求错误率</span>
              <span class="text-[10px] text-rose-500 font-mono">Error</span>
            </div>
            <div class="text-xl font-bold font-mono" :class="(overview?.error_rate || 0) > 0 ? 'text-rose-500' : 'text-emerald-500'">
              {{ overview?.error_rate != null ? (overview.error_rate * 100).toFixed(2) + '%' : '—' }}
            </div>
            <div class="text-[10px] text-black/50 dark:text-white/50 space-y-0.5 font-mono">
              <div>错误: {{ fmtNum(overview?.error_count_total) }} · 限制: {{ fmtNum(overview?.business_limited_count) }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2 more metric rows: TTFT + Upstream Error -->
      <div class="admin-responsive-metrics grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <!-- TTFT -->
        <div class="admin-card p-3.5">
          <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
            <span>首字延迟 TTFT</span>
            <span class="text-[10px] text-blue-500 font-mono">Stream</span>
          </div>
          <div class="text-lg font-bold font-mono text-black/90 dark:text-white/90 mb-1">
            {{ fmtMs(overview?.ttft?.p99_ms) }} <span class="text-xs font-normal text-black/40 dark:text-white/40">(P99)</span>
          </div>
          <div class="text-[10px] text-black/50 dark:text-white/50 space-y-0.5 font-mono">
            <div>P95: {{ fmtMs(overview?.ttft?.p95_ms) }} · P90: {{ fmtMs(overview?.ttft?.p90_ms) }}</div>
            <div>Avg: {{ fmtMs(overview?.ttft?.avg_ms) }} · Max: {{ fmtMs(overview?.ttft?.max_ms) }}</div>
          </div>
        </div>

        <!-- 上游错误 -->
        <div class="admin-card p-3.5">
          <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 mb-1.5 font-medium">
            <span>上游异常率</span>
            <span class="text-[10px] text-amber-500 font-mono">Upstream</span>
          </div>
          <div class="text-xl font-bold font-mono" :class="(overview?.upstream_error_rate || 0) > 0 ? 'text-rose-500' : 'text-emerald-500'">
            {{ overview?.upstream_error_rate != null ? (overview.upstream_error_rate * 100).toFixed(2) + '%' : '—' }}
          </div>
          <div class="text-[10px] text-black/50 dark:text-white/50 space-y-0.5 font-mono">
            <div>错误数: {{ fmtNum(overview?.upstream_error_count_excl_429_529) }} · 429/529: {{ fmtNum(overview?.upstream_429_count) }}</div>
          </div>
        </div>
      </div>

      <!-- System Metrics Footer -->
      <div class="admin-responsive-metrics grid grid-cols-3 lg:grid-cols-6 gap-2.5">
        <!-- CPU -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 flex items-center gap-1 font-medium">
            <span>CPU 负载</span>
          </div>
          <div class="text-lg font-bold font-mono" :class="(sysMetrics?.cpu_usage_percent || 0) > 80 ? 'text-rose-500' : (sysMetrics?.cpu_usage_percent || 0) > 60 ? 'text-amber-500' : 'text-emerald-500'">
            {{ fmtPct(sysMetrics?.cpu_usage_percent) }}
          </div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono">阈值 80% / 95%</div>
        </div>

        <!-- 内存 -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 font-medium">物理内存</div>
          <div class="text-lg font-bold font-mono" :class="(sysMetrics?.memory_usage_percent || 0) > 85 ? 'text-rose-500' : (sysMetrics?.memory_usage_percent || 0) > 70 ? 'text-amber-500' : 'text-emerald-500'">
            {{ fmtPct(sysMetrics?.memory_usage_percent) }}
          </div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono truncate">{{ sysMetrics?.memory_used_mb != null && sysMetrics?.memory_total_mb != null ? ((sysMetrics.memory_used_mb / 1024).toFixed(1) + 'G / ' + (sysMetrics.memory_total_mb / 1024).toFixed(1) + 'G') : '—' }}</div>
        </div>

        <!-- 数据库 -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 font-medium">数据库连接</div>
          <div class="text-lg font-bold font-mono" :class="sysMetrics?.db_ok ? 'text-emerald-500' : 'text-rose-500'">
            {{ sysMetrics?.db_ok == null ? '待采集' : sysMetrics.db_ok ? '正常' : '异常' }}
          </div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono">最大 {{ sysMetrics?.db_max_open_conns ?? '—' }} · 空闲 {{ sysMetrics?.db_conn_idle ?? '—' }}</div>
        </div>

        <!-- Redis -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 font-medium">REDIS 缓存</div>
          <div class="text-lg font-bold font-mono" :class="sysMetrics?.redis_ok ? 'text-emerald-500' : 'text-rose-500'">
            {{ sysMetrics?.redis_ok == null ? '待采集' : sysMetrics.redis_ok ? fmtPct((sysMetrics?.redis_conn_total || 0) / (sysMetrics?.redis_pool_size || 1) * 100) : '异常' }}
          </div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono">池容量 {{ sysMetrics?.redis_pool_size || 1024 }}</div>
        </div>

        <!-- 协程 -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 font-medium">Goroutines</div>
          <div class="text-lg font-bold font-mono text-emerald-500">{{ sysMetrics?.goroutine_count ?? '—' }}</div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono">阈值 8000 / 15000</div>
        </div>

        <!-- 后台任务 -->
        <div class="admin-card p-3">
          <div class="text-[10px] text-black/50 dark:text-white/50 mb-1 font-medium">后台任务</div>
          <div class="text-lg font-semibold font-mono">{{ overview?.job_heartbeats?.length == null ? '待采集' : `${overview.job_heartbeats.length} 个` }}</div>
          <div class="text-[9px] text-black/40 dark:text-white/40 mt-0.5 font-mono">活跃心跳 {{ overview?.job_heartbeats?.length ?? '—' }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ops-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
