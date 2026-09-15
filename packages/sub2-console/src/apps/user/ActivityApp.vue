<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import './app-polish.css';
import {
  MacSegmented,
  MacSheet,
  type SegmentOption,
  type WindowInstance
} from '@sub2-mac/core';
import {
  usageAPI
} from '../../api/usage';
import { keysAPI } from '../../api/keys';
import { userGroupsAPI } from '../../api/groups';
import type {
  ApiKey,
  Group,
  ModelStat,
  GroupStat,
  EndpointStat,
  TrendDataPoint,
  UsageLog,
  UsageQueryParams,
  UsageStatsResponse,
  UserErrorRequest,
  UserErrorRequestDetail
} from '../../types';
import {
  formatCurrency,
  formatCost,
  formatTokens,
  formatTokensK,
  formatDuration,
  formatDateTime,
  formatReasoningEffort
} from '../../utils/format';
import {
  getBillingModeLabel,
  getBillingModeBadgeClass,
  isImageUsage,
  getDisplayBillingMode
} from '../../utils/billingMode';
import {
  resolveUsageRequestType,
  requestTypeToLegacyStream
} from '../../utils/usageRequestType';
import {
  statusCodeBadgeClass,
  requestTypeBadgeClass,
  requestTypeLabel,
  numericRequestTypeKind,
  COMMON_ERROR_STATUS_CODES
} from '../../utils/errorBadges';
import {
  firstTokenSeverity,
  durationSeverity,
  LATENCY_TEXT_CLASSES,
  LATENCY_BAR_CLASSES,
  LATENCY_BAR_FROM_CLASSES,
  LATENCY_BAR_TO_CLASSES
} from '../../utils/latencyHealth';
import {
  getEntry as getIpGeoEntry,
  fetchOne as fetchOneIpGeo,
  fetchBatch as fetchBatchIpGeo
} from '../../utils/ipGeoLookup';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Doughnut, Line } from 'vue-chartjs';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

defineProps<{
  win?: WindowInstance;
}>();

// ==================== Tabs ====================
const activeTab = ref<'usage' | 'errors'>('usage');
const tabOptions: SegmentOption[] = [
  { label: '用量明细', value: 'usage' },
  { label: '错误请求', value: 'errors' }
];

// ==================== Date Range & Granularity ====================
const formatLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const getRangeByPreset = (preset: '24h' | '7d' | '30d' | '90d') => {
  const end = new Date();
  let days = 1;
  if (preset === '7d') days = 7;
  else if (preset === '30d') days = 30;
  else if (preset === '90d') days = 90;
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
};

const currentPreset = ref<'24h' | '7d' | '30d' | '90d' | 'custom'>('24h');
const defaultRange = getRangeByPreset('24h');
const startDate = ref(defaultRange.start);
const endDate = ref(defaultRange.end);
const granularity = ref<'day' | 'hour'>('hour');
const showCharts = ref(true);
const analysisView = ref('trend');

const setPreset = (preset: '24h' | '7d' | '30d' | '90d') => {
  currentPreset.value = preset;
  const r = getRangeByPreset(preset);
  startDate.value = r.start;
  endDate.value = r.end;
  granularity.value = preset === '24h' ? 'hour' : 'day';
  applyFilters();
};

const onCustomDateChange = () => {
  currentPreset.value = 'custom';
  applyFilters();
};

// ==================== Data State ====================
const loading = ref(false);
const loadIssues = reactive({ logs: '', stats: '', models: '', charts: '', errors: '', filters: '' });
const visibleLoadIssues = computed(() => {
  const issues = activeTab.value === 'errors'
    ? [loadIssues.errors, loadIssues.filters]
    : [loadIssues.logs, loadIssues.stats, loadIssues.models, loadIssues.charts, loadIssues.filters];
  return issues.filter(Boolean).join(' ');
});
const chartsLoading = ref(false);
const errorLoading = ref(false);
const exportError = ref('');
const exportProgress = reactive({ current: 0, total: 0 });
const detailIssue = ref('');

type RequestContext = { version: number; controller: AbortController };
let logController: AbortController | null = null;
let logVersion = 0;
let usageController: AbortController | null = null;
let usageVersion = 0;
let errorController: AbortController | null = null;
let errorVersion = 0;
let filterController: AbortController | null = null;
let filterVersion = 0;
let detailController: AbortController | null = null;
let detailVersion = 0;
let exportController: AbortController | null = null;
let disposed = false;

const usageStats = ref<UsageStatsResponse | null>(null);
const usageLogs = ref<UsageLog[]>([]);
const requestedModelStats = ref<ModelStat[]>([]);
const groupStats = ref<GroupStat[]>([]);
const inboundEndpointStats = ref<EndpointStat[]>([]);
const trendData = ref<TrendDataPoint[]>([]);

const errorRows = ref<UserErrorRequest[]>([]);
const errorTotal = ref(0);
const errorPage = ref(1);
const errorPageSize = ref(20);

const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0
});

const sortState = reactive({
  sort_by: 'created_at',
  sort_order: 'desc' as 'asc' | 'desc'
});

// Distribution Metric Toggles: 'tokens' | 'cost'
const modelDistributionMetric = ref<'tokens' | 'actual_cost'>('tokens');
const groupDistributionMetric = ref<'tokens' | 'actual_cost'>('tokens');
const endpointDistributionMetric = ref<'tokens' | 'actual_cost'>('tokens');

// Filter dropdown data
const apiKeys = ref<ApiKey[]>([]);
const userGroups = ref<Group[]>([]);
const modelOptionValues = ref<string[]>([]);

// Filter states for Usage
const filters = reactive<{
  api_key_id: number | null;
  model: string;
  group_id: number | null;
  request_type: 'ws_v2' | 'live' | 'stream' | 'sync' | null;
  native_compaction_v2: boolean | null;
  billing_type: number | null;
  billing_mode: string | null;
}>({
  api_key_id: null,
  model: '',
  group_id: null,
  request_type: null,
  native_compaction_v2: null,
  billing_type: null,
  billing_mode: null
});

// Filter states for Errors
const errorFilter = reactive<{
  api_key_id: number | null;
  model: string;
  category: string;
  status_code: number | null;
}>({
  api_key_id: null,
  model: '',
  category: '',
  status_code: null
});

const errorCategoryOptions = [
  { value: '', label: '全部分类' },
  { value: 'auth', label: '认证失败' },
  { value: 'rate_limit', label: '限流' },
  { value: 'quota', label: '余额/订阅' },
  { value: 'invalid_request', label: '参数错误' },
  { value: 'service_unavailable', label: '服务暂时不可用' },
  { value: 'upstream', label: '上游错误' },
  { value: 'internal', label: '平台错误' },
  { value: 'cyber', label: '安全策略' }
];

const errorCategoryLabels: Record<string, string> = {
  auth: '认证失败',
  rate_limit: '限流',
  quota: '余额/订阅',
  invalid_request: '参数错误',
  service_unavailable: '服务暂时不可用',
  upstream: '上游错误',
  internal: '平台错误',
  cyber: '安全策略'
};

// ==================== Column Visibility ====================
const showColumnDropdown = ref(false);
const visibleColumns = reactive({
  api_key: true,
  model: true,
  reasoning_effort: true,
  endpoint: true,
  ip_address: true,
  group: true,
  stream: true,
  billing_mode: true,
  tokens: true,
  cost: true,
  latency: true,
  created_at: true,
  user_agent: false
});

const errorVisibleColumns = reactive({
  key_name: true,
  model: true,
  endpoint: true,
  client_ip: true,
  group: true,
  type: true,
  platform: true,
  category: true,
  status: true,
  message: true,
  created_at: true,
  user_agent: false
});

// ==================== Detail Inspection Sheets ====================
const showUsageDetailSheet = ref(false);
const selectedUsageLog = ref<UsageLog | null>(null);

const showErrorDetailSheet = ref(false);
const selectedErrorId = ref<number | null>(null);
const selectedErrorDetail = ref<UserErrorRequestDetail | null>(null);
const errorDetailLoading = ref(false);

function beginLogRequest(): RequestContext {
  logController?.abort();
  logController = new AbortController();
  loading.value = true;
  return { version: ++logVersion, controller: logController };
}
function isCurrentLogRequest(context: RequestContext): boolean {
  return !disposed && context.version === logVersion && !context.controller.signal.aborted;
}
function beginUsageRequest(): RequestContext {
  usageController?.abort();
  const controller = new AbortController();
  usageController = controller;
  return { version: ++usageVersion, controller };
}

function isCurrentUsageRequest(context: RequestContext): boolean {
  return !disposed && context.version === usageVersion && !context.controller.signal.aborted;
}

function beginErrorRequest(): RequestContext {
  errorController?.abort();
  const controller = new AbortController();
  errorController = controller;
  errorLoading.value = true;
  return { version: ++errorVersion, controller };
}

function isCurrentErrorRequest(context: RequestContext): boolean {
  return !disposed && context.version === errorVersion && !context.controller.signal.aborted;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ERR_CANCELED';
}

const openUsageDetail = (log: UsageLog) => {
  selectedUsageLog.value = log;
  showUsageDetailSheet.value = true;
};

const openErrorDetail = async (id: number) => {
  detailController?.abort();
  const controller = new AbortController();
  detailController = controller;
  const version = ++detailVersion;
  selectedErrorId.value = id;
  showErrorDetailSheet.value = true;
  selectedErrorDetail.value = null;
  detailIssue.value = '';
  errorDetailLoading.value = true;
  try {
    const res = await usageAPI.getMyErrorDetail(id, { signal: controller.signal });
    if (!disposed && version === detailVersion && !controller.signal.aborted) {
      selectedErrorDetail.value = res;
    }
  } catch (err) {
    if (disposed || version !== detailVersion || controller.signal.aborted || isAbortError(err)) return;
    console.error('Failed to load error detail:', err);
    detailIssue.value = '错误详情加载失败，请重试。';
  } finally {
    if (!disposed && version === detailVersion) errorDetailLoading.value = false;
  }
};

const retryErrorDetail = () => {
  if (selectedErrorId.value !== null) void openErrorDetail(selectedErrorId.value);
};

const closeErrorDetail = () => {
  detailController?.abort();
  showErrorDetailSheet.value = false;
};

// ==================== Tooltips (Tokens & Cost) ====================
const hoverTokenData = ref<UsageLog | null>(null);
const hoverTokenPos = reactive({ x: 0, y: 0, show: false });

const hoverCostData = ref<UsageLog | null>(null);
const hoverCostPos = reactive({ x: 0, y: 0, show: false });

const onTokenMouseEnter = (e: MouseEvent, log: UsageLog) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverTokenPos.x = rect.left + window.scrollX;
  hoverTokenPos.y = rect.bottom + window.scrollY + 6;
  hoverTokenData.value = log;
  hoverTokenPos.show = true;
};

const onTokenMouseLeave = () => {
  hoverTokenPos.show = false;
};

const onCostMouseEnter = (e: MouseEvent, log: UsageLog) => {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  hoverCostPos.x = rect.left + window.scrollX;
  hoverCostPos.y = rect.bottom + window.scrollY + 6;
  hoverCostData.value = log;
  hoverCostPos.show = true;
};

const onCostMouseLeave = () => {
  hoverCostPos.show = false;
};

// ==================== Copy Helpers ====================
const copiedKey = ref<string | null>(null);
const copyText = async (text: string, idKey: string) => {
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = idKey;
    setTimeout(() => {
      if (copiedKey.value === idKey) copiedKey.value = null;
    }, 2000);
  } catch (e) {
    console.error('Clipboard copy failed:', e);
  }
};

// ==================== Load Data Functions ====================
const normalizedFilters = computed<UsageQueryParams>(() => {
  const requestType = filters.request_type;
  const legacyStream = requestType ? requestTypeToLegacyStream(requestType) : undefined;
  return {
    start_date: startDate.value,
    end_date: endDate.value,
    api_key_id: filters.api_key_id ?? undefined,
    model: filters.model || undefined,
    group_id: filters.group_id ?? undefined,
    native_compaction_v2: filters.native_compaction_v2,
    billing_type: filters.billing_type,
    billing_mode: filters.billing_mode,
    stream: legacyStream === null ? undefined : legacyStream
  };
});

const loadFilterOptions = async () => {
  filterController?.abort();
  const controller = new AbortController();
  filterController = controller;
  const version = ++filterVersion;
  loadIssues.filters = '';
  try {
    const [keysResult, groupsResult] = await Promise.allSettled([
      (async () => {
        const first = await keysAPI.list(1, 100, undefined, { signal: controller.signal });
        const allKeys = [...(first.items || [])];
        const pageSize = Math.max(first.page_size || 100, 1);
        const pages = Math.max(first.pages || 1, Math.ceil((first.total || allKeys.length) / pageSize));
        for (let page = 2; page <= pages; page += 1) {
          if (disposed || version !== filterVersion || controller.signal.aborted) return null;
          const next = await keysAPI.list(page, pageSize, undefined, { signal: controller.signal });
          allKeys.push(...(next.items || []));
        }
        return allKeys;
      })(),
      userGroupsAPI.getAvailable({ signal: controller.signal })
    ]);
    if (disposed || version !== filterVersion || controller.signal.aborted) return;
    const failed: string[] = [];
    if (keysResult.status === 'fulfilled' && keysResult.value) {
      const unique = new Map<number, ApiKey>();
      keysResult.value.forEach(key => unique.set(key.id, key));
      apiKeys.value = [...unique.values()];
    } else if (keysResult.status === 'rejected' && !isAbortError(keysResult.reason)) {
      failed.push('密钥筛选');
    }
    if (groupsResult.status === 'fulfilled') {
      userGroups.value = groupsResult.value || [];
    } else if (!isAbortError(groupsResult.reason)) {
      failed.push('分组筛选');
    }
    if (failed.length) loadIssues.filters = `${failed.join('、')}暂时无法加载，列表仍可查看；请刷新重试。`;
  } catch (err) {
    if (disposed || version !== filterVersion || controller.signal.aborted || isAbortError(err)) return;
    loadIssues.filters = '筛选条件加载失败，列表仍可查看；请刷新重试。';
    console.error('Failed to preload usage filters:', err);
  }
};

const loadLogs = async (context: RequestContext = beginLogRequest()) => {
  loadIssues.logs = '';
  try {
    const res = await usageAPI.query({
      page: pagination.page,
      page_size: pagination.page_size,
      ...normalizedFilters.value,
      sort_by: sortState.sort_by,
      sort_order: sortState.sort_order
    }, { signal: context.controller.signal });
    if (!isCurrentLogRequest(context)) return;
    usageLogs.value = res.items || [];
    pagination.total = res.total || 0;
  } catch (err) {
    if (!isCurrentLogRequest(context) || isAbortError(err)) return;
    loadIssues.logs = '用量明细加载失败。';
    console.error('Failed to load usage logs:', err);
  } finally {
    if (isCurrentLogRequest(context)) loading.value = false;
  }
};

const loadStats = async (context: RequestContext = beginUsageRequest()) => {
  loadIssues.stats = '';
  try {
    const stats = await usageAPI.getStats(normalizedFilters.value, undefined, { signal: context.controller.signal });
    if (!isCurrentUsageRequest(context)) return;
    usageStats.value = stats;
    inboundEndpointStats.value = stats.endpoints || [];
  } catch (err) {
    if (!isCurrentUsageRequest(context) || isAbortError(err)) return;
    loadIssues.stats = '用量统计加载失败。';
    console.error('Failed to load usage stats:', err);
  }
};

const loadModelStats = async (context: RequestContext = beginUsageRequest()) => {
  loadIssues.models = '';
  try {
    const res = await usageAPI.getDashboardModels({
      ...normalizedFilters.value,
      model_source: 'requested'
    }, { signal: context.controller.signal });
    if (!isCurrentUsageRequest(context)) return;
    requestedModelStats.value = res.models || [];
    const models = new Set(modelOptionValues.value);
    (res.models || []).forEach((m) => {
      if (m.model) models.add(m.model);
    });
    modelOptionValues.value = Array.from(models).sort();
  } catch (err) {
    if (!isCurrentUsageRequest(context) || isAbortError(err)) return;
    loadIssues.models = '模型分布加载失败。';
    console.error('Failed to load model stats:', err);
  }
};

const loadChartData = async (context: RequestContext = beginUsageRequest()) => {
  chartsLoading.value = true;
  loadIssues.charts = '';
  try {
    const snapshot = await usageAPI.getDashboardSnapshotV2({
      ...normalizedFilters.value,
      granularity: granularity.value,
      include_trend: true,
      include_model_stats: false,
      include_group_stats: true
    }, { signal: context.controller.signal });
    if (!isCurrentUsageRequest(context)) return;
    trendData.value = snapshot.trend || [];
    groupStats.value = snapshot.groups || [];
  } catch (err) {
    if (!isCurrentUsageRequest(context) || isAbortError(err)) return;
    loadIssues.charts = '趋势图加载失败。';
    console.error('Failed to load snapshot charts:', err);
  } finally {
    if (isCurrentUsageRequest(context)) chartsLoading.value = false;
  }
};

const loadErrors = async (context: RequestContext = beginErrorRequest()) => {
  loadIssues.errors = '';
  try {
    const res = await usageAPI.listMyErrorRequests({
      page: errorPage.value,
      page_size: errorPageSize.value,
      start_date: startDate.value,
      end_date: endDate.value,
      api_key_id: errorFilter.api_key_id ?? undefined,
      model: errorFilter.model || undefined,
      category: errorFilter.category || undefined,
      status_code: errorFilter.status_code ?? undefined,
      sort_by: 'created_at',
      sort_order: 'desc'
    }, { signal: context.controller.signal });
    if (!isCurrentErrorRequest(context)) return;
    errorRows.value = res.items || [];
    errorTotal.value = res.total || 0;
  } catch (err) {
    if (!isCurrentErrorRequest(context) || isAbortError(err)) return;
    loadIssues.errors = '错误请求列表加载失败。';
    console.error('Failed to load error requests:', err);
  } finally {
    if (isCurrentErrorRequest(context)) errorLoading.value = false;
  }
};

const applyFilters = () => {
  if (activeTab.value === 'errors') {
    applyErrorFilters();
    return;
  }
  pagination.page = 1;
  const context = beginUsageRequest();
  void Promise.allSettled([
    loadLogs(),
    loadStats(context),
    loadModelStats(context),
    loadChartData(context)
  ]);
};

const applyErrorFilters = () => {
  errorPage.value = 1;
  void loadErrors(beginErrorRequest());
};

const resetFilters = () => {
  currentPreset.value = '24h';
  const range = getRangeByPreset('24h');
  startDate.value = range.start;
  endDate.value = range.end;
  granularity.value = 'hour';
  filters.api_key_id = null;
  filters.model = '';
  filters.group_id = null;
  filters.request_type = null;
  filters.native_compaction_v2 = null;
  filters.billing_type = null;
  filters.billing_mode = null;

  errorFilter.api_key_id = null;
  errorFilter.model = '';
  errorFilter.category = '';
  errorFilter.status_code = null;

  if (activeTab.value === 'errors') applyErrorFilters();
  else applyFilters();
};

const refreshData = () => {
  void loadFilterOptions();
  if (activeTab.value === 'errors') {
    void loadErrors(beginErrorRequest());
    return;
  }
  const context = beginUsageRequest();
  void Promise.allSettled([
    loadLogs(),
    loadStats(context),
    loadModelStats(context),
    loadChartData(context)
  ]);
};

const toggleSort = (colKey: string) => {
  if (sortState.sort_by === colKey) {
    sortState.sort_order = sortState.sort_order === 'asc' ? 'desc' : 'asc';
  } else {
    sortState.sort_by = colKey;
    sortState.sort_order = 'desc';
  }
  pagination.page = 1;
  void loadLogs();
};

// ==================== Batch IP Geo ====================
const ipGeoBatchLoading = ref(false);
const handleBatchFetchIpGeo = async () => {
  ipGeoBatchLoading.value = true;
  try {
    const ips = activeTab.value === 'usage'
      ? usageLogs.value.map((l) => l.ip_address).filter(Boolean)
      : errorRows.value.map((r) => r.client_ip).filter(Boolean);
    await fetchBatchIpGeo(ips);
  } finally {
    ipGeoBatchLoading.value = false;
  }
};

// ==================== Export to CSV ====================
const exporting = ref(false);
const escapeCSV = (val: unknown): string => {
  if (val == null) return '';
  const str = String(val);
  const esc = str.replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(str)) return `"\'${esc}"`;
  if (/[,"\n\r]/.test(str)) return `"${esc}"`;
  return str;
};

const exportToCSV = async () => {
  if (exporting.value || pagination.total === 0) return;
  exportController?.abort();
  const controller = new AbortController();
  exportController = controller;
  const filterSnapshot = { ...normalizedFilters.value };
  const sortSnapshot = { ...sortState };
  const expectedTotal = pagination.total;
  const pageSize = 100;
  const totalPages = Math.max(1, Math.ceil(expectedTotal / pageSize));
  exporting.value = true;
  exportError.value = '';
  exportProgress.current = 0;
  exportProgress.total = totalPages;
  try {
    const allLogs: UsageLog[] = [];
    const seenIds = new Set<number>();
    for (let p = 1; p <= totalPages; p++) {
      if (disposed || controller.signal.aborted) return;
      const res = await usageAPI.query({
        page: p,
        page_size: pageSize,
        ...filterSnapshot,
        sort_by: sortSnapshot.sort_by,
        sort_order: sortSnapshot.sort_order
      }, { signal: controller.signal });
      if (disposed || controller.signal.aborted) return;
      if (!res || res.total !== expectedTotal || !Array.isArray(res.items) ||
          res.items.length !== Math.min(pageSize, expectedTotal - allLogs.length)) {
        throw new Error('导出期间记录数量发生变化或分页不完整，已停止下载。请刷新后重试，或选择已结束的日期范围。');
      }
      for (const row of res.items) {
        if (!Number.isSafeInteger(row?.id) || row.id < 1 || seenIds.has(row.id)) {
          throw new Error('导出期间记录发生重复或数据无效，已停止下载。请刷新后重试，或选择已结束的日期范围。');
        }
        seenIds.add(row.id);
      }
      allLogs.push(...res.items);
      exportProgress.current = p;
    }
    if (allLogs.length !== expectedTotal) {
      throw new Error(`导出数据不完整：预计 ${expectedTotal} 条，实际仅收到 ${allLogs.length} 条。`);
    }
    const headers = [
      'Time',
      'API Key Name',
      'Model',
      'Reasoning Effort',
      'Inbound Endpoint',
      'IP Address',
      'Type',
      'Billing Mode',
      'Input Tokens',
      'Output Tokens',
      'Cache Read Tokens',
      'Cache Creation Tokens',
      'Rate Multiplier',
      'Billed Cost',
      'Original Cost',
      'First Token (ms)',
      'Duration (ms)'
    ];
    const rows = allLogs.map((log) => [
      log.created_at,
      log.api_key?.name || '',
      log.model,
      formatReasoningEffort(log.reasoning_effort),
      log.inbound_endpoint || '',
      log.ip_address || '',
      resolveUsageRequestType(log),
      getBillingModeLabel(getDisplayBillingMode(log)),
      log.input_tokens,
      log.output_tokens,
      log.cache_read_tokens,
      log.cache_creation_tokens,
      log.rate_multiplier,
      log.actual_cost?.toFixed(8) || '0.00000000',
      log.total_cost?.toFixed(8) || '0.00000000',
      log.first_token_ms ?? '',
      log.duration_ms ?? ''
    ].map(escapeCSV));

    const csvContent = [headers.map(escapeCSV).join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `usage_${startDate.value}_to_${endDate.value}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (err) {
    if (controller.signal.aborted || isAbortError(err)) return;
    exportError.value = err instanceof Error ? err.message : '导出失败，请重试。';
    console.error('Export CSV failed:', err);
  } finally {
    if (exportController === controller) {
      exporting.value = false;
      exportProgress.current = 0;
      exportProgress.total = 0;
    }
  }
};

// ==================== Chart Configurations ====================
const paletteColors = [
  '#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55',
  '#5856d6', '#00c7be', '#a2845e', '#64d2ff', '#30b0c7'
];

const modelChartData = computed(() => {
  const isCost = modelDistributionMetric.value === 'actual_cost';
  const labels = requestedModelStats.value.map((m) => m.model || 'Unknown');
  const values = requestedModelStats.value.map((m) => isCost ? (m.actual_cost ?? 0) : (m.total_tokens ?? 0));
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: paletteColors.slice(0, labels.length),
        borderWidth: 0
      }
    ]
  };
});

const groupChartData = computed(() => {
  const isCost = groupDistributionMetric.value === 'actual_cost';
  const labels = groupStats.value.map((g) => g.group_name || `Group #${g.group_id}`);
  const values = groupStats.value.map((g) => isCost ? (g.actual_cost ?? 0) : (g.total_tokens ?? 0));
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: paletteColors.slice(0, labels.length),
        borderWidth: 0
      }
    ]
  };
});

const endpointChartData = computed(() => {
  const isCost = endpointDistributionMetric.value === 'actual_cost';
  const labels = inboundEndpointStats.value.map((e) => e.endpoint || 'Unknown');
  const values = inboundEndpointStats.value.map((e) => isCost ? (e.actual_cost ?? 0) : (e.total_tokens ?? 0));
  return {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: paletteColors.slice(0, labels.length),
        borderWidth: 0
      }
    ]
  };
});

const trendChartData = computed(() => {
  const labels = trendData.value.map((d: TrendDataPoint) => d.date);
  return {
    labels,
    datasets: [
      {
        label: 'Prompt',
        data: trendData.value.map((d: TrendDataPoint) => d.input_tokens || 0),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2
      },
      {
        label: 'Completion',
        data: trendData.value.map((d: TrendDataPoint) => d.output_tokens || 0),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.08)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2
      },
      {
        label: 'Cache',
        data: trendData.value.map((d: TrendDataPoint) => (d.cache_read_tokens || 0) + (d.cache_creation_tokens || 0)),
        borderColor: '#0284c7',
        backgroundColor: 'rgba(2, 132, 199, 0.08)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2
      }
    ]
  };
});

const doughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: {
        boxWidth: 10,
        font: { size: 11 },
        color: '#8e8e93'
      }
    }
  },
  cutout: '70%'
};

const lineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
      labels: {
        boxWidth: 10,
        font: { size: 11 },
        color: '#8e8e93'
      }
    }
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { font: { size: 10 }, color: '#8e8e93', maxTicksLimit: 8 }
    },
    y: {
      grid: { color: 'rgba(128, 128, 128, 0.1)' },
      ticks: {
        font: { size: 10 },
        color: '#8e8e93',
        callback: (v: any) => formatTokensK(Number(v))
      }
    }
  }
};

const prevPage = () => {
  if (activeTab.value === 'usage') {
    if (pagination.page > 1) {
      pagination.page--;
      void loadLogs();
    }
  } else {
    if (errorPage.value > 1) {
      errorPage.value--;
      void loadErrors();
    }
  }
};

const nextPage = () => {
  if (activeTab.value === 'usage') {
    if (pagination.page * pagination.page_size < pagination.total) {
      pagination.page++;
      void loadLogs();
    }
  } else {
    if (errorPage.value * errorPageSize.value < errorTotal.value) {
      errorPage.value++;
      void loadErrors();
    }
  }
};

const onPageSizeChange = (e: Event) => {
  const sz = Number((e.target as HTMLSelectElement).value);
  if (activeTab.value === 'usage') {
    pagination.page_size = sz;
    pagination.page = 1;
    void loadLogs();
  } else {
    errorPageSize.value = sz;
    errorPage.value = 1;
    void loadErrors();
  }
};

// ==================== Lifecycle ====================
onMounted(() => {
  void loadFilterOptions();
  applyFilters();
});

onUnmounted(() => {
  disposed = true;
  logVersion += 1;
  logController?.abort();
  usageVersion += 1;
  usageController?.abort();
  errorVersion += 1;
  errorController?.abort();
  filterVersion += 1;
  filterController?.abort();
  detailVersion += 1;
  detailController?.abort();
  exportController?.abort();
});

watch(activeTab, (tab) => {
  if (tab === 'errors') {
    void loadErrors(beginErrorRequest());
  } else {
    applyFilters();
  }
});
</script>

<template>
  <div class="user-app-polish activity-app flex flex-col h-full bg-[#f8f9fa] dark:bg-[#1c1c1e] select-none text-[13px] overflow-hidden">
    <!-- Top macOS Unified Header Bar -->
    <div class="app-toolbar activity-toolbar h-12 px-4 border-b border-black/[0.08] dark:border-white/[0.08] flex items-center justify-between bg-white/75 dark:bg-[#252528]/80 backdrop-blur-md shrink-0 gap-3">
      <!-- Left: Tab Segmented Control -->
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('activity')" alt="使用记录" class="w-7 h-7 object-contain drop-shadow-sm" />
        <h1 class="app-title">使用记录</h1>
        <MacSegmented v-model="activeTab" :options="tabOptions" />
      </div>

      <!-- Center: Date Range Presets -->
      <div class="app-filterbar activity-date-filter flex items-center gap-1.5 bg-black/[0.04] dark:bg-white/[0.06] p-1 rounded-lg">
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
          :class="currentPreset === '24h' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-xs' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="setPreset('24h')"
        >
          近 24 小时
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
          :class="currentPreset === '7d' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-xs' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="setPreset('7d')"
        >
          近 7 天
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
          :class="currentPreset === '30d' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-xs' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="setPreset('30d')"
        >
          近 30 天
        </button>
        <button
          type="button"
          class="px-2.5 py-1 rounded text-xs font-medium transition-colors"
          :class="currentPreset === '90d' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-xs' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          @click="setPreset('90d')"
        >
          近 90 天
        </button>
        <div class="flex items-center gap-1 pl-1 border-l border-black/10 dark:border-white/10 text-xs">
          <input
            v-model="startDate"
            type="date"
            aria-label="开始日期"
            class="px-1.5 py-0.5 rounded bg-transparent text-xs text-black/75 dark:text-white/75 border border-black/10 dark:border-white/10 focus:outline-hidden"
            @change="onCustomDateChange"
          />
          <span class="text-black/40 dark:text-white/40">至</span>
          <input
            v-model="endDate"
            type="date"
            aria-label="结束日期"
            class="px-1.5 py-0.5 rounded bg-transparent text-xs text-black/75 dark:text-white/75 border border-black/10 dark:border-white/10 focus:outline-hidden"
            @change="onCustomDateChange"
          />
        </div>
      </div>

      <!-- Right: Controls -->
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1 text-xs text-black/60 dark:text-white/60">
          <span>粒度:</span>
          <select
            v-model="granularity"
            aria-label="图表粒度"
            class="px-2 py-1 rounded bg-black/[0.04] dark:bg-white/[0.08] text-xs font-medium text-black dark:text-white border-0 focus:ring-0 focus:outline-hidden cursor-pointer"
            @change="refreshData"
          >
            <option value="hour">按小时</option>
            <option value="day">按天</option>
          </select>
        </div>

        <button
          type="button"
          v-if="activeTab === 'usage'"
          class="flex items-center gap-1 p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-black/70 dark:text-white/70 transition-colors"
          :aria-label="showCharts ? '折叠图表' : '展开图表'"
          :aria-expanded="showCharts"
          :title="showCharts ? '折叠图表' : '展开图表'"
          @click="showCharts = !showCharts"
        >
          <svg class="w-4 h-4 transition-transform duration-200" :class="{ 'rotate-180': !showCharts }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="18 15 12 9 6 15" />
          </svg><span class="text-xs">图表</span>
        </button>

        <button
          type="button"
          class="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black dark:text-white flex items-center gap-1.5 transition-colors"
          aria-label="刷新使用记录"
          :disabled="loading || errorLoading"
          @click="refreshData"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading || errorLoading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>刷新</span>
        </button>
      </div>
    </div>

    <!-- Scrollable Workspace Body -->
    <div class="app-content activity-content flex-1 overflow-y-auto space-y-4" :aria-busy="loading || errorLoading">
      <div v-if="visibleLoadIssues" class="app-notice" data-tone="error" role="alert"><span>{{ visibleLoadIssues }}</span><button type="button" aria-label="重试加载使用记录" @click="refreshData" :disabled="loading || errorLoading">重试</button></div>
      <!-- 4 Metric Cards (Usage View) -->
      <div v-if="activeTab === 'usage' && usageStats" class="app-metric-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <!-- Card 1: Total Requests -->
        <div class="app-panel p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs flex items-center gap-3 shadow-2xs">
          <div class="w-10 h-10 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-black/50 dark:text-white/50">总请求数</div>
            <div class="text-[20px] font-bold font-mono text-black/90 dark:text-white/90 leading-tight">
              {{ usageStats?.total_requests?.toLocaleString() || 0 }}
            </div>
            <div class="text-[10.5px] text-black/40 dark:text-white/40 truncate">所选范围内</div>
          </div>
        </div>

        <!-- Card 2: Total Tokens -->
        <div class="app-panel p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs flex items-center gap-3 shadow-2xs">
          <div class="w-10 h-10 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-black/50 dark:text-white/50">总 Token</div>
            <div class="text-[20px] font-bold font-mono text-black/90 dark:text-white/90 leading-tight">
              {{ usageStats?.total_tokens?.toLocaleString() || 0 }}
            </div>
            <div class="text-[10.5px] text-black/40 dark:text-white/40 truncate">
              输入: {{ formatTokens(usageStats?.total_input_tokens) }} / 输出: {{ formatTokens(usageStats?.total_output_tokens) }} / 缓存: {{ formatTokens((usageStats?.total_cache_creation_tokens || 0) + (usageStats?.total_cache_read_tokens || 0)) }}
            </div>
          </div>
        </div>

        <!-- Card 3: Total Cost -->
        <div class="app-panel p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs flex items-center gap-3 shadow-2xs">
          <div class="w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="6" x2="12" y2="18" />
              <path d="M16 10a4 4 0 0 0-8 0c0 4 8 2 8 6a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-black/50 dark:text-white/50">总消费</div>
            <div class="text-[20px] font-bold font-mono text-emerald-600 dark:text-emerald-400 leading-tight">
              ${{ (usageStats?.total_actual_cost || 0).toFixed(4) }}
            </div>
            <div class="text-[10.5px] text-black/40 dark:text-white/40 truncate">
              标准 ${{ (usageStats?.total_cost || 0).toFixed(4) }}
            </div>
          </div>
        </div>

        <!-- Card 4: Avg Latency -->
        <div class="app-panel p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs flex items-center gap-3 shadow-2xs">
          <div class="w-10 h-10 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-[11px] font-medium text-black/50 dark:text-white/50">平均耗时</div>
            <div class="text-[20px] font-bold font-mono text-black/90 dark:text-white/90 leading-tight">
              {{ formatDuration(usageStats?.average_duration_ms || 0) }}
            </div>
            <div class="text-[10.5px] text-black/40 dark:text-white/40 truncate">所选范围内平均响应耗时</div>
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'usage' && showCharts" class="activity-analysis-control">
        <strong>用量分析</strong>
        <MacSegmented v-model="analysisView" :options="[{ label: '趋势', value: 'trend' }, { label: '模型', value: 'model' }, { label: '分组', value: 'group' }, { label: '端点', value: 'endpoint' }, { label: '全部', value: 'all' }]" />
      </div>
      <!-- 4 Collapsible Charts (Usage View) -->
      <div v-if="activeTab === 'usage' && showCharts" class="app-chart-grid grid grid-cols-1 lg:grid-cols-2 gap-3.5" :style="analysisView !== 'all' ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined">
        <!-- Chart 1: Model Distribution -->
        <div v-if="analysisView === 'model' || analysisView === 'all'" class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-semibold text-black/80 dark:text-white/80">模型分布</h4>
            <div class="flex items-center gap-1 bg-black/5 dark:bg-white/10 p-0.5 rounded-md text-[11px]">
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="modelDistributionMetric === 'tokens' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="modelDistributionMetric = 'tokens'"
              >
                按 Token
              </button>
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="modelDistributionMetric === 'actual_cost' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="modelDistributionMetric = 'actual_cost'"
              >
                按实际消费
              </button>
            </div>
          </div>
          <div class="h-48 relative flex items-center justify-center">
            <Doughnut v-if="requestedModelStats.length > 0" :data="modelChartData" :options="doughnutOptions" />
            <div v-else class="text-xs text-black/40 dark:text-white/40 flex flex-col items-center gap-1">
              <span>暂无数据</span>
            </div>
          </div>
        </div>

        <!-- Chart 2: Group Distribution -->
        <div v-if="analysisView === 'group' || analysisView === 'all'" class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-semibold text-black/80 dark:text-white/80">分组使用分布</h4>
            <div class="flex items-center gap-1 bg-black/5 dark:bg-white/10 p-0.5 rounded-md text-[11px]">
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="groupDistributionMetric === 'tokens' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="groupDistributionMetric = 'tokens'"
              >
                按 Token
              </button>
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="groupDistributionMetric === 'actual_cost' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="groupDistributionMetric = 'actual_cost'"
              >
                按实际消费
              </button>
            </div>
          </div>
          <div class="h-48 relative flex items-center justify-center">
            <Doughnut v-if="groupStats.length > 0" :data="groupChartData" :options="doughnutOptions" />
            <div v-else class="text-xs text-black/40 dark:text-white/40 flex flex-col items-center gap-1">
              <span>暂无数据</span>
            </div>
          </div>
        </div>

        <!-- Chart 3: Endpoint Distribution -->
        <div v-if="analysisView === 'endpoint' || analysisView === 'all'" class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-semibold text-black/80 dark:text-white/80">端点分布</h4>
            <div class="flex items-center gap-1 bg-black/5 dark:bg-white/10 p-0.5 rounded-md text-[11px]">
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="endpointDistributionMetric === 'tokens' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="endpointDistributionMetric = 'tokens'"
              >
                按 Token
              </button>
              <button
                type="button"
                class="px-2 py-0.5 rounded transition-colors"
                :class="endpointDistributionMetric === 'actual_cost' ? 'bg-white dark:bg-[#323235] text-black dark:text-white shadow-2xs font-medium' : 'text-black/60 dark:text-white/60'"
                @click="endpointDistributionMetric = 'actual_cost'"
              >
                按实际消费
              </button>
            </div>
          </div>
          <div class="h-48 relative flex items-center justify-center">
            <Doughnut v-if="inboundEndpointStats.length > 0" :data="endpointChartData" :options="doughnutOptions" />
            <div v-else class="text-xs text-black/40 dark:text-white/40 flex flex-col items-center gap-1">
              <span>暂无数据</span>
            </div>
          </div>
        </div>

        <!-- Chart 4: Token Usage Trend -->
        <div v-if="analysisView === 'trend' || analysisView === 'all'" class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs">
          <div class="flex items-center justify-between mb-3">
            <h4 class="text-xs font-semibold text-black/80 dark:text-white/80">Token 使用趋势</h4>
          </div>
          <div class="h-48 relative flex items-center justify-center">
            <Line v-if="trendData.length > 0" :data="trendChartData" :options="lineChartOptions" />
            <div v-else class="text-xs text-black/40 dark:text-white/40 flex flex-col items-center gap-1">
              <span>暂无数据</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Filter Controls Panel -->
      <div class="app-panel activity-filter-panel p-3.5 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs space-y-3">
        <!-- Usage Filters -->
        <div v-if="activeTab === 'usage'" class="flex flex-col gap-2.5">
          <!-- Row 1: Keys, Models, Groups -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">API 密钥</label>
              <select
                v-model="filters.api_key_id"
                aria-label="按 API 密钥筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyFilters"
              >
                <option :value="null">全部密钥</option>
                <option v-for="k in apiKeys" :key="k.id" :value="k.id">{{ k.name }}</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">模型</label>
              <select
                v-model="filters.model"
                aria-label="按模型筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyFilters"
              >
                <option value="">全部模型</option>
                <option v-for="m in modelOptionValues" :key="m" :value="m">{{ m }}</option>
              </select>
            </div>
            <div>
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">分组</label>
              <select
                v-model="filters.group_id"
                aria-label="按分组筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyFilters"
              >
                <option :value="null">全部分组</option>
                <option v-for="g in userGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
              </select>
            </div>
          </div>

          <!-- Row 2: Type, Compaction, Billing Type, Billing Mode, and Buttons -->
          <div class="flex flex-wrap items-end justify-between gap-3 pt-1">
            <div class="flex flex-wrap items-center gap-3">
              <div class="w-32">
                <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">类型</label>
                <select
                  v-model="filters.request_type"
                  aria-label="按请求类型筛选"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                  @change="applyFilters"
                >
                  <option :value="null">全部类型</option>
                  <option value="ws_v2">WS</option>
                  <option value="live">Live</option>
                  <option value="stream">流式</option>
                  <option value="sync">同步</option>
                </select>
              </div>

              <div class="w-36">
                <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">请求类别</label>
                <select
                  v-model="filters.native_compaction_v2"
                  aria-label="按请求类别筛选"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                  @change="applyFilters"
                >
                  <option :value="null">全部请求</option>
                  <option :value="true">仅原生压缩</option>
                </select>
              </div>

              <div class="w-36">
                <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">计费类型</label>
                <select
                  v-model="filters.billing_type"
                  aria-label="按计费类型筛选"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                  @change="applyFilters"
                >
                  <option :value="null">全部计费类型</option>
                  <option :value="0">余额计费</option>
                  <option :value="1">订阅计费</option>
                </select>
              </div>

              <div class="w-36">
                <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">计费模式</label>
                <select
                  v-model="filters.billing_mode"
                  aria-label="按计费模式筛选"
                  class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                  @change="applyFilters"
                >
                  <option :value="null">全部计费模式</option>
                  <option value="token">Token</option>
                  <option value="per_request">按次计费</option>
                  <option value="image">生图</option>
                  <option value="video">视频</option>
                </select>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center gap-2 relative">
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black/80 dark:text-white/80 transition-colors"
                @click="resetFilters"
              >
                重置
              </button>

              <!-- Column Settings Dropdown -->
              <div class="relative">
                <button
                  type="button"
                  class="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black/80 dark:text-white/80 flex items-center gap-1.5 transition-colors"
                  @click="showColumnDropdown = !showColumnDropdown"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
                  <span>列设置</span>
                </button>
                <div
                  v-if="showColumnDropdown"
                  class="absolute right-0 top-full mt-1 w-44 rounded-xl border border-black/[0.1] dark:border-white/[0.1] bg-white dark:bg-[#2c2c2e] shadow-xl py-1 z-50 text-xs"
                >
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>API 密钥</span>
                    <input type="checkbox" v-model="visibleColumns.api_key" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>模型</span>
                    <input type="checkbox" v-model="visibleColumns.model" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>推理强度</span>
                    <input type="checkbox" v-model="visibleColumns.reasoning_effort" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>端点</span>
                    <input type="checkbox" v-model="visibleColumns.endpoint" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>IP 地址</span>
                    <input type="checkbox" v-model="visibleColumns.ip_address" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>分组</span>
                    <input type="checkbox" v-model="visibleColumns.group" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>类型</span>
                    <input type="checkbox" v-model="visibleColumns.stream" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>计费模式</span>
                    <input type="checkbox" v-model="visibleColumns.billing_mode" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>Token</span>
                    <input type="checkbox" v-model="visibleColumns.tokens" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>费用</span>
                    <input type="checkbox" v-model="visibleColumns.cost" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>延迟</span>
                    <input type="checkbox" v-model="visibleColumns.latency" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>时间</span>
                    <input type="checkbox" v-model="visibleColumns.created_at" class="rounded" />
                  </label>
                  <label class="flex items-center justify-between px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer">
                    <span>User-Agent</span>
                    <input type="checkbox" v-model="visibleColumns.user_agent" class="rounded" />
                  </label>
                </div>
              </div>

              <!-- Export CSV Button -->
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg bg-[#007aff] hover:bg-[#0071e3] text-xs font-medium text-white shadow-xs flex items-center gap-1.5 transition-colors disabled:opacity-50"
                aria-label="导出使用记录 CSV"
                :disabled="exporting || pagination.total === 0"
                @click="exportToCSV"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{{ exporting ? '导出中...' : '导出 CSV' }}</span>
              </button>
              <span v-if="exporting" class="activity-export-status text-[11px] text-black/50 dark:text-white/50" role="status" aria-live="polite">
                正在导出 {{ exportProgress.current }}/{{ exportProgress.total }} 页
              </span>
              <span v-else-if="exportError" class="activity-export-status flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400" role="alert">
                {{ exportError }}
                <button type="button" class="font-medium underline" @click="exportToCSV">重试</button>
              </span>
            </div>
          </div>
        </div>

        <!-- Error Filters -->
        <div v-else class="flex flex-wrap items-end justify-between gap-3">
          <div class="flex flex-wrap items-center gap-3">
            <div class="w-44">
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">Key 名称</label>
              <select
                v-model="errorFilter.api_key_id"
                aria-label="错误请求按 API 密钥筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyErrorFilters"
              >
                <option :value="null">全部 Key</option>
                <option v-for="k in apiKeys" :key="k.id" :value="k.id">{{ k.name }}</option>
              </select>
            </div>

            <div class="w-44">
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">模型</label>
              <input
                v-model="errorFilter.model"
                type="text"
                aria-label="错误请求按模型筛选"
                placeholder="搜索模型"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @keyup.enter="applyErrorFilters"
              />
            </div>

            <div class="w-44">
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">分类</label>
              <select
                v-model="errorFilter.category"
                aria-label="错误请求按分类筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyErrorFilters"
              >
                <option v-for="c in errorCategoryOptions" :key="c.value" :value="c.value">{{ c.label }}</option>
              </select>
            </div>

            <div class="w-40">
              <label class="block text-[11px] font-medium text-black/60 dark:text-white/60 mb-1">状态码</label>
              <select
                v-model="errorFilter.status_code"
                aria-label="错误请求按状态码筛选"
                class="w-full px-2.5 py-1.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.08] text-xs text-black/90 dark:text-white/90 border border-black/10 dark:border-white/10 focus:outline-hidden"
                @change="applyErrorFilters"
              >
                <option :value="null">全部状态码</option>
                <option v-for="sc in COMMON_ERROR_STATUS_CODES" :key="sc" :value="sc">{{ sc }}</option>
              </select>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black/80 dark:text-white/80 transition-colors"
              @click="applyErrorFilters"
            >
              查询
            </button>
            <button
              type="button"
              class="px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black/80 dark:text-white/80 transition-colors"
              @click="resetFilters"
            >
              重置
            </button>
          </div>
        </div>
      </div>

      <!-- Table Section -->
      <div class="activity-table-shell rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-[#252528]/70 backdrop-blur-xs overflow-hidden shadow-2xs flex flex-col">
        <!-- Table Subtoolbar -->
        <div class="px-4 py-2 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between bg-black/[0.01]">
          <div class="text-xs text-black/50 dark:text-white/50">
            共 <strong class="font-mono text-black dark:text-white">{{ activeTab === 'usage' ? pagination.total : errorTotal }}</strong> 条记录
          </div>
          <button
            type="button"
            class="text-xs text-[#007aff] hover:underline font-medium flex items-center gap-1 disabled:opacity-50"
            :disabled="ipGeoBatchLoading"
            @click="handleBatchFetchIpGeo"
          >
            <svg class="w-3 h-3" :class="{ 'animate-spin': ipGeoBatchLoading }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            <span>{{ ipGeoBatchLoading ? '获取中...' : '批量获取地区' }}</span>
          </button>
        </div>

        <!-- Usage Table -->
        <div v-if="activeTab === 'usage'" class="overflow-x-auto min-h-[300px]">
          <table class="app-table w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr class="border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] text-black/50 dark:text-white/50 font-medium">
                <th v-if="visibleColumns.api_key" class="py-2.5 px-3">API 密钥</th>
                <th v-if="visibleColumns.model" class="py-2.5 px-3 cursor-pointer hover:text-black dark:hover:text-white" @click="toggleSort('model')">
                  <div class="flex items-center gap-1">
                    <span>模型</span>
                    <span class="text-[10px]">↕</span>
                  </div>
                </th>
                <th v-if="visibleColumns.reasoning_effort" class="py-2.5 px-3">推理强度</th>
                <th v-if="visibleColumns.endpoint" class="py-2.5 px-3">端点</th>
                <th v-if="visibleColumns.ip_address" class="py-2.5 px-3">IP</th>
                <th v-if="visibleColumns.group" class="py-2.5 px-3">分组</th>
                <th v-if="visibleColumns.stream" class="py-2.5 px-3">类型</th>
                <th v-if="visibleColumns.billing_mode" class="py-2.5 px-3">计费模式</th>
                <th v-if="visibleColumns.tokens" class="py-2.5 px-3">TOKEN</th>
                <th v-if="visibleColumns.cost" class="py-2.5 px-3">费用</th>
                <th v-if="visibleColumns.latency" class="py-2.5 px-3">延迟</th>
                <th v-if="visibleColumns.created_at" class="py-2.5 px-3 cursor-pointer hover:text-black dark:hover:text-white" @click="toggleSort('created_at')">
                  <div class="flex items-center gap-1">
                    <span>时间</span>
                    <span class="text-[10px]">↕</span>
                  </div>
                </th>
                <th v-if="visibleColumns.user_agent" class="py-2.5 px-3">User-Agent</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              <!-- Empty State -->
              <tr v-if="usageLogs.length === 0 && !loading">
                <td :colspan="13" class="py-16 text-center text-black/40 dark:text-white/40 select-none">
                  <div class="w-12 h-12 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] flex items-center justify-center mx-auto mb-2 text-black/30 dark:text-white/30">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                    </svg>
                  </div>
                  <p class="text-xs font-medium">未找到使用记录，请尝试调整筛选条件。</p>
                </td>
              </tr>

              <!-- Loading State -->
              <tr v-else-if="loading">
                <td :colspan="13" class="py-16 text-center text-black/40 dark:text-white/40">
                  <div class="flex items-center justify-center gap-2">
                    <svg class="w-4 h-4 animate-spin text-[#007aff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>正在加载使用记录...</span>
                  </div>
                </td>
              </tr>

              <!-- Data Rows -->
              <tr
                v-for="log in usageLogs"
                :key="log.id"
                class="activity-table-row hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${log.model || '使用记录'} 详情`"
                @click="openUsageDetail(log)"
                @keydown.enter.stop="openUsageDetail(log)"
                @keydown.space.prevent.stop="openUsageDetail(log)"
              >
                <!-- API Key -->
                <td v-if="visibleColumns.api_key" class="py-2 px-3 font-medium text-black/85 dark:text-white/85">
                  {{ log.api_key?.name || '-' }}
                </td>

                <!-- Model -->
                <td v-if="visibleColumns.model" class="py-2 px-3">
                  <div class="space-y-0.5">
                    <div class="font-medium text-black/90 dark:text-white/90">{{ log.model }}</div>
                    <div v-if="(log as any).upstream_model && (log as any).upstream_model !== log.model" class="text-[11px] text-black/40 dark:text-white/40">
                      ↳ {{ (log as any).upstream_model }}
                    </div>
                  </div>
                </td>

                <!-- Reasoning Effort -->
                <td v-if="visibleColumns.reasoning_effort" class="py-2 px-3">
                  <span class="text-black/75 dark:text-white/75">{{ formatReasoningEffort(log.reasoning_effort) }}</span>
                </td>

                <!-- Endpoint -->
                <td v-if="visibleColumns.endpoint" class="py-2 px-3 text-[11.5px] max-w-[200px] truncate text-black/60 dark:text-white/60" :title="log.inbound_endpoint || ''">
                  {{ log.inbound_endpoint || '-' }}
                </td>

                <!-- IP Address -->
                <td v-if="visibleColumns.ip_address" class="py-2 px-3">
                  <div class="flex flex-col gap-0.5">
                    <span class="font-mono text-[11px] text-black/70 dark:text-white/70">{{ log.ip_address || '-' }}</span>
                    <span v-if="getIpGeoEntry(log.ip_address).label" class="text-[10px] text-black/45 dark:text-white/45">
                      {{ getIpGeoEntry(log.ip_address).label }}
                    </span>
                  </div>
                </td>

                <!-- Group -->
                <td v-if="visibleColumns.group" class="py-2 px-3">
                  <span v-if="log.group" class="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300">
                    {{ log.group.name }}
                  </span>
                  <span v-else class="text-black/30 dark:text-white/30">-</span>
                </td>

                <!-- Type -->
                <td v-if="visibleColumns.stream" class="py-2 px-3">
                  <div class="flex items-center gap-1">
                    <span
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                      :class="requestTypeBadgeClass(resolveUsageRequestType(log))"
                    >
                      {{ requestTypeLabel(resolveUsageRequestType(log)) }}
                    </span>
                    <span
                      v-if="log.native_compaction_v2"
                      class="inline-flex items-center px-1 py-0.5 rounded text-[9.5px] font-medium bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-300"
                    >
                      压缩
                    </span>
                  </div>
                </td>

                <!-- Billing Mode -->
                <td v-if="visibleColumns.billing_mode" class="py-2 px-3">
                  <span
                    class="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium"
                    :class="getBillingModeBadgeClass(getDisplayBillingMode(log))"
                  >
                    {{ getBillingModeLabel(getDisplayBillingMode(log)) }}
                  </span>
                </td>

                <!-- Tokens -->
                <td v-if="visibleColumns.tokens" class="py-2 px-3" @mouseenter="onTokenMouseEnter($event, log)" @mouseleave="onTokenMouseLeave">
                  <div v-if="isImageUsage(log)" class="text-purple-600 dark:text-purple-400 font-medium">
                    {{ log.image_count }} 张
                  </div>
                  <div v-else class="flex flex-col font-mono text-[11px] leading-tight">
                    <div class="text-black/90 dark:text-white/90">
                      ↓{{ (log.input_tokens || 0).toLocaleString() }} ↑{{ (log.output_tokens || 0).toLocaleString() }}
                    </div>
                    <div v-if="(log.cache_read_tokens || 0) > 0 || (log.cache_creation_tokens || 0) > 0" class="text-[10px] text-sky-600 dark:text-sky-400">
                      C: {{ ((log.cache_read_tokens || 0) + (log.cache_creation_tokens || 0)).toLocaleString() }}
                    </div>
                  </div>
                </td>

                <!-- Cost -->
                <td v-if="visibleColumns.cost" class="py-2 px-3" @mouseenter="onCostMouseEnter($event, log)" @mouseleave="onCostMouseLeave">
                  <div class="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    ${{ (log.actual_cost || 0).toFixed(6) }}
                  </div>
                </td>

                <!-- Latency -->
                <td v-if="visibleColumns.latency" class="py-2 px-3">
                  <div class="flex items-center gap-1.5 font-mono text-[11px]">
                    <span
                      class="w-1 h-3 rounded-full"
                      :class="log.first_token_ms != null ? LATENCY_BAR_FROM_CLASSES[firstTokenSeverity(log.first_token_ms)] : LATENCY_BAR_CLASSES[durationSeverity(log.duration_ms || 0)]"
                    ></span>
                    <span :class="LATENCY_TEXT_CLASSES[durationSeverity(log.duration_ms || 0)]">
                      {{ formatDuration(log.duration_ms) }}
                    </span>
                  </div>
                </td>

                <!-- Time -->
                <td v-if="visibleColumns.created_at" class="py-2 px-3 font-mono text-[11px] text-black/60 dark:text-white/60">
                  {{ formatDateTime(log.created_at) }}
                </td>

                <!-- User-Agent -->
                <td v-if="visibleColumns.user_agent" class="py-2 px-3 max-w-[180px] truncate text-[11px] text-black/50 dark:text-white/50" :title="log.user_agent || ''">
                  {{ log.user_agent || '-' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Errors Table -->
        <div v-else class="overflow-x-auto min-h-[300px]">
          <table class="app-table w-full text-left text-xs whitespace-nowrap">
            <thead>
              <tr class="border-b border-black/[0.06] dark:border-white/[0.06] bg-black/[0.02] text-black/50 dark:text-white/50 font-medium">
                <th class="py-2.5 px-3">Key 名称</th>
                <th class="py-2.5 px-3">模型</th>
                <th class="py-2.5 px-3">端点</th>
                <th class="py-2.5 px-3">IP</th>
                <th class="py-2.5 px-3">分类</th>
                <th class="py-2.5 px-3">状态码</th>
                <th class="py-2.5 px-3">错误信息</th>
                <th class="py-2.5 px-3">时间</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
              <!-- Empty State -->
              <tr v-if="errorRows.length === 0 && !errorLoading">
                <td :colspan="8" class="py-16 text-center text-black/40 dark:text-white/40 select-none">
                  <div class="w-12 h-12 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] flex items-center justify-center mx-auto mb-2 text-black/30 dark:text-white/30">
                    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                  </div>
                  <p class="text-xs font-medium">暂无错误请求</p>
                </td>
              </tr>

              <!-- Loading State -->
              <tr v-else-if="errorLoading">
                <td :colspan="8" class="py-16 text-center text-black/40 dark:text-white/40">
                  <div class="flex items-center justify-center gap-2">
                    <svg class="w-4 h-4 animate-spin text-[#007aff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    <span>正在加载错误记录...</span>
                  </div>
                </td>
              </tr>

              <!-- Data Rows -->
              <tr
                v-for="err in errorRows"
                :key="err.id"
                class="activity-table-row hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
                role="button"
                tabindex="0"
                :aria-label="`查看 ${err.model || '错误请求'} 详情`"
                @click="openErrorDetail(err.id)"
                @keydown.enter.stop="openErrorDetail(err.id)"
                @keydown.space.prevent.stop="openErrorDetail(err.id)"
              >
                <td class="py-2 px-3 font-medium text-black/85 dark:text-white/85">{{ err.key_name || '-' }}</td>
                <td class="py-2 px-3 font-medium text-black/90 dark:text-white/90">{{ err.model || '-' }}</td>
                <td class="py-2 px-3 text-[11.5px] max-w-[200px] truncate text-black/60 dark:text-white/60" :title="err.inbound_endpoint || ''">{{ err.inbound_endpoint || '-' }}</td>
                <td class="py-2 px-3 font-mono text-[11px] text-black/70 dark:text-white/70">{{ err.client_ip || '-' }}</td>
                <td class="py-2 px-3">
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-black/5 dark:bg-white/10 text-black/75 dark:text-white/75">
                    {{ errorCategoryLabels[err.category] || err.category }}
                  </span>
                </td>
                <td class="py-2 px-3">
                  <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold" :class="statusCodeBadgeClass(err.status_code)">
                    {{ err.status_code }}
                  </span>
                </td>
                <td class="py-2 px-3 max-w-[260px] truncate text-black/60 dark:text-white/60" :title="err.message || ''">{{ err.message || '-' }}</td>
                <td class="py-2 px-3 font-mono text-[11px] text-black/60 dark:text-white/60">{{ formatDateTime(err.created_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination Bar -->
        <div class="px-4 py-2.5 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between bg-black/[0.01]">
          <div class="text-xs text-black/50 dark:text-white/50">
            第 {{ activeTab === 'usage' ? pagination.page : errorPage }} 页 · 每页
            <select
              :value="activeTab === 'usage' ? pagination.page_size : errorPageSize"
              aria-label="每页显示条数"
              class="mx-1 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 text-black dark:text-white border-0 text-xs cursor-pointer focus:outline-hidden"
              @change="onPageSizeChange"
            >
              <option :value="10">10</option>
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
            条
          </div>

          <div class="flex items-center gap-1.5">
            <button
              type="button"
              class="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black dark:text-white transition-colors disabled:opacity-40"
              :disabled="activeTab === 'usage' ? pagination.page <= 1 : errorPage <= 1"
              @click="prevPage"
            >
              上一页
            </button>
            <button
              type="button"
              class="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-xs font-medium text-black dark:text-white transition-colors disabled:opacity-40"
              :disabled="activeTab === 'usage' ? pagination.page * pagination.page_size >= pagination.total : errorPage * errorPageSize >= errorTotal"
              @click="nextPage"
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Usage Detail Sheet -->
    <MacSheet :show="showUsageDetailSheet" title="使用记录详情" @close="showUsageDetailSheet = false">
      <div v-if="selectedUsageLog" class="usage-detail-content p-6 space-y-5 text-xs">
        <div class="grid grid-cols-2 gap-4 p-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">请求 ID</span>
            <div class="flex items-center gap-1.5 font-mono">
              <span class="font-medium text-black/90 dark:text-white/90 truncate">{{ selectedUsageLog.request_id || '-' }}</span>
              <button
                v-if="selectedUsageLog.request_id"
                type="button"
                class="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white"
                @click="copyText(selectedUsageLog.request_id, 'sheet-req-id')"
              >
                {{ copiedKey === 'sheet-req-id' ? '✓' : '⧉' }}
              </button>
            </div>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">请求时间</span>
            <span class="font-mono text-black/90 dark:text-white/90">{{ formatDateTime(selectedUsageLog.created_at) }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">API 密钥</span>
            <span class="font-medium text-black/90 dark:text-white/90">{{ selectedUsageLog.api_key?.name || '-' }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">所属分组</span>
            <span class="text-black/90 dark:text-white/90">{{ selectedUsageLog.group?.name || '-' }}</span>
          </div>
        </div>

        <!-- Models & Endpoints -->
        <div class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] space-y-3">
          <div class="flex justify-between items-center pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
            <span class="font-semibold text-black/70 dark:text-white/70">路由与端点信息</span>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">请求模型</span>
              <span class="font-medium text-black/90 dark:text-white/90">{{ selectedUsageLog.model }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">上游模型</span>
              <span class="font-medium text-black/90 dark:text-white/90">{{ (selectedUsageLog as any).upstream_model || selectedUsageLog.model }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">入站端点</span>
              <span class="font-mono text-black/80 dark:text-white/80 break-all">{{ selectedUsageLog.inbound_endpoint || '-' }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">上游端点</span>
              <span class="font-mono text-black/80 dark:text-white/80 break-all">{{ selectedUsageLog.upstream_endpoint || '-' }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">客户端 IP</span>
              <span class="font-mono text-black/80 dark:text-white/80">{{ selectedUsageLog.ip_address || '-' }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">User-Agent</span>
              <span class="text-black/80 dark:text-white/80 break-all">{{ selectedUsageLog.user_agent || '-' }}</span>
            </div>
          </div>
        </div>

        <!-- Token & Cost Details -->
        <div class="app-panel p-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] space-y-3">
          <div class="flex justify-between items-center pb-2 border-b border-black/[0.06] dark:border-white/[0.06]">
            <span class="font-semibold text-black/70 dark:text-white/70">Token 与消费细项</span>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">输入 Token</span>
              <span class="font-mono font-medium text-black/90 dark:text-white/90">{{ (selectedUsageLog.input_tokens || 0).toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">输出 Token</span>
              <span class="font-mono font-medium text-black/90 dark:text-white/90">{{ (selectedUsageLog.output_tokens || 0).toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">总 Token</span>
              <span class="font-mono font-medium text-blue-600 dark:text-blue-400">{{ ((selectedUsageLog.input_tokens || 0) + (selectedUsageLog.output_tokens || 0) + (selectedUsageLog.cache_read_tokens || 0) + (selectedUsageLog.cache_creation_tokens || 0)).toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">缓存读取</span>
              <span class="font-mono text-black/90 dark:text-white/90">{{ (selectedUsageLog.cache_read_tokens || 0).toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">缓存写入</span>
              <span class="font-mono text-black/90 dark:text-white/90">{{ (selectedUsageLog.cache_creation_tokens || 0).toLocaleString() }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">实际扣除金额</span>
              <span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">${{ (selectedUsageLog.actual_cost || 0).toFixed(6) }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">首 Token 耗时</span>
              <span class="font-mono text-black/90 dark:text-white/90">{{ selectedUsageLog.first_token_ms ? `${selectedUsageLog.first_token_ms}ms` : '-' }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">总响应耗时</span>
              <span class="font-mono text-black/90 dark:text-white/90">{{ formatDuration(selectedUsageLog.duration_ms) }}</span>
            </div>
            <div>
              <span class="text-black/50 dark:text-white/50 block mb-0.5">倍率乘数</span>
              <span class="font-mono text-black/90 dark:text-white/90">{{ selectedUsageLog.rate_multiplier }}x</span>
            </div>
          </div>
        </div>
      </div>
    </MacSheet>

    <!-- Error Detail Sheet -->
    <MacSheet :show="showErrorDetailSheet" title="错误请求详情" @close="closeErrorDetail">
      <div v-if="errorDetailLoading" class="p-12 text-center text-black/40 dark:text-white/40">
        <div class="flex items-center justify-center gap-2">
          <svg class="w-4 h-4 animate-spin text-[#007aff]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>正在加载错误请求详情...</span>
        </div>
      </div>
      <div v-else-if="detailIssue" class="p-8 text-center text-sm text-red-600 dark:text-red-400" role="alert">
        <p>{{ detailIssue }}</p>
        <button type="button" class="mt-3 px-3 py-1.5 rounded-lg bg-black/5 dark:bg-white/10 text-xs font-medium text-black/80 dark:text-white/80" @click="retryErrorDetail">重试</button>
      </div>
      <div v-else-if="selectedErrorDetail" class="p-6 space-y-4 text-xs">
        <div class="grid grid-cols-2 gap-4 p-4 rounded-xl bg-black/[0.03] dark:bg-white/[0.04]">
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">时间</span>
            <span class="font-mono text-black/90 dark:text-white/90">{{ formatDateTime(selectedErrorDetail.created_at) }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">模型</span>
            <span class="font-medium text-black/90 dark:text-white/90">{{ selectedErrorDetail.model || '-' }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">端点</span>
            <span class="font-mono text-black/90 dark:text-white/90">{{ selectedErrorDetail.inbound_endpoint || '-' }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">状态码</span>
            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono font-bold" :class="statusCodeBadgeClass(selectedErrorDetail.status_code)">
              {{ selectedErrorDetail.status_code }}
            </span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">分类</span>
            <span class="text-black/90 dark:text-white/90">{{ errorCategoryLabels[selectedErrorDetail.category] || selectedErrorDetail.category }}</span>
          </div>
          <div>
            <span class="text-black/50 dark:text-white/50 block mb-0.5">平台</span>
            <span class="text-black/90 dark:text-white/90">{{ selectedErrorDetail.platform || '-' }}</span>
          </div>
          <div v-if="selectedErrorDetail.upstream_status_code != null">
            <span class="text-black/50 dark:text-white/50 block mb-0.5">上游状态码</span>
            <span class="font-mono font-medium text-orange-600 dark:text-orange-400">{{ selectedErrorDetail.upstream_status_code }}</span>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="selectedErrorDetail.message" class="p-3 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
          <div class="font-semibold mb-1">错误消息:</div>
          <div class="break-all font-mono leading-relaxed">{{ selectedErrorDetail.message }}</div>
        </div>

        <!-- Error Body -->
        <div v-if="selectedErrorDetail.error_body" class="space-y-1.5">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-black/70 dark:text-white/70">上游响应内容:</span>
            <button
              type="button"
              class="px-2 py-0.5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] font-medium text-black/70 dark:text-white/70 transition-colors"
              @click="copyText(selectedErrorDetail.error_body, 'err-body')"
            >
              {{ copiedKey === 'err-body' ? '已复制' : '复制响应' }}
            </button>
          </div>
          <pre class="p-3 rounded-lg bg-black/[0.05] dark:bg-black/30 border border-black/10 dark:border-white/10 font-mono text-[11px] leading-relaxed overflow-x-auto max-h-60 whitespace-pre-wrap break-all text-black/80 dark:text-white/80 select-text">{{ selectedErrorDetail.error_body }}</pre>
        </div>
      </div>
    </MacSheet>
  </div>
</template>

<style scoped>
.activity-analysis-control { display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px; }.activity-analysis-control :deep(.mac-segmented) { max-width:100%;overflow-x:auto; }
.usage-detail-content { padding:16px; }.usage-detail-content > .app-panel { box-shadow:none; }.usage-detail-content :deep(.grid) { min-width:0; }.usage-detail-content :deep(.grid > div) { min-width:0;overflow-wrap:anywhere; }
@container app-window (max-width:500px) { .usage-detail-content :deep(.grid-cols-3) { grid-template-columns:repeat(2,minmax(0,1fr)); } }

.activity-app :is(button, input, select):focus-visible {
  outline: 2px solid rgba(0, 122, 255, 0.72);
  outline-offset: 2px;
}

.activity-app .activity-table-row:focus-visible {
  outline: 2px solid rgba(0, 122, 255, 0.72);
  outline-offset: -2px;
}

.activity-export-status {
  max-width: 28rem;
}

@container app-window (max-width: 760px) {
  .activity-app .activity-toolbar {
    height: auto;
    min-height: 3rem;
    flex-wrap: wrap;
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .activity-app .activity-date-filter {
    order: 3;
    width: 100%;
    justify-content: center;
  }
}

@container app-window (max-width: 520px) {
  .activity-app .activity-toolbar {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }

  .activity-app .activity-toolbar > :first-child,
  .activity-app .activity-toolbar > :nth-child(2),
  .activity-app .activity-toolbar > :last-child {
    width: 100%;
  }

  .activity-app .activity-toolbar > :first-child {
    justify-content: space-between;
  }

  .activity-app .activity-toolbar > :last-child {
    justify-content: flex-end;
  }

  .activity-app .activity-date-filter {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .activity-app .activity-content {
    padding: 0.75rem;
  }

  .activity-app .activity-filter-panel {
    padding: 0.75rem;
  }

  .activity-app .activity-filter-panel .grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .activity-app .activity-filter-panel .w-32,
  .activity-app .activity-filter-panel .w-36,
  .activity-app .activity-filter-panel .w-40,
  .activity-app .activity-filter-panel .w-44 {
    width: 100%;
  }

  .activity-app .activity-export-status {
    width: 100%;
    max-width: none;
  }
}
</style>
