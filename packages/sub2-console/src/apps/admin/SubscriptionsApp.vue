<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, shallowRef, computed, onMounted, onUnmounted, watch } from 'vue';
import { MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import { adminError, collectAdminPages } from './admin-feedback';
import type { WindowInstance } from '@sub2-mac/core';
defineProps<{ win?: WindowInstance }>();
import * as subsAPI from '../../api/admin/subscriptions';
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
    const filters: any = {};
    if (statusFilter.value) filters.status = statusFilter.value;
    if (groupFilter.value) filters.group_id = Number(groupFilter.value);
    if (platformFilter.value) filters.platform = platformFilter.value;
    if (searchQuery.value) filters.user_id = Number(searchQuery.value);

    const res = await subsAPI.list(page.value, pageSize.value, filters);
    if (version !== loadVersion) return;
    if (res && res.items) {
      subscriptions.value = res.items;
      total.value = res.total ?? res.items.length;
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
  showAssignModal.value = true;
}

async function submitAssign() {
  if (saving.value) return;
  if (!auxReady.value || !users.value.length || !groups.value.length) { actionError.value = '请先加载可用用户和分组。'; return; }
  if (!Number.isInteger(assignForm.value.expires_in_days) || assignForm.value.expires_in_days < 1) { actionError.value = '有效期须为正整数天。'; return; }
  actionError.value = '';
  saving.value = true;
  try {
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
          <h1 class="text-[17px] font-bold text-[var(--text-primary)] leading-tight">订阅管理</h1>
          <p class="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">管理用户订阅和配额限制</p>
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
      <table v-else-if="subscriptions.length" class="admin-table">
        <thead>
          <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
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
          <div>
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
            <button type="submit" :disabled="saving || !auxReady" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white font-medium">确认分配</button>
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
  </div>
</template>
