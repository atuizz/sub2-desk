<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacButton, MacToggle, MacGroupCard, MacDraftGuard } from '@sub2-mac/core';
import { getOpenCodeGoUsageSettings, updateOpenCodeGoUsageSettings } from '@/api/admin/accounts';
import type { OpenCodeGoUsageSettings } from '@/types';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const loaded = ref(false), loading = ref(false), saving = ref(false), error = ref(''), message = ref('');
const form = ref<OpenCodeGoUsageSettings>({ enabled: false, interval_minutes: 60, debounce_minutes: 5 });
const saved = ref<OpenCodeGoUsageSettings>({ enabled: false, interval_minutes: 60, debounce_minutes: 5 });
const dirty = computed(() => loaded.value && JSON.stringify(form.value) !== JSON.stringify(saved.value));
let generation = 0, disposed = false;

function validate(value: OpenCodeGoUsageSettings): string {
  if (!value.enabled) return '';
  if (!Number.isInteger(value.debounce_minutes) || value.debounce_minutes < 1 || value.debounce_minutes > 60) {
    return '请求安静等待须为 1–60 分钟的整数。';
  }
  if (!Number.isInteger(value.interval_minutes) || value.interval_minutes < 5 || value.interval_minutes > 1440) {
    return '请求持续时的最长等待须为 5–1440 分钟的整数。';
  }
  if (value.debounce_minutes >= value.interval_minutes) {
    return '请求安静等待必须小于请求持续时的最长等待。';
  }
  return '';
}

async function load() {
  if (!auth.isAdmin || saving.value) return;
  const rev = ++generation;
  loading.value = true; loaded.value = false; error.value = ''; message.value = '';
  try {
    const data = await getOpenCodeGoUsageSettings();
    if (disposed || rev !== generation || !auth.isAdmin) return;
    form.value = { ...data };
    saved.value = { ...data };
    loaded.value = true;
  } catch (failure) {
    if (!disposed && rev === generation) error.value = (failure as { message?: string })?.message || '无法读取 OpenCode Go 用量刷新设置';
  } finally { if (rev === generation) loading.value = false; }
}

async function save() {
  if (!auth.isAdmin || !loaded.value || !dirty.value || saving.value || loading.value) return;
  const problem = validate(form.value);
  if (problem) { error.value = problem; return; }
  error.value = ''; message.value = '';
  const rev = generation;
  const snapshot = { ...form.value };
  saving.value = true;
  try {
    const updated = await updateOpenCodeGoUsageSettings(snapshot);
    if (disposed || rev !== generation || !auth.isAdmin) return;
    form.value = { ...updated };
    saved.value = { ...updated };
    message.value = 'OpenCode Go 用量刷新设置已保存';
  } catch (failure) {
    // 保存失败保留草稿：不回滚表单，只显示后端返回的 message。
    if (!disposed && rev === generation) error.value = (failure as { message?: string })?.message || '保存 OpenCode Go 用量刷新设置失败';
  } finally { if (rev === generation) saving.value = false; }
}

function reload() {
  if (saving.value || loading.value) return;
  form.value = { ...saved.value };
  error.value = ''; message.value = '';
  void load();
}

watch([() => auth.user?.id, () => auth.user?.role], () => {
  generation++; loaded.value = false; loading.value = false; saving.value = false;
  error.value = ''; message.value = '';
  if (auth.isAdmin) void load();
}, { flush: 'sync' });
onMounted(load);
onUnmounted(() => { disposed = true; generation++; });
</script>

<template>
  <section class="ocg-settings" aria-label="OpenCode Go 用量刷新">
    <MacDraftGuard :dirty="dirty" :busy="saving" />
    <MacGroupCard title="OpenCode Go 用量刷新" description="刷新上游 OpenCode Go 账号上报的用量窗口；默认关闭，仅对单独开启的账号生效。">
      <template v-if="!auth.isAdmin">
        <p class="ocg-feedback">只有管理员可以配置 OpenCode Go 用量刷新。</p>
      </template>
      <template v-else>
        <p v-if="loading" role="status" class="ocg-feedback">正在读取 OpenCode Go 用量刷新设置…</p>
        <p v-if="error" role="alert" class="ocg-feedback ocg-error">{{ error }}</p>
        <p v-if="message" role="status" class="ocg-feedback ocg-ok">{{ message }}</p>
        <div v-if="loaded" class="ocg-body">
          <div class="ocg-row">
            <div>
              <div class="ocg-label">启用全局自动刷新</div>
              <div class="ocg-hint">仅刷新账号自身也开启自动刷新的账号。手动刷新不受影响。</div>
            </div>
            <MacToggle v-model="form.enabled" :disabled="saving || loading" aria-label="启用全局自动刷新" />
          </div>
          <div v-if="form.enabled" class="ocg-numbers">
            <label><span>请求安静等待（分钟）</span>
              <input v-model.number="form.debounce_minutes" type="number" min="1" max="60" :disabled="saving" data-testid="opencode-go-usage-global-debounce" />
              <span class="ocg-hint">范围 1–60 分钟，且必须小于刷新间隔。最后一次模型请求安静满此时长后再抓取用量。</span>
            </label>
            <label><span>请求持续时的最长等待（分钟）</span>
              <input v-model.number="form.interval_minutes" type="number" min="5" max="1440" :disabled="saving" data-testid="opencode-go-usage-global-interval" />
              <span class="ocg-hint">范围 5–1440 分钟。请求持续不断导致安静等待一直后移时，最晚在此时间强制刷新。</span>
            </label>
          </div>
          <footer class="ocg-actions">
            <span role="status">{{ dirty ? '有未保存的修改' : (loaded ? '已保存' : '等待读取配置') }}</span>
            <MacButton size="sm" :disabled="saving || loading" @click="reload">重新读取</MacButton>
            <MacButton size="sm" variant="primary" :loading="saving" :disabled="!loaded || !dirty || loading" data-testid="opencode-go-usage-global-save" @click="save">保存</MacButton>
          </footer>
        </div>
      </template>
    </MacGroupCard>
  </section>
</template>

<style scoped>
.ocg-settings{display:grid;min-width:0;font-size:13px;container-type:inline-size;container-name:ocg-settings}
.ocg-feedback{margin:12px 14px;padding:12px 14px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-surface);font-size:12px;color:var(--text-secondary)}
.ocg-error{color:var(--status-danger,#c43731);overflow-wrap:anywhere}
.ocg-ok{color:var(--status-success,#1f7a3a)}
.ocg-body{display:grid;gap:0}
.ocg-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--border-subtle)}
.ocg-label{font-size:13px;font-weight:600}
.ocg-hint{font-size:11px;color:var(--text-secondary);line-height:1.5;margin-top:2px}
.ocg-numbers{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;border-bottom:1px solid var(--border-subtle)}
.ocg-numbers label{display:grid;gap:7px;min-width:0}
.ocg-numbers label>span:first-child{font-size:12px;font-weight:600}
.ocg-numbers input{box-sizing:border-box;width:100%;height:34px;min-width:0;padding:6px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--window-bg-solid);color:var(--text-primary);font-size:12px}
.ocg-settings :is(input,button):focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:3px}
.ocg-settings :disabled{opacity:.55}
.ocg-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:12px 16px;background:var(--bg-surface-subtle)}
.ocg-actions>span{flex:1;min-width:120px;color:var(--text-secondary);font-size:11px}
@container ocg-settings (max-width:520px){.ocg-numbers{grid-template-columns:minmax(0,1fr)}.ocg-actions>span{flex-basis:100%}}
</style>
