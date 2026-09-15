<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import QRCode from 'qrcode';
import { MacButton, MacGroupCard, MacSheet } from '@sub2-mac/core';
import { totpAPI } from '@/api/totp';
import type { TotpStatus, TotpSetupResponse } from '@/types';
defineProps<{ sheetTarget: HTMLElement | null }>();

const status = ref<TotpStatus | null>(null);
const reading = ref(false);
const statusError = ref('');
const notice = ref('');
const show = ref(false);
const operation = ref<'enable' | 'disable'>('enable');
const method = ref<'email' | 'password' | null>(null);
const busy = ref(false);
const error = ref('');
const message = ref('');
const credential = ref('');
const code = ref('');
const setup = ref<TotpSetupResponse | null>(null);
const qr = ref('');
const clock = ref(Date.now());
const resendAt = ref(0);
const expiresAt = ref(0);
const input = ref<HTMLInputElement | null>(null);
let disposed = false;
const timer = setInterval(() => { clock.value = Date.now(); }, 1000);
const cooldown = computed(() => Math.max(0, Math.ceil((resendAt.value - clock.value) / 1000)));
const remaining = computed(() => Math.max(0, Math.ceil((expiresAt.value - clock.value) / 1000)));
const canSubmit = computed(() => !busy.value && (setup.value
  ? remaining.value > 0 && /^\d{6}$/.test(code.value)
  : method.value === 'email' ? /^\d{6}$/.test(credential.value) : method.value === 'password' && credential.value.length > 0));
function errorText(err: unknown, fallback: string) {
  return (err as { message?: string })?.message || fallback;
}
async function loadStatus() {
  if (reading.value) return;
  reading.value = true;
  status.value = null;
  statusError.value = '';
  try {
    const result = await totpAPI.getStatus();
    if (typeof result?.enabled !== 'boolean' || typeof result?.feature_enabled !== 'boolean') throw new Error('双因素认证状态无法确认，请重新读取。');
    if (!disposed) status.value = result;
  } catch (err) { if (!disposed) statusError.value = errorText(err, '读取失败，请重试。'); }
  finally { reading.value = false; }
}
function clearSetup() {
  credential.value = ''; code.value = ''; setup.value = null; qr.value = ''; expiresAt.value = 0;
}
function close() {
  if (busy.value) return;
  show.value = false;
  clearSetup();
}
async function loadMethod() {
  if (busy.value) return;
  busy.value = true; error.value = ''; method.value = null;
  try {
    const result = await totpAPI.getVerificationMethod();
    if (result.method !== 'email' && result.method !== 'password') throw new Error('暂不支持此验证方式，请联系管理员。');
    if (!disposed) method.value = result.method;
  } catch (err) { error.value = errorText(err, '无法读取身份验证方式，请重试。'); }
  finally { busy.value = false; await nextTick(); input.value?.focus(); }
}
async function open() {
  if (!status.value?.feature_enabled || reading.value || busy.value) return;
  clearSetup(); error.value = ''; message.value = ''; notice.value = '';
  operation.value = status.value.enabled ? 'disable' : 'enable';
  show.value = true;
  await loadMethod();
}
async function sendCode() {
  if (busy.value || cooldown.value || method.value !== 'email') return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    const result = await totpAPI.sendVerifyCode();
    if (result?.success === false) throw new Error('验证码未发送，请重试。');
    resendAt.value = Date.now() + 60_000;
    clock.value = Date.now(); message.value = '验证码已发送至您的账户邮箱。';
  } catch (err) { error.value = errorText(err, '发送失败，请稍后重试。'); }
  finally { busy.value = false; await nextTick(); if (!disposed) input.value?.focus(); }
}
async function submit() {
  if (!canSubmit.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try {
    if (setup.value) {
      const result = await totpAPI.enable({ setup_token: setup.value.setup_token, totp_code: code.value });
      if (result?.success !== true) throw new Error('未确认启用成功，请重新读取状态。');
    } else {
      const request = method.value === 'email' ? { email_code: credential.value } : { password: credential.value };
      if (operation.value === 'disable') {
        const result = await totpAPI.disable(request);
        if (result?.success !== true) throw new Error('未确认停用成功，请重新读取状态。');
      } else {
        const result = await totpAPI.initiateSetup(request);
        if (!result?.secret || !result.setup_token || !result.qr_code_url || !Number.isFinite(result.countdown) || result.countdown <= 0) throw new Error('设置凭证无效，请重试。');
        if (disposed) return;
        setup.value = result; credential.value = '';
        expiresAt.value = Date.now() + result.countdown * 1000; clock.value = Date.now();
        try { qr.value = await QRCode.toDataURL(result.qr_code_url, { width: 200, margin: 2 }); }
        catch { message.value = '二维码生成失败，请手动输入下方密钥。'; }
        await nextTick(); input.value?.focus();
        return;
      }
    }
    if (disposed) return;
    show.value = false; clearSetup();
    notice.value = operation.value === 'enable' ? '双因素认证已启用。' : '双因素认证已停用。';
    await loadStatus();
  } catch (err) { error.value = errorText(err, '操作失败，请重试。'); }
  finally { busy.value = false; await nextTick(); if (!disposed) input.value?.focus(); }
}
function restartSetup() { if (!busy.value) { clearSetup(); error.value = ''; message.value = ''; void nextTick(() => input.value?.focus()); } }
async function copySecret() {
  if (!setup.value) return;
  try { await navigator.clipboard.writeText(setup.value.secret); message.value = '密钥已复制，请妥善保管。'; }
  catch { error.value = '复制失败，请手动选择密钥。'; }
}
onMounted(loadStatus);
onUnmounted(() => { disposed = true; clearInterval(timer); clearSetup(); });
</script>

<template>
  <MacGroupCard title="双因素认证 (2FA)">
    <div class="totp-content">
      <p class="totp-muted">使用身份验证器生成动态验证码，保护账户登录。</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <p v-if="reading" role="status">正在读取安全状态…</p>
      <div v-else-if="statusError" role="alert"><p>{{ statusError }}</p><MacButton @click="loadStatus">重新读取</MacButton></div>
      <p v-else-if="status && !status.feature_enabled">管理员尚未开放双因素认证功能。</p>
      <div v-else-if="status" class="totp-row">
        <span>{{ status.enabled ? '已启用双因素认证' : '未启用双因素认证' }}</span>
        <MacButton :variant="status.enabled ? 'default' : 'primary'" @click="open">{{ status.enabled ? '停用…' : '启用…' }}</MacButton>
      </div>
    </div>
  </MacGroupCard>
  <Teleport v-if="sheetTarget" :to="sheetTarget">
  <MacSheet :show="show" :title="operation === 'disable' ? '停用双因素认证' : '启用双因素认证'" :loading="busy" @close="close">
    <form class="totp-form" @submit.prevent="submit">
      <p v-if="operation === 'disable'">停用后，登录将不再要求动态验证码。请验证身份以确认停用。</p>
      <p v-if="error" class="totp-error" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <template v-if="setup">
        <p>使用身份验证器扫描二维码，或手动输入密钥，再填写应用中的 6 位验证码。</p>
        <img v-if="qr" :src="qr" width="200" height="200" alt="身份验证器设置二维码" class="totp-qr" />
        <code class="totp-secret">{{ setup.secret }}</code>
        <MacButton @click="copySecret">复制密钥</MacButton>
        <p class="totp-muted" role="status">{{ remaining > 0 ? `设置凭证将在 ${remaining} 秒后过期` : '设置凭证已过期，请重新验证身份。' }}</p>
        <label>动态验证码<input ref="input" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" :disabled="busy || !remaining" /></label>
        <MacButton :disabled="busy" @click="restartSetup">重新设置</MacButton>
      </template>
      <template v-else-if="method">
        <label>{{ method === 'email' ? '账户邮箱验证码' : '当前密码' }}
          <input ref="input" v-model="credential" :type="method === 'password' ? 'password' : 'text'" :inputmode="method === 'email' ? 'numeric' : 'text'" :autocomplete="method === 'email' ? 'one-time-code' : 'current-password'" :maxlength="method === 'email' ? 6 : undefined" :disabled="busy" />
        </label>
        <MacButton v-if="method === 'email'" :disabled="busy || cooldown > 0" @click="sendCode">{{ cooldown ? `${cooldown} 秒后重发` : '发送验证码' }}</MacButton>
      </template>
      <MacButton v-else-if="!busy" @click="loadMethod">重试读取验证方式</MacButton>
      <p v-else role="status">正在读取验证方式…</p>
      <button type="submit" hidden :disabled="!canSubmit" tabindex="-1">提交</button>
    </form>
    <template #footer>
      <MacButton :disabled="busy" @click="close">取消</MacButton>
      <MacButton :variant="operation === 'disable' ? 'destructive' : 'primary'" :disabled="!canSubmit" :loading="busy" @click="submit">{{ operation === 'disable' ? '确认停用' : setup ? '验证并启用' : '下一步' }}</MacButton>
    </template>
  </MacSheet>
  </Teleport>
</template>

<style scoped>
.totp-content { padding: 16px; font-size: 12px; display: grid; gap: 12px; }
.totp-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.totp-muted { color: var(--text-secondary); }
.totp-form { display: grid; gap: 14px; min-width: 0; }
.totp-form label { display: grid; gap: 8px; }
.totp-form input { width: 100%; min-width: 0; border: 1px solid var(--border-subtle); border-radius: 8px; padding: 10px 12px; background: var(--bg-surface); color: var(--text-primary); }
.totp-form input:focus-visible { outline: 3px solid rgb(0 122 255 / 35%); outline-offset: 2px; }
.totp-error { color: var(--status-danger, #c43731); }
.totp-qr { justify-self: center; max-width: 100%; height: auto; border-radius: 8px; }
.totp-secret { overflow-wrap: anywhere; user-select: text; padding: 12px; background: var(--bg-surface); border-radius: 8px; }
</style>
