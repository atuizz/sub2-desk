<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MacAlertSheet, MacButton, MacGroupCard } from '@sub2-mac/core';
import * as systemAPI from '@/api/admin/system';
import { version as consoleVersion } from '../../../../package.json';

const releaseURL = 'https://github.com/Wei-Shaw/sub2api/releases/latest';
const info = ref<systemAPI.VersionInfo | null>(null);
const currentVersion = ref('');
const versionError = ref('');
const checking = ref(false);
const checkError = ref('');
const checkedAt = ref('');
const operationError = ref('');
const operationResult = ref('');
const pendingRestart = ref(false);
const busy = ref(false);
const confirmation = ref<'update' | 'rollback' | 'restart' | null>(null);
const rollbackVersions = ref<systemAPI.RollbackVersionInfo[]>([]);
const rollbackVersion = ref('');
const rollbackError = ref('');
const loadingRollbacks = ref(false);
let controller: AbortController | null = null;
let disposed = false;

const canInstall = computed(() => Boolean(info.value?.build_type === 'release' && info.value.has_update && info.value.latest_version && !checkError.value && !checking.value && !pendingRestart.value));
const statusText = computed(() => {
  if (checking.value) return '正在检查更新…';
  if (checkError.value) return '未能确认最新版本';
  if (!info.value) return '尚未检查';
  if (info.value.cached) return info.value.has_update ? `缓存记录中有新版本 ${info.value.latest_version}` : `缓存记录中未发现更新（${info.value.latest_version}）`;
  if (info.value.has_update) return `发现新版本 ${info.value.latest_version}`;
  return `当前已是最新版本 ${info.value.latest_version}`;
});
const confirmationTitle = computed(() => ({ update: '安装后端更新', rollback: '回滚后端版本', restart: '重启后端服务' })[confirmation.value || 'update']);
const confirmationMessage = computed(() => {
  if (confirmation.value === 'restart') return '重启会短暂中断 API 服务。确认后由后端执行重启。';
  if (confirmation.value === 'rollback') return `将恢复到 ${rollbackVersion.value || '本地备份版本'}。请确认已有可用的数据备份；版本替换后可能需要重启。`;
  return `将下载并安装 ${info.value?.latest_version}。请先备份数据并确认版本兼容；安装成功后可能需要重启。`;
});
function message(error: unknown, fallback: string): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : fallback;
}

async function check(force = true) {
  if (checking.value || busy.value) return;
  controller?.abort();
  const request = new AbortController();
  controller = request;
  checking.value = true;
  checkError.value = '';
  info.value = null;
  // Read the installed version independently: GitHub availability must not hide it.
  void loadCurrentVersion(request.signal);
  try {
    const result = await systemAPI.checkUpdates(force, request.signal);
    if (disposed || request.signal.aborted) return;
    if (typeof result?.current_version === 'string') currentVersion.value = result.current_version;
    if (!result || typeof result.has_update !== 'boolean' || typeof result.latest_version !== 'string' || !result.latest_version.trim()) {
      throw new Error('后端未返回有效版本信息，请检查后端版本与更新源。');
    }
    info.value = result;
    checkError.value = result.warning?.trim() || '';
    checkedAt.value = new Date().toLocaleTimeString('zh-CN');
  } catch (error) {
    if (disposed || request.signal.aborted) return;
    checkError.value = message(error, '无法检查更新，请检查后端连接后重试。');
  } finally {
    if (!disposed && controller === request) checking.value = false;
  }
}
async function loadCurrentVersion(signal: AbortSignal) {
  versionError.value = '';
  try {
    const result = await systemAPI.getVersion(signal);
    if (disposed || signal.aborted) return;
    if (typeof result?.version !== 'string' || !result.version.trim()) throw new Error('后端未返回当前版本。');
    currentVersion.value = result.version.trim();
  } catch (error) {
    if (!disposed && !signal.aborted) versionError.value = message(error, '当前版本读取失败。');
  }
}
async function loadRollbacks() {
  if (loadingRollbacks.value) return;
  loadingRollbacks.value = true;
  rollbackError.value = '';
  try {
    const result = await systemAPI.getRollbackVersions();
    if (!disposed) rollbackVersions.value = result.versions || [];
  } catch (error) {
    if (!disposed) rollbackError.value = message(error, '无法加载历史版本');
  } finally {
    if (!disposed) loadingRollbacks.value = false;
  }
}
async function confirmOperation() {
  if (busy.value || !confirmation.value) return;
  const action = confirmation.value;
  if (action === 'update' && !canInstall.value) return;
  busy.value = true;
  operationError.value = '';
  operationResult.value = '';
  try {
    const result = action === 'update' ? await systemAPI.performUpdate()
      : action === 'rollback' ? await systemAPI.rollback(rollbackVersion.value || undefined)
        : await systemAPI.restartService();
    if (disposed) return;
    pendingRestart.value = 'need_restart' in result && result.need_restart === true;
    operationResult.value = pendingRestart.value ? '版本替换成功，请重启后端服务后再检查版本。'
      : action === 'restart' ? '重启指令已发送，服务恢复后请重新检查版本。' : result.message;
    confirmation.value = null;
    info.value = null;
  } catch (error) {
    if (!disposed) operationError.value = message(error, '操作未完成，请检查后端状态后重试。');
  } finally {
    if (!disposed) busy.value = false;
  }
}
function reloadConsole() { window.location.reload(); }
function acceptedCompliance() { void check(true); }
onMounted(() => {
  void check(false);
  window.addEventListener('admin-compliance-accepted', acceptedCompliance);
});
onUnmounted(() => {
  disposed = true;
  controller?.abort();
  window.removeEventListener('admin-compliance-accepted', acceptedCompliance);
});
</script>

<template>
  <section class="software-update" aria-label="软件更新">
    <header><h2>软件更新</h2><p>查看后端版本、发行说明与维护操作。</p></header>
    <div v-if="operationResult" class="update-notice" role="status">{{ operationResult }}</div>
    <div v-if="operationError" class="update-notice is-error" role="alert">{{ operationError }}</div>
    <MacGroupCard title="Sub2API 后端">
      <div class="update-section">
        <div class="update-heading"><div><h3>当前运行版本</h3><strong class="update-version">{{ currentVersion || '尚未获取' }}</strong></div><MacButton variant="primary" :loading="checking" :disabled="busy" @click="check(true)">检查后端更新</MacButton></div>
        <p class="update-status" role="status">{{ statusText }}</p>
        <p v-if="versionError" class="is-error" role="alert">当前版本读取失败，显示值可能是上次记录。{{ versionError }}</p>
        <div v-if="checkError" class="update-notice is-error" role="alert">
          <p>更新检查未完成，请重试或查看发行页面。</p>
          <details><summary>查看原因</summary><p>{{ checkError }}</p></details>
        </div>
        <div class="update-meta"><span v-if="checkedAt">上次响应 {{ checkedAt }}</span><span v-if="info?.cached">缓存结果</span><span v-if="info?.build_type === 'source'">源码构建</span><a :href="releaseURL" target="_blank" rel="noopener noreferrer">查看后端发行页面 ↗</a></div>
        <div v-if="info?.has_update && info.latest_version" class="update-release">
          <h3>{{ info.cached ? '缓存中的发行版本' : checkError ? '尚未确认的发行版本' : '可用版本' }} {{ info.latest_version }}</h3>
          <pre v-if="info.release_info?.body">{{ info.release_info.body }}</pre>
          <p v-if="info.build_type !== 'release'">当前构建不支持在线安装，请由站点管理员按原部署方式更新。</p>
          <MacButton v-else variant="primary" :disabled="!canInstall || busy" @click="confirmation = 'update'">安装更新</MacButton>
        </div>
      </div>
    </MacGroupCard>
    <MacGroupCard title="维护操作">
      <div class="update-section">
        <div class="update-heading"><div><h3>重启服务</h3><p>用于使已安装的后端版本生效。</p></div><MacButton :disabled="busy || checking" @click="confirmation = 'restart'">重启服务</MacButton></div>
        <details class="rollback-details" @toggle="($event.target as HTMLDetailsElement).open && loadRollbacks()"><summary>恢复到历史版本</summary>
          <p v-if="rollbackError" class="is-error" role="alert">{{ rollbackError }} <button type="button" @click="loadRollbacks">重试</button></p>
          <div class="update-actions"><select v-model="rollbackVersion" aria-label="回滚目标版本" :disabled="loadingRollbacks || busy"><option value="">本地备份版本</option><option v-for="release in rollbackVersions" :key="release.version" :value="release.version">{{ release.version }}</option></select><MacButton :disabled="busy || checking" @click="confirmation = 'rollback'">执行回滚</MacButton></div>
        </details>
      </div>
    </MacGroupCard>
    <MacGroupCard title="Sub2 Desk 控制台">
      <div class="update-section update-heading"><div><h3>版本 {{ consoleVersion }}</h3><p>前端由站点管理员部署，重新载入可获取站点当前内容。</p></div><MacButton :disabled="busy" @click="reloadConsole">重新载入</MacButton></div>
    </MacGroupCard>
    <MacAlertSheet :show="confirmation !== null" :title="confirmationTitle" :message="confirmationMessage" confirm-text="确认执行" cancel-text="取消" danger :loading="busy" @confirm="confirmOperation" @cancel="confirmation = null" />
  </section>
</template>

<style scoped>
.software-update { display: grid; gap: 22px; min-width: 0; }
h2 { font-size: 20px; font-weight: 600; letter-spacing: -.03em; }
h3 { font-size: 13px; font-weight: 600; }
p { font-size: 12px; color: var(--text-secondary); line-height: 1.7; }
.update-section { padding: 18px; display: grid; gap: 12px; min-width: 0; }
.update-heading { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.update-heading > div { min-width: 0; flex: 1 1 180px; }
.update-version { display: block; margin-top: 4px; font-size: 24px; font-weight: 600; overflow-wrap: anywhere; }
.update-status { color: var(--text-primary); font-weight: 500; }
.update-notice { padding: 12px 14px; border: 1px solid var(--border-subtle); border-radius: 9px; font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.is-error { color: var(--error, #d2463d); }
.update-meta, .update-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: 11px; color: var(--text-secondary); }
a, .rollback-details button { color: var(--accent); }
summary { cursor: pointer; font-size: 12px; padding: 6px 0; }
.update-release, .rollback-details { padding-top: 12px; border-top: 1px solid var(--border-subtle); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 220px; overflow: auto; margin: 12px 0; font: 12px/1.7 var(--font-mac); color: var(--text-secondary); }
select { min-height: 32px; max-width: 100%; background: var(--bg-surface); color: var(--text-primary); border: 1px solid var(--border-subtle); border-radius: 7px; padding: 4px 10px; }
</style>
