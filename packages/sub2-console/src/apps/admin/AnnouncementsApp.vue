<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, onMounted, computed } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import { adminError } from './admin-feedback';
import * as annAPI from '../../api/admin/announcements';
import AnnouncementTargetingEditor from './AnnouncementTargetingEditor.vue';
import AnnouncementReadStatus from './AnnouncementReadStatus.vue';
import type { Announcement, AnnouncementTargeting, AnnouncementStatus, AnnouncementNotifyMode, CreateAnnouncementRequest, UpdateAnnouncementRequest } from '@/types';

defineProps<{
  win?: WindowInstance;
}>();

const announcements = ref<Announcement[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const loadError = ref('');
const actionError = ref('');
const deleting = ref(false);
let loadVersion = 0;
const searchQuery = ref('');
const statusFilter = ref('');

// Dialog state
const showEditDialog = ref(false);
const showDeleteConfirm = ref<Announcement | null>(null);
const showPreviewDialog = ref<Announcement | null>(null);
const saving = ref(false);
const originalForm = ref('');
const targetingError = ref('');
const readAnnouncement = ref<Announcement | null>(null);

const form = ref({
  id: 0,
  title: '',
  content: '',
  status: 'active' as AnnouncementStatus,
  notify_mode: 'silent' as AnnouncementNotifyMode,
  starts_at: '',
  ends_at: '',
  targeting: { any_of: [] } as AnnouncementTargeting
});
const editorDirty = computed(() => JSON.stringify(form.value) !== originalForm.value);

function resetForm() {
  form.value = {
    id: 0,
    title: '',
    content: '',
    status: 'active',
    notify_mode: 'silent',
    starts_at: '',
    ends_at: '',
    targeting: { any_of: [] }
  };
}

async function loadAnnouncements() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await annAPI.list(page.value, pageSize.value, {
      search: searchQuery.value || undefined,
      status: statusFilter.value || undefined
    });
    if (version !== loadVersion) return;
    announcements.value = res?.items || [];
    total.value = res?.total || 0;
    if (page.value > totalPages.value) { page.value = totalPages.value; await loadAnnouncements(); }
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '公告加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function openCreate() {
  actionError.value = '';
  resetForm();
  originalForm.value = JSON.stringify(form.value);
  targetingError.value = '';
  showEditDialog.value = true;
}

function openEdit(item: Announcement) {
  actionError.value = '';
  form.value = {
    id: item.id,
    title: item.title,
    content: item.content || '',
    status: item.status || 'active',
    notify_mode: item.notify_mode || 'silent',
    starts_at: toLocalInput(item.starts_at),
    ends_at: toLocalInput(item.ends_at),
    targeting: JSON.parse(JSON.stringify(item.targeting ?? { any_of: [] }))
  };
  originalForm.value = JSON.stringify(form.value);
  targetingError.value = '';
  showEditDialog.value = true;
}

function toLocalInput(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
async function handleSave() {
  if (saving.value) return;
  if (!form.value.title.trim()) { actionError.value = '请填写公告标题。'; return; }
  if (!form.value.content.trim()) { actionError.value = '请填写公告内容。'; return; }
  if (targetingError.value) { actionError.value = targetingError.value; return; }
  if ([form.value.starts_at, form.value.ends_at].some(v => v && !Number.isFinite(new Date(v).getTime()))) { actionError.value = '请填写有效的日期时间。'; return; }
  actionError.value = '';
  if (form.value.starts_at && form.value.ends_at && new Date(form.value.ends_at) <= new Date(form.value.starts_at)) {
    actionError.value = '结束时间须晚于开始时间。'; return;
  }
  saving.value = true;
  try {
    const current: CreateAnnouncementRequest = {
      title: form.value.title,
      content: form.value.content,
      status: form.value.status,
      notify_mode: form.value.notify_mode,
      targeting: form.value.targeting,
      starts_at: form.value.starts_at ? Math.floor(new Date(form.value.starts_at).getTime() / 1000) : undefined,
      ends_at: form.value.ends_at ? Math.floor(new Date(form.value.ends_at).getTime() / 1000) : undefined
    };
    if (form.value.id) {
      const original = JSON.parse(originalForm.value) as typeof form.value;
      const payload: UpdateAnnouncementRequest = {};
      for (const key of ['title', 'content', 'status', 'notify_mode', 'targeting'] as const) {
        if (JSON.stringify(form.value[key]) !== JSON.stringify(original[key])) Object.assign(payload, { [key]: current[key] });
      }
      for (const key of ['starts_at', 'ends_at'] as const) {
        if (form.value[key] !== original[key]) payload[key] = current[key] ?? 0;
      }
      if (Object.keys(payload).length) await annAPI.update(form.value.id, payload);
    } else {
      await annAPI.create(current);
    }
    showEditDialog.value = false;
    await loadAnnouncements();
  } catch (err) {
    actionError.value = adminError(err, '公告保存失败，请检查后重试。');
  } finally {
    saving.value = false;
  }
}

async function handleDelete(item: Announcement) {
  if (deleting.value) return;
  deleting.value = true;
  actionError.value = '';
  try {
    await annAPI.deleteAnnouncement(item.id);
    showDeleteConfirm.value = null;
    await loadAnnouncements();
  } catch (err) {
    actionError.value = adminError(err, '公告删除失败，请重试。');
  } finally {
    deleting.value = false;
  }
}

function fmtDate(s?: string) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString('zh-CN', { hour12: false }); }
  catch { return s; }
}

function statusBadge(status?: string) {
  if (status === 'active') return { text: '展示中', cls: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' };
  if (status === 'draft') return { text: '草稿', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
  if (status === 'archived') return { text: '已归档', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' };
  return { text: status || '—', cls: 'bg-gray-100 text-gray-500' };
}

function notifyBadge(mode?: string) {
  if (mode === 'popup') return { text: '弹窗', cls: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400' };
  return { text: '静默', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' };
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));

onMounted(() => {
  loadAnnouncements();
});
</script>

<template>
  <div class="admin-polish announcements-app h-full flex flex-col select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-2.5">
        <img :src="getAppIcon('announcements')" class="w-7 h-7 drop-shadow-sm shrink-0" alt="Announcements" />
        <span class="text-xs font-semibold text-gray-900 dark:text-gray-100">公告管理</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 font-mono">{{ total }}</span>
      </div>
    </div>

    <!-- Filters & Actions Bar -->
    <div class="admin-filters">
      <input
        v-model="searchQuery"
        @keyup.enter="page = 1; loadAnnouncements()"
        aria-label="搜索公告，按回车应用"
        type="text"
        placeholder="搜索公告..."
        class="text-xs px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e] focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-48"
      />
      <select
        v-model="statusFilter"
        @change="page = 1; loadAnnouncements()"
        aria-label="公告状态"
        class="text-xs px-2 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#2c2c2e]"
      >
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="active">展示中</option>
        <option value="archived">已归档</option>
      </select>

      <div class="flex-1"></div>

      <MacButton size="sm" :disabled="loading" @click="loadAnnouncements()">
        <svg class="w-3.5 h-3.5 mr-1" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        刷新
      </MacButton>
      <MacButton size="sm" variant="primary" @click="openCreate">
        <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
        创建公告
      </MacButton>
    </div>

    <!-- Table -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="公告管理" @retry="loadAnnouncements" @dismiss="actionError = ''" />
    <div class="admin-table-scroll">
      <table v-if="announcements.length > 0" class="admin-table">
        <thead class="sticky top-0 z-10">
          <tr class="bg-gray-50/90 dark:bg-[#2a2a2c]/90 backdrop-blur-sm border-b border-black/[0.06] dark:border-white/[0.08]">
            <th class="text-left px-4 py-2.5 font-medium text-gray-500">标题</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">状态</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">通知方式</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">展示条件</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">有效期</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">创建时间</th>
            <th class="text-left px-3 py-2.5 font-medium text-gray-500">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in announcements"
            :key="item.id"
            class="border-b border-black/[0.04] dark:border-white/[0.04] hover:bg-gray-50 dark:hover:bg-[#2c2c2e] transition-colors"
          >
            <td class="px-4 py-2.5">
              <div class="admin-name font-medium" :title="item.title">{{ item.title }}</div>
              <div class="text-[10px] text-gray-400 mt-0.5">#{{ item.id }} · {{ fmtDate(item.created_at) }}</div>
            </td>
            <td class="px-3 py-2.5">
              <span class="admin-status" :data-tone="item.status === 'active' ? 'success' : 'neutral'">
                {{ statusBadge(item.status).text }}
              </span>
            </td>
            <td class="px-3 py-2.5">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-medium" :class="notifyBadge((item as any).notify_mode).cls">
                {{ notifyBadge((item as any).notify_mode).text }}
              </span>
            </td>
            <td class="px-3 py-2.5 text-gray-600 dark:text-gray-300">
              {{ item.targeting?.any_of?.length ? `定向用户 · ${item.targeting.any_of.length} 个条件组` : '全部用户' }}
            </td>
            <td class="px-3 py-2.5 text-gray-500">
              <div>开始: {{ (item as any).starts_at ? fmtDate((item as any).starts_at) : '立即' }}</div>
              <div>结束: {{ (item as any).ends_at ? fmtDate((item as any).ends_at) : '永久' }}</div>
            </td>
            <td class="px-3 py-2.5 text-gray-500">{{ fmtDate(item.created_at) }}</td>
            <td class="px-3 py-2.5">
              <div class="flex items-center gap-1.5">
                <button @click="showPreviewDialog = item" class="text-[10px] text-blue-500 hover:text-blue-700">预览</button>
                <button @click="openEdit(item)" class="admin-row-link">编辑</button>
                <button @click="readAnnouncement = item" class="admin-row-link">阅读状态</button>
                <button @click="showDeleteConfirm = item" class="admin-row-danger">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Empty State -->
      <div v-else-if="!loading && !loadError" class="admin-state flex flex-col items-center justify-center">
        <div class="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
          </svg>
        </div>
        <h3 class="mb-1">{{ searchQuery || statusFilter ? '没有匹配的公告' : '还没有公告' }}</h3>
        <p class="mb-4">{{ searchQuery || statusFilter ? '调整关键词或状态筛选后重试。' : '创建第一条公告，向用户发布通知。' }}</p>
        <MacButton size="sm" variant="primary" @click="openCreate">
          <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          创建公告
        </MacButton>
      </div>

      <!-- Loading Spinner -->
      <div v-else-if="loading" class="flex items-center justify-center py-20" aria-hidden="true">
        <div class="w-6 h-6 border-2 border-emerald-300 border-t-emerald-600 rounded-full animate-spin"></div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="total > 0" class="admin-footer">
      <span>共 {{ total }} 条</span>
      <div class="flex items-center gap-1.5">
        <button @click="page > 1 && (page--, loadAnnouncements())" :disabled="loading || page <= 1" class="px-2 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-30">上一页</button>
        <span class="px-2">{{ page }} / {{ totalPages }}</span>
        <button @click="page < totalPages && (page++, loadAnnouncements())" :disabled="loading || page >= totalPages" class="px-2 py-1 rounded border border-black/10 dark:border-white/10 disabled:opacity-30">下一页</button>
      </div>
    </div>

    <!-- Create/Edit Modal -->
    <MacSheet data-testid="announcement-editor" protect-changes :dirty="editorDirty" :show="showEditDialog" :title="form.id ? '编辑公告' : '创建公告'" :loading="saving" @close="!saving && (showEditDialog = false)">
          <p v-if="actionError" role="alert" class="admin-form-error mb-3">{{ actionError }}</p>
          <div class="space-y-3 text-xs">
            <div>
              <label class="block text-gray-500 mb-1">标题</label>
              <input v-model="form.title" aria-label="标题" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" />
            </div>
            <div>
              <label class="block text-gray-500 mb-1">内容（支持 Markdown）</label>
              <textarea v-model="form.content" aria-label="公告内容" rows="5" class="w-full p-2.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c] leading-relaxed"></textarea>
            </div>
            <div class="announcement-fields grid grid-cols-2 gap-3">
              <div>
                <label class="block text-gray-500 mb-1">状态</label>
                <select v-model="form.status" aria-label="公告状态" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]">
                  <option value="draft">草稿</option>
                  <option value="active">展示中</option>
                  <option value="archived">已归档</option>
                </select>
              </div>
              <div>
                <label class="block text-gray-500 mb-1">通知方式</label>
                <select v-model="form.notify_mode" aria-label="通知方式" class="w-full px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]">
                  <option value="silent">静默</option>
                  <option value="popup">弹窗</option>
                </select>
              </div>
            </div>
            <div class="announcement-fields grid grid-cols-2 gap-3">
              <div>
                <label class="block text-gray-500 mb-1">开始时间</label>
                <input v-model="form.starts_at" aria-label="开始时间" type="datetime-local" step="1" class="w-full px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" />
                <p class="text-[10px] text-gray-400 mt-0.5">留空表示立即生效</p>
              </div>
              <div>
                <label class="block text-gray-500 mb-1">结束时间</label>
                <input v-model="form.ends_at" aria-label="结束时间" type="datetime-local" step="1" class="w-full px-2 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-[#3a3a3c]" />
                <p class="text-[10px] text-gray-400 mt-0.5">留空表示永久生效</p>
              </div>
            </div>
          </div>
          <AnnouncementTargetingEditor v-if="showEditDialog" v-model="form.targeting" :disabled="saving" @validation="targetingError = $event" />
      <template #footer="{ close }">
          <div class="flex justify-end gap-2">
            <MacButton size="sm" :disabled="saving" @click="close">取消</MacButton>
            <MacButton size="sm" variant="primary" :disabled="saving" @click="handleSave">保存</MacButton>
          </div>
      </template>
    </MacSheet>

    <!-- Delete Modal -->
    <AnnouncementReadStatus v-if="readAnnouncement" :key="readAnnouncement.id" :announcement="readAnnouncement" @close="readAnnouncement = null" />
    <MacAlertSheet :show="!!showDeleteConfirm" title="删除公告？" :message="`「${showDeleteConfirm?.title || ''}」将被删除，此操作无法撤销。`"
      danger :loading="deleting" confirm-text="删除公告" @confirm="showDeleteConfirm && handleDelete(showDeleteConfirm)" @cancel="!deleting && (showDeleteConfirm = null)" />

    <!-- Preview Modal -->
    <MacSheet v-if="showPreviewDialog" :show="true" :title="showPreviewDialog.title" @close="showPreviewDialog = null">
          <div class="text-xs text-gray-600 dark:text-gray-300 whitespace-pre-wrap leading-relaxed mb-4">
            {{ showPreviewDialog.content }}
          </div>
          <div class="flex justify-end">
            <MacButton size="sm" @click="showPreviewDialog = null">关闭</MacButton>
          </div>
    </MacSheet>
  </div>
</template>

<style scoped>
.announcements-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
@container (max-width: 460px) { .announcement-fields { grid-template-columns: minmax(0, 1fr); } }
.announcements-app { container-type: inline-size; }
.announcement-fields input { min-width: 0; max-width: 100%; }
</style>
