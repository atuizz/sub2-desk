<script setup lang="ts">
import ChannelFeaturesEditor from './policies/ChannelFeaturesEditor.vue';
import PricingPolicyEditor from './policies/PricingPolicyEditor.vue';
import AccountStatsPolicyEditor from './policies/AccountStatsPolicyEditor.vue';
import { copy, changedFields, validatePricing } from './policies/policy-contract';
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacSheet, MacButton, MacToggle, MacAlertSheet, type TableColumn } from '@sub2-mac/core';
import * as channelsAPI from '../../api/admin/channels';
import type { Channel } from '../../api/admin/channels';
import { groupsAPI } from '../../api/admin/groups';
import { channelMonitorAPI, type ChannelMonitor, type Provider } from '../../api/admin/channelMonitor';
import type { AdminGroup } from '@/types';
import AdminFeedback from './AdminFeedback.vue';
import { adminError, collectAdminPages } from './admin-feedback';

const props = defineProps<{
  win?: WindowInstance;
}>();

const channels = ref<Channel[]>([]);
const groups = ref<AdminGroup[]>([]);
const isLoading = ref(false);
const channelError = ref('');
const monitorError = ref('');
const groupsError = ref('');
const formError = ref('');
const deletingMonitor = ref(false);
const busyChannelIds = ref<number[]>([]);
const busyMonitorIds = ref<number[]>([]);
const mappingTouched = ref(false);
const mappingRows = ref<{ platform: string; source: string; target: string }[]>([]);
let disposed = false;
onUnmounted(() => { disposed = true; channelVersion++; });
const channelPage = ref(1);
const channelTotal = ref(0);
const channelPages = computed(() => Math.max(1, Math.ceil(channelTotal.value / 20)));
const channelToDisable = ref<Channel | null>(null);
const channelToDelete = ref<Channel | null>(null);
const deletingChannel = ref(false);
let channelVersion = 0;
const searchQuery = ref('');
const statusFilter = ref('');
const activeSubTab = ref<'pricing' | 'monitor'>(props.win?.customData?.tab === 'monitor' ? 'monitor' : 'pricing');
watch(() => props.win?.customData?.tab, tab => {
  if (tab !== 'pricing' && tab !== 'monitor' || tab === activeSubTab.value) return;
  activeSubTab.value = tab;
  if (tab === 'monitor') void loadMonitors(); else void loadChannels();
});

// ==================== Monitor State ====================
const monitors = ref<ChannelMonitor[]>([]);
const isMonitorsLoading = ref(false);
const monitorSearch = ref('');
const monitorProvider = ref('');
const monitorCheckMode = ref('');
const showMonitorSheet = ref(false);
const isSavingMonitor = ref(false);
const testingMonitorId = ref<number | null>(null);

const monitorForm = ref<{
  id?: number;
  name: string;
  provider: Provider;
  endpoint: string;
  api_key: string;
  primary_model: string;
  interval_seconds: number;
  check_mode: 'probe' | 'quota' | 'quota_probe';
  enabled: boolean;
  account_id: number | null;
}>({
  name: '',
  provider: 'openai',
  endpoint: '',
  api_key: '',
  primary_model: 'gpt-4o',
  interval_seconds: 300,
  check_mode: 'probe',
  enabled: true,
  account_id: null
});

const selectedChannel = ref<Channel | null>(null);
const showEditSheet = ref(false);
const isSaving = ref(false);

const toastMsg = ref<string | null>(null);
function showToast(msg: string) {
  toastMsg.value = msg;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2500);
}

const filteredChannels = computed(() => channels.value);

async function loadChannels() {
  const version = ++channelVersion;
  isLoading.value = true;
  channelError.value = '';
  try {
    const res = await channelsAPI.list(channelPage.value, 20, {
      status: statusFilter.value || undefined,
      search: searchQuery.value || undefined
    });
    if (version !== channelVersion) return;
    channels.value = res?.items || [];
    channelTotal.value = res?.total ?? channels.value.length;
    if (channelPage.value > channelPages.value) {
      channelPage.value = channelPages.value;
      await loadChannels();
    }
  } catch (err: any) {
    if (version === channelVersion) channelError.value = adminError(err, '渠道列表加载失败，请重试。');
  } finally {
    if (version === channelVersion) isLoading.value = false;
  }
}

async function loadGroups() {
  groupsError.value = '';
  try { groups.value = await groupsAPI.getAllIncludingInactive(); }
  catch (err) { groupsError.value = adminError(err, '分组加载失败，请重试后关联分组。'); }
}

function handleToggleStatus(channel: Channel) {
  if (busyChannelIds.value.includes(channel.id)) return;
  if (channel.status === 'active') channelToDisable.value = channel;
  else void applyChannelStatus(channel);
}
async function applyChannelStatus(channel: Channel) {
  if (busyChannelIds.value.includes(channel.id)) return;
  busyChannelIds.value.push(channel.id);
  const newStatus = channel.status === 'active' ? 'disabled' : 'active';
  try {
    await channelsAPI.update(channel.id, { status: newStatus as any });
    channel.status = newStatus as any;
    channelToDisable.value = null;
    showToast(newStatus === 'active' ? '渠道已启用' : '渠道已禁用');
  } catch (err: any) {
    showToast(adminError(err, '状态更新失败'));
  } finally { busyChannelIds.value = busyChannelIds.value.filter(id => id !== channel.id); }
}

const channelBaseline = ref<Channel | null>(null);
const detailLoading = ref(false);
async function openEdit(channel: Channel) {
  if (detailLoading.value) return;
  detailLoading.value = true;
  formError.value = '';
  try {
    const detail = await channelsAPI.getById(channel.id);
    if (disposed) return;
    if (detail.id !== channel.id) throw new Error('渠道详情不匹配，请重新读取。');
    mappingRows.value = Object.entries(detail.model_mapping || {}).flatMap(([platform, mappings]) =>
      Object.entries(mappings).map(([source, target]) => ({ platform, source, target })));
    mappingTouched.value = false;
    selectedChannel.value = copy(detail);
    channelBaseline.value = copy(detail);
    showEditSheet.value = true;
  } catch (err) { showToast(adminError(err, '渠道详情读取失败，请重试。')); }
  finally { detailLoading.value = false; }
}

function openCreate() {
  if (detailLoading.value) return;
  channelBaseline.value = null;
  mappingTouched.value = false;
  formError.value = '';
  mappingRows.value = [];
  selectedChannel.value = {
    id: 0,
    name: '',
    description: '',
    status: 'active' as any,
    billing_model_source: 'upstream' as any,
    restrict_models: false,
    group_ids: [],
    model_pricing: [],
    model_mapping: {},
    apply_pricing_to_account_stats: false,
    account_stats_pricing_rules: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  showEditSheet.value = true;
}

function addPricing() {
  selectedChannel.value?.model_pricing.push({ platform: 'openai', models: [], billing_mode: 'token',
    input_price: null, output_price: null, cache_write_price: null, cache_read_price: null,
    image_input_price: null, image_output_price: null, per_request_price: null, intervals: [], time_pricing: null });
}
async function saveChannel() {
  if (isSaving.value || !selectedChannel.value) return;
  const channel = selectedChannel.value;
  formError.value = '';
  if (!channel.name.trim()) { formError.value = '请输入渠道名称。'; return; }
  const mapping: Channel['model_mapping'] = {};
  for (const row of mappingRows.value) {
    const platform = row.platform.trim(), source = row.source.trim(), target = row.target.trim();
    if (!platform || !source || !target) { formError.value = '请填写完整的模型映射或移除空行。'; return; }
    if (['__proto__', 'constructor', 'prototype'].includes(platform) || ['__proto__', 'constructor', 'prototype'].includes(source)) {
      formError.value = '模型映射名称不合法。'; return;
    }
    mapping[platform] ||= {};
    if (Object.prototype.hasOwnProperty.call(mapping[platform], source)) { formError.value = '同一平台的来源模型不能重复。'; return; }
    mapping[platform][source] = target;
  }
  try {
    if (!channelBaseline.value || JSON.stringify(channel.account_stats_pricing_rules) !== JSON.stringify(channelBaseline.value.account_stats_pricing_rules)) {
      for (const rule of channel.account_stats_pricing_rules || []) {
        if (!rule.name.trim()) throw new Error('统计定价规则须填写名称。');
        for (const values of [rule.group_ids, rule.account_ids]) {
          if (values.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(values).size !== values.length) throw new Error('统计规则的分组与账号 ID 须为不重复的正整数。');
        }
        validatePricing(rule.pricing);
      }
    }
    if (!channelBaseline.value || JSON.stringify(channel.model_pricing) !== JSON.stringify(channelBaseline.value.model_pricing)) validatePricing(channel.model_pricing);
  } catch (err) { formError.value = adminError(err, '请检查定价配置。'); return; }
  isSaving.value = true;
  try {
    const payload: channelsAPI.CreateChannelRequest = {
      name: channel.name.trim(), description: channel.description,
      group_ids: groupsError.value ? undefined : channel.group_ids,
      billing_model_source: channel.billing_model_source, restrict_models: channel.restrict_models,
      model_pricing: channel.model_pricing, model_mapping: mappingTouched.value ? mapping : channel.model_mapping,
      apply_pricing_to_account_stats: channel.apply_pricing_to_account_stats,
      account_stats_pricing_rules: channel.account_stats_pricing_rules,
      features_config: channel.features_config
    };
    if (channel.id && channelBaseline.value) {
      const updates = changedFields(channelBaseline.value, { ...channelBaseline.value, ...payload, status: channel.status });
      if (Object.keys(updates).length) await channelsAPI.update(channel.id, updates);
    }
    else await channelsAPI.create(payload);
    showToast(channel.id ? '渠道更新成功' : '渠道创建成功');
    showEditSheet.value = false;
    await loadChannels();
  } catch (err) { formError.value = adminError(err, '保存渠道失败，请检查后重试。'); }
  finally { isSaving.value = false; }
}

async function deleteChannelItem(channel: Channel) {
  if (deletingChannel.value) return;
  deletingChannel.value = true;
  try {
    await channelsAPI.remove(channel.id);
    channelToDelete.value = null;
    showToast('渠道已删除');
    loadChannels();
  } catch (err: any) {
    showToast(adminError(err, '删除渠道失败'));
  } finally {
    deletingChannel.value = false;
  }
}

// ==================== Monitor Methods ====================
const filteredMonitors = computed(() => {
  let list = monitors.value;
  if (monitorProvider.value) {
    list = list.filter(m => m.provider === monitorProvider.value);
  }
  if (monitorCheckMode.value) {
    list = list.filter(m => m.check_mode === monitorCheckMode.value);
  }
  if (monitorSearch.value.trim()) {
    const q = monitorSearch.value.toLowerCase().trim();
    list = list.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.primary_model.toLowerCase().includes(q) ||
      m.endpoint.toLowerCase().includes(q)
    );
  }
  return list;
});

async function loadMonitors() {
  if (isMonitorsLoading.value) return;
  isMonitorsLoading.value = true;
  monitorError.value = '';
  try {
    monitors.value = await collectAdminPages((page, page_size) => channelMonitorAPI.list({ page, page_size }));
  } catch (err) {
    monitorError.value = adminError(err, '监控列表加载失败，请重试。');
  } finally {
    isMonitorsLoading.value = false;
  }
}

async function handleToggleMonitorEnabled(m: ChannelMonitor) {
  if (busyMonitorIds.value.includes(m.id)) return;
  busyMonitorIds.value.push(m.id);
  const newEnabled = !m.enabled;
  try {
    await channelMonitorAPI.update(m.id, { enabled: newEnabled });
    m.enabled = newEnabled;
    showToast(newEnabled ? '监控已启用' : '监控已暂停');
  } catch (err: any) {
    showToast(err.response?.data?.detail || '状态更新失败');
  } finally { busyMonitorIds.value = busyMonitorIds.value.filter(id => id !== m.id); }
}

async function handleTriggerCheck(m: ChannelMonitor) {
  if (testingMonitorId.value != null) return;
  testingMonitorId.value = m.id;
  try {
    await channelMonitorAPI.runNow(m.id);
    showToast('已触发探活请求，正在检测延迟与可用性...');
    setTimeout(() => {
      loadMonitors();
      testingMonitorId.value = null;
    }, 2000);
  } catch (err: any) {
    showToast(err.response?.data?.detail || '探活失败');
    testingMonitorId.value = null;
  }
}

function openCreateMonitor() {
  formError.value = '';
  monitorForm.value = {
    name: '',
    provider: 'openai',
    endpoint: '',
    api_key: '',
    primary_model: 'gpt-4o',
    interval_seconds: 300,
    check_mode: 'probe',
    enabled: true,
    account_id: null
  };
  showMonitorSheet.value = true;
}

function openEditMonitor(m: ChannelMonitor) {
  formError.value = '';
  monitorForm.value = {
    id: m.id,
    name: m.name,
    provider: m.provider,
    endpoint: m.endpoint,
    api_key: '',
    primary_model: m.primary_model,
    interval_seconds: m.interval_seconds,
    check_mode: m.check_mode,
    enabled: m.enabled,
    account_id: m.account_id
  };
  showMonitorSheet.value = true;
}

async function saveMonitor() {
  if (isSavingMonitor.value) return;
  const form = monitorForm.value;
  formError.value = '';
  if (form.provider === 'antigravity' && form.check_mode !== 'quota') { formError.value = 'Antigravity 仅支持配额检测。'; return; }
  if (form.check_mode !== 'probe' && (!Number.isInteger(form.account_id) || Number(form.account_id) < 1)) { formError.value = '配额检测请填写同平台的数据源账号 ID。'; return; }
  if (form.check_mode !== 'quota' && (!/^https?:\/\//i.test(form.endpoint.trim()) || !form.primary_model.trim() || (!form.id && !form.api_key.trim()))) { formError.value = '探活检测须填写有效端点、模型和 API Key。'; return; }
  if (!Number.isInteger(form.interval_seconds) || form.interval_seconds < 1) { formError.value = '检测周期须为正整数。'; return; }
  if (!monitorForm.value.name.trim()) {
    formError.value = '请输入监控名称。';
    return;
  }
  isSavingMonitor.value = true;
  try {
    if (monitorForm.value.id) {
      const payload: any = {
        name: monitorForm.value.name.trim(),
        provider: monitorForm.value.provider,
        endpoint: monitorForm.value.endpoint,
        primary_model: monitorForm.value.primary_model,
        interval_seconds: Number(monitorForm.value.interval_seconds) || 300,
        check_mode: monitorForm.value.check_mode,
        enabled: monitorForm.value.enabled,
        account_id: monitorForm.value.check_mode === 'probe' ? 0 : monitorForm.value.account_id
      };
      if (monitorForm.value.api_key) {
        payload.api_key = monitorForm.value.api_key;
      }
      await channelMonitorAPI.update(monitorForm.value.id, payload);
      showToast('监控配置已更新');
    } else {
      await channelMonitorAPI.create({
        name: monitorForm.value.name.trim(),
        provider: monitorForm.value.provider,
        endpoint: monitorForm.value.endpoint,
        api_key: monitorForm.value.api_key,
        primary_model: monitorForm.value.primary_model,
        interval_seconds: Number(monitorForm.value.interval_seconds) || 300,
        check_mode: monitorForm.value.check_mode,
        enabled: monitorForm.value.enabled,
        account_id: monitorForm.value.check_mode === 'probe' ? undefined : monitorForm.value.account_id
      });
      showToast('监控创建成功');
    }
    showMonitorSheet.value = false;
    loadMonitors();
  } catch (err: any) {
    formError.value = adminError(err, '保存监控失败，请重试。');
  } finally {
    isSavingMonitor.value = false;
  }
}

const monitorToDelete = ref<ChannelMonitor | null>(null);
const showDeleteMonitorSheet = ref(false);

function promptDeleteMonitor(m: ChannelMonitor) {
  monitorToDelete.value = m;
  showDeleteMonitorSheet.value = true;
}

async function confirmDeleteMonitor() {
  if (!monitorToDelete.value || deletingMonitor.value) return;
  deletingMonitor.value = true;
  try {
    await channelMonitorAPI.del(monitorToDelete.value.id);
    showToast('监控已删除');
    showDeleteMonitorSheet.value = false;
    monitorToDelete.value = null;
    loadMonitors();
  } catch (err: any) {
    showToast(adminError(err, '删除监控失败'));
  } finally { deletingMonitor.value = false; }
}

onMounted(() => {
  loadChannels();
  loadGroups();
  loadMonitors();
});
</script>

<template>
  <div class="admin-polish channels-app h-full flex flex-col select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-3">
          <img :src="getAppIcon('channels')" alt="Channels" class="w-8 h-8 object-contain drop-shadow-sm" />
          <div>
            <h2 class="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">渠道管理</h2>
            <p class="text-[11px] text-[var(--text-secondary)] mt-0.5">
              {{ activeSubTab === 'pricing' ? '渠道配置与关联分组' : '可用性、延迟与检测记录' }}
            </p>
          </div>
        </div>

        <!-- macOS Segmented Control -->
        <div class="admin-tabs">
          <button
            class="px-3 py-1 rounded-[7px] text-[12px] font-medium transition-all"
            :class="activeSubTab === 'pricing' ? 'bg-white dark:bg-[#323234] text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
            @click="activeSubTab = 'pricing'"
          >
            渠道配置
          </button>
          <button
            class="px-3 py-1 rounded-[7px] text-[12px] font-medium transition-all"
            :class="activeSubTab === 'monitor' ? 'bg-white dark:bg-[#323234] text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
            @click="activeSubTab = 'monitor'; loadMonitors()"
          >
            渠道监控
          </button>
        </div>
      </div>

      <!-- Actions (Refresh + Create) -->
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="h-8 px-3 rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium flex items-center gap-1.5 transition-colors"
          :disabled="isLoading || isMonitorsLoading"
          title="刷新"
          @click="activeSubTab === 'pricing' ? loadChannels() : loadMonitors()"
        >
          <span>刷新</span>
        </button>

        <MacButton
          v-if="activeSubTab === 'pricing'"
          size="sm"
          variant="primary"
          @click="openCreate"
        >
          + 创建渠道
        </MacButton>

        <MacButton
          v-else
          size="sm"
          variant="primary"
          @click="openCreateMonitor"
        >
          + 新增探活监控
        </MacButton>
      </div>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="absolute top-16 right-6 z-50 px-3.5 py-2 rounded-lg bg-neutral-900/90 text-white text-xs shadow-lg backdrop-blur-md border border-white/10 animate-fade-in">
      {{ toastMsg }}
    </div>

    <!-- ========================================== -->
    <!-- SUB-TAB 1: 渠道定价与策略 (Pricing) -->
    <!-- ========================================== -->
    <template v-if="activeSubTab === 'pricing'">
      <!-- Filter Bar -->
      <div class="admin-filters">
        <div class="relative w-64">
          <input
            v-model="searchQuery"
            placeholder="搜索渠道..."
            class="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
            aria-label="搜索渠道，按回车应用"
            @keyup.enter="channelPage = 1; loadChannels()"
          />
          <span class="absolute left-2.5 top-2 text-[var(--text-tertiary)]">🔍</span>
        </div>

        <select
          v-model="statusFilter"
          class="h-8 px-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
          aria-label="渠道状态"
          @change="channelPage = 1; loadChannels()"
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </div>

      <!-- Pricing Table Body -->
      <AdminFeedback :loading="isLoading" :error="channelError" @retry="loadChannels" />
      <div class="admin-table-scroll">
        <table class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--text-tertiary)] font-medium">
              <th class="p-3">名称</th>
              <th class="p-3">描述</th>
              <th class="p-3">状态</th>
              <th class="p-3">关联分组</th>
              <th class="p-3">模型定价</th>
              <th class="p-3">创建时间</th>
              <th class="p-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            <tr v-if="isLoading">
              <td colspan="7" class="p-8 text-center text-xs text-[var(--text-tertiary)]">正在加载渠道列表...</td>
            </tr>
            <tr v-else-if="!channelError && filteredChannels.length === 0">
              <td colspan="7" class="p-8 text-center text-xs text-[var(--text-tertiary)]">暂无渠道数据</td>
            </tr>
            <tr
              v-for="ch in filteredChannels"
              :key="ch.id"
              class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td class="p-3 font-semibold text-[var(--text-primary)]">{{ ch.name }}</td>
              <td class="p-3 text-sm text-[var(--text-secondary)]">{{ ch.description || '-' }}</td>
              <td class="p-3">
                <MacToggle
                  :model-value="ch.status === 'active'"
                  @update:model-value="handleToggleStatus(ch)"
                />
              </td>
              <td class="p-3">
                <span class="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {{ (ch.group_ids || []).length }} 个分组
                </span>
              </td>
              <td class="p-3">
                <span class="inline-flex items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
                  {{ (ch.model_pricing || []).length }} 条定价
                </span>
              </td>
              <td class="p-3 text-[11px] text-[var(--text-secondary)] font-mono">
                {{ ch.created_at ? new Date(ch.created_at).toLocaleDateString('zh-CN') : '-' }}
              </td>
              <td class="p-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-[#007aff] transition-colors"
                    @click="openEdit(ch)"
                  >
                    <span>✏️</span>
                    <span>编辑</span>
                  </button>
                  <button
                    type="button"
                    class="flex items-center gap-1 text-xs text-[var(--text-secondary)] hover:text-red-500 transition-colors"
                    @click="channelToDelete = ch"
                  >
                    <span>🗑️</span>
                    <span>删除</span>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="admin-footer">
        <span>共 {{ channelTotal }} 个渠道 · 每页 20 项</span>
        <div class="flex items-center gap-3">
          <button :disabled="isLoading || channelPage <= 1" @click="channelPage--; loadChannels()">上一页</button>
          <span>{{ channelPage }} / {{ channelPages }}</span>
          <button :disabled="isLoading || channelPage >= channelPages" @click="channelPage++; loadChannels()">下一页</button>
        </div>
      </div>
    </template>

    <!-- ========================================== -->
    <!-- SUB-TAB 2: 渠道监控与探活 (Monitor) -->
    <!-- ========================================== -->
    <template v-else-if="activeSubTab === 'monitor'">
      <!-- Monitor Filter Bar -->
      <div class="admin-filters">
        <div class="relative w-64">
          <input
            v-model="monitorSearch"
            placeholder="搜索探活监控项..."
            class="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
            aria-label="搜索渠道监控，按回车应用"
            @keyup.enter="loadMonitors"
          />
          <span class="absolute left-2.5 top-2 text-[var(--text-tertiary)]">🔍</span>
        </div>

        <select
          v-model="monitorProvider"
          class="h-8 px-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
          @change="loadMonitors"
        >
          <option value="">全部服务商</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          <option value="grok">Grok</option>
          <option value="antigravity">Antigravity</option>
          <option value="kimi">Kimi</option>
          <option value="zhipu">智谱</option>
          <option value="deepseek">DeepSeek</option>
        </select>

        <select
          v-model="monitorCheckMode"
          class="h-8 px-3 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
          @change="loadMonitors"
        >
          <option value="">全部检测模式</option>
          <option value="probe">LLM 探活 (默认)</option>
          <option value="quota">仅查配额 (零成本)</option>
          <option value="quota_probe">探活 + 配额快照</option>
        </select>
      </div>

      <!-- Monitor Table Body -->
      <AdminFeedback :loading="isMonitorsLoading" :error="monitorError" @retry="loadMonitors" />
      <div class="admin-table-scroll">
        <table class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--text-tertiary)] font-medium">
              <th class="p-3">监控名称</th>
              <th class="p-3">服务商 / 模式</th>
              <th class="p-3">主要模型</th>
              <th class="p-3">实时延迟</th>
              <th class="p-3">7天可用率</th>
              <th class="p-3">检测周期</th>
              <th class="p-3">最近检测</th>
              <th class="p-3">状态</th>
              <th class="p-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-subtle)]">
            <tr v-if="isMonitorsLoading">
              <td colspan="9" class="p-8 text-center text-xs text-[var(--text-tertiary)]">正在加载监控项...</td>
            </tr>
            <tr v-else-if="!monitorError && filteredMonitors.length === 0">
              <td colspan="9" class="p-8 text-center text-xs text-[var(--text-tertiary)]">暂无探活监控数据</td>
            </tr>
            <tr
              v-for="m in filteredMonitors"
              :key="m.id"
              class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <td class="p-3">
                <div class="font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    :class="m.primary_status === 'operational' ? 'bg-emerald-500' : (m.primary_status === 'degraded' ? 'bg-amber-500' : (m.primary_status ? 'bg-red-500' : 'bg-gray-400'))"
                  ></span>
                  <span>{{ m.name }}</span>
                </div>
                <div class="text-[10px] text-[var(--text-secondary)] font-mono truncate max-w-[200px] mt-0.5">
                  {{ m.endpoint }}
                </div>
              </td>
              <td class="p-3">
                <div class="flex items-center gap-1">
                  <span class="px-1.5 py-0.5 rounded text-[10px] font-medium uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    {{ m.provider }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded text-[10px] bg-black/5 dark:bg-white/5 text-[var(--text-secondary)]">
                    {{ m.check_mode === 'probe' ? '探活' : (m.check_mode === 'quota' ? '配额' : '组合') }}
                  </span>
                </div>
              </td>
              <td class="p-3 font-mono text-[11px] text-[var(--text-primary)]">{{ m.primary_model }}</td>
              <td class="p-3">
                <span
                  v-if="m.primary_latency_ms != null"
                  class="font-mono text-xs font-medium"
                  :class="m.primary_latency_ms < 1000 ? 'text-emerald-500' : (m.primary_latency_ms < 3000 ? 'text-amber-500' : 'text-red-500')"
                >
                  {{ m.primary_latency_ms }} ms
                </span>
                <span v-else class="text-[var(--text-tertiary)]">-</span>
              </td>
              <td class="p-3">
                <div class="flex items-center gap-1.5">
                  <span class="font-mono text-xs">{{ m.availability_7d != null ? m.availability_7d.toFixed(1) + '%' : '-' }}</span>
                </div>
              </td>
              <td class="p-3 text-[11px] text-[var(--text-secondary)]">
                每 {{ m.interval_seconds }} 秒
              </td>
              <td class="p-3 text-[11px] text-[var(--text-secondary)] font-mono">
                {{ m.last_checked_at ? new Date(m.last_checked_at).toLocaleTimeString('zh-CN') : '未检测' }}
              </td>
              <td class="p-3">
                <MacToggle
                  :model-value="m.enabled"
                  @update:model-value="handleToggleMonitorEnabled(m)"
                />
              </td>
              <td class="p-3 text-right">
                <div class="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    class="px-2 py-0.5 rounded text-[11px] bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors"
                    :disabled="testingMonitorId === m.id"
                    @click="handleTriggerCheck(m)"
                  >
                    <span v-if="testingMonitorId === m.id" class="animate-spin inline-block">⚡</span>
                    <span v-else>探活</span>
                  </button>
                  <button
                    type="button"
                    class="text-xs text-[var(--text-secondary)] hover:text-[#007aff]"
                    @click="openEditMonitor(m)"
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    class="text-xs text-[var(--text-secondary)] hover:text-red-500"
                    @click="promptDeleteMonitor(m)"
                  >
                    🗑️
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <!-- Pricing Create/Edit Sheet -->
    <MacSheet v-if="showEditSheet && selectedChannel" v-slot="{ close }" protect-changes :show="true" title="渠道配置" :loading="isSaving || isSavingMonitor" @close="!isSaving && (showEditSheet = false)"><div class="space-y-3 text-xs"><p v-if="formError" role="alert" class="admin-form-error">{{ formError }}</p><AdminFeedback :error="groupsError" @retry="loadGroups" />
          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">渠道名称</label>
            <input
              v-model="selectedChannel.name" :disabled="isSaving"
              placeholder="输入渠道名称"
              class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
            />
          </div>

          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">渠道描述</label>
            <textarea
              v-model="selectedChannel.description" :disabled="isSaving"
              rows="2"
              placeholder="可选的渠道用途描述"
              class="w-full p-2.5 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
            ></textarea>
          </div>

          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">关联分组</label>
            <div class="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-[var(--border-subtle)] max-h-36 overflow-y-auto space-y-1.5">
              <div v-for="g in groups" :key="g.id" class="flex items-center gap-2">
                <input
                  type="checkbox"
                  :value="g.id"
                  v-model="selectedChannel.group_ids"
                  :disabled="!!groupsError || isSaving"
                  :id="`grp-${g.id}`"
                />
                <label :for="`grp-${g.id}`" class="cursor-pointer">{{ g.name }} ({{ g.platform }})</label>
              </div>
              <div v-if="groups.length === 0" class="text-[var(--text-tertiary)]">暂无可关联分组</div>
            </div>
          </div>
          <fieldset :disabled="isSaving" class="admin-editor-fields">
            <label>计费模型来源<select v-model="selectedChannel.billing_model_source"><option value="requested">请求模型</option><option value="upstream">上游模型</option><option value="channel_mapped">渠道映射模型</option><option value="response_model">响应模型</option></select></label>
            <label class="admin-check-label"><input v-model="selectedChannel.restrict_models" type="checkbox" />仅允许已定价模型</label>
            <label class="admin-check-label"><input v-model="selectedChannel.apply_pricing_to_account_stats" type="checkbox" />将渠道定价应用于账号统计</label>
            <ChannelFeaturesEditor v-model="selectedChannel.features_config" />
            <details><summary>模型定价 · {{ selectedChannel.model_pricing.length }} 条</summary>
              <PricingPolicyEditor v-model="selectedChannel.model_pricing" />
            </details>
            <details><summary>账号统计定价规则</summary>
              <AccountStatsPolicyEditor v-model="selectedChannel.account_stats_pricing_rules" />
            </details>
            <details><summary>模型映射 · {{ mappingRows.length }} 条</summary>
              <div v-for="(row, index) in mappingRows" :key="index" class="admin-editor-row">
                <label>平台<input v-model="row.platform" @input="mappingTouched = true" /></label><label>来源模型<input v-model="row.source" @input="mappingTouched = true" /></label><label>目标模型<input v-model="row.target" @input="mappingTouched = true" /></label>
                <button type="button" class="text-red-500" @click="mappingRows.splice(index, 1); mappingTouched = true">移除此映射</button>
              </div>
              <button type="button" class="text-[var(--accent)]" @click="mappingRows.push({ platform: 'openai', source: '', target: '' }); mappingTouched = true">添加模型映射</button>
            </details>
          </fieldset>
        </div><div class="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium"
            :disabled="isSaving" @click="close"
          >
            取消
          </button>
          <MacButton
            size="sm"
            variant="primary"
            :loading="isSaving"
            @click="saveChannel"
          >
            保存渠道
          </MacButton>
        </div></MacSheet>

    <!-- Monitor Create/Edit Sheet -->
    <MacSheet v-if="showMonitorSheet" v-slot="{ close }" protect-changes :show="true" title="监控配置" :loading="isSaving || isSavingMonitor" @close="!isSavingMonitor && (showMonitorSheet = false)"><div class="space-y-3 text-xs"><p v-if="formError" role="alert" class="admin-form-error">{{ formError }}</p>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-medium text-[var(--text-secondary)] mb-1">监控名称</label>
              <input
                v-model="monitorForm.name"
                placeholder="例如: OpenAI 官方主渠道"
                class="w-full h-8 px-3 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
              />
            </div>
            <div>
              <label class="block font-medium text-[var(--text-secondary)] mb-1">服务商</label>
              <select
                v-model="monitorForm.provider"
                class="w-full h-8 px-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Gemini</option>
                <option value="grok">Grok</option>
                <option value="antigravity">Antigravity</option>
                <option value="kimi">Kimi</option>
                <option value="zhipu">智谱</option>
                <option value="deepseek">DeepSeek</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">端点地址 (Endpoint)</label>
            <input
              v-model="monitorForm.endpoint"
              placeholder="https://api.openai.com/v1"
              class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
            />
          </div>

          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">API Key 凭据</label>
            <input
              type="password"
              v-model="monitorForm.api_key"
              :placeholder="monitorForm.id ? '留空保持原有 API Key' : '输入探活测试使用的 API Key'"
              class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block font-medium text-[var(--text-secondary)] mb-1">主要探活模型</label>
              <input
                v-model="monitorForm.primary_model"
                placeholder="gpt-4o"
                class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
              />
            </div>
            <div>
              <label class="block font-medium text-[var(--text-secondary)] mb-1">检测周期 (秒)</label>
              <input
                type="number"
                v-model.number="monitorForm.interval_seconds"
                placeholder="300"
                class="w-full h-8 px-3 font-mono rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
              />
            </div>
          </div>

          <label v-if="monitorForm.check_mode !== 'probe'" class="block">数据源账号 ID（须与监控平台一致）<input v-model.number="monitorForm.account_id" type="number" min="1" class="w-full h-8 px-3 border rounded-lg bg-[var(--bg-surface)]" /></label>
          <div>
            <label class="block font-medium text-[var(--text-secondary)] mb-1">检测模式</label>
            <select
              v-model="monitorForm.check_mode"
              class="w-full h-8 px-2 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
            >
              <option value="probe">LLM 探活（发起单轮极小请求检测连通性）</option>
              <option value="quota">仅查配额（通过对应控制台查余额与用量）</option>
              <option value="quota_probe">组合模式（探活 + 配额快照）</option>
            </select>
          </div>
        </div><div class="flex justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
          <button
            type="button"
            class="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium"
            :disabled="isSavingMonitor" @click="close"
          >
            取消
          </button>
          <MacButton
            size="sm"
            variant="primary"
            :loading="isSavingMonitor"
            @click="saveMonitor"
          >
            保存配置
          </MacButton>
        </div></MacSheet>

    <!-- Native macOS Attached Alert Sheet for Monitor Deletion -->
    <MacAlertSheet :show="!!channelToDisable" title="停用渠道？" :message="`「${channelToDisable?.name || ''}」的渠道配置将停用，可能影响关联分组的计费与模型路由。`" danger :loading="busyChannelIds.length > 0" confirm-text="停用渠道" @confirm="channelToDisable && applyChannelStatus(channelToDisable)" @cancel="!busyChannelIds.length && (channelToDisable = null)" />
    <MacAlertSheet
      :show="!!channelToDelete"
      title="删除渠道？"
      :message="`「${channelToDelete?.name || ''}」将被移除，此操作无法撤销。`"
      danger
      :loading="deletingChannel"
      confirm-text="删除渠道"
      @confirm="channelToDelete && deleteChannelItem(channelToDelete)"
      @cancel="!deletingChannel && (channelToDelete = null)"
    />
    <MacAlertSheet
      :show="showDeleteMonitorSheet"
      :loading="deletingMonitor"
      title="确定要删除此探活监控项吗？"
      :message="`监控名称: ${monitorToDelete?.name} (${monitorToDelete?.primary_model})。删除后该监控项的自动化探活与可用率统计将终止。`"
      confirm-text="删除监控"
      cancel-text="取消"
      :danger="true"
      @confirm="confirmDeleteMonitor"
      @cancel="!deletingMonitor && (showDeleteMonitorSheet = false, monitorToDelete = null)"
    />
  </div>
</template>
