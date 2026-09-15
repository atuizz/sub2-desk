<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { MacButton, MacSheet } from '@sub2-mac/core'
import { accountsAPI } from '@/api/admin/accounts'
import type { Account, GrokMediaEligibilityMode, GrokMediaEligibilityState } from '@/types'

// Parent integration: v-if="mediaAccount" :account="mediaAccount"
// @close="mediaAccount=null" @saved="reloadAccounts". No Account/extra mutation is emitted.
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ close: []; saved: [state: GrokMediaEligibilityState] }>()
const supported = computed(() => props.account.platform === 'grok' && props.account.type === 'oauth' && Number.isSafeInteger(props.account.id) && props.account.id > 0)
const state = ref<GrokMediaEligibilityState | null>(null)
const mode = ref<GrokMediaEligibilityMode>('auto')
const ready = ref(false), loading = ref(false), saving = ref(false)
const error = ref(''), notice = ref('')
const needsReload = ref(false)
const busy = computed(() => loading.value || saving.value)
const dirty = computed(() => !!state.value && mode.value !== state.value.mode)
const canSave = computed(() => supported.value && ready.value && !needsReload.value && !busy.value && dirty.value)
let generation = 0, disposed = false, closed = false
const reasons: Record<string, string> = {
  override_enabled: '已手动启用媒体请求。', override_disabled: '已手动禁用媒体请求。',
  billing_inconclusive: '现有计费信息不足以确定订阅情况。',
  billing_unobserved: '尚未获取到有效计费信息。', billing_forbidden: '上游拒绝了计费信息查询。',
  billing_free_tier: '当前计费信息显示为免费账号。', eligible: '当前账号信息满足媒体请求资格。'
}
const reasonText = computed(() => state.value ? reasons[state.value.reason] || '服务器已返回当前媒体请求资格。' : '')
function current(version: number, accountID: number) {
  return !disposed && !closed && version === generation && supported.value && props.account.id === accountID
}
function readError(e: unknown): string {
  const failure = e as { response?: { status?: number }; status?: number }
  const status = failure?.response?.status ?? failure?.status
  if (status === 404 || status === 405 || status === 501) return '当前账号或后端暂未提供媒体资格查询，请核对账号及后端版本后重试。'
  if (status === 401 || status === 403) return '当前会话无权读取媒体资格，请检查登录状态和管理员权限。'
  return '媒体资格读取失败，当前选择已保留。请重新读取后再保存。'
}
async function load() {
  if (!supported.value || disposed || closed || busy.value) return
  const version = ++generation, accountID = props.account.id
  const keepDraft = !!state.value && (dirty.value || needsReload.value)
  loading.value = true; ready.value = false; error.value = ''; notice.value = ''
  try {
    const next = await accountsAPI.getGrokMediaEligibility(accountID)
    if (!current(version, accountID)) return
    state.value = next
    if (!keepDraft) mode.value = next.mode
    ready.value = true; needsReload.value = false
  } catch (e) {
    if (current(version, accountID)) { error.value = readError(e); needsReload.value = true }
  } finally { if (current(version, accountID)) loading.value = false }
}
async function save() {
  if (!canSave.value || disposed || closed) return
  const version = ++generation, accountID = props.account.id, requestedMode = mode.value
  saving.value = true; error.value = ''; notice.value = ''
  try {
    const next = await accountsAPI.updateGrokMediaEligibility(accountID, requestedMode)
    if (!current(version, accountID)) return
    if (next.mode !== requestedMode) throw new Error('服务器返回的模式与本次选择不一致。')
    state.value = next; mode.value = next.mode; ready.value = true; needsReload.value = false
    notice.value = '媒体资格设置已保存。'
    emit('saved', { ...next })
  } catch {
    if (current(version, accountID)) {
      ready.value = false; needsReload.value = true
      error.value = '保存未完成或结果未确认，当前选择已保留。请重新读取服务器状态后再保存。'
    }
  } finally { if (current(version, accountID)) saving.value = false }
}
function close() {
  if (saving.value || closed) return
  closed = true; generation++
  emit('close')
}
watch([() => props.account.id, () => props.account.platform, () => props.account.type], () => {
  generation++; closed = false; loading.value = false; saving.value = false
  state.value = null; mode.value = 'auto'; ready.value = false; needsReload.value = false; error.value = ''; notice.value = ''
  void load()
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { disposed = true; generation++ })
</script>

<template>
  <MacSheet :show="true" :title="`媒体资格 · ${account.name}`" :loading="saving" @close="close">
    <div class="grok-media-sheet">
      <p v-if="!supported" role="alert">媒体资格设置仅适用于 Grok OAuth 账号。</p>
      <template v-else>
        <p class="intro">选择此账号是否参与图片和视频请求的调度。</p>
        <p v-if="loading" role="status">正在读取媒体资格…</p>
        <section v-if="state" class="decision" aria-label="服务器媒体资格">
          <span>{{ ready ? '当前资格' : '上次读取的资格' }}</span>
          <strong :class="state.eligible ? 'eligible' : 'ineligible'">{{ state.eligible ? '允许媒体请求' : '不允许媒体请求' }}</strong>
          <p>{{ reasonText }}</p>
          <details v-if="state.reason"><summary>查看判定原因</summary><code>{{ state.reason }}</code></details>
        </section>
        <p v-else-if="!loading" class="unknown">媒体资格尚未确认。</p>
        <fieldset :disabled="busy || !state || !ready || needsReload">
          <legend>媒体请求模式</legend>
          <label>处理方式
            <select v-model="mode" aria-label="媒体请求模式">
              <option value="auto">自动判断</option>
              <option value="enabled">手动启用</option>
              <option value="disabled">手动禁用</option>
            </select>
          </label>
          <p v-if="state">{{ mode === 'auto' ? '由服务器根据账号信息判断媒体资格。' : mode === 'enabled' ? '允许调度媒体请求；实际生成仍取决于上游权限与额度。' : '此账号不参与图片和视频请求的调度。' }}</p>
        </fieldset>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      </template>
    </div>
    <template #footer>
      <MacButton v-if="supported" :disabled="busy" @click="load">重新读取</MacButton>
      <MacButton :disabled="saving" @click="close">关闭</MacButton>
      <MacButton v-if="supported" variant="primary" :loading="saving" :disabled="!canSave" @click="save">保存设置</MacButton>
    </template>
  </MacSheet>
</template>

<style scoped>
.grok-media-sheet{display:grid;gap:16px;min-width:0;font-size:12px;line-height:1.6}.grok-media-sheet p{margin:0;color:var(--text-secondary)}.decision{display:grid;gap:5px;padding:14px;border-radius:10px;background:var(--bg-surface);border:1px solid var(--border-subtle)}.decision>span{font-size:11px;color:var(--text-secondary)}.decision>strong{font-size:15px;font-weight:600}.eligible{color:var(--color-success,#248a3d)}.ineligible{color:var(--text-primary)}.decision summary{font-size:11px;color:var(--text-secondary);cursor:pointer}.decision code{display:block;margin-top:5px;font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-secondary)}fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:8px}legend{padding:0 0 8px;font-weight:600}label{display:grid;gap:6px}select{width:100%;min-width:0;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface);color:var(--text-primary);font:inherit}select:disabled{opacity:.6}select:focus-visible,summary:focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:2px}.grok-media-sheet .error{color:var(--color-danger,#d73831)}.grok-media-sheet .notice{color:var(--color-success,#248a3d)}
</style>
