<script setup lang="ts">
import { ref } from 'vue'
import type { UpdatePolicyGroup } from '../../../types/admin-policies'
import { copy, changedFields, models, routing, validateGroup } from './policy-contract'
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
const allowlist = ref(copy(props.source.model_allowlist || { enabled: false, models: [] }))
const allowlistText = ref(allowlist.value.models.join('\n'))
const allowlistTouched = ref(false)
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
    result.model_allowlist = { ...copy(allowlist.value), models: models(allowlistText.value) }
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
    <details><summary>模型白名单</summary>
      <p v-if="!supported('model_allowlist')">{{ creating ? '请先创建分组，再配置模型白名单。' : '当前分组未返回白名单能力，暂不可编辑。' }}</p>
      <fieldset :disabled="!supported('model_allowlist')">
        <label><input v-model="allowlist.enabled" type="checkbox" @change="allowlistTouched = true" />启用模型白名单</label>
        <label>允许的模型（每行一个，支持末尾 *）<textarea v-model="allowlistText" rows="4" @input="allowlistTouched = true" /></label>
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
button { color: var(--accent); padding: 6px 0; } p { color: var(--text-tertiary); margin-top: 8px; line-height: 1.6; }
</style>
