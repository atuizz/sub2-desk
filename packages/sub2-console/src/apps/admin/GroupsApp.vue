<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacToggle, MacAlertSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import { adminError } from './admin-feedback';
import type { WindowInstance } from '@sub2-mac/core';
defineProps<{ win?: WindowInstance }>();
import * as groupsAPI from '../../api/admin/groups';
import type { GroupPlatform } from '@/types';
import type { PolicyGroup as AdminGroup, CreatePolicyGroup as CreateGroupRequest, UpdatePolicyGroup as UpdateGroupRequest } from '../../types/admin-policies';
import GroupPolicyEditor from './policies/GroupPolicyEditor.vue';
import CompositeRoutesEditor from './policies/CompositeRoutesEditor.vue';
const compositeGroup=ref<AdminGroup | null>(null);
const compositeSaving=ref(false);
import { copy, changedFields } from './policies/policy-contract';
const policyEditor = ref<InstanceType<typeof GroupPolicyEditor> | null>(null);
const basicBaseline = ref<CreateGroupRequest>({ name: '' });
const editLoading = ref(false);

// Data states
const groups = ref<AdminGroup[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const saving = ref(false);
const pendingDisable = ref<AdminGroup | null>(null);
const busyGroup = ref<number | null>(null);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
let loadVersion = 0;
let disposed = false;
onUnmounted(() => { disposed = true; loadVersion += 1; });

// Filters
const searchQuery = ref('');
const selectedPlatform = ref<string>('');
const selectedStatus = ref<string>('');
const selectedExclusive = ref<string>('');

// Modal states
const showCreateModal = ref(false);
const showEditModal = ref(false);
const showRateModal = ref(false);
const showRpmModal = ref(false);
const editingGroup = ref<AdminGroup | null>(null);

// Form models
const form = ref<CreateGroupRequest>({
  name: '',
  description: '',
  platform: 'anthropic',
  rate_multiplier: 1,
  is_exclusive: false,
  subscription_type: 'standard',
  rpm_limit: 0
});

const quickRate = ref(1);
const quickRpm = ref(0);
const actionTargetGroup = ref<AdminGroup | null>(null);

// Platform definitions
const platforms = [
  { value: 'anthropic', label: 'Anthropic', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  { value: 'openai', label: 'OpenAI', color: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
  { value: 'gemini', label: 'Gemini', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  { value: 'antigravity', label: 'Antigravity', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  { value: 'grok', label: 'Grok', color: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20' },
  { value: 'kimi', label: 'Kimi', color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' },
  { value: 'zhipu', label: '智谱', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  { value: 'deepseek', label: 'DeepSeek', color: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20' },
  { value: 'minimax', label: 'MiniMax', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  { value: 'composite', label: 'Composite', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' }
];

function getPlatformBadge(p: string) {
  const match = platforms.find(item => item.value === p);
  return match || { label: p, color: 'bg-blue-500/10 text-blue-600 border-blue-500/20' };
}

async function loadGroups() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const filters: any = {};
    if (selectedPlatform.value) filters.platform = selectedPlatform.value as GroupPlatform;
    if (selectedStatus.value) filters.status = selectedStatus.value as 'active' | 'inactive';
    if (selectedExclusive.value) filters.is_exclusive = selectedExclusive.value === 'true';
    if (searchQuery.value) filters.search = searchQuery.value;

    const res = await groupsAPI.list(page.value, pageSize.value, filters);
    if (version !== loadVersion) return;
    if (res && res.items) {
      groups.value = res.items;
      total.value = res.total ?? res.items.length;
    } else {
      groups.value = [];
      total.value = 0;
    }
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '分组加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function handleToggleStatus(group: AdminGroup) {
  if (busyGroup.value != null) return;
  if (group.status === 'active') pendingDisable.value = group;
  else void applyGroupStatus(group, 'active');
}
async function applyGroupStatus(group: AdminGroup, status: 'active' | 'inactive') {
  if (busyGroup.value != null) return;
  busyGroup.value = group.id;
  try { await groupsAPI.toggleStatus(group.id, status); group.status = status; pendingDisable.value = null; }
  catch (err) { actionError.value = adminError(err, '分组状态更新失败，请重试。'); }
  finally { busyGroup.value = null; }
}

async function handleDuplicate(group: AdminGroup) {
  if (busyGroup.value != null) return;
  busyGroup.value = group.id;
  try {
    await groupsAPI.duplicate(group.id);
    await loadGroups();
  } catch (err) {
    actionError.value = adminError(err, '复制分组失败，请重试。');
  } finally { busyGroup.value = null; }
}

const groupToDelete = ref<AdminGroup | null>(null);
const showDeleteAlert = ref(false);
const isDeletingGroup = ref(false);

function promptDelete(group: AdminGroup) {
  groupToDelete.value = group;
  showDeleteAlert.value = true;
}

async function confirmDeleteGroup() {
  if (!groupToDelete.value || isDeletingGroup.value) return;
  isDeletingGroup.value = true;
  try {
    await groupsAPI.deleteGroup(groupToDelete.value.id);
    showDeleteAlert.value = false;
    groupToDelete.value = null;
    await loadGroups();
  } catch (err) {
    actionError.value = adminError(err, '删除分组失败，请重试。');
  } finally {
    isDeletingGroup.value = false;
  }
}

function openCreate() {
  if (editLoading.value) return;
  editingGroup.value = null;
  actionError.value = '';
  form.value = {
    name: '',
    description: '',
    platform: 'anthropic',
    rate_multiplier: 1,
    is_exclusive: false,
    subscription_type: 'standard',
    rpm_limit: 0
  };
  showCreateModal.value = true;
}

async function submitCreate() {
  if (!form.value.name.trim() || saving.value) return;
  saving.value = true;
  try {
    await groupsAPI.create({ ...form.value, ...policyEditor.value?.patch() });
    showCreateModal.value = false;
    await loadGroups();
  } catch (err) {
    actionError.value = adminError(err, '创建分组失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

async function openEdit(group: AdminGroup) {
  if (editLoading.value) return;
  editLoading.value = true;
  actionError.value = '';
  try {
    const detail = await groupsAPI.getById(group.id);
    if (disposed) return;
    if (detail.id !== group.id) throw new Error('分组详情不匹配，请重新读取。');
    editingGroup.value = detail;
    form.value = {
      name: detail.name, description: detail.description ?? '', platform: detail.platform,
      rate_multiplier: detail.rate_multiplier, is_exclusive: detail.is_exclusive,
      subscription_type: detail.subscription_type, rpm_limit: detail.rpm_limit ?? 0
    };
    basicBaseline.value = copy(form.value);
    showEditModal.value = true;
  } catch (err) { actionError.value = adminError(err, '分组详情读取失败，请重新打开编辑。'); }
  finally { editLoading.value = false; }
}

async function submitEdit() {
  if (!editingGroup.value || !form.value.name.trim() || saving.value) return;
  saving.value = true;
  try {
    const payload = { ...changedFields(basicBaseline.value, form.value), ...policyEditor.value?.patch() };
    if (Object.keys(payload).length) await groupsAPI.update(editingGroup.value.id, payload);
    showEditModal.value = false;
    await loadGroups();
  } catch (err) {
    actionError.value = adminError(err, '更新分组失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

function openQuickRate(group: AdminGroup) {
  actionTargetGroup.value = group;
  quickRate.value = group.rate_multiplier;
  showRateModal.value = true;
}

async function saveQuickRate() {
  if (!actionTargetGroup.value || saving.value) return;
  if (!Number.isFinite(quickRate.value) || quickRate.value < 0) { actionError.value = '倍率须为非负数字。'; return; }
  saving.value = true;
  try {
    await groupsAPI.update(actionTargetGroup.value.id, { rate_multiplier: quickRate.value });
    actionTargetGroup.value.rate_multiplier = quickRate.value;
    showRateModal.value = false;
  } catch (err) {
    actionError.value = adminError(err, '倍率保存失败，请重试。');
  } finally { saving.value = false; }
}

function openQuickRpm(group: AdminGroup) {
  actionTargetGroup.value = group;
  quickRpm.value = group.rpm_limit || 0;
  showRpmModal.value = true;
}

async function saveQuickRpm() {
  if (!actionTargetGroup.value || saving.value) return;
  if (!Number.isInteger(quickRpm.value) || quickRpm.value < 0) { actionError.value = 'RPM 须为非负整数。'; return; }
  saving.value = true;
  try {
    await groupsAPI.update(actionTargetGroup.value.id, { rpm_limit: quickRpm.value });
    actionTargetGroup.value.rpm_limit = quickRpm.value;
    showRpmModal.value = false;
  } catch (err) {
    actionError.value = adminError(err, 'RPM 保存失败，请重试。');
  } finally { saving.value = false; }
}

onMounted(() => {
  loadGroups();
});
</script>

<template>
  <div class="admin-polish flex flex-col h-full select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('groups')" alt="Groups" class="w-8 h-8 object-contain drop-shadow-sm" />
        <div>
          <h1 class="text-[17px] font-bold text-[var(--text-primary)] leading-tight">分组管理</h1>
          <p class="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">管理 API 密钥分组和费率配置</p>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <button
          class="p-1.5 rounded-[7px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)] transition-colors"
          :class="loading ? 'animate-spin' : ''"
          title="刷新"
          @click="loadGroups"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
        <button
          class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-all"
          @click="openCreate"
        >
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span>创建分组</span>
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="admin-filters">
      <div class="flex flex-wrap items-center gap-2.5">
        <!-- Search Input -->
        <div class="admin-filter-search relative w-56">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索分组..."
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
            aria-label="搜索分组，按回车应用"
            @keyup.enter="page = 1; loadGroups()"
          />
        </div>

        <!-- Platform Select -->
        <select
          v-model="selectedPlatform"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadGroups()"
          aria-label="分组平台"
        >
          <option value="">全部平台</option>
          <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
        </select>

        <!-- Status Select -->
        <select
          v-model="selectedStatus"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadGroups()"
          aria-label="分组状态"
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="inactive">禁用</option>
        </select>

        <!-- Exclusive Select -->
        <select
          v-model="selectedExclusive"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadGroups()"
          aria-label="分组访问范围"
        >
          <option value="">全部分组</option>
          <option value="false">公开</option>
          <option value="true">专属</option>
        </select>
      </div>
    </div>

    <!-- Table Container -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="分组管理" @retry="loadGroups" @dismiss="actionError = ''" />
    <div class="admin-table-scroll">
      <!-- Empty State -->
      <div v-if="!loading && !loadError && groups.length === 0" class="admin-state flex flex-col items-center justify-center">
        <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-500">
          <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">{{ searchQuery || selectedPlatform || selectedStatus || selectedExclusive ? '没有匹配的分组' : '还没有分组' }}</h3>
        <p class="text-xs text-[var(--text-tertiary)] max-w-xs leading-relaxed mb-4">
          创建第一个分组来管理账号和用户访问
        </p>
        <button
          class="px-4 py-1.5 rounded-[7px] text-xs font-medium bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-colors"
          @click="openCreate"
        >
          创建分组
        </button>
      </div>

      <!-- Data Table -->
      <table v-else-if="groups.length" class="admin-table">
        <thead>
          <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
            <th class="px-5 py-2.5">名称</th>
            <th class="px-4 py-2.5">平台</th>
            <th class="px-4 py-2.5">计费类型</th>
            <th class="px-3 py-2.5">费率倍数</th>
            <th class="px-3 py-2.5">类型</th>
            <th class="px-4 py-2.5">账号数</th>
            <th class="px-3 py-2.5">容量</th>
            <th class="px-3 py-2.5 text-center">状态</th>
            <th class="px-5 py-2.5 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
          <tr
            v-for="g in groups"
            :key="g.id"
            class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
          >
            <!-- Name -->
            <td class="px-5 py-3">
              <div class="flex items-center gap-1.5">
                <span class="font-medium text-[var(--text-primary)]">{{ g.name }}</span>
                <span class="text-[10px] font-mono text-[var(--text-tertiary)]">#{{ g.id }}</span>
              </div>
              <p v-if="g.description" class="text-[11px] text-[var(--text-tertiary)] mt-0.5 max-w-[200px] truncate">
                {{ g.description }}
              </p>
            </td>

            <!-- Platform -->
            <td class="px-4 py-3">
              <span
                class="admin-neutral-badge inline-flex items-center gap-1 px-2 py-0.5"
              >
                <span>{{ getPlatformBadge(g.platform).label }}</span>
              </span>
            </td>

            <!-- Billing Type -->
            <td class="px-4 py-3">
              <div class="flex flex-col gap-0.5">
                <span
                  class="inline-block w-fit px-2 py-0.5 rounded-full text-[10.5px] font-medium"
                  :class="g.subscription_type === 'subscription' ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-black/5 dark:bg-white/10 text-[var(--text-secondary)]'"
                >
                  {{ g.subscription_type === 'subscription' ? '订阅' : '标准 (余额)' }}
                </span>
                <div v-if="g.subscription_type === 'subscription'" class="text-[10px] text-[var(--text-tertiary)]">
                  <span v-if="g.daily_limit_usd">${{ g.daily_limit_usd }}/日</span>
                  <span v-if="g.weekly_limit_usd"> ${{ g.weekly_limit_usd }}/周</span>
                  <span v-if="g.monthly_limit_usd"> ${{ g.monthly_limit_usd }}/月</span>
                  <span v-if="!g.daily_limit_usd && !g.weekly_limit_usd && !g.monthly_limit_usd">无额度限制</span>
                </div>
              </div>
            </td>

            <!-- Rate Multiplier -->
            <td class="px-3 py-3 font-mono text-[var(--text-primary)]">
              {{ g.rate_multiplier }}x
            </td>

            <!-- Type -->
            <td class="px-3 py-3">
              <span
                class="px-2 py-0.5 rounded text-[11px] font-medium"
                :class="g.is_exclusive ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-black/5 dark:bg-white/10 text-[var(--text-secondary)]'"
              >
                {{ g.is_exclusive ? '专属' : '公开' }}
              </span>
            </td>

            <!-- Account Count -->
            <td class="px-4 py-3 text-[11.5px]">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
                  <span>可用:</span>
                  <span class="font-medium text-emerald-600 dark:text-emerald-400">{{ g.active_account_count ?? 0 }}</span>
                  <span>个账号</span>
                </div>
                <div class="flex items-center gap-1 text-[var(--text-tertiary)]">
                  <span>总量:</span>
                  <span class="font-medium text-[var(--text-primary)]">{{ g.account_count ?? 0 }}</span>
                  <span>个账号</span>
                </div>
              </div>
            </td>

            <!-- Capacity -->
            <td class="px-3 py-3 font-mono text-[11px] text-[var(--text-tertiary)]">
              —
            </td>

            <!-- Status Toggle -->
            <td class="px-3 py-3 text-center">
              <MacToggle
                :model-value="g.status === 'active'"
                @update:model-value="handleToggleStatus(g)"
              />
            </td>

            <!-- Actions -->
            <td class="px-5 py-3 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-2 text-xs">
                <button
                  class="text-[var(--accent)] hover:underline flex items-center gap-0.5"
                  title="编辑"
                  @click="openEdit(g)"
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  <span>编辑</span>
                </button>
                <button
                  class="text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-0.5"
                  title="复制"
                  @click="handleDuplicate(g)"
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  <span>复制</span>
                </button>
                <button
                  class="admin-row-link hover:underline flex items-center gap-0.5"
                  title="专属倍率"
                  @click="openQuickRate(g)"
                >
                  <span>专属倍率</span>
                </button>
                <button
                  class="admin-row-link hover:underline flex items-center gap-0.5"
                  title="专属 RPM"
                  @click="openQuickRpm(g)"
                >
                  <span>专属 RPM</span>
                </button>
                <button
                  class="admin-row-danger flex items-center gap-0.5"
                  title="删除"
                  @click="promptDelete(g)"
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  <span>删除</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Footer -->
    <div class="admin-footer">
      <span>共 {{ total }} 个分组 · 每页 {{ pageSize }} 项</span>
      <div class="flex items-center gap-2">
        <span>{{ page }} / {{ totalPages }}</span>
        <div class="inline-flex border border-[var(--border-color)] rounded-[6px] overflow-hidden">
          <button aria-label="上一页" @click="page--; loadGroups()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page <= 1">
            ‹
          </button>
          <button aria-label="下一页" @click="page++; loadGroups()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page >= totalPages">
            ›
          </button>
        </div>
      </div>
    </div>

    <!-- Create / Edit Modal -->
    <MacSheet v-if="showCreateModal || showEditModal" v-slot="{ close }" protect-changes :show="true" :title="showCreateModal ? '添加分组' : '编辑分组'" :loading="saving" @close="showCreateModal = false; showEditModal = false"><form class="p-5 flex flex-col gap-4 text-xs" @submit.prevent="showCreateModal ? submitCreate() : submitEdit()"><fieldset :disabled="saving" class="contents"><p v-if="actionError" role="alert" class="admin-form-error">{{ actionError }}</p>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">分组名称 *</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="请输入分组名称"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">描述</label>
            <textarea
              v-model="form.description"
              rows="2"
              placeholder="可选描述信息"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            ></textarea>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">平台</label>
              <select
                v-model="form.platform"
                class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              >
                <option v-for="p in platforms" :key="p.value" :value="p.value">{{ p.label }}</option>
              </select>
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">计费类型</label>
              <select
                v-model="form.subscription_type"
                class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="standard">标准 (余额)</option>
                <option value="subscription">订阅</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">费率倍数</label>
              <input
                v-model.number="form.rate_multiplier"
                type="number"
                step="0.01"
                min="0"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">RPM 限制 (0=不限)</label>
              <input
                v-model.number="form.rpm_limit"
                type="number"
                min="0"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
          </div>

          <div class="flex items-center justify-between p-2.5 rounded-[7px] border border-[var(--border-color)] bg-black/[0.01]">
            <div>
              <span class="font-medium text-[var(--text-primary)]">专属分组</span>
              <p class="text-[11px] text-[var(--text-tertiary)]">仅对分配了此分组权限的用户可见</p>
            </div>
            <MacToggle
              :model-value="Boolean(form.is_exclusive)"
              @update:model-value="val => form.is_exclusive = val"
            />
          </div>

          <button v-if="editingGroup?.platform==='composite'" type="button" class="text-[var(--accent)]" @click="compositeGroup=editingGroup">管理复合路由与预览</button>
          <GroupPolicyEditor ref="policyEditor" :group-id="editingGroup?.id" :source="editingGroup || {}" :platform="form.platform" :creating="showCreateModal" />
          <div class="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-[var(--border-color)]">
            <button
              type="button"
              class="px-4 py-1.5 rounded-[6px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)]"
              @click="close"
            >
              取消
            </button>
            <button
              type="submit"
              :disabled="saving"
              class="px-4 py-1.5 rounded-[6px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium"
            >
              {{ showCreateModal ? '创建' : '保存' }}
            </button>
          </div>
        </fieldset></form></MacSheet>

    <MacSheet v-if="compositeGroup" :show="true" :title="'复合路由 · ' + compositeGroup.name" :loading="compositeSaving" @close="!compositeSaving && (compositeGroup=null)">
      <CompositeRoutesEditor :key="compositeGroup.id" :group-id="compositeGroup.id" @busy="compositeSaving=$event" />
    </MacSheet>
    <!-- Quick Rate Modal -->
    <MacSheet v-if="showRateModal" v-slot="{ close }" :dirty="quickRate !== actionTargetGroup?.rate_multiplier" :show="true" title="修改分组倍率" :loading="saving" @close="showRateModal = false"><p class="text-[11px] text-[var(--text-tertiary)] mb-4">设置分组 {{ actionTargetGroup?.name }} 的基准费率倍数</p><div class="flex items-center gap-2 mb-4">
          <input
            v-model.number="quickRate"
            type="number"
            step="0.05"
            min="0"
            class="flex-1 px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-sm"
          />
          <span class="text-sm font-semibold">x</span>
        </div><div class="flex items-center justify-end gap-2">
          <button class="px-3.5 py-1 rounded-[6px] border border-[var(--border-color)] text-xs" @click="close">取消</button>
          <button class="px-3.5 py-1 rounded-[6px] bg-[var(--accent)] text-white text-xs font-medium" @click="saveQuickRate">保存</button>
        </div></MacSheet>

    <!-- Quick RPM Modal -->
    <MacSheet v-if="showRpmModal" v-slot="{ close }" :dirty="quickRpm !== (actionTargetGroup?.rpm_limit || 0)" :show="true" title="修改分组 RPM" :loading="saving" @close="showRpmModal = false"><p class="text-[11px] text-[var(--text-tertiary)] mb-4">设置分组 {{ actionTargetGroup?.name }} 的全局请求速率上限 (0 表示无限制)</p><div class="flex items-center gap-2 mb-4">
          <input
            v-model.number="quickRpm"
            type="number"
            min="0"
            class="flex-1 px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-sm"
          />
          <span class="text-xs text-[var(--text-secondary)]">RPM</span>
        </div><div class="flex items-center justify-end gap-2">
          <button class="px-3.5 py-1 rounded-[6px] border border-[var(--border-color)] text-xs" @click="close">取消</button>
          <button class="px-3.5 py-1 rounded-[6px] bg-[var(--accent)] text-white text-xs font-medium" @click="saveQuickRpm">保存</button>
        </div></MacSheet>

    <!-- Native macOS Attached Alert Sheet for Group Deletion -->
    <MacAlertSheet :show="!!pendingDisable" title="停用分组？" :message="`「${pendingDisable?.name || ''}」停用后将影响关联用户的请求。`" danger :loading="busyGroup != null" confirm-text="停用分组" @confirm="pendingDisable && applyGroupStatus(pendingDisable, 'inactive')" @cancel="busyGroup == null && (pendingDisable = null)" />
    <MacAlertSheet
      :show="showDeleteAlert"
      title="确定要永久删除此分组吗？"
      :message="`分组名称: ${groupToDelete?.name} (#${groupToDelete?.id})。删除后绑定在此分组下的模型路由将被撤销，且此操作无法撤销。`"
      confirm-text="删除分组"
      cancel-text="取消"
      :danger="true"
      :loading="isDeletingGroup"
      @confirm="confirmDeleteGroup"
      @cancel="!isDeletingGroup && (showDeleteAlert = false, groupToDelete = null)"
    />
  </div>
</template>
