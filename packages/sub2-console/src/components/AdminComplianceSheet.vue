<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { MacButton, MacSheet } from '@sub2-mac/core'
import { adminComplianceAPI, type AdminComplianceStatus } from '@/api/admin/compliance'

const props = defineProps<{ show: boolean; status: AdminComplianceStatus | null; identity: string; statusLoading: boolean; statusError: string }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'accepted'): void; (event: 'retry'): void }>()

const phrase = ref('')
const loading = ref(false)
const error = ref('')
const expectedPhrase = computed(() => props.status?.ack_phrase_zh || '')
const ready = computed(() => props.show && !!props.identity && props.status?.required === true &&
  !!props.status.version && !!expectedPhrase.value.trim() && !props.statusLoading && !props.statusError)
let generation = 0

watch(() => [props.show, props.identity, props.status], () => {
  generation++; phrase.value = ''; error.value = ''; loading.value = false
}, { flush: 'sync' })
onBeforeUnmount(() => { generation++ })

async function accept() {
  if (loading.value || !ready.value) return
  if (phrase.value.trim() !== expectedPhrase.value.trim()) {
    error.value = `请输入完整确认语：${expectedPhrase.value}`
    return
  }
  loading.value = true
  error.value = ''
  const current = generation
  try {
    const status = await adminComplianceAPI.accept({ phrase: phrase.value.trim(), language: 'zh-CN' })
    if (current !== generation) return
    if (status?.required !== false) throw new Error('确认状态尚未完成，请重新读取后重试。')
    emit('accepted')
    emit('close')
  } catch (cause: any) {
    if (current === generation) error.value = cause?.message || '确认未提交成功，请稍后重试。'
  } finally {
    if (current === generation) loading.value = false
  }
}
</script>

<template>
  <div class="admin-compliance-sheet">
    <MacSheet :show="show" title="管理员合规确认" :loading="loading" @close="emit('close')">
    <div class="space-y-4">
      <div class="rounded-xl border border-blue-500/20 bg-blue-500/[0.08] p-4">
        <p class="text-sm font-semibold text-black/85 dark:text-white/90">完成确认后才能访问管理数据</p>
        <p class="mt-1.5 text-xs leading-5 text-black/60 dark:text-white/60">
          请阅读平台合规文档，并输入下方完整确认语。
        </p>
      </div>
      <div class="space-y-2 text-xs text-black/65 dark:text-white/65">
        <p>请先阅读相关文档：</p>
        <div class="flex flex-wrap gap-3">
          <a v-if="status?.document_url_zh" :href="status.document_url_zh" target="_blank" rel="noreferrer" class="text-blue-500 hover:underline">中文文档</a>
          <a v-if="status?.document_url_en" :href="status.document_url_en" target="_blank" rel="noreferrer" class="text-blue-500 hover:underline">English document</a>
        </div>
      </div>
      <label class="block text-xs font-medium text-black/70 dark:text-white/70">
        输入确认语
        <p v-if="expectedPhrase" class="mt-2 break-words text-xs leading-5">{{ expectedPhrase }}</p>
        <input v-model="phrase" :disabled="!ready || loading" autofocus class="mt-2 h-10 w-full rounded-lg border border-black/10 bg-white/80 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/[0.06]" :placeholder="expectedPhrase" @keydown.enter.prevent="accept" />
      </label>
      <p v-if="statusLoading" role="status" class="text-xs">正在读取合规确认信息…</p>
      <div v-if="statusError" role="alert" class="space-y-2 text-xs text-red-500"><p>{{ statusError }}</p><MacButton :disabled="statusLoading" @click="emit('retry')">重新读取</MacButton></div>
      <p v-if="error" role="alert" class="text-xs text-red-500">{{ error }}</p>
    </div>
    <template #footer>
      <MacButton variant="default" :disabled="loading" @click="emit('close')">稍后处理</MacButton>
      <MacButton variant="primary" :loading="loading" :disabled="!ready" @click="accept">确认并继续</MacButton>
    </template>
    </MacSheet>
  </div>
</template>

<style scoped>
/* This is a global system gate, so it is centered instead of using the app-sheet top anchor. */
.admin-compliance-sheet :deep(.mac-sheet-overlay) {
  position: fixed;
  z-index: 56010;
  align-items: center;
  padding-top: 24px;
  padding-bottom: 24px;
}

@media (max-width: 600px) {
  .admin-compliance-sheet :deep(.mac-sheet-overlay) {
    align-items: flex-end;
    padding: 8px;
  }
}
</style>
