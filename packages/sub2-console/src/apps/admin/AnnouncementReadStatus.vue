<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import * as annAPI from '../../api/admin/announcements';
import { adminError } from './admin-feedback';
import type { Announcement, AnnouncementUserReadStatus } from '@/types';
const props = defineProps<{ announcement: Announcement }>();
const emit = defineEmits<{ (e: 'close'): void }>();
const items = ref<AnnouncementUserReadStatus[]>([]);
const loading = ref(false), error = ref(''), search = ref(''), appliedSearch = ref('');
const page = ref(1), pageSize = ref(20), total = ref(0);
const sortBy = ref('email'), sortOrder = ref<'asc' | 'desc'>('asc');
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)));
let version = 0;
let controller: AbortController | null = null;
let closed = false;
function cancelLoad() { version++; controller?.abort(); controller = null; }
function close() { closed = true; cancelLoad(); emit('close'); }
onUnmounted(() => { closed = true; cancelLoad(); });
async function load() {
  if (closed) return;
  cancelLoad();
  const request = version, id = props.announcement.id;
  const nextController = new AbortController(); controller = nextController;
  loading.value = true; error.value = ''; items.value = [];
  const current = () => !closed && request === version && id === props.announcement.id;
  try {
    const result = await annAPI.getReadStatus(id, page.value, pageSize.value, {
      search: appliedSearch.value || undefined, sort_by: sortBy.value, sort_order: sortOrder.value
    }, { signal: nextController.signal });
    if (!current()) return;
    total.value = result.total;
    if (page.value > totalPages.value) { page.value = totalPages.value; await load(); return; }
    items.value = result.items;
  } catch (err) { if (current()) error.value = adminError(err, '阅读状态加载失败，请重试。'); }
  finally { if (current()) { loading.value = false; controller = null; } }
}
function applySearch() { appliedSearch.value = search.value.trim(); page.value = 1; return load(); }
function changeSort() { page.value = 1; return load(); }
function changePageSize() { page.value = 1; return load(); }
function changePage(next: number) { if (loading.value || next < 1 || next > totalPages.value) return; page.value = next; return load(); }
watch(() => props.announcement.id, () => {
  search.value = ''; appliedSearch.value = ''; page.value = 1; total.value = 0;
  sortBy.value = 'email'; sortOrder.value = 'asc'; load();
}, { immediate: true });
</script>

<template>
  <MacSheet data-testid="announcement-read-status" :show="true" :title="`阅读状态 · ${announcement.title}`" @close="close">
    <div class="announcement-read">
      <form class="search" @submit.prevent="applySearch">
        <label class="field">搜索用户<input v-model="search" type="search" placeholder="邮箱或用户名" /></label>
        <MacButton size="sm" @click="applySearch">搜索</MacButton>
        <MacButton size="sm" :disabled="loading" @click="load">刷新</MacButton>
      </form>
      <div class="sort">
        <label class="field">排序字段<select v-model="sortBy" @change="changeSort"><option value="email">邮箱</option><option value="username">用户名</option><option value="balance">余额</option></select></label>
        <label class="field">排序方向<select v-model="sortOrder" @change="changeSort"><option value="asc">升序</option><option value="desc">降序</option></select></label>
      </div>
      <p v-if="loading" role="status" class="state">正在加载阅读状态…</p>
      <div v-else-if="error" role="alert" class="state"><p class="admin-form-error">{{ error }}</p><MacButton size="sm" @click="load">重试</MacButton></div>
      <p v-else-if="!items.length" class="state">{{ appliedSearch ? '没有匹配的用户，请调整搜索条件。' : '暂无用户阅读状态。' }}</p>
      <div v-else class="read-table" tabindex="0" role="region" aria-label="用户阅读状态列表，可横向滚动">
        <table>
          <thead><tr><th scope="col">邮箱</th><th scope="col">用户名</th><th scope="col">余额</th><th scope="col">符合展示条件</th><th scope="col">阅读时间</th></tr></thead>
          <tbody><tr v-for="item in items" :key="item.user_id">
            <td>{{ item.email }}</td><td>{{ item.username || '—' }}</td><td>${{ Number(item.balance).toFixed(2) }}</td><td>{{ item.eligible ? '是' : '否' }}</td>
            <td>{{ item.read_at ? new Date(item.read_at).toLocaleString('zh-CN', { hour12: false }) : '未读' }}</td>
          </tr></tbody>
        </table>
      </div>
      <div class="pagination">
        <label class="field">每页条数<select v-model.number="pageSize" @change="changePageSize"><option :value="10">10</option><option :value="20">20</option><option :value="50">50</option><option :value="100">100</option></select></label>
        <span aria-live="polite">共 {{ total }} 位用户 · {{ page }} / {{ totalPages }}</span>
        <div class="page-buttons"><MacButton size="sm" :disabled="loading || page <= 1" @click="changePage(page - 1)">上一页</MacButton><MacButton size="sm" :disabled="loading || page >= totalPages" @click="changePage(page + 1)">下一页</MacButton></div>
      </div>
    </div>
    <template #footer><MacButton size="sm" @click="close">关闭</MacButton></template>
  </MacSheet>
</template>

<style scoped>
.announcement-read { min-width: 0; font-size: 12px; container-type: inline-size; }
.search, .sort, .pagination, .page-buttons { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; }
.field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.search .field { flex: 1 1 160px; }
.sort { margin: 12px 0; }
input, select { min-width: 0; max-width: 100%; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--input-bg, var(--window-bg-solid)); color: var(--text-primary); }
input:focus-visible, select:focus-visible, .read-table:focus-visible { outline: 2px solid var(--accent-color, #007aff); outline-offset: 2px; }
.state { padding: 24px 0; color: var(--text-secondary); }
.read-table { max-width: 100%; overflow: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--border-color); min-width: 82px; max-width: 200px; overflow-wrap: anywhere; }
th { color: var(--text-secondary); }
.pagination { margin-top: 14px; align-items: center; }
@container (max-width: 340px) { .search .field { flex-basis: 100%; } .page-buttons { width: 100%; justify-content: space-between; } }
</style>
