<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { UpdatePolicyGroup } from '../../../types/admin-policies'
import { copy, changedFields, routing, validateGroup } from './policy-contract'
import { getModelAllowlistCandidates } from '../../../api/admin/groups'
import {
  createModelAllowlistState, setModelAllowlistCandidates, toggleModelAllowlistItem,
  selectAllModelAllowlistItems, invertModelAllowlistSelection, moveModelAllowlistItem,
  addCustomModelAllowlistItem, buildModelAllowlistConfig, selectedModelAllowlistCount,
  createModelAllowlistCandidatesTracker,
} from '../../../composables/useModelWhitelist'
import type { GroupPlatform } from '../../../types/index'
import PolicyNumber from './PolicyNumber.vue'
import GroupDispatchEditor from './GroupDispatchEditor.vue'
import GroupMediaEditor from './GroupMediaEditor.vue'
import CodexManifestEditor from './CodexManifestEditor.vue'
const mediaEditor=ref<InstanceType<typeof GroupMediaEditor>|null>(null)
const manifestEditor=ref<InstanceType<typeof CodexManifestEditor>|null>(null)
const dispatchEditor=ref<InstanceType<typeof GroupDispatchEditor> | null>(null)
const props = defineProps<{ source: UpdatePolicyGroup; platform?: string; creating?: boolean; groupId?:number }>()
const baseline = copy(props.source)
const draft = ref<UpdatePolicyGroup>(copy(props.source))
const routeRows = ref(Object.entries(props.source.model_routing || {}).map(([model, accounts]) => ({ model, accounts: accounts.join(', ') })))
const routesTouched = ref(false)
const allowlistState = ref(createModelAllowlistState(props.source.model_allowlist || { enabled: false, models: [] }))
const allowlistTouched = ref(false)
const allowlistLoading = ref(false)
const allowlistError = ref('')
const allowlistLoadedFor = ref('')
const allowlistCustomEntry = ref('')
const allowlistCustomError = ref('')
const allowlistTracker = createModelAllowlistCandidatesTracker()
const allowlistSelectedCount = computed(() => selectedModelAllowlistCount(allowlistState.value))
/**
 * 候选模型来自 GET /admin/groups/{id}/model-allowlist-candidates（id=0
 * 用于新建分组，返回平台默认候选）。只在白名单区首次展开时加载；
 * 平台/分组变化后若已加载过则重载，过期响应由 tracker 丢弃。
 * 加载失败不阻塞编辑：已保存的白名单仍可展示与保存。
 */
async function loadAllowlistCandidates() {
  if (!supported('model_allowlist') || !props.platform || allowlistLoading.value) return
  const mode = props.creating ? 'create' : 'edit'
  const groupID = props.groupId ?? 0
  const platform = props.platform as GroupPlatform
  const key = `${mode}:${groupID}:${platform}`
  if (allowlistLoadedFor.value === key) return
  const requestID = allowlistTracker.next({ mode, groupID, platform })
  allowlistLoading.value = true
  allowlistError.value = ''
  try {
    const candidates = await getModelAllowlistCandidates(groupID, platform)
    if (!allowlistTracker.isCurrent(requestID, { mode, groupID, platform })) return
    setModelAllowlistCandidates(allowlistState.value, candidates)
    allowlistLoadedFor.value = key
  } catch {
    if (!allowlistTracker.isCurrent(requestID, { mode, groupID, platform })) return
    allowlistError.value = '候选模型加载失败，已保留已保存的白名单，可手动添加模型。'
    if (allowlistState.value.items.length === 0) setModelAllowlistCandidates(allowlistState.value, [])
  } finally {
    allowlistLoading.value = false
  }
}
function onAllowlistToggle(event: Event) {
  if ((event.target as HTMLDetailsElement).open) void loadAllowlistCandidates()
}
watch([() => props.platform, () => props.groupId], () => {
  if (allowlistLoadedFor.value) { allowlistLoadedFor.value = ''; void loadAllowlistCandidates() }
})
function toggleAllowlistItem(id: string) { toggleModelAllowlistItem(allowlistState.value, id); allowlistTouched.value = true }
function selectAllAllowlist() { selectAllModelAllowlistItems(allowlistState.value); allowlistTouched.value = true }
function invertAllowlist() { invertModelAllowlistSelection(allowlistState.value); allowlistTouched.value = true }
function moveAllowlistItem(from: number, to: number) { moveModelAllowlistItem(allowlistState.value, from, to); allowlistTouched.value = true }
function submitAllowlistCustomEntry() {
  const err = addCustomModelAllowlistItem(allowlistState.value, allowlistCustomEntry.value)
  if (err === 'empty') { allowlistCustomError.value = '请输入模型名。'; return }
  if (err === 'duplicate') { allowlistCustomError.value = '该模型已在白名单中。'; return }
  allowlistCustomError.value = ''
  allowlistCustomEntry.value = ''
  allowlistTouched.value = true
}
const limits = [['daily_limit_usd','每日额度（美元）'],['weekly_limit_usd','每周额度（美元）'],['monthly_limit_usd','每月额度（美元）']] as const
const switches = [
  ['claude_code_only','仅 Claude Code'], ['require_oauth_only','仅 OAuth 账号'], ['require_privacy_set','要求隐私设置'],
  ['allow_messages_dispatch','允许 Messages 调度'], ['mcp_xml_inject','注入 MCP XML'],
  ['force_openai_fast','强制 OpenAI Fast'], ['free_openai_fast','免除 Fast 加价'],
  ['long_context_pricing_enabled','长上下文定价'], ['profit_control_enabled','利润控制'],
] as const
const policyNumbers = [['profit_min_margin','最低利润率（小数）'],['profit_safety_buffer','安全缓冲（小数）'],['fallback_group_id','Claude Code 回退分组 ID'],['fallback_group_id_on_invalid_request','无效请求回退分组 ID']] as const
function supported(key: keyof UpdatePolicyGroup) { return Object.prototype.hasOwnProperty.call(baseline, key) }
function patch() {
  const result = changedFields(baseline, draft.value)
  if (routesTouched.value) result.model_routing = routing(routeRows.value)
  if (allowlistTouched.value) {
    if (!supported('model_allowlist')) throw new Error('当前分组未返回白名单能力，不能保存此配置。')
    const built = buildModelAllowlistConfig(allowlistState.value)
    const base = baseline.model_allowlist
    // 保留后端返回的未知扩展字段（如 future），只覆盖 enabled/models 两项。
    result.model_allowlist = base && typeof base === 'object' ? { ...base, enabled: built.enabled, models: built.models } : built
  }
  const changed = changedFields(baseline, { ...baseline, ...result })
  validateGroup(changed)
  return {...changed,...dispatchEditor.value?.patch(),...mediaEditor.value?.patch(),...manifestEditor.value?.patch()}
}
defineExpose({ patch })
</script>
<template>
  <div class="policies">
    <GroupDispatchEditor ref="dispatchEditor" :source="source" :platform="platform" />
    <GroupMediaEditor ref="mediaEditor" :source="source" :platform="platform" :creating="creating" />
    <CodexManifestEditor ref="manifestEditor" :source="source" :group-id="groupId" :platform="platform" />
    <details><summary>订阅额度</summary><div class="fields">
      <PolicyNumber v-for="[key,label] in limits" :key="key" v-model="draft[key]" :label="label" />
    </div><p>留空表示不限；零额度会按原值保存。</p></details>
    <details @toggle="onAllowlistToggle"><summary>模型白名单</summary>
      <p v-if="!supported('model_allowlist')">{{ creating ? '请先创建分组，再配置模型白名单。' : '当前分组未返回白名单能力，暂不可编辑。' }}</p>
      <fieldset :disabled="!supported('model_allowlist')">
        <label><input v-model="allowlistState.enabled" type="checkbox" @change="allowlistTouched = true" />启用模型白名单</label>
        <template v-if="allowlistState.enabled">
          <p v-if="allowlistLoading">正在加载候选模型…</p>
          <p v-else-if="allowlistError">{{ allowlistError }}</p>
          <template v-else>
            <p v-if="allowlistState.items.length > 0">已选 {{ allowlistSelectedCount }} / {{ allowlistState.items.length }} 个模型</p>
            <p v-else>暂无候选模型，可在下方手动添加。</p>
            <div v-if="allowlistState.items.length > 0" class="fields">
              <button type="button" @click="selectAllAllowlist">全选</button>
              <button type="button" @click="invertAllowlist">反选</button>
            </div>
            <ul class="allowlist">
              <li v-for="(item, index) in allowlistState.items" :key="item.id">
                <label><input type="checkbox" :checked="item.selected" @change="toggleAllowlistItem(item.id)" />{{ item.id }}<span v-if="item.id.includes('*')">（通配符）</span></label>
                <button type="button" :disabled="index === 0" @click="moveAllowlistItem(index, index - 1)">上移</button>
                <button type="button" :disabled="index === allowlistState.items.length - 1" @click="moveAllowlistItem(index, index + 1)">下移</button>
              </li>
            </ul>
            <label>手动添加模型<input v-model="allowlistCustomEntry" placeholder="模型名，支持末尾 *" @keydown.enter.prevent="submitAllowlistCustomEntry" /></label>
            <button type="button" @click="submitAllowlistCustomEntry">添加</button>
            <p v-if="allowlistCustomError">{{ allowlistCustomError }}</p>
          </template>
        </template>
      </fieldset>
    </details>
    <details><summary>模型路由</summary>
      <label><input v-model="draft.model_routing_enabled" type="checkbox" />启用模型路由</label>
      <div v-for="(row,i) in routeRows" :key="i" class="route fields">
        <label>模型或模式<input v-model="row.model" @input="routesTouched = true" /></label>
        <label>账号 ID（逗号分隔）<input v-model="row.accounts" @input="routesTouched = true" /></label>
        <button type="button" @click="routeRows.splice(i,1); routesTouched = true">移除路由</button>
      </div>
      <button type="button" @click="routeRows.push({ model: '', accounts: '' }); routesTouched = true">添加模型路由</button>
    </details>
    <details><summary>调度与分组策略</summary>
      <div class="fields"><label v-for="[key,label] in switches" :key="key"><input v-model="draft[key]" type="checkbox" :disabled="!supported(key)" />{{ label }}</label></div>
      <div class="fields"><fieldset v-for="[key,label] in policyNumbers" :key="key" :disabled="!supported(key)"><PolicyNumber v-model="draft[key]" :label="label" /></fieldset></div>
      <label v-if="supported('default_mapped_model')">默认映射模型<input v-model="draft.default_mapped_model" /></label>
      <fieldset v-if="supported('supported_model_scopes')"><legend>支持的模型系列</legend>
        <label v-for="scope in ['claude','gemini_text','gemini_image']" :key="scope"><input type="checkbox" :checked="draft.supported_model_scopes?.includes(scope) ?? false" @change="draft.supported_model_scopes = ($event.target as HTMLInputElement).checked ? [...(draft.supported_model_scopes || []), scope] : (draft.supported_model_scopes || []).filter(v => v !== scope)" />{{ scope }}</label>
      </fieldset>
      <p>灰色策略表示当前详情未返回该能力；未编辑的配置保持原值。</p>
    </details>
  </div>
</template>
<style scoped>
.policies { display: grid; gap: 12px; min-width: 0; }
details { border-top: 1px solid var(--border-color); padding-top: 10px; }
summary { cursor: pointer; font-weight: 600; padding: 5px 0 10px; }
.fields { display: grid; grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); gap: 10px; margin: 8px 0; }
label { display: block; color: var(--text-secondary); }
input:not([type=checkbox]), textarea { display: block; box-sizing: border-box; width: 100%; min-width: 0; margin-top: 5px; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--content-bg); color: var(--text-primary); }
fieldset { min-width: 0; border: 0; padding: 0; margin: 0; } fieldset:disabled { opacity: .5; }
button { color: var(--accent); padding: 6px 0; } button:disabled { opacity: .45; } p { color: var(--text-tertiary); margin-top: 8px; line-height: 1.6; }
.allowlist { list-style: none; margin: 8px 0; padding: 0; display: grid; gap: 4px; max-height: 260px; overflow: auto; }
.allowlist li { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.allowlist li label { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.allowlist li button { flex: 0 0 auto; padding: 2px 4px; font-size: 12px; }
</style>
