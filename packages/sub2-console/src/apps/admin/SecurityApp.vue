<script setup lang="ts">
import RecordDetails from './operations/RecordDetails.vue';
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, reactive, onUnmounted, watch } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacToggle, MacSheet, MacAlertSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import RiskPolicySheet from './operations/RiskPolicySheet.vue';
import HashCacheSheet from './operations/HashCacheSheet.vue';
import RiskKeysSheet from './operations/RiskKeysSheet.vue';
import PromptPolicySheet from './operations/PromptPolicySheet.vue';
import { adminError } from './admin-feedback';

import { auditAPI, type AuditLog } from '../../api/admin/audit';
import { 
  riskControlAPI, 
  type ContentModerationConfig, 
  type ContentModerationLog,
  type ContentModerationRuntimeStatus
} from '../../api/admin/riskControl';
import { 
  promptAuditAPI, 
  type PromptAuditConfig, 
  type PromptAuditEvent,
  type PromptAuditEndpointDraft
} from '../../api/admin/promptAudit';

const props = defineProps<{
  win?: WindowInstance;
}>();

const showRiskKeys = ref(false), showHashCache=ref(false);
const unbanTarget = ref<{id:number;email:string}|null>(null), unbanning = ref(false), unbanError = ref('');
let unbanEpoch = 0;
onUnmounted(() => { unbanEpoch++; });
async function confirmUnban() {
 if(!unbanTarget.value || unbanning.value) return; const id=unbanTarget.value.id, version=unbanEpoch; unbanning.value=true;unbanError.value='';
 try { const result=await riskControlAPI.unbanUser(id); if(version !== unbanEpoch) return; if(result.user_id !== id || !result.status) throw new Error('解除封禁响应不完整'); riskLogs.value=riskLogs.value.map(row=>row.user_id === id ? {...row,user_status:result.status} : row);if(selectedRiskLog.value?.user_id === id) selectedRiskLog.value={...selectedRiskLog.value,user_status:result.status}; unbanTarget.value=null;showToast('用户封禁已解除'); }
 catch(err) {if(version === unbanEpoch) unbanError.value=adminError(err,'解除封禁失败');} finally {if(version === unbanEpoch) unbanning.value=false;}
}
const showPromptPolicy = ref(false);
const deletePromptIDs = ref<number[]>([]), deletingPrompt = ref(false);
function confirmPromptPageDelete() { deletePromptIDs.value = promptEvents.value.map(event => event.id); }
async function deletePromptPage() {
  if (deletingPrompt.value || !deletePromptIDs.value.length) return;
  deletingPrompt.value = true;
  try { await promptAuditAPI.batchDeleteEvents([...deletePromptIDs.value]); deletePromptIDs.value = []; promptPage.value = 1; await loadPromptData(); }
  catch (err) { promptError.value = adminError(err, '事件删除失败'); }
  finally { deletingPrompt.value = false; }
}
const showRiskPolicy = ref(false);

// Main segmented tabs
type MainTab = 'audit' | 'risk' | 'prompt';
function validSecurityTab(value: unknown): value is MainTab { return value === 'audit' || value === 'risk' || value === 'prompt'; }
const initialTab = props.win?.customData?.tab;
const activeTab = ref<MainTab>(validSecurityTab(initialTab) ? initialTab : 'audit');
// Object replacement is also a navigation intent, even if tab equals the previous external value.
const stopTabWatch = watch([() => props.win?.customData, () => props.win?.customData?.tab], ([, tab]) => {
  if (validSecurityTab(tab)) activeTab.value = tab;
});
onUnmounted(stopTabWatch);
const auditError = ref('');
const riskError = ref('');
const promptError = ref('');
let auditListEpoch=0,riskListEpoch=0,promptListEpoch=0;
onUnmounted(()=>{auditListEpoch++;riskListEpoch++;promptListEpoch++;});

// ==========================================
// 1. 操作日志 (Audit Logs)
// ==========================================
const auditLoading = ref(false);
const auditLogs = ref<AuditLog[]>([]);
const auditTotal = ref(0);
const auditPage = ref(1);
const auditPageSize = ref(20);

const auditFilters = reactive({
  q: '',
  actor_email: '',
  action: '',
  client_ip: '',
  method: '',
  auth_method: '',
  result: '' // 'success' | 'failure' | ''
});

async function loadAuditLogs() {
  const epoch=++auditListEpoch;
  auditLoading.value = true;
  auditError.value = '';
  try {
    const res = await auditAPI.list({
      page: auditPage.value,
      page_size: auditPageSize.value,
      q: auditFilters.q || undefined,
      actor_email: auditFilters.actor_email || undefined,
      action: auditFilters.action || undefined,
      client_ip: auditFilters.client_ip || undefined,
      method: auditFilters.method || undefined,
      auth_method: auditFilters.auth_method || undefined,
      success: auditFilters.result || undefined
    });
    if(epoch!==auditListEpoch)return;
    if(!Array.isArray(res?.items) || !Number.isFinite(res.total))throw new Error('操作日志响应不完整');
    auditLogs.value = res.items;
    auditTotal.value = res.total || 0;
  } catch (err) {
    if(epoch===auditListEpoch)auditError.value = adminError(err, '操作日志加载失败，请重试。');
  } finally {
    if(epoch===auditListEpoch)auditLoading.value = false;
  }
}

function resetAuditFilters() {
  auditFilters.q = '';
  auditFilters.actor_email = '';
  auditFilters.action = '';
  auditFilters.client_ip = '';
  auditFilters.method = '';
  auditFilters.auth_method = '';
  auditFilters.result = '';
  auditPage.value = 1;
  loadAuditLogs();
}

// Log Detail Modal
const selectedLog = ref<AuditLog | null>(null);
const showDetailModal = ref(false);

const logDetailLoading = ref(false), logDetailError = ref('');
let logDetailEpoch = 0;
const logDetailID = ref<number | null>(null);
async function viewLogDetail(log: AuditLog) {
  logDetailID.value = log.id; showDetailModal.value = true; selectedLog.value = null;
  await readAuditDetail();
}
async function readAuditDetail() {
  if (logDetailID.value == null) return;
  const epoch = ++logDetailEpoch; logDetailLoading.value = true; logDetailError.value = '';
  try { const data = await auditAPI.get(logDetailID.value); if (epoch === logDetailEpoch) selectedLog.value = data; }
  catch (err) { if (epoch === logDetailEpoch) logDetailError.value = adminError(err, '操作详情读取失败'); }
  finally { if (epoch === logDetailEpoch) logDetailLoading.value = false; }
}
function closeAuditDetail() { logDetailEpoch++; showDetailModal.value = false; selectedLog.value = null; }
const selectedRiskLog = ref<ContentModerationLog | null>(null);
const promptDetail = ref<PromptAuditEvent | null>(null), promptDetailOpen = ref(false), promptDetailLoading = ref(false), promptDetailError = ref('');
let promptDetailEpoch = 0;
const promptDetailID = ref<number | null>(null);
async function viewPromptDetail(event: PromptAuditEvent) { promptDetailID.value = event.id; promptDetailOpen.value = true; promptDetail.value = null; await readPromptDetail(); }
async function readPromptDetail() {
  if (promptDetailID.value == null) return;
  const epoch = ++promptDetailEpoch; promptDetailLoading.value = true; promptDetailError.value = '';
  try { const value = await promptAuditAPI.getEvent(promptDetailID.value); if (epoch === promptDetailEpoch) promptDetail.value = value; }
  catch (err) { if (epoch === promptDetailEpoch) promptDetailError.value = adminError(err, '提示词详情读取失败'); }
  finally { if (epoch === promptDetailEpoch) promptDetailLoading.value = false; }
}
function closePromptDetail() { promptDetailEpoch++; promptDetailOpen.value = false; promptDetail.value = null; }
onUnmounted(() => { logDetailEpoch++; promptDetailEpoch++; });

const toastMsg = ref<string | null>(null);
const toastType = ref<'success' | 'error'>('success');
function showToast(msg: string, type: 'success' | 'error' = 'success') {
  toastMsg.value = msg;
  toastType.value = type;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2500);
}

// Clear Logs Modal
const showClearModal = ref(false);
const totpCode = ref('');
const clearError = ref('');
const clearingLogs = ref(false);

async function handleClearLogs() {
  if (clearingLogs.value) return;
  clearError.value='';
  if(!/^\d{6}$/.test(totpCode.value)){clearError.value='请输入6位动态验证码';return;}
  clearingLogs.value = true;
  try {
    const result=await auditAPI.clear(totpCode.value);
    if(!Number.isSafeInteger(result.deleted)||result.deleted<0)throw new Error('清理响应不完整，请刷新日志核对结果');
    showClearModal.value = false;
    totpCode.value = '';
    auditPage.value = 1;
    showToast('操作日志已清空');
    loadAuditLogs();
  } catch (err: any) {
    clearError.value=adminError(err, '清理操作日志失败');
  } finally {
    clearingLogs.value = false;
    totpCode.value='';
  }
}

// ==========================================
// 2. 内容审核 (Risk Control)
// ==========================================
const riskLoading = ref(false);
const riskConfig = ref<ContentModerationConfig | null>(null);
const riskConfigReady = ref(false);
const riskStatus = ref<ContentModerationRuntimeStatus | null>(null);
const riskLogs = ref<ContentModerationLog[]>([]);
const riskPage = ref(1);
const riskFilters = reactive({ result: '', search: '', endpoint: '', group_id: '' });
const riskTotal = ref<number | null>(null);
const showRiskSettingsModal = ref(false);
const savingRiskConfig = ref(false);

const editRiskForm = reactive({
  enabled: false,
  mode: 'pre_block' as 'off' | 'observe' | 'pre_block',
  base_url: 'https://api.openai.com',
  model: 'omni-moderation-latest',
  api_keys_text: '',
  worker_count: 4,
  queue_size: 32768,
  timeout_ms: 3000
});

async function loadRiskData() {
  const epoch=++riskListEpoch;
  riskLoading.value = true;
  riskConfigReady.value = false;
  riskError.value = '';
  try {
    const [cfg, stat, logs] = await Promise.allSettled([
      riskControlAPI.getConfig(),
      riskControlAPI.getStatus(),
      riskControlAPI.listLogs({ page: riskPage.value, page_size: 20, result: riskFilters.result || undefined, search: riskFilters.search || undefined, endpoint: riskFilters.endpoint || undefined, group_id: riskFilters.group_id ? Number(riskFilters.group_id) : undefined })
    ]);
    if(epoch!==riskListEpoch)return;
    const failed = [cfg, stat, logs].filter(result => result.status === 'rejected');
    if (failed.length) riskError.value = `有 ${failed.length} 项审核数据加载失败，当前仅显示已加载结果。请重新加载。`;
    if (cfg.status === 'fulfilled' && cfg.value) {
      riskConfigReady.value = true;
      riskConfig.value = cfg.value;
      editRiskForm.enabled = cfg.value.enabled;
      editRiskForm.mode = cfg.value.mode;
      editRiskForm.base_url = cfg.value.base_url || 'https://api.openai.com';
      editRiskForm.model = cfg.value.model || 'omni-moderation-latest';
      editRiskForm.worker_count = cfg.value.worker_count || 4;
      editRiskForm.queue_size = cfg.value.queue_size || 32768;
      editRiskForm.timeout_ms = cfg.value.timeout_ms || 3000;
    }
    if (stat.status === 'fulfilled') {
      riskStatus.value = stat.value;
    }
    if (logs.status === 'fulfilled') {
      riskLogs.value = logs.value?.items || [];
      riskTotal.value = logs.value.total;
    }
  } catch (err) {
    if(epoch===riskListEpoch)riskError.value = adminError(err, '内容审核数据加载失败，请重试。');
  } finally {
    if(epoch===riskListEpoch)riskLoading.value = false;
  }
}

async function handleSaveRiskConfig() {
  if (savingRiskConfig.value) return;
  if (!riskConfig.value || !riskConfigReady.value || riskLoading.value) { showToast('请先成功加载当前审核配置，再进行修改。', 'error'); return; }
  savingRiskConfig.value = true;
  try {
    const apiKeys = editRiskForm.api_keys_text
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);
    
    await riskControlAPI.updateConfig({
      enabled: editRiskForm.enabled,
      mode: editRiskForm.mode,
      base_url: editRiskForm.base_url,
      model: editRiskForm.model,
      worker_count: editRiskForm.worker_count,
      queue_size: editRiskForm.queue_size,
      timeout_ms: editRiskForm.timeout_ms,
      api_keys: apiKeys.length ? apiKeys : undefined,
      api_keys_mode: apiKeys.length ? 'append' : undefined
    });
    showRiskSettingsModal.value = false;
    editRiskForm.api_keys_text = '';
    showToast('内容审计配置已保存');
    loadRiskData();
  } catch (err: any) {
    showToast(adminError(err, '保存内容审计配置失败'), 'error');
  } finally {
    savingRiskConfig.value = false;
  }
}

// ==========================================
// 3. 提示词审计 (Prompt Audit)
// ==========================================
const promptSubTab = ref<'events' | 'config'>('events');
const promptLoading = ref(false);
const promptConfig = ref<PromptAuditConfig | null>(null);
const promptEvents = ref<PromptAuditEvent[]>([]);
const promptTotal = ref(0);
const promptPage = ref(1);
const promptPageSize = ref(20);

const promptFilters = reactive({
  decision: '',
  risk_level: '',
  ingress: '',
  group_id: undefined as number | undefined,
  user_id: undefined as number | undefined,
  api_key_id: undefined as number | undefined,
  request_id: '',
  prompt_sha256: '',
  keyword: ''
});

async function loadPromptData() {
  const epoch=++promptListEpoch;
  promptLoading.value = true;
  promptError.value = '';
  try {
    const [cfg, events] = await Promise.allSettled([
      promptAuditAPI.getConfig(),
      promptAuditAPI.listEvents({...promptFilters}, promptPage.value, promptPageSize.value)
    ]);
    if(epoch!==promptListEpoch)return;
    if (cfg.status === 'rejected' || events.status === 'rejected') promptError.value = '提示词审计数据未完整加载，请重试。';
    if (cfg.status === 'fulfilled' && cfg.value) {
      promptConfig.value = cfg.value;
    }
    if (events.status === 'fulfilled' && events.value) {
      promptEvents.value = events.value.items || [];
      promptTotal.value = events.value.total || 0;
    }
  } catch (err) {
    if(epoch===promptListEpoch)promptError.value = adminError(err, '提示词审计加载失败，请重试。');
  } finally {
    if(epoch===promptListEpoch)promptLoading.value = false;
  }
}

function resetPromptFilters() {
  promptFilters.decision = '';
  promptFilters.risk_level = '';
  promptFilters.ingress = '';
  promptFilters.group_id = undefined;
  promptFilters.user_id = undefined;
  promptFilters.api_key_id = undefined;
  promptFilters.request_id = '';
  promptFilters.prompt_sha256 = '';
  promptFilters.keyword = '';
  promptPage.value = 1;
  loadPromptData();
}

// Endpoint probing
const probingEndpoint = ref<string | null>(null);
async function probeNode(ep: any) {
  probingEndpoint.value = ep.id;
  try {
    const res = await promptAuditAPI.probeEndpoint(ep);
    if (res.ok) {
      showToast(`节点探测成功！响应耗时 ${res.latency_ms}ms`);
    } else {
      showToast(`节点探测失败: ${res.message || '未知错误'}`, 'error');
    }
  } catch (err: any) {
    showToast(adminError(err, '探测失败'), 'error');
  } finally {
    probingEndpoint.value = null;
  }
}

// Format date helper
function formatDate(d?: string | number | null) {
  if (!d) return '—';
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '—';
  }
}

onMounted(() => {
  loadAuditLogs();
  loadRiskData();
  loadPromptData();
});
</script>

<template>
  <div class="admin-polish security-app h-full flex flex-col select-none overflow-hidden relative">
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
      >
        <span>{{ toastType === 'error' ? '⚠️' : '✓' }}</span>
        <span>{{ toastMsg }}</span>
      </div>
    </Transition>

    <!-- Top Toolbar Header -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-2.5">
        <img :src="getAppIcon('security')" alt="Security" class="w-7 h-7 object-contain drop-shadow-sm" />
        <div>
          <span class="text-xs font-semibold text-gray-900 dark:text-gray-100">
            {{ activeTab === 'audit' ? '操作日志' : activeTab === 'risk' ? '风控中心 · 内容审核' : '安全审计 · 提示词审计' }}
          </span>
        </div>
      </div>

      <!-- Segmented Navigation Control -->
      <div class="admin-tabs">
        <button 
          @click="activeTab = 'audit'"
          :class="activeTab === 'audit' ? 'bg-white dark:bg-[#3a3a3c] shadow-xs font-semibold text-gray-900 dark:text-white' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          class="px-3 py-1 rounded-md transition-all flex items-center gap-1.5"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          操作日志
        </button>
        <button 
          @click="activeTab = 'risk'"
          :class="activeTab === 'risk' ? 'bg-white dark:bg-[#3a3a3c] shadow-xs font-semibold text-gray-900 dark:text-white' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          class="px-3 py-1 rounded-md transition-all flex items-center gap-1.5"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          内容审核
        </button>
        <button 
          @click="activeTab = 'prompt'"
          :class="activeTab === 'prompt' ? 'bg-white dark:bg-[#3a3a3c] shadow-xs font-semibold text-gray-900 dark:text-white' : 'text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white'"
          class="px-3 py-1 rounded-md transition-all flex items-center gap-1.5"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          提示词审计
        </button>
      </div>
    </div>

    <!-- Main Content Body -->
    <AdminFeedback
      :loading="activeTab === 'audit' ? auditLoading : activeTab === 'risk' ? riskLoading : promptLoading"
      :error="activeTab === 'audit' ? auditError : activeTab === 'risk' ? riskError : promptError"
      @retry="activeTab === 'audit' ? loadAuditLogs() : activeTab === 'risk' ? loadRiskData() : loadPromptData()"
    />
    <div class="admin-content flex-1 overflow-y-auto p-4 space-y-4">
      
      <!-- ============================================================== -->
      <!-- TAB 1: 操作日志 (AUDIT LOGS) -->
      <!-- ============================================================== -->
      <template v-if="activeTab === 'audit'">
        <!-- Description Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div>
            <h1 class="text-lg font-bold text-gray-900 dark:text-white">操作日志</h1>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              记录管理员与用户的管理面操作，请求头凭证仅保留首尾、请求体已脱敏。日志无法单条删除，全量清理需二次验证。
            </p>
          </div>
          <div class="flex items-center gap-2">
            <MacButton size="sm" @click="loadAuditLogs">
              刷新
            </MacButton>
            <MacButton size="sm" variant="destructive" @click="showClearModal = true">
              <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              全部清理
            </MacButton>
          </div>
        </div>

        <!-- Filter Card -->
        <div class="admin-card p-3.5 shadow-xs space-y-3">
          <!-- Row 1 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">关键字</label>
              <input 
                v-model="auditFilters.q"
                type="text" 
                placeholder="路径 / 动作 / 操作者邮箱"
                class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-blue-500 text-xs"
                @keyup.enter="loadAuditLogs"
              />
            </div>
            <div>
              <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">操作者邮箱</label>
              <input 
                v-model="auditFilters.actor_email"
                type="text" 
                placeholder="邮箱地址"
                class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-blue-500 text-xs"
                @keyup.enter="loadAuditLogs"
              />
            </div>
            <div>
              <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">动作</label>
              <input 
                v-model="auditFilters.action"
                type="text" 
                placeholder="如 auth.login"
                class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-blue-500 text-xs"
                @keyup.enter="loadAuditLogs"
              />
            </div>
            <div>
              <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">客户端 IP</label>
              <input 
                v-model="auditFilters.client_ip"
                type="text" 
                placeholder="如 127.0.0.1"
                class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none focus:border-blue-500 text-xs"
                @keyup.enter="loadAuditLogs"
              />
            </div>
          </div>

          <!-- Row 2 -->
          <div class="flex flex-wrap items-end justify-between gap-3 pt-1 border-t border-black/[0.04] dark:border-white/[0.04] text-xs">
            <div class="flex flex-wrap items-center gap-3">
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">请求方法</label>
                <select 
                  v-model="auditFilters.method"
                  class="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none text-xs"
                >
                  <option value="">全部</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>

              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">认证方式</label>
                <select 
                  v-model="auditFilters.auth_method"
                  class="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none text-xs"
                >
                  <option value="">全部</option>
                  <option value="session">session</option>
                  <option value="api_key">api_key</option>
                  <option value="system">system</option>
                </select>
              </div>

              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">结果</label>
                <select 
                  v-model="auditFilters.result"
                  class="px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-[#1d1d1f] dark:text-[#f5f5f7] outline-none text-xs"
                >
                  <option value="">全部</option>
                  <option value="true">成功</option>
                  <option value="false">失败</option>
                </select>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <MacButton size="sm" variant="primary" @click="auditPage = 1; loadAuditLogs()">
                搜索
              </MacButton>
              <MacButton size="sm" @click="resetAuditFilters">
                重置
              </MacButton>
            </div>
          </div>
        </div>

        <!-- Audit Table -->
        <div class="admin-card overflow-hidden shadow-xs">
          <div class="admin-table-scroll">
            <table class="admin-table">
              <thead>
                <tr class="border-b border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-gray-500 dark:text-gray-400">
                  <th class="py-2.5 px-3 font-medium">时间</th>
                  <th class="py-2.5 px-3 font-medium">操作者</th>
                  <th class="py-2.5 px-3 font-medium">动作</th>
                  <th class="py-2.5 px-3 font-medium">结果</th>
                  <th class="py-2.5 px-3 font-medium">耗时</th>
                  <th class="py-2.5 px-3 font-medium">客户端 IP</th>
                  <th class="py-2.5 px-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                <tr v-if="auditLoading" class="text-center text-gray-400">
                  <td colspan="7" class="py-8">加载中...</td>
                </tr>
                <tr v-else-if="auditLogs.length === 0" class="text-center text-gray-400">
                  <td colspan="7" class="py-8">暂无操作日志</td>
                </tr>
                <tr 
                  v-for="log in auditLogs" 
                  :key="log.id" 
                  class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                >
                  <td class="py-2.5 px-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                    {{ formatDate(log.created_at) }}
                  </td>
                  <td class="py-2.5 px-3 font-medium text-gray-800 dark:text-gray-200">
                    {{ log.actor_email || '—' }}
                  </td>
                  <td class="py-2.5 px-3">
                    <div class="font-medium text-gray-900 dark:text-white">{{ log.action }}</div>
                    <div class="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{{ log.method }} {{ log.path }}</div>
                  </td>
                  <td class="py-2.5 px-3 whitespace-nowrap">
                    <span 
                      v-if="log.status_code >= 200 && log.status_code < 300"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      {{ log.status_code }}
                    </span>
                    <span 
                      v-else
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-400"
                    >
                      <span class="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                      {{ log.status_code }}
                    </span>
                  </td>
                  <td class="py-2.5 px-3 text-gray-500 whitespace-nowrap font-mono text-[11px]">
                    {{ log.latency_ms }} ms
                  </td>
                  <td class="py-2.5 px-3 text-gray-600 dark:text-gray-400 font-mono text-[11px] whitespace-nowrap">
                    {{ log.client_ip }}
                  </td>
                  <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button 
                      @click="viewLogDetail(log)"
                      class="text-blue-500 hover:text-blue-600 dark:text-blue-400 text-xs font-medium inline-flex items-center gap-1"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      详情
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination Bar -->
          <div class="px-4 py-2.5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between text-xs text-gray-500">
            <div>
              显示 {{ auditLogs.length ? (auditPage - 1) * auditPageSize + 1 : 0 }} 至 {{ Math.min(auditPage * auditPageSize, auditTotal) }} 共 {{ auditTotal }} 条结果
            </div>
            <div class="flex items-center gap-1">
              <button 
                :disabled="auditLoading || auditPage <= 1"
                @click="auditPage--; loadAuditLogs()"
                class="px-2.5 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-40 hover:bg-black/5 dark:hover:bg-white/5"
              >
                上一页
              </button>
              <span class="px-2 text-gray-700 dark:text-gray-300 font-medium">{{ auditPage }}</span>
              <button 
                :disabled="auditLoading || auditPage * auditPageSize >= auditTotal"
                @click="auditPage++; loadAuditLogs()"
                class="px-2.5 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-40 hover:bg-black/5 dark:hover:bg-white/5"
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- ============================================================== -->
      <!-- TAB 2: 内容审核 (RISK CONTROL) -->
      <!-- ============================================================== -->
      <template v-else-if="activeTab === 'risk'">
        <!-- Sub Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div>
            <h1 class="text-lg font-bold text-gray-900 dark:text-white">风控中心</h1>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              配置内容审计策略并查看审核记录
            </p>
          </div>
          <div class="flex items-center gap-2">
            <MacButton size="sm" @click="loadRiskData">
              刷新状态
            </MacButton>
            <MacButton size="sm" @click="showHashCache=true">命中缓存</MacButton>
            <MacButton size="sm" @click="showRiskKeys = true">审核密钥池</MacButton>
            <MacButton size="sm" :disabled="riskLoading" @click="showRiskPolicy = true">审核策略</MacButton>
            <MacButton size="sm" variant="primary" @click="showRiskSettingsModal = true">
              <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              内容审计设置
            </MacButton>
          </div>
        </div>

        <!-- 4 Overview Metric Cards -->
        <div class="admin-responsive-metrics grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <!-- Card 1: 运行状态 -->
          <div class="admin-card p-3.5 shadow-xs flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-500">运行状态</span>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-medium" :class="riskConfig?.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-gray-500'">
                  {{ riskConfig?.enabled ? '已启用' : '未启用' }}
                </span>
              </div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 truncate">
                {{ riskConfig?.enabled ? '已启用' : '未启用' }}
                <span class="text-xs font-normal text-gray-400 ml-1">
                  {{ riskConfig?.mode === 'pre_block' ? '前置拦截' : riskConfig?.mode === 'observe' ? '仅观察' : '关闭' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Card 2: API Key -->
          <div class="admin-card p-3.5 shadow-xs flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 text-blue-600 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-500">API Key</span>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-medium" :class="riskConfig?.api_key_configured ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-gray-500'">
                  {{ riskConfig?.api_key_configured ? '已配置' : '未配置' }}
                </span>
              </div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 truncate">
                {{ riskConfig?.api_key_masked || '未配置' }}
                <span class="text-xs font-normal text-gray-400 ml-1 truncate">{{ riskConfig?.model }}</span>
              </div>
            </div>
          </div>

          <!-- Card 3: 审计范围 -->
          <div class="admin-card p-3.5 shadow-xs flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-500">审计范围</span>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-purple-500/10 text-purple-600">
                  {{ riskConfig?.all_groups ? '全部分组' : '指定分组' }}
                </span>
              </div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 truncate">
                全部分组
                <span class="text-xs font-normal text-gray-400 ml-1">全部模型生效</span>
              </div>
            </div>
          </div>

          <!-- Card 4: 审核记录 -->
          <div class="admin-card p-3.5 shadow-xs flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-amber-500/10 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between text-xs">
                <span class="text-gray-500">审核记录</span>
                <span class="px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600">
                  {{ riskTotal ?? '—' }}
                </span>
              </div>
              <div class="text-sm font-semibold text-gray-900 dark:text-white mt-0.5 truncate">
                {{ riskTotal ?? '—' }}
                <span class="text-xs font-normal text-gray-400 ml-1">当前筛选结果</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 2 Realtime Monitor Cards -->
        <div class="admin-responsive-grid grid grid-cols-1 lg:grid-cols-2 gap-3">
          <!-- Left: 前置拦截同步状态 -->
          <div class="admin-card p-4 shadow-xs">
            <div class="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">前置拦截同步状态</h3>
                <p class="text-[11px] text-gray-400 mt-0.5">同步审核链路的实时计数，不包含异步写记录任务。</p>
              </div>
              <span class="px-2 py-0.5 rounded text-[10px] font-medium bg-black/5 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                前置拦截
              </span>
            </div>
            
            <div class="grid grid-cols-3 gap-3 mt-3">
              <div class="bg-blue-500/5 dark:bg-blue-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">同步处理中</div>
                <div class="text-lg font-bold text-blue-600 dark:text-blue-400 mt-1">{{ riskStatus?.pre_block_active ?? '—' }}</div>
                <div class="text-[10px] text-gray-400">当前正在审核</div>
              </div>
              <div class="bg-gray-500/5 dark:bg-gray-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">已检查</div>
                <div class="text-lg font-bold text-gray-800 dark:text-gray-200 mt-1">{{ riskStatus?.pre_block_checked ?? '—' }}</div>
                <div class="text-[10px] text-gray-400">进入前置拦截链路</div>
              </div>
              <div class="bg-emerald-500/5 dark:bg-emerald-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">已放行</div>
                <div class="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">{{ riskStatus?.pre_block_allowed ?? '—' }}</div>
                <div class="text-[10px] text-gray-400">未触发拦截</div>
              </div>
              <div class="bg-red-500/5 dark:bg-red-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">已拦截</div>
                <div class="text-lg font-bold text-red-600 dark:text-red-400 mt-1">{{ riskStatus?.pre_block_blocked ?? '—' }}</div>
                <div class="text-[10px] text-gray-400">命中后拒绝请求</div>
              </div>
              <div class="bg-amber-500/5 dark:bg-amber-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">审核异常</div>
                <div class="text-lg font-bold text-amber-600 dark:text-amber-400 mt-1">{{ riskStatus?.pre_block_errors ?? '—' }}</div>
                <div class="text-[10px] text-gray-400">失败或无可用 Key</div>
              </div>
              <div class="bg-purple-500/5 dark:bg-purple-500/10 rounded-lg p-2.5">
                <div class="text-[11px] text-gray-500">平均耗时</div>
                <div class="text-lg font-bold text-purple-600 dark:text-purple-400 mt-1">{{ riskStatus?.pre_block_avg_latency_ms == null ? '—' : riskStatus.pre_block_avg_latency_ms.toFixed(1) + ' ms' }}</div>
                <div class="text-[10px] text-gray-400">同步链路平均值</div>
              </div>
            </div>
          </div>

          <!-- Right: 审核 Key 负载 -->
          <div class="admin-card p-4 shadow-xs flex flex-col">
            <div class="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-white">审核 Key 负载</h3>
                <p class="text-[11px] text-gray-400 mt-0.5">同步前置拦截直接轮询可用审核 Key。</p>
              </div>
              <span class="text-[11px] text-gray-400">
                同步并发 {{ riskStatus?.pre_block_api_key_active ?? '—' }} / 可用 Key {{ riskStatus?.pre_block_api_key_available_count ?? '—' }}
              </span>
            </div>

            <div v-if="riskStatus?.pre_block_api_key_loads?.length" class="overflow-auto">
              <table class="admin-table"><thead><tr><th>审核 Key</th><th>并发</th><th>成功 / 总数</th><th>平均耗时</th></tr></thead><tbody>
                <tr v-for="key in riskStatus.pre_block_api_key_loads" :key="key.key_hash"><td>{{ key.masked }}</td><td>{{ key.active }}</td><td>{{ key.success }} / {{ key.total }}</td><td>{{ key.avg_latency_ms.toFixed(1) }} ms</td></tr>
              </tbody></table>
            </div>
            <div v-else class="flex-1 flex items-center justify-center py-10 text-gray-400 text-xs">{{ riskLoading ? '正在加载负载…' : riskStatus ? '暂无审核 Key 负载数据' : '审核 Key 负载尚未加载' }}</div>
          </div>
        </div>

        <!-- Bottom Records Section -->
        <div class="admin-card overflow-hidden shadow-xs">
          <div class="px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between">
            <div>
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">审核记录</h3>
              <p class="text-[11px] text-gray-400 mt-0.5">展示命中、拦截、异常和已采样记录。</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[11px] bg-black/5 dark:bg-white/10 text-gray-500">
                模型范围: {{ riskConfig?.model_filter?.type === 'all' ? '全部' : riskConfig?.model_filter?.type === 'include' ? '仅指定模型' : riskConfig?.model_filter?.type === 'exclude' ? '排除指定模型' : '未读取' }}
              </span>
              <MacButton size="sm" @click="loadRiskData">
                刷新
              </MacButton>
            </div>
          </div>

          <div class="overflow-auto">
            <form class="flex flex-wrap gap-2 p-3" @submit.prevent="riskPage = 1; loadRiskData()">
              <label>结果<select v-model="riskFilters.result"><option value="">全部</option><option value="hit">命中</option><option value="pass">通过</option><option value="blocked">已拦截</option><option value="error">异常</option></select></label>
              <label>搜索<input v-model="riskFilters.search" placeholder="用户 / 请求关键词" /></label>
              <label>分组<input v-model="riskFilters.group_id" type="number" min="1" /></label>
              <label>入口<input v-model="riskFilters.endpoint" /></label>
              <MacButton type="submit" size="sm" :disabled="riskLoading">筛选</MacButton>
            </form>
            <table v-if="riskLogs.length" class="admin-table"><thead><tr><th>时间 / 请求</th><th>用户</th><th>模型</th><th>结果</th><th>类别 / 错误</th></tr></thead><tbody>
              <tr v-for="log in riskLogs" :key="log.id"><td>{{ formatDate(log.created_at) }}<div class="text-[10px] text-[var(--text-secondary)]">{{ log.request_id }}</div></td><td>{{ log.user_email || log.user_id || '—' }}</td><td>{{ log.model || '—' }}</td><td>{{ log.error ? '异常' : log.flagged ? '命中' : '未命中' }}<div class="text-[10px]">{{ log.action }}</div></td><td>{{ log.error || log.highest_category || '—' }}<MacButton size="sm" @click="selectedRiskLog = log">详情</MacButton><details v-if="log.input_excerpt"><summary>查看输入摘要</summary><p class="whitespace-pre-wrap break-all select-text">{{ log.input_excerpt }}</p></details></td></tr>
            </tbody></table>
            <p v-else class="py-10 text-center text-gray-400 text-xs">{{ riskLoading ? '正在加载审核记录…' : riskError ? '审核记录未完整加载，请重试。' : '暂无审核记录' }}</p>
          </div>
          <div class="admin-footer"><span>共 {{ riskTotal ?? '—' }} 条记录</span><div class="flex items-center gap-3"><button :disabled="riskLoading || riskPage <= 1" @click="riskPage--; loadRiskData()">上一页</button><span>{{ riskPage }}</span><button :disabled="riskLoading || riskTotal == null || riskPage * 20 >= riskTotal" @click="riskPage++; loadRiskData()">下一页</button></div></div>
        </div>
      </template>

      <!-- ============================================================== -->
      <!-- TAB 3: 提示词审计 (PROMPT AUDIT) -->
      <!-- ============================================================== -->
      <template v-else-if="activeTab === 'prompt'">
        <!-- Sub Header -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
          <div>
            <span class="text-[10px] font-bold text-[#007aff] dark:text-[#0a84ff] uppercase tracking-wider">安全审计</span>
            <h1 class="text-lg font-bold text-gray-900 dark:text-white">提示词审计</h1>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              通过 OpenAI 兼容 Qwen3Guard 节点异步复核或同步阻止用户输入；事件的完整提示词会入库保存，仅供管理员复核。
            </p>
          </div>
          <div class="text-right text-xs text-gray-400">
            <div>配置版本 v{{ promptConfig?.config_version ?? '—' }}</div>
            <div class="text-[10px]">{{ formatDate(promptConfig?.updated_at) }}</div>
          </div>
        </div>

        <!-- Prompt Subtabs -->
        <div class="flex items-center gap-1.5 border-b border-black/[0.06] dark:border-white/[0.08] pb-2 text-xs">
          <button 
            @click="promptSubTab = 'events'"
            :class="promptSubTab === 'events' ? 'bg-[#007aff] text-white font-medium shadow-xs' : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10'"
            class="px-3 py-1.5 rounded-lg transition-all"
          >
            事件
          </button>
          <button 
            @click="promptSubTab = 'config'"
            :class="promptSubTab === 'config' ? 'bg-[#007aff] text-white font-medium shadow-xs' : 'bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-black/10'"
            class="px-3 py-1.5 rounded-lg transition-all"
          >
            配置
          </button>
        </div>

        <!-- Subtab 1: 事件 (Events) -->
        <template v-if="promptSubTab === 'events'">
          <!-- Filter Card -->
          <div class="admin-card p-4 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-3">
            <div class="flex items-center justify-between pb-2 border-b border-black/[0.04] dark:border-white/[0.04]">
              <div>
                <h3 class="text-xs font-semibold text-gray-900 dark:text-white">审计事件</h3>
                <p class="text-[10px] text-gray-400 mt-0.5">按身份、入口、风险、Hash 和时间复核事件，详情中可查看完整提示词。</p>
              </div>
              <div class="flex items-center gap-2">
                <MacButton size="sm" variant="destructive" :disabled="promptLoading || !!promptError || !promptEvents.length" @click="confirmPromptPageDelete">
                  删除当前页事件
                </MacButton>
              </div>
            </div>

            <!-- Row 1 -->
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">判定</label>
                <select v-model="promptFilters.decision" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs">
                  <option value="">全部</option>
                  <option value="pass">放行 (Pass)</option>
                  <option value="flag">可疑 (Flag)</option>
                  <option value="critical">严重违规 (Critical)</option>
                </select>
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">风险等级</label>
                <select v-model="promptFilters.risk_level" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs">
                  <option value="">全部</option>
                  <option value="low">低</option>
                  <option value="medium">中</option>
                  <option value="high">高</option>
                  <option value="critical">极高</option>
                </select>
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">入口</label>
                <input v-model="promptFilters.ingress" type="text" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">分组 ID</label>
                <input v-model="promptFilters.group_id" type="number" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">用户 ID</label>
                <input v-model="promptFilters.user_id" type="number" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
            </div>

            <!-- Row 2 -->
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">API Key ID</label>
                <input v-model="promptFilters.api_key_id" type="number" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">Request ID</label>
                <input v-model="promptFilters.request_id" type="text" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">Prompt SHA-256</label>
                <input v-model="promptFilters.prompt_sha256" type="text" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
              <div>
                <label class="block font-medium text-gray-600 dark:text-gray-400 mb-1">关键词</label>
                <input v-model="promptFilters.keyword" type="text" class="w-full px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
              </div>
            </div>

            <!-- Row 3 Actions -->
            <div class="flex items-center justify-end gap-2 pt-1 border-t border-black/[0.04] dark:border-white/[0.04]">
              <MacButton size="sm" variant="primary" @click="promptPage = 1; loadPromptData()">
                搜索
              </MacButton>
              <MacButton size="sm" @click="resetPromptFilters">
                重置
              </MacButton>
            </div>
          </div>

          <!-- Prompt Events Table -->
          <div class="admin-card overflow-hidden shadow-xs">
            <div class="admin-table-scroll">
              <table class="admin-table">
                <thead>
                  <tr class="border-b border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] text-gray-500">
                    <th class="py-2.5 px-3 w-8">ID</th>
                    <th class="py-2.5 px-3 font-medium">时间</th>
                    <th class="py-2.5 px-3 font-medium">用户 / 邮箱 / API KEY</th>
                    <th class="py-2.5 px-3 font-medium">分组</th>
                    <th class="py-2.5 px-3 font-medium">入口 / 模型</th>
                    <th class="py-2.5 px-3 font-medium">判定 / 风险</th>
                    <th class="py-2.5 px-3 font-medium">脱敏预览</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-black/[0.04] dark:divide-white/[0.04]">
                  <tr v-if="!promptLoading && !promptError && promptEvents.length === 0" class="text-center text-gray-400">
                    <td colspan="7" class="py-8">没有符合条件的事件。</td>
                  </tr>
                  <tr v-for="event in promptEvents" :key="event.id">
                    <td class="text-[11px] text-[var(--text-tertiary)]">#{{ event.id }}</td>
                    <td class="text-[11px] whitespace-nowrap">{{ formatDate(event.created_at) }}</td>
                    <td><div class="admin-name" :title="event.user_email">{{ event.user_email || `用户 #${event.user_id}` }}</div><div class="text-[10px] text-[var(--text-tertiary)]">密钥 #{{ event.api_key_id }}</div></td>
                    <td>{{ event.group_name || `#${event.group_id}` }}</td>
                    <td><div>{{ event.model }}</div><div class="text-[10px] text-[var(--text-tertiary)]">{{ event.ingress }}</div></td>
                    <td><span class="admin-status" :data-tone="event.decision === 'pass' ? 'success' : event.decision === 'critical' ? 'danger' : 'warning'">{{ event.decision === 'pass' ? '通过' : event.decision === 'critical' ? '高风险' : '需关注' }}</span><div class="text-[10px] text-[var(--text-tertiary)] mt-1">{{ event.risk_level }}</div></td>
                    <td><div class="admin-name" :title="event.prompt_preview">{{ event.prompt_preview || '—' }}</div><MacButton size="sm" @click="viewPromptDetail(event)">完整详情</MacButton></td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- Pagination Bar -->
            <div class="px-4 py-2.5 border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between text-xs text-gray-500">
              <div>
                共 {{ promptTotal }} 条事件 · 每页 {{ promptPageSize }} 项
              </div>
              <div class="flex items-center gap-1">
                <button :disabled="promptLoading || promptPage <= 1" @click="promptPage--; loadPromptData()" class="px-2.5 py-1 rounded border border-black/10 dark:border-white/10">上一页</button>
                <span class="px-2 text-gray-700 dark:text-gray-300 font-medium">{{ promptPage }}</span>
                <button :disabled="promptLoading || promptPage * promptPageSize >= promptTotal" @click="promptPage++; loadPromptData()" class="px-2.5 py-1 rounded border border-black/10 dark:border-white/10">下一页</button>
              </div>
            </div>
          </div>
        </template>

        <!-- Subtab 2: 配置 (Config) -->
        <template v-else-if="promptSubTab === 'config'">
          <div class="space-y-4">
            <!-- Node Endpoints -->
            <div class="admin-card p-4 shadow-xs space-y-3">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-sm font-semibold text-gray-900 dark:text-white">审计节点</h3>
                  <p class="text-[11px] text-gray-400 mt-0.5">配置用于处理提示词复核的 OpenAI 兼容 Qwen3Guard 节点。</p>
                </div>
                <MacButton size="sm" variant="primary" @click="showPromptPolicy = true">
                  编辑策略与节点
                </MacButton>
              </div>

              <div v-if="promptConfig?.endpoints?.length === 0" class="py-8 text-center text-gray-400 text-xs">
                暂无已配置的审计节点。
              </div>
            </div>

            <!-- Scanners Categories -->
            <div class="admin-card p-4 shadow-xs space-y-3">
              <h3 class="text-sm font-semibold text-gray-900 dark:text-white">风险分类扫描器</h3>
              <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div 
                  v-for="scanner in (promptConfig?.scanners || [])"
                  :key="scanner"
                  class="flex items-center gap-2 p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.04]"
                >
                  <input type="checkbox" checked disabled />
                  <span class="font-mono text-gray-700 dark:text-gray-300">{{ scanner }}</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </template>
    </div>

    <!-- Modals -->

    <PromptPolicySheet v-if="showPromptPolicy" @close="showPromptPolicy = false" @saved="loadPromptData" />
    <MacAlertSheet :show="!!deletePromptIDs.length" title="删除当前页审计事件？" :message="`${promptError ? promptError + '；' : ''}将永久删除已选取的 ${deletePromptIDs.length} 条事件，不包括其他页面。`" danger :loading="deletingPrompt" confirm-text="删除事件" @confirm="deletePromptPage" @cancel="deletePromptIDs = []" />
    <RiskPolicySheet v-if="showRiskPolicy" @close="showRiskPolicy = false" @saved="loadRiskData" />
    <MacSheet :show="showDetailModal" title="操作日志详情" @close="closeAuditDetail">
      <AdminFeedback :loading="logDetailLoading" :error="logDetailError" @retry="readAuditDetail" />
      <RecordDetails v-if="selectedLog" :record="selectedLog" />
      <template #footer><MacButton @click="closeAuditDetail">关闭</MacButton></template>
    </MacSheet>
    <MacSheet :show="!!selectedRiskLog" title="内容审核记录详情" @close="selectedRiskLog = null">
      <RecordDetails v-if="selectedRiskLog" :record="selectedRiskLog" />
      <template #footer><MacButton v-if="selectedRiskLog?.user_id && selectedRiskLog.auto_banned && selectedRiskLog.user_status === 'disabled'" @click="unbanError = ''; unbanTarget = {id:selectedRiskLog.user_id,email:selectedRiskLog.user_email}">解除用户封禁</MacButton><MacButton @click="selectedRiskLog = null">关闭</MacButton></template>
    </MacSheet>
    <MacSheet :show="promptDetailOpen" title="提示词审计详情" @close="closePromptDetail">
      <AdminFeedback :loading="promptDetailLoading" :error="promptDetailError" @retry="readPromptDetail" />
      <RecordDetails v-if="promptDetail" :record="promptDetail" />
      <template #footer><MacButton @click="closePromptDetail">关闭</MacButton></template>
    </MacSheet>

    <HashCacheSheet v-if="showHashCache" @close="showHashCache=false" @changed="loadRiskData" />
    <RiskKeysSheet v-if="showRiskKeys" @close="showRiskKeys = false" @changed="loadRiskData" />
    <MacAlertSheet :show="!!unbanTarget" title="解除用户封禁？" :message="unbanError || `将解除用户 ${unbanTarget?.email || ''} #${unbanTarget?.id} 的封禁，历史审核记录将保留。`" :loading="unbanning" confirm-text="解除封禁" @confirm="confirmUnban" @cancel="unbanTarget = null" />
    <MacSheet :show="showClearModal" title="清理全部操作日志" :loading="clearingLogs" @close="showClearModal = false; totpCode = ''"><p v-if="clearError" role="alert" class="text-red-500">{{ clearError }}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">
          此操作将永久删除所有操作日志，且不可恢复。清理动作本身会被留痕记录。确定继续吗？
        </p>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-gray-700 dark:text-gray-300">二次验证码 (TOTP)</label>
          <input 
            v-model="totpCode"
            type="text" 
            placeholder="请输入 6 位动态验证码"
            class="w-full px-3 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs outline-none"
          />
        </div>

      <template #footer>
          <MacButton size="sm" @click="showClearModal = false; totpCode = ''">取消</MacButton>
          <MacButton size="sm" variant="destructive" :disabled="clearingLogs" @click="handleClearLogs">
            {{ clearingLogs ? '清理中...' : '全部清理' }}
          </MacButton>
      </template>
    </MacSheet>

    <MacSheet :show="showRiskSettingsModal" title="内容审计设置" :loading="savingRiskConfig" @close="showRiskSettingsModal = false; editRiskForm.api_keys_text = ''">
        <div class="flex-1 overflow-y-auto space-y-3.5 text-xs">
          <div class="flex items-center justify-between p-2.5 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-black/[0.04]">
            <div>
              <div class="font-medium">开启内容审计</div>
              <div class="text-[10px] text-gray-400">关闭后不会审核网关请求。</div>
            </div>
            <MacToggle v-model="editRiskForm.enabled" />
          </div>

          <div>
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">全局模式</label>
            <select v-model="editRiskForm.mode" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs">
              <option value="pre_block">前置拦截 (命中后立即拒绝请求)</option>
              <option value="observe">仅观察 (异步记录，不拒绝请求)</option>
              <option value="off">关闭 (不执行内容审计)</option>
            </select>
          </div>

          <div>
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">OpenAI Base URL</label>
            <input v-model="editRiskForm.base_url" type="text" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
          </div>

          <div>
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">模型名</label>
            <input v-model="editRiskForm.model" type="text" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs" />
          </div>

          <div>
            <label class="block font-medium text-gray-700 dark:text-gray-300 mb-1">追加 OpenAI API Keys (每行一个)</label>
            <textarea 
              v-model="editRiskForm.api_keys_text" 
              rows="3" 
              placeholder="sk-..."
              class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#1e1e1e] text-xs font-mono"
            ></textarea>
          </div>
        </div>

      <template #footer>
          <MacButton size="sm" @click="showRiskSettingsModal = false; editRiskForm.api_keys_text = ''">取消</MacButton>
          <MacButton size="sm" variant="primary" :disabled="savingRiskConfig || !riskConfig || !riskConfigReady || riskLoading" @click="handleSaveRiskConfig">
            {{ savingRiskConfig ? '保存中...' : '保存配置' }}
          </MacButton>
      </template>
    </MacSheet>

  </div>
</template>

<style scoped>
.security-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
