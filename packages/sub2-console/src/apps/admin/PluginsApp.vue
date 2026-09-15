<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, onMounted } from 'vue';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import PluginConfiguration from './plugins/PluginConfiguration.vue';
import { usePluginStepUp } from './plugins/usePluginStepUp';
const stepUp = usePluginStepUp();
const configPlugin = ref<PluginInstallation | null>(null);
import { adminError } from './admin-feedback';
import pluginsAPI, { type PluginInstallation } from '../../api/admin/plugins';

defineProps<{
  win?: WindowInstance;
}>();

const plugins = ref<PluginInstallation[]>([]);
const loading = ref(false);
const uploading = ref(false);
const loadError = ref('');
const actionError = ref('');
const pendingToggle = ref<PluginInstallation | null>(null);
const testResult = ref('');
const pendingUninstall = ref<PluginInstallation | null>(null);
const busyPlugin = ref<number | string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

async function loadPlugins() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    const data = await pluginsAPI.list();
    if (!Array.isArray(data)) throw new Error('插件列表响应无效，请确认后端支持插件管理。');
    plugins.value = data;
  } catch (err) {
    loadError.value = adminError(err, '插件列表加载失败，请重试。');
  } finally {
    loading.value = false;
  }
}

async function handleFileSelected(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || uploading.value || busyPlugin.value != null) return;
  actionError.value = '';
  uploading.value = true;
  try {
    await stepUp.run(() => pluginsAPI.upload(file));
    await loadPlugins();
  } catch (err) {
    actionError.value = adminError(err, '插件安装失败，请检查文件及签名后重试。');
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function togglePlugin(p: PluginInstallation) {
  if (busyPlugin.value != null || uploading.value) return;
  busyPlugin.value = p.id;
  actionError.value = '';
  try {
    if (p.state === 'enabled') {
      await stepUp.run(() => pluginsAPI.disable(p.id));
    } else {
      await stepUp.run(() => pluginsAPI.enable(p.id, 100, !p.compatibility?.tested));
    }
    pendingToggle.value = null;
    await loadPlugins();
  } catch (err) {
    actionError.value = adminError(err, '插件状态更新失败，请重试。');
  } finally {
    busyPlugin.value = null;
  }
}

async function testPlugin(p: PluginInstallation) {
  if (busyPlugin.value != null || uploading.value) return;
  busyPlugin.value = p.id;
  testResult.value = '';
  actionError.value = '';
  try {
    const result = await stepUp.run(() => pluginsAPI.test(p.id));
    if (result.success) testResult.value = `「${p.name}」测试通过 · ${result.latency_ms} ms`;
    else actionError.value = result.message || '插件测试未通过，请检查配置。';
  } catch (err) { actionError.value = adminError(err, '插件测试失败，请重试。'); }
  finally { busyPlugin.value = null; }
}
async function handleUninstall(p: PluginInstallation) {
  if (busyPlugin.value != null || uploading.value) return;
  busyPlugin.value = p.id;
  actionError.value = '';
  try {
    await stepUp.run(() => pluginsAPI.remove(p.id));
    pendingUninstall.value = null;
    await loadPlugins();
  } catch (err) {
    actionError.value = adminError(err, '插件卸载失败，请重试。');
  } finally {
    busyPlugin.value = null;
  }
}

onMounted(() => {
  loadPlugins();
});
</script>

<template>
  <div class="admin-polish plugins-app h-full flex flex-col select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <div class="flex items-center gap-2.5">
        <img :src="getAppIcon('plugins')" class="w-7 h-7 drop-shadow-sm shrink-0" alt="Plugins" />
        <span class="text-xs font-semibold text-gray-900 dark:text-gray-100">插件管理</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-black/5 dark:bg-white/10 text-gray-500 font-mono">{{ plugins.length }}</span>
      </div>
    </div>

    <!-- Main Content Area -->
    <AdminFeedback :loading="loading" :error="loadError" :notice="actionError" context="插件管理" @retry="loadPlugins" @dismiss="actionError = ''" />
    <div class="admin-content flex-1 overflow-y-auto p-5 space-y-4">
      <!-- Section Header -->
      <div class="flex flex-col gap-3 pb-4 border-b border-black/[0.06] dark:border-white/[0.08] sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0 space-y-1">
          <h2 class="text-sm font-semibold text-gray-900 dark:text-white">
            已安装的插件
          </h2>
          <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            安装和管理独立运行的 OAuth 出站传输插件。API Key 流程不受影响。
          </p>
          <div class="hidden">
            <span class="rounded-md bg-black/5 dark:bg-white/10 px-2 py-0.5">初期能力：仅 OpenAI OAuth 出站传输</span>
            <span class="rounded-md bg-black/5 dark:bg-white/10 px-2 py-0.5">作用域为平台与账号类型，不修改账号数据，也不需要在账号页逐个开启。</span>
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <input
            ref="fileInput"
            type="file"
            accept=".s2plugin,application/zip"
            class="hidden"
            @change="handleFileSelected"
          />
          <MacButton size="sm" variant="primary" :disabled="uploading" @click="fileInput?.click()">
            <svg class="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            {{ uploading ? '处理中...' : '安装插件' }}
          </MacButton>
          <MacButton size="sm" :disabled="loading" aria-label="刷新插件列表" @click="loadPlugins">
            <svg class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </MacButton>
        </div>
      </div>

      <!-- Upload Hint -->
      <p class="text-[11px] text-gray-500 dark:text-gray-400">
        仅接受 .s2plugin 包；默认要求可信发布者签名。
      </p>

      <!-- Blue Notice Box -->
      <details class="admin-quiet-note">
        <summary class="cursor-pointer font-medium">插件运行与管理说明</summary>
        <p>插件安装、启用、停用和配置由 Sub2API 宿主动态处理，通常不需要重启宿主实例。只有宿主版本或宿主配置本身变化时，才按部署方式执行重启。</p>
        <p class="text-black/50 dark:text-white/50 text-[11px]">系统设置中的“插件管理”开关仅控制侧边栏菜单显示，不会停止已经加载或正在运行的插件。</p>
      </details>

      <!-- Empty State -->
      <div
        v-if="plugins.length === 0 && !loading && !loadError"
        class="admin-state flex flex-col items-center justify-center"
      >
        <div class="w-12 h-12 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] flex items-center justify-center mb-3 text-gray-400">
          <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
        </div>
        <p class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">
          尚未安装插件
        </p>
        <p class="text-xs text-gray-500 dark:text-gray-400 max-w-md mb-4">
          选择本机的 .s2plugin 文件进行安装。Sub2API 不会自动下载第三方插件。
        </p>
        <MacButton size="sm" variant="primary" @click="fileInput?.click()">
          安装插件
        </MacButton>
      </div>

      <!-- Plugins Grid -->
      <div v-else-if="plugins.length > 0" class="admin-responsive-grid grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="p in plugins"
          :key="p.id"
          class="admin-card p-4 space-y-3"
        >
          <div class="flex items-start justify-between">
            <div>
              <h3 class="text-sm font-bold text-gray-900 dark:text-white">{{ p.name }}</h3>
              <p class="text-[10px] text-gray-400 font-mono">v{{ p.version }} · {{ p.author || '未提供作者' }}</p>
            </div>
            <span
              class="admin-status"
              :data-tone="p.state === 'enabled' ? 'success' : p.state === 'error' ? 'danger' : p.state === 'starting' || p.state === 'incompatible' ? 'warning' : 'neutral'"
            >
              {{ p.state === 'enabled' ? '已启用' : p.state === 'error' ? '异常' : p.state === 'starting' ? '启动中' : p.state === 'incompatible' ? '版本不兼容' : '已停用' }}
            </span>
          </div>
          <p class="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{{ p.description }}</p>
          <div class="flex items-center justify-between pt-2 border-t border-black/[0.04] dark:border-white/[0.06] text-xs">
            <button :disabled="busyPlugin != null || p.state === 'incompatible' || p.state === 'starting'" class="text-blue-500 hover:text-blue-700 font-medium" @click="pendingToggle = p">
              {{ p.state === 'enabled' ? '停用' : '启用' }}
            </button>
            <button :disabled="busyPlugin != null" class="text-blue-500" @click="configPlugin = p">配置</button>
            <button :disabled="busyPlugin != null || p.state !== 'enabled'" class="text-blue-500" @click="testPlugin(p)">测试</button>
            <button :disabled="busyPlugin != null" class="text-red-500 hover:text-red-700 font-medium" @click="pendingUninstall = p">
              卸载
            </button>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div v-else-if="loading" class="flex min-h-[200px] items-center justify-center" aria-hidden="true">
        <div class="w-6 h-6 border-2 border-black/10 dark:border-white/10 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    </div>
    <PluginConfiguration v-if="configPlugin" :key="configPlugin.id" :plugin="configPlugin" @close="configPlugin = null" />
    <p v-if="testResult" role="status" class="admin-footer">{{ testResult }}</p>
    <MacAlertSheet :show="!!pendingToggle" :title="pendingToggle?.state === 'enabled' ? '停用插件？' : '启用插件？'" :message="actionError || (pendingToggle?.state === 'enabled' ? `「${pendingToggle.name}」的传输能力将停止。` : `「${pendingToggle?.name || ''}」将处理全部匹配流量。${pendingToggle?.compatibility?.tested ? '' : '此版本未经兼容性测试，确认后将接受该版本并启用。'}`)" danger :loading="busyPlugin != null" confirm-text="确认变更" @confirm="pendingToggle && togglePlugin(pendingToggle)" @cancel="busyPlugin == null && (pendingToggle = null)" />
    <MacAlertSheet :show="!!pendingUninstall" title="卸载插件？" :message="actionError || `「${pendingUninstall?.name || ''}」将被移除，相关传输能力将停止。`"
      danger :loading="busyPlugin != null" confirm-text="卸载插件" @confirm="pendingUninstall && handleUninstall(pendingUninstall)" @cancel="busyPlugin == null && (pendingUninstall = null)" />
    <MacSheet :show="stepUp.visible.value" title="验证身份后继续插件操作" :loading="stepUp.verifying.value" @close="stepUp.cancel">
      <p>后端要求二次身份验证，验证通过后将重试刚才的操作一次。</p>
      <form @submit.prevent="stepUp.verify"><label>动态验证码<input v-model="stepUp.code.value" inputmode="numeric" autocomplete="one-time-code" maxlength="6" /></label><p v-if="stepUp.error.value" role="alert">{{ stepUp.error.value }}</p></form>
      <template #footer><MacButton :disabled="stepUp.verifying.value" @click="stepUp.cancel">取消</MacButton><MacButton variant="primary" :disabled="stepUp.verifying.value" @click="stepUp.verify">验证并继续</MacButton></template>
    </MacSheet>

  </div>
</template>

<style scoped>
.plugins-app {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
</style>
