<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'
import gemini from '@/api/admin/gemini'
import { MacButton } from '@sub2-mac/core'
import { startOAuth, finishOAuth, finishGrokInput, grokPasswordCapability, operationError, type GrokAuthMethod, type OAuthOptions, type OAuthResult, type OAuthSession } from './oauth'
const props = defineProps<{ options: OAuthOptions; disabled?: boolean }>()
const emit = defineEmits<{ result: [value: OAuthResult | null]; busy: [value: boolean] }>()
const session = ref<OAuthSession | null>(null)
const input = ref('')
const busy = ref(false)
const error = ref('')
const done = ref(false)
const copyNotice = ref('')
const copying = ref(false)
const method = ref<GrokAuthMethod>('manual')
const email = ref('')
const password = ref('')
const passwordEnabled = ref(false)
const capabilityError = ref('')
const capabilityBusy = ref(false)
const geminiEnabled = ref(false)
const redirectUris = ref<string[]>([])
let capabilityGeneration = 0
let generation = 0
function reset() {
  generation++; session.value = null; input.value = ''; error.value = ''; done.value = false; copyNotice.value = ''; copying.value = false
  email.value = ''; password.value = ''
  busy.value = false; emit('busy', false); emit('result', null)
}
async function copyAuthorizationURL() {
  if (!session.value || copying.value || busy.value || props.disabled) return
  const url = session.value.auth_url, version = generation
  copying.value = true; copyNotice.value = ''
  try {
    await navigator.clipboard.writeText(url)
    if (version === generation && session.value?.auth_url === url) copyNotice.value = '授权链接已复制'
  } catch {
    if (version === generation && session.value?.auth_url === url) copyNotice.value = '无法访问剪贴板，请选中上方链接手动复制。'
  } finally { if (version === generation) copying.value = false }
}
watch(() => JSON.stringify(props.options), () => { reset(); method.value = 'manual' }, { flush: 'sync' })
watch(method, reset, { flush: 'sync' })
async function loadCapability() {
  const version = ++capabilityGeneration
  passwordEnabled.value = false; capabilityError.value = ''; capabilityBusy.value = true
  geminiEnabled.value = false; redirectUris.value = []
  if (props.options.platform === 'gemini') {
    try { const caps = await gemini.getCapabilities(); if (version === capabilityGeneration) { geminiEnabled.value = caps.ai_studio_oauth_enabled === true; redirectUris.value = caps.required_redirect_uris || [] } }
    catch { if (version === capabilityGeneration) capabilityError.value = 'Gemini 授权能力读取失败，请重试。' }
    finally { if (version === capabilityGeneration) capabilityBusy.value = false }
    return
  }
  if (props.options.platform !== 'grok') { capabilityBusy.value = false; return }
  try { const enabled = await grokPasswordCapability(); if (version === capabilityGeneration) passwordEnabled.value = enabled }
  catch (e) { if (version === capabilityGeneration) capabilityError.value = operationError(e, '密码授权能力读取失败。') }
  finally { if (version === capabilityGeneration) capabilityBusy.value = false }
}
watch(() => props.options.platform, loadCapability, { immediate: true })
onBeforeUnmount(() => { capabilityGeneration++; reset() })
async function authorizeInput() {
  if (busy.value || props.disabled || method.value === 'manual' || done.value || (method.value === 'email_password' && !passwordEnabled.value)) return
  const version = generation
  busy.value = true; emit('busy', true); error.value = ''
  try {
    const result = await finishGrokInput(method.value, method.value === 'email_password' ? `${email.value.trim()}----${password.value}` : input.value, props.options.proxy_id)
    if (version !== generation) return
    input.value = ''; email.value = ''; password.value = ''; done.value = true; emit('result', result)
  } catch (e) { if (version === generation) { password.value = ''; error.value = operationError(e, '授权失败，请重试。') } }
  finally { if (version === generation) { busy.value = false; emit('busy', false) } }
}
async function run(exchange: boolean) {
  if (busy.value || props.disabled) return
  if (props.options.platform === 'gemini' && props.options.oauth_type === 'ai_studio' && !geminiEnabled.value) return
  const version = generation
  const options = { ...props.options }
  busy.value = true; emit('busy', true); error.value = ''
  try {
    if (exchange) {
      if (!session.value || done.value) return
      const result = await finishOAuth(options, session.value, input.value)
      if (version !== generation) return
      done.value = true; input.value = ''; session.value = null; emit('result', result)
    } else {
      session.value = null; input.value = ''; done.value = false; copyNotice.value = ''; emit('result', null)
      const result = await startOAuth(options)
      if (version === generation) session.value = result
    }
  } catch (e) {
    if (version === generation) error.value = operationError(e, '授权失败，请重试。')
  } finally {
    if (version === generation) { busy.value = false; emit('busy', false) }
  }
}
</script>
<template>
  <section class="oauth-flow" aria-label="交互式授权">
    <template v-if="options.platform === 'gemini'">
      <p v-if="capabilityBusy" role="status">正在检查 Gemini 授权能力…</p>
      <p v-else-if="capabilityError" role="alert">{{ capabilityError }} <button type="button" :disabled="busy || disabled" @click="loadCapability">重试</button></p>
      <template v-else-if="options.oauth_type === 'ai_studio'"><p>{{ geminiEnabled ? '服务器已配置自定义 OAuth client，可以开始授权。' : '服务器尚未启用 AI Studio，请由管理员配置 Gemini OAuth client ID 和 secret 后重试。' }}</p><details v-if="redirectUris.length"><summary>OAuth client 所需回调地址</summary><p v-for="uri in redirectUris" :key="uri" style="overflow-wrap:anywhere">{{ uri }}</p></details><button type="button" :disabled="busy || disabled" @click="loadCapability">重新检查配置</button></template>
    </template>
    <template v-if="options.platform === 'grok'">
      <label>授权方式<select v-model="method" :disabled="busy || disabled"><option value="manual">授权链接</option><option value="refresh_token">Refresh Token 验证</option><option value="sso_cookie">SSO Cookie 转换</option><option v-if="passwordEnabled" value="email_password">邮箱密码授权</option></select></label>
      <p v-if="capabilityBusy" role="status">正在确认密码授权是否可用…</p>
      <p v-else-if="capabilityError" role="alert">{{ capabilityError }} <button type="button" :disabled="busy || disabled" @click="loadCapability">重新检查</button></p>
      <p v-else-if="!passwordEnabled">此服务器未启用密码授权，可使用其他授权方式。</p>
    </template>
    <p v-if="done" role="status">授权已完成，保存账号后生效。</p>
    <template v-if="method === 'manual'">
    <p v-if="!done">① 生成链接　② 在浏览器授权　③ 粘贴回调并确认</p>
    <MacButton size="sm" :disabled="disabled || busy || (options.platform === 'gemini' && options.oauth_type === 'ai_studio' && !geminiEnabled)" @click="run(false)">{{ session || done ? '重新生成授权链接' : '生成授权链接' }}</MacButton>
    <template v-if="session">
      <div class="authorization-address"><label>本次授权链接<input :value="session.auth_url" aria-label="本次授权链接" readonly spellcheck="false" @focus="($event.target as HTMLInputElement).select()" /></label>
        <div class="authorization-actions"><MacButton size="sm" :disabled="busy || disabled" :loading="copying" @click="copyAuthorizationURL">复制链接</MacButton><a :href="session.auth_url" target="_blank" rel="noopener noreferrer" class="oauth-link">打开授权页面 ↗</a></div>
        <p v-if="copyNotice" role="status">{{ copyNotice }}</p>
      </div>
      <label>授权码或回调地址 <span class="required-note">必填</span><textarea v-model="input" rows="3" autocomplete="off" spellcheck="false" aria-required="true" placeholder="完成浏览器授权后，粘贴授权码或完整回调网址" :disabled="busy || disabled" /></label>
      <MacButton size="sm" variant="primary" :loading="busy" :disabled="disabled || !input.trim()" @click="run(true)">完成授权</MacButton>
    </template>
    </template>
    <template v-else-if="!done">
      <template v-if="method === 'email_password'">
        <label>邮箱<input v-model="email" type="email" autocomplete="off" :disabled="busy || disabled" /></label>
        <label>密码<input v-model="password" type="password" autocomplete="new-password" :disabled="busy || disabled" /></label>
      </template>
      <label v-else>{{ method === 'sso_cookie' ? 'SSO Cookie' : 'Refresh Token' }}<input v-model="input" type="password" autocomplete="new-password" :disabled="busy || disabled" /></label>
      <p>授权信息仅交由服务器兑换 OAuth 凭据，密码和 SSO Cookie 不保存到账号。</p>
      <MacButton variant="primary" size="sm" :loading="busy" :disabled="disabled || (method === 'email_password' ? !passwordEnabled || !email || !password : !input.trim())" @click="authorizeInput">验证并完成授权</MacButton>
    </template>
    <p v-if="error" role="alert" class="oauth-error">{{ error }}</p>
  </section>
</template>
<style scoped>
.oauth-flow{display:grid;gap:12px;min-width:0}.oauth-flow p{margin:0;color:var(--text-secondary);line-height:1.6}.oauth-flow label{display:grid;gap:6px}.oauth-flow textarea{width:100%;box-sizing:border-box;resize:vertical;background:var(--input-bg,transparent);color:inherit;border:1px solid var(--border-color);border-radius:7px;padding:8px}.oauth-link{color:var(--accent-color,#007aff);padding:6px 0}.oauth-flow .oauth-error{color:#d14343}textarea:focus-visible,.oauth-link:focus-visible{outline:2px solid #007aff;outline-offset:2px}
</style>
<style scoped>
.oauth-flow input,.oauth-flow select{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--border-color);border-radius:7px;background:var(--input-bg,transparent);color:inherit}.oauth-flow input:focus-visible,.oauth-flow select:focus-visible{outline:2px solid #007aff;outline-offset:2px}
.authorization-address{padding:12px;border:1px solid var(--border-subtle);border-radius:10px;background:var(--bg-surface);display:grid;gap:10px}.authorization-address input{font-family:var(--font-mono,monospace);font-size:11px;user-select:text}.authorization-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.required-note{font-size:10px;color:var(--text-tertiary)}
</style>
