<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { MacButton, MacSheet, type WindowInstance } from '@sub2-mac/core';
import { useAuthStore } from '../../stores/auth';
import announcementsAPI from '../../api/announcements';
import type { UserAnnouncement } from '../../types';
import SafeContent from '../../public/SafeContent.vue';
import '../../public/public.css';
const props = withDefaults(defineProps<{ win?: WindowInstance; autoPopup?: boolean }>(), { autoPopup: true });
const auth = useAuthStore();
const items = ref<UserAnnouncement[]>([]); const loading = ref(false); const error = ref('');
const unreadOnly = ref(false); const selected = ref<UserAnnouncement | null>(null); const reading = ref(false); const readError = ref('');
const dismissed = new Set<number>();
let generation = 0; let readGeneration = 0;
const unread = computed(() => items.value.filter(item => !item.read_at).length);
const visible = computed(() => items.value.filter(item => !unreadOnly.value || !item.read_at));
function nextPopup() {
  if (!props.autoPopup || selected.value) return;
  selected.value = items.value.find(item => !item.read_at && item.notify_mode === 'popup' && !dismissed.has(item.id)) || null;
}
function close() {
  if (reading.value) return;
  if (selected.value) dismissed.add(selected.value.id);
  selected.value = null; readError.value = ''; readGeneration++;
}
function open(item: UserAnnouncement) { if (reading.value) return; selected.value = item; readError.value = ''; readGeneration++; }
async function load() {
  const request = ++generation; loading.value = false; error.value = '';
  if (!auth.isAuthenticated) { items.value = []; return; }
  loading.value = true;
  try {
    const data = await announcementsAPI.list(false);
    if (request !== generation) return;
    items.value = data;
    if (selected.value) selected.value = data.find(item => item.id === selected.value?.id) || null;
    nextPopup();
  } catch { if (request === generation) error.value = '公告加载失败，请重试。'; }
  finally { if (request === generation) loading.value = false; }
}
async function markRead() {
  if (reading.value || !selected.value || selected.value.read_at || !auth.isAuthenticated) return;
  const id = selected.value.id; const request = ++readGeneration; const identity = auth.user?.id;
  reading.value = true; readError.value = '';
  try {
    await announcementsAPI.markRead(id);
    if (request !== readGeneration || identity !== auth.user?.id) return;
    // Commit only after the server acknowledgement; failure preserves unread.
    items.value = items.value.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item);
    selected.value = null; nextPopup();
  } catch { if (request === readGeneration) readError.value = '标记已读失败，公告仍保留为未读。请重试。'; }
  finally { if (request === readGeneration) reading.value = false; }
}
watch(() => [auth.user?.id, auth.token], () => {
  generation++; readGeneration++; dismissed.clear(); items.value = []; selected.value = null; reading.value = false; readError.value = ''; load();
}, { immediate: true });
onBeforeUnmount(() => { generation++; readGeneration++; });
</script>
<template>
  <section class="public-surface">
    <header class="public-toolbar"><h1>公告 <small>{{ unread }} 条未读</small></h1><label><input v-model="unreadOnly" type="checkbox" /> 仅未读</label><MacButton :disabled="loading || reading || !auth.isAuthenticated" @click="load">刷新</MacButton></header>
    <div class="public-body">
      <p v-if="!auth.isAuthenticated" class="public-message">请登录后查看公告。</p>
      <p v-else-if="loading" role="status" class="public-message">正在读取公告…</p>
      <p v-else-if="error" role="alert" class="public-message public-error">{{ error }}</p>
      <p v-else-if="!visible.length" class="public-message">{{ unreadOnly ? '没有未读公告。' : '暂无公告。' }}</p>
      <template v-if="auth.isAuthenticated && !loading"><button v-for="item in visible" :key="item.id" class="public-row" @click="open(item)"><span><strong>{{ item.title }}</strong><br /><time>{{ item.created_at }}</time></span><span>{{ item.read_at ? '已读' : '未读' }}</span></button></template>
    </div>
    <MacSheet :show="selected !== null" :title="selected?.title || '公告'" :loading="reading" @close="close">
      <template v-if="selected"><p class="public-message">{{ selected.created_at }}</p><SafeContent :content="selected.content" /><p v-if="readError" role="alert" class="public-error">{{ readError }}</p></template>
      <template #footer><MacButton :disabled="reading" @click="close">稍后再读</MacButton><MacButton v-if="selected && !selected.read_at" variant="primary" :loading="reading" @click="markRead">标记已读</MacButton><MacButton v-else @click="close">关闭</MacButton></template>
    </MacSheet>
  </section>
</template>
