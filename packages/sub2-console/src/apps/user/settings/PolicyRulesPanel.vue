<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { MacButton, MacGroupCard, MacDraftGuard, MacAlertSheet } from '@sub2-mac/core';
import { settingsAPI, type BetaPolicySettings, type OpenAIFastPolicySettings } from '../../../api/admin/settings';
import { copyPolicy, policyPayload, readPolicy, type PolicyDocument, type PolicyKind, type PolicyRow } from './policyRules';

const props = defineProps<{ kind: PolicyKind }>();
const title = computed(() => props.kind === 'beta' ? 'Anthropic Beta 规则' : 'OpenAI Fast / Flex 规则');
const baseline = ref<PolicyDocument | null>(null);
const rows = ref<PolicyRow[]>([]);
const loading = ref(false), saving = ref(false), ready = ref(false);
const error = ref(''), notice = ref('');
const reloadPrompt = ref(false);
const root = ref<HTMLElement | null>(null), sheetTarget = ref<HTMLElement | null>(null);
const dirty = computed(() => baseline.value !== null && JSON.stringify(rows.value.map(row => row.rule)) !== JSON.stringify(baseline.value.rules));
const scopes = [{ value: 'all', label: '全部账号' }, { value: 'oauth', label: 'OAuth 账号' }, { value: 'apikey', label: 'API Key 账号' }, { value: 'bedrock', label: 'Bedrock 账号' }];
const actions = computed(() => [{ value: 'pass', label: '透传' }, { value: 'filter', label: '移除标记' }, { value: 'block', label: '拒绝请求' }, ...(props.kind === 'fast' ? [{ value: 'force_priority', label: '强制 Priority' }] : [])]);
const tiers = ['all', 'priority', 'ultrafast', 'flex'];
let epoch = 0, nextID = 0;
const message = (value: unknown) => value instanceof Error ? value.message : '操作失败，请稍后重试。';

function restore() {
  if (!baseline.value || saving.value || loading.value) return;
  rows.value = baseline.value.rules.map(rule => ({ id: ++nextID, rule: copyPolicy(rule), original: JSON.stringify(rule) }));
  error.value = ''; notice.value = '';
}
function accept(document: PolicyDocument) {
  baseline.value = document;
  rows.value = document.rules.map(rule => ({ id: ++nextID, rule: copyPolicy(rule), original: JSON.stringify(rule) }));
  ready.value = true;
}
async function load() {
  if (loading.value || saving.value) return;
  const version = ++epoch; loading.value = true; ready.value = false; error.value = ''; notice.value = '';
  try {
    const response = props.kind === 'beta' ? await settingsAPI.getBetaPolicySettings() : (await settingsAPI.getSettings()).openai_fast_policy_settings;
    if (version !== epoch) return;
    accept(readPolicy(response, props.kind));
  } catch (err) { if (version === epoch) error.value = message(err); }
  finally { if (version === epoch) loading.value = false; }
}
function add() {
  if (!ready.value || saving.value || loading.value) return;
  rows.value.push({ id: ++nextID, original: null, rule: { ...(props.kind === 'beta' ? { beta_token: '' } : { service_tier: 'priority' as const }), action: 'pass', scope: 'all' } });
  notice.value = '';
}
function requestReload() {
  if (loading.value || saving.value) return;
  if (dirty.value) reloadPrompt.value = true;
  else void load();
}
function discardAndReload() {
  if (loading.value || saving.value) return;
  reloadPrompt.value = false;
  // Retain the draft until a valid response arrives, including read failures.
  void load();
}
function remove(id: number) {
  if (!ready.value || saving.value || loading.value) return;
  rows.value = rows.value.filter(row => row.id !== id); notice.value = '';
}
function updateList(row: PolicyRow, key: 'model_whitelist' | 'user_ids', value: string) {
  const parts = value.split(/[\s,，]+/).filter(Boolean);
  if (key === 'user_ids') row.rule.user_ids = parts.map(Number);
  else row.rule.model_whitelist = parts;
}
async function save() {
  if (!ready.value || !baseline.value || !dirty.value || saving.value || loading.value) return;
  error.value = ''; notice.value = ''; const version = epoch;
  try {
    const payload = policyPayload(baseline.value, rows.value, props.kind);
    saving.value = true;
    const response = props.kind === 'beta'
      ? await settingsAPI.updateBetaPolicySettings(payload as BetaPolicySettings)
      : (await settingsAPI.updateSettings({ openai_fast_policy_settings: payload as OpenAIFastPolicySettings })).openai_fast_policy_settings;
    if (version !== epoch) return;
    // A completed write with an incomplete response must not enable blind retries.
    ready.value = false;
    try { accept(readPolicy(response, props.kind)); }
    catch { throw new Error('规则已提交，但返回信息不完整，请重新读取后核对。'); }
    notice.value = '规则已保存';
  } catch (err) { if (version === epoch) error.value = message(err); }
  finally { if (version === epoch) saving.value = false; }
}
onMounted(() => { sheetTarget.value = root.value?.closest('.mac-window-body') ?? root.value; void load(); });
onUnmounted(() => { epoch++; });
</script>

<template>
  <section ref="root" class="policy-rules" :aria-label="title" :aria-busy="loading || saving">
    <MacDraftGuard :dirty="dirty" :busy="saving" />
    <Teleport v-if="sheetTarget" :to="sheetTarget"><MacAlertSheet :show="reloadPrompt" title="放弃未保存的规则？"
      message="重新读取会替换当前修改。" danger confirm-text="放弃并重新读取" cancel-text="继续编辑"
      :loading="saving || loading" @cancel="reloadPrompt = false" @confirm="discardAndReload" /></Teleport>
    <MacGroupCard :title="title">
      <div class="policy-body">
        <p v-if="loading" role="status">正在读取规则…</p>
        <p v-if="error" class="policy-error" role="alert">{{ error }}</p>
        <p v-if="notice" role="status">{{ notice }}</p>
        <p class="policy-help">{{ kind === 'fast' ? '用户专属规则优先；同类规则按列表顺序匹配。' : '按功能标记、账号和模型范围应用规则。' }}未保存的修改可随时撤销。</p>
        <MacButton :disabled="loading || saving" @click="requestReload">重新读取规则</MacButton>
        <p v-if="ready && rows.length === 0" role="status">暂无规则。添加规则后保存。</p>
        <form @submit.prevent="save">
          <fieldset v-for="(row, index) in rows" :key="row.id" :disabled="!ready || loading || saving" class="policy-rule">
            <legend>规则 {{ index + 1 }}</legend>
            <div class="policy-fields">
              <label v-if="kind === 'beta'">Beta 功能标记<input v-model="row.rule.beta_token" placeholder="例如 context-1m-2025-08-07" /></label>
              <label v-else>服务档位<select v-model="row.rule.service_tier" aria-label="服务档位"><option v-if="!tiers.includes(row.rule.service_tier || '')" :value="row.rule.service_tier">当前：{{ row.rule.service_tier }}</option><option v-for="tier in tiers" :key="tier" :value="tier">{{ tier === 'all' ? '全部档位' : tier }}</option></select></label>
              <label>处理方式<select v-model="row.rule.action" aria-label="处理方式"><option v-if="!actions.some(item => item.value === row.rule.action)" :value="row.rule.action">当前：{{ row.rule.action }}</option><option v-for="action in actions" :key="action.value" :value="action.value">{{ action.label }}</option></select></label>
              <label>账号范围<select v-model="row.rule.scope" aria-label="账号范围"><option v-if="!scopes.some(item => item.value === row.rule.scope)" :value="row.rule.scope">当前：{{ row.rule.scope }}</option><option v-for="scope in scopes" :key="scope.value" :value="scope.value">{{ scope.label }}</option></select></label>
              <label v-if="kind === 'fast'">用户 ID（留空为全部）<input :value="row.rule.user_ids?.join(', ') || ''" inputmode="numeric" @change="updateList(row, 'user_ids', ($event.target as HTMLInputElement).value)" /></label>
            </div>
            <label v-if="row.rule.action === 'block'">拒绝提示<input v-model="row.rule.error_message" /></label>
            <details><summary>模型范围与未匹配处理</summary>
              <label>模型范围（留空为全部）<textarea :value="row.rule.model_whitelist?.join('\n') || ''" rows="3" placeholder="每行一个模型，可使用 * 通配符" @change="updateList(row, 'model_whitelist', ($event.target as HTMLTextAreaElement).value)" /></label>
              <label>未匹配处理<select v-model="row.rule.fallback_action" aria-label="未匹配处理"><option :value="undefined">使用默认处理</option><option v-if="row.rule.fallback_action && !actions.some(item => item.value === row.rule.fallback_action)" :value="row.rule.fallback_action">当前：{{ row.rule.fallback_action }}</option><option v-for="action in actions" :key="action.value" :value="action.value">{{ action.label }}</option></select></label>
              <label v-if="row.rule.fallback_action === 'block'">未匹配拒绝提示<input v-model="row.rule.fallback_error_message" /></label>
            </details>
            <button type="button" class="remove-rule" :aria-label="`移除规则 ${index + 1}`" @click="remove(row.id)">移除规则</button>
          </fieldset>
          <div class="policy-actions">
            <MacButton :disabled="!ready || loading || saving" @click="add">添加规则</MacButton>
            <MacButton :disabled="!ready || !dirty || loading || saving" @click="restore">撤销未保存修改</MacButton>
            <MacButton variant="primary" :disabled="!ready || !dirty || loading" :loading="saving" @click="save">保存规则</MacButton>
          </div>
        </form>
      </div>
    </MacGroupCard>
  </section>
</template>

<style scoped>
.policy-rules, .policy-body, form { min-width: 0; }
.policy-body { padding: 16px; display: grid; gap: 12px; }
.policy-help { color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.policy-error { color: var(--color-danger, #d94040); overflow-wrap: anywhere; }
.policy-rule { min-width: 0; margin: 0 0 16px; border: 0; border-top: 1px solid var(--border-subtle); padding: 12px 0 0; }
legend { font-weight: 600; padding-right: 8px; }
.policy-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
label { display: block; min-width: 0; margin-bottom: 12px; font-size: 12px; color: var(--text-secondary); }
input, select, textarea { display: block; box-sizing: border-box; width: 100%; min-width: 0; margin-top: 5px; padding: 8px; border: 1px solid var(--border-subtle); border-radius: 7px; color: var(--text-primary); background: var(--bg-surface); }
input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible, button:focus-visible { outline: 2px solid var(--accent, #007aff); outline-offset: 2px; }
summary { font-size: 12px; margin: 8px 0 12px; cursor: pointer; }
.remove-rule { color: var(--color-danger, #d94040); font-size: 12px; padding: 8px 0; }
.policy-actions { display: flex; flex-wrap: wrap; gap: 8px; }
fieldset:disabled { opacity: .6; }
@media (max-width: 600px) { .policy-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
