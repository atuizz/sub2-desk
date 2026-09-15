<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MacButton, MacSheet } from '@sub2-mac/core';
import type { PublicSettings } from '@/types';
const props = defineProps<{ settings: PublicSettings | null; modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const show = ref(false);
const documents = computed(() => (props.settings?.login_agreement_documents || []).filter(d => d.title?.trim()));
const required = computed(() => props.settings?.login_agreement_enabled === true);
const revision = computed(() => JSON.stringify([props.settings?.login_agreement_revision, props.settings?.login_agreement_updated_at, documents.value]));
watch(revision, () => { emit('update:modelValue', !required.value); show.value = required.value && props.settings?.login_agreement_mode !== 'checkbox'; }, { immediate: true });
function accept() { if (!documents.value.length) return; emit('update:modelValue', true); show.value = false; }
function reject() { emit('update:modelValue', false); show.value = false; }
</script>
<template>
  <div v-if="required" class="w-full text-xs space-y-2">
    <p v-if="!documents.length" role="alert">登录协议尚未提供，请联系管理员。</p>
    <div class="flex items-center gap-2">
      <input v-if="settings?.login_agreement_mode === 'checkbox'" aria-label="接受登录协议" type="checkbox" :checked="modelValue" :disabled="!documents.length" @change="($event.target as HTMLInputElement).checked ? accept() : reject()" />
      <span>{{ modelValue ? '已接受登录协议' : '请阅读并接受登录协议' }}</span><button type="button" class="underline" @click="show = true">查看协议</button>
    </div>
    <MacSheet :show="show" title="登录协议" @close="reject">
      <p class="text-xs mb-3">{{ settings?.login_agreement_updated_at }}</p>
      <article v-for="doc in documents" :key="doc.id" class="mb-5 select-text"><h3 class="font-semibold mb-2">{{ doc.title }}</h3><div class="whitespace-pre-wrap break-words text-xs leading-6">{{ doc.content_md }}</div></article>
      <p v-if="!documents.length">协议内容暂不可用。</p>
      <template #footer><MacButton @click="reject">暂不接受</MacButton><MacButton variant="primary" :disabled="!documents.length" @click="accept">阅读并接受</MacButton></template>
    </MacSheet>
  </div>
</template>
