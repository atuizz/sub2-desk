<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, onMounted, onUnmounted, computed } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import { adminError } from './admin-feedback';
import { proxiesAPI } from '../../api/admin/proxies';
import type { ProxyProtocol, CreateProxyRequest, Proxy, PaginatedResponse, ProxyAccountSummary, ProxyQualityCheckResult } from '@/types';

defineProps<{
  win?: WindowInstance;
}>();

const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const saving = ref(false);
const testResult = ref('');
const testingProxy = ref<number | null>(null);
const deleting = ref(false);
let loadVersion = 0;
const proxies = ref<Proxy[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const search = ref('');
const protocolFilter = ref('');
const statusFilter = ref('');

const showCreateModal = ref(false);
const showEditModal = ref<Proxy | null>(null);
const showDeleteConfirm = ref<Proxy | null>(null);
const selectedIds = ref<Set<number>>(new Set());

// Batch Add Proxies State
const showBatchModal = ref(false);
const batchProxiesText = ref('');
const batchDefaultProtocol = ref('http');
const isBatchCreating = ref(false);

// Associated Accounts Modal State
const showAccountsModal = ref(false);
const accountsProxy = ref<Proxy | null>(null);
const proxyAccounts = ref<ProxyAccountSummary[]>([]);
const loadingAccounts = ref(false);
const accountsError = ref('');
let accountsVersion = 0;
onUnmounted(() => { accountsVersion++; });
const batchDeleteResult = ref<{ deleted_ids: number[]; skipped: Array<{ id: number; reason: string }> } | null>(null);

// Quality Check Modal State
const showQualityModal = ref(false);
const qualityProxy = ref<Proxy | null>(null);
const qualityResult = ref<ProxyQualityCheckResult | null>(null);
const isCheckingQuality = ref(false);

// Create form
const createForm = ref({
  name: '',
  protocol: 'http' as ProxyProtocol,
  host: '',
  port: '',
  username: '',
  password: '',
  region: '',
  expire_at: ''
});

function resetCreateForm() {
  showEditModal.value = null;
  actionError.value = '';
  createForm.value = { name: '', protocol: 'http', host: '', port: '', username: '', password: '', region: '', expire_at: '' };
}

async function loadProxies() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await proxiesAPI.list(page.value, pageSize.value, {
      search: search.value || undefined,
      protocol: protocolFilter.value || undefined,
      status: statusFilter.value as any || undefined
    });
    if (version !== loadVersion) return;
    proxies.value = result?.items || [];
    selectedIds.value = new Set([...selectedIds.value].filter(id => proxies.value.some(proxy => proxy.id === id)));
    total.value = result?.total || 0;
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '代理列表加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function openEdit(proxy: Proxy) {
  resetCreateForm();
  showEditModal.value = proxy;
  createForm.value = { name: proxy.name, protocol: proxy.protocol, host: proxy.host,
    port: String(proxy.port), username: proxy.username || '', password: '',
    region: proxy.region || '', expire_at: proxy.expires_at ? new Date(new Date(proxy.expires_at).getTime() - new Date(proxy.expires_at).getTimezoneOffset() * 60000).toISOString().slice(0,16) : '' };
  showCreateModal.value = true;
}
async function handleCreate() {
  if (saving.value) return;
  if (!createForm.value.host.trim() || !Number.isInteger(Number(createForm.value.port)) || Number(createForm.value.port) < 1 || Number(createForm.value.port) > 65535) {
    actionError.value = '请填写代理地址及 1–65535 之间的端口。'; return;
  }
  saving.value = true;
  try {
    const payload: CreateProxyRequest = {
      name: createForm.value.name,
      protocol: createForm.value.protocol,
      host: createForm.value.host,
      port: parseInt(createForm.value.port) || 0,
      username: createForm.value.username || undefined,
      password: createForm.value.password || undefined,
      expires_at: createForm.value.expire_at ? Math.floor(new Date(createForm.value.expire_at).getTime() / 1000) : null
    };
    if (showEditModal.value) await proxiesAPI.update(showEditModal.value.id, payload);
    else await proxiesAPI.create(payload);
    showCreateModal.value = false;
    resetCreateForm();
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '保存代理失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

function parseProxyLine(line: string, defaultProtocol = 'http') {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes('://') || trimmed.startsWith('[')) {
      const url = new URL(trimmed.includes('://') ? trimmed : `${defaultProtocol}://${trimmed}`);
      const protocol = url.protocol.slice(0, -1);
      if (!['http', 'https', 'socks5', 'socks5h'].includes(protocol) || url.pathname !== '/' && url.pathname !== '' || url.search || url.hash) return null;
      const port = url.port ? Number(url.port) : protocol === 'https' ? 443 : protocol === 'http' ? 80 : 1080;
      if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
      return { name: `${url.hostname}:${port}`, protocol, host: url.hostname.replace(/^\[|\]$/g, ''), port,
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined };
    }
    const parts = trimmed.split(':');
    if (parts.length !== 2 && parts.length < 4) return null;
    const port = Number(parts[1]);
    if (!parts[0] || !/^\d+$/.test(parts[1]) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { name: `${parts[0]}:${port}`, protocol: defaultProtocol, host: parts[0], port,
      username: parts.length >= 4 ? parts[2] : undefined, password: parts.length >= 4 ? parts.slice(3).join(':') : undefined };
  } catch { return null; }
}

async function handleBatchCreateSubmit() {
  if (isBatchCreating.value) return;
  const lines = batchProxiesText.value.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return;
  const list: any[] = [];
  for (const l of lines) {
    const p = parseProxyLine(l, batchDefaultProtocol.value);
    if (p) list.push(p);
  }
  if (list.length !== lines.length) { actionError.value = `有 ${lines.length - list.length} 行无法识别，请修正后重新提交。`; return; }
  isBatchCreating.value = true;
  try {
    await proxiesAPI.batchCreate(list);
    showBatchModal.value = false;
    batchProxiesText.value = '';
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '批量添加代理失败，请重试。');
  } finally {
    isBatchCreating.value = false;
  }
}

const showBatchDeleteAlert = ref(false);
const isBatchDeleting = ref(false);

function handleBatchDelete() {
  if (selectedIds.value.size === 0) return;
  showBatchDeleteAlert.value = true;
}

async function confirmBatchDelete() {
  if (isBatchDeleting.value || !selectedIds.value.size) return;
  isBatchDeleting.value = true;
  try {
    actionError.value = '';
    batchDeleteResult.value = await proxiesAPI.batchDelete(Array.from(selectedIds.value));
    selectedIds.value = new Set(batchDeleteResult.value.skipped.map(item => item.id));
    showBatchDeleteAlert.value = false;
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '批量删除失败，请重试。');
  } finally {
    isBatchDeleting.value = false;
  }
}

function closeAccountsModal() {
  accountsVersion++;
  showAccountsModal.value = false;
  proxyAccounts.value = [];
  accountsError.value = '';
  loadingAccounts.value = false;
}
async function openAccountsModal(proxy: Proxy) {
  const version = ++accountsVersion;
  accountsProxy.value = proxy;
  showAccountsModal.value = true;
  proxyAccounts.value = [];
  accountsError.value = '';
  loadingAccounts.value = true;
  const current = () => version === accountsVersion && showAccountsModal.value && accountsProxy.value?.id === proxy.id;
  try {
    const result = await proxiesAPI.getProxyAccounts(proxy.id);
    if (current()) proxyAccounts.value = result;
  } catch (err) {
    if (current()) accountsError.value = adminError(err, '关联账号加载失败，请重试。');
  } finally {
    if (current()) loadingAccounts.value = false;
  }
}

async function handleCheckQuality(proxy: Proxy) {
  qualityProxy.value = proxy;
  qualityResult.value = null;
  showQualityModal.value = true;
  isCheckingQuality.value = true;
  try {
    qualityResult.value = await proxiesAPI.checkProxyQuality(proxy.id);
  } catch (err) {
    actionError.value = adminError(err, '代理质量检测失败，请重试。');
  } finally {
    isCheckingQuality.value = false;
  }
}

async function handleDelete(proxy: Proxy) {
  if (deleting.value) return;
  deleting.value = true;
  try {
    await proxiesAPI.delete(proxy.id);
    showDeleteConfirm.value = null;
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '删除代理失败，请重试。');
  } finally {
    deleting.value = false;
  }
}

async function handleTestProxy(proxy: Proxy) {
  if (testingProxy.value != null) return;
  testingProxy.value = proxy.id;
  testResult.value = '';
  actionError.value = '';
  try {
    const result = await proxiesAPI.testProxy(proxy.id);
    if (!result.success) { actionError.value = result.message || '代理连接测试未通过。'; return; }
    testResult.value = `「${proxy.name}」连接成功${result.latency_ms == null ? '' : ` · ${result.latency_ms} ms`}`;
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '代理测试失败，请重试。');
  } finally { testingProxy.value = null; }
}

async function toggleStatus(proxy: Proxy) {
  try {
    await proxiesAPI.toggleStatus(proxy.id, proxy.status === 'active' ? 'inactive' : 'active');
    await loadProxies();
  } catch (err) {
    actionError.value = adminError(err, '代理状态更新失败，请重试。');
  }
}

function fmtDate(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('zh-CN', { hour12: false }); }
  catch { return s; }
}

function statusBadge(status?: string) {
  if (status === 'active') return { text: '启用', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' };
  if (status === 'inactive') return { text: '禁用', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
  if (status === 'expired') return { text: '过期', cls: 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' };
  return { text: status || '未知', cls: 'bg-gray-100 text-gray-500' };
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

onMounted(() => loadProxies());
</script>

<template>
  <div class="admin-polish proxies-app h-full flex flex-col select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-2.5">
        <img :src="getAppIcon('proxies')" class="w-7 h-7 drop-shadow-sm shrink-0" alt="Proxies" />
        <span class="text-xs font-semibold text-gray-900 dark:text-gray-100">IP管理</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 font-mono">{{ total }}</span>
      </div>
    </div>

    <!-- Filters & Actions -->
    <div class="admin-filters">
      <input v-model="search" @keyup.enter="loadProxies()" type="text" placeholder="搜索代理..." class="text-xs px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e] focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-48" />
      <select v-model="protocolFilter" @change="loadProxies()" class="text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e]">
        <option value="">全部协议</option>
        <option value="http">HTTP</option>
        <option value="https">HTTPS</option>
        <option value="socks5">SOCKS5</option>
      </select>
      <select v-model="statusFilter" @change="loadProxies()" class="text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e]">
        <option value="">全部状态</option>
        <option value="active">启用</option>
        <option value="inactive">禁用</option>
        <option value="expired">过期</option>
      </select>
      <div class="flex-1"></div>
      <MacButton size="sm" @click="loadProxies()">
        <svg class="w-3.5 h-3.5 mr-1" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        刷新
      </MacButton>
      <MacButton size="sm" variant="default" @click="showBatchModal = true; batchProxiesText = ''">
        批量添加
      </MacButton>
      <MacButton v-if="selectedIds.size > 0" size="sm" variant="destructive" @click="handleBatchDelete">
        批量删除 ({{ selectedIds.size }})
      </MacButton>
      <MacButton size="sm" variant="primary" @click="showCreateModal = true; resetCreateForm()">
        <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        添加代理
      </MacButton>
    </div>

    <!-- Table -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="IP 管理" @retry="loadProxies" @dismiss="actionError = ''" />
    <div class="admin-table-scroll">
      <table v-if="proxies.length > 0" class="admin-table" style="min-width: 1100px">
        <thead class="sticky top-0 z-10">
          <tr class="bg-gray-50/90 dark:bg-[#2a2a2c]/90 backdrop-blur-sm border-b border-black/[0.06] dark:border-white/[0.08]">
            <th class="text-left px-4 py-2.5 font-medium text-gray-500 w-8">
              <input
                type="checkbox"
                aria-label="选择本页全部代理"
                :disabled="loading || isBatchDeleting"
                :checked="proxies.length > 0 && selectedIds.size === proxies.length"
                @change="selectedIds.size === proxies.length ? selectedIds.clear() : proxies.forEach(p => selectedIds.add(p.id))"
                class="rounded"
              />
            </th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">名称</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">协议</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">地址</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">认证</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">地理位置</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">账号数</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">延迟</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">有效期</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">创建时间</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">状态</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="proxy in proxies" :key="proxy.id"
              class="border-b border-black/[0.04] dark:border-white/[0.04] hover:bg-gray-50 dark:hover:bg-[#2c2c2e] transition-colors">
            <td class="px-4 py-2"><input type="checkbox" :checked="selectedIds.has(proxy.id)" @change="selectedIds.has(proxy.id) ? selectedIds.delete(proxy.id) : selectedIds.add(proxy.id)" class="rounded" /></td>
            <td class="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{{ proxy.name || '—' }}</td>
            <td class="px-3 py-2"><span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 text-[10px] uppercase font-medium">{{ proxy.protocol || 'http' }}</span></td>
            <td class="px-3 py-2 font-mono text-gray-600 dark:text-gray-400">{{ proxy.host }}:{{ proxy.port }}</td>
            <td class="px-3 py-2 text-gray-500">{{ proxy.username ? '●●●●' : '无' }}</td>
            <td class="px-3 py-2 text-gray-500">{{ proxy.region || '—' }}</td>
            <td class="px-3 py-2 text-gray-500">
              <button
                type="button"
                class="hover:underline font-mono"
                :class="(proxy as any).account_count ? 'text-[#007aff] font-semibold' : 'text-gray-400'"
                @click="openAccountsModal(proxy)"
              >
                {{ (proxy as any).account_count ?? 0 }}
              </button>
            </td>
            <td class="px-3 py-2 text-gray-500">{{ (proxy as any).latency_ms != null ? (proxy as any).latency_ms + ' ms' : '—' }}</td>
            <td class="px-3 py-2 text-gray-500">{{ fmtDate(proxy.expires_at) }}</td>
            <td class="px-3 py-2 text-gray-500">{{ fmtDate(proxy.created_at) }}</td>
            <td class="px-3 py-2">
              <span class="admin-status" :data-tone="proxy.status === 'active' ? 'success' : proxy.status === 'inactive' ? 'neutral' : 'warning'">{{ statusBadge(proxy.status).text }}</span>
            </td>
            <td class="px-3 py-2">
              <div class="flex items-center gap-1.5">
                <button @click="openEdit(proxy)" class="admin-row-link">编辑</button>
                <button :disabled="testingProxy != null" @click="handleTestProxy(proxy)" class="text-[10px] text-blue-500 hover:underline">测试</button>
                <button @click="handleCheckQuality(proxy)" class="admin-row-link">体检</button>
                <button @click="openAccountsModal(proxy)" class="admin-row-link">账号</button>
                <button @click="toggleStatus(proxy)" class="text-[10px] text-amber-500 hover:underline">{{ proxy.status === 'active' ? '禁用' : '启用' }}</button>
                <button @click="showDeleteConfirm = proxy" class="admin-row-danger">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty State -->
      <div v-else-if="!loading && !loadError" class="admin-state flex flex-col items-center justify-center">
        <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
          </svg>
        </div>
        <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">{{ search || protocolFilter || statusFilter ? '没有匹配的代理' : '还没有代理' }}</h3>
        <p class="text-xs text-gray-500 mb-4">添加您的第一个代理以开始使用。</p>
        <MacButton size="sm" variant="primary" @click="showCreateModal = true; resetCreateForm()">
          <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          添加代理
        </MacButton>
      </div>

      <!-- Loading Spinner -->
      <div v-else-if="loading" class="flex items-center justify-center py-20" aria-hidden="true">
        <div class="w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    </div>

    <p v-if="testResult" role="status" class="admin-footer">{{ testResult }}</p>
    <section v-if="batchDeleteResult" data-testid="proxy-batch-delete-result" class="px-4 py-3 text-xs max-h-40 overflow-auto shrink-0" aria-label="批量删除结果">
      <p role="status">已删除 {{ batchDeleteResult.deleted_ids.length }} 个，跳过 {{ batchDeleteResult.skipped.length }} 个。</p>
      <ul class="break-words"><li v-for="item in batchDeleteResult.skipped" :key="item.id">代理 #{{ item.id }}：{{ item.reason }}</li></ul>
      <MacButton size="sm" @click="batchDeleteResult = null">收起结果</MacButton>
    </section>
    <!-- Pagination -->
    <div v-if="total > 0" class="admin-footer">
      <span>共 {{ total }} 条</span>
      <div class="flex items-center gap-1.5">
        <button @click="page > 1 && (page--, loadProxies())" :disabled="loading || page <= 1" class="px-2 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-30">上一页</button>
        <span class="px-2">{{ page }} / {{ totalPages }}</span>
        <button @click="page < totalPages && (page++, loadProxies())" :disabled="loading || page >= totalPages" class="px-2 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-30">下一页</button>
      </div>
    </div>

    <!-- Create Modal -->
    <MacSheet v-slot="{ close }" protect-changes :show="showCreateModal" :title="showEditModal ? '编辑代理' : '添加代理'" :loading="saving" @close="!saving && (showCreateModal = false)">
          <p v-if="actionError" role="alert" class="admin-form-error mb-3">{{ actionError }}</p>
          <p v-if="showEditModal" class="text-xs text-[var(--text-secondary)] mb-3">密码留空保留原有密码。</p>
          <div class="space-y-3 text-xs">
            <div><label class="block text-gray-500 mb-1">名称</label><input v-model="createForm.name" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
            <div><label class="block text-gray-500 mb-1">协议</label>
              <select v-model="createForm.protocol" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]">
                <option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option>
              </select>
            </div>
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <div><label class="block text-gray-500 mb-1">地址</label><input v-model="createForm.host" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
              <div><label class="block text-gray-500 mb-1">端口</label><input v-model="createForm.port" class="w-24 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div><label class="block text-gray-500 mb-1">用户名</label><input v-model="createForm.username" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
              <div><label class="block text-gray-500 mb-1">密码</label><input v-model="createForm.password" type="password" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
            </div>
            <div><label class="block text-gray-500 mb-1">有效期</label><input v-model="createForm.expire_at" type="datetime-local" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" /></div>
          </div>
          <div class="flex justify-end gap-2 mt-5">
            <MacButton size="sm" :disabled="saving" @click="close">取消</MacButton>
            <MacButton size="sm" variant="primary" :loading="saving" @click="handleCreate">{{ showEditModal ? '保存' : '创建' }}</MacButton>
          </div>
    </MacSheet>

    <!-- Delete Confirm -->
    <Teleport to="body">
      <div v-if="showDeleteConfirm" class="fixed inset-0 z-[9999] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="showDeleteConfirm = null"></div>
        <div class="admin-dialog relative rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 w-[360px] p-5">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-white mb-2">删除代理</h3>
          <p class="text-xs text-gray-500 mb-4">确定要删除代理「{{ showDeleteConfirm?.name }}」吗？此操作不可撤销。</p>
          <div class="flex justify-end gap-2">
            <MacButton size="sm" @click="showDeleteConfirm = null">取消</MacButton>
            <MacButton size="sm" variant="destructive" :loading="deleting" @click="handleDelete(showDeleteConfirm!)">删除</MacButton>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Batch Add Proxies Modal -->
    <Teleport to="body">
      <div v-if="showBatchModal" class="fixed inset-0 z-[9999] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="showBatchModal = false"></div>
        <div class="admin-dialog relative rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 w-[520px] max-h-[85vh] overflow-y-auto p-5 space-y-4">
          <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-white">批量添加代理节点</h3>
            <button class="text-xs text-gray-400 hover:text-gray-600" @click="showBatchModal = false">✕</button>
          </div>

          <div class="space-y-3 text-xs">
            <div class="flex items-center justify-between">
              <label class="font-medium text-gray-700 dark:text-gray-300">默认协议</label>
              <select v-model="batchDefaultProtocol" class="px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]">
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </select>
            </div>

            <div>
              <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">
                代理列表 (每行一个)
              </label>
              <textarea
                v-model="batchProxiesText"
                rows="8"
                placeholder="支持以下格式：&#10;http://user:pass@1.2.3.4:8080&#10;socks5://1.2.3.4:1080&#10;1.2.3.4:8080:user:pass&#10;1.2.3.4:8080"
                class="w-full p-2.5 font-mono text-xs rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c] focus:outline-none"
              ></textarea>
              <div class="text-[11px] text-gray-400 mt-1">自动识别 URL 认证格式与冒号分隔格式。</div>
            </div>
          </div>

          <div class="flex justify-end gap-2 pt-2 border-t border-black/10 dark:border-white/10">
            <MacButton size="sm" @click="showBatchModal = false">取消</MacButton>
            <MacButton size="sm" variant="primary" :loading="isBatchCreating" @click="handleBatchCreateSubmit">
              批量创建
            </MacButton>
          </div>
        </div>
      </div>
    </Teleport>

    <MacSheet data-testid="proxy-accounts" :show="showAccountsModal" :title="`关联账号 · ${accountsProxy?.name || accountsProxy?.host || ''}`" @close="closeAccountsModal">
      <p v-if="loadingAccounts" role="status">正在加载关联账号…</p>
      <div v-else-if="accountsError" role="alert">
        <p class="admin-form-error">{{ accountsError }}</p>
        <MacButton size="sm" @click="accountsProxy && openAccountsModal(accountsProxy)">重试</MacButton>
      </div>
      <p v-else-if="!proxyAccounts.length" class="admin-state">该代理暂未绑定任何账号</p>
      <ul v-else class="divide-y divide-black/5 dark:divide-white/5">
        <li v-for="acc in proxyAccounts" :key="acc.id" class="py-2 text-xs break-words">
          <strong>{{ acc.name }}</strong><div>{{ acc.platform }} · {{ acc.type }} · #{{ acc.id }}</div>
        </li>
      </ul>
      <template #footer><MacButton size="sm" @click="closeAccountsModal">关闭</MacButton></template>
    </MacSheet>

    <!-- Quality Diagnostic Modal -->
    <Teleport to="body">
      <div v-if="showQualityModal" class="fixed inset-0 z-[9999] flex items-center justify-center">
        <div class="absolute inset-0 bg-black/30 backdrop-blur-sm" @click="showQualityModal = false"></div>
        <div class="admin-dialog relative rounded-2xl shadow-2xl border border-black/10 dark:border-white/10 w-[420px] p-5 space-y-4">
          <div class="flex items-center justify-between border-b border-black/10 dark:border-white/10 pb-3">
            <div class="flex items-center gap-2">
              <span class="text-base">🩺</span>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">代理质量体检报告</h3>
            </div>
            <button class="text-xs text-gray-400 hover:text-gray-600" @click="showQualityModal = false">✕</button>
          </div>

          <div v-if="isCheckingQuality" class="py-8 text-center space-y-2">
            <div class="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div class="text-xs text-gray-400">正在探测延迟与出口 IP 质量...</div>
          </div>
          <div v-else-if="qualityResult" class="space-y-3 text-xs">
            <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-2">
              <div class="flex justify-between items-center">
                <span class="text-gray-400">评分 / 等级</span>
                <span class="font-semibold text-sm" :class="qualityResult.score >= 80 ? 'text-emerald-500' : qualityResult.score >= 60 ? 'text-amber-500' : 'text-red-500'">
                  {{ qualityResult.score }}分 ({{ qualityResult.grade }})
                </span>
              </div>
              <div class="flex justify-between"><span class="text-gray-400">概括</span><span class="font-medium text-right max-w-[240px] truncate">{{ qualityResult.summary }}</span></div>
              <div class="flex justify-between"><span class="text-gray-400">基础延迟</span><span class="font-semibold text-emerald-600">{{ typeof qualityResult.base_latency_ms === 'number' ? qualityResult.base_latency_ms + ' ms' : '—' }}</span></div>
              <div class="flex justify-between"><span class="text-gray-400">出站 IP</span><span class="font-mono">{{ qualityResult.exit_ip || '—' }}</span></div>
              <div class="flex justify-between"><span class="text-gray-400">归属国家</span><span>{{ qualityResult.country || qualityResult.country_code || '—' }}</span></div>
            </div>

            <div v-if="qualityResult.items?.length" class="space-y-1.5 max-h-48 overflow-y-auto">
              <div class="text-[11px] font-semibold text-gray-500 dark:text-gray-400">目标测试诊断</div>
              <div v-for="item in qualityResult.items" :key="item.target" class="flex items-center justify-between p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 text-[11px]">
                <div class="flex items-center gap-2">
                  <span :class="item.status === 'pass' ? 'text-emerald-500' : item.status === 'warn' ? 'text-amber-500' : 'text-red-500'">●</span>
                  <span class="font-medium capitalize">{{ item.target.replace('_', ' ') }}</span>
                </div>
                <div class="flex items-center gap-2 text-gray-400 font-mono text-[10px]">
                  <span>{{ item.latency_ms ? item.latency_ms + 'ms' : '—' }}</span>
                  <span class="px-1.5 py-0.5 rounded text-[9px] uppercase font-semibold" :class="item.status === 'pass' ? 'bg-emerald-500/10 text-emerald-600' : item.status === 'warn' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'">{{ item.status }}</span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="py-6 text-center text-xs text-gray-400">
            体检失败，请检查代理是否在线
          </div>

          <div class="flex justify-end pt-2 border-t border-black/10 dark:border-white/10">
            <MacButton size="sm" @click="showQualityModal = false">完成</MacButton>
          </div>
        </div>
      </div>
    </Teleport>
    <!-- Native macOS Attached Alert Sheet for Batch Deletion -->
    <MacAlertSheet
      :show="showBatchDeleteAlert"
      title="确定要永久删除选中的代理节点吗？"
      :message="`已选择 ${selectedIds.size} 个代理节点。删除后绑定这些代理的账号将失去转发通道，此操作无法撤销。`"
      confirm-text="批量删除"
      cancel-text="取消"
      :danger="true"
      :loading="isBatchDeleting"
      @confirm="confirmBatchDelete"
      @cancel="showBatchDeleteAlert = false"
    />
  </div>
</template>

<style scoped>
.proxies-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
