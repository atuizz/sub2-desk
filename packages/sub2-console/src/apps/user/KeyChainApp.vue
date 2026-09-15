<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import './app-polish.css';
import {
  MacSheet,
  MacButton,
  MacAlertSheet,
  type WindowInstance
} from '@sub2-mac/core';
import { keysAPI } from '@/api/keys';
import { userGroupsAPI } from '@/api/groups';
import { getDashboardApiKeysUsage } from '@/api/usage';
import { getPublicSettings } from '@/api/auth';
import type { ApiKey, Group, PublicSettings } from '@/types';
import { formatDateTime } from '@/utils/format';

const toastMsg = ref<string | null>(null);
const toastType = ref<'success' | 'error'>('success');
function showToast(msg: string, type: 'success' | 'error' = 'success') {
  toastMsg.value = msg;
  toastType.value = type;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2500);
}

defineProps<{
  win?: WindowInstance;
}>();

// State
const isLoading = ref(true);
const loadError = ref('');
const submitting = ref(false);
const apiKeys = ref<ApiKey[]>([]);
const groups = ref<Group[]>([]);
const publicSettings = ref<PublicSettings | null>(null);
const usageStats = ref<Record<number, { today_actual_cost: number; total_actual_cost: number }>>({});
const usageLoadError = ref(false);
const groupsLoadError = ref(false);
const endpointLoadError = ref(false);
const deleting = ref(false);
const mutatingKeyId = ref<number | null>(null);
let listController: AbortController | null = null;
let loadVersion = 0;
let disposed = false;

// Filters & Selection
const currentCategory = ref<'all' | 'active' | 'inactive' | 'quota_exhausted' | 'expired' | number>('all');
const searchQuery = ref('');
const copiedKeyId = ref<number | null>(null);

// Sheets & Modals
const showCreateSheet = ref(false);
const showEditSheet = ref(false);
const showUseKeySheet = ref(false);
const showDeleteConfirm = ref(false);
const showEndpointPopover = ref(false);

const selectedKey = ref<ApiKey | null>(null);
const inspectedKeyId = ref<number | null>(null);
const inspectedKey = computed(() => apiKeys.value.find(key => key.id === inspectedKeyId.value) || null);
const quotaWindows = computed(() => {
  const key = inspectedKey.value;
  if (!key) return [];
  return [
    { label: '5 小时', limit: key.rate_limit_5h, used: key.usage_5h, reset: key.reset_5h_at },
    { label: '1 天', limit: key.rate_limit_1d, used: key.usage_1d, reset: key.reset_1d_at },
    { label: '7 天', limit: key.rate_limit_7d, used: key.usage_7d, reset: key.reset_7d_at },
  ].filter(window => window.limit > 0);
});
function openInspectorAction(action: 'edit' | 'use') {
  const key = inspectedKey.value;
  if (!key) return;
  inspectedKeyId.value = null;
  if (action === 'edit') openEditSheet(key);
  else openUseKey(key);
}
function inspectorMoney(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? '—' : `$${value.toFixed(4)}`;
}
const keyToDelete = ref<ApiKey | null>(null);
const selectedStatusEditable = computed(() => selectedKey.value?.status === 'active' || selectedKey.value?.status === 'inactive');

// Active client tab in UseKey sheet
const activeClientTab = ref<'claude' | 'openai' | 'cursor' | 'chatbox' | 'curl'>('claude');

// Form Data for Create / Edit
const formData = ref({
  name: '',
  group_id: null as number | null,
  status: 'active' as 'active' | 'inactive',
  use_custom_key: false,
  custom_key: '',
  enable_ip_restriction: false,
  ip_whitelist: '',
  ip_blacklist: '',
  enable_quota: false,
  quota: null as number | null,
  enable_rate_limit: false,
  rate_limit_5h: null as number | null,
  rate_limit_1d: null as number | null,
  rate_limit_7d: null as number | null,
  enable_expiration: false,
  expires_in_days: null as number | null,
  expires_at: ''
});

// Base URL computed
const apiBaseUrl = computed(() => {
  if (endpointLoadError.value) return '';
  return (publicSettings.value?.api_base_url?.trim() || window.location.origin).replace(/\/+$/, '');
});

const auxiliaryWarning = computed(() => {
  const missing: string[] = [];
  if (groupsLoadError.value) missing.push('分组');
  if (usageLoadError.value) missing.push('消费统计');
  if (endpointLoadError.value) missing.push('接入地址');
  return missing.length ? `${missing.join('、')}暂时无法加载，密钥列表仍可使用；请刷新重试。` : '';
});

const currentSnippet = computed(() => {
  if (!selectedKey.value || !apiBaseUrl.value) return '';
  const key = selectedKey.value.key;
  const baseRoot = apiBaseUrl.value.replace(/\/v1$/, '');
  const baseUrl = activeClientTab.value === 'claude' ? baseRoot : `${baseRoot}/v1`;
  if (activeClientTab.value === 'claude') {
    return `# 终端一键配置 Claude Code 环境变量:\nexport ANTHROPIC_BASE_URL="${baseUrl}"\nexport ANTHROPIC_API_KEY="${key}"\n\n# 启动 Claude Code CLI:\nclaude`;
  }
  if (activeClientTab.value === 'openai') {
    return `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${baseUrl}",\n    api_key="${key}"\n)\n\nresponse = client.chat.completions.create(\n    model="gpt-4o",\n    messages=[{"role": "user", "content": "Hello!"}]\n)\nprint(response.choices[0].message.content)`;
  }
  if (activeClientTab.value === 'cursor') {
    return `1. 打开 Cursor 设置 -> Models\n2. 开启 OpenAI API Key 支持\n3. 填入 API Key:\n   ${key}\n4. 点击 "Override OpenAI Base URL" 并填入:\n   ${baseUrl}`;
  }
  if (activeClientTab.value === 'chatbox') {
    return `1. 打开 Chatbox 设置 -> 模型提供商选择 "OpenAI API"\n2. API 密钥:\n   ${key}\n3. API 代理地址 (Base URL):\n   ${baseUrl}`;
  }
  return [
    `curl ${baseUrl}/chat/completions \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Authorization: Bearer ${key}" \\`,
    `  -d '{`,
    `    "model": "gpt-4o",`,
    `    "messages": [{"role": "user", "content": "Hello!"}]`,
    `  }'`,
  ].join('\n');
});

// Filtered Keys computed
const filteredKeys = computed(() => {
  let list = apiKeys.value;

  if (currentCategory.value === 'active') {
    list = list.filter(k => k.status === 'active');
  } else if (currentCategory.value === 'inactive') {
    list = list.filter(k => k.status === 'inactive');
  } else if (currentCategory.value === 'quota_exhausted') {
    list = list.filter(k => k.status === 'quota_exhausted');
  } else if (currentCategory.value === 'expired') {
    list = list.filter(k => k.status === 'expired');
  } else if (typeof currentCategory.value === 'number') {
    list = list.filter(k => k.group_id === currentCategory.value);
  }

  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim();
    list = list.filter(k =>
      k.name.toLowerCase().includes(q) ||
      k.key.toLowerCase().includes(q)
    );
  }

  return list;
});

// Category counts
const counts = computed(() => {
  const all = apiKeys.value.length;
  const active = apiKeys.value.filter(k => k.status === 'active').length;
  const inactive = apiKeys.value.filter(k => k.status === 'inactive').length;
  const quota_exhausted = apiKeys.value.filter(k => k.status === 'quota_exhausted').length;
  const expired = apiKeys.value.filter(k => k.status === 'expired').length;
  return { all, active, inactive, quota_exhausted, expired };
});

function statusMeta(status: ApiKey['status']) {
  switch (status) {
    case 'active':
      return { label: '活跃', tone: 'active', canToggle: true };
    case 'inactive':
      return { label: '已停用', tone: 'inactive', canToggle: true };
    case 'quota_exhausted':
      return { label: '额度耗尽', tone: 'warning', canToggle: false };
    case 'expired':
      return { label: '已过期', tone: 'danger', canToggle: false };
  }
}

function toDateTimeLocal(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message || fallback;
  }
  return fallback;
}

function maskApiKey(key: string): string {
  if (!key || key.length < 12) return key;
  return `${key.substring(0, 7)}...${key.substring(key.length - 4)}`;
}

// Copy Helper
async function copyToClipboard(text: string, keyId?: number, successMessage = '已复制到剪贴板') {
  try {
    await navigator.clipboard.writeText(text);
    if (keyId !== undefined) {
      copiedKeyId.value = keyId;
      setTimeout(() => {
        if (copiedKeyId.value === keyId) copiedKeyId.value = null;
      }, 2000);
    } else {
      showToast(successMessage);
    }
  } catch (err) {
    showToast('复制失败，请手动选择并复制。', 'error');
    console.error('Failed to copy to clipboard:', err);
  }
}

// Data Fetching
async function loadData() {
  if (disposed) return;
  const version = ++loadVersion;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  isLoading.value = true;
  loadError.value = '';
  groupsLoadError.value = false;
  endpointLoadError.value = false;
  usageLoadError.value = false;
  try {
    const [keysResult, groupsResult, settingsResult] = await Promise.allSettled([
      keysAPI.list(1, 100, undefined, { signal: controller.signal }),
      userGroupsAPI.getAvailable(),
      getPublicSettings()
    ]);
    if (disposed || version !== loadVersion || controller.signal.aborted) return;
    if (keysResult.status === 'rejected') throw keysResult.reason;

    const keysResp = keysResult.value;

    // The API is paginated. Read every server page so local status/group/search
    // filters and counts never silently describe only the first 100 keys.
    const allKeys = [...(keysResp.items || [])];
    const pageSize = Math.max(keysResp.page_size || 100, 1);
    const pageCount = Math.max(
      keysResp.pages || 1,
      Math.ceil((keysResp.total || allKeys.length) / pageSize)
    );
    for (let page = 2; page <= pageCount; page += 1) {
      if (disposed || version !== loadVersion || controller.signal.aborted) return;
      const nextPage = await keysAPI.list(page, pageSize, undefined, { signal: controller.signal });
      allKeys.push(...(nextPage.items || []));
    }
    const uniqueKeys = new Map<number, ApiKey>();
    allKeys.forEach(key => uniqueKeys.set(key.id, key));
    apiKeys.value = [...uniqueKeys.values()];
    if (groupsResult.status === 'fulfilled') {
      groups.value = groupsResult.value || [];
    } else {
      groupsLoadError.value = true;
    }
    if (settingsResult.status === 'fulfilled') {
      publicSettings.value = settingsResult.value;
    } else {
      endpointLoadError.value = true;
    }

    // Load usage stats in batch if keys exist
    usageStats.value = {};
    if (apiKeys.value.length > 0) {
      const ids = apiKeys.value.map(k => k.id);
      try {
        const usageData = await getDashboardApiKeysUsage(ids);
        if (disposed || version !== loadVersion || controller.signal.aborted) return;
        if (usageData && usageData.stats) {
          const map: Record<number, { today_actual_cost: number; total_actual_cost: number }> = {};
          for (const [keyIdStr, item] of Object.entries(usageData.stats)) {
            map[Number(keyIdStr)] = {
              today_actual_cost: item.today_actual_cost || 0,
              total_actual_cost: item.total_actual_cost || 0
            };
          }
          usageStats.value = map;
        }
      } catch (err) {
        if (disposed || version !== loadVersion || controller.signal.aborted) return;
        usageLoadError.value = true;
        console.warn('Failed to load batch keys usage:', err);
      }
    }
  } catch (err) {
    if (disposed || version !== loadVersion || controller.signal.aborted) return;
    loadError.value = '密钥列表加载失败，请检查连接后重试。';
    console.error('Failed to load keys data:', errorMessage(err, 'unknown error'));
  } finally {
    if (version === loadVersion) isLoading.value = false;
  }
}

// Group Lookup Helper
function getGroupById(groupId: number | null | undefined): Group | undefined {
  if (!groupId) return undefined;
  return groups.value.find(g => g.id === groupId);
}

// Action Handlers
function openCreateSheet() {
  formData.value = {
    name: '',
    group_id: groups.value.length > 0 ? groups.value[0].id : null,
    status: 'active',
    use_custom_key: false,
    custom_key: '',
    enable_ip_restriction: false,
    ip_whitelist: '',
    ip_blacklist: '',
    enable_quota: false,
    quota: null,
    enable_rate_limit: false,
    rate_limit_5h: null,
    rate_limit_1d: null,
    rate_limit_7d: null,
    enable_expiration: false,
    expires_in_days: null,
    expires_at: ''
  };
  showCreateSheet.value = true;
}

function openEditSheet(key: ApiKey) {
  selectedKey.value = key;
  formData.value = {
    name: key.name,
    group_id: key.group_id,
    status: key.status === 'active' ? 'active' : 'inactive',
    use_custom_key: false,
    custom_key: '',
    enable_ip_restriction: !!(key.ip_whitelist?.length || key.ip_blacklist?.length),
    ip_whitelist: key.ip_whitelist?.join('\n') || '',
    ip_blacklist: key.ip_blacklist?.join('\n') || '',
    enable_quota: !!(key.quota && key.quota > 0),
    quota: key.quota && key.quota > 0 ? key.quota : null,
    enable_rate_limit: !!(key.rate_limit_5h || key.rate_limit_1d || key.rate_limit_7d),
    rate_limit_5h: key.rate_limit_5h || null,
    rate_limit_1d: key.rate_limit_1d || null,
    rate_limit_7d: key.rate_limit_7d || null,
    enable_expiration: !!key.expires_at,
    expires_in_days: null,
    expires_at: toDateTimeLocal(key.expires_at)
  };
  showEditSheet.value = true;
}

function openUseKey(key: ApiKey) {
  selectedKey.value = key;
  showUseKeySheet.value = true;
}

function validateForm(isEdit = false): boolean {
  if (!formData.value.name.trim()) {
    showToast('请输入密钥名称。', 'error');
    return false;
  }
  if (formData.value.use_custom_key && formData.value.custom_key.trim().length < 16) {
    showToast('自定义密钥至少需要 16 位字符。', 'error');
    return false;
  }
  if (formData.value.enable_quota && (typeof formData.value.quota !== 'number' || formData.value.quota <= 0)) {
    showToast('请输入大于 0 的额度。', 'error');
    return false;
  }
  if (formData.value.enable_rate_limit) {
    const limits = [formData.value.rate_limit_5h, formData.value.rate_limit_1d, formData.value.rate_limit_7d];
    if (!limits.some(value => typeof value === 'number' && value > 0)) {
      showToast('至少填写一项请求限流值，或关闭请求限流。', 'error');
      return false;
    }
  }
  if (formData.value.enable_expiration) {
    if (isEdit ? !toIsoDateTime(formData.value.expires_at) : !(formData.value.expires_in_days && formData.value.expires_in_days > 0)) {
      showToast(isEdit ? '请选择有效的到期时间。' : '请输入有效的有效天数。', 'error');
      return false;
    }
  }
  return true;
}

async function handleCreate() {
  if (submitting.value || !validateForm()) return;
  submitting.value = true;
  try {
    const ipWhite = formData.value.enable_ip_restriction && formData.value.ip_whitelist.trim()
      ? formData.value.ip_whitelist.split('\n').map(s => s.trim()).filter(Boolean)
      : undefined;
    const ipBlack = formData.value.enable_ip_restriction && formData.value.ip_blacklist.trim()
      ? formData.value.ip_blacklist.split('\n').map(s => s.trim()).filter(Boolean)
      : undefined;

    const rateLimits = formData.value.enable_rate_limit
      ? {
          rate_limit_5h: formData.value.rate_limit_5h || undefined,
          rate_limit_1d: formData.value.rate_limit_1d || undefined,
          rate_limit_7d: formData.value.rate_limit_7d || undefined
        }
      : undefined;

    await keysAPI.create(
      formData.value.name.trim(),
      formData.value.group_id,
      formData.value.use_custom_key ? formData.value.custom_key.trim() : undefined,
      ipWhite,
      ipBlack,
      formData.value.enable_quota && formData.value.quota ? formData.value.quota : undefined,
      formData.value.enable_expiration && formData.value.expires_in_days ? formData.value.expires_in_days : undefined,
      rateLimits
    );
    showCreateSheet.value = false;
    showToast('API 密钥已成功创建');
    await loadData();
  } catch (err: any) {
    showToast(err?.response?.data?.message || err?.message || '创建密钥失败', 'error');
  } finally {
    submitting.value = false;
  }
}

async function handleEdit() {
  if (submitting.value || !selectedKey.value || !validateForm(true)) return;
  submitting.value = true;
  try {
    const ipWhite = formData.value.enable_ip_restriction && formData.value.ip_whitelist.trim()
      ? formData.value.ip_whitelist.split('\n').map(s => s.trim()).filter(Boolean)
      : [];
    const ipBlack = formData.value.enable_ip_restriction && formData.value.ip_blacklist.trim()
      ? formData.value.ip_blacklist.split('\n').map(s => s.trim()).filter(Boolean)
      : [];

    const updates: Parameters<typeof keysAPI.update>[1] = {
      name: formData.value.name.trim(),
      group_id: formData.value.group_id,
      ip_whitelist: ipWhite,
      ip_blacklist: ipBlack,
      quota: formData.value.enable_quota && formData.value.quota ? formData.value.quota : 0,
      rate_limit_5h: formData.value.enable_rate_limit && formData.value.rate_limit_5h ? formData.value.rate_limit_5h : 0,
      rate_limit_1d: formData.value.enable_rate_limit && formData.value.rate_limit_1d ? formData.value.rate_limit_1d : 0,
      rate_limit_7d: formData.value.enable_rate_limit && formData.value.rate_limit_7d ? formData.value.rate_limit_7d : 0
    };
    // Preserve derived server states when only key metadata is edited.
    if (selectedKey.value.status === 'active' || selectedKey.value.status === 'inactive') {
      updates.status = formData.value.status;
    }
    const originalExpiration = toDateTimeLocal(selectedKey.value.expires_at);
    if (formData.value.enable_expiration !== !!selectedKey.value.expires_at ||
      (formData.value.enable_expiration && formData.value.expires_at !== originalExpiration)) {
      updates.expires_at = formData.value.enable_expiration
        ? toIsoDateTime(formData.value.expires_at)
        : null;
    }
    await keysAPI.update(selectedKey.value.id, updates);
    showEditSheet.value = false;
    showToast('密钥配置已更新');
    await loadData();
  } catch (err: any) {
    showToast(err?.response?.data?.message || err?.message || '更新密钥失败', 'error');
  } finally {
    submitting.value = false;
  }
}

async function toggleStatus(key: ApiKey) {
  if (!statusMeta(key.status).canToggle || mutatingKeyId.value !== null) return;
  const next = key.status === 'active' ? 'inactive' : 'active';
  mutatingKeyId.value = key.id;
  try {
    const updated = await keysAPI.toggleStatus(key.id, next);
    Object.assign(key, updated);
    showToast(`密钥已${next === 'active' ? '启用' : '停用'}`);
  } catch (err: any) {
    showToast(err?.response?.data?.message || '切换状态失败', 'error');
  } finally {
    if (mutatingKeyId.value === key.id) mutatingKeyId.value = null;
  }
}

async function quickChangeGroup(key: ApiKey, newGroupId: number | null, event?: Event) {
  if (mutatingKeyId.value !== null) return;
  const previousGroupId = key.group_id;
  mutatingKeyId.value = key.id;
  try {
    const updated = await keysAPI.update(key.id, { group_id: newGroupId });
    Object.assign(key, updated);
    showToast('分组已切换');
  } catch (err: any) {
    const target = event?.target;
    if (target instanceof HTMLSelectElement) target.value = previousGroupId === null ? '' : String(previousGroupId);
    showToast(err?.response?.data?.message || '更新分组失败', 'error');
  } finally {
    if (mutatingKeyId.value === key.id) mutatingKeyId.value = null;
  }
}

function promptDelete(key: ApiKey) {
  keyToDelete.value = key;
  showDeleteConfirm.value = true;
}

async function confirmDelete() {
  if (!keyToDelete.value || deleting.value) return;
  const deletingId = keyToDelete.value.id;
  deleting.value = true;
  mutatingKeyId.value = deletingId;
  try {
    await keysAPI.delete(keyToDelete.value.id);
    showDeleteConfirm.value = false;
    keyToDelete.value = null;
    showToast('密钥已成功删除');
    await loadData();
  } catch (err: any) {
    showToast(err?.response?.data?.message || '删除密钥失败', 'error');
  } finally {
    deleting.value = false;
    if (mutatingKeyId.value === deletingId) mutatingKeyId.value = null;
  }
}

function copyCurrentSnippet() {
  if (!currentSnippet.value) return;
  copyToClipboard(currentSnippet.value, undefined, '接入示例已复制');
}

onMounted(() => {
  loadData();
});

onUnmounted(() => {
  disposed = true;
  loadVersion += 1;
  listController?.abort();
});
</script>

<template>
  <div class="user-app-polish keychain-app h-full flex flex-col bg-[#f5f5f7] dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] select-none overflow-hidden font-sans relative">
    <!-- Floating macOS HUD Notification Toast -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="-translate-y-4 opacity-0"
      enter-to-class="translate-y-0 opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="translate-y-0 opacity-100"
      leave-to-class="-translate-y-4 opacity-0"
    >
      <div
        v-if="toastMsg"
        class="absolute top-14 left-1/2 -translate-x-1/2 z-[60000] px-4 py-1.5 rounded-full shadow-lg border text-xs font-medium backdrop-blur-xl flex items-center gap-2 pointer-events-none"
        :class="toastType === 'error' ? 'bg-red-500/90 text-white border-red-400/50' : 'bg-[#1c1c1e]/90 text-white border-white/20'"
        role="status"
        aria-live="polite"
      >
        <span>{{ toastType === 'error' ? '⚠️' : '✓' }}</span>
        <span>{{ toastMsg }}</span>
      </div>
    </Transition>

    <!-- Top macOS Tahoe Toolbar -->
    <div class="app-toolbar h-12 px-4 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between bg-white/70 dark:bg-[#252527]/70 backdrop-blur-xl shrink-0 gap-3">
      <!-- Left: App Icon & Title -->
      <div class="flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0">
          <img :src="getAppIcon('keychain')" class="w-8 h-8 object-contain drop-shadow-sm" alt="" />
        </div>
        <div>
          <h1 class="text-xs font-semibold tracking-tight text-black/90 dark:text-white/90">API 密钥</h1>
          <p class="text-[10px] text-black/45 dark:text-white/45">{{ isLoading ? '正在读取密钥…' : `${filteredKeys.length} 个密钥` }}</p>
        </div>
      </div>

      <!-- Right Controls: Search, BaseURL, Refresh, Create -->
      <div class="app-actions">
        <!-- Search Input -->
        <div class="keychain-search-wrap relative flex items-center">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索名称或密钥" aria-label="搜索密钥"
            class="keychain-search h-7 w-40 sm:w-52 pl-7 pr-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 transition-all text-black dark:text-white placeholder-black/40 dark:placeholder-white/40"
          />
          <svg class="w-3.5 h-3.5 text-black/40 dark:text-white/40 absolute left-2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </div>

        <!-- Endpoint Base URL Popover Button -->
        <div class="relative">
          <button
            type="button"
            @click="showEndpointPopover = !showEndpointPopover"
            class="h-7 px-2.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium text-black/75 dark:text-white/75 flex items-center gap-1.5 transition-colors border border-black/[0.04] dark:border-white/[0.06]"
            title="接入地址"
            :aria-expanded="showEndpointPopover"
            aria-label="查看 API 接入地址"
          >
            <svg class="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
            <span class="hidden sm:inline">端点地址</span>
          </button>

          <!-- Popover Modal -->
          <div
            v-if="showEndpointPopover"
            class="endpoint-popover absolute right-0 top-9 z-50 w-80 p-3.5 rounded-xl bg-white dark:bg-[#252527] border border-black/[0.08] dark:border-white/[0.1] shadow-xl text-xs space-y-2.5 backdrop-blur-2xl"
          >
            <div class="flex items-center justify-between pb-1.5 border-b border-black/[0.06] dark:border-white/[0.08]">
              <span class="font-semibold text-black/90 dark:text-white/90">API 接入地址</span>
              <button type="button" @click="showEndpointPopover = false" class="text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white" aria-label="关闭 API 接入地址">✕</button>
            </div>
            <div>
              <p class="text-[11px] text-black/50 dark:text-white/50 mb-1">通用 Base URL (兼容 OpenAI 规范)</p>
              <div class="flex items-center gap-1.5 bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
                <code class="flex-1 font-mono text-[11px] text-blue-600 dark:text-blue-400 truncate">{{ apiBaseUrl }}</code>
                <button
                  type="button"
                  :disabled="!apiBaseUrl"
                  @click="copyToClipboard(apiBaseUrl, undefined, '接入地址已复制')"
                  class="px-2 py-0.5 rounded-md bg-blue-500 text-white text-[10px] font-medium hover:bg-blue-600 transition-colors"
                >
                  复制
                </button>
              </div>
            </div>
            <p class="text-[10px] text-black/45 dark:text-white/45 leading-relaxed">
              支持直接在 Cursor、Chatbox、NextChat 等客户端中填入上述 Base URL 及您创建的 API 密钥。
            </p>
          </div>
        </div>

        <!-- Refresh Button -->
        <button
          type="button"
          @click="loadData"
          :disabled="isLoading"
          class="w-7 h-7 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] flex items-center justify-center text-black/75 dark:text-white/75 transition-colors border border-black/[0.04] dark:border-white/[0.06]"
          title="刷新数据"
          aria-label="刷新密钥列表"
        >
          <svg class="w-3.5 h-3.5" :class="{ 'animate-spin': isLoading }" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        <!-- Create Key Button -->
        <button
          type="button"
          @click="openCreateSheet"
          class="h-7 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 active:scale-95 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-all"
          aria-label="创建 API 密钥"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>创建密钥</span>
        </button>
      </div>
    </div>

    <div v-if="loadError" class="app-notice" data-tone="error" role="alert"><span>{{ loadError }}</span><button type="button" @click="loadData" :disabled="isLoading">重试</button></div>
    <div v-if="auxiliaryWarning" class="app-notice" data-tone="warning" role="status"><span>{{ auxiliaryWarning }}</span><button type="button" @click="loadData" :disabled="isLoading">重新加载</button></div>
    <!-- Main Content Area: macOS SplitView -->
    <div class="keychain-layout flex-1 flex min-h-0 overflow-hidden" :aria-busy="isLoading">
      <!-- Sidebar (Categories & Group Filters) -->
      <div class="app-sidebar w-48 border-r border-black/[0.06] dark:border-white/[0.08] bg-black/[0.015] dark:bg-white/[0.015] flex flex-col p-2 space-y-4 overflow-y-auto shrink-0 select-none text-xs">
        <!-- Section 1: Status Filters -->
        <div>
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">状态分类</p>
          <div class="space-y-0.5">
            <button
              @click="currentCategory = 'all'"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors"
              :class="currentCategory === 'all' ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
            >
              <div class="flex items-center gap-2">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                </svg>
                <span>全部密钥</span>
              </div>
              <span class="text-[11px] font-mono opacity-80">{{ counts.all }}</span>
            </button>

            <button
              @click="currentCategory = 'active'"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors"
              :class="currentCategory === 'active' ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
            >
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                <span>活跃中</span>
              </div>
              <span class="text-[11px] font-mono opacity-80">{{ counts.active }}</span>
            </button>

            <button
              @click="currentCategory = 'inactive'"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors"
              :class="currentCategory === 'inactive' ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
            >
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-black/30 dark:bg-white/30"></span>
                <span>已停用</span>
              </div>
              <span class="text-[11px] font-mono opacity-80">{{ counts.inactive }}</span>
            </button>

            <button
              @click="currentCategory = 'quota_exhausted'"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors"
              :class="currentCategory === 'quota_exhausted' ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
            >
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-amber-500"></span>
                <span>额度耗尽</span>
              </div>
              <span class="text-[11px] font-mono opacity-80">{{ counts.quota_exhausted }}</span>
            </button>

            <button
              @click="currentCategory = 'expired'"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors"
              :class="currentCategory === 'expired' ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
            >
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-red-500"></span>
                <span>已过期</span>
              </div>
              <span class="text-[11px] font-mono opacity-80">{{ counts.expired }}</span>
            </button>
          </div>
        </div>

        <!-- Section 2: Group Filters (Dynamic from Backend) -->
        <div v-if="groups.length > 0">
          <p class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-black/40 dark:text-white/40">所属分组</p>
          <div class="space-y-0.5">
            <button
              v-for="grp in groups"
              :key="grp.id"
              @click="currentCategory = grp.id"
              class="w-full px-2.5 py-1.5 rounded-lg text-left font-medium flex items-center justify-between transition-colors truncate"
              :class="currentCategory === grp.id ? 'bg-blue-500 text-white font-semibold' : 'text-black/75 dark:text-white/75 hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'"
              :title="grp.name"
            >
              <div class="flex items-center gap-2 truncate">
                <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span class="truncate">{{ grp.name }}</span>
              </div>
              <span class="text-[10px] font-mono px-1 rounded bg-black/5 dark:bg-white/10 shrink-0">x{{ grp.rate_multiplier }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Main Table Area -->
      <div class="flex-1 flex flex-col min-w-0 bg-white dark:bg-[#1e1e1e] overflow-auto">
        <div v-if="isLoading && apiKeys.length === 0" class="app-empty" role="status"><strong>正在读取密钥</strong><p>正在同步密钥、分组与用量。</p></div>
        <div v-else-if="loadError && apiKeys.length === 0" class="app-empty"><strong>暂时无法显示密钥</strong><p>重试后继续管理，已有密钥不受影响。</p></div>
        <!-- Empty State -->
        <div v-else-if="filteredKeys.length === 0" class="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div class="w-12 h-12 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center text-black/30 dark:text-white/30 mb-3">
            <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
            </svg>
          </div>
          <h3 class="text-xs font-semibold text-black/80 dark:text-white/80 mb-1">{{ apiKeys.length ? '没有匹配的密钥' : '暂无 API 密钥' }}</h3>
          <p class="text-[11px] text-black/45 dark:text-white/45 max-w-xs mb-4">
            {{ apiKeys.length ? '尝试其他关键词，或清除当前筛选。' : '创建一个 API 密钥，连接您使用的模型与客户端。' }}
          </p>
          <button
            v-if="apiKeys.length === 0"
            type="button"
            @click="openCreateSheet"
            class="h-7 px-3 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-medium shadow-xs transition-colors"
          >
            创建密钥
          </button>
          <button
            v-else
            type="button"
            class="app-retry"
            @click="searchQuery = ''; currentCategory = 'all'"
          >
            清除筛选
          </button>
        </div>
        <!-- Table View -->
        <table v-if="filteredKeys.length > 0" class="app-table keychain-table w-full min-w-[720px] text-left text-xs border-collapse">
          <thead class="sticky top-0 bg-[#fafafa] dark:bg-[#252527] border-b border-black/[0.06] dark:border-white/[0.08] text-[11px] font-semibold text-black/50 dark:text-white/50 z-10">
            <tr>
              <th class="py-2.5 px-4 font-medium">名称 / 密钥</th>
              <th class="py-2.5 px-3 font-medium">分组</th>
              <th class="py-2.5 px-3 font-medium text-center">当前并发</th>
              <th class="py-2.5 px-3 font-medium">用量与消费</th>
              <th class="py-2.5 px-3 font-medium text-center">状态</th>
              <th class="py-2.5 px-3 font-medium">创建时间</th>
              <th class="py-2.5 px-4 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
            <tr
              v-for="k in filteredKeys"
              :key="k.id"
              class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors group"
            >
              <!-- Name & Masked Key -->
              <td class="py-3 px-4 min-w-[200px]">
                <div class="flex items-center gap-1.5 font-medium text-black/90 dark:text-white/90">
                  <button type="button" class="key-inspector-link app-long-value" :title="k.name" :aria-label="`查看 ${k.name} 详情`" @click="inspectedKeyId = k.id">{{ k.name }}</button>
                  <span
                    v-if="k.ip_whitelist?.length || k.ip_blacklist?.length"
                    class="p-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[9px] font-mono"
                    title="已开启 IP 访问限制"
                  >
                    IP 保护
                  </span>
                </div>
                <div class="flex items-center gap-1.5 mt-0.5">
                  <code class="font-mono text-[11px] text-black/50 dark:text-white/50 bg-black/[0.04] dark:bg-white/[0.06] px-1.5 py-0.5 rounded">
                    {{ maskApiKey(k.key) }}
                  </code>
                  <button
                    type="button"
                    @click="copyToClipboard(k.key, k.id)"
                    class="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors"
                    :title="copiedKeyId === k.id ? '已复制' : '复制完整密钥'"
                    :aria-label="copiedKeyId === k.id ? `${k.name} 已复制` : `复制 ${k.name} 的完整密钥`"
                  >
                    <svg v-if="copiedKeyId === k.id" class="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                </div>
              </td>

              <!-- Group Selector -->
              <td class="py-3 px-3 min-w-[130px]">
                <select
                  :value="k.group_id"
                  @change="quickChangeGroup(k, ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null, $event)"
                  :disabled="groupsLoadError || mutatingKeyId === k.id"
                  :aria-label="`为 ${k.name} 选择分组`"
                  class="h-6 px-2 rounded-md bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-[11px] font-medium outline-none text-black/80 dark:text-white/80 cursor-pointer"
                >
                  <option :value="null">未分配分组</option>
                  <option v-for="g in groups" :key="g.id" :value="g.id">
                    {{ g.name }} (x{{ g.rate_multiplier }})
                  </option>
                  <option v-if="k.group_id !== null && !groups.some(g => g.id === k.group_id)" :value="k.group_id">
                    当前分组 #{{ k.group_id }}
                  </option>
                </select>
              </td>

              <!-- Concurrency -->
              <td class="py-3 px-3 text-center">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold"
                  :class="(k.current_concurrency ?? 0) > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-black/[0.04] dark:bg-white/[0.06] text-black/40 dark:text-white/40'"
                >
                  {{ k.current_concurrency ?? 0 }}
                </span>
              </td>

              <!-- Usage & Quota -->
              <td class="py-3 px-3 min-w-[160px]">
                <div class="text-[11px] space-y-0.5">
                  <div class="flex items-center justify-between text-black/60 dark:text-white/60">
                    <span>今日:</span>
                    <span class="font-mono font-medium text-black/90 dark:text-white/90">
                      <template v-if="usageLoadError">—</template>
                      <template v-else>${{ (usageStats[k.id]?.today_actual_cost ?? 0).toFixed(4) }}</template>
                    </span>
                  </div>
                  <div class="flex items-center justify-between text-black/60 dark:text-white/60">
                    <span>累计:</span>
                    <span class="font-mono font-medium text-purple-600 dark:text-purple-400">
                      <template v-if="usageLoadError">—</template>
                      <template v-else>${{ (usageStats[k.id]?.total_actual_cost ?? 0).toFixed(4) }}</template>
                    </span>
                  </div>
                  <!-- Quota progress bar if set -->
                  <div v-if="k.quota > 0" class="pt-1">
                    <div class="flex items-center justify-between text-[10px] text-black/50 dark:text-white/50">
                      <span>额度</span>
                      <span class="font-mono">${{ k.quota_used?.toFixed(2) || '0.00' }} / ${{ k.quota.toFixed(2) }}</span>
                    </div>
                    <div class="h-1.5 w-full bg-black/[0.06] dark:bg-white/[0.08] rounded-full overflow-hidden mt-0.5">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="k.quota_used >= k.quota ? 'bg-red-500' : 'bg-blue-500'"
                        :style="{ width: `${Math.min((k.quota_used / k.quota) * 100, 100)}%` }"
                      ></div>
                    </div>
                  </div>
                </div>
              </td>

              <!-- Status Toggle -->
              <td class="py-3 px-3 text-center">
                <button
                  type="button"
                  @click="toggleStatus(k)"
                  :disabled="!statusMeta(k.status).canToggle || mutatingKeyId === k.id"
                  class="px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors disabled:cursor-default"
                  :class="{
                    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20': statusMeta(k.status).tone === 'active',
                    'bg-black/[0.06] dark:bg-white/[0.08] text-black/40 dark:text-white/40 hover:bg-black/[0.1]': statusMeta(k.status).tone === 'inactive',
                    'bg-amber-500/10 text-amber-600 dark:text-amber-400': statusMeta(k.status).tone === 'warning',
                    'bg-red-500/10 text-red-600 dark:text-red-400': statusMeta(k.status).tone === 'danger'
                  }"
                  :title="statusMeta(k.status).canToggle ? (k.status === 'active' ? '点击停用' : '点击激活') : '由额度或到期状态决定'"
                  :aria-label="statusMeta(k.status).canToggle ? `${k.name} ${k.status === 'active' ? '停用' : '启用'}` : `${k.name} ${statusMeta(k.status).label}`"
                >
                  {{ statusMeta(k.status).label }}
                </button>
              </td>

              <!-- Created At -->
              <td class="py-3 px-3 text-black/50 dark:text-white/50 text-[11px] font-mono whitespace-nowrap">
                {{ formatDateTime(k.created_at) }}
              </td>

              <!-- Actions -->
              <td class="py-3 px-4 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-1">
                  <!-- Use Key (Terminal guide) -->
                  <button
                    type="button"
                    @click="openUseKey(k)"
                    class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-emerald-600 dark:text-emerald-400 transition-colors"
                    title="接入指南 (Claude Code / OpenAI / Cursor)"
                    :aria-label="`打开 ${k.name} 的接入指南`"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="4 17 10 11 4 5"></polyline>
                      <line x1="12" y1="19" x2="20" y2="19"></line>
                    </svg>
                  </button>

                  <!-- Edit -->
                  <button
                    type="button"
                    @click="openEditSheet(k)"
                    class="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-blue-600 dark:text-blue-400 transition-colors"
                    title="编辑密钥"
                    :aria-label="`编辑 ${k.name}`"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>

                  <!-- Delete -->
                  <button
                    type="button"
                    @click="promptDelete(k)"
                    class="p-1.5 rounded-lg hover:bg-red-500/10 text-red-500 transition-colors"
                    title="删除密钥"
                    :aria-label="`删除 ${k.name}`"
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <MacSheet :show="inspectedKeyId !== null" :title="inspectedKey?.name || '密钥详情'" @close="inspectedKeyId = null">
      <div v-if="inspectedKey" class="key-inspector">
        <p v-if="loadError" role="status" class="key-inspector-note">列表刷新失败，以下为上次加载的信息。</p>
        <div class="key-inspector-identity"><code>{{ maskApiKey(inspectedKey.key) }}</code><span>{{ statusMeta(inspectedKey.status).label }}</span></div>
        <dl>
          <dt>所属分组</dt><dd>{{ getGroupById(inspectedKey.group_id)?.name || (inspectedKey.group_id == null ? '未分配分组' : `分组 #${inspectedKey.group_id}`) }}</dd>
          <dt>总额度</dt><dd>{{ inspectedKey.quota === 0 ? '不限额' : inspectorMoney(inspectedKey.quota) }}</dd>
          <dt>已用额度</dt><dd>{{ inspectorMoney(inspectedKey.quota_used) }}</dd>
          <dt>今日消费</dt><dd>{{ usageLoadError ? '—' : inspectorMoney(usageStats[inspectedKey.id]?.today_actual_cost) }}</dd>
          <dt>累计消费</dt><dd>{{ usageLoadError ? '—' : inspectorMoney(usageStats[inspectedKey.id]?.total_actual_cost) }}</dd>
          <dt>创建时间</dt><dd>{{ formatDateTime(inspectedKey.created_at) }}</dd>
          <dt>到期时间</dt><dd>{{ inspectedKey.expires_at ? formatDateTime(inspectedKey.expires_at) : '永不过期' }}</dd>
          <dt>最近使用</dt><dd>{{ inspectedKey.last_used_at ? formatDateTime(inspectedKey.last_used_at) : '暂无使用记录' }}</dd>
        </dl>
        <section v-if="quotaWindows.length"><h4>周期额度</h4><div v-for="window in quotaWindows" :key="window.label" class="key-quota-window"><strong>{{ window.label }}</strong><span>{{ inspectorMoney(window.used) }} / {{ inspectorMoney(window.limit) }}</span><small v-if="window.reset">重置于 {{ formatDateTime(window.reset) }}</small></div></section>
        <section><h4>IP 访问限制</h4><dl><dt>允许访问</dt><dd>{{ inspectedKey.ip_whitelist?.length ? inspectedKey.ip_whitelist.join('、') : '未设置白名单' }}</dd><dt>禁止访问</dt><dd>{{ inspectedKey.ip_blacklist?.length ? inspectedKey.ip_blacklist.join('、') : '未设置黑名单' }}</dd></dl></section>
      </div>
      <p v-else>此密钥已不在当前列表中，请关闭后刷新列表。</p>
      <template #footer><MacButton @click="inspectedKeyId = null">完成</MacButton><MacButton v-if="inspectedKey" @click="openInspectorAction('use')">接入指南</MacButton><MacButton v-if="inspectedKey" variant="primary" :disabled="mutatingKeyId === inspectedKey.id" @click="openInspectorAction('edit')">编辑密钥</MacButton></template>
    </MacSheet>

    <!-- Sheet 1: Create Key Sheet -->
    <MacSheet
      :show="showCreateSheet"
      title="创建新 API 密钥"
      @close="showCreateSheet = false"
    >
      <form @submit.prevent="handleCreate" class="p-5 space-y-4 text-xs">
        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1">密钥名称 *</label>
          <input
            v-model="formData.name"
            type="text"
            required
            placeholder="例如: Claude Code, Cursor, 测试密钥"
            class="w-full h-8 px-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
          />
        </div>

        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1">绑定分组</label>
          <select
            v-model="formData.group_id"
            class="w-full h-8 px-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
          >
            <option :value="null">未分配分组 (继承默认)</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">
              {{ g.name }} (平台: {{ g.platform }}, 倍率: x{{ g.rate_multiplier }})
            </option>
          </select>
        </div>

        <!-- Custom Key Option -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">自定义密钥字符</span>
            <input type="checkbox" v-model="formData.use_custom_key" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.use_custom_key" class="mt-2">
            <input
              v-model="formData.custom_key"
              type="text"
              placeholder="sk-xxxxxxxxxxxxxxxx"
              class="w-full h-8 px-3 rounded-lg font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
            />
            <p class="text-[10px] text-black/45 dark:text-white/45 mt-1">需至少 16 位字符，支持字母、数字与横杠。</p>
          </div>
        </div>

        <!-- Quota Limit -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">额度限制 (USD)</span>
            <input type="checkbox" v-model="formData.enable_quota" class="rounded accent-blue-500" />
          </div>
        <div v-if="formData.enable_quota" class="mt-2">
          <input
            v-model.number="formData.quota"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00 (美元)"
              class="w-full h-8 px-3 rounded-lg font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
            />
          </div>
        </div>

        <!-- IP Restriction -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">IP 访问控制</span>
            <input type="checkbox" v-model="formData.enable_ip_restriction" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_ip_restriction" class="mt-2 space-y-2">
            <div>
              <span class="text-[10px] text-black/50 dark:text-white/50">IP 白名单 (每行一个)</span>
              <textarea
                v-model="formData.ip_whitelist"
                rows="2"
                placeholder="192.168.1.1&#10;10.0.0.0/24"
                class="w-full p-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white"
              ></textarea>
            </div>
            <div>
              <span class="text-[10px] text-black/50 dark:text-white/50">IP 黑名单 (每行一个)</span>
              <textarea
                v-model="formData.ip_blacklist"
                rows="2"
                placeholder="203.0.113.10"
                class="w-full p-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white"
              ></textarea>
            </div>
          </div>
        </div>

        <!-- Rate Limits -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">请求限流</span>
            <input type="checkbox" v-model="formData.enable_rate_limit" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_rate_limit" class="grid grid-cols-3 gap-2 mt-2">
            <label class="text-[10px] text-black/50 dark:text-white/50">
              5 小时
              <input v-model.number="formData.rate_limit_5h" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" />
            </label>
            <label class="text-[10px] text-black/50 dark:text-white/50">
              1 天
              <input v-model.number="formData.rate_limit_1d" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" />
            </label>
            <label class="text-[10px] text-black/50 dark:text-white/50">
              7 天
              <input v-model.number="formData.rate_limit_7d" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" />
            </label>
          </div>
        </div>

        <!-- Expiration -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">有效期</span>
            <input type="checkbox" v-model="formData.enable_expiration" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_expiration" class="mt-2">
            <input
              v-model.number="formData.expires_in_days"
              type="number"
              min="1"
              step="1"
              required
              placeholder="有效天数"
              class="w-full h-8 px-3 rounded-lg font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
            />
          </div>
        </div>

        <!-- Actions -->
        <div class="pt-4 flex items-center justify-end gap-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            @click="showCreateSheet = false"
            class="h-7 px-3 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] text-xs font-medium transition-colors text-black dark:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="submitting"
            class="h-7 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <div v-if="submitting" class="w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
            <span>确认创建</span>
          </button>
        </div>
      </form>
    </MacSheet>

    <!-- Sheet 2: Edit Key Sheet -->
    <MacSheet
      :show="showEditSheet"
      :title="`编辑密钥 · ${selectedKey?.name || ''}`"
      @close="showEditSheet = false"
    >
      <form @submit.prevent="handleEdit" class="p-5 space-y-4 text-xs">
        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1">密钥名称 *</label>
          <input
            v-model="formData.name"
            type="text"
            required
            class="w-full h-8 px-3 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
          />
        </div>

        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1">分组</label>
          <select
            v-model="formData.group_id"
            class="w-full h-8 px-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
          >
            <option :value="null">未分配分组</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">
              {{ g.name }} (x{{ g.rate_multiplier }})
            </option>
          </select>
        </div>

        <div>
          <label class="block font-medium text-black/70 dark:text-white/70 mb-1">状态</label>
          <select
            v-model="formData.status"
            :disabled="!selectedStatusEditable"
            class="w-full h-8 px-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
          >
            <option value="active">活跃 (Active)</option>
            <option value="inactive">已停用 (Inactive)</option>
          </select>
          <p v-if="!selectedStatusEditable" class="mt-1 text-[10px] text-black/45 dark:text-white/45">额度耗尽或已过期状态由服务端根据限制自动计算。</p>
        </div>

        <!-- Quota Limit -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">额度限制 (USD, 0 为不限)</span>
            <input type="checkbox" v-model="formData.enable_quota" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_quota" class="mt-2">
            <input
              v-model.number="formData.quota"
              type="number"
              step="0.01"
              min="0"
              class="w-full h-8 px-3 rounded-lg font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white"
            />
          </div>
        </div>

        <!-- IP Restriction -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">IP 访问控制</span>
            <input type="checkbox" v-model="formData.enable_ip_restriction" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_ip_restriction" class="mt-2 space-y-2">
            <label class="block text-[10px] text-black/50 dark:text-white/50">
              IP 白名单（每行一个）
              <textarea v-model="formData.ip_whitelist" rows="2" placeholder="192.168.1.1\n10.0.0.0/24" class="mt-1 w-full p-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white"></textarea>
            </label>
            <label class="block text-[10px] text-black/50 dark:text-white/50">
              IP 黑名单（每行一个）
              <textarea v-model="formData.ip_blacklist" rows="2" placeholder="203.0.113.10" class="mt-1 w-full p-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white"></textarea>
            </label>
          </div>
        </div>

        <!-- Rate Limits -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">请求限流</span>
            <input type="checkbox" v-model="formData.enable_rate_limit" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_rate_limit" class="grid grid-cols-3 gap-2 mt-2">
            <label class="text-[10px] text-black/50 dark:text-white/50">5 小时<input v-model.number="formData.rate_limit_5h" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" /></label>
            <label class="text-[10px] text-black/50 dark:text-white/50">1 天<input v-model.number="formData.rate_limit_1d" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" /></label>
            <label class="text-[10px] text-black/50 dark:text-white/50">7 天<input v-model.number="formData.rate_limit_7d" type="number" min="0" step="1" placeholder="不限" class="mt-1 w-full h-8 px-2 rounded-lg font-mono text-[11px] bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] outline-none text-black dark:text-white" /></label>
          </div>
        </div>

        <!-- Expiration -->
        <div class="pt-1 border-t border-black/[0.06] dark:border-white/[0.08]">
          <div class="flex items-center justify-between">
            <span class="font-medium text-black/75 dark:text-white/75">有效期</span>
            <input type="checkbox" v-model="formData.enable_expiration" class="rounded accent-blue-500" />
          </div>
          <div v-if="formData.enable_expiration" class="mt-2">
            <input v-model="formData.expires_at" type="datetime-local" required class="w-full h-8 px-3 rounded-lg font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.08] text-xs outline-none focus:ring-1 focus:ring-blue-500 text-black dark:text-white" />
          </div>
          <p v-else-if="selectedKey?.expires_at" class="mt-1 text-[10px] text-black/45 dark:text-white/45">关闭后保存将移除当前到期时间。</p>
        </div>

        <!-- Actions -->
        <div class="pt-4 flex items-center justify-end gap-2.5 border-t border-black/[0.06] dark:border-white/[0.08]">
          <button
            type="button"
            @click="showEditSheet = false"
            class="h-7 px-3 rounded-lg bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.1] text-xs font-medium transition-colors text-black dark:text-white"
          >
            取消
          </button>
          <button
            type="submit"
            :disabled="submitting"
            class="h-7 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
          >
            <div v-if="submitting" class="w-3 h-3 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
            <span>保存修改</span>
          </button>
        </div>
      </form>
    </MacSheet>

    <!-- Sheet 3: Use Key Sheet (Full Client Integration Guides) -->
    <MacSheet
      :show="showUseKeySheet"
      :title="`接入指引 · ${selectedKey?.name || ''}`"
      @close="showUseKeySheet = false"
    >
      <div v-if="selectedKey" class="p-5 space-y-4 text-xs">
        <!-- Client Tabs -->
        <div class="flex items-center gap-1 p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.04] dark:border-white/[0.06]">
          <button
            v-for="t in [
              { id: 'claude', label: 'Claude Code' },
              { id: 'openai', label: 'OpenAI SDK' },
              { id: 'cursor', label: 'Cursor' },
              { id: 'chatbox', label: 'Chatbox' },
              { id: 'curl', label: 'cURL' }
            ] as const"
            :key="t.id"
            @click="activeClientTab = t.id"
            class="flex-1 py-1 rounded-[6px] text-center font-medium transition-all"
            :class="activeClientTab === t.id ? 'bg-white dark:bg-[#323234] text-black dark:text-white shadow-xs font-semibold' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          >
            {{ t.label }}
          </button>
        </div>

        <!-- Code Block Content -->
        <div class="relative rounded-xl bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] p-3.5 font-mono text-[11px] overflow-x-auto text-black/85 dark:text-white/85 leading-relaxed">
          <p v-if="!currentSnippet" role="alert">接入地址尚未确认，请关闭指引并刷新重试。</p>
          <pre v-else>{{ currentSnippet }}</pre>

          <!-- Copy Button -->
          <button
            @click="copyCurrentSnippet"
            :disabled="!currentSnippet"
            class="absolute top-2.5 right-2.5 px-2 py-1 rounded-md bg-white dark:bg-[#323234] border border-black/[0.08] dark:border-white/[0.1] text-[10px] font-sans font-medium text-black/75 dark:text-white/75 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            一键复制
          </button>
        </div>

        <div class="flex items-center justify-between text-[11px] text-black/50 dark:text-white/50 pt-2">
          <span>所属分组: {{ getGroupById(selectedKey.group_id)?.name || '未分配分组' }}</span>
          <span>密钥 ID: #{{ selectedKey.id }}</span>
        </div>
      </div>
    </MacSheet>

    <!-- Native macOS Attached Alert Sheet for Deletion -->
    <MacAlertSheet
      :show="showDeleteConfirm"
      title="确认删除此 API 密钥？"
      :message="`密钥「${keyToDelete?.name}」删除后将无法恢复，所有使用该密钥的客户端将立即失效。`"
      confirm-text="删除密钥"
      cancel-text="取消"
      :danger="true"
      @confirm="confirmDelete"
      @cancel="showDeleteConfirm = false; keyToDelete = null"
    />
  </div>
</template>

<style scoped>
.key-inspector-link { text-align:left;color:var(--accent);border-radius:3px; }.key-inspector-link:hover { text-decoration:underline; }.key-inspector-link:focus-visible { outline:2px solid var(--accent);outline-offset:3px; }
.key-inspector { display:grid;gap:16px;font-size:12px;line-height:1.6; }.key-inspector-identity { display:flex;justify-content:space-between;align-items:center;gap:12px; }.key-inspector-identity code { overflow-wrap:anywhere;color:var(--text-secondary); }.key-inspector-identity>span { font-size:11px;flex-shrink:0; }.key-inspector dl { display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px; }.key-inspector dt,.key-inspector-note { color:var(--text-secondary); }.key-inspector dd { text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;user-select:text; }.key-inspector h4 { font-size:12px;font-weight:600;padding-bottom:8px;margin-bottom:10px;border-bottom:1px solid var(--border-subtle); }.key-quota-window { display:grid;grid-template-columns:auto 1fr;gap:4px 12px;padding:7px 0; }.key-quota-window>span { text-align:right;font-variant-numeric:tabular-nums; }.key-quota-window small { grid-column:1/-1;color:var(--text-secondary);text-align:right; }

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
