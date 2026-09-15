<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { MacSheet, MacButton } from '@sub2-mac/core'
import { accountsAPI } from '@/api/admin/accounts'
import type { Account } from '@/types'
import OAuthAuthorization from './OAuthAuthorization.vue'
import { saveReauthorization, operationError, type OAuthOptions, type OAuthResult } from './oauth'
const props = defineProps<{ account: Account }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const options = ref<OAuthOptions | null>(null)
const result = ref<OAuthResult | null>(null)
const busy = ref(false)
const authorizing = ref(false)
const error = ref('')
const credentialsSaved = ref(false)
let disposed = false
onBeforeUnmount(() => { disposed = true })
async function load() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const account = await accountsAPI.getById(props.account.id)
    if (disposed) return
    const c = account.credentials || {}
    options.value = { platform: account.platform, type: account.type === 'setup-token' ? 'setup-token' : 'oauth',
      proxy_id: account.proxy_id ?? undefined,
      project_id: typeof c.project_id === 'string' ? c.project_id : undefined,
      oauth_type: ['code_assist', 'google_one', 'ai_studio'].includes(String(c.oauth_type)) ? c.oauth_type as OAuthOptions['oauth_type'] : undefined,
      tier_id: typeof c.tier_id === 'string' ? c.tier_id : undefined }
  } catch (e) { if (!disposed) error.value = operationError(e, '账号详情读取失败，请重试。') }
  finally { if (!disposed) busy.value = false }
}
async function save() {
  if (busy.value || authorizing.value || !options.value || (!result.value && !credentialsSaved.value)) return
  busy.value = true; error.value = ''
  try {
    if (!credentialsSaved.value) {
      const updated = await saveReauthorization(props.account.id, options.value.type, result.value!)
      credentialsSaved.value = true; result.value = null
      emit('saved')
      if (updated.status !== 'error') { if (!disposed) emit('close'); return }
    }
    await accountsAPI.clearError(props.account.id)
    if (!disposed) { emit('saved'); emit('close') }
  } catch (e) {
    if (!disposed) error.value = credentialsSaved.value
      ? '新凭据已保存，但账号错误状态尚未清除。请重试清除状态，无需再次授权。'
      : operationError(e, '保存失败，请重试。')
  } finally { if (!disposed) busy.value = false }
}
onMounted(load)
</script>
<template>
  <MacSheet protect-changes :dirty="result ? true : undefined" :show="true" :title="`重新授权 · ${account.name}`" :loading="busy || authorizing" @close="emit('close')">
    <p v-if="busy && !options" role="status">正在读取账号…</p>
    <OAuthAuthorization v-if="options && !credentialsSaved" :options="options" :disabled="busy" @result="result = $event" @busy="authorizing = $event" />
    <p v-if="credentialsSaved" role="status">新凭据已保存。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <MacButton v-if="!options && !busy" @click="load">重新读取</MacButton>
    <template #footer="{ close }">
      <MacButton :disabled="busy || authorizing" @click="close">关闭</MacButton>
      <MacButton variant="primary" :loading="busy" :disabled="authorizing || (!result && !credentialsSaved)" @click="save">{{ credentialsSaved ? '重试清除状态' : '保存授权' }}</MacButton>
    </template>
  </MacSheet>
</template>
<style scoped>.error{color:#d14343;line-height:1.6}</style>
