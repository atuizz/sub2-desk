<script setup lang="ts">
import { computed } from 'vue'
import {
  CN_BASE_URL_PRESETS, changeCNAccountMode, changeCNProtocol, cloneCNProviderForm,
  cnAccountModes, cnNativeProtocols, cnProtocols, defaultCNAdaptiveBaseUrls, defaultCNBaseUrl,
  isCNProviderPlatform, selectCNPreset,
  type CNProviderForm, type CNProviderErrors, type CnAccountMode, type CnApiProtocol,
  type CnBaseUrlPreset, type CnNativeApiProtocol
} from './cn-provider'

const props = withDefaults(defineProps<{
  platform: string
  modelValue: CNProviderForm
  editing?: boolean
  hasExistingApiKey?: boolean
  disabled?: boolean
  errors?: CNProviderErrors
}>(), { editing: false, hasExistingApiKey: false, disabled: false, errors: () => ({}) })
const emit = defineEmits<{ (event: 'update:modelValue', value: CNProviderForm): void }>()
const ready = computed(() => isCNProviderPlatform(props.platform) && props.modelValue.platform === props.platform)
const locked = computed(() => props.disabled || !ready.value)
const modes = computed(() => ready.value ? cnAccountModes(props.platform) : [])
const protocols = computed(() => ready.value ? cnProtocols(props.platform) : [])
const nativeProtocols = computed(() => ready.value ? cnNativeProtocols(props.platform) : [])
const defaults = computed(() => defaultCNAdaptiveBaseUrls(props.modelValue.platform, props.modelValue.account_mode))
const presets = computed(() => ready.value ? CN_BASE_URL_PRESETS[props.modelValue.platform].filter(p => p.protocol === props.modelValue.api_protocol) : [])
const keyRequired = computed(() => !props.editing || !props.hasExistingApiKey)
const protocolLabels: Record<CnApiProtocol, string> = { adaptive: '自适应', chat_completions: 'Chat Completions', anthropic: 'Anthropic', responses: 'Responses' }
const protocolHints: Record<CnApiProtocol, string> = {
  adaptive: '按请求协议选择对应的上游地址。', chat_completions: '使用 OpenAI Chat Completions 兼容接口。',
  anthropic: '使用 Anthropic 兼容接口，适用于 Claude Code。', responses: '使用原生 Responses 接口，适用于 Codex。'
}
function update(key: 'api_key' | 'base_url' | 'zhipu_organization' | 'zhipu_project', event: Event) {
  if (!locked.value) emit('update:modelValue', { ...cloneCNProviderForm(props.modelValue), [key]: (event.target as HTMLInputElement).value })
}
function updateEndpoint(key: CnNativeApiProtocol, event: Event) {
  if (locked.value) return
  const next = cloneCNProviderForm(props.modelValue)
  next.api_base_urls[key] = (event.target as HTMLInputElement).value
  if (key === 'chat_completions') next.base_url = next.api_base_urls[key]
  emit('update:modelValue', next)
}
function modeChanged(event: Event) { if (!locked.value) emit('update:modelValue', changeCNAccountMode(props.modelValue, (event.target as HTMLSelectElement).value as CnAccountMode)) }
function protocolChanged(event: Event) { if (!locked.value) emit('update:modelValue', changeCNProtocol(props.modelValue, (event.target as HTMLSelectElement).value as CnApiProtocol)) }
function presetSelected(preset: CnBaseUrlPreset) { if (!locked.value) emit('update:modelValue', selectCNPreset(props.modelValue, preset)) }
</script>

<template>
  <div class="cn-provider-fields">
    <p v-if="!ready || errors.platform" class="cn-error" role="alert">{{ errors.platform || '请选择供应商，并重新读取配置。' }}</p>
    <fieldset v-if="ready" :disabled="locked" class="cn-required">
      <legend>必填配置</legend>
      <div class="cn-columns">
        <label>计费方式 <em>必选</em>
          <select :value="modelValue.account_mode" aria-label="计费方式" required :aria-invalid="!!errors.account_mode" @change="modeChanged">
            <option v-for="mode in modes" :key="mode" :value="mode">{{ mode === 'payg' ? '按量付费' : 'Coding Plan' }}</option>
          </select>
          <small>{{ platform === 'deepseek' ? 'DeepSeek 仅支持按量付费。' : '请选择此 API Key 对应的计费方式。' }}</small>
          <span v-if="errors.account_mode" class="cn-error" role="alert">{{ errors.account_mode }}</span>
        </label>
        <label>API 协议 <em>必选</em>
          <select :value="modelValue.api_protocol" aria-label="API 协议" required :aria-invalid="!!errors.api_protocol" @change="protocolChanged">
            <option v-for="protocol in protocols" :key="protocol" :value="protocol">{{ protocolLabels[protocol] }}</option>
          </select>
          <small>{{ protocolHints[modelValue.api_protocol] }}</small>
          <span v-if="errors.api_protocol" class="cn-error" role="alert">{{ errors.api_protocol }}</span>
        </label>
      </div>
      <label v-if="keyRequired">API Key <em>必填</em>
        <input :value="modelValue.api_key" type="password" autocomplete="new-password" spellcheck="false" aria-label="API Key" required :aria-invalid="!!errors.api_key" data-1p-ignore data-lpignore="true" @input="update('api_key', $event)" />
        <span v-if="errors.api_key" class="cn-error" role="alert">{{ errors.api_key }}</span>
      </label>
      <p v-else class="cn-hint">已配置 API Key；留空保留原密钥。</p>
    </fieldset>

    <details v-if="ready" class="cn-optional" open>
      <summary>选填设置 <span>上游地址{{ editing && hasExistingApiKey ? '、更换密钥' : '' }}{{ platform === 'zhipu' && modelValue.account_mode === 'coding' ? '、团队信息' : '' }}</span></summary>
      <fieldset :disabled="locked">
        <p class="cn-hint">地址留空使用下方所示的默认值，也可填写自己的转发地址。</p>
        <template v-if="modelValue.api_protocol === 'adaptive'">
          <label v-for="protocol in nativeProtocols" :key="protocol">{{ protocolLabels[protocol] }} 地址 <em>选填</em>
            <input :value="modelValue.api_base_urls[protocol]" type="url" :aria-label="`${protocolLabels[protocol]} 地址`" :placeholder="defaults[protocol]" :aria-invalid="!!errors[protocol]" spellcheck="false" @input="updateEndpoint(protocol, $event)" />
            <small class="cn-default">默认：{{ defaults[protocol] }}</small>
            <span v-if="errors[protocol]" class="cn-error" role="alert">{{ errors[protocol] }}</span>
          </label>
          <p v-if="platform === 'zhipu'" class="cn-hint">Zhipu GLM 没有原生 Responses 地址，此类请求由后端转换。</p>
        </template>
        <template v-else>
          <label>上游地址 <em>选填</em>
            <input :value="modelValue.base_url" type="url" aria-label="上游地址" :placeholder="defaultCNBaseUrl(platform, modelValue.account_mode, modelValue.api_protocol)" :aria-invalid="!!errors.base_url" spellcheck="false" @input="update('base_url', $event)" />
            <small class="cn-default">默认：{{ defaultCNBaseUrl(platform, modelValue.account_mode, modelValue.api_protocol) }}</small>
            <span v-if="errors.base_url" class="cn-error" role="alert">{{ errors.base_url }}</span>
          </label>
          <div class="cn-presets" role="group" aria-label="官方地址预设">
            <button v-for="preset in presets" :key="`${preset.mode}:${preset.protocol}:${preset.url}`" type="button" :title="preset.url" :aria-pressed="modelValue.account_mode === preset.mode && modelValue.base_url === preset.url" @click="presetSelected(preset)">{{ preset.label }}</button>
          </div>
          <small>选择预设也会切换对应的计费方式。</small>
        </template>
        <label v-if="!keyRequired">更换 API Key <em>选填</em>
          <input :value="modelValue.api_key" type="password" autocomplete="new-password" aria-label="更换 API Key" placeholder="留空保留原密钥" spellcheck="false" :aria-invalid="!!errors.api_key" data-1p-ignore data-lpignore="true" @input="update('api_key', $event)" />
          <span v-if="errors.api_key" class="cn-error" role="alert">{{ errors.api_key }}</span>
        </label>
        <div v-if="platform === 'zhipu' && modelValue.account_mode === 'coding'" class="cn-team">
          <h4>团队版 Coding Plan</h4>
          <p class="cn-hint">个人版留空；团队版填写组织 ID，可选填项目 ID，用于查询团队额度。清空组织 ID 会同时移除项目 ID。</p>
          <div class="cn-columns">
            <label>组织 ID <em>选填</em><input :value="modelValue.zhipu_organization" aria-label="组织 ID" @input="update('zhipu_organization', $event)" /></label>
            <label>项目 ID <em>选填</em><input :value="modelValue.zhipu_project" aria-label="项目 ID" :aria-invalid="!!errors.zhipu_project" @input="update('zhipu_project', $event)" /><span v-if="errors.zhipu_project" class="cn-error" role="alert">{{ errors.zhipu_project }}</span></label>
          </div>
        </div>
      </fieldset>
    </details>
  </div>
</template>

<style scoped>
.cn-provider-fields{min-width:0;display:grid;gap:18px;color:var(--text-primary);font-size:12px;line-height:1.5}
fieldset{border:0;padding:0;margin:0;min-width:0;display:grid;gap:14px}legend{font-size:12px;font-weight:600;padding:0 0 12px}label{display:block;min-width:0}em{font-size:10px;font-style:normal;color:var(--text-tertiary);margin-left:5px}
.cn-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}input,select{display:block;box-sizing:border-box;width:100%;min-width:0;margin-top:6px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:7px;background:var(--bg-surface);color:var(--text-primary);font:inherit}
input[type=url]{font-family:var(--font-mono,ui-monospace,monospace);font-size:11px}small,.cn-hint{display:block;color:var(--text-secondary);font-size:11px;margin:5px 0 0}.cn-default{overflow-wrap:anywhere;font-size:10px;color:var(--text-tertiary)}
.cn-optional{border-top:1px solid var(--border-subtle);padding-top:12px}.cn-optional summary{cursor:pointer;font-weight:600;padding:4px 0 12px}.cn-optional summary>span{font-weight:400;font-size:10px;color:var(--text-tertiary);margin-left:6px}.cn-presets{display:flex;flex-wrap:wrap;gap:6px}.cn-presets button{font:inherit;font-size:11px;border:1px solid var(--border-subtle);background:var(--bg-surface);color:var(--text-secondary);border-radius:6px;padding:5px 8px;cursor:pointer}.cn-presets button[aria-pressed=true]{border-color:var(--accent);color:var(--accent);background:color-mix(in srgb,var(--accent) 6%,var(--bg-surface))}
.cn-team{display:grid;gap:8px;padding-top:12px;border-top:1px solid var(--border-subtle)}h4{font:inherit;font-weight:600;margin:0}.cn-error{display:block;font-size:11px;color:var(--color-danger,#d92d20);margin-top:4px}input[aria-invalid=true],select[aria-invalid=true]{border-color:var(--color-danger,#d92d20)}:is(input,select,button,summary):focus-visible{outline:2px solid var(--accent,#007aff);outline-offset:2px}:is(input,select,button):disabled{cursor:default;opacity:.65}
@container app-window (max-width:540px){.cn-columns{grid-template-columns:1fr;gap:12px}}@media(max-width:540px){.cn-columns{grid-template-columns:1fr;gap:12px}}
</style>
