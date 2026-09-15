<script setup lang="ts">
import CreateUserAttributes from './policies/CreateUserAttributes.vue';
import UserAttributeFilters from './policies/UserAttributeFilters.vue';
import BulkUserPolicies from './policies/BulkUserPolicies.vue';
import UserPolicyEditor from './policies/UserPolicyEditor.vue';
import AttributeDefinitionsEditor from './policies/AttributeDefinitionsEditor.vue';
import { copy, changedFields } from './policies/policy-contract';
import { getAppIcon } from '@/assets/appIcons';
import { ref, shallowRef, computed, watch, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacToggle, MacAlertSheet, MacButton } from '@sub2-mac/core';
import UsageBalanceHistory from './UsageBalanceHistory.vue';
import AdminFeedback from './AdminFeedback.vue';
import { adminError } from './admin-feedback';
import type { WindowInstance } from '@sub2-mac/core';
defineProps<{ win?: WindowInstance }>();
import * as usersAPI from '../../api/admin/users';
import * as groupsAPI from '../../api/admin/groups';
import { apiKeysAPI } from '../../api/admin/apiKeys';
import type { AdminUser, AdminGroup, ApiKey, UpdateUserRequest } from '@/types';
const balanceHistoryUser=ref<Pick<AdminUser,'id'|'email'>|null>(null);
const balanceGuard = shallowRef<Awaited<ReturnType<typeof usersAPI.createBalanceWriteGuard>>>();
let incrementalDisposed = false;
onMounted(async () => {
  try {
    const guard = await usersAPI.createBalanceWriteGuard();
    if (incrementalDisposed) { guard.dispose(); return; }
    balanceGuard.value = guard;
    if (showDepositModal.value && activeUser.value) guard.reset(activeUser.value.id);
  } catch { if (!incrementalDisposed) actionError.value = '操作保护暂不可用，请关闭并重新打开窗口。'; }
});
onUnmounted(() => { incrementalDisposed = true; if (balanceGuard.value) balanceGuard.value.dispose(); });

// Data states
const users = ref<AdminUser[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const saving = ref(false);
const policySaving = ref(false);
const createAttributes=ref<InstanceType<typeof CreateUserAttributes>|null>(null);
const createdUserId=ref<number|null>(null);
const creationNeedsReview=ref(false);
const attributeFilters=ref<Record<number,string>>({});
const selectedUserIds=ref<number[]>([]);
const showBulk=ref(false),bulkSaving=ref(false);
const bulkTargets=ref<number[]>([]);
function applyAttributes(filters:Record<number,string>){attributeFilters.value=filters;page.value=1;selectedUserIds.value=[];void loadUsers();}
function openBulk(){bulkTargets.value=[...selectedUserIds.value];showBulk.value=true;}
function selectPage(checked:boolean){selectedUserIds.value=checked?users.value.map(u=>u.id):[];}

const showAttributeDefinitions=ref(false);
const definitionsSaving=ref(false);
const editBaseline = ref<UpdateUserRequest>({});
const editNotice = ref('');
const groupsReady = ref(false);
const keysError = ref('');
const keysTotal = ref(0);
let keysVersion = 0;
const pendingDisable = ref<AdminUser | null>(null);
const statusBusy = ref(false);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
let loadVersion = 0;
onUnmounted(() => { loadVersion += 1; keysVersion += 1; userApiKeys.value = []; });

// Filters
const searchQuery = ref('');
const roleFilter = ref<string>('');
const statusFilter = ref<string>('');

// Modals
const showCreateModal = ref(false);
const showEditModal = ref(false);
const showDepositModal = ref(false);
watch(showDepositModal, show => { if (!show && balanceGuard.value) balanceGuard.value.reset(); }, { flush: 'sync' });
const showApiKeysModal = ref(false);
const showGroupsModal = ref(false);

// Active objects
const activeUser = ref<AdminUser | null>(null);
const userApiKeys = ref<ApiKey[]>([]);
const loadingApiKeys = ref(false);
const keyGroupDrafts = ref<Record<number, number>>({});
const savingKeyId = ref<number | null>(null), keysNotice = ref('');
const keyGroupsDirty = computed(() => userApiKeys.value.some(key => (keyGroupDrafts.value[key.id] ?? key.group_id ?? 0) !== (key.group_id || 0)));
watch(showApiKeysModal, show => { if (!show) { keysVersion++; userApiKeys.value = []; keyGroupDrafts.value = {}; } });
const allGroups = ref<AdminGroup[]>([]);
const userAllowedGroupIds = ref<number[]>([]);

// Forms
const createForm = ref({
  email: '',
  password: '',
  username: '',
  notes: '',
  role: 'user' as 'admin' | 'user',
  balance: 0,
  concurrency: 5,
  rpm_limit: 0
});

const editForm = ref({
  email: '',
  username: '',
  password: '',
  role: 'user' as 'admin' | 'user',
  status: 'active' as 'active' | 'disabled',
  concurrency: 5,
  rpm_limit: 0,
  notes: ''
});

const depositForm = ref({
  operation: 'add' as 'add' | 'subtract' | 'set',
  amount: 10,
  notes: '管理员手动充值'
});

function formatDateTime(dtStr?: string | null) {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function loadUsers() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const filters: NonNullable<Parameters<typeof usersAPI.list>[2]> = {attributes:attributeFilters.value};
    if (roleFilter.value) filters.role = roleFilter.value as 'admin' | 'user';
    if (statusFilter.value) filters.status = statusFilter.value as 'active' | 'disabled';
    if (searchQuery.value.trim()) filters.search = searchQuery.value.trim();

    const res = await usersAPI.list(page.value, pageSize.value, filters);
    if (version !== loadVersion) return;
    if (res && res.items) {
      users.value = res.items;
      selectedUserIds.value=selectedUserIds.value.filter(id=>res.items.some(u=>u.id===id));
      total.value = res.total ?? res.items.length;
    } else {
      users.value = [];
      total.value = 0;
    }
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '用户列表加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function loadAllGroups() {
  groupsReady.value = false;
  try {
    const res = await groupsAPI.getAll();
    allGroups.value = res || [];
    groupsReady.value = true;
  } catch (err) {
    actionError.value = adminError(err, '分组列表加载失败，请刷新后再分配权限。');
  }
}

function handleToggleStatus(user: AdminUser) {
  if (user.role === 'admin' || statusBusy.value) return;
  if (user.status === 'active') pendingDisable.value = user;
  else void applyUserStatus(user, 'active');
}
async function applyUserStatus(user: AdminUser, status: 'active' | 'disabled') {
  if (statusBusy.value) return;
  statusBusy.value = true;
  try {
    await usersAPI.toggleStatus(user.id, status);
    user.status = status;
    pendingDisable.value = null;
  } catch (err) { actionError.value = adminError(err, '用户状态更新失败，请重试。'); }
  finally { statusBusy.value = false; }
}

function openCreate() {
  if(saving.value)return;
  createdUserId.value=null;creationNeedsReview.value=false;actionError.value='';
  createForm.value = {
    email: '',
    password: '',
    username: '',
    notes: '',
    role: 'user',
    balance: 0,
    concurrency: 5,
    rpm_limit: 0
  };
  showCreateModal.value = true;
}

async function submitCreate() {
  if (saving.value || creationNeedsReview.value || !createdUserId.value && (!createForm.value.email || !createForm.value.password)) return;
  actionError.value='';saving.value = true;
  try {
    if(!createAttributes.value)throw Error('属性表单尚未就绪，请稍后重试。');
    const attributes=createAttributes.value.payload();
    if(createdUserId.value==null){
      const user=await usersAPI.create(createForm.value);
      if(!Number.isSafeInteger(user.id) || user.id<=0){creationNeedsReview.value=true;throw Error('创建响应缺少用户 ID，请关闭表单并刷新用户列表核对；暂不允许重复创建。');}
      createdUserId.value=user.id;
      createForm.value.password='';
    }
    if(Object.keys(attributes).length)await usersAPI.updateAttributeValues(createdUserId.value,attributes);
    showCreateModal.value = false;createdUserId.value=null;
    await loadUsers();
  } catch (err) {
    if(createdUserId.value==null && typeof err==='object' && err!==null && 'request' in err && !('response' in err && err.response)){creationNeedsReview.value=true;}
    actionError.value = (creationNeedsReview.value?'创建结果尚不明确，请刷新用户列表核对后再继续。':'') + (createdUserId.value ? `用户 #${createdUserId.value} 已创建，属性未保存；重试只保存属性。` : '') + adminError(err, '创建用户失败，请检查后重试。');
  } finally {saving.value = false;}
}

function openEdit(user: AdminUser) {
  editNotice.value = '';
  actionError.value = '';
  activeUser.value = user;
  editForm.value = {
    email: user.email,
    username: user.username || '',
    password: '',
    role: user.role,
    status: user.status,
    concurrency: user.concurrency,
    rpm_limit: user.rpm_limit || 0,
    notes: user.notes || ''
  };
  editBaseline.value = copy(editForm.value);
  showEditModal.value = true;
}

async function submitEdit() {
  if (!activeUser.value || saving.value || policySaving.value) return;
  saving.value = true;
  try {
    const payload: UpdateUserRequest = changedFields(editBaseline.value, editForm.value);
    if (!editForm.value.password) delete payload.password;
    if (Object.keys(payload).length) await usersAPI.update(activeUser.value.id, payload);
    editForm.value.password = '';
    editBaseline.value = copy(editForm.value);
    editNotice.value = '基本信息已保存。平台额度与用户属性请分别保存。';
    await loadUsers();
  } catch (err) {
    actionError.value = adminError(err, '保存用户失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

function openDeposit(user: AdminUser) {
  if (saving.value) return;
  activeUser.value = user;
  actionError.value = '';
  if (balanceGuard.value) balanceGuard.value.reset(user.id);
  depositForm.value = {
    operation: 'add',
    amount: 10,
    notes: '管理员手动充值'
  };
  showDepositModal.value = true;
}

async function submitDeposit() {
  if (!activeUser.value || saving.value || policySaving.value) return;
  if (!balanceGuard.value) { actionError.value = '操作保护正在准备，请稍后重试。'; return; }
  if (balanceGuard.value.blocked.value) { actionError.value = balanceGuard.value.error.value || '请先读取并核对上次余额调整结果。'; return; }
  if (!Number.isFinite(depositForm.value.amount) || depositForm.value.amount < 0) { actionError.value = '金额须为非负数字。'; return; }
  const context = balanceGuard.value.capture();
  actionError.value = '';
  saving.value = true;
  try {
    await usersAPI.updateBalance(
      activeUser.value.id,
      depositForm.value.amount,
      depositForm.value.operation,
      depositForm.value.notes
    );
    if (!context.current()) return;
    showDepositModal.value = false;
    await loadUsers();
  } catch (err) {
    if (!context.current()) return;
    actionError.value = adminError(err, '余额调整失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

async function openApiKeys(user: AdminUser) {
  if (savingKeyId.value !== null) return;
  if (!groupsReady.value) void loadAllGroups();
  const version = ++keysVersion;
  activeUser.value = user;
  showApiKeysModal.value = true;
  userApiKeys.value = [];
  keysError.value = '';
  keysNotice.value = ''; keyGroupDrafts.value = {};
  keysTotal.value = 0;
  loadingApiKeys.value = true;
  try {
    const res = await usersAPI.getUserApiKeys(user.id);
    if (version !== keysVersion) return;
    userApiKeys.value = res.items || [];
    keyGroupDrafts.value = Object.fromEntries(userApiKeys.value.map(key => [key.id, key.group_id || 0]));
    keysTotal.value = res.total;
  } catch (err) {
    if (version === keysVersion) keysError.value = adminError(err, '该用户的密钥加载失败，请重试。');
  } finally { if (version === keysVersion) loadingApiKeys.value = false; }
}

async function acknowledgeBalance() {
  if (!balanceGuard.value) return;
  if (await balanceGuard.value.acknowledge()) {
    showDepositModal.value = false;
    actionError.value = '已完成核对。需要再次调整时，请重新打开并填写新操作。';
  }
}

async function saveKeyGroup(key: ApiKey) {
  if (savingKeyId.value !== null || !showApiKeysModal.value || !activeUser.value || !groupsReady.value) return;
  const group = keyGroupDrafts.value[key.id];
  if (!Number.isSafeInteger(group) || group < 0 || (group > 0 && !allGroups.value.some(g => g.id === group))) {
    keysError.value = '请选择已加载的分组，或解除分组绑定。'; return;
  }
  if (group === (key.group_id || 0)) return;
  const version = keysVersion, userId = activeUser.value.id;
  savingKeyId.value = key.id; keysError.value = ''; keysNotice.value = '';
  try {
    const result = await apiKeysAPI.updateApiKeyGroup(key.id, group);
    if (version !== keysVersion || !showApiKeysModal.value || activeUser.value?.id !== userId) return;
    if (result.api_key?.id !== key.id || (result.api_key.group_id || 0) !== group) throw new Error('返回的密钥分组不匹配，请重新读取核对。');
    userApiKeys.value = userApiKeys.value.map(item => item.id === key.id ? result.api_key : item);
    keysNotice.value = result.auto_granted_group_access ? `密钥分组已更新，并已授予用户访问${result.granted_group_name || '该分组'}的权限。` : group ? '密钥分组已更新。' : '密钥分组绑定已解除。';
  } catch (err) {
    if (version === keysVersion && showApiKeysModal.value) keysError.value = adminError(err, '保存结果未确认，请重新读取密钥核对。');
  } finally { if (savingKeyId.value === key.id) savingKeyId.value = null; }
}

async function openGroups(user: AdminUser) {
  if (!groupsReady.value) void loadAllGroups();
  activeUser.value = user;
  userAllowedGroupIds.value = [...(user.allowed_groups || [])];
  showGroupsModal.value = true;
}

async function saveAllowedGroups() {
  if (!activeUser.value || saving.value || policySaving.value) return;
  if (!groupsReady.value) { actionError.value = '分组尚未成功加载，请先重试。'; return; }
  saving.value = true;
  try {
    await usersAPI.update(activeUser.value.id, { allowed_groups: userAllowedGroupIds.value });
    activeUser.value.allowed_groups = userAllowedGroupIds.value;
    showGroupsModal.value = false;
  } catch (err) {
    actionError.value = adminError(err, '分组授权保存失败，请重试。');
  } finally { saving.value = false; }
}

const showDeleteAlert = ref(false);
const userToDelete = ref<AdminUser | null>(null);
const isDeletingUser = ref(false);

function promptDeleteUser(user: AdminUser) {
  if (user.role === 'admin') return;
  userToDelete.value = user;
  showDeleteAlert.value = true;
}

async function confirmDeleteUser() {
  if (!userToDelete.value || isDeletingUser.value) return;
  isDeletingUser.value = true;
  try {
    await usersAPI.deleteUser(userToDelete.value.id);
    showDeleteAlert.value = false;
    userToDelete.value = null;
    await loadUsers();
  } catch (err) {
    actionError.value = adminError(err, '删除用户失败，请重试。');
  } finally {
    isDeletingUser.value = false;
  }
}

onMounted(() => {
  loadUsers();
  loadAllGroups();
});
</script>

<template>
  <div class="admin-polish flex flex-col h-full select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('users')" alt="Users" class="w-8 h-8 object-contain drop-shadow-sm" />
        <div>
          <h1 class="text-[17px] font-bold text-[var(--text-primary)] leading-tight">用户管理</h1>
          <p class="text-[11.5px] text-[var(--text-tertiary)] mt-0.5">管理用户账户和权限</p>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <button type="button" class="px-3 py-1.5 rounded-[7px] border border-[var(--border-color)] text-xs" @click="showAttributeDefinitions=true">属性定义</button>
        <button
          class="p-1.5 rounded-[7px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)] transition-colors"
          :class="loading ? 'animate-spin' : ''"
          title="刷新"
          @click="loadUsers"
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
          <span>创建用户</span>
        </button>
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="admin-filters">
      <div class="flex flex-wrap items-center gap-2.5">
        <!-- Search Input -->
        <div class="admin-filter-search relative w-64">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索邮箱、用户名或备注…"
            aria-label="搜索用户，按回车应用"
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none focus:border-[var(--accent)]"
            @keyup.enter="page = 1; loadUsers()"
          />
        </div>

        <!-- Role Select -->
        <select
          v-model="roleFilter"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadUsers()"
          aria-label="用户角色"
        >
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option>
        </select>

        <!-- Status Select -->
        <select
          v-model="statusFilter"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="page = 1; loadUsers()"
          aria-label="用户状态"
        >
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </div>
    </div>

    <div class="px-4 py-2 border-b border-[var(--border-color)] max-h-48 overflow-auto"><UserAttributeFilters @apply="applyAttributes" /></div>
    <div v-if="selectedUserIds.length" class="px-4 py-2 text-xs">已选 {{ selectedUserIds.length }} 个当前页用户 <button type="button" class="text-[var(--accent)]" @click="openBulk">批量修改限制 / 属性</button></div>
    <UsageBalanceHistory :user="balanceHistoryUser" @close="balanceHistoryUser=null" />
    <MacSheet v-if="showBulk" :show="true" title="批量用户策略" :loading="bulkSaving" @close="!bulkSaving && (showBulk=false)"><BulkUserPolicies :user-ids="bulkTargets" @busy="bulkSaving=$event" @saved="loadUsers" /></MacSheet>
    <!-- Table Container -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="用户管理" @retry="loadUsers" @dismiss="actionError = ''" />
    <div class="admin-table-scroll">
      <!-- Empty State -->
      <div v-if="!loading && !loadError && users.length === 0" class="admin-state flex flex-col items-center justify-center">
        <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-500">
          <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">{{ searchQuery || roleFilter || statusFilter ? '没有匹配的用户' : '还没有用户' }}</h3>
        <p class="text-xs text-[var(--text-tertiary)] max-w-xs leading-relaxed mb-4">
          创建第一个用户账户
        </p>
        <button
          class="px-4 py-1.5 rounded-[7px] text-xs font-medium bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-colors"
          @click="openCreate"
        >
          创建用户
        </button>
      </div>

      <!-- Data Table -->
      <table v-else-if="users.length" class="admin-table">
        <thead>
          <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
            <th class="px-3"><input type="checkbox" aria-label="选择当前页用户" :checked="users.length>0 && selectedUserIds.length===users.length" @change="selectPage(($event.target as HTMLInputElement).checked)" /></th><th class="px-4 py-2.5">用户</th>
            <th class="px-3 py-2.5">ID</th>
            <th class="px-3 py-2.5">用户名</th>
            <th class="px-3 py-2.5">角色</th>
            <th class="px-4 py-2.5">余额</th>
            <th class="px-3 py-2.5">状态</th>
            <th class="px-4 py-2.5">最后活跃时间</th>
            <th class="px-5 py-2.5 text-right">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
          <tr
            v-for="u in users"
            :key="u.id"
            class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02] transition-colors"
          >
            <td class="px-3"><input v-model="selectedUserIds" type="checkbox" :value="u.id" :aria-label="'选择用户 ' + u.email" /></td>

            <!-- User Email & Initial Avatar -->
            <td class="px-4 py-3">
              <div class="flex items-center gap-2.5">
                <div class="w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-xs uppercase">
                  {{ u.email.charAt(0) }}
                </div>
                <div class="flex flex-col">
                  <span class="admin-name font-medium" :title="u.email">{{ u.email }}</span>
                  <span v-if="u.notes" class="text-[10.5px] text-[var(--text-tertiary)] truncate max-w-[180px]">{{ u.notes }}</span>
                </div>
              </div>
            </td>

            <!-- ID -->
            <td class="px-3 py-3 font-mono text-[var(--text-tertiary)] text-xs">
              {{ u.id }}
            </td>

            <!-- Username -->
            <td class="px-3 py-3 text-[var(--text-secondary)]">
              {{ u.username || '-' }}
            </td>

            <!-- Role Badge -->
            <td class="px-3 py-3">
              <span
                class="admin-neutral-badge px-2 py-0.5"
              >
                {{ u.role === 'admin' ? '管理员' : '普通用户' }}
              </span>
            </td>

            <!-- Balance -->
            <td class="px-4 py-3">
              <div class="flex items-center gap-2">
                <span class="font-medium text-[var(--text-primary)] underline decoration-dashed decoration-gray-300 dark:decoration-neutral-600 underline-offset-4">
                  ${{ u.balance.toFixed(2) }}
                </span>
                <button
                  class="px-2 py-0.5 rounded text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  @click="openDeposit(u)"
                >
                  充值
                </button>
                <button type="button" :aria-label="`查看用户 ${u.id} 余额历史`" class="text-[11px] text-[var(--accent)]" @click="balanceHistoryUser={id:u.id,email:u.email}">历史</button>
              </div>
            </td>

            <!-- Status -->
            <td class="px-3 py-3">
              <div class="admin-status" :data-tone="u.status === 'active' ? 'success' : 'neutral'">
                <span
                  class="w-2 h-2 rounded-full"
                  :class="u.status === 'active' ? 'bg-[#34c759]' : 'bg-gray-400'"
                ></span>
                <span class="text-[12px] text-[var(--text-secondary)]">
                  {{ u.status === 'active' ? '启用' : '禁用' }}
                </span>
              </div>
            </td>

            <!-- Last Active -->
            <td class="px-4 py-3 text-[11.5px] font-mono text-[var(--text-tertiary)]">
              {{ formatDateTime(u.last_active_at) }}
            </td>

            <!-- Actions -->
            <td class="px-5 py-3 text-right whitespace-nowrap">
              <div class="inline-flex items-center gap-2.5 text-xs">
                <button
                  class="text-[var(--accent)] hover:underline flex items-center gap-0.5"
                  title="编辑"
                  @click="openEdit(u)"
                >
                  <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                  <span>编辑</span>
                </button>
                <button
                  class="admin-row-link hover:underline"
                  title="API Keys"
                  @click="openApiKeys(u)"
                >
                  API Key
                </button>
                <button
                  class="admin-row-link hover:underline"
                  title="分组权限"
                  @click="openGroups(u)"
                >
                  分组
                </button>
                <button
                  v-if="u.role !== 'admin'"
                  class="text-amber-600 dark:text-amber-400 hover:underline"
                  :title="u.status === 'active' ? '禁用' : '启用'"
                  @click="handleToggleStatus(u)"
                >
                  {{ u.status === 'active' ? '禁用' : '启用' }}
                </button>
                <button
                  v-if="u.role !== 'admin'"
                  class="admin-row-danger"
                  title="删除"
                  @click="promptDeleteUser(u)"
                >
                  删除
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination Footer -->
    <div class="admin-footer">
      <span>共 {{ total }} 位用户 · 每页 {{ pageSize }} 项</span>
      <div class="flex items-center gap-2">
        <span>{{ page }} / {{ totalPages }}</span>
        <div class="inline-flex border border-[var(--border-color)] rounded-[6px] overflow-hidden">
          <button aria-label="上一页" @click="page--; loadUsers()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page <= 1">
            ‹
          </button>
          <button aria-label="下一页" @click="page++; loadUsers()" class="px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40" :disabled="loading || page >= totalPages">
            ›
          </button>
        </div>
      </div>
    </div>

    <!-- Create User Modal -->
    <MacSheet v-if="showCreateModal" v-slot="{close}" protect-changes :show="true" title="添加用户" :loading="saving" @close="showCreateModal = false"><form class="p-5 flex flex-col gap-3.5 text-xs" @submit.prevent="submitCreate"><p v-if="actionError" role="alert" class="admin-form-error">{{ actionError }}</p><fieldset :disabled="saving || createdUserId!=null" class="contents">
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">邮箱地址 *</label>
            <input
              v-model="createForm.email"
              type="email"
              required
              placeholder="user@example.com"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">登录密码 *</label>
            <input
              v-model="createForm.password"
              type="password"
              required
              placeholder="••••••••"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">用户名</label>
              <input
                v-model="createForm.username"
                type="text"
                placeholder="可选显示名"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">角色</label>
              <select
                v-model="createForm.role"
                class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">初始余额 ($)</label>
              <input
                v-model.number="createForm.balance"
                type="number"
                step="0.1"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">并发限制</label>
              <input
                v-model.number="createForm.concurrency"
                type="number"
                min="1"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">备注</label>
            <input
              v-model="createForm.notes"
              type="text"
              placeholder="可选备注信息"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          </fieldset><CreateUserAttributes ref="createAttributes" :disabled="saving" />
          <div class="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-4 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" :disabled="saving" @click="close">取消</button>
            <button type="submit" :disabled="saving || creationNeedsReview" class="px-4 py-1.5 rounded-[6px] bg-[var(--accent)] text-white font-medium">{{ createdUserId ? '重试保存属性' : '创建' }}</button>
          </div>
        </form></MacSheet>

    <MacSheet v-if="showAttributeDefinitions" :show="true" title="用户属性定义" :loading="definitionsSaving" @close="!definitionsSaving && (showAttributeDefinitions=false)"><AttributeDefinitionsEditor @busy="definitionsSaving=$event" /></MacSheet>
    <!-- Edit User Modal -->
    <MacSheet v-if="showEditModal && activeUser" v-slot="{close}" protect-changes :show="true" title="编辑用户" :loading="saving || policySaving" @close="!saving && !policySaving && (showEditModal = false)"><form class="p-5 flex flex-col gap-3.5 text-xs" @submit.prevent="submitEdit"><fieldset :disabled="saving || policySaving" class="contents"><p v-if="actionError" role="alert" class="admin-form-error">{{ actionError }}</p><p v-if="editNotice" role="status">{{ editNotice }}</p>
          <label>邮箱<input v-model="editForm.email" type="email" required class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)]" /></label>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">用户名</label>
            <input
              v-model="editForm.username"
              type="text"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">重置密码 (留空则不修改)</label>
            <input
              v-model="editForm.password"
              type="password"
              placeholder="留空保持原密码"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">角色</label>
              <select
                v-model="editForm.role"
                class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">状态</label>
              <select
                v-model="editForm.status"
                class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
              >
                <option value="active">启用</option>
                <option value="disabled">禁用</option>
              </select>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">并发限制</label>
              <input
                v-model.number="editForm.concurrency"
                type="number"
                min="1"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">RPM 限制 (0=不限)</label>
              <input
                v-model.number="editForm.rpm_limit"
                type="number"
                min="0"
                class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">备注</label>
            <input
              v-model="editForm.notes"
              type="text"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div class="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-4 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" @click="close">取消</button>
            <button type="submit" :disabled="saving || policySaving" class="px-4 py-1.5 rounded-[6px] bg-[var(--accent)] text-white font-medium">保存修改</button>
          </div>
        </fieldset></form>
          <UserPolicyEditor :key="activeUser.id" :user-id="activeUser.id" :disabled="saving" @busy="policySaving = $event" />
</MacSheet>

    <!-- Deposit / Balance Modal -->
    <MacSheet v-if="showDepositModal && activeUser" v-slot="{close}" protect-changes :show="true" title="账户余额调整" :loading="saving || balanceGuard?.busy.value" @close="!saving && (showDepositModal = false)"><p class="text-[11px] text-[var(--text-tertiary)] mb-4">用户: {{ activeUser.email }} (当前余额: ${{ activeUser.balance.toFixed(2) }})</p>
        <p v-if="actionError || balanceGuard?.error.value" role="alert" class="admin-form-error mb-3">{{ balanceGuard?.error.value || actionError }}</p>
        <div v-if="balanceGuard?.pending.value" class="mb-4 text-xs space-y-2" role="status">
          <p>上次余额调整结果待核对。关闭或刷新不会取消操作，请勿重复提交。</p>
          <button type="button" class="text-[var(--accent)]" :disabled="saving || balanceGuard.busy.value" @click="balanceGuard.inspect">{{ balanceGuard.busy.value ? '读取中…' : '读取当前结果' }}</button>
          <p v-if="balanceGuard.snapshot.value">{{ balanceGuard.snapshot.value }}</p>
          <p v-if="balanceGuard.snapshot.value">当前余额不代表上次请求的最终状态。请结合余额记录核实；仍不确定时保留保护。</p>
          <button v-if="balanceGuard.canAcknowledge.value" type="button" class="text-[var(--accent)]" @click="acknowledgeBalance">已核对记录，结束本次操作</button>
        </div>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitDeposit">
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">操作类型</label>
            <select
              v-model="depositForm.operation"
              :disabled="saving || !balanceGuard || balanceGuard.blocked.value"
              class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            >
              <option value="add">增加余额 (+)</option>
              <option value="subtract">扣减余额 (-)</option>
              <option value="set">重置余额 (=)</option>
            </select>
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">变动金额 ($)</label>
            <input
              v-model.number="depositForm.amount"
              :disabled="saving || !balanceGuard || balanceGuard.blocked.value"
              type="number"
              step="0.01"
              min="0"
              required
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-sm focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">变动说明</label>
            <input
              v-model="depositForm.notes"
              :disabled="saving || !balanceGuard || balanceGuard.blocked.value"
              type="text"
              class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] focus:outline-none"
            />
          </div>
          <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-[var(--text-secondary)]" @click="close">取消</button>
            <button type="submit" :disabled="saving || !balanceGuard || balanceGuard.blocked.value" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white font-medium">确认调整</button>
          </div>
        </form></MacSheet>

    <!-- API Keys Modal -->
    <MacSheet v-if="showApiKeysModal && activeUser" :show="true" title="用户 API 密钥" :loading="saving || savingKeyId !== null" :dirty="keyGroupsDirty" @close="showApiKeysModal = false"><div class="p-5 overflow-y-auto"><AdminFeedback :loading="loadingApiKeys" :error="keysError" @retry="activeUser && openApiKeys(activeUser)" /><p v-if="keysNotice" role="status" class="mb-3 text-xs">{{ keysNotice }}</p><MacButton v-if="!groupsReady" size="sm" @click="loadAllGroups">重新读取分组</MacButton><p class="mb-3 text-xs text-[var(--text-secondary)]">绑定新分组时，系统可能同时授予该用户访问分组的权限。</p><p v-if="keysTotal > userApiKeys.length" class="text-xs text-[var(--text-secondary)]">当前接口返回 {{ userApiKeys.length }} / {{ keysTotal }} 个密钥，完整列表请在原版后台查看。</p>
          <div v-if="loadingApiKeys" class="text-center py-6 text-xs text-[var(--text-tertiary)]">加载中...</div>
          <div v-else-if="userApiKeys.length === 0" class="text-center py-6 text-xs text-[var(--text-tertiary)]">该用户暂无 API 密钥</div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="k in userApiKeys"
              :key="k.id"
              class="p-3 rounded-lg border border-[var(--border-color)] bg-black/[0.01] flex flex-wrap gap-3 items-center justify-between text-xs"
            >
              <div>
                <div class="font-medium text-[var(--text-primary)]">{{ k.name }}</div>
                <div class="font-mono text-[11px] text-[var(--text-tertiary)] mt-0.5">{{ k.key }}</div>
                <div class="flex flex-wrap gap-2 items-center mt-2"><label>分组<select v-model.number="keyGroupDrafts[k.id]" :aria-label="`${k.name}的分组`" :disabled="!groupsReady || savingKeyId !== null" class="ml-2 rounded border border-[var(--border-color)] bg-[var(--bg-surface)] p-1"><option :value="0">解除绑定</option><option v-if="k.group_id && !allGroups.some(g => g.id === k.group_id)" :value="k.group_id">当前分组 #{{ k.group_id }}</option><option v-for="group in allGroups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><MacButton size="sm" :loading="savingKeyId === k.id" :disabled="!groupsReady || savingKeyId !== null || keyGroupDrafts[k.id] === (k.group_id || 0)" @click="saveKeyGroup(k)">保存分组</MacButton></div>
              </div>
              <span
                class="px-2 py-0.5 rounded text-[10px] font-medium"
                :class="k.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'"
              >
                {{ k.status }}
              </span>
            </div>
          </div>
        </div></MacSheet>

    <!-- Allowed Groups Modal -->
    <MacSheet v-if="showGroupsModal && activeUser" v-slot="{close}" :dirty="JSON.stringify(userAllowedGroupIds) !== JSON.stringify(activeUser.allowed_groups || [])" :show="true" title="分组访问权限" :loading="saving" @close="showGroupsModal = false"><div class="p-5 flex flex-col gap-2 max-h-60 overflow-y-auto text-xs"><button v-if="!groupsReady" type="button" class="text-[var(--accent)]" @click="loadAllGroups">重新加载分组</button>
          <label
            v-for="g in allGroups"
            :key="g.id"
            class="flex items-center gap-2 p-2 rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
          >
            <input
              type="checkbox"
              :value="g.id"
              v-model="userAllowedGroupIds"
              class="rounded text-[var(--accent)]"
            />
            <span class="font-medium text-[var(--text-primary)]">{{ g.name }}</span>
            <span class="text-[10px] text-[var(--text-tertiary)] font-mono">({{ g.platform }})</span>
            <span v-if="g.is_exclusive" class="text-[10px] px-1 rounded bg-purple-500/10 text-purple-600 ml-auto">专属</span>
          </label>
        </div><div class="flex items-center justify-end gap-2 p-4 border-t border-[var(--border-color)]">
          <button class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)] text-xs text-[var(--text-secondary)]" @click="close">取消</button>
          <button class="px-3.5 py-1.5 rounded-[6px] bg-[var(--accent)] text-white text-xs font-medium" @click="saveAllowedGroups">保存权限</button>
        </div></MacSheet>

    <MacAlertSheet :show="!!pendingDisable" title="停用用户？" :message="`「${pendingDisable?.email || ''}」将无法继续使用账户服务。`" danger confirm-text="停用用户" :loading="statusBusy" @confirm="pendingDisable && applyUserStatus(pendingDisable, 'disabled')" @cancel="!statusBusy && (pendingDisable = null)" />
    <!-- MacAlertSheet for Delete Confirmation -->
    <MacAlertSheet
      :show="showDeleteAlert"
      title="确定要永久删除此用户吗？"
      :message="`将删除用户账户 “${userToDelete?.email || ''}”。所有关联的配置及数据都将被清理，此操作无法撤销。`"
      confirm-text="删除用户"
      cancel-text="取消"
      :danger="true"
      :loading="isDeletingUser"
      @confirm="confirmDeleteUser"
      @cancel="showDeleteAlert = false; userToDelete = null"
    />
  </div>
</template>
