<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { useAuthStore } from '../stores/auth';
import { getPublicSettings, getCustomPage } from '../api/public';
import { getSettings as getAdminSettings } from '../api/admin/settings';
import type { PublicSettings, CustomMenuItem } from '../types';
import { resolvePublicRoute, safeExternalUrl } from './content';
import SafeContent from './SafeContent.vue';
import KeyUsagePage from './KeyUsagePage.vue';
import PublicCatalog from './PublicCatalog.vue';
import './public.css';
import adminCompliance from './admin-compliance.zh.md?raw';
import adminComplianceEnglish from './admin-compliance.en.md?raw';

// Optional controlled path; a root mount also works with window.location/history.
// / is intentionally not claimed: the desktop retains its existing root entry.
const props = defineProps<{ path?: string; adminMenuItems?: CustomMenuItem[] }>();
const auth = useAuthStore();
const browserPath = ref(typeof window === 'undefined' ? '/home' : window.location.pathname);
const route = computed(() => resolvePublicRoute(props.path ?? browserPath.value));
function updatePath() { browserPath.value = window.location.pathname; }
onMounted(() => {
  window.addEventListener('popstate', updatePath);
  if (auth.token && !auth.user && !auth.isLoading) void auth.initAuth({ redirectOnFailure: false });
});
const settings = ref<PublicSettings | null>(null); const loading = ref(false); const error = ref('');
const content = ref(''); const external = ref(''); const slug = ref(''); const title = ref('');
const restricted = ref(false); const missing = ref(false);
const adminMenuItems = ref<CustomMenuItem[]>([]);
const menuItems = computed(() => auth.isAuthenticated
  ? [...(settings.value?.custom_menu_items || []), ...(auth.isAdmin ? adminMenuItems.value : [])]
    .filter(item => item.visibility !== 'admin' || auth.isAdmin)
    .filter((item, index, all) => all.findIndex(other => other.id === item.id) === index)
  : []);
const language = ref<'zh' | 'en'>('zh');
const legalContent = computed(() => route.value?.page === 'legal' && route.value.id === 'admin-compliance'
  ? language.value === 'en' ? adminComplianceEnglish : adminCompliance : content.value);
const displayTitle = computed(() => route.value?.page === 'legal' && route.value.id === 'admin-compliance' && language.value === 'en'
  ? 'Deployment and Operations Compliance Commitment' : title.value);
let generation = 0; let controller: AbortController | undefined;
onBeforeUnmount(() => { generation++; controller?.abort(); window.removeEventListener('popstate', updatePath); });
async function load() {
  const request = ++generation; controller?.abort(); controller = new AbortController();
  const r = route.value;
  settings.value = null; adminMenuItems.value = []; content.value = ''; external.value = ''; slug.value = ''; error.value = ''; restricted.value = false; missing.value = false;
  title.value = r ? ({ home: '首页', 'key-usage': '密钥用量', legal: '法律文档', custom: '自定义页面', 'model-plaza': '模型广场', monitor: '渠道状态', 'available-channels': '可用渠道' }[r.page]) : '页面不存在';
  if (!r) { loading.value = false; return; }
  loading.value = true;
  try {
    const data = await getPublicSettings(controller.signal);
    if (request !== generation) return;
    settings.value = data;
    if (r.page === 'custom' && auth.isAdmin && !data.custom_menu_items?.some(item => item.id === r.id)) {
      // Public settings deliberately omit admin menus. Retain only menus from
      // the protected response, never publish/cache the full settings object.
      const menus = props.adminMenuItems ?? (await getAdminSettings()).custom_menu_items;
      if (request !== generation || !auth.isAdmin) return;
      adminMenuItems.value = menus || [];
    }
    if (r.page === 'home') {
      title.value = data.site_name || '首页';
      const raw = data.home_content || '';
      if (/^https?:\/\//i.test(raw.trim())) {
        external.value = safeExternalUrl(raw);
        if (!external.value) throw new Error('首页网址无效，请联系管理员。');
      } else content.value = raw;
    } else if (r.page === 'legal') {
      const doc = r.id === 'admin-compliance' ? { title: '部署与运营合规承诺', content_md: adminCompliance }
        : data.login_agreement_documents?.find(item => item.id === r.id);
      if (doc) { title.value = doc.title; content.value = doc.content_md; } else missing.value = true;
    } else if (r.page === 'custom') {
      if (!auth.isAuthenticated) { restricted.value = true; return; }
      const item = menuItems.value.find(item => item.id === r.id);
      if (!item) { missing.value = true; return; }
      title.value = item.label;
      const pageSlug = item.page_slug || (item.url?.startsWith('md:') ? item.url.slice(3) : '');
      if (pageSlug) {
        const markdown = await getCustomPage(pageSlug, controller.signal, auth.token || undefined);
        if (request !== generation) return;
        slug.value = pageSlug; content.value = markdown;
      } else {
        external.value = safeExternalUrl(item.url || '');
        if (!external.value) throw new Error('页面网址无效，请联系管理员。');
      }
    }
  } catch (e) {
    if (request === generation) error.value = (e as { code?: string })?.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED'
      ? '请先返回桌面完成管理员合规确认，再重试。'
      : e instanceof Error ? e.message : '内容读取失败，请重试。';
  }
  finally { if (request === generation) loading.value = false; }
}
watch(() => [props.path, browserPath.value, auth.user?.id, auth.user?.role, auth.token, auth.sessionRevision, props.adminMenuItems], load, { immediate: true, flush: 'sync' });
</script>
<template>
  <main class="public-surface">
    <header class="public-toolbar"><h1>{{ displayTitle }}</h1><label v-if="route?.page === 'legal'">{{ language === 'en' ? 'Language' : '语言' }}<select v-model="language" aria-label="法律文档语言"><option value="zh">中文</option><option value="en">English</option></select></label><nav class="public-nav" aria-label="公开页面"><a href="/home">{{ language === 'en' && route?.page === 'legal' ? 'Home' : '首页' }}</a><a href="/key-usage">密钥用量</a><a href="/">桌面</a></nav></header>
    <div class="public-body">
      <KeyUsagePage v-if="route?.page === 'key-usage'" />
      <template v-else>
        <p v-if="loading" class="public-message" role="status">正在读取…</p>
        <div v-else-if="error" role="alert"><p class="public-message public-error">{{ error }}</p><MacButton @click="load">重试</MacButton></div>
        <p v-else-if="!route || missing" class="public-message">页面不存在或尚未发布。</p>
        <p v-else-if="restricted" class="public-message">此页面需要登录。<a class="public-link" href="/login">前往登录</a></p>
        <PublicCatalog v-else-if="settings && (route.page === 'model-plaza' || route.page === 'monitor' || route.page === 'available-channels')" :key="route.page" :page="route.page" :settings="settings" />
        <template v-else>
          <p v-if="route.page === 'legal' && route.id !== 'admin-compliance' && settings?.login_agreement_updated_at" class="public-message">更新时间：{{ settings.login_agreement_updated_at }}</p>
          <p v-if="external" class="public-message">此内容由外部网站提供。<a :href="external" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="public-link">在新标签页打开外部内容 ↗</a></p>
          <SafeContent v-else-if="content" :content="legalContent" :markdown="route.page !== 'home'" :slug="slug" :tools="route.page === 'custom'" :language="language" />
          <p v-else class="public-message">{{ route.page === 'home' ? settings?.site_subtitle || '欢迎使用 API 服务。' : '暂无内容。' }}</p>
          <p v-if="route.page === 'legal' && route.id !== 'admin-compliance' && language === 'en'" class="public-message">This document is shown in the language published by the administrator. No translated version was supplied.</p>
          <nav v-if="route.page === 'home'" class="public-nav" aria-label="服务入口">
            <a v-if="settings?.model_plaza_enabled" href="/model-plaza">模型广场</a><a v-if="settings?.channel_monitor_enabled" href="/monitor">渠道状态</a>
            <a v-if="settings?.available_channels_enabled" href="/available-channels">可用渠道</a>
            <a v-for="doc in settings?.login_agreement_documents || []" :key="doc.id" :href="`/legal/${encodeURIComponent(doc.id)}`">{{ doc.title }}</a>
            <template v-if="auth.isAuthenticated"><a v-for="item in menuItems" :key="item.id" :href="`/custom/${encodeURIComponent(item.id)}`">{{ item.label }}</a></template>
          </nav>
        </template>
      </template>
    </div>
  </main>
</template>
