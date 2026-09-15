<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacSheet, MacAlertSheet } from '@sub2-mac/core';
import { accountsAPI } from '@/api/admin/accounts';
import { groupsAPI } from '@/api/admin/groups';
import { useAuthStore } from '@/stores/auth';
import OAuthAuthorization from './accounts/OAuthAuthorization.vue';
import ReauthorizeSheet from './accounts/ReauthorizeSheet.vue';
import ScheduledTestsSheet from './accounts/ScheduledTestsSheet.vue';
import AccountAdvancedFields from './accounts/AccountAdvancedFields.vue';
import AccountPolicies from './accounts/AccountPolicies.vue';
import BatchAuthorizationSheet from './accounts/BatchAuthorizationSheet.vue';
import PlatformMark from './accounts/PlatformMark.vue';
import AccountImportSheet from './accounts/AccountImportSheet.vue';
import CNProviderFields from './accounts/CNProviderFields.vue';
import GrokMediaEligibilitySheet from './accounts/GrokMediaEligibilitySheet.vue';
import { cnProviderForm, buildCNProviderCredentials, isCNProviderPlatform, cloneCNProviderForm } from './accounts/cn-provider';
import type { BatchSettings } from './accounts/batchAuthorization';
import { policyForm, applyPolicies, mappingLocked } from './accounts/policies';
import { supportsOAuth, type OAuthResult, type OAuthOptions } from './accounts/oauth';
import { advancedForm, advancedPatch } from './accounts/advanced';
import type { Account, AdminGroup, AccountPlatform, AccountType } from '@/types';

const props = defineProps<{
  win?: WindowInstance;
}>();

const loading = ref(false);
const accounts = ref<Account[]>([]);
const groups = ref<AdminGroup[]>([]);
const selectedIds = ref<number[]>([]);
const listError = ref('');
const groupsError = ref('');
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const hasLoaded = ref(false);
const lastUpdated = ref('');
const appRoot = ref<HTMLElement | null>(null);
let listController: AbortController | null = null;
let requestVersion = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

// Filter States
const searchQuery = ref('');
const selectedPlatform = ref('');
const selectedType = ref('');
const selectedStatus = ref('');
const selectedPrivacy = ref('');
const selectedGroup = ref('');
const filters = computed(() => ({
  search: searchQuery.value.trim() || undefined,
  platform: selectedPlatform.value || undefined,
  type: selectedType.value || undefined,
  status: selectedStatus.value || undefined,
  privacy_mode: selectedPrivacy.value || undefined,
  group: selectedGroup.value || undefined
}));
const hasFilters = computed(() => Object.values(filters.value).some(Boolean));
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
const rangeStart = computed(() => accounts.value.length ? (page.value - 1) * pageSize.value + 1 : 0);
const rangeEnd = computed(() => accounts.value.length ? rangeStart.value + accounts.value.length - 1 : 0);
const allSelected = computed(() => accounts.value.length > 0 && accounts.value.every(a => selectedIds.value.includes(a.id)));
const partlySelected = computed(() => selectedIds.value.length > 0 && !allSelected.value);

// Auto Refresh State
const autoRefreshEnabled = ref(false);
const autoRefreshInterval = ref(30);
const autoRefreshCountdown = ref(30);
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
const showAutoRefreshMenu = ref(false);
const showMoreMenu = ref(false);

// Add / Edit Account Sheet
const showAddSheet = ref(false);
// Persist only an opaque operation marker, never the draft, name or credentials.
// A reload during POST must be treated just like a lost response. No expiry unlocks it.
const createAuth = useAuthStore();
// Bind this window to its verified owner, not a token (normal renewal is allowed).
const createOwner = createAuth.user?.id;
const createSessionRevision = createAuth.sessionRevision;
const pendingCreateStorageKey = `sub2api:admin:account-create-pending:owner:${createOwner}`;
const legacyCreateStorageKey = 'sub2api:admin:account-create-pending';
const legacyPendingCreate = ref('');
const legacyCreateNotice = '发现旧版未确认创建，无法确定操作人，新增已暂停。请核对旧请求及操作人的后端记录；此保护不属于当前登录用户，切换账号不会解除。';
const createStorageError = ref('');
function ownsCreateSession() {
  return Number.isSafeInteger(createOwner) && Number(createOwner) > 0 &&
    createAuth.user?.id === createOwner && createAuth.sessionRevision === createSessionRevision;
}
function readPendingCreate(): string {
  try {
    if (!ownsCreateSession() || !globalThis.sessionStorage) throw new Error('Storage unavailable');
    legacyPendingCreate.value = globalThis.sessionStorage.getItem(legacyCreateStorageKey) || '';
    const key = globalThis.sessionStorage.getItem(pendingCreateStorageKey) || '';
    createStorageError.value = '';
    return key;
  } catch {
    createStorageError.value = '无法确认当前登录身份或保存创建保护，请恢复浏览器存储后重新打开窗口；新增已暂停。';
    return '';
  }
}
const pendingCreate = ref(readPendingCreate());
function setPendingCreate(key: string) {
  try {
    if (!ownsCreateSession() || !globalThis.sessionStorage) throw new Error('Storage unavailable');
    if (key) {
      legacyPendingCreate.value = globalThis.sessionStorage.getItem(legacyCreateStorageKey) || '';
      if (legacyPendingCreate.value) { createStorageError.value = legacyCreateNotice; return false; }
    }
    if (key) globalThis.sessionStorage.setItem(pendingCreateStorageKey, key);
    else globalThis.sessionStorage.removeItem(pendingCreateStorageKey);
    if ((globalThis.sessionStorage.getItem(pendingCreateStorageKey) || '') !== key) throw new Error('Storage verification failed');
    pendingCreate.value = key;
    createStorageError.value = '';
    return true;
  } catch {
    createStorageError.value = '无法保存创建保护，新增已暂停。请恢复浏览器存储后重试。';
    return false;
  }
}
function clearPendingCreate(key: string) {
  const stored = readPendingCreate();
  if (!createStorageError.value && pendingCreate.value === key && (!stored || stored === key)) return setPendingCreate('');
  return false;
}
function hasPendingCreate() {
  pendingCreate.value = readPendingCreate() || pendingCreate.value;
  return !!pendingCreate.value || !!legacyPendingCreate.value || !!createStorageError.value;
}
const showCreateReview = ref(false);
const reviewAccountId = ref<number | null>(null);
const reviewedAccount = ref<Pick<Account, 'id' | 'name' | 'platform' | 'type' | 'created_at'> | null>(null);
const reviewBusy = ref(false), reviewError = ref(''), reviewConfirmed = ref(false);
const reviewAbsent = ref(false), showAbsentConfirmation = ref(false);
const legacyReviewConfirmed = ref(false), showLegacyConfirmation = ref(false);
let legacyReviewKey = '';
function resetLegacyReview() {
  legacyReviewConfirmed.value = false;
  showLegacyConfirmation.value = false;
  legacyReviewKey = showCreateReview.value ? legacyPendingCreate.value : '';
}
watch([showCreateReview, legacyPendingCreate], resetLegacyReview, { flush: 'sync' });
function finishLegacyReview() {
  if (disposed || !ownsCreateSession() || !showCreateReview.value || !showLegacyConfirmation.value ||
      !legacyReviewConfirmed.value || !legacyReviewKey || legacyReviewKey !== legacyPendingCreate.value) return;
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) throw new Error('Storage unavailable');
    if (storage.getItem(legacyCreateStorageKey) !== legacyReviewKey) {
      readPendingCreate(); resetLegacyReview();
      throw new Error('Marker changed');
    }
    storage.removeItem(legacyCreateStorageKey);
    if (storage.getItem(legacyCreateStorageKey) !== null) throw new Error('Storage verification failed');
    legacyPendingCreate.value = '';
    createStorageError.value = '';
    reviewError.value = '';
    // Only this explicit legacy review may remove the unowned key. Never migrate
    // it to the current owner, or remove any owner's independent pending marker.
    if (!hasPendingCreate()) {
      showCreateReview.value = false;
      showAddSheet.value = false;
      resetCredentials();
    }
  } catch {
    reviewError.value = '旧版保护发生变化或无法清除，新增仍暂停。请恢复浏览器存储并重新核对。';
    resetLegacyReview();
  }
}
watch(reviewAccountId, () => { reviewedAccount.value = null; reviewConfirmed.value = false; });
watch(showCreateReview, () => { reviewedAccount.value = null; reviewConfirmed.value = false; reviewError.value = ''; reviewAbsent.value = false; });
async function readCreatedAccount() {
  if (reviewBusy.value || !Number.isSafeInteger(reviewAccountId.value) || Number(reviewAccountId.value) < 1) return;
  const id = reviewAccountId.value!;
  const key = pendingCreate.value;
  reviewBusy.value = true; reviewedAccount.value = null; reviewConfirmed.value = false; reviewError.value = '';
  try {
    const account = await accountsAPI.getById(id);
    if (disposed || !ownsCreateSession() || !showCreateReview.value || reviewAccountId.value !== id || pendingCreate.value !== key) return;
    if (account.id !== id) throw new Error('Mismatched account');
    // Whitelist displayed metadata; do not retain the returned credentials in review state.
    reviewedAccount.value = { id, name: account.name, platform: account.platform, type: account.type, created_at: account.created_at };
  } catch { if (!disposed) reviewError.value = '未能读取该账号。请核对编号或稍后重试；新增仍暂停。'; }
  finally { reviewBusy.value = false; }
}
function finishCreateReview() {
  if (legacyPendingCreate.value) return;
  if (reviewBusy.value || !reviewConfirmed.value || !reviewedAccount.value || reviewedAccount.value.id !== reviewAccountId.value) return;
  if (!clearPendingCreate(pendingCreate.value)) { reviewError.value = createStorageError.value || '创建保护已变化，请重新核对。'; return; }
  showCreateReview.value = false;
  showAddSheet.value = false;
  resetCredentials();
  void fetchData();
}
function finishAbsentReview() {
  if (legacyPendingCreate.value) return;
  if (!showCreateReview.value || !reviewAbsent.value || reviewBusy.value) return;
  if (!clearPendingCreate(pendingCreate.value)) { reviewError.value = createStorageError.value || '创建保护已变化，请重新核对。'; return; }
  showAbsentConfirmation.value = false;
  showCreateReview.value = false;
  showAddSheet.value = false;
  resetCredentials();
  void fetchData();
}
const mixedRisk = ref('');
let riskResolve: ((confirmed: boolean) => void) | null = null;
let editorGeneration = 0;
function resolveMixedRisk(confirmed: boolean) { const resolve = riskResolve; riskResolve = null; mixedRisk.value = ''; resolve?.(confirmed); }
watch(showAddSheet, () => { editorGeneration++; resolveMixedRisk(false); }, { flush: 'sync' });
function privateSaveError(error: unknown): Error {
  const e = error as { status?: number; response?: { status?: number } } | null;
  const status = e?.status ?? e?.response?.status;
  // A backend error body can echo submitted credentials or header values.
  return new Error(status && status >= 400 && status < 500
    ? `服务器拒绝保存（HTTP ${status}），请检查设置；草稿已保留。`
    : '保存结果尚未确认，请先核对账号列表，避免重复创建；草稿已保留。');
}
async function saveWithRisk<T>(write: (confirmed: boolean) => Promise<T>, confirmed: boolean, version: number): Promise<T> {
  try { return await write(confirmed); }
  catch (error) {
    const e = error as { status?: number; error?: string; response?: { status?: number; data?: { error?: string } } };
    if ((e?.status ?? e?.response?.status) !== 409 || (e?.error ?? e?.response?.data?.error) !== 'mixed_channel_warning' || confirmed || disposed || version !== editorGeneration) throw privateSaveError(error);
    mixedRisk.value = '分组渠道在保存前发生变化，服务器提示混合渠道风险。是否仍要保存？';
    if (!await new Promise<boolean>(resolve => { riskResolve = resolve; }) || disposed || version !== editorGeneration) throw new Error('已取消保存，草稿保留。');
    try { return await write(true); }
    catch (retryError) { throw privateSaveError(retryError); }
  }
}
async function checkEditorRisk(version: number): Promise<boolean | null> {
  if (!['anthropic', 'antigravity'].includes(accountForm.value.platform) || !accountForm.value.groups.length) return false;
  const result = await accountsAPI.checkMixedChannelRisk({ platform: accountForm.value.platform, group_ids: [...accountForm.value.groups], ...(editingId.value ? { account_id: editingId.value } : {}) });
  if (disposed || version !== editorGeneration || !showAddSheet.value) return null;
  if (!result || typeof result.has_risk !== 'boolean') throw new Error('混合渠道风险检查结果无效，请重试。');
  if (!result.has_risk) return false;
  mixedRisk.value = result.message || `分组「${result.details?.group_name || '所选分组'}」存在混合渠道风险，可能影响账号安全。是否继续？`;
  return (await new Promise<boolean>(resolve => { riskResolve = resolve; })) ? true : null;
}

const editorStep = ref(0);
const editorRoot = ref<HTMLElement | null>(null);
const editorSteps = ['选择平台', '连接账号', '确认添加'];
watch(showAddSheet, show => { if (show) editorStep.value = 0; });
async function moveEditor(step: number) {
  if (isSubmitting.value || oauthBusy.value || step < 0 || step > 2) return;
  if (step > editorStep.value && editorStep.value === 1) {
    if (missingRequired.value.length) return;
    if (!isBatchCreation.value) try { buildCredentials(); } catch (e) { formError.value = errorMessage(e, '请检查认证信息'); return; }
  }
  formError.value = ''; editorStep.value = step;
  await nextTick();
  const root = editorRoot.value;
  const scroll = root?.closest('.mac-sheet-body'); if (scroll) scroll.scrollTop = 0;
  root?.querySelector<HTMLElement>(`[data-editor-page="${step}"] h3`)?.focus({ preventScroll: true });
}
const isEditing = ref(false);
const editingId = ref<number | null>(null);
const isSubmitting = ref(false);
const formError = ref('');
const reauthorizeAccount = ref<Account | null>(null);
const scheduledAccount = ref<Account | null>(null);
const mediaAccount = ref<Account | null>(null);
const oauthResult = ref<OAuthResult | null>(null);
const oauthBusy = ref(false);
const batchAuthorization = ref<BatchSettings | null>(null);
const advanced = ref(advancedForm());
const policies = ref(policyForm());
let policiesInitial = policyForm();
const policyAccount = ref<Account | null>(null);
const policyLoading = ref(false);
const policyReady = ref(true);
let policyGeneration = 0;
let advancedInitial = advancedForm();
const geminiOptions = ref({ project_id: '', oauth_type: 'code_assist' as OAuthOptions['oauth_type'], tier_id: '' });
const isOAuth = computed(() => accountForm.value.type === 'oauth' || accountForm.value.type === 'setup-token');
const creationMode = ref<'single' | 'batch'>('single');
const supportsBatchCreation = computed(() => !isEditing.value && isOAuth.value && ['openai', 'anthropic'].includes(accountForm.value.platform));
const isBatchCreation = computed(() => supportsBatchCreation.value && creationMode.value === 'batch');
const oauthOptions = computed<OAuthOptions>(() => ({ platform: accountForm.value.platform,
  type: accountForm.value.type === 'setup-token' ? 'setup-token' : 'oauth',
  ...(advanced.value.proxy_id ? { proxy_id: advanced.value.proxy_id } : {}),
  ...(accountForm.value.platform === 'gemini' ? geminiOptions.value : {}) }));
const accountForm = ref<{
  name: string;
  platform: AccountPlatform;
  type: AccountType;
  credentials: string;
  concurrency: number;
  priority: number;
  groups: number[];
}>({
  name: '',
  platform: 'anthropic',
  type: 'apikey',
  credentials: '',
  concurrency: 10,
  priority: 0,
  groups: [] as number[]
});
const credentialFields = ref({ base_url: '', aws_region: 'us-east-1',
  auth_mode: 'sigv4', aws_access_key_id: '', aws_secret_access_key: '', aws_session_token: '',
  service_account_json: '', location: 'us-central1' });
const replaceCredentials = ref(false);
const cnProvider = ref(cnProviderForm('minimax'));
let cnInitial = cloneCNProviderForm(cnProvider.value);
const supportedTypes = computed(() => {
  const platform = accountForm.value.platform;
  if (platform === 'anthropic') return ['apikey', 'oauth', 'setup-token', 'bedrock', 'service_account'];
  if (platform === 'gemini') return ['apikey', 'oauth', 'service_account'];
  if (supportsOAuth(platform)) return ['apikey', 'oauth'];
  return ['apikey'];
});
const unsupportedCreation = computed(() => !isEditing.value && !supportedTypes.value.includes(accountForm.value.type));
const formTypes = computed(() => types.filter(t => t.id && (supportedTypes.value.includes(t.id) || t.id === accountForm.value.type)));
function groupNames(account: Account) { return account.groups?.map(group => group.name).join('、') || ''; }
function resetCredentials() {
  oauthResult.value = null;
  accountForm.value.credentials = '';
  replaceCredentials.value = false;
  cnProvider.value = cnProviderForm(isCNProviderPlatform(accountForm.value.platform) ? accountForm.value.platform : 'minimax');
  cnInitial = cloneCNProviderForm(cnProvider.value);
  credentialFields.value = { base_url: '', aws_region: 'us-east-1', auth_mode: 'sigv4',
    aws_access_key_id: '', aws_secret_access_key: '', aws_session_token: '', service_account_json: '', location: 'us-central1' };
}
watch(() => accountForm.value.platform, () => {
  if (!isEditing.value && !supportedTypes.value.includes(accountForm.value.type)) accountForm.value.type = 'apikey';
  resetCredentials();
});
watch(() => accountForm.value.type, resetCredentials);
watch([() => accountForm.value.platform, () => accountForm.value.type], () => {
  creationMode.value = 'single';
  if (!isEditing.value) { policiesInitial = policyForm(); policies.value = policyForm(); policyAccount.value = null; }
});
watch(showAddSheet, show => { if (!show) resetCredentials(); });
function buildCredentials(): Record<string, unknown> {
  const fields = credentialFields.value;
  const required = (value: string, label: string) => {
    if (!value.trim()) throw new Error(`请填写${label}。`);
    return value.trim();
  };
  const endpoint = fields.base_url.trim();
  if (endpoint && !/^https?:\/\//i.test(endpoint)) throw new Error('端点须以 http:// 或 https:// 开头。');
  switch (accountForm.value.type) {
    case 'apikey':
      if (isCNProviderPlatform(accountForm.value.platform)) return buildCNProviderCredentials(accountForm.value.platform, cnProvider.value) || {};
      if (accountForm.value.platform === 'antigravity' && !endpoint) throw new Error('请填写 Antigravity 上游端点。');
      return { api_key: required(accountForm.value.credentials, 'API Key'), ...(endpoint ? { base_url: endpoint } : {}) };
    case 'oauth':
    case 'setup-token':
      if (!oauthResult.value) throw new Error('请先完成交互式授权。');
      return oauthResult.value.credentials;
    case 'bedrock':
      return { auth_mode: fields.auth_mode, aws_region: required(fields.aws_region, 'AWS 区域'),
        ...(fields.auth_mode === 'sigv4' ? {
          aws_access_key_id: required(fields.aws_access_key_id, 'Access Key ID'),
          aws_secret_access_key: required(fields.aws_secret_access_key, 'Secret Access Key'),
          ...(fields.aws_session_token.trim() ? { aws_session_token: fields.aws_session_token.trim() } : {})
        } : { api_key: required(accountForm.value.credentials, 'Bedrock API Key') }) };
    case 'service_account': {
      const raw = required(fields.service_account_json, '服务账号 JSON');
      let data: Record<string, unknown>;
      try { data = JSON.parse(raw); } catch { throw new Error('服务账号 JSON 格式不正确。'); }
      if (!data || typeof data !== 'object' || data.type !== 'service_account' ||
        typeof data.project_id !== 'string' || !data.project_id || typeof data.client_email !== 'string' ||
        !data.client_email || typeof data.private_key !== 'string' || !data.private_key) {
        throw new Error('服务账号须包含 project_id、client_email 和 private_key。');
      }
      return { service_account_json: raw, project_id: data.project_id, client_email: data.client_email,
        location: required(fields.location, 'Vertex 区域'), tier_id: 'vertex' };
    }
    default: throw new Error('该认证类型请通过原版后台维护。');
  }
}
const pendingDelete = ref<Account | null>(null);
const isDeleting = ref(false);
const probingIds = ref<number[]>([]);

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message || fallback;
  }
  return fallback;
}

function accountStatus(account: Account) {
  if (account.status === 'error') return { label: '异常', tone: 'danger' };
  if (account.status !== 'active') return { label: '停用', tone: 'neutral' };
  if ([account.rate_limit_reset_at, account.overload_until, account.temp_unschedulable_until]
    .some(until => until && Date.parse(until) > Date.now())) return { label: '冷却中', tone: 'warning' };
  if (account.schedulable === false) return { label: '暂停调度', tone: 'warning' };
  return { label: '启用', tone: 'success' };
}

function platformLabel(value: string) {
  return platforms.find(item => item.id === value)?.label || value;
}

function typeLabel(value: string) {
  return types.find(item => item.id === value)?.label || value || '—';
}

const toastMsg = ref<string | null>(null);
function showToast(msg: string) {
  toastMsg.value = msg;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2500);
}

const platforms = [
  { id: '', label: '全部平台' },
  { id: 'anthropic', label: 'Claude' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini' },
  { id: 'antigravity', label: 'Antigravity' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'grok', label: 'Grok (xAI)' },
  { id: 'kimi', label: 'Kimi' },
  { id: 'zhipu', label: 'Zhipu GLM' }
  ,{ id: 'minimax', label: 'MiniMax' }
];
const platformDescriptions: Record<string, string> = {
  anthropic: 'Anthropic · Claude', openai: 'ChatGPT · Codex', gemini: 'Google · Gemini',
  antigravity: 'Google · Antigravity', deepseek: 'DeepSeek API', grok: 'xAI · Grok', kimi: 'Moonshot · Kimi', zhipu: '智谱 · GLM',
  minimax: 'MiniMax · 海螺',
};
const selectablePlatforms = platforms.filter(platform => platform.id);
const authDescriptions: Record<string, string> = {
  apikey: '粘贴平台 API 密钥', oauth: '在浏览器登录并授权', 'setup-token': '使用 Claude Setup Token 授权',
  bedrock: 'AWS 签名或 Bedrock 密钥', service_account: '导入 Google 服务账号 JSON', upstream: '使用已有上游转发配置',
};
function selectFormPlatform(id: string) {
  if (isEditing.value || isSubmitting.value || oauthBusy.value) return;
  accountForm.value.platform = id as AccountPlatform;
  formError.value = '';
}
function selectFormType(id: string) {
  if (isEditing.value || isSubmitting.value || oauthBusy.value) return;
  accountForm.value.type = id as AccountType;
  formError.value = '';
}
const missingRequired = computed(() => {
  const missing: string[] = [];
  if (!accountForm.value.name.trim()) missing.push('账号名称');
  if ((!isEditing.value || replaceCredentials.value) && !isBatchCreation.value) {
    const t = accountForm.value.type, f = credentialFields.value;
    if (t === 'apikey' && accountForm.value.platform === 'antigravity' && !f.base_url.trim()) missing.push('上游端点');
    if ((t === 'apikey' || (t === 'bedrock' && f.auth_mode !== 'sigv4')) && !(t === 'apikey' && isCNProviderPlatform(accountForm.value.platform) ? cnProvider.value.api_key.trim() : accountForm.value.credentials.trim())) missing.push('API Key');
    if (t === 'bedrock') { if (!f.aws_region.trim()) missing.push('AWS 区域'); if (f.auth_mode === 'sigv4') { if (!f.aws_access_key_id.trim()) missing.push('Access Key ID'); if (!f.aws_secret_access_key.trim()) missing.push('Secret Access Key'); } }
    if (t === 'service_account') { if (!f.service_account_json.trim()) missing.push('服务账号 JSON'); if (!f.location.trim()) missing.push('Vertex 区域'); }
    if (isOAuth.value && !oauthResult.value) missing.push('完成平台授权');
  }
  return missing;
});
function displayDate(value: string | number | null | undefined) {
  if (!value) return '—';
  const d = new Date(typeof value === 'number' ? value * 1000 : value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function accountQuota(account: Account) {
  if (typeof account.quota_daily_limit === 'number' && account.quota_daily_limit > 0 && typeof account.quota_daily_used === 'number') return { label: '日额度', used: account.quota_daily_used, limit: account.quota_daily_limit };
  if (typeof account.quota_limit === 'number' && account.quota_limit > 0 && typeof account.quota_used === 'number') return { label: '总额度', used: account.quota_used, limit: account.quota_limit };
  return null;
}

const types = [
  { id: '', label: '全部类型' },
  { id: 'apikey', label: 'API 密钥' },
  { id: 'oauth', label: 'OAuth 授权' },
  { id: 'setup-token', label: 'Setup Token' },
  { id: 'bedrock', label: 'AWS Bedrock' },
  { id: 'service_account', label: '服务账号' },
  { id: 'upstream', label: '上游转发' }
];

const statuses = [
  { id: '', label: '全部状态' },
  { id: 'active', label: '启用' },
  { id: 'inactive', label: '停用' },
  { id: 'error', label: '异常' }
];

async function fetchData() {
  if (disposed) return;
  const version = ++requestVersion;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const res = await accountsAPI.list(page.value, pageSize.value, filters.value, { signal: controller.signal });
    if (disposed || version !== requestVersion) return;
    total.value = res.total;
    if (res.page_size > 0) pageSize.value = res.page_size;
    if (page.value > pageCount.value) {
      page.value = pageCount.value;
      await fetchData();
      return;
    }
    accounts.value = res.items || [];
    selectedIds.value = selectedIds.value.filter(id => accounts.value.some(account => account.id === id));
    hasLoaded.value = true;
    lastUpdated.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch (err: unknown) {
    if (disposed || version !== requestVersion || controller.signal.aborted) return;
    listError.value = errorMessage(err, '账号列表暂时无法加载，请稍后重试。');
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function fetchGroups() {
  groupsError.value = '';
  try {
    const result = await groupsAPI.getAllIncludingInactive();
    if (!disposed) groups.value = result;
  } catch (err: unknown) {
    if (!disposed) groupsError.value = errorMessage(err, '分组加载失败，请重试。');
  }
}

function applyFilters() {
  if (searchTimer) clearTimeout(searchTimer);
  selectedIds.value = [];
  accounts.value = [];
  hasLoaded.value = false;
  page.value = 1;
  void fetchData();
}

watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer);
  // Invalidate an older search immediately, before the next debounced request.
  listController?.abort();
  requestVersion++;
  loading.value = true;
  selectedIds.value = [];
  searchTimer = setTimeout(applyFilters, 300);
});
watch([selectedPlatform, selectedType, selectedStatus, selectedPrivacy, selectedGroup], applyFilters);

function resetFilters() {
  searchQuery.value = '';
  selectedPlatform.value = '';
  selectedType.value = '';
  selectedStatus.value = '';
  selectedPrivacy.value = '';
  selectedGroup.value = '';
}

function changePage(next: number) {
  if (loading.value || next < 1 || next > pageCount.value) return;
  page.value = next;
  selectedIds.value = [];
  accounts.value = [];
  hasLoaded.value = false;
  void fetchData();
}

function changePageSize() {
  applyFilters();
}

function closeMenus(event: Event) {
  if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
  if (event.type === 'pointerdown' && event.target instanceof Element && event.target.closest('[data-account-menu]')) return;
  showMoreMenu.value = false;
  showAutoRefreshMenu.value = false;
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshCountdown.value = autoRefreshInterval.value;
  autoRefreshTimer = setInterval(() => {
    autoRefreshCountdown.value--;
    if (autoRefreshCountdown.value <= 0) {
      autoRefreshCountdown.value = autoRefreshInterval.value;
      if (!loading.value && !document.hidden && !showAddSheet.value && !showBatchEditSheet.value &&
        !showBatchDeleteAlert.value && !pendingDelete.value && !isBatchSubmitting.value && !reauthorizeAccount.value && !scheduledAccount.value) void fetchData();
    }
  }, 1000);
}

function toggleAutoRefresh(sec?: number) {
  if (sec) {
    autoRefreshInterval.value = sec;
    autoRefreshEnabled.value = true;
    startAutoRefresh();
  } else {
    autoRefreshEnabled.value = !autoRefreshEnabled.value;
    if (autoRefreshEnabled.value) {
      startAutoRefresh();
    } else if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
    }
  }
  showAutoRefreshMenu.value = false;
}

function toggleSelectAll(e: Event) {
  if (loading.value || isBatchSubmitting.value) return;
  const chk = (e.target as HTMLInputElement).checked;
  if (chk) {
    selectedIds.value = accounts.value.map(a => a.id);
  } else {
    selectedIds.value = [];
  }
}

function toggleSelect(id: number) {
  const idx = selectedIds.value.indexOf(id);
  if (idx >= 0) selectedIds.value.splice(idx, 1);
  else selectedIds.value.push(id);
}

function openAddSheet() {
  if (isSubmitting.value || oauthBusy.value) return;
  if (hasPendingCreate()) { showCreateReview.value = true; return; }
  creationMode.value = 'single';
  policyGeneration++; policyLoading.value = false; policyReady.value = true; policyAccount.value = null;
  policiesInitial = policyForm(); policies.value = policyForm();
  advancedInitial = advancedForm(); advanced.value = { ...advancedInitial };
  geminiOptions.value = { project_id: '', oauth_type: 'code_assist', tier_id: '' };
  resetCredentials();
  formError.value = '';
  isEditing.value = false;
  editingId.value = null;
  accountForm.value = {
    name: '',
    platform: 'anthropic',
    type: 'apikey',
    credentials: '',
    concurrency: 10,
    priority: 0,
    groups: []
  };
  showAddSheet.value = true;
}

let basicAccountBaseline: Record<string, unknown> = {};
function basicAccountFields() {
  return { name: accountForm.value.name.trim(), concurrency: accountForm.value.concurrency,
    priority: accountForm.value.priority, group_ids: [...accountForm.value.groups] };
}
function openEditSheet(acc: Account) {
  if (isSubmitting.value || oauthBusy.value) return;
  advancedInitial = advancedForm(acc); advanced.value = { ...advancedInitial };
  resetCredentials();
  formError.value = '';
  isEditing.value = true;
  editingId.value = acc.id;
  accountForm.value = {
    name: acc.name,
    platform: acc.platform,
    type: acc.type || 'apikey',
    credentials: '',
    concurrency: acc.concurrency ?? 10,
    priority: acc.priority ?? 0,
    groups: acc.group_ids ?? acc.groups?.map(g => g.id) ?? []
  };
  basicAccountBaseline = JSON.parse(JSON.stringify(basicAccountFields()));
  showAddSheet.value = true;
  policyAccount.value = null; policyReady.value = false;
  policiesInitial = policyForm(); policies.value = policyForm();
  void loadAccountPolicies();
}

async function loadAccountPolicies() {
  const id = editingId.value;
  if (!id) return;
  const version = ++policyGeneration;
  policyLoading.value = true; policyReady.value = false; formError.value = '';
  try {
    const account = await accountsAPI.getById(id);
    if (disposed || version !== policyGeneration || editingId.value !== id || !showAddSheet.value) return;
    if (account.id !== id) throw new Error('账号详情不匹配，请重新读取。');
    if (isCNProviderPlatform(account.platform)) { cnProvider.value = cnProviderForm(account.platform, { ...account, credentials: account.credentials || {} }); cnInitial = cloneCNProviderForm(cnProvider.value); }
    policyAccount.value = account; policiesInitial = policyForm(account); policies.value = policyForm(account); policyReady.value = true;
  } catch (e) { if (version === policyGeneration) formError.value = errorMessage(e, '账号策略读取失败，请重新读取后保存。'); }
  finally { if (version === policyGeneration) policyLoading.value = false; }
}

async function openBatchAuthorization() {
  if (isEditing.value || isSubmitting.value || oauthBusy.value || !['openai', 'anthropic'].includes(accountForm.value.platform) || !isOAuth.value) return;
  if (hasPendingCreate()) { showCreateReview.value = true; return; }
  formError.value = '';
  try {
    if (!accountForm.value.name.trim()) throw new Error('请先填写账号名称。');
    if (!Number.isInteger(accountForm.value.concurrency) || accountForm.value.concurrency < 1 || !Number.isInteger(accountForm.value.priority) || accountForm.value.priority < 0) throw new Error('并发须为正整数，优先级须为非负整数。');
    if (groupsError.value) throw new Error('请先重新加载分组，再进行批量创建。');
    const updates = advancedPatch(advanced.value, advancedInitial, false);
    const policy = applyPolicies(policies.value, policiesInitial, { platform: accountForm.value.platform, type: accountForm.value.type, credentials: {} }, false);
    let confirmed = false;
    if (accountForm.value.platform === 'anthropic' && accountForm.value.groups.length) {
      isSubmitting.value = true;
      try { const result = await checkEditorRisk(editorGeneration); if (result === null || disposed) return; confirmed = result; }
      finally { isSubmitting.value = false; }
    }
    batchAuthorization.value = JSON.parse(JSON.stringify({ ...updates, ...(confirmed ? { confirm_mixed_channel_risk: true } : {}), name: accountForm.value.name.trim(), platform: accountForm.value.platform,
      type: accountForm.value.type, concurrency: accountForm.value.concurrency, priority: accountForm.value.priority,
      group_ids: accountForm.value.groups, credential_extras: policy.credentials, extra: policy.extra }));
  } catch (e) { formError.value = errorMessage(e, '请检查账号设置。'); }
}

async function handleSaveAccount() {
  if (isSubmitting.value || oauthBusy.value || policyLoading.value || !policyReady.value || unsupportedCreation.value) return;
  if (!isEditing.value && hasPendingCreate()) { formError.value = createStorageError.value || (legacyPendingCreate.value ? legacyCreateNotice : '上次创建结果尚未确认，新增已暂停。请先核对创建结果。'); return; }
  if (isBatchCreation.value) { await openBatchAuthorization(); return; }
  formError.value = '';
  if (!accountForm.value.name.trim()) {
    formError.value = '请输入账号名称。';
    return;
  }
  let credentials: Record<string, unknown> | undefined;
  if (!isEditing.value || replaceCredentials.value) {
    try { credentials = buildCredentials(); }
    catch (error) { formError.value = errorMessage(error, '请检查认证信息。'); return; }
  }
  if (!Number.isInteger(accountForm.value.concurrency) || accountForm.value.concurrency < 1 ||
    !Number.isInteger(accountForm.value.priority) || accountForm.value.priority < 0) {
    formError.value = '并发限制须为正整数，优先级须为非负整数。';
    return;
  }
  let advancedUpdates;
  try { advancedUpdates = advancedPatch(advanced.value, advancedInitial, isEditing.value); }
  catch (error) { formError.value = errorMessage(error, '请检查高级设置。'); return; }
  isSubmitting.value = true;
  const saveGeneration = editorGeneration;
  try {
    const riskConfirmed = await checkEditorRisk(saveGeneration);
    if (riskConfirmed === null || disposed || saveGeneration !== editorGeneration) return;
    if (isEditing.value && editingId.value) {
      const id = editingId.value;
      const basic = basicAccountFields();
      const basicUpdates = Object.fromEntries(Object.entries(basic).filter(([key,value]) =>
        JSON.stringify(value) !== JSON.stringify(basicAccountBaseline[key])));
      if (groupsError.value) delete basicUpdates.group_ids;
      const current = await accountsAPI.getById(id);
      if (disposed || !showAddSheet.value || editingId.value !== id) return;
      if (current.id !== id) throw new Error('账号详情不匹配，请重新读取后保存。');
      const replacingCN = replaceCredentials.value && accountForm.value.type === 'apikey' && isCNProviderPlatform(accountForm.value.platform);
      if (replacingCN) credentials = buildCNProviderCredentials(accountForm.value.platform, cnProvider.value, { current: { ...current, credentials: current.credentials || {} }, initial: cnInitial });
      const policyUpdates = applyPolicies(policies.value, policiesInitial, { ...current, credentials: replacingCN ? credentials || current.credentials || {} : { ...current.credentials, ...credentials } }, true);
      if (replacingCN) credentials = policyUpdates.credentials ?? credentials;
      else if (credentials) credentials = { ...current.credentials, ...credentials, ...policyUpdates.credentials };
      else credentials = policyUpdates.credentials;
      await saveWithRisk(confirmed => accountsAPI.update(id, {
        ...(confirmed ? { confirm_mixed_channel_risk: true } : {}),
        ...advancedUpdates,
        ...(policyUpdates.extra ? { extra: policyUpdates.extra } : {}),
        ...basicUpdates,
        ...(credentials ? { credentials } : {})
      }), riskConfirmed, saveGeneration);
      if (disposed || saveGeneration !== editorGeneration) return;
      showToast('账号更新成功');
    } else {
      const policyUpdates = applyPolicies(policies.value, policiesInitial, {
        platform: accountForm.value.platform, type: accountForm.value.type, credentials,
        extra: isOAuth.value ? oauthResult.value?.extra : undefined
      }, false);
      const createPayload = {
        ...advancedUpdates,
        ...(policyUpdates.extra ? { extra: policyUpdates.extra } : {}),
        name: accountForm.value.name.trim(),
        platform: accountForm.value.platform,
        type: accountForm.value.type,
        concurrency: accountForm.value.concurrency,
        priority: accountForm.value.priority,
        group_ids: [...accountForm.value.groups],
        credentials: policyUpdates.credentials!
      };
      const operationKey = `account-create-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
      await saveWithRisk(async confirmed => {
        if (hasPendingCreate()) throw new Error('Pending creation requires review');
        // Risk confirmation changes the request fingerprint, and follows a definitive rejection.
        const key = `${operationKey}${confirmed ? '-confirmed' : ''}`;
        if (!setPendingCreate(key)) throw new Error(createStorageError.value);
        try {
          const result = await accountsAPI.create({ ...createPayload, ...(confirmed ? { confirm_mixed_channel_risk: true } : {}) }, key);
          if (!Number.isSafeInteger(result?.id) || result.id < 1) throw new Error('Missing created account');
          clearPendingCreate(key);
          return result;
        } catch (error) {
          const e = error as { status?: number; error?: string; response?: { status?: number; data?: { error?: string } } };
          const status = e?.status ?? e?.response?.status;
          const riskRejected = status === 409 && (e?.error ?? e?.response?.data?.error) === 'mixed_channel_warning';
          // Generic 409 (including idempotency in-progress), 408, 5xx and missing responses stay locked.
          if (riskRejected || (status && [400, 401, 403, 404, 405, 422, 429].includes(status))) clearPendingCreate(key);
          throw error;
        }
      }, riskConfirmed, saveGeneration);
      if (disposed || !ownsCreateSession() || saveGeneration !== editorGeneration) return;
      showToast('账号创建成功');
    }
    showAddSheet.value = false;
    resetCredentials();
    fetchData();
  } catch (err: unknown) {
    if (!disposed && saveGeneration === editorGeneration) formError.value = createStorageError.value || (!isEditing.value && pendingCreate.value
      ? '创建结果尚未确认，新增已暂停。请核对账号列表；本次请求不会再次提交。'
      : errorMessage(err, '保存账号失败，请检查后重试。'));
  } finally {
    isSubmitting.value = false;
  }
}

async function confirmDeleteAccount() {
  if (!pendingDelete.value || isDeleting.value) return;
  const id = pendingDelete.value.id;
  isDeleting.value = true;
  try {
    await accountsAPI.delete(id);
    pendingDelete.value = null;
    selectedIds.value = selectedIds.value.filter(selected => selected !== id);
    showToast('账号已删除');
    await fetchData();
  } catch (err: unknown) {
    showToast(errorMessage(err, '删除失败，请重试。'));
  } finally {
    isDeleting.value = false;
  }
}

async function handleProbeAccount(id: number) {
  if (probingIds.value.includes(id)) return;
  probingIds.value.push(id);
  try {
    const result = await accountsAPI.testAccount(id);
    showToast(result.success
      ? `连接测试通过${result.latency_ms == null ? '' : ` · ${result.latency_ms} ms`}`
      : result.message || '连接测试未通过，请检查账号配置。');
  } catch (err: unknown) {
    showToast(errorMessage(err, '测试失败，请重试。'));
  } finally {
    probingIds.value = probingIds.value.filter(probingId => probingId !== id);
  }
}

// ==================== Batch Edit ====================
const showBatchEditSheet = ref(false);
const isBatchSubmitting = ref(false);
const batchForm = ref<{
  status?: string;
  concurrency?: number;
  priority?: number;
  group_ids?: number[];
}>({
  status: '',
  concurrency: undefined,
  priority: undefined,
  group_ids: []
});

function openBatchEdit() {
  if (selectedIds.value.length === 0) {
    showToast('请先选择至少一个账号');
    return;
  }
  batchForm.value = {
    status: '',
    concurrency: undefined,
    priority: undefined,
    group_ids: []
  };
  showBatchEditSheet.value = true;
}

async function handleBulkUpdateSubmit() {
  if (selectedIds.value.length === 0 || isBatchSubmitting.value) return;
  isBatchSubmitting.value = true;
  try {
    const payload: Record<string, any> = {};
    if (batchForm.value.status) payload.status = batchForm.value.status;
    if (batchForm.value.concurrency != null && batchForm.value.concurrency > 0) payload.concurrency = batchForm.value.concurrency;
    if (batchForm.value.priority != null) payload.priority = batchForm.value.priority;
    if (batchForm.value.group_ids && batchForm.value.group_ids.length > 0) payload.group_ids = batchForm.value.group_ids;
    if (Object.keys(payload).length === 0) {
      showToast('请至少修改一项配置');
      return;
    }

    const ids = [...selectedIds.value];
    const version = editorGeneration;
    let confirmed = false;
    if (payload.group_ids) {
      for (const account of accounts.value.filter(a => ids.includes(a.id) && ['anthropic', 'antigravity'].includes(a.platform))) {
        const risk = await accountsAPI.checkMixedChannelRisk({ platform: account.platform, account_id: account.id, group_ids: [...payload.group_ids] });
        if (disposed || !showBatchEditSheet.value) return;
        if (!risk || typeof risk.has_risk !== 'boolean') throw new Error('混合渠道风险检查结果无效。');
        if (risk.has_risk) {
          mixedRisk.value = risk.message || '选中账号绑定的分组存在混合渠道风险，是否仍要批量保存？';
          confirmed = await new Promise<boolean>(resolve => { riskResolve = resolve; });
          if (!confirmed || disposed || !showBatchEditSheet.value) return;
          break;
        }
      }
    }
    const res = await saveWithRisk(accepted => accountsAPI.bulkUpdate(ids, { ...payload, ...(accepted ? { confirm_mixed_channel_risk: true } : {}) }), confirmed, version);
    if (disposed || !showBatchEditSheet.value) return;
    showToast(`批量更新完成：${res.success} 成功，${res.failed} 失败`);
    showBatchEditSheet.value = false;
    fetchData();
  } catch (err: any) {
    showToast(errorMessage(err, '批量更新失败'));
  } finally {
    isBatchSubmitting.value = false;
  }
}

const showBatchDeleteAlert = ref(false);

function handleBatchDeleteSubmit() {
  if (selectedIds.value.length === 0) return;
  showBatchDeleteAlert.value = true;
}

async function confirmBatchDelete() {
  if (!selectedIds.value.length || isBatchSubmitting.value) return;
  isBatchSubmitting.value = true;
  try {
    const res = await accountsAPI.batchDelete(selectedIds.value);
    showToast(`批量删除已完成: ${res.success} 成功, ${res.failed} 失败`);
    selectedIds.value = [];
    showBatchDeleteAlert.value = false;
    showBatchEditSheet.value = false;
    fetchData();
  } catch (err: any) {
    showToast(errorMessage(err, '批量删除失败'));
  } finally {
    isBatchSubmitting.value = false;
  }
}

async function handleBatchClearErrorSubmit() {
  if (selectedIds.value.length === 0 || isBatchSubmitting.value) return;
  isBatchSubmitting.value = true;
  try {
    const res = await accountsAPI.batchClearError(selectedIds.value);
    showToast(`清除错误完成：${res.success} 成功，${res.failed} 失败`);
    showBatchEditSheet.value = false;
    fetchData();
  } catch (err: any) {
    showToast(errorMessage(err, '批量清除错误失败'));
  } finally {
    isBatchSubmitting.value = false;
  }
}

// ==================== CRS Sync ====================
const showCrsModal = ref(false);
const crsBaseUrl = ref('');
const crsUsername = ref('');
const crsPassword = ref('');
const crsSyncProxies = ref(true);
const isCrsSyncing = ref(false);
const crsSyncResult = ref<string | null>(null);

function openSyncCrsModal() {
  showMoreMenu.value = false;
  crsBaseUrl.value = '';
  crsUsername.value = '';
  crsPassword.value = '';
  crsSyncProxies.value = true;
  crsSyncResult.value = null;
  showCrsModal.value = true;
}

async function handleSyncCrsSubmit() {
  if (isCrsSyncing.value) return;
  if (!crsBaseUrl.value.trim() || !crsUsername.value.trim() || !crsPassword.value.trim()) {
    showToast('请完整填写 CRS 连接地址、用户名与密码');
    return;
  }
  isCrsSyncing.value = true;
  crsSyncResult.value = null;
  try {
    const res = await accountsAPI.syncFromCrs({
      base_url: crsBaseUrl.value.trim(),
      username: crsUsername.value.trim(),
      password: crsPassword.value.trim(),
      sync_proxies: crsSyncProxies.value
    });
    crsSyncResult.value = `同步成功: 新增 ${res.created ?? 0} 个, 更新 ${res.updated ?? 0} 个, 跳过 ${res.skipped ?? 0} 个, 失败 ${res.failed ?? 0} 个`;
    showToast('CRS 同步完成');
    fetchData();
  } catch (err: any) {
    showToast(errorMessage(err, 'CRS 同步失败'));
  } finally {
    isCrsSyncing.value = false;
  }
}

// ==================== Data Import ====================
const showImportModal = ref(false);
const importFiles = ref<File[]>([]);
const importDirectory = ref(false);
const importBusy = ref(false);
const dragDepth = ref(0);
function openImportModal() {
  if (importBusy.value) return;
  showMoreMenu.value = false;
  importFiles.value = []; importDirectory.value = false;
  showImportModal.value = true;
}
function receiveImportFiles(files: File[], directory = false) {
  if (importBusy.value) { showToast('正在导入，请等待结果后再添加文件。'); return; }
  importDirectory.value = directory;
  showImportModal.value = true;
  importFiles.value = [...files];
}
function fileDrag(event: DragEvent) { return Array.from(event.dataTransfer?.types || []).includes('Files'); }
function dragEnter(event: DragEvent) { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); dragDepth.value++; }
function dragOver(event: DragEvent) { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); if (event.dataTransfer) event.dataTransfer.dropEffect = importBusy.value ? 'none' : 'copy'; }
function dragLeave(event: DragEvent) { if (!fileDrag(event)) return; event.preventDefault(); event.stopPropagation(); dragDepth.value = Math.max(0, dragDepth.value - 1); }
function dropImport(event: DragEvent) {
  if (!fileDrag(event)) return;
  event.preventDefault(); event.stopPropagation(); dragDepth.value = 0;
  window.dispatchEvent(new Event('sub2-files-consumed'));
  const transfer = event.dataTransfer;
  const directory = Array.from(transfer?.items || []).some(item => item.webkitGetAsEntry?.()?.isDirectory);
  receiveImportFiles(Array.from(transfer?.files || []), directory);
}
function closeImport() { if (importBusy.value) return; showImportModal.value = false; importFiles.value = []; importDirectory.value = false; }
watch(() => props.win?.customData?.importFiles, files => {
  if (!Array.isArray(files) || !files.length) return;
  receiveImportFiles(files as File[]);
  // Acknowledge the desktop handoff and release its secret-bearing File refs.
  if (props.win?.customData?.importFiles === files) delete props.win.customData.importFiles;
}, { immediate: true });

// ==================== Data Export ====================
async function handleExportData() {
  showMoreMenu.value = false;
  try {
    showToast('正在导出数据...');
    const data = await accountsAPI.exportData({
      ids: selectedIds.value.length > 0 ? selectedIds.value : undefined,
      filters: selectedIds.value.length > 0 ? undefined : filters.value,
      includeProxies: true
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `accounts-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('账号数据导出完成');
  } catch (err: any) {
    showToast(errorMessage(err, '导出数据失败'));
  }
}

onMounted(() => {
  fetchData();
  fetchGroups();
  document.addEventListener('pointerdown', closeMenus);
  appRoot.value?.addEventListener('keydown', closeMenus);
});

onUnmounted(() => {
  editorGeneration++; resolveMixedRisk(false);
  disposed = true;
  importFiles.value = [];
  requestVersion++;
  listController?.abort();
  if (searchTimer) clearTimeout(searchTimer);
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  document.removeEventListener('pointerdown', closeMenus);
  appRoot.value?.removeEventListener('keydown', closeMenus);
});
</script>

<template>
  <div ref="appRoot" class="accounts-app flex flex-col h-full select-none overflow-hidden relative" @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragLeave" @drop="dropImport">
    <div v-if="dragDepth" class="accounts-drop-hint" role="status"><strong>{{ importBusy ? '正在导入，请稍候' : '松开以检查 JSON 文件' }}</strong><span>先预览，再确认导入</span></div>
    <!-- Top Action Bar (macOS Native Toolbar) -->
    <div class="accounts-toolbar">
      <div class="flex items-center gap-3 min-w-0">
        <img :src="getAppIcon('accounts')" alt="" class="w-8 h-8 rounded-lg object-contain shrink-0" />
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold tracking-tight text-black/90 dark:text-white/90">账号管理</h2>
            <span v-if="hasLoaded" class="accounts-count">
              {{ total.toLocaleString() }}
            </span>
          </div>
          <p class="accounts-subtitle">上游账号与调度配置</p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="accounts-actions">
        <MacButton size="sm" :disabled="importBusy" @click="openImportModal">导入 JSON</MacButton>
        <!-- Manual Refresh -->
        <button
          type="button"
          class="h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 text-xs font-medium flex items-center gap-1.5 transition-all text-black/80 dark:text-white/80"
          :disabled="loading"
          title="刷新数据"
          aria-label="刷新账号列表"
          @click="fetchData"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        <!-- Auto Refresh Dropdown -->
        <div class="relative" data-account-menu>
          <button
            type="button"
            class="h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 text-xs font-medium flex items-center gap-1.5 transition-all text-black/80 dark:text-white/80"
            :aria-expanded="showAutoRefreshMenu"
            aria-label="自动刷新设置"
            @click="showAutoRefreshMenu = !showAutoRefreshMenu; showMoreMenu = false"
          >
            <svg class="w-3.5 h-3.5 text-black/60 dark:text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span class="accounts-auto-label">{{ autoRefreshEnabled ? `${autoRefreshCountdown}s` : '自动刷新' }}</span>
          </button>
          <div
            v-if="showAutoRefreshMenu"
            class="absolute right-0 top-full mt-1.5 w-44 p-1.5 rounded-xl bg-white/90 dark:bg-[#2c2c2e]/95 backdrop-blur-xl border border-black/10 dark:border-white/15 shadow-2xl z-50 text-xs space-y-0.5"
          >
            <button
              type="button"
              class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-between text-black/80 dark:text-white/80"
              @click="toggleAutoRefresh()"
            >
              <span>{{ autoRefreshEnabled ? '关闭自动刷新' : '开启自动刷新' }}</span>
              <span v-if="autoRefreshEnabled" class="text-blue-500 font-bold">✓</span>
            </button>
            <div class="my-1 border-t border-black/[0.06] dark:border-white/[0.08]"></div>
            <button
              v-for="sec in [10, 30, 60]"
              :key="sec"
              type="button"
              class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-between text-black/80 dark:text-white/80"
              @click="toggleAutoRefresh(sec)"
            >
              <span>每 {{ sec }} 秒</span>
              <span v-if="autoRefreshInterval === sec && autoRefreshEnabled" class="text-blue-500 font-bold">✓</span>
            </button>
          </div>
        </div>

        <!-- More Actions Dropdown -->
        <div class="relative" data-account-menu>
          <button
            type="button"
            class="h-7 px-2.5 rounded-lg bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 text-xs font-medium flex items-center gap-1.5 transition-all text-black/80 dark:text-white/80"
            :aria-expanded="showMoreMenu"
            @click="showMoreMenu = !showMoreMenu; showAutoRefreshMenu = false"
          >
            <span class="text-[11.5px]">更多工具</span>
            <svg class="w-3 h-3 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <div
            v-if="showMoreMenu"
            class="absolute right-0 top-full mt-1.5 w-48 p-1.5 rounded-xl bg-white/90 dark:bg-[#2c2c2e]/95 backdrop-blur-xl border border-black/10 dark:border-white/15 shadow-2xl z-50 text-xs space-y-0.5"
          >
            <button type="button" class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2.5 text-black/80 dark:text-white/80" @click="openSyncCrsModal">
              <svg class="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>从 CRS 同步账号</span>
            </button>
            <button type="button" class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2.5 text-black/80 dark:text-white/80" @click="openImportModal">
              <svg class="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              <span>数据导入 (JSON)</span>
            </button>
            <button type="button" class="w-full px-3 py-1.5 text-left rounded-lg hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2.5 text-black/80 dark:text-white/80" @click="handleExportData()">
              <svg class="w-3.5 h-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>{{ selectedIds.length ? '导出已选账号' : hasFilters ? '导出筛选结果' : '导出全部账号' }}</span>
            </button>
          </div>
        </div>

        <!-- Add Account Button (macOS native primary button in Apple System Blue) -->
        <MacButton
          size="sm"
          variant="primary"
          @click="openAddSheet"
        >
          <span class="flex items-center gap-1 font-medium">
            <span>+</span>
            <span>添加账号</span>
          </span>
        </MacButton>
      </div>
    </div>

    <nav class="accounts-platform-nav" aria-label="账号平台">
      <button v-for="p in platforms" :key="p.id" type="button" :aria-pressed="selectedPlatform === p.id" :data-platform="p.id" @click="selectedPlatform = p.id">
        <PlatformMark v-if="p.id" :platform="p.id" /><span v-else class="accounts-all-mark" aria-hidden="true">▦</span><span>{{ p.label }}</span>
      </button>
    </nav>
    <!-- Filters Section (Unified AppKit Toolbar Inset) -->
    <div class="accounts-filters">
      <!-- Search Input -->
      <div class="accounts-search relative">
        <input
          v-model="searchQuery"
          type="search"
          aria-label="搜索账号"
          placeholder="搜索账号…"
          class="w-full h-7.5 pl-8 pr-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none focus:ring-1 focus:ring-[#007aff] text-black/90 dark:text-white/90 placeholder:text-black/40 dark:placeholder:text-white/40"
          @keydown.enter="applyFilters"
        />
        <svg class="w-3.5 h-3.5 absolute left-2.5 top-2 text-black/40 dark:text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      <!-- Type Filter -->
      <select
        v-model="selectedType"
        aria-label="按认证类型筛选"
        class="h-7.5 px-2.5 text-[11.5px] rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-black/80 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-[#007aff]"
      >
        <option v-for="t in types" :key="t.id" :value="t.id">{{ t.label }}</option>
      </select>

      <!-- Status Filter -->
      <select
        v-model="selectedStatus"
        aria-label="按账号状态筛选"
        class="h-7.5 px-2.5 text-[11.5px] rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-black/80 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-[#007aff]"
      >
        <option v-for="s in statuses" :key="s.id" :value="s.id">{{ s.label }}</option>
      </select>

      <!-- Group Filter -->
      <select
        v-model="selectedGroup"
        aria-label="按分组筛选"
        :disabled="!!groupsError"
        class="h-7.5 px-2.5 text-[11.5px] rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] text-black/80 dark:text-white/80 focus:outline-none focus:ring-1 focus:ring-[#007aff]"
      >
        <option value="">全部分组</option>
        <option v-for="g in groups" :key="g.id" :value="g.id.toString()">{{ g.name }}</option>
      </select>
      <button v-if="hasFilters" type="button" class="accounts-text-button" @click="resetFilters">重置筛选</button>
    </div>

    <div v-if="groupsError" class="accounts-inline-notice" role="status">
      <span>分组暂时无法加载，分组选择不可用。</span>
      <button type="button" class="accounts-text-button" @click="fetchGroups">重试</button>
    </div>
    <p v-if="createStorageError" class="accounts-inline-notice" role="alert">{{ createStorageError }}</p>
    <div v-if="listError && accounts.length" class="accounts-inline-notice" role="alert">
      <span>刷新失败，当前显示上次加载的账号。{{ listError }}</span>
      <button type="button" class="accounts-text-button" @click="fetchData">重试</button>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" role="status" aria-live="polite" class="accounts-toast">
      <span class="w-2 h-2 rounded-full bg-blue-400"></span>
      <span>{{ toastMsg }}</span>
    </div>

    <div class="accounts-body" :aria-busy="loading">
      <div v-if="!loading && !accounts.length" class="accounts-state" :role="listError ? 'alert' : 'status'">
        <img :src="getAppIcon('accounts')" alt="" class="accounts-state-icon" />
        <h3>{{ listError ? '暂时无法加载账号' : hasFilters ? '没有匹配的账号' : '还没有上游账号' }}</h3>
        <p>{{ listError || (hasFilters ? '试试其他关键词，或清除筛选条件。' : '添加账号，或将官方导出的 JSON 拖入此窗口。') }}</p>
        <MacButton v-if="listError" size="sm" @click="fetchData">重新加载</MacButton>
        <MacButton v-else-if="hasFilters" size="sm" @click="resetFilters">清除筛选</MacButton>
        <MacButton v-else size="sm" variant="primary" @click="openAddSheet">添加账号</MacButton>
      </div>

      <div v-else class="accounts-table-scroll" tabindex="0" aria-label="账号列表，可横向滚动查看全部列">
        <table class="accounts-table" :class="{ 'is-refreshing': loading && accounts.length }">
          <caption class="sr-only">上游账号列表，选择仅作用于当前页</caption>
          <thead>
            <tr>
              <th scope="col" class="accounts-check">
                <input type="checkbox" aria-label="选择本页全部账号" :checked="allSelected"
                  :indeterminate="partlySelected" :disabled="loading || isBatchSubmitting || !accounts.length" @change="toggleSelectAll" />
              </th>
              <th scope="col">账号 / 认证</th>
              <th scope="col">运行状态</th>
              <th scope="col">分组</th>
              <th scope="col">调度</th>
              <th scope="col">额度 / 倍率</th>
              <th scope="col" class="accounts-row-actions">操作</th>
            </tr>
          </thead>
          <tbody v-if="loading && !accounts.length" aria-hidden="true">
            <tr v-for="row in 7" :key="row" class="accounts-skeleton-row">
              <td class="accounts-check"><span class="accounts-skeleton check"></span></td>
              <td><span class="accounts-skeleton name"></span><span class="accounts-skeleton detail"></span></td>
              <td v-for="cell in 5" :key="cell"><span class="accounts-skeleton" :style="{ width: cell === 3 ? '82%' : '62%' }"></span></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="acc in accounts" :key="acc.id" :class="{ 'is-selected': selectedIds.includes(acc.id) }">
              <td class="accounts-check">
                <input type="checkbox" :aria-label="`选择账号 ${acc.name}`" :checked="selectedIds.includes(acc.id)"
                  :disabled="loading || isBatchSubmitting" @change="toggleSelect(acc.id)" />
              </td>
              <td class="accounts-name-cell">
                <div class="account-identity"><span class="account-logo"><PlatformMark :platform="acc.platform" /></span><div class="account-identity-text"><button type="button" class="accounts-name" :title="acc.name" :disabled="loading" @click="openEditSheet(acc)">{{ acc.name }}</button><span class="accounts-secondary"><span :data-platform="acc.platform" class="accounts-platform">{{ platformLabel(acc.platform) }}</span><span class="identity-separator">·</span>{{ typeLabel(acc.type) }}<span class="identity-separator">·</span>#{{ acc.id }}</span></div></div>
                <details class="accounts-mobile-details"><summary>详情与操作</summary><p>分组：{{ groupNames(acc) || '未绑定' }}</p><p>并发 {{ acc.current_concurrency ?? '—' }} / {{ acc.concurrency ?? '—' }} · 优先级 {{ acc.priority ?? '—' }}</p><p>倍率 {{ acc.rate_multiplier ?? '—' }} · 最近使用 {{ displayDate(acc.last_used_at) }}</p><div class="accounts-mobile-actions"><button :disabled="loading" @click="openEditSheet(acc)">编辑</button><button :disabled="loading || probingIds.includes(acc.id)" @click="handleProbeAccount(acc.id)">测试</button><button :disabled="loading" @click="scheduledAccount = acc">计划测试</button><button v-if="acc.platform === 'grok' && acc.type === 'oauth'" @click="mediaAccount = acc">媒体生成资格</button><button v-if="supportsOAuth(acc.platform) && (acc.type === 'oauth' || acc.type === 'setup-token')" @click="reauthorizeAccount = acc">重新授权</button><button :disabled="loading || isDeleting || isBatchSubmitting" @click="pendingDelete = acc">删除</button></div></details>
              </td>
              <td class="account-health-cell">
                <span class="accounts-status" :data-tone="accountStatus(acc).tone"><i aria-hidden="true"></i>{{ accountStatus(acc).label }}</span>
                <span class="accounts-secondary">{{ acc.last_used_at ? `最近 ${displayDate(acc.last_used_at)}` : '尚未使用' }}</span>
                <span v-if="acc.expires_at" class="accounts-secondary">到期 {{ displayDate(acc.expires_at) }}</span>
              </td>
              <td class="accounts-group-cell"><span v-if="acc.groups?.length" class="group-pills"><span v-for="group in acc.groups.slice(0,2)" :key="group.id">{{ group.name }}</span><span v-if="acc.groups.length>2" :title="groupNames(acc)">+{{ acc.groups.length-2 }}</span></span><span v-else class="accounts-muted">{{ acc.group_ids?.length ? `${acc.group_ids.length} 个分组` : '未绑定' }}</span></td>
              <td class="account-schedule-cell"><span class="metric-pair"><strong>{{ acc.current_concurrency ?? '—' }}</strong><span>/ {{ acc.concurrency ?? '—' }} 并发</span></span><span class="accounts-secondary">优先级 {{ acc.priority ?? '—' }}<span v-if="acc.scheduler_score"> · 分数 {{ acc.scheduler_score.base_score }}</span></span></td>
              <td class="account-quota-cell"><template v-if="accountQuota(acc)"><span class="quota-caption">{{ accountQuota(acc)!.label }} <strong>{{ accountQuota(acc)!.used.toFixed(2) }} / {{ accountQuota(acc)!.limit.toFixed(2) }}</strong></span><progress :value="accountQuota(acc)!.used" :max="accountQuota(acc)!.limit" :aria-label="`${acc.name} ${accountQuota(acc)!.label}`" /></template><span v-else class="accounts-muted">{{ acc.quota_limit == null && acc.quota_daily_limit == null ? '额度未返回' : '未设置限额' }}</span><span class="accounts-secondary">{{ acc.rate_multiplier == null ? '倍率未返回' : `倍率 ${acc.rate_multiplier.toFixed(2)}×` }}</span></td>
              <td class="accounts-row-actions"><div class="row-primary-actions"><button type="button" :aria-label="`编辑账号 ${acc.name}`" :disabled="loading" @click="openEditSheet(acc)">编辑</button><button type="button" :aria-label="`测试账号 ${acc.name}`" :disabled="loading || probingIds.includes(acc.id)" @click="handleProbeAccount(acc.id)">{{ probingIds.includes(acc.id) ? '测试中' : '测试' }}</button></div><details class="row-more-actions"><summary :aria-label="`${acc.name} 更多操作`">更多 ···</summary><div><button v-if="supportsOAuth(acc.platform) && (acc.type === 'oauth' || acc.type === 'setup-token')" type="button" @click="reauthorizeAccount = acc">重新授权</button><button type="button" @click="scheduledAccount = acc">计划测试</button><button v-if="acc.platform === 'grok' && acc.type === 'oauth'" type="button" @click="mediaAccount = acc">媒体生成资格</button><button type="button" class="accounts-delete" :aria-label="`删除账号 ${acc.name}`" :disabled="loading || isDeleting || isBatchSubmitting" @click="pendingDelete = acc">删除</button></div></details></td>
            </tr>
          </tbody>
        </table>
        <span v-if="loading" class="sr-only" role="status">正在加载账号…</span>
      </div>
    </div>

    <footer class="accounts-footer">
      <div class="accounts-footer-summary" aria-live="polite">
        <span v-if="loading">正在加载…</span>
        <span v-else-if="hasLoaded">{{ rangeStart }}–{{ rangeEnd }} 项，共 {{ total.toLocaleString() }} 项</span>
        <span v-else>{{ listError ? '加载未完成' : '等待加载' }}</span>
        <span v-if="lastUpdated && !loading" class="accounts-updated">{{ lastUpdated }} 更新</span>
      </div>
      <div class="accounts-pagination">
        <label class="accounts-page-size">每页
          <select v-model.number="pageSize" aria-label="每页账号数" :disabled="loading" @change="changePageSize">
            <option :value="20">20</option><option :value="50">50</option><option :value="100">100</option>
          </select>
        </label>
        <button type="button" aria-label="上一页" :disabled="loading || page <= 1" @click="changePage(page - 1)">‹</button>
        <span class="accounts-page-label">{{ page }} / {{ pageCount }}</span>
        <button type="button" aria-label="下一页" :disabled="loading || page >= pageCount" @click="changePage(page + 1)">›</button>
      </div>
    </footer>

    <!-- Floating Contextual Action Capsule (Pure macOS Tahoe Style) -->
    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform translate-y-6 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform translate-y-6 opacity-0"
    >
      <div
        v-if="selectedIds.length > 0"
        class="accounts-selection-bar"
      >
        <span class="font-medium text-[11px] px-2.5 py-0.5 rounded-full bg-white/15 font-mono">
          本页已选 {{ selectedIds.length }} 项
        </span>
        <div class="h-3.5 w-px bg-white/20"></div>
        <button
          type="button"
          :disabled="loading || isBatchSubmitting"
          class="h-6.5 px-3 rounded-lg bg-[#007aff] hover:bg-[#0071e3] active:scale-95 text-white font-medium text-[11px] transition-all"
          @click="openBatchEdit"
        >
          批量更新
        </button>
        <button
          type="button"
          :disabled="loading || isBatchSubmitting"
          class="h-6.5 px-3 rounded-lg bg-white/10 hover:bg-white/20 active:scale-95 text-white/90 font-medium text-[11px] transition-all"
          @click="handleBatchClearErrorSubmit"
        >
          清除错误
        </button>
        <button
          type="button"
          :disabled="loading || isBatchSubmitting"
          class="h-6.5 px-3 rounded-lg bg-red-500/80 hover:bg-red-500 active:scale-95 text-white font-medium text-[11px] transition-all"
          @click="handleBatchDeleteSubmit"
        >
          批量删除
        </button>
        <button
          type="button"
          :disabled="isBatchSubmitting"
          class="ml-1 text-white/40 hover:text-white text-xs transition-colors"
          title="清除选择"
          aria-label="清除选择"
          @click="selectedIds = []"
        >
          ✕
        </button>
      </div>
    </transition>

    <ReauthorizeSheet v-if="reauthorizeAccount" :key="reauthorizeAccount.id" :account="reauthorizeAccount" @close="reauthorizeAccount = null" @saved="fetchData" />
    <GrokMediaEligibilitySheet v-if="mediaAccount" :key="mediaAccount.id" :account="mediaAccount" @close="mediaAccount = null" @saved="fetchData" />
    <ScheduledTestsSheet v-if="scheduledAccount" :key="scheduledAccount.id" :account="scheduledAccount" @close="scheduledAccount = null" />
    <!-- Native macOS Attached Sheet 1: Add/Edit Account -->
    <MacSheet
      :show="showAddSheet"
      protect-changes
      :title="isEditing ? '编辑账号' : '添加账号'"
      :loading="isSubmitting || oauthBusy"
      @close="!isSubmitting && !oauthBusy && (showAddSheet = false)"
    >
      <div ref="editorRoot" class="account-editor" :class="{ 'account-assistant': !isEditing }">
        <nav v-if="!isEditing" class="assistant-progress" aria-label="添加账号进度"><span v-for="(name,index) in editorSteps" :key="name" :aria-current="editorStep === index ? 'step' : undefined" :class="{current:editorStep===index,complete:editorStep>index}"><i>{{ editorStep>index ? '✓' : index+1 }}</i>{{ name }}</span></nav>
        <section v-show="isEditing || editorStep === 0" class="editor-section" data-editor-page="0">
          <div class="editor-heading"><span class="editor-step">1</span><div><h3 tabindex="-1">选择平台</h3><p>选择要连接的平台，下一步填写认证信息。</p></div><span v-if="isEditing" class="editor-optional">平台不可更改</span></div>
          <div class="platform-picker" role="group" aria-label="选择账号平台">
            <button v-for="p in selectablePlatforms" :key="p.id" type="button" :data-platform="p.id" :aria-label="platformDescriptions[p.id]" :aria-pressed="accountForm.platform === p.id" :disabled="isEditing || isSubmitting || oauthBusy" @click="selectFormPlatform(p.id)">
              <PlatformMark :platform="p.id" /><strong>{{ p.label }}</strong><small>{{ platformDescriptions[p.id] }}</small><span v-if="accountForm.platform === p.id" class="picker-check" aria-hidden="true">✓</span>
            </button>
          </div>
          <p v-if="!isEditing" class="assistant-note">{{ oauthResult ? '更换平台会清除已完成的授权；仅返回查看会保留当前草稿。' : '已有官方导出文件？可取消此向导，将 JSON 拖入账号窗口导入。' }}</p>
        </section>
        <section v-show="isEditing || editorStep === 1" class="editor-section" data-editor-page="1">
          <div class="editor-heading"><span class="editor-step">2</span><div><h3 tabindex="-1">连接 {{ platformLabel(accountForm.platform) }}</h3><p>选择认证方式，填写必需信息。切换认证方式会清除原授权。</p></div></div>
          <div class="auth-picker" role="group" aria-label="选择认证方式"><button v-for="t in formTypes" :key="t.id" type="button" :aria-pressed="accountForm.type === t.id" :disabled="isEditing || isSubmitting || oauthBusy" @click="selectFormType(t.id)"><strong>{{ t.label }}</strong><small>{{ authDescriptions[t.id] }}</small><span v-if="accountForm.type === t.id" aria-hidden="true">✓</span></button></div>
          <label class="editor-field"><span>账号名称 <em>必填</em></span><input v-model="accountForm.name" :placeholder="`例如：${platformLabel(accountForm.platform)} · 主账号`" maxlength="128" aria-label="账号名称" aria-required="true" :disabled="isSubmitting || oauthBusy" /></label>
          <div v-if="supportsBatchCreation" class="auth-picker" role="group" aria-label="添加方式">
            <button type="button" :aria-pressed="creationMode === 'single'" :disabled="isSubmitting || oauthBusy" @click="creationMode = 'single'"><strong>单个账号授权</strong><small>在浏览器登录并完成授权</small></button>
            <button type="button" :aria-pressed="creationMode === 'batch'" :disabled="isSubmitting || oauthBusy" @click="creationMode = 'batch'"><strong>批量导入授权</strong><small>{{ accountForm.platform === 'openai' ? 'RT、Codex 凭据或 PAT' : 'Cookie 批量授权' }}</small></button>
          </div>
        <p class="accounts-form-help">{{ isEditing ? '认证信息默认保留；替换时请填写完整的新凭据。' : '选择认证类型后填写凭据或完成交互式授权。' }}</p>
        <p v-if="isEditing && isOAuth" class="accounts-form-help">需更新授权时，请关闭此窗口并选择账号的“重新授权”。</p>
        <label v-if="isEditing && !isOAuth && supportedTypes.includes(accountForm.type)" class="flex items-center gap-2">
          <input v-model="replaceCredentials" type="checkbox" :disabled="isSubmitting" />替换认证信息
        </label>
        <fieldset v-if="!isEditing || replaceCredentials" v-show="!isBatchCreation" :disabled="isSubmitting" class="account-credentials space-y-3">
          <CNProviderFields v-if="accountForm.type === 'apikey' && isCNProviderPlatform(accountForm.platform)" v-model="cnProvider" :platform="accountForm.platform" :disabled="isSubmitting || oauthBusy" />
          <template v-else-if="accountForm.type === 'apikey' || accountForm.type === 'bedrock'">
            <label v-if="accountForm.type === 'apikey'">上游端点 <em>{{ accountForm.platform === 'antigravity' ? '必填' : '选填' }}</em><input v-model="credentialFields.base_url" type="url" placeholder="https://api.example.com" /></label>
            <template v-if="accountForm.type === 'bedrock'">
              <label>认证方式<select v-model="credentialFields.auth_mode"><option value="sigv4">AWS 签名 (SigV4)</option><option value="apikey">Bedrock API Key</option></select></label>
              <label>AWS 区域 <em>必填</em><input aria-required="true" v-model="credentialFields.aws_region" /></label>
              <template v-if="credentialFields.auth_mode === 'sigv4'">
                <label>Access Key ID <em>必填</em><input aria-required="true" v-model="credentialFields.aws_access_key_id" autocomplete="off" /></label>
                <label>Secret Access Key <em>必填</em><input aria-required="true" v-model="credentialFields.aws_secret_access_key" type="password" autocomplete="new-password" /></label>
                <label>Session Token（可选）<input v-model="credentialFields.aws_session_token" type="password" autocomplete="new-password" /></label>
              </template>
            </template>
            <label v-if="accountForm.type === 'apikey' || credentialFields.auth_mode !== 'sigv4'">API Key <em>必填</em><input aria-label="API Key" aria-required="true" v-model="accountForm.credentials" type="password" autocomplete="new-password" /></label>
          </template>
          <template v-if="isOAuth && !isEditing">
            <template v-if="accountForm.platform === 'gemini'">
              <label>授权类型<select v-model="geminiOptions.oauth_type" :disabled="oauthBusy"><option value="code_assist">Code Assist</option><option value="google_one">Google One</option><option value="ai_studio">AI Studio（自定义 OAuth client）</option></select></label>
              <label>Google 项目 ID（可选）<input v-model="geminiOptions.project_id" :disabled="oauthBusy" /></label>
              <label>订阅层级 ID（可选）<input v-model="geminiOptions.tier_id" :disabled="oauthBusy" /></label>
            </template>
            <OAuthAuthorization v-if="showAddSheet" :options="oauthOptions" :disabled="isSubmitting" @result="oauthResult = $event" @busy="oauthBusy = $event" />
          </template>
          <template v-if="accountForm.type === 'service_account'">
            <label>服务账号 JSON <em>必填</em><textarea aria-required="true" v-model="credentialFields.service_account_json" rows="5" spellcheck="false" autocomplete="off" /></label>
            <label>Vertex 区域 <em>必填</em><input aria-required="true" v-model="credentialFields.location" /></label>
          </template>
        </fieldset>
        <p v-if="isBatchCreation" class="accounts-form-help">下一步先设置分组、并发和模型策略，然后导入授权材料。每条记录单独显示结果。</p>
        <AccountAdvancedFields v-if="showAddSheet" v-model="advanced" :editing="isEditing" :disabled="isSubmitting || oauthBusy" />
        </section>
        <section v-show="isEditing || editorStep === 2" class="editor-section" data-editor-page="2">
          <div class="editor-heading"><span class="editor-step">3</span><div><h3 tabindex="-1">{{ isEditing ? '分组与调度' : '确认并添加账号' }}</h3><p>分组与调度可使用默认设置，创建后仍能调整。</p></div><span class="editor-optional">选填</span></div>
          <div v-if="!isEditing" class="assistant-summary"><PlatformMark :platform="accountForm.platform" /><div><strong>{{ accountForm.name }}</strong><span>{{ platformLabel(accountForm.platform) }} · {{ typeLabel(accountForm.type) }}</span></div><span class="assistant-ready">{{ isBatchCreation ? '批量导入 · 待填写材料' : isOAuth ? '已完成授权' : '认证信息已填写' }}</span></div>
          <fieldset class="group-picker" :disabled="!!groupsError || isSubmitting || oauthBusy"><legend>绑定分组</legend><label v-for="g in groups" :key="g.id"><input type="checkbox" :value="g.id" v-model="accountForm.groups" /><span>{{ g.name }}</span></label><p v-if="!groups.length && !groupsError" class="accounts-form-help">暂无分组，可以稍后绑定。</p></fieldset>
          <p v-if="groupsError" class="accounts-form-help">分组读取失败，原有选择保留。<button type="button" class="accounts-text-button" @click="fetchGroups">重新读取</button></p>
          <div class="editor-columns"><label class="editor-field"><span>并发限制</span><input type="number" min="1" step="1" aria-label="并发限制" v-model.number="accountForm.concurrency" :disabled="isSubmitting || oauthBusy" /><small>同时处理的请求上限</small></label><label class="editor-field"><span>优先级</span><input type="number" min="0" step="1" aria-label="优先级" v-model.number="accountForm.priority" :disabled="isSubmitting || oauthBusy" /><small>数值越小越优先</small></label></div>

        <p v-if="policyLoading" role="status">正在读取账号模型与配额设置…</p>
        <MacButton v-else-if="!policyReady" size="sm" @click="loadAccountPolicies">重新读取账号设置</MacButton>
        <AccountPolicies v-if="showAddSheet && policyReady" v-model="policies" :platform="accountForm.platform" :type="accountForm.type" :passthrough="mappingLocked(policyAccount || undefined)" :disabled="isSubmitting || oauthBusy" />

        </section>
      </div>
      <template #footer="{ close }">
        <div class="editor-save-status"><p v-if="formError" class="accounts-form-error" role="alert">{{ formError }}</p><span v-else-if="!isEditing && editorStep === 0">已选择 {{ platformLabel(accountForm.platform) }}</span><span v-else-if="missingRequired.length">还需：{{ missingRequired.join('、') }}</span><span v-else>{{ !isEditing && editorStep === 1 ? '信息已齐全，下一步确认设置。' : '确认后保存账号，凭据不会在此展示。' }}</span></div>
        <MacButton v-if="(pendingCreate || legacyPendingCreate) && !isEditing" :disabled="isSubmitting" @click="showCreateReview = true">核对创建结果</MacButton>
        <MacButton :disabled="isSubmitting || oauthBusy" @click="close">取消</MacButton>
        <MacButton v-if="!isEditing && editorStep > 0" :disabled="isSubmitting || oauthBusy" @click="moveEditor(editorStep-1)">上一步</MacButton>
        <MacButton v-if="!isEditing && editorStep < 2" variant="primary" :disabled="oauthBusy || isSubmitting || (editorStep===1 && (missingRequired.length>0 || unsupportedCreation))" @click="moveEditor(editorStep+1)">下一步</MacButton>
        <MacButton v-else variant="primary" :loading="isSubmitting" :disabled="missingRequired.length > 0 || unsupportedCreation || oauthBusy || policyLoading || !policyReady || (!isEditing && (!!pendingCreate || !!legacyPendingCreate))" @click="handleSaveAccount">{{ isEditing ? '保存更改' : isBatchCreation ? '继续导入授权材料' : '创建账号' }}</MacButton>
      </template>
    </MacSheet>

    <MacSheet :show="showCreateReview" title="核对上次创建结果" :loading="reviewBusy" @close="showCreateReview = false">
      <p v-if="createStorageError" class="accounts-inline-notice" role="alert">{{ createStorageError }}</p>
      <div v-if="legacyPendingCreate" class="space-y-3">
        <p role="alert" class="accounts-form-help">{{ legacyCreateNotice }}</p>
        <p class="accounts-form-help">请联系原操作人核实请求已经结束，确认创建结果已处理或确定未创建。仅在列表中未找到账号不能作为解除依据。</p>
        <label><input v-model="legacyReviewConfirmed" type="checkbox" /> 我已核对原操作人及旧请求记录，确认结果已处理，可以解除旧版保护</label>
        <MacButton :disabled="!legacyReviewConfirmed || reviewBusy" @click="showLegacyConfirmation = true">解除旧版未归属保护…</MacButton>
      </div>
      <template v-else>
      <p class="accounts-form-help">上次请求未收到确定结果，新增已暂停。请先核对账号列表或后端记录；关闭或刷新页面不会重发该请求。</p>
      <label class="editor-field mt-4"><span>已创建的账号编号</span><input v-model.number="reviewAccountId" type="number" min="1" aria-label="已创建的账号编号" /></label>
      <MacButton class="mt-3" :disabled="!reviewAccountId" :loading="reviewBusy" @click="readCreatedAccount">读取账号核对</MacButton>
      <div v-if="reviewedAccount" class="mt-4 space-y-2"><p>{{ reviewedAccount.name }} · {{ platformLabel(reviewedAccount.platform) }} · #{{ reviewedAccount.id }}</p><label><input v-model="reviewConfirmed" type="checkbox" /> 我已确认这是上次创建的账号</label><MacButton :disabled="!reviewConfirmed" @click="finishCreateReview">确认完成并关闭草稿</MacButton></div>
      <details class="mt-4"><summary>已在后端确认没有创建成功</summary><p class="accounts-form-help">仅当已确认该请求结束且未创建账号时解锁。列表中暂未找到不能证明请求失败。</p><label><input v-model="reviewAbsent" type="checkbox" /> 我已在后端确认请求结束且未创建账号</label><MacButton class="mt-3" :disabled="!reviewAbsent || reviewBusy" @click="showAbsentConfirmation = true">解锁新增</MacButton></details>
      </template>
      <p v-if="reviewError" role="alert" class="accounts-form-error">{{ reviewError }}</p>
    </MacSheet>
    <MacAlertSheet :show="showLegacyConfirmation" title="解除旧版未归属保护？" message="旧请求可能由其他用户发起。仅在已核对原操作人及后端记录、确认结果已处理后继续。此操作仅解除旧版保护，不会把请求归给当前用户，也不会清除其他创建保护。" danger confirm-text="已核实，解除旧版保护" cancel-text="继续核对" @cancel="showLegacyConfirmation = false" @confirm="finishLegacyReview" />
    <MacAlertSheet :show="showAbsentConfirmation" title="结束上次创建核对？" message="将清除本次草稿并恢复新增。如果原请求仍在处理中，新建可能产生重复账号。" danger confirm-text="已核实，解锁新增" cancel-text="继续核对" @cancel="showAbsentConfirmation = false" @confirm="finishAbsentReview" />
    <BatchAuthorizationSheet v-if="batchAuthorization" :settings="batchAuthorization" @close="batchAuthorization = null" @saved="fetchData" />
    <!-- Native macOS Attached Sheet 2: Batch Edit Modal -->
    <MacSheet
      v-slot="{close}" protect-changes
      :show="showBatchEditSheet"
      title="批量更新已选账号"
      :loading="isBatchSubmitting"
      @close="!isBatchSubmitting && (showBatchEditSheet = false)"
    >
      <div class="p-6 space-y-4 text-xs">
        <div class="flex items-center gap-2 pb-1 border-b border-black/[0.06] dark:border-white/[0.08]">
          <span class="px-2 py-0.5 rounded-md bg-[#007aff]/10 text-[#007aff] text-xs font-mono font-medium">
            已选中 {{ selectedIds.length }} 个账号
          </span>
          <span class="text-black/45 dark:text-white/45 text-[11px]">未填写的配置项将保持不变</span>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">账号状态</label>
            <select
              v-model="batchForm.status"
              class="w-full h-8 px-2.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
            >
              <option value="">保持原状态不变</option>
              <option value="active">批量设置为：启用</option>
              <option value="inactive">批量设置为：停用</option>
            </select>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">统一并发限制</label>
              <input
                type="number"
                v-model.number="batchForm.concurrency"
                placeholder="留空保持不变"
                class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
              />
            </div>
            <div>
              <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">统一优先级</label>
              <input
                type="number"
                v-model.number="batchForm.priority"
                placeholder="留空保持不变"
                class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
              />
            </div>
          </div>

          <div>
            <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">分配至分组</label>
            <select
              v-model="batchForm.group_ids"
              :disabled="!!groupsError"
              aria-label="批量分配至分组"
              multiple
              class="w-full h-20 p-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
            >
              <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
            </select>
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            class="px-3.5 py-1.5 rounded-lg border border-black/[0.1] dark:border-white/[0.1] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium text-black/80 dark:text-white/80"
            @click="close"
          >
            取消
          </button>
          <MacButton
            size="sm"
            variant="primary"
            :loading="isBatchSubmitting"
            @click="handleBulkUpdateSubmit"
          >
            应用批量更新
          </MacButton>
        </div>
      </div>
    </MacSheet>

    <!-- Native macOS Attached Sheet 3: CRS Sync Modal -->
    <MacSheet
      :show="showCrsModal"
      title="从 CRS 同步账号"
      :loading="isCrsSyncing"
      @close="showCrsModal = false"
    >
      <div class="p-6 space-y-4 text-xs">
        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">CRS 端点 URL</label>
          <input
            v-model="crsBaseUrl"
            type="text"
            placeholder="https://crs.example.com"
            class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">用户名</label>
            <input
              v-model="crsUsername"
              type="text"
              class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
            />
          </div>
          <div>
            <label class="block font-medium text-black/70 dark:text-white/70 mb-1.5">密码</label>
            <input
              v-model="crsPassword"
              type="password"
              class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.08] focus:outline-none text-black dark:text-white"
            />
          </div>
        </div>

        <label class="flex items-center gap-2 cursor-pointer text-xs">
          <input type="checkbox" v-model="crsSyncProxies" class="rounded cursor-pointer" />
          <span class="text-black/70 dark:text-white/70">同时同步代理节点配置</span>
        </label>

        <div v-if="crsSyncResult" class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs">
          {{ crsSyncResult }}
        </div>

        <div class="flex justify-end gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            class="px-3.5 py-1.5 rounded-lg border border-black/[0.1] dark:border-white/[0.1] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium text-black/80 dark:text-white/80"
            @click="showCrsModal = false"
          >
            关闭
          </button>
          <MacButton
            size="sm"
            variant="primary"
            :loading="isCrsSyncing"
            @click="handleSyncCrsSubmit"
          >
            发起同步
          </MacButton>
        </div>
      </div>
    </MacSheet>

    <AccountImportSheet :show="showImportModal" :files="importFiles" :directory="importDirectory" @close="closeImport" @consumed="importFiles = []" @busy="importBusy = $event" @changed="fetchData" />

    <MacAlertSheet :show="!!mixedRisk" title="确认混合渠道风险" :message="mixedRisk" confirm-text="了解风险，继续保存" cancel-text="返回修改" :danger="true" @confirm="resolveMixedRisk(true)" @cancel="resolveMixedRisk(false)" />
    <!-- Native macOS Attached Alert Sheet for Batch Deletion -->
    <MacAlertSheet
      :show="!!pendingDelete"
      :title="`删除「${pendingDelete?.name || '账号'}」？`"
      :message="`账号 #${pendingDelete?.id ?? ''} 将被移除，无法继续参与调度。此操作无法撤销。`"
      confirm-text="删除账号"
      cancel-text="保留账号"
      :danger="true"
      :loading="isDeleting"
      @confirm="confirmDeleteAccount"
      @cancel="!isDeleting && (pendingDelete = null)"
    />
    <MacAlertSheet
      :show="showBatchDeleteAlert"
      title="确定要永久删除选中的账号吗？"
      :message="`本页选中的 ${selectedIds.length} 个账号将被移除，无法继续参与调度。此操作无法撤销。`"
      confirm-text="批量删除"
      cancel-text="取消"
      :danger="true"
      :loading="isBatchSubmitting"
      @confirm="confirmBatchDelete"
      @cancel="!isBatchSubmitting && (showBatchDeleteAlert = false)"
    />
  </div>
</template>

<style scoped>
.accounts-app {
  container: accounts / inline-size;
  min-width: 0;
  min-height: 0;
  color: var(--text-primary);
  background: var(--bg-surface);
  font-family: var(--font-mac);
  font-size: 12px;
}
.accounts-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding: 12px 18px;
  flex-shrink: 0;
  background: var(--window-bg-solid);
  border-bottom: 1px solid var(--border-subtle);
}
.accounts-count {
  min-width: 22px;
  padding: 1px 6px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  color: var(--text-secondary);
  background: var(--bg-surface);
  font-size: 10px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.accounts-subtitle { color: var(--text-tertiary); font-size: 11px; margin-top: 2px; }
.accounts-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.accounts-actions > button, .accounts-actions > div > button { min-height: 29px; }
.accounts-auto-label { font-size: 11px; font-variant-numeric: tabular-nums; }
.accounts-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 11px 18px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}
.accounts-search { flex: 1 1 185px; max-width: 310px; }
.accounts-filters input, .accounts-filters select {
  height: 30px;
  border-radius: 7px;
  background: var(--bg-surface-subtle);
  border-color: var(--border-color);
  color: var(--text-secondary);
}
.accounts-filters select { max-width: 170px; min-width: 0; padding-right: 4px; font-size: 11px; }
.accounts-body { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; position: relative; }
.accounts-table-scroll { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; scrollbar-gutter: stable; padding-bottom: 66px; }
.accounts-table { width: 100%; min-width: 1020px; border-spacing: 0; border-collapse: separate; text-align: left; font-size: 12px; }
.accounts-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 35px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  background: var(--window-bg-solid);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
.accounts-table td {
  height: 57px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  transition: background-color 120ms ease;
}
.accounts-table tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--bg-surface-subtle) 38%, var(--bg-surface)); }
.accounts-table tbody tr:hover td { background: color-mix(in srgb, var(--accent) 4%, var(--bg-surface)); }
.accounts-table tbody tr.is-selected td { background: color-mix(in srgb, var(--accent) 10%, var(--bg-surface)); }
.accounts-table tbody tr.is-selected td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
.accounts-table .accounts-check { width: 40px; padding-left: 15px; padding-right: 8px; text-align: center; }
.accounts-check input { width: 14px; height: 14px; vertical-align: middle; accent-color: var(--accent); cursor: pointer; }
.accounts-name-cell { min-width: 178px; max-width: 260px; }
.accounts-name {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 600;
  text-align: left;
  line-height: 1.5;
}
.accounts-name:hover { color: var(--accent); }
.accounts-secondary { display: block; margin-top: 3px; color: var(--text-tertiary); font-size: 10px; white-space: nowrap; }
.accounts-id { font-family: var(--font-mono); font-variant-numeric: tabular-nums; user-select: text; }
.accounts-platform { font-size: 11px; font-weight: 500; white-space: nowrap; }
.accounts-platform[data-platform="anthropic"] { color: #a26243; }
.accounts-platform[data-platform="openai"] { color: #248069; }
.accounts-platform[data-platform="gemini"], .accounts-platform[data-platform="antigravity"] { color: var(--accent); }
.dark .accounts-platform[data-platform="anthropic"] { color: #e0a183; }
.dark .accounts-platform[data-platform="openai"] { color: #70c7ad; }
.accounts-status { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 11px; color: var(--text-secondary); }
.accounts-status i { width: 6px; height: 6px; border-radius: 50%; background: var(--text-tertiary); flex-shrink: 0; }
.accounts-status[data-tone="success"] i { background: var(--color-success); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-success) 12%, transparent); }
.accounts-status[data-tone="warning"] { color: #a9690c; }
.accounts-status[data-tone="warning"] i { background: var(--color-warning); }
.accounts-status[data-tone="danger"] { color: var(--color-danger); }
.accounts-status[data-tone="danger"] i { background: var(--color-danger); }
.dark .accounts-status[data-tone="warning"] { color: #edb15a; }
.accounts-table .accounts-numeric { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.accounts-table td.accounts-numeric { font-family: var(--font-mono); font-size: 11px; }
.accounts-muted { color: var(--text-tertiary); }
.accounts-group-cell { min-width: 120px; max-width: 170px; }
.accounts-group-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 155px; font-size: 11px; color: var(--text-secondary); }
.accounts-group-extra { padding: 2px 4px; margin-left: 5px; border-radius: 4px; color: var(--text-tertiary); background: var(--bg-surface-subtle); font-size: 10px; }
.accounts-table .accounts-row-actions { position: sticky; right: 0; min-width: 148px; text-align: right; box-shadow: -1px 0 0 var(--border-subtle); }
.accounts-table th.accounts-row-actions { z-index: 3; }
.accounts-table td.accounts-row-actions { z-index: 1; background: var(--window-bg-solid); }
.accounts-table tbody tr.is-selected td.accounts-row-actions { background: color-mix(in srgb, var(--accent) 10%, var(--window-bg-solid)); }
.accounts-row-actions > div { display: flex; flex-wrap: wrap; width: 148px; justify-content: flex-end; gap: 1px; }
.accounts-row-actions button { min-height: 27px; padding: 3px 6px; border-radius: 5px; font-size: 11px; color: var(--accent); white-space: nowrap; }
.accounts-row-actions button:hover { background: color-mix(in srgb, var(--accent) 9%, transparent); }
.accounts-row-actions button.accounts-delete { color: var(--text-tertiary); }
.accounts-row-actions button.accounts-delete:hover, .accounts-row-actions button.accounts-delete:focus-visible { color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 8%, transparent); }
.is-refreshing { opacity: .65; }
.accounts-state { display: flex; flex: 1; min-height: 230px; overflow: auto; align-items: center; justify-content: center; flex-direction: column; padding: 32px 24px; text-align: center; gap: 12px; }
.accounts-state-icon { width: 58px; height: 58px; margin-bottom: 2px; opacity: .85; }
.accounts-state h3 { font-size: 15px; font-weight: 600; letter-spacing: -.2px; }
.accounts-state p { max-width: 370px; color: var(--text-secondary); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; user-select: text; }
.accounts-inline-notice { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0; padding: 8px 18px; background: color-mix(in srgb, var(--color-warning) 8%, var(--bg-surface)); color: var(--text-secondary); font-size: 11px; line-height: 1.6; }
.accounts-inline-notice > span { min-width: 0; overflow-wrap: anywhere; }
.accounts-text-button { flex-shrink: 0; color: var(--accent); font-size: 11px; padding: 3px 2px; border-radius: 4px; }
.accounts-text-button:hover { text-decoration: underline; }
.accounts-footer { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; flex-shrink: 0; min-height: 42px; padding: 7px 16px; border-top: 1px solid var(--border-subtle); background: var(--window-bg-solid); font-size: 11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.accounts-footer-summary { display: flex; gap: 14px; }
.accounts-updated { color: var(--text-tertiary); }
.accounts-pagination { display: flex; align-items: center; gap: 6px; }
.accounts-page-size { display: inline-flex; align-items: center; gap: 5px; margin-right: 6px; }
.accounts-page-size select { background: var(--bg-surface); border: 1px solid var(--border-color); padding: 3px; border-radius: 5px; color: var(--text-secondary); font-size: 11px; }
.accounts-pagination > button { width: 25px; height: 25px; display: grid; place-items: center; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-surface); font-size: 18px; line-height: 1; }
.accounts-pagination > button:hover:not(:disabled) { background: var(--bg-surface-subtle); }
.accounts-page-label { min-width: 42px; text-align: center; }
.accounts-selection-bar { position: absolute; bottom: 54px; left: 50%; transform: translateX(-50%); z-index: 8; display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px; width: max-content; max-width: calc(100% - 24px); padding: 10px 12px; border-radius: 14px; background: var(--material-dropdown); border: 1px solid var(--border-color); box-shadow: var(--shadow-overlay); backdrop-filter: var(--vibrancy-dropdown); color: var(--text-primary); }
.accounts-selection-bar > span { color: var(--text-secondary); background: var(--bg-surface-subtle); white-space: nowrap; }
.accounts-selection-bar > button { min-height: 27px; white-space: nowrap; }
.accounts-selection-bar > button:nth-of-type(2) { color: var(--text-primary); background: var(--bg-surface-subtle); }
.accounts-selection-bar > button:last-child { color: var(--text-secondary); width: 22px; }
.accounts-toast { position: absolute; top: 66px; right: 16px; z-index: 60; display: flex; align-items: center; gap: 8px; max-width: calc(100% - 32px); padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--material-dropdown); backdrop-filter: var(--vibrancy-dropdown); box-shadow: var(--shadow-overlay); font-size: 12px; overflow-wrap: anywhere; pointer-events: none; }
.account-credentials label { display: grid; gap: 6px; color: var(--text-secondary); }
.account-credentials :is(input, select, textarea) { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--bg-surface-subtle); color: var(--text-primary); font-size: 12px; }
.accounts-form-help { color: var(--text-secondary); font-size: 11px; line-height: 1.7; }
.accounts-form-error { padding: 10px 12px; border-radius: 7px; color: var(--color-danger); background: color-mix(in srgb, var(--color-danger) 7%, transparent); font-size: 12px; overflow-wrap: anywhere; }
.accounts-skeleton { display: block; width: 66%; height: 9px; border-radius: 3px; background: var(--bg-surface-subtle); animation: accounts-pulse 1.5s ease-in-out infinite; }
.accounts-skeleton.check { width: 13px; height: 13px; }
.accounts-skeleton.name { width: 75%; height: 10px; }
.accounts-skeleton.detail { width: 28%; height: 7px; margin-top: 8px; }
.accounts-app :is(button, input, select, textarea):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.accounts-app :is(button, input, select, textarea):disabled { opacity: .45; cursor: not-allowed; }
@keyframes accounts-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
@container accounts (max-width: 650px) {
  .accounts-toolbar { padding: 10px 12px; gap: 10px; }
  .accounts-toolbar > div:first-child { flex: 1 1 170px; }
  .accounts-actions { flex: 1 1 auto; justify-content: flex-end; }
  .accounts-filters { padding: 10px 12px; gap: 7px; }
  .accounts-search { flex-basis: 100%; max-width: none; }
  .accounts-filters select { flex: 1 1 95px; max-width: none; }
  .accounts-updated { display: none; }
  .accounts-footer { padding: 7px 12px; }
  .accounts-table .accounts-row-actions { min-width: 142px; }
}
@container accounts (max-width: 420px) {
  .accounts-toolbar { gap: 12px; }
  .accounts-toolbar > div:first-child, .accounts-actions { flex-basis: 100%; }
  .accounts-actions { justify-content: space-between; }
  .accounts-pagination { margin-left: auto; }
  .accounts-selection-bar { bottom: 78px; }
  .accounts-footer-summary { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .accounts-skeleton { animation: none; }
  .accounts-table td { transition: none; }
}
</style>
<style scoped>
.account-assistant [data-editor-page="0"]{padding:16px 24px;gap:12px}.account-assistant [data-editor-page="0"] .platform-picker{grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.account-assistant [data-editor-page="0"] .platform-picker>button{padding:8px 12px;gap:2px;min-height:73px}.account-assistant [data-editor-page="0"] .platform-mark{height:23px}.account-assistant [data-editor-page="0"] .assistant-note{margin:0}.account-assistant .assistant-progress{padding:13px 16px}@container accounts (max-width:600px){.account-assistant [data-editor-page="0"]{padding:16px}.account-assistant [data-editor-page="0"] .platform-picker{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
<style scoped>
.assistant-progress{display:flex;justify-content:center;gap:24px;padding:18px 20px;border-bottom:1px solid var(--border-subtle);background:var(--window-bg-solid)}.assistant-progress>span{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text-tertiary)}.assistant-progress i{display:grid;place-items:center;font-style:normal;width:22px;height:22px;border-radius:50%;background:var(--bg-surface-subtle);border:1px solid var(--border-subtle)}.assistant-progress .current{color:var(--text-primary);font-weight:600}.assistant-progress .current i{color:white;background:var(--accent);border-color:var(--accent)}.assistant-progress .complete i{color:var(--accent)}.account-assistant .editor-section{min-height:310px;border:0;padding:24px;align-content:start;gap:20px}.account-assistant .editor-step{display:none}.account-assistant .editor-heading h3{font-size:20px;letter-spacing:-.03em;outline:none}.account-assistant .editor-heading p{margin-top:6px;line-height:1.6}.assistant-note{font-size:11px;line-height:1.7;color:var(--text-tertiary)}.assistant-summary{display:flex;align-items:center;gap:12px;padding:16px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:12px}.assistant-summary>div{display:grid;gap:4px;min-width:0}.assistant-summary strong{font-size:14px;overflow-wrap:anywhere}.assistant-summary span{font-size:11px;color:var(--text-secondary)}.assistant-summary .assistant-ready{margin-left:auto;color:var(--accent);white-space:nowrap}@container accounts (max-width:600px){.assistant-progress{gap:12px;padding:14px 10px}.assistant-progress>span{font-size:10px;gap:4px}.assistant-progress i{width:19px;height:19px}.account-assistant .editor-section{padding:16px;min-height:280px}.assistant-summary{flex-wrap:wrap}.assistant-summary .assistant-ready{margin-left:0}}
</style>

<style scoped>
.accounts-platform-nav{display:flex;gap:5px;flex-shrink:0;overflow-x:auto;padding:10px 16px;background:var(--window-bg-solid);border-bottom:1px solid var(--border-subtle);scrollbar-width:thin}
.accounts-platform-nav button{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:6px 10px;min-height:38px;border:1px solid transparent;border-radius:8px;color:var(--text-secondary);font-size:11px;transition:background 120ms}
.accounts-platform-nav button:hover{background:var(--bg-surface-subtle)}.accounts-platform-nav button[aria-pressed="true"]{background:var(--bg-surface);border-color:var(--border-color);box-shadow:0 1px 3px #0000000c;color:var(--text-primary);font-weight:600}.accounts-platform-nav button:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
.accounts-platform-nav button[data-platform="anthropic"][aria-pressed="true"]{border-bottom:2px solid #c27856}.accounts-platform-nav button[data-platform="openai"][aria-pressed="true"]{border-bottom:2px solid #208575}.accounts-platform-nav button[data-platform="gemini"][aria-pressed="true"]{border-bottom:2px solid #9469d0}.accounts-platform-nav button[data-platform="deepseek"][aria-pressed="true"],.accounts-platform-nav button[data-platform="zhipu"][aria-pressed="true"]{border-bottom:2px solid #526af0}
.accounts-all-mark{font-size:25px;line-height:28px;width:28px;text-align:center}.accounts-platform-identity{display:flex;align-items:center;gap:7px}.accounts-platform-identity + .accounts-secondary{padding-left:35px}.accounts-platform{font-size:12px;font-weight:600}.accounts-name{font-size:13px}.accounts-status{padding:4px 7px;border-radius:5px;background:var(--bg-surface-subtle)}.accounts-status[data-tone="danger"]{background:color-mix(in srgb,var(--color-danger) 8%,var(--bg-surface))}.accounts-mobile-kind,.accounts-mobile-logo,.accounts-mobile-details{display:none}
.accounts-drop-hint{position:absolute;inset:8px;z-index:100;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;border:2px dashed var(--accent);border-radius:14px;color:var(--accent);background:color-mix(in srgb,var(--window-bg-solid) 92%,transparent);box-shadow:inset 0 0 0 5px var(--bg-surface)}.accounts-drop-hint strong{font-size:18px}.accounts-drop-hint span{font-size:12px}
@container accounts (max-width:600px){
 .accounts-mobile-details{display:block;margin-top:7px;font-size:10px;color:var(--text-secondary)}.accounts-mobile-details summary{cursor:pointer;color:var(--accent);padding:4px 0}.accounts-mobile-details p{margin:5px 0;overflow-wrap:anywhere}.accounts-mobile-actions{display:flex;flex-wrap:wrap;gap:5px}.accounts-mobile-actions button{padding:4px 7px;border:1px solid var(--border-color);border-radius:5px;color:var(--accent)}
 .accounts-toolbar{padding:10px 12px;gap:8px}.accounts-actions{width:100%;flex-wrap:wrap}.accounts-platform-nav{padding:7px 10px}.accounts-platform-nav button{padding:4px 8px}.accounts-filters{padding:9px 12px;gap:6px}.accounts-search{flex-basis:100%;max-width:none}.accounts-table{min-width:0;table-layout:fixed}.accounts-table th,.accounts-table td{padding:8px 6px}.accounts-table th:nth-child(n+3):not(:nth-child(4)),.accounts-table td:nth-child(n+3):not(:nth-child(4)){display:none}.accounts-table .accounts-check{width:30px;padding-left:8px;padding-right:4px}.accounts-table th:nth-child(4){width:88px}.accounts-name-cell{min-width:0;max-width:none;position:relative;padding-left:42px!important}.accounts-mobile-logo{display:block;position:absolute;left:6px;top:12px}.accounts-mobile-kind{display:inline;font-family:var(--font-mac)}.accounts-id{white-space:normal;overflow-wrap:anywhere;font-size:10px}.accounts-name{white-space:normal;overflow-wrap:anywhere;font-size:12px}.accounts-status{font-size:10px;padding:3px 5px}.accounts-table-scroll{padding-bottom:78px}.accounts-footer{padding:8px 10px}.accounts-updated{display:none}
}
@media(prefers-reduced-motion:reduce){.accounts-platform-nav button{transition:none}}
</style>
<style scoped>
/* Account workspace: identity and health lead; operational details stay secondary. */
.accounts-table{min-width:850px;table-layout:auto}.accounts-table td{height:66px;padding:8px 12px;vertical-align:middle}.accounts-name-cell{min-width:200px;max-width:285px}.account-identity{display:flex;align-items:center;gap:12px}.account-logo{width:40px;height:40px;border:1px solid var(--border-subtle);border-radius:11px;background:var(--window-bg-solid);display:grid;place-items:center;flex-shrink:0;box-shadow:0 1px 2px #00000006}.account-identity-text{min-width:0}.accounts-name{font-size:13px;font-weight:600}.accounts-secondary{font-size:10.5px;line-height:1.7;white-space:normal}.identity-separator{margin:0 5px;color:var(--text-tertiary)}.accounts-table .accounts-status{padding:3px 7px;border-radius:5px;background:var(--bg-surface-subtle);font-weight:500}.group-pills{display:flex;flex-wrap:wrap;gap:4px}.group-pills>span{padding:2px 6px;border:1px solid var(--border-subtle);border-radius:5px;font-size:10px;color:var(--text-secondary)}.metric-pair{display:flex;gap:4px;align-items:baseline;font-variant-numeric:tabular-nums;white-space:nowrap}.metric-pair strong{font-weight:600;font-size:13px}.metric-pair>span{font-size:10px;color:var(--text-tertiary)}.account-quota-cell{min-width:140px}.quota-caption{display:flex;gap:8px;justify-content:space-between;font-size:10px;color:var(--text-secondary)}.quota-caption strong{font-weight:500;font-variant-numeric:tabular-nums}.account-quota-cell progress{width:100%;height:4px;display:block;margin:5px 0;appearance:none;border:none;border-radius:4px;overflow:hidden;background:var(--border-subtle)}progress::-webkit-progress-bar{background:var(--border-subtle)}progress::-webkit-progress-value{background:var(--accent)}progress::-moz-progress-bar{background:var(--accent)}.accounts-row-actions{min-width:96px}.accounts-row-actions .row-primary-actions{display:flex;gap:6px;justify-content:flex-end}.row-primary-actions button{padding:4px 8px;border:1px solid var(--border-subtle);border-radius:6px;background:var(--window-bg-solid)}.row-more-actions{margin-top:7px;color:var(--text-secondary);font-size:10px}.row-more-actions summary{cursor:pointer;list-style:none;text-align:right}.row-more-actions>div{display:grid;gap:5px;margin-top:8px;padding:8px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid)}.row-more-actions button{padding:3px;text-align:right}.row-more-actions[open] summary{color:var(--accent)}
:deep(.mac-sheet-panel:has(.account-editor)){max-width:760px}:deep(.mac-sheet-body:has(>.account-editor)){padding:0}.account-editor{font-size:12px;min-width:0}.editor-section{padding:20px 24px;border-bottom:1px solid var(--border-subtle);display:grid;gap:14px}.editor-section:last-child{border-bottom:0}.editor-heading{display:flex;align-items:center;gap:10px}.editor-step{display:grid;place-items:center;width:23px;height:23px;flex-shrink:0;border-radius:50%;background:var(--bg-surface-subtle);border:1px solid var(--border-subtle);font-size:11px;color:var(--text-secondary)}.editor-heading h3{font-size:13px;font-weight:650;margin:0}.editor-heading p{font-size:11px;color:var(--text-tertiary);margin:3px 0 0}.editor-optional{margin-left:auto;font-size:10px;color:var(--text-tertiary)}.platform-picker{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.platform-picker>button{position:relative;display:grid;justify-items:start;gap:4px;min-width:0;padding:12px;border-radius:10px;border:1px solid var(--border-subtle);background:var(--bg-surface);text-align:left;transition:background 120ms,border-color 120ms}.platform-picker>button:hover:not(:disabled){border-color:var(--accent)}.platform-picker>button[aria-pressed=true]{background:color-mix(in srgb,var(--accent) 6%,var(--bg-surface));border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.platform-picker strong{font-size:12px;font-weight:600}.platform-picker small{font-size:9px;color:var(--text-tertiary)}.picker-check{position:absolute;right:9px;top:8px;color:var(--accent);font-weight:600}.auth-picker{display:flex;flex-wrap:wrap;gap:7px}.auth-picker button{position:relative;flex:1 1 140px;padding:9px 28px 9px 10px;border-radius:8px;background:var(--bg-surface);border:1px solid var(--border-subtle);text-align:left;display:grid;gap:3px}.auth-picker strong{font-size:11px;font-weight:600}.auth-picker small{font-size:10px;color:var(--text-tertiary)}.auth-picker button>span{position:absolute;right:9px;top:9px;color:var(--accent)}.auth-picker button[aria-pressed=true]{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--bg-surface))}.editor-field{display:grid;gap:6px}.account-editor input:not([type=checkbox]),.account-editor select,.account-editor textarea{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface);color:var(--text-primary)}.account-editor em{display:inline;font-style:normal;font-size:10px;color:var(--text-tertiary);margin-left:5px}.account-editor input:focus-visible,.account-editor button:focus-visible,.account-editor textarea:focus-visible,.account-editor select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.account-credentials{border:0;padding:0;min-width:0}.account-credentials>label{display:block}.account-credentials input,.account-credentials textarea,.account-credentials select{display:block;margin-top:6px}.editor-columns{display:grid;grid-template-columns:1fr 1fr;gap:14px}.editor-field small{color:var(--text-tertiary);font-size:10px}.group-picker{border:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.group-picker legend{margin-bottom:8px;font-weight:500}.group-picker label{display:flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface)}.group-picker input{accent-color:var(--accent)}.editor-save-status{flex:1;min-width:160px;font-size:11px;color:var(--text-secondary)}.editor-save-status p{margin:0}.account-editor :deep(details>summary){padding:10px 0}.account-editor :deep(details){border-top:1px solid var(--border-subtle)}
@container accounts (max-width:600px){.accounts-table{min-width:0;table-layout:fixed}.accounts-table th:nth-child(n+3):not(:nth-child(4)),.accounts-table td:nth-child(n+3):not(:nth-child(4)){display:table-cell}.accounts-table th:nth-child(n+4),.accounts-table td:nth-child(n+4){display:none}.accounts-table th:nth-child(3){width:96px}.accounts-table td{padding:14px 8px;height:auto}.accounts-name-cell{padding-left:8px!important;min-width:0;max-width:none}.account-logo{width:31px;height:31px;border-radius:8px}.account-identity{gap:8px;align-items:flex-start}.accounts-name{font-size:12px;white-space:normal}.accounts-secondary{font-size:10px}.editor-section{padding:16px}.platform-picker{grid-template-columns:repeat(2,minmax(0,1fr))}.platform-picker>button{padding:10px}.editor-columns{grid-template-columns:1fr 1fr}.accounts-mobile-details{margin-left:39px}.editor-save-status{flex-basis:100%}}
</style>
