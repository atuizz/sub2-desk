<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { MacButton } from '@sub2-mac/core';
import CaptchaGate from '@/components/auth/CaptchaGate.vue';
import { useAuthStore } from '@/stores/auth';
import { buildApiUrl } from '@/api/url';
import { exchangePendingOAuthCompletion, desktopOAuthStep, safeAuthRedirect, desktopOAuthReferralPayload, completeDesktopOAuthRegistration, submitPendingOAuthAction, sendPendingOAuthVerifyCode, login2FA, type DesktopOAuthCompletion, type OAuthLoginProvider, type readDesktopOAuthCallback } from '@/api/auth';
import type { PublicSettings } from '@/types';
const props = defineProps<{ callback: NonNullable<ReturnType<typeof readDesktopOAuthCallback>>; settings: PublicSettings | null; allowed: boolean }>();
const emit = defineEmits<{ complete: [redirect?: string]; cancel: [] }>();
const auth = useAuthStore();
const step = ref<'loading' | 'choice' | 'create' | 'bind' | 'registration' | 'adoption' | '2fa' | 'error'>('loading');
const busy = ref(false), error = ref(''), notice = ref('');
const email = ref(''), password = ref(''), confirmation = ref(''), invitation = ref(''), code = ref(''), tempToken = ref('');
const adoptName = ref(false), adoptAvatar = ref(false);
const completion = ref<DesktopOAuthCompletion>({});
const returnPath = ref(safeAuthRedirect(props.callback.redirect));
const provider = ref<OAuthLoginProvider | ''>(props.callback.provider as OAuthLoginProvider | '');
const captcha = ref<InstanceType<typeof CaptchaGate> | null>(null);
const resendAt = ref(0), now = ref(Date.now());
const resendSeconds = computed(() => Math.max(0, Math.ceil((resendAt.value - now.value) / 1000)));
const timer = setInterval(() => { now.value = Date.now(); }, 1000);
const emailProvider = computed(() => provider.value === 'github' || provider.value === 'google');
const needsInvitation = computed(() => completion.value.error === 'invitation_required' || completion.value.invitation_required === true || props.settings?.invitation_code_enabled === true);
let started = false, generation = 0;
const sessionController = new AbortController();
function clearSecrets() { password.value = ''; confirmation.value = ''; code.value = ''; tempToken.value = ''; captcha.value?.reset(); }
function cancel() { generation++; sessionController.abort(); clearSecrets(); completion.value = {}; props.callback.pendingToken = ''; props.callback.tokens = null; props.callback.code = ''; props.callback.state = ''; sessionStorage.removeItem('email_oauth_pending_provider'); emit('cancel'); }
function choose(value: 'create' | 'bind') { clearSecrets(); error.value = ''; step.value = value; }
function decision() { return { adoptDisplayName: adoptName.value, adoptAvatar: adoptAvatar.value }; }
function decisionPayload() { return { adopt_display_name: adoptName.value, adopt_avatar: adoptAvatar.value }; }
async function apply(result: DesktopOAuthCompletion, current: number) {
  if (current !== generation) return;
  completion.value = result;
  returnPath.value = safeAuthRedirect(result.redirect, returnPath.value);
  if (result.provider && ['github', 'google', 'linuxdo', 'dingtalk', 'wechat', 'oidc'].includes(result.provider)) provider.value = result.provider;
  const next = desktopOAuthStep(result);
  email.value = result.resolved_email || result.email || result.pending_email || result.suggested_email || email.value;
  if (next === '2fa') { clearSecrets(); tempToken.value = result.temp_token || ''; completion.value = { ...result, temp_token: undefined }; step.value = '2fa'; return; }
  if (next === 'complete') {
    if (result.access_token) await auth.acceptExternalSession({ ...result, access_token: result.access_token }, sessionController.signal);
    else {
      await auth.initAuth();
      if (!auth.isAuthenticated) throw new Error('绑定完成，但原登录会话已过期，请重新登录。');
    }
    if (current !== generation) return;
    clearSecrets(); completion.value = {}; props.callback.pendingToken = ''; props.callback.tokens = null;
    sessionStorage.removeItem('email_oauth_pending_provider'); emit('complete', result.access_token ? returnPath.value : safeAuthRedirect(result.redirect, '/profile')); return;
  }
  step.value = next;
  if (next === 'error') throw new Error(result.error || '授权结果不完整，请重新发起登录。');
}
async function resume() {
  if (busy.value || !props.allowed) return;
  busy.value = true; error.value = ''; const current = generation;
  try {
    const cb = props.callback;
    if (cb.tokens) { const tokens = cb.tokens; cb.tokens = null; await apply(tokens, current); return; }
    if (cb.error === 'invitation_required' && cb.pendingToken) { await apply({ error: cb.error }, current); return; }
    if (cb.error) throw new Error('第三方授权失败或已取消，请重新发起登录。');
    // Email OAuth may land with code/state; pass them to the server callback,
    // never exchange authorization codes or validate OAuth state in the client.
    if (!cb.provider && cb.code && cb.state) {
      const remembered = sessionStorage.getItem('email_oauth_pending_provider');
      if (remembered !== 'github' && remembered !== 'google') throw new Error('授权来源已过期，请重新登录。');
      const params = new URLSearchParams({ code: cb.code, state: cb.state }); cb.code = ''; cb.state = '';
      window.location.assign(buildApiUrl(`/auth/oauth/${remembered}/callback?${params}`)); return;
    }
    const result = await exchangePendingOAuthCompletion() as DesktopOAuthCompletion;
    if (props.callback.emailCompletion && !result.access_token && !result.error) result.step = 'email_completion';
    await apply(result, current);
  } catch (e) { if (current === generation) { step.value = 'error'; error.value = (e as Error).message || '授权恢复失败，请重试。'; } }
  finally { if (current === generation) busy.value = false; }
}
async function sendCode() {
  if (busy.value || resendSeconds.value || !props.allowed || !props.settings?.email_verify_enabled) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { error.value = '请输入有效邮箱'; return; }
  busy.value = true; error.value = ''; const current = generation;
  try {
    const proof = await captcha.value?.verify(); if (!proof || current !== generation) return;
    const result = await sendPendingOAuthVerifyCode({ email: email.value.trim(), ...proof, ...(props.callback.pendingToken ? { pending_oauth_token: props.callback.pendingToken } : {}) });
    if (current !== generation) return;
    resendAt.value = Date.now() + (Number.isFinite(result.countdown) ? Math.max(0, result.countdown) : 60) * 1000;
    notice.value = '验证码已发送。';
  } catch (e) { if (current === generation) error.value = (e as Error).message || '发送失败，请重试。'; }
  finally { if (current === generation) { busy.value = false; captcha.value?.reset(); } }
}
async function submit() {
  if (busy.value || !props.allowed) return;
  error.value = '';
  if (step.value === 'create' && props.settings?.registration_enabled !== true) { error.value = '管理员尚未开放注册。'; return; }
  if (['create', 'bind'].includes(step.value) && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) || !password.value)) { error.value = '请输入有效邮箱和密码'; return; }
  if ((step.value === 'create' || (step.value === 'registration' && emailProvider.value)) && (password.value.length < 6 || password.value !== confirmation.value)) { error.value = '密码至少 6 位，且两次输入须一致'; return; }
  if (['create', 'registration'].includes(step.value) && needsInvitation.value && !invitation.value.trim()) { error.value = '请输入邀请码'; return; }
  if (step.value === 'create' && props.settings?.email_verify_enabled && !/^\d{6}$/.test(code.value)) { error.value = '请输入 6 位邮箱验证码'; return; }
  if (step.value === '2fa' && (!tempToken.value || !/^\d{6}$/.test(code.value))) { error.value = '请输入 6 位动态验证码'; return; }
  const current = generation; busy.value = true;
  try {
    let result: DesktopOAuthCompletion;
    if (step.value === '2fa') result = await login2FA({ temp_token: tempToken.value, totp_code: code.value }, false);
    else if (step.value === 'adoption') result = await exchangePendingOAuthCompletion(decision());
    else if (step.value === 'registration') {
      if (!provider.value) throw new Error('授权来源缺失，请重新登录。');
      result = await completeDesktopOAuthRegistration(provider.value, {
        ...(emailProvider.value ? { password: password.value } : decisionPayload()),
        ...desktopOAuthReferralPayload(),
        ...(needsInvitation.value ? { invitation_code: invitation.value.trim() } : {}),
        ...(props.callback.pendingToken ? { pending_oauth_token: props.callback.pendingToken } : {}),
      });
    } else if (step.value === 'create' || step.value === 'bind') {
      const proof = step.value === 'create' ? await captcha.value?.verify() : {};
      if (!proof || current !== generation) return;
      result = await submitPendingOAuthAction(step.value === 'create' ? 'create-account' : 'bind-login', {
        email: email.value.trim(), password: password.value, ...decisionPayload(),
        ...(step.value === 'create' ? desktopOAuthReferralPayload() : {}),
        ...(step.value === 'create' ? { ...proof, ...(props.settings?.email_verify_enabled ? { verify_code: code.value } : {}), ...(needsInvitation.value ? { invitation_code: invitation.value.trim() } : {}) } : {}),
      });
    } else return;
    password.value = ''; confirmation.value = ''; code.value = '';
    await apply(result, current);
  } catch (e) {
    if (current === generation) {
      const failure = e as { message?: string; reason?: string; code?: string; response?: { data?: { error?: string; code?: string; reason?: string } } };
      const reason = failure.response?.data;
      if (step.value === 'create' && [failure.reason, failure.code, reason?.error, reason?.code, reason?.reason].some(x => ['email_exists', 'bind_login_required', 'adopt_existing_user_by_email'].includes((x || '').toLowerCase()))) step.value = 'bind';
      error.value = failure.message || '操作失败，请重试。';
    }
  } finally { if (current === generation) { busy.value = false; password.value = ''; confirmation.value = ''; code.value = ''; captcha.value?.reset(); } }
}
watch(() => props.allowed, value => { if (value && !started) { started = true; void resume(); } }, { immediate: true });
watch(email, () => { code.value = ''; notice.value = ''; });
onUnmounted(() => { generation++; sessionController.abort(); clearSecrets(); completion.value = {}; props.callback.pendingToken = ''; props.callback.tokens = null; clearInterval(timer); });
</script>
<template>
  <div class="w-full text-xs space-y-3" @keydown.stop>
    <h3 class="font-semibold">完成第三方登录</h3>
    <p v-if="!allowed">请先阅读并接受登录协议。</p>
    <p v-else-if="step === 'loading'" role="status">正在恢复授权…</p>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="step === 'choice'"><p>选择创建新账户，或绑定已有账户。</p><MacButton :disabled="busy || !settings?.registration_enabled" @click="choose('create')">创建新账户</MacButton><MacButton :disabled="busy" @click="choose('bind')">绑定已有账户</MacButton></template>
    <form v-if="['create', 'bind', 'registration', 'adoption', '2fa'].includes(step)" class="space-y-3" @submit.prevent="submit">
      <template v-if="['create', 'bind'].includes(step) || (step === 'registration' && emailProvider)">
        <label class="block">邮箱<input v-model="email" type="email" autocomplete="email" :readonly="step === 'registration'" :disabled="busy" class="oauth-input" /></label>
        <label class="block">{{ step === 'bind' ? '已有账户密码' : '设置密码' }}<input v-model="password" type="password" :autocomplete="step === 'bind' ? 'current-password' : 'new-password'" :disabled="busy" class="oauth-input" /></label>
        <label v-if="step !== 'bind'" class="block">确认密码<input v-model="confirmation" type="password" autocomplete="new-password" :disabled="busy" class="oauth-input" /></label>
      </template>
      <label v-if="['create', 'registration'].includes(step) && needsInvitation" class="block">邀请码<input v-model="invitation" :disabled="busy" class="oauth-input" /></label>
      <template v-if="step === 'create'"><CaptchaGate ref="captcha" :settings="settings" /><template v-if="settings?.email_verify_enabled"><label class="block">邮箱验证码<input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="busy" class="oauth-input" /></label><MacButton :disabled="busy || resendSeconds > 0" @click="sendCode">{{ resendSeconds ? `${resendSeconds} 秒后重发` : '发送验证码' }}</MacButton></template></template>
      <label v-if="step === '2fa'" class="block">动态验证码<input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" :disabled="busy" class="oauth-input" /></label>
      <template v-if="completion.suggested_display_name || completion.suggested_avatar_url"><p>可选择使用第三方资料：</p><label v-if="completion.suggested_display_name" class="block break-all"><input v-model="adoptName" type="checkbox" :disabled="busy" /> 使用昵称 {{ completion.suggested_display_name }}</label><label v-if="completion.suggested_avatar_url" class="block"><input v-model="adoptAvatar" type="checkbox" :disabled="busy" /> 使用第三方头像</label></template>
      <MacButton variant="primary" :loading="busy" :disabled="!allowed" @click="submit">{{ step === 'bind' ? '验证并绑定' : step === '2fa' ? '验证' : '确认继续' }}</MacButton>
      <button type="submit" hidden :disabled="busy">确认</button>
      <MacButton v-if="step === 'create'" :disabled="busy" @click="choose('bind')">我已有账户</MacButton>
    </form>
    <MacButton v-if="step === 'error'" :disabled="busy || !allowed" @click="resume">重试</MacButton>
    <MacButton :disabled="busy" @click="cancel">返回登录</MacButton>
  </div>
</template>
<style scoped>.oauth-input{display:block;width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--border-subtle);border-radius:9px;background:var(--bg-surface);color:var(--text-primary)}.oauth-input:focus-visible{outline:2px solid var(--accent)}</style>
