<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { totpAPI } from '../../api/totp';
import type { StepUpController } from '../../composables/useStepUp';

const props = defineProps<{ controller: StepUpController }>();

const code = ref('');
const error = ref('');
const verifying = ref(false);
const input = ref<HTMLInputElement | null>(null);

function reset(): void {
  code.value = '';
  error.value = '';
  verifying.value = false;
}

watch(() => props.controller.visible.value, (open) => {
  if (open) {
    reset();
    void nextTick(() => input.value?.focus());
  }
});

function handleCancel(): void {
  if (verifying.value) return;
  props.controller.onCancel();
}

async function submit(): Promise<void> {
  if (verifying.value) return;
  if (!/^\d{6}$/.test(code.value)) {
    error.value = '请输入 6 位动态验证码';
    return;
  }
  verifying.value = true;
  error.value = '';
  try {
    const result = await totpAPI.stepUp(code.value);
    if (!result.verified) throw new Error('身份验证未通过');
    reset();
    props.controller.onVerified();
  } catch (err) {
    verifying.value = false;
    code.value = '';
    if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
      error.value = (err as { message: string }).message || '身份验证失败';
    } else {
      error.value = '身份验证失败';
    }
    void nextTick(() => input.value?.focus());
  }
}
</script>

<template>
  <MacSheet :show="controller.visible.value" title="两步验证" :loading="verifying" @close="handleCancel">
    <p class="text-xs text-[var(--text-secondary)] leading-relaxed">此操作需要你已开启的两步验证（TOTP）。请输入验证器应用显示的 6 位动态验证码，验证通过后将继续执行刚才的操作。</p>
    <form class="totp-step-up-form mt-4" @submit.prevent="submit">
      <label class="block text-xs font-medium text-[var(--text-secondary)]">动态验证码
        <input
          ref="input"
          v-model="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          pattern="[0-9]{6}"
          :disabled="verifying"
          class="mt-1 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5 text-[var(--text-primary)] focus:outline-none"
        />
      </label>
      <p v-if="error" role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ error }}</p>
    </form>
    <template #footer>
      <MacButton :disabled="verifying" @click="handleCancel">取消</MacButton>
      <MacButton variant="primary" :disabled="verifying || !/^\d{6}$/.test(code)" :loading="verifying" @click="submit">验证并继续</MacButton>
    </template>
  </MacSheet>
</template>

<style scoped>
.totp-step-up-form input:focus-visible { outline: 3px solid rgb(0 122 255 / 35%); outline-offset: 2px; }
</style>
