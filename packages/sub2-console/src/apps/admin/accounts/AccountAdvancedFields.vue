<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { proxiesAPI } from '@/api/admin/proxies'
import type { Proxy } from '@/types'
import type { AdvancedForm } from './advanced'
const form = defineModel<AdvancedForm>({ required: true })
defineProps<{ editing: boolean; disabled: boolean }>()
const proxies = ref<Proxy[]>([])
const missingProxy = computed(() => form.value.proxy_id && !proxies.value.some(p => p.id === form.value.proxy_id))
const proxyError = ref('')
const proxyBusy = ref(false)
let disposed = false
onBeforeUnmount(() => { disposed = true })
async function load() {
  if (proxyBusy.value) return
  proxyBusy.value = true; proxyError.value = ''
  try { const data = await proxiesAPI.getAll(); if (!disposed) proxies.value = data }
  catch { if (!disposed) proxyError.value = '代理列表加载失败，当前选择保留。' }
  finally { if (!disposed) proxyBusy.value = false }
}
onMounted(load)
</script>
<template>
  <details class="advanced">
    <summary>调度与高级设置</summary>
    <fieldset :disabled="disabled">
      <label>备注<textarea v-model="form.notes" rows="2" /></label>
      <label>连接代理<select v-model="form.proxy_id" :disabled="proxyBusy || !!proxyError"><option :value="null">不使用代理</option><option v-if="missingProxy" :value="form.proxy_id">当前代理 #{{ form.proxy_id }}</option><option v-for="p in proxies" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
      <p v-if="proxyError">{{ proxyError }} <button type="button" @click="load">重新加载</button></p>
      <label>调度负载（留空使用默认值）<input v-model.number="form.load_factor" type="number" min="1" step="1" /></label>
      <label>计费倍率（0 为免费）<input v-model.number="form.rate_multiplier" type="number" min="0" step="0.01" /></label>
      <label>到期时间（本地时间，留空不限期）<input v-model="form.expires" type="datetime-local" /></label>
      <label class="check"><input v-model="form.auto_pause_on_expired" type="checkbox" />到期自动暂停</label>
      <label v-if="editing" class="check"><input v-model="form.schedulable" type="checkbox" />允许调度</label>
    </fieldset>
  </details>
</template>
<style scoped>
summary{cursor:pointer;padding:10px 0;font-weight:600}fieldset{border:0;padding:8px 0;display:grid;gap:12px;min-width:0}label{display:grid;gap:6px}.check{display:flex;align-items:center;gap:8px}input:not([type=checkbox]),textarea,select{min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--border-color);border-radius:7px;padding:7px 9px;background:var(--input-bg,transparent);color:inherit}textarea{resize:vertical}input:focus-visible,select:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid #007aff;outline-offset:2px}p{color:var(--text-secondary)}
</style>
