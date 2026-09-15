<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { MacAlertSheet, MacButton, MacGroupCard, MacSheet, MacToggle } from '@sub2-mac/core';
import { useAuthStore } from '@/stores/auth';
import { adminPaymentAPI } from '@/api/admin/payment';
import type { ProviderInstance } from '@/types/payment';
import { usePaymentWriteGuard } from '@/utils/usePaymentWriteGuard';
import type { PaymentWriteMarker } from '@/utils/paymentWriteJournal';
import { configFields, currencies, editProvider, newProvider, normalizeProviders, parseCustomMethods, parseProviderLimits, providerOptions, providerPayload, providerTypes, typeLabels, type CustomMethod, type ProviderLimits } from './paymentProviderForm';

defineProps<{ sheetTarget?: HTMLElement | null }>();
const auth = useAuthStore();
const callbackOrigin = typeof location === 'undefined' ? '' : location.origin;
const providers = ref<ProviderInstance[]>([]), ready = ref(false), loading = ref(false), saving = ref(false);
const writeGuard = usePaymentWriteGuard(() => auth.isAdmin ? auth.user?.id : null, () => auth.token, () => auth.sessionRevision);
const pendingWrite = computed(() => writeGuard.entries.value.find(entry => entry.scope === 'providers'));
const unknown = computed(() => !!pendingWrite.value || !!writeGuard.storageError.value);
const reviewWrite = ref<PaymentWriteMarker | null>(null);
const operationLabels = { 'provider-create': '新增收款提供方', 'provider-update': '修改收款提供方', 'provider-delete': '删除收款提供方', 'provider-sort': '调整提供方排序', refund: '退款', 'refund-query': '查询退款' };
const error = ref(''), notice = ref('');
const draft = ref<ProviderInstance | null>(null), baseline = ref<ProviderInstance | null>(null), deleting = ref<ProviderInstance | null>(null);
const limits = ref<ProviderLimits>({}), customMethods = ref<CustomMethod[]>([]);
const customChanged = ref(false), limitsChanged = ref(false);
let disposed = false, generation = 0;
const owner = () => `${auth.user?.id ?? ''}:${auth.sessionRevision ?? 0}:${writeGuard.sessionIdentity.value}:${auth.isAdmin}`;
const current = (g: number, o: string) => !disposed && generation === g && owner() === o && auth.isAdmin && writeGuard.journal.matchesSession(auth.user?.id || 0, auth.token);
const writable = computed(() => auth.isAdmin && writeGuard.available.value && ready.value && !loading.value && !saving.value && !unknown.value);
const initialDraft = ref('');
const dirty = computed(() => !!draft.value && (JSON.stringify(draft.value) !== initialDraft.value || limitsChanged.value || customChanged.value));
const fields = computed(() => configFields(draft.value?.provider_key || ''));
const availableTypes = computed(() => [...new Set([...(providerTypes[draft.value?.provider_key || ''] || []), ...customMethods.value.map(m => m.type).filter(Boolean), ...(baseline.value?.supported_types || [])])]);
const limitTypes = computed(() => draft.value?.provider_key === 'stripe' ? ['stripe'] : draft.value?.supported_types || []);

function clearEditor() { draft.value = null; baseline.value = null; customMethods.value = []; limits.value = {}; limitsChanged.value = false; customChanged.value = false; initialDraft.value = ''; }
function closeEditor() { if (!saving.value) clearEditor(); }
function resetSession() { generation++; providers.value = []; ready.value = false; loading.value = false; saving.value = false; error.value = ''; notice.value = ''; deleting.value = null; reviewWrite.value = null; clearEditor(); }
watch([owner, () => writeGuard.sessionValid.value], () => { resetSession(); if (auth.isAdmin && writeGuard.sessionValid.value) void load(); }, { flush: 'sync' });
onUnmounted(() => { disposed = true; resetSession(); });
onMounted(() => { void load(); });

async function read(g: number, o: string) {
  const response = await adminPaymentAPI.getProviders();
  if (!current(g, o)) return false;
  providers.value = normalizeProviders(response.data);
  ready.value = true;
  return true;
}
async function load() {
  if (!auth.isAdmin || !writeGuard.sessionValid.value || loading.value || saving.value || draft.value || deleting.value) return;
  const g = ++generation, o = owner();
  ready.value = false; loading.value = true; error.value = ''; notice.value = '';
  try { await read(g, o); writeGuard.refresh(); }
  catch { if (current(g, o)) error.value = '收款提供方读取失败，请重试；当前不能修改配置。'; }
  finally { if (current(g, o)) loading.value = false; }
}
function askReviewWrite() {
  if (!ready.value || loading.value || saving.value || draft.value || deleting.value || !pendingWrite.value) return;
  reviewWrite.value = { ...pendingWrite.value };
}
async function confirmReviewWrite() {
  if (!reviewWrite.value || !ready.value || saving.value) return;
  const context = writeGuard.capture(), marker = reviewWrite.value;
  if (!context.current()) { writeGuard.refresh(); return; }
  saving.value = true;
  try {
    const outcome = await writeGuard.journal.resolve(context, marker);
    if (!context.current()) return;
    if (outcome.kind === 'confirmed') { reviewWrite.value = null; error.value = ''; notice.value = '已记录核对确认，后续操作可重新提交。'; }
    else error.value = outcome.message || '尚不能解除保护，请重新读取后核对。';
  } finally { if (context.current()) saving.value = false; }
}
function open(provider?: ProviderInstance) {
  if (!writable.value) return;
  error.value = ''; notice.value = '';
  try {
    if (provider && !providerTypes[provider.provider_key]) throw new Error('当前版本暂不支持编辑此提供方。');
    const next = provider ? editProvider(provider) : newProvider('easypay', Math.max(-1, ...providers.value.map(p => p.sort_order)) + 1, typeof location === 'undefined' ? '' : location.origin);
    const parsedLimits = parseProviderLimits(next.limits), parsedMethods = next.provider_key === 'easypay' ? parseCustomMethods(next.config.customMethods) : [];
    baseline.value = provider ? editProvider(provider) : null; draft.value = next; limits.value = parsedLimits; customMethods.value = parsedMethods;
    limitsChanged.value = false; customChanged.value = false; initialDraft.value = JSON.stringify(next);
  } catch (e) { error.value = (e as Error).message; }
}
function changeProvider() {
  if (!draft.value || baseline.value || !writable.value) return;
  const next = newProvider(draft.value.provider_key, draft.value.sort_order, typeof location === 'undefined' ? '' : location.origin);
  next.name = draft.value.name; draft.value = next; limits.value = {}; customMethods.value = []; limitsChanged.value = false; customChanged.value = false;
}
function toggleType(type: string, enabled: boolean) {
  if (!draft.value || !writable.value || !availableTypes.value.includes(type)) return;
  draft.value.supported_types = enabled ? [...new Set([...draft.value.supported_types, type])] : draft.value.supported_types.filter(t => t !== type);
}
function pasteSecret(field: string, event: ClipboardEvent) {
  if (!draft.value || !writable.value || !fields.value.some(f => f.key === field && f.secret)) return;
  const text = event.clipboardData?.getData('text');
  // Password inputs strip newlines. Preserve an entire pasted PEM in the draft.
  if (text && /[\r\n]/.test(text)) { event.preventDefault(); draft.value.config[field] = text; }
}
function setLimit(type: string, field: string, value: string) {
  if (!writable.value) return;
  limitsChanged.value = true;
  if (!limits.value[type]) limits.value[type] = {};
  if (!value.trim()) delete limits.value[type][field]; else limits.value[type][field] = Number(value);
  if (!Object.keys(limits.value[type]).length) delete limits.value[type];
}
function removeCustom(index: number) {
  if (!draft.value || !writable.value) return;
  const [method] = customMethods.value.splice(index, 1); customChanged.value = true;
  if (method) draft.value.supported_types = draft.value.supported_types.filter(t => t !== method.type);
}
async function save() {
  if (!writable.value || !draft.value) return;
  let payload: Partial<ProviderInstance>;
  try {
    const value = editProvider(draft.value);
    if (limitsChanged.value) value.limits = Object.keys(limits.value).length ? JSON.stringify(limits.value) : '';
    if (customChanged.value) value.config.customMethods = customMethods.value.length ? JSON.stringify(customMethods.value) : '';
    payload = providerPayload(value, baseline.value);
    if (!Object.keys(payload).length) { notice.value = '没有未保存的修改。'; return; }
  } catch (e) { error.value = (e as Error).message; return; }
  const id = baseline.value?.id, g = generation, o = owner();
  const context = writeGuard.capture();
  if (!context.current()) { writeGuard.refresh(); return; }
  saving.value = true; error.value = ''; notice.value = '';
  let submitted = false;
  try {
    const outcome = await writeGuard.journal.run(context, 'providers', id ? 'provider-update' : 'provider-create', id ? [id] : [], async () => {
      const response = id ? await adminPaymentAPI.updateProvider(id, payload) : await adminPaymentAPI.createProvider(payload);
      submitted = true;
      if (!context.current() || !current(g, o)) return false;
      if (!Number.isSafeInteger(response.data?.id) || (id && response.data.id !== id)) throw new Error('unconfirmed');
      // Entity responses may contain encrypted config. Only read the sanitized list.
      return await read(g, o);
    }, result => result === true, { definiteRejection: () => !submitted });
    if (!context.current() || !current(g, o)) return;
    if (outcome.kind === 'confirmed') { clearEditor(); notice.value = '收款提供方已保存并重新读取。'; }
    else if (outcome.kind === 'rejected') error.value = '保存被拒绝，请核对配置、支付方式冲突或未完成订单后重试。';
    else { ready.value = false; error.value = outcome.message || '保存结果尚未确认。请关闭编辑并核对操作结果；重新读取不会解除保护。'; }
  } finally { if (context.current() && current(g, o)) saving.value = false; }
}
function askDelete(provider: ProviderInstance) { if (writable.value) { deleting.value = provider; error.value = ''; } }
async function remove() {
  if (!writable.value || !deleting.value) return;
  const id = deleting.value.id, g = generation, o = owner(), context = writeGuard.capture();
  if (!context.current()) { writeGuard.refresh(); return; }
  saving.value = true; error.value = ''; notice.value = '';
  let submitted = false;
  try {
    const outcome = await writeGuard.journal.run(context, 'providers', 'provider-delete', [id], async () => {
      await adminPaymentAPI.deleteProvider(id); submitted = true;
      if (!context.current() || !current(g, o)) return false;
      return await read(g, o);
    }, result => result === true, { definiteRejection: () => !submitted });
    if (!context.current() || !current(g, o)) return;
    deleting.value = null;
    if (outcome.kind === 'confirmed') notice.value = '收款提供方已删除。';
    else { if (outcome.kind !== 'rejected') ready.value = false; error.value = outcome.message || (outcome.kind === 'rejected' ? '删除被拒绝，请核对未完成订单后重试。' : '删除结果尚未确认，请核对操作结果；重新读取不会解除保护。'); }
  } finally { if (context.current() && current(g, o)) saving.value = false; }
}
async function move(provider: ProviderInstance, direction: -1 | 1) {
  if (!writable.value || draft.value || deleting.value) return;
  const rows = [...providers.value], from = rows.findIndex(p => p.id === provider.id), to = from + direction;
  if (from < 0 || to < 0 || to >= rows.length) return;
  [rows[from], rows[to]] = [rows[to]!, rows[from]!];
  const g = generation, o = owner(), context = writeGuard.capture();
  if (!context.current()) { writeGuard.refresh(); return; }
  saving.value = true; error.value = ''; notice.value = '';
  let completed = 0;
  try {
    // Official API has individual updates, no atomic reorder endpoint.
    const outcome = await writeGuard.journal.run(context, 'providers', 'provider-sort', rows.map(row => row.id), async () => {
      for (const [sort_order, row] of rows.entries()) {
        if (!context.current() || !current(g, o)) return false;
        if (row.sort_order !== sort_order) { await adminPaymentAPI.updateProvider(row.id, { sort_order }); completed++; }
      }
      if (!context.current() || !current(g, o)) return false;
      return await read(g, o);
    }, result => result === true, { definiteRejection: () => completed === 0 });
    if (!context.current() || !current(g, o)) return;
    if (outcome.kind === 'confirmed') notice.value = '排序已保存。';
    else { if (outcome.kind !== 'rejected') ready.value = false; error.value = outcome.message || (outcome.kind === 'rejected' ? '排序被拒绝，请核对后重试。' : '排序可能仅保存了一部分，请核对顺序后确认；重新读取不会解除保护。'); }
  } finally { if (context.current() && current(g, o)) saving.value = false; }
}
</script>

<template>
  <section class="providers-panel">
    <MacGroupCard title="收款提供方">
      <div class="provider-body">
        <div class="actions"><MacButton :disabled="loading || saving || !!draft || !!deleting" @click="load">重新读取列表</MacButton><MacButton variant="primary" :disabled="!writable || !!draft" @click="open()">新增收款提供方</MacButton></div>
        <p class="hint">提供方操作单独保存；支付总开关和启用类型使用页面顶部的“保存配置”。</p>
        <p v-if="loading" role="status">正在读取收款提供方…</p><p v-if="error" role="alert" class="error">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
        <p v-if="writeGuard.storageError.value" role="alert" class="error">{{ writeGuard.storageError.value }}</p>
        <div v-if="pendingWrite" role="status" class="pending-write">
          <p>此前“{{ operationLabels[pendingWrite.action] }}”仍需核对（{{ new Date(pendingWrite.startedAt).toLocaleString() }}）。关闭窗口或重新读取列表不会解除保护。</p>
          <p v-if="pendingWrite.targets.length">目标 ID：{{ pendingWrite.targets.join('、') }}</p>
          <MacButton :disabled="!ready || loading || saving || !!draft || !!deleting" @click="askReviewWrite">核对操作结果</MacButton>
        </div>
        <p v-if="ready && !providers.length">尚未配置收款提供方。</p>
        <div v-for="(provider, index) in providers" :key="provider.id" class="provider-row">
          <div class="provider-summary"><strong>{{ provider.name }}</strong><span>{{ providerOptions.find(p => p.value === provider.provider_key)?.label || provider.provider_key }} · {{ provider.enabled ? '已启用' : '已停用' }}</span><span>{{ provider.supported_types.map(t => typeLabels[t] || t).join('、') || '未启用支付方式' }}</span></div>
          <div class="actions"><MacButton :aria-label="`上移 ${provider.name}`" :disabled="!writable || index === 0" @click="move(provider, -1)">上移</MacButton><MacButton :aria-label="`下移 ${provider.name}`" :disabled="!writable || index === providers.length - 1" @click="move(provider, 1)">下移</MacButton><MacButton :disabled="!writable || !providerTypes[provider.provider_key]" @click="open(provider)">编辑</MacButton><MacButton variant="destructive" :disabled="!writable" @click="askDelete(provider)">删除</MacButton></div>
        </div>
      </div>
    </MacGroupCard>
    <Teleport :to="sheetTarget || 'body'" :disabled="!sheetTarget">
    <MacSheet :show="!!draft" :title="baseline ? '编辑收款提供方' : '新增收款提供方'" :loading="saving" protect-changes :dirty="dirty" @close="closeEditor">
      <form v-if="draft" class="provider-form" @submit.prevent="save">
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <fieldset :disabled="!writable">
          <div class="fields"><label>名称<input v-model="draft.name" autofocus /></label><label>提供方类型<select v-model="draft.provider_key" :disabled="!!baseline" @change="changeProvider"><option v-for="p in providerOptions" :key="p.value" :value="p.value">{{ p.label }}</option></select></label></div>
          <label class="toggle-row">启用此提供方<MacToggle v-model="draft.enabled" role="switch" :aria-checked="draft.enabled" :disabled="!writable" aria-label="启用此提供方" /></label>
          <fieldset><legend>支持的支付方式</legend><div class="checks"><label v-for="type in availableTypes" :key="type"><input type="checkbox" :checked="draft.supported_types.includes(type)" @change="toggleType(type, ($event.target as HTMLInputElement).checked)" />{{ typeLabels[type] || type }}</label></div></fieldset>
          <label v-if="['easypay', 'alipay'].includes(draft.provider_key)">付款打开方式<select v-model="draft.payment_mode"><option v-if="baseline && !['', 'qrcode', 'popup', 'redirect'].includes(draft.payment_mode)" :value="draft.payment_mode">当前：{{ draft.payment_mode }}</option><template v-if="draft.provider_key === 'easypay'"><option value="qrcode">二维码</option><option value="popup">弹出收银台</option></template><template v-else><option value="">二维码，失败后打开收银台</option><option value="redirect">直接打开收银台</option></template></select></label>
          <p class="hint">密钥不回显；编辑时留空保留已有值，支持粘贴完整 PEM 密钥。替换密钥可能受未完成订单限制。</p>
          <label v-for="field in fields" :key="field.key">{{ field.label }}{{ field.optional ? '（选填）' : '' }}
            <select v-if="field.key === 'currency'" v-model="draft.config[field.key]"><option v-if="draft.config.currency && !currencies.includes(draft.config.currency)" :value="draft.config.currency">{{ draft.config.currency }}</option><option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option></select>
            <input v-else v-model="draft.config[field.key]" :type="field.secret ? 'password' : 'text'" :autocomplete="field.secret ? 'new-password' : 'off'" :spellcheck="false" :placeholder="field.secret && baseline ? '留空保留已有值' : ''" :aria-label="field.label" @paste="pasteSecret(field.key, $event)" />
          </label>
          <details v-if="['stripe', 'airwallex'].includes(draft.provider_key)"><summary>Webhook 地址</summary><p class="hint">在支付平台填写本站通知地址：</p><code>{{ callbackOrigin }}/api/v1/payment/webhook/{{ draft.provider_key }}</code></details>
          <details v-if="draft.provider_key === 'easypay'"><summary>自定义支付方式</summary><div v-for="(method, index) in customMethods" :key="index" class="custom-method" @input="customChanged = true"><label>方式代码<input v-model="method.type" /></label><label>上游类型代码<input v-model="method.upstreamType" /></label><label>显示名称<input v-model="method.displayName" /></label><MacButton @click="removeCustom(index)">移除此方式</MacButton></div><MacButton @click="customMethods.push({ type: '', upstreamType: '', displayName: '' }); customChanged = true">添加方式</MacButton><p class="hint">填写代码后，在上方勾选需要启用的支付方式。</p></details>
          <details><summary>退款与各支付方式限额</summary><label class="toggle-row">允许退款<MacToggle v-model="draft.refund_enabled" role="switch" :aria-checked="draft.refund_enabled" :disabled="!writable" aria-label="允许退款" /></label><label class="toggle-row">允许用户申请退款<MacToggle v-model="draft.allow_user_refund" role="switch" :aria-checked="draft.allow_user_refund" :disabled="!writable || !draft.refund_enabled" aria-label="允许用户申请退款" /></label><p class="hint">限额单位为 CNY。全部留空使用全局限额；同一方式设置部分限额后，其他空项为不限额。Stripe 共用一组限额。</p><fieldset v-for="type in limitTypes" :key="type"><legend>{{ typeLabels[type] || type }}</legend><div class="fields"><label v-for="[field, label] in [['singleMin', '单笔最小'], ['singleMax', '单笔最大'], ['dailyLimit', '每日限额']]" :key="field">{{ label }}<input :value="limits[type]?.[field!] ?? ''" type="number" min="0.01" step="0.01" @input="setLimit(type, field!, ($event.target as HTMLInputElement).value)" /></label></div></fieldset></details>
        </fieldset>
      </form>
      <template #footer="{ close }"><MacButton :disabled="saving" @click="close">取消</MacButton><MacButton variant="primary" :loading="saving" :disabled="!writable" @click="save">保存提供方</MacButton></template>
    </MacSheet>
    <MacAlertSheet :show="!!deleting" title="删除收款提供方" :message="`确定删除“${deleting?.name || ''}”？此操作不能撤销。`" danger confirm-text="删除" :loading="saving" @cancel="deleting = null" @confirm="remove" />
    <MacAlertSheet :show="!!reviewWrite" title="确认已核对操作结果" message="请先核对收款提供方列表及支付平台，确认此前操作已完成或明确未执行。仅重新读取列表不能证明写入结果。解除保护后可再次提交，请勿重复执行已经完成的操作。" danger confirm-text="已核对，解除保护" cancel-text="继续核对" :loading="saving" @cancel="reviewWrite = null" @confirm="confirmReviewWrite" />
    </Teleport>
  </section>
</template>

<style scoped>
.providers-panel, .provider-form, fieldset { min-width: 0; } .provider-body { padding: 16px; display: grid; gap: 12px; } .provider-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 12px 0; border-top: 1px solid var(--border-subtle); }
.pending-write { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; font-size: 12px; overflow-wrap: anywhere; }
.provider-summary { display: grid; gap: 4px; flex: 1 1 180px; min-width: 0; overflow-wrap: anywhere; } .provider-summary span, .hint { font-size: 11px; color: var(--text-secondary); line-height: 1.6; } .actions, .checks { display: flex; flex-wrap: wrap; gap: 8px; } .error { color: var(--color-danger, #d94040); overflow-wrap: anywhere; }
fieldset { border: 0; padding: 0; margin: 0; } .provider-form > fieldset { display: grid; gap: 14px; } label { display: grid; gap: 5px; min-width: 0; font-size: 12px; } .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } .toggle-row, .checks label { display: flex; align-items: center; gap: 8px; } .toggle-row { justify-content: space-between; } .checks { margin-top: 8px; }
input:not([type=checkbox]), select { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); } details > * { margin-top: 12px; } summary { cursor: pointer; font-size: 12px; } code { display: block; overflow-wrap: anywhere; font-size: 11px; } .custom-method { display: grid; gap: 10px; padding: 12px 0; border-top: 1px solid var(--border-subtle); } :disabled { opacity: .6; } input:focus-visible, select:focus-visible, summary:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
@media(max-width: 600px) { .fields { grid-template-columns: minmax(0, 1fr); } .provider-row { align-items: flex-start; } }
</style>
