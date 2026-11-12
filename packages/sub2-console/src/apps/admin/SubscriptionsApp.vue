<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, shallowRef, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import { adminError, collectAdminPages } from './admin-feedback';
import type { WindowInstance } from '@sub2-mac/core';
defineProps<{ win?: WindowInstance }>();
import * as subsAPI from '../../api/admin/subscriptions';
import type { SubscriptionBulkAction, SubscriptionBulkActionRequest, SubscriptionBulkActionResult, BulkAssignSubscriptionResult } from '../../api/admin/subscriptions';
import * as groupsAPI from '../../api/admin/groups';
import * as usersAPI from '../../api/admin/users';
import type { UserSubscription, AdminGroup, AdminUser } from '@/types';
const extensionGuard = shallowRef<Awaited<ReturnType<typeof subsAPI.createExtensionWriteGuard>>>();
let incrementalDisposed = false;
onMounted(async () => {
  try {
    const guard = await subsAPI.createExtensionWriteGuard();
    if (incrementalDisposed) { guard.dispose(); return; }
    extensionGuard.value = guard;
    if (showExtendModal.value && targetSub.value) guard.reset(targetSub.value.id);
  } catch { if (!incrementalDisposed) actionError.value = '操作保护暂不可用，请关闭并重新打开窗口。'; }
});
onUnmounted(() => { incrementalDisposed = true; if (extensionGuard.value) extensionGuard.value.dispose(); });

const subscriptions = ref<UserSubscription[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const saving = ref(false);
const auxReady = ref(false);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
let loadVersion = 0;

// Filters
const searchQuery = ref('');
const statusFilter = ref<string>('active');
const groupFilter = ref<string>('');
const platformFilter = ref<string>('');

// Auxiliary data
const groups = ref<AdminGroup[]>([]);
const users = ref<AdminUser[]>([]);

// Modals
const showAssignModal = ref(false);
const showExtendModal = ref(false);
watch(showExtendModal, show => { if (!show && extensionGuard.value) extensionGuard.value.reset(); }, { flush: 'sync' });
const targetSub = ref<UserSubscription | null>(null);

// Assign Form
const assignForm = ref({
  user_id: 1,
  group_id: 1,
  expires_in_days: 30
});

// Extend Form
const extendDays = ref(30);

// ==================== 批量操作（上游 BulkSubscriptionActionDialog 照抄） ====================
interface BulkSubscriptionOperation {
  request: SubscriptionBulkActionRequest
  key: string
  storageKey: string | null
  outcomeUncertain: boolean
}
const bulkPendingKeys = new Map<string, string>();
function bulkCurrentAdminId(): number | null {
  try {
    const user = JSON.parse(localStorage.getItem('auth_user') || 'null') as { id?: unknown } | null;
    const id = user?.id;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}
function readStoredBulkKey(storageKey: string): string | null {
  try { return sessionStorage.getItem(storageKey); } catch { return null; }
}
function storeBulkKey(storageKey: string, key: string | null) {
  try {
    if (key) sessionStorage.setItem(storageKey, key);
    else sessionStorage.removeItem(storageKey);
  } catch { /* 存储不可用时，同一页面内的重试仍由内存中的键保护。 */ }
}
/** 请求体先规范化（去重后升序），结果未知时保留键与冻结请求体，重试沿用同一键。 */
function prepareBulkSubscriptionOperation(input: SubscriptionBulkActionRequest): BulkSubscriptionOperation {
  const request: SubscriptionBulkActionRequest = {
    subscription_ids: [...new Set(input.subscription_ids)].sort((a, b) => a - b),
    action: input.action
  };
  if (input.action === 'extend') request.days = input.days;
  if (input.action === 'reset_quota') {
    request.daily = !!input.daily;
    request.weekly = !!input.weekly;
    request.monthly = !!input.monthly;
  }
  const adminId = bulkCurrentAdminId();
  const storageKey = adminId ? `sub2api:admin:subscription-bulk:${adminId}:${JSON.stringify(request)}` : null;
  let key = storageKey ? bulkPendingKeys.get(storageKey) ?? readStoredBulkKey(storageKey) : null;
  const outcomeUncertain = !!key;
  if (!key) {
    const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    key = `subscription-bulk-${adminId ?? 'unknown'}-${requestId}`;
  }
  if (storageKey) {
    bulkPendingKeys.set(storageKey, key);
    storeBulkKey(storageKey, key);
  }
  return { request, key, storageKey, outcomeUncertain };
}
function completeBulkSubscriptionOperation(operation: BulkSubscriptionOperation): void {
  if (!operation.storageKey) return;
  bulkPendingKeys.delete(operation.storageKey);
  storeBulkKey(operation.storageKey, null);
}
/** 批量提交前校验：返回错误文案，空串表示通过。 */
function validateBulkAction(targetCount: number, action: SubscriptionBulkAction, days: number | string, windows: { daily: boolean; weekly: boolean; monthly: boolean }): string {
  if (targetCount === 0) return '请先选择可执行该操作的订阅。';
  if (targetCount > 100) return '一次最多处理 100 条订阅。';
  if (action === 'extend') {
    const value = Number(days);
    if (!Number.isInteger(value) || value === 0 || Math.abs(value) > 36500) return '天数须为非零整数，且绝对值不超过 36500 天。';
  }
  if (action === 'reset_quota' && !windows.daily && !windows.weekly && !windows.monthly) return '请至少选择一个重置窗口。';
  return '';
}

// 批量选择跨页保留：选择状态按订阅 ID 集合保存，翻页/筛选后不清空。
// 已选行的邮箱/分组/状态以快照随 ID 保存，批量弹窗与可操作计数才能覆盖不在当前页的已选项；
// 快照在列表刷新时以当页最新行更新，批量执行后只移除已成功的 ID，失败的保留以便重试。
const selectedIds = ref<number[]>([]);
const selectedSubs = ref(new Map<number, UserSubscription>());
function isSelected(id: number): boolean { return selectedIds.value.includes(id); }
function toggleSelection(id: number): void {
  if (isSelected(id)) {
    selectedIds.value = selectedIds.value.filter(x => x !== id);
    selectedSubs.value.delete(id);
  } else {
    selectedIds.value = [...selectedIds.value, id];
    const row = subscriptions.value.find(s => s.id === id);
    if (row) selectedSubs.value.set(id, row);
  }
}
const pageAllSelected = computed(() => subscriptions.value.length > 0 && subscriptions.value.every(s => isSelected(s.id)));
function clearSelection(): void {
  selectedIds.value = [];
  selectedSubs.value.clear();
}
function togglePageSelection(): void {
  if (pageAllSelected.value) {
    selectedIds.value = selectedIds.value.filter(id => !subscriptions.value.some(s => s.id === id));
    for (const s of subscriptions.value) selectedSubs.value.delete(s.id);
  } else {
    selectedIds.value = [...new Set([...selectedIds.value, ...subscriptions.value.map(s => s.id)])];
    for (const s of subscriptions.value) selectedSubs.value.set(s.id, s);
  }
}
const selectedOnPageCount = computed(() => subscriptions.value.filter(s => isSelected(s.id)).length);
const selectedOffPageCount = computed(() => selectedIds.value.length - selectedOnPageCount.value);
const bulkTargets = computed(() => selectedIds.value
  .map(id => selectedSubs.value.get(id) ?? subscriptions.value.find(s => s.id === id))
  .filter((s): s is UserSubscription => !!s));
const bulkApplicable = computed(() => ({
  extend: bulkTargets.value.filter(s => s.status === 'active' || s.status === 'expired').length,
  reset_quota: bulkTargets.value.filter(s => s.status === 'active').length,
  revoke: bulkTargets.value.filter(s => s.status === 'active').length,
  restore: bulkTargets.value.filter(s => s.status === 'revoked').length
}));

// 全选符合当前筛选条件：后端没有批量查询 ID 的接口，按当前筛选条件分页拉取。
// 上限与单次批量操作上限（validateBulkAction 的 100 条）对齐，避免选出一次执行不完的集合；
// 超过上限时只取前 100 条并在二次确认中明示。失败时不改动原有选择。
const SELECT_ALL_LIMIT = 100;
const SELECT_ALL_PAGE_SIZE = 100;
const showSelectAllConfirm = ref(false);
const selectAllBusy = ref(false);
const selectAllConfirmMessage = computed(() => total.value > SELECT_ALL_LIMIT
  ? `当前筛选共 ${total.value} 条订阅，超过单次全选上限 ${SELECT_ALL_LIMIT} 条，将只选中前 ${SELECT_ALL_LIMIT} 条。选择跨页保留，执行仍受单次批量操作上限约束。`
  : `当前筛选共 ${total.value} 条订阅，将全部选中。选择跨页保留，可在批量操作栏查看不在当前页的数量。`);
function openSelectAllConfirm(): void {
  if (loading.value || selectAllBusy.value || total.value <= 0 || loadError.value) return;
  if (searchQuery.value && !/^[1-9]\d*$/.test(searchQuery.value)) return;
  showSelectAllConfirm.value = true;
}
async function confirmSelectAllMatching(): Promise<void> {
  if (selectAllBusy.value) return;
  const wanted = Math.min(total.value, SELECT_ALL_LIMIT);
  if (wanted <= 0) { showSelectAllConfirm.value = false; return; }
  showSelectAllConfirm.value = false;
  selectAllBusy.value = true;
  actionError.value = '';
  try {
    const filters = currentFilters();
    const fetched: UserSubscription[] = [];
    // 按 total 判定是否取完，不以“本页不足一页”判定：后端可能把 page_size 压得比请求值小，
    // 短页未必是最后一页；空页与 10 页硬上限兜底防死循环。
    for (let pageNo = 1; pageNo <= 10 && fetched.length < wanted; pageNo++) {
      const res = await subsAPI.list(pageNo, SELECT_ALL_PAGE_SIZE, filters);
      const items = res?.items ?? [];
      if (!items.length) break;
      fetched.push(...items);
      if (fetched.length >= Math.min(res.total ?? fetched.length, wanted)) break;
    }
    const picked = fetched.slice(0, wanted);
    for (const sub of picked) selectedSubs.value.set(sub.id, sub);
    selectedIds.value = [...new Set([...selectedIds.value, ...picked.map(s => s.id)])];
  } catch (err) {
    // 失败不改动原有选择；文案须始终带上“已保留原有选择”，不能只剩后端原样错误。
    const detail = adminError(err, '');
    actionError.value = detail ? `全选失败，已保留原有选择。（${detail}）` : '全选失败，已保留原有选择。';
  } finally {
    selectAllBusy.value = false;
  }
}

const showBulkModal = ref(false);
const bulkAction = ref<SubscriptionBulkAction>('extend');
const bulkDays = ref<number | string>(30);
const bulkWindows = reactive({ daily: true, weekly: true, monthly: true });
const bulkSubmitting = ref(false);
const bulkRequestError = ref('');
const bulkResult = ref<SubscriptionBulkActionResult | null>(null);
const pendingBulkOp = shallowRef<BulkSubscriptionOperation | null>(null);
const submittedBulkAction = ref<SubscriptionBulkAction | null>(null);
const bulkDialogTargets = ref<UserSubscription[]>([]);
const bulkActionTitle = computed(() => ({
  extend: '批量延长订阅',
  reset_quota: '批量重置用量',
  revoke: '批量撤销订阅',
  restore: '批量恢复订阅'
})[submittedBulkAction.value ?? bulkAction.value]);
const bulkValidationError = computed(() => validateBulkAction(
  bulkDialogTargets.value.length,
  submittedBulkAction.value ?? bulkAction.value,
  bulkDays.value,
  bulkWindows
));
const bulkParametersLocked = computed(() => bulkSubmitting.value || !!pendingBulkOp.value || !!bulkResult.value);
const bulkFailedResults = computed(() => bulkResult.value?.results.filter(item => !item.success) ?? []);
function bulkTargetLabel(id: number): string {
  const target = bulkDialogTargets.value.find(item => item.id === id);
  return target?.user?.email ? `${target.user.email} · #${id}` : `#${id}`;
}
function openBulkModal(action: SubscriptionBulkAction): void {
  bulkAction.value = action;
  bulkDialogTargets.value = action === 'extend'
    ? bulkTargets.value.filter(s => s.status === 'active' || s.status === 'expired')
    : action === 'restore'
      ? bulkTargets.value.filter(s => s.status === 'revoked')
      : bulkTargets.value.filter(s => s.status === 'active');
  bulkDays.value = 30;
  bulkWindows.daily = true;
  bulkWindows.weekly = true;
  bulkWindows.monthly = true;
  bulkRequestError.value = '';
  bulkResult.value = null;
  pendingBulkOp.value = null;
  submittedBulkAction.value = null;
  showBulkModal.value = true;
}
async function submitBulk(): Promise<void> {
  if (bulkSubmitting.value || bulkResult.value) return;
  if (!pendingBulkOp.value) {
    if (bulkValidationError.value) return;
    const request: SubscriptionBulkActionRequest = {
      subscription_ids: bulkDialogTargets.value.map(s => s.id),
      action: bulkAction.value
    };
    if (request.action === 'extend') request.days = Number(bulkDays.value);
    if (request.action === 'reset_quota') Object.assign(request, { daily: bulkWindows.daily, weekly: bulkWindows.weekly, monthly: bulkWindows.monthly });
    pendingBulkOp.value = prepareBulkSubscriptionOperation(request);
    submittedBulkAction.value = request.action;
  }
  const operation = pendingBulkOp.value;
  bulkSubmitting.value = true;
  bulkRequestError.value = '';
  try {
    bulkResult.value = await subsAPI.bulkAction(operation.request, operation.key);
    completeBulkSubscriptionOperation(operation);
    pendingBulkOp.value = null;
    await loadSubscriptions();
    // 执行过的选择不再保留：成功的移出选择，失败的保留以便核对后重试；
    // 后端未返回逐条结果时，为避免残留过期选择，整批移出。
    const results = bulkResult.value?.results ?? [];
    const succeeded = new Set(results.filter(item => item.success).map(item => item.subscription_id));
    const acted = operation.request.subscription_ids;
    const toRemove = results.length ? acted.filter(id => succeeded.has(id)) : acted;
    if (toRemove.length) {
      const removing = new Set(toRemove);
      selectedIds.value = selectedIds.value.filter(id => !removing.has(id));
      for (const id of toRemove) selectedSubs.value.delete(id);
    }
  } catch (err: unknown) {
    bulkRequestError.value = adminError(err, '批量操作请求失败，请重试。');
    const status = (err as { status?: number; response?: { status?: number } })?.status
      ?? (err as { response?: { status?: number } })?.response?.status;
    // 超时/5xx/408/409 时服务端可能已执行：保留键与冻结请求体，重试沿用；4xx 确定性失败则清除。
    if (!operation.outcomeUncertain && status && status >= 400 && status < 500 && status !== 408 && status !== 409) {
      completeBulkSubscriptionOperation(operation);
      pendingBulkOp.value = null;
      submittedBulkAction.value = null;
    } else {
      operation.outcomeUncertain = true;
    }
  } finally {
    bulkSubmitting.value = false;
  }
}

// 批量分配
const batchAssign = ref(false);
const batchUserIds = ref<number[]>([]);
const batchUserQuery = ref('');
const assignResult = ref<BulkAssignSubscriptionResult | null>(null);
const batchUsersFiltered = computed(() => {
  const q = batchUserQuery.value.trim().toLowerCase();
  const list = q ? users.value.filter(u => (u.email || '').toLowerCase().includes(q)) : users.value;
  return list.slice(0, 50);
});
function toggleBatchUser(id: number): void {
  batchUserIds.value = batchUserIds.value.includes(id) ? batchUserIds.value.filter(x => x !== id) : [...batchUserIds.value, id];
}
function batchUserEmail(id: number): string {
  const u = users.value.find(x => x.id === id);
  return u?.email || `#${id}`;
}

const platforms = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'antigravity', label: 'Antigravity' },
  { value: 'grok', label: 'Grok' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'zhipu', label: '智谱' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'composite', label: 'Composite' }
];

function formatDateTime(dtStr?: string | null) {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDaysRemaining(expiresAt?: string | null) {
  if (!expiresAt) return null;
  const now = new Date();
  const exp = new Date(expiresAt);
  const diff = exp.getTime() - now.getTime();
  if (diff <= 0) return '已过期';
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return `剩余 ${days} 天`;
}

function currentFilters(): any {
  const filters: any = {};
  if (statusFilter.value) filters.status = statusFilter.value;
  if (groupFilter.value) filters.group_id = Number(groupFilter.value);
  if (platformFilter.value) filters.platform = platformFilter.value;
  if (searchQuery.value) filters.user_id = Number(searchQuery.value);
  return filters;
}

async function loadSubscriptions() {
  const version = ++loadVersion;
  loadError.value = '';
  if (searchQuery.value && !/^[1-9]\d*$/.test(searchQuery.value)) {
    loadError.value = '请输入有效的用户 ID。';
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const res = await subsAPI.list(page.value, pageSize.value, currentFilters());
    if (version !== loadVersion) return;
    if (res && res.items) {
      subscriptions.value = res.items;
      total.value = res.total ?? res.items.length;
      // 选择跨页保留：当页最新行刷新对应快照（状态可能已变），不在当页的快照原样保留。
      for (const item of res.items) {
        if (selectedSubs.value.has(item.id)) selectedSubs.value.set(item.id, item);
      }
    } else {
      subscriptions.value = [];
      total.value = 0;
    }
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '订阅列表加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function loadAuxData() {
  auxReady.value = false;
  actionError.value = '';
  try {
    const [groupsRes, usersRes] = await Promise.all([
      groupsAPI.getAll(),
      collectAdminPages((page, size) => usersAPI.list(page, size))
    ]);
    groups.value = groupsRes || [];
    users.value = usersRes;
    auxReady.value = true;
    if (groups.value.length > 0) {
      assignForm.value.group_id = groups.value[0].id;
    }
    if (users.value.length > 0) {
      assignForm.value.user_id = users.value[0].id;
    }
  } catch (err) {
    actionError.value = adminError(err, '用户或分组加载失败，暂时无法分配订阅。');
  }
}

function openAssign() {
  if (!auxReady.value) void loadAuxData();
  batchAssign.value = false;
  batchUserIds.value = [];
  batchUserQuery.value = '';
  assignResult.value = null;
  actionError.value = '';
  showAssignModal.value = true;
}

async function submitAssign() {
  if (saving.value) return;
  if (!auxReady.value || !users.value.length || !groups.value.length) { actionError.value = '请先加载可用用户和分组。'; return; }
  if (!Number.isInteger(assignForm.value.expires_in_days) || assignForm.value.expires_in_days < 1) { actionError.value = '有效期须为正整数天。'; return; }
  if (batchAssign.value) {
    if (batchUserIds.value.length === 0) { actionError.value = '请至少选择一位用户。'; return; }
    if (batchUserIds.value.length > 100) { actionError.value = '一次最多批量分配 100 位用户。'; return; }
  }
  actionError.value = '';
  assignResult.value = null;
  saving.value = true;
  try {
    if (batchAssign.value) {
      assignResult.value = await subsAPI.bulkAssign({
        user_ids: [...batchUserIds.value],
        group_id: assignForm.value.group_id,
        validity_days: assignForm.value.expires_in_days
      });
      await loadSubscriptions();
      return;
    }
    await subsAPI.assign({
      user_id: assignForm.value.user_id,
      group_id: assignForm.value.group_id,
      validity_days: assignForm.value.expires_in_days
    });
    showAssignModal.value = false;
    await loadSubscriptions();
  } catch (err) {
    actionError.value = adminError(err, '分配订阅失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

function openExtend(sub: UserSubscription) {
  if (saving.value) return;
  targetSub.value = sub;
  if (extensionGuard.value) extensionGuard.value.reset(sub.id);
  extendDays.value = 30;
  actionError.value = '';
  showExtendModal.value = true;
}

async function submitExtend() {
  if (!targetSub.value || saving.value) return;
  if (!extensionGuard.value) { actionError.value = '操作保护正在准备，请稍后重试。'; return; }
  if (extensionGuard.value.blocked.value) { actionError.value = extensionGuard.value.error.value || '请先读取并核对上次有效期调整结果。'; return; }
  if (!Number.isSafeInteger(extendDays.value) || extendDays.value === 0) { actionError.value = '调整天数须为非零整数，正数延长，负数缩短。'; return; }
  if (extendDays.value < 0) {
    const expiresAt = Date.parse(targetSub.value.expires_at || '');
    if (!Number.isFinite(expiresAt)) { actionError.value = '无法确认到期时间，请刷新订阅后再调整。'; return; }
    if (expiresAt + extendDays.value * 86400000 <= Date.now()) { actionError.value = '缩短后的到期时间必须在未来，已过期订阅只能延长。'; return; }
  }
  actionError.value = '';
  const context = extensionGuard.value.capture();
  saving.value = true;
  try {
    await subsAPI.extend(targetSub.value.id, { days: extendDays.value });
    if (!context.current()) return;
    showExtendModal.value = false;
    await loadSubscriptions();
  } catch (err) {
    if (!context.current()) return;
    actionError.value = adminError(err, '调整有效期失败，请重试。');
  } finally {
    saving.value = false;
  }
}

async function acknowledgeExtension() {
  if (!extensionGuard.value) return;
  if (await extensionGuard.value.acknowledge()) {
    showExtendModal.value = false;
    actionError.value = '已完成核对。需要再次调整时，请重新打开并填写新操作。';
  }
}

const alertSheet = ref({
  show: false,
  title: '',
  message: '',
  confirmText: '',
  danger: false,
  loading: false,
  action: null as (() => Promise<void>) | null
});

function promptRevoke(sub: UserSubscription) {
  alertSheet.value = {
    show: true,
    title: '确定要撤销此订阅吗？',
    message: `用户 “${sub.user?.email || ('#' + sub.user_id)}” 将立即失去对 “${sub.group?.name || ('分组 #' + sub.group_id)}” 的访问权限。`,
    confirmText: '撤销订阅',
    danger: true,
    loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await subsAPI.revoke(sub.id);
        alertSheet.value.show = false;
        await loadSubscriptions();
      } catch (err) {
        actionError.value = adminError(err, '撤销订阅失败，请重试。');
      } finally {
        alertSheet.value.loading = false;
      }
    }
  };
}

function promptResetQuota(sub: UserSubscription) {
  alertSheet.value = {
    show: true,
    title: '确定要重置该订阅的用量统计吗？',
    message: `将立即清空用户 “${sub.user?.email || ('#' + sub.user_id)}” 在 “${sub.group?.name || ('分组 #' + sub.group_id)}” 下的今日、本周及本月用量累计。`,
    confirmText: '重置用量',
    danger: false,
    loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await subsAPI.resetQuota(sub.id, { daily: true, weekly: true, monthly: true });
        alertSheet.value.show = false;
        await loadSubscriptions();
      } catch (err) {
        actionError.value = adminError(err, '重置用量失败，请重试。');
      } finally {
        alertSheet.value.loading = false;
      }
    }
  };
}

async function handleAlertConfirm() {
  if (alertSheet.value.action && !alertSheet.value.loading) {
    await alertSheet.value.action();
  }
}

async function handleRestore(sub: UserSubscription) {
  try {
    await subsAPI.restore(sub.id);
    await loadSubscriptions();
  } catch (err) {
    actionError.value = adminError(err, '恢复订阅失败，请重试。');
  }
}

onMounted(() => {
  loadSubscriptions();
  loadAuxData();
});
</script>

<template>
  <div class="admin-polish flex flex-col h-full select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('admin_subscriptions')" alt="Subscriptions" class="w-8 h-8 object-contain drop-shadow-sm" />
        <div>
          <span class="workspace-eyebrow">运营管理</span><h1 class="text-[17px] font-bold text-[var(--text-primary)] leading-tight">订阅管理</h1>
          <p class="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">为用户分配订阅，查看有效期与额度使用情况</p>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <button
          class="p-1.5 rounded-[7px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)] transition-colors"
          :class="loading ? 'animate-spin' : ''"
          title="刷新"
          @click="loadSubscriptions"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <button
          class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-all"
          @click="openAssign"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span>分配订阅</span>
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="admin-filters">
      <div class="flex flex-wrap items-center gap-2.5">
        <!-- Search -->
        <div class="admin-filter-search relative w-60">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="按用户 ID 筛选…"
            inputmode="numeric"
            aria-label="用户 ID，按回车应用"
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
            @keyup.enter="page = 1; loadSubscriptions()"
          />
        </div>

        <!-- Status -->
        <select
          v-model="statusFilter"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadSubscriptions()"
          aria-label="订阅状态"
        >
          <option value="">全部状态</option>
          <option value="active">生效中</option>
          <option value="expired">已过期</option>
          <option value="revoked">已撤销</option>
        </select>

        <!-- Group -->
        <select
          v-model="groupFilter"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadSubscriptions()"
          aria-label="订阅分组"
        >
          <option value="">全部分组</option>
          <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
        </select>

        <!-- Platform -->
        <select
          v-model="platformFilter"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadSubscriptions()"
          aria-label="订阅平台"
        >
          <option value="">全部平台</option>
          <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>
      </div>
    </div>

    <!-- Bulk Actions Bar -->
    <div v-if="selectedIds.length > 0" data-test="subscription-bulk-actions" class="flex flex-wrap items-center gap-2 px-5 py-2.5 border-b border-[var(--border-color)] bg-blue-500/5 text-xs">
      <span class="font-medium text-[var(--text-primary)]">已选 {{ selectedIds.length }} 条<span v-if="selectedOffPageCount > 0">（不在当前页 {{ selectedOffPageCount }} 条）</span></span>
      <span class="text-[11px] text-[var(--text-tertiary)]">选择跨页保留，翻页或筛选后仍可批量操作。</span>
      <button type="button" class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-40" :disabled="loading || selectAllBusy || total <= 0" @click="openSelectAllConfirm">{{ selectAllBusy ? '正在选取…' : '全选符合当前筛选条件' }}</button>
      <button type="button" class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-40" :disabled="bulkApplicable.extend === 0" @click="openBulkModal('extend')">延长 ({{ bulkApplicable.extend }})</button>
      <button type="button" class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-40" :disabled="bulkApplicable.reset_quota === 0" @click="openBulkModal('reset_quota')">重置用量 ({{ bulkApplicable.reset_quota }})</button>
      <button type="button" class="px-2.5 py-1 rounded-[6px] border border-red-500/40 text-red-600 dark:text-red-400 disabled:opacity-40" :disabled="bulkApplicable.revoke === 0" @click="openBulkModal('revoke')">撤销 ({{ bulkApplicable.revoke }})</button>
      <button type="button" class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] text-emerald-600 disabled:opacity-40" :disabled="bulkApplicable.restore === 0" @click="openBulkModal('restore')">恢复 ({{ bulkApplicable.restore }})</button>
      <button type="button" class="px-2.5 py-1 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" @click="clearSelection">清除选择</button>
    </div>

    <!-- Table Container -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="订阅管理" @retry="loadSubscriptions" @dismiss="actionError = ''" />
    <div class="admin-table-scroll">
      <!-- Empty State -->
      <div v-if="!loading && !loadError && subscriptions.length === 0" class="admin-state flex flex-col items-center justify-center">
        <div class="w-16 h-16 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-400">
          <svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M7 8h10M7 12h6" />
          </svg>
        </div>
        <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">当前条件下没有订阅</h3>
        <p class="text-xs text-[var(--text-tertiary)] max-w-xs leading-relaxed mb-4">
          分配一个订阅以开始使用。
        </p>
        <button
          class="flex items-center gap-1 px-4 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-colors"
          @click="openAssign"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span>分配订阅</span>
        </button>
      </div>

      <!-- Data Table -->
      <table v-else-if="subscriptions.length" class="admin-table admin-table-actions">
        <thead>
          <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
            <th class="px-3 py-2.5">
              <input
                type="checkbox"
                :checked="pageAllSelected"
                :aria-label="pageAllSelected ? '取消全选当前页' : '全选当前页'"
                @change="togglePageSelection"
              />
            </th>
            <th class="px-5 py-2.5">用户</th>
            <th class="px-4 py-2.5">分组</th>
            <th class="px-4 py-2.5">用量</th>
            <th class="px-4 py-2.5">到期时间</th>
            <th class="px-3 py-2.5">状态</th>
            <th class="px-5 py-2.5 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
          <tr
            v-for="s in subscriptions"
            :key="s.id"
            class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
          >
            <!-- Select -->
            <td class="px-3 py-3">
              <input
                type="checkbox"
                :checked="isSelected(s.id)"
                :aria-label="`选择订阅 #${s.id}`"
                @change="toggleSelection(s.id)"
              />
            </td>
            <!-- User -->
            <td class="px-5 py-3">
              <div class="flex items-center gap-2">
                <div class="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center font-bold text-xs uppercase">
                  {{ s.user?.email ? s.user.email.charAt(0) : 'U' }}
                </div>
                <span class="font-medium text-[var(--text-primary)]">
                  {{ s.user?.email || ('用户 #' + s.user_id) }}
                </span>
              </div>
            </td>

            <!-- Group -->
            <td class="px-4 py-3">
              <span class="admin-neutral-badge inline-flex items-center gap-1 px-2 py-0.5">
                {{ s.group?.name || ('分组 #' + s.group_id) }}
              </span>
            </td>

            <!-- Usage -->
            <td class="px-4 py-3">
              <div v-if="s.group?.daily_limit_usd" class="text-xs">
                ${{ (s.daily_usage_usd || 0).toFixed(2) }} / ${{ s.group.daily_limit_usd.toFixed(2) }}
              </div>
              <div v-else class="flex items-center gap-1 text-emerald-600 text-xs font-medium">
                <span>∞</span>
                <span>无限制</span>
              </div>
            </td>

            <!-- Expiration -->
            <td class="px-4 py-3">
              <div class="flex flex-col text-xs">
                <span class="text-[var(--text-primary)]">{{ formatDateTime(s.expires_at) }}</span>
                <span class="text-[10.5px] text-[var(--text-tertiary)]">{{ getDaysRemaining(s.expires_at) }}</span>
              </div>
            </td>

            <!-- Status -->
            <td class="px-3 py-3">
              <span
                class="admin-status"
                :data-tone="s.status === 'active' ? 'success' : s.status === 'expired' ? 'warning' : 'neutral'"
              >
                {{ s.status === 'active' ? '生效中' : s.status === 'expired' ? '已过期' : s.status === 'revoked' ? '已撤销' : '已暂停' }}
              </span>
            </td>

            <!-- Actions -->
            <td class="px-5 py-3 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-2 text-xs">
                <button
                  class="text-[var(--accent)] hover:underline"
                  @click="openExtend(s)"
                >
                  调整
                </button>
                <button
                  v-if="s.status === 'active'"
                  class="admin-row-link hover:underline"
                  @click="promptResetQuota(s)"
                >
                  重置用量
                </button>
                <button
                  v-if="s.status === 'active'"
                  class="admin-row-danger hover:underline"
                  @click="promptRevoke(s)"
                >
                  撤销
                </button>
                <button
                  v-if="s.status === 'revoked'"
                  class="text-emerald-600 hover:underline"
                  @click="handleRestore(s)"
                >
                  恢复
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Footer -->
    <div class="admin-footer">
      <span>共 {{ total }} 条订阅 · 每页 {{ pageSize }} 项</span>
      <div class="flex items-center gap-2">
        <span>{{ page }} / {{ totalPages }}</span>
        <div class="inline-flex border border-[var(--border-color)] rounded-[6px] overflow-hidden">
          <button aria-label="上一页" @click="page--; loadSubscriptions()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page <= 1">
            ‹
          </button>
          <button aria-label="下一页" @click="page++; loadSubscriptions()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page >= totalPages">
            ›
          </button>
        </div>
      </div>
    </div>

    <!-- Assign Modal -->
    <MacSheet v-slot="{ close }" :show="showAssignModal" title="分配订阅" protect-changes :loading="saving" @close="!saving && (showAssignModal = false)">
        <p v-if="actionError" role="alert" class="admin-form-error mb-3">{{ actionError }}</p>
        <button v-if="!auxReady" type="button" class="text-[var(--accent)] mb-3" @click="loadAuxData">重新加载用户与分组</button>
        <p class="text-[11px] text-[var(--text-tertiary)] mb-4">手动为指定用户赋予分组订阅有效期</p>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitAssign">
          <div v-if="assignResult" aria-live="polite" class="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3 space-y-2">
            <p class="font-medium text-[var(--text-primary)]">成功 {{ assignResult.success_count }} 条（新建 {{ assignResult.created_count }} 条，复用 {{ assignResult.reused_count }} 条），失败 {{ assignResult.failed_count }} 条</p>
            <ul v-if="assignResult.errors.length" class="max-h-40 space-y-1 overflow-y-auto text-red-600 dark:text-red-400">
              <li v-for="(err, i) in assignResult.errors" :key="i" class="break-words">{{ err }}</li>
            </ul>
            <p v-if="assignResult.failed_count > 0" class="text-[11px] text-[var(--text-tertiary)]">失败用户可调整选择后重试，已成功的订阅不会重复创建。</p>
          </div>
          <div class="flex items-center gap-2 p-2.5 rounded-[7px] border border-[var(--border-color)] bg-black/[0.01]">
            <input id="batch-assign" v-model="batchAssign" type="checkbox" :disabled="saving" />
            <label for="batch-assign" class="font-medium text-[var(--text-primary)]">批量分配（多用户）</label>
            <span class="text-[11px] text-[var(--text-tertiary)]">一次最多 100 位用户</span>
          </div>
          <div v-if="batchAssign">
            <label class="block text-[var(--text-secondary)] font-medium mb-1">选择用户（已选 {{ batchUserIds.length }} 位）</label>
            <input
              v-model="batchUserQuery"
              type="text"
              placeholder="按邮箱搜索…"
              :disabled="saving"
              class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none mb-1.5"
            />
            <div class="max-h-40 overflow-y-auto rounded-[6px] border border-[var(--border-color)]">
              <label v-for="u in batchUsersFiltered" :key="u.id" class="flex items-center gap-2 px-2.5 py-1.5 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] cursor-pointer">
                <input type="checkbox" :checked="batchUserIds.includes(u.id)" :disabled="saving" @change="toggleBatchUser(u.id)" />
                <span class="truncate">{{ u.email }} (#{{ u.id }})</span>
              </label>
              <p v-if="!batchUsersFiltered.length" class="px-2.5 py-2 text-[var(--text-tertiary)]">没有匹配的用户</p>
            </div>
            <div v-if="batchUserIds.length" class="flex flex-wrap gap-1.5 mt-2" data-test="assign-users">
              <span v-for="id in batchUserIds" :key="id" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                {{ batchUserEmail(id) }}
                <button type="button" :disabled="saving" :aria-label="`移除 ${batchUserEmail(id)}`" @click="toggleBatchUser(id)">×</button>
              </span>
            </div>
          </div>
          <div v-if="!batchAssign">
            <label class="block text-[var(--text-secondary)] font-medium mb-1">目标用户</label>
            <select
              v-model="assignForm.user_id"
              class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            >
              <option v-for="u in users" :key="u.id" :value="u.id">{{ u.email }} (#{{ u.id }})</option>
            </select>
            <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">已加载 {{ users.length }} 位用户。</p>
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">订阅分组</label>
            <select
              v-model="assignForm.group_id"
              class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            >
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }} ({{ g.platform }})</option>
            </select>
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">有效期 (天数)</label>
            <input
              v-model.number="assignForm.expires_in_days"
              type="number"
              min="1"
              required
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
            />
          </div>
          <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" :disabled="saving" @click="close">取消</button>
            <button type="submit" :disabled="saving || !auxReady" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white font-medium">{{ batchAssign ? '确认批量分配' : '确认分配' }}</button>
          </div>
        </form>
    </MacSheet>

    <!-- Extend Modal -->
    <MacSheet v-if="showExtendModal && targetSub" v-slot="{ close }" :show="true" title="调整订阅有效期" protect-changes :loading="saving || extensionGuard?.busy.value" @close="!saving && (showExtendModal = false)">
        <p v-if="actionError || extensionGuard?.error.value" role="alert" class="admin-form-error mb-3">{{ extensionGuard?.error.value || actionError }}</p>
        <div v-if="extensionGuard?.pending.value" class="mb-4 text-xs space-y-2" role="status">
          <p>上次有效期调整结果待核对。关闭或刷新不会取消操作，请勿重复提交。</p>
          <button type="button" class="text-[var(--accent)]" :disabled="saving || extensionGuard.busy.value" @click="extensionGuard.inspect">{{ extensionGuard.busy.value ? '读取中…' : '读取当前结果' }}</button>
          <p v-if="extensionGuard.snapshot.value">{{ extensionGuard.snapshot.value }}</p>
          <p v-if="extensionGuard.snapshot.value">当前到期时间不代表上次请求的最终状态。请核实调整记录；仍不确定时保留保护。</p>
          <button v-if="extensionGuard.canAcknowledge.value" type="button" class="text-[var(--accent)]" @click="acknowledgeExtension">已核对记录，结束本次操作</button>
        </div>
        <p class="text-xs text-[var(--text-secondary)] mb-2">当前到期：{{ formatDateTime(targetSub.expires_at) }}</p>
        <p class="text-xs text-[var(--text-secondary)] mb-4">正数延长，负数缩短；缩短后的到期时间必须在未来。已过期订阅从当前时间续期。</p>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitExtend">
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">调整天数</label>
            <input
              v-model.number="extendDays"
              :disabled="saving || !extensionGuard || extensionGuard.blocked.value"
              type="number"
              step="1"
              required
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
            />
          </div>
          <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" :disabled="saving" @click="close">取消</button>
            <button type="submit" :disabled="saving || !extensionGuard || extensionGuard.blocked.value" class="px-3.5 py-1.5 rounded-[6px] bg-[var(--accent)] text-white font-medium">确认调整</button>
          </div>
        </form>
    </MacSheet>

    <!-- Bulk Action Dialog -->
    <MacSheet v-if="showBulkModal" v-slot="{ close }" :show="true" :title="bulkActionTitle" protect-changes :loading="bulkSubmitting" @close="!bulkSubmitting && (showBulkModal = false)">
      <div class="text-xs space-y-4">
        <div>
          <p class="mb-2 font-medium text-[var(--text-primary)]">本次将处理以下 {{ bulkDialogTargets.length }} 条订阅</p>
          <ul class="max-h-48 divide-y divide-[var(--border-color)] overflow-y-auto rounded-lg border border-[var(--border-color)]">
            <li v-for="s in bulkDialogTargets" :key="s.id" class="px-3 py-2">
              <div class="break-all text-[var(--text-primary)]">{{ s.user?.email || ('#' + s.id) }}</div>
              <div class="break-words text-[11px] text-[var(--text-tertiary)]">
                {{ s.group?.name || ('分组 #' + s.group_id) }}
                <span v-if="s.user?.email" class="ml-2">#{{ s.id }}</span>
              </div>
            </li>
          </ul>
        </div>

        <fieldset :disabled="bulkParametersLocked" class="space-y-3 disabled:opacity-70">
          <div v-if="(submittedBulkAction ?? bulkAction) === 'extend'">
            <label for="bulk-subscription-days" class="block text-[var(--text-secondary)] font-medium mb-1">调整天数</label>
            <input
              id="bulk-subscription-days"
              v-model.number="bulkDays"
              type="number"
              min="-36500"
              max="36500"
              step="1"
              :disabled="bulkParametersLocked"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
            />
            <p class="mt-1 text-[11px] text-[var(--text-tertiary)]">正数延长，负数缩短；已过期订阅从当前时间续期。</p>
          </div>
          <template v-else-if="(submittedBulkAction ?? bulkAction) === 'reset_quota'">
            <p class="font-medium text-[var(--text-secondary)]">重置窗口</p>
            <div class="flex flex-wrap gap-5">
              <label class="flex items-center gap-2 text-[var(--text-secondary)]"><input v-model="bulkWindows.daily" type="checkbox" :disabled="bulkParametersLocked" />今日</label>
              <label class="flex items-center gap-2 text-[var(--text-secondary)]"><input v-model="bulkWindows.weekly" type="checkbox" :disabled="bulkParametersLocked" />本周</label>
              <label class="flex items-center gap-2 text-[var(--text-secondary)]"><input v-model="bulkWindows.monthly" type="checkbox" :disabled="bulkParametersLocked" />本月</label>
            </div>
            <p class="text-[11px] text-[var(--text-tertiary)]">仅重置所选窗口的用量累计。</p>
          </template>
          <p v-else class="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-amber-800 dark:text-amber-200">{{ bulkAction === 'revoke' ? '撤销后用户将立即失去该分组的访问权限，可在之后恢复。' : '恢复后订阅将重新生效。' }}</p>
        </fieldset>

        <p v-if="bulkValidationError && !bulkParametersLocked" role="alert" class="admin-form-error">{{ bulkValidationError }}</p>

        <div v-if="bulkRequestError" role="alert" class="space-y-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300">
          <p>{{ bulkRequestError }}</p>
          <p v-if="pendingBulkOp">上次提交没有收到确定结果，可能已经执行。重试将沿用同一批订阅与同一幂等键，不会重复执行。</p>
        </div>

        <div v-if="bulkResult" aria-live="polite" class="space-y-3">
          <p class="rounded-lg bg-black/[0.03] dark:bg-white/[0.04] p-3 font-medium text-[var(--text-primary)]">成功 {{ bulkResult.success_count }} 条，失败 {{ bulkResult.failed_count }} 条</p>
          <ul v-if="bulkFailedResults.length" class="max-h-48 space-y-2 overflow-y-auto">
            <li v-for="item in bulkFailedResults" :key="item.subscription_id" class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-red-700 dark:text-red-300">
              <p class="break-all font-medium">{{ bulkTargetLabel(item.subscription_id) }}</p>
              <p class="mt-1 break-words">{{ item.error || '该订阅处理失败。' }}</p>
            </li>
          </ul>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
          <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" :disabled="bulkSubmitting" @click="close">{{ bulkResult ? '关闭' : '取消' }}</button>
          <button
            v-if="!bulkResult"
            type="button"
            :class="['px-3.5 py-1.5 rounded-[6px] text-white font-medium disabled:opacity-50', (submittedBulkAction ?? bulkAction) === 'revoke' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#007aff] hover:bg-[#0071e3]']"
            :disabled="bulkSubmitting || (!pendingBulkOp && !!bulkValidationError)"
            @click="submitBulk"
          >
            {{ bulkSubmitting ? '处理中…' : pendingBulkOp ? '重试' : '确认' }}
          </button>
        </div>
      </div>
    </MacSheet>

    <!-- MacAlertSheet for Confirmation -->
    <MacAlertSheet
      :show="alertSheet.show"
      :title="alertSheet.title"
      :message="alertSheet.message"
      :confirm-text="alertSheet.confirmText"
      cancel-text="取消"
      :danger="alertSheet.danger"
      :loading="alertSheet.loading"
      @confirm="handleAlertConfirm"
      @cancel="alertSheet.show = false"
    />
    <!-- 全选符合当前筛选条件：二次确认（含上限说明） -->
    <MacAlertSheet
      :show="showSelectAllConfirm"
      title="全选符合当前筛选条件的订阅"
      :message="selectAllConfirmMessage"
      confirm-text="全选"
      cancel-text="取消"
      :loading="selectAllBusy"
      @confirm="confirmSelectAllMatching"
      @cancel="showSelectAllConfirm = false"
    />
  </div>
</template>
