<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useSystemStore } from '../stores/system';
import { useAuthStore } from '../stores/auth';
import { getPublicSettings, sendVerifyCode, forgotPassword, resetPassword } from '@/api/auth';
import type { PublicSettings, ActionCaptchaRequestProof } from '@/types';
import { passkeyAPI } from '@/api/passkey';
import { desktopOAuthProviders, buildOAuthLoginStartURL, startOAuthLogin, resolveWeChatOAuthStart, readDesktopOAuthCallback, safeAuthRedirect, desktopReferralCode, desktopOAuthReferralPayload, clearDesktopReferral, restoreDesktopRegistration, validatePromoCode, submitPendingOAuthAction, sendPendingOAuthVerifyCode, type OAuthLoginProvider } from '@/api/auth';
import CaptchaGate from './auth/CaptchaGate.vue';
import LoginAgreementPanel from '@/apps/user/settings/LoginAgreementPanel.vue';
import OAuthCallbackPanel from '@/apps/user/settings/OAuthCallbackPanel.vue';
import { useSystemAudio } from '@sub2-mac/core';

const systemStore = useSystemStore();
const authStore = useAuthStore();
const audio = useSystemAudio();

const emit = defineEmits<{
  (e: 'restart'): void;
  (e: 'shutdown'): void;
}>();

const timeStr = ref('');
const dateStr = ref('');
let timer: any = null;

function updateTime() {
  const now = new Date();
  clock.value = now.getTime();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  timeStr.value = `${hours}:${minutes}`;

  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayNames = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const day = dayNames[now.getDay()];
  dateStr.value = `${month}月${date}日 ${day}`;
}

// Lockscreen Authentication Modes
type LockMode = 'unlock' | 'switch' | 'register' | '2fa' | 'forgot' | 'reset';
const mode = ref<LockMode>('switch');
const publicSettings = ref<PublicSettings | null>(null);
const basicRegistration = computed(() => publicSettings.value?.registration_enabled === true);
const publicSettingsError = ref('');
const captcha = ref<InstanceType<typeof CaptchaGate> | null>(null);
const agreementAccepted = ref(false);
const agreementReady = computed(() => Boolean(publicSettings.value && (!publicSettings.value.login_agreement_enabled || agreementAccepted.value)));
const externalBusy = ref(false);
const oauthCallback = ref<ReturnType<typeof readDesktopOAuthCallback>>(null);
const returnPath = ref('/');
const promoInput = ref('');
const promoNotice = ref('');
const referralInput = ref('');
const registrationContext = ref<ReturnType<typeof restoreDesktopRegistration>>(null);
function completeLogin(target = returnPath.value) {
  const safe = safeAuthRedirect(target);
  clearDesktopReferral();
  // A full same-origin return also works while the parent desktop is already
  // mounted with an earlier callback URL. The restored session opens its route.
  if (safe !== '/' && safe !== window.location.pathname + window.location.search + window.location.hash) { window.location.replace(safe); return; }
  window.history.replaceState(window.history.state, '', safe);
  systemStore.unlock();
}
async function checkPromo() {
  promoNotice.value = '';
  if (!publicSettings.value?.promo_code_enabled || !promoInput.value.trim()) return true;
  try { const result = await validatePromoCode(promoInput.value.trim()); if (!result.valid) { authStore.errorMsg = '优惠码无效，请检查或清空后继续。'; return false; } promoNotice.value = '优惠码可用'; return true; }
  catch { authStore.errorMsg = '优惠码验证失败，请重试。'; return false; }
}
const oauthProviders = computed(() => desktopOAuthProviders(publicSettings.value));
const oauthLabels: Record<OAuthLoginProvider, string> = { github: 'GitHub', google: 'Google', linuxdo: 'LinuxDo', dingtalk: '钉钉', wechat: '微信', oidc: 'OIDC' };
let ceremony: AbortController | null = null;
let externalGeneration = 0;
function cancelExternal() { externalGeneration++; ceremony?.abort(); ceremony = null; externalBusy.value = false; captcha.value?.reset(); passwordInput.value = ''; }
async function getProof(): Promise<ActionCaptchaRequestProof | null> {
  if (!agreementReady.value) { authStore.errorMsg = publicSettings.value ? '请先阅读并接受登录协议。' : '请先读取站点设置。'; return null; }
  if (!recoveryCaptchaRequired.value) return {};
  return await captcha.value?.verify() ?? null;
}
async function signInWithPasskey() {
  if (externalBusy.value || authStore.isLoading || publicSettings.value?.passkey_enabled !== true) return;
  externalBusy.value = true; authStore.errorMsg = null; const current = ++externalGeneration;
  const controller = new AbortController(); ceremony = controller;
  try {
    const proof = await getProof(); if (!proof || current !== externalGeneration) return;
    const response = await passkeyAPI.login(proof, controller.signal);
    if (current !== externalGeneration) return;
    await authStore.acceptExternalSession(response, controller.signal);
    if (current === externalGeneration) { passwordInput.value = ''; completeLogin(); }
  } catch (e) { if (current === externalGeneration) authStore.errorMsg = ['NotAllowedError', 'AbortError'].includes((e as Error).name) ? '验证已取消，可重新尝试。' : (e as Error).message || '通行密钥登录失败'; }
  finally { if (current === externalGeneration) { externalBusy.value = false; ceremony = null; captcha.value?.reset(); } }
}
async function signInWithOAuth(provider: OAuthLoginProvider) {
  if (externalBusy.value || authStore.isLoading || !oauthProviders.value.includes(provider)) return;
  externalBusy.value = true; authStore.errorMsg = null; const current = ++externalGeneration;
  try {
    const proof = await getProof(); if (!proof || current !== externalGeneration) return;
    const params: Record<string, string> = { redirect: returnPath.value };
    const aff = desktopReferralCode(referralInput.value);
    if (aff) sessionStorage.setItem('oauth_aff_code', aff); else sessionStorage.removeItem('oauth_aff_code');
    if ((provider === 'github' || provider === 'google') && aff) params.aff_code = aff;
    if (publicSettings.value?.promo_code_enabled && promoInput.value.trim()) { if (!await checkPromo()) return; params.promo_code = promoInput.value.trim(); }
    if (provider === 'wechat') {
      const resolved = resolveWeChatOAuthStart(publicSettings.value);
      if (!resolved.mode) throw new Error(resolved.unavailableReason === 'wechat_browser_required' ? '请在微信内打开此页面。' : '请在系统浏览器中打开此页面。');
      params.mode = resolved.mode;
    }
    const request = { provider, params };
    const target = recoveryCaptchaRequired.value ? (await startOAuthLogin(request, proof)).authorize_url : buildOAuthLoginStartURL(request);
    if (current !== externalGeneration) return;
    const url = new URL(target, window.location.href);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('授权地址无效');
    if (provider === 'github' || provider === 'google') sessionStorage.setItem('email_oauth_pending_provider', provider);
    else sessionStorage.removeItem('email_oauth_pending_provider');
    passwordInput.value = ''; window.location.assign(url.href);
  } catch (e) { if (current === externalGeneration) authStore.errorMsg = (e as Error).message || '第三方登录启动失败'; }
  finally { if (current === externalGeneration) { externalBusy.value = false; captcha.value?.reset(); } }
}
function finishOAuth(target?: string) { oauthCallback.value = null; completeLogin(target || returnPath.value); }
function cancelOAuth() { oauthCallback.value = null; window.history.replaceState(window.history.state, '', '/login'); setMode('switch'); }

const invitationInput = ref('');
const emailCodeInput = ref('');
const confirmPasswordInput = ref('');
const sendingCode = ref(false);
const codeMessage = ref('');
const verifiedEmail = ref('');
const clock = ref(Date.now());
const resendAt = ref(0);
const resendSeconds = computed(() => Math.max(0, Math.ceil((resendAt.value - clock.value) / 1000)));
const recoveryBusy = ref(false);
const recoveryMessage = ref('');
const recoveryComplete = ref(false);
const resetEmail = ref('');
const resetToken = ref('');
const resetLinkInvalid = ref(false);
const recoveryMode = computed(() => mode.value === 'forgot' || mode.value === 'reset');
const recoveryCaptchaRequired = computed(() => Boolean(publicSettings.value?.turnstile_enabled || publicSettings.value?.tencent_captcha_enabled || publicSettings.value?.aliyun_captcha_enabled));
const canRequestRecovery = computed(() => publicSettings.value?.password_reset_enabled === true);

function readRecoveryLink() {
  const url = new URL(window.location.href);
  if (/\/reset-password\/?$/.test(url.pathname)) {
    mode.value = 'reset';
    resetEmail.value = url.searchParams.get('email') || '';
    resetToken.value = url.searchParams.get('token') || '';
    resetLinkInvalid.value = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail.value) || !resetToken.value.trim();
    // Keep the one-use credential in memory only; do not leave it in the address bar.
    url.searchParams.delete('email'); url.searchParams.delete('token');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    return true;
  }
  if (/\/forgot-password\/?$/.test(url.pathname)) { mode.value = 'forgot'; return true; }
  return false;
}

async function submitRecovery() {
  if (recoveryBusy.value || authStore.isLoading || recoveryComplete.value) return;
  authStore.errorMsg = null; recoveryMessage.value = '';
  if (mode.value === 'forgot') {
    if (!canRequestRecovery.value) { authStore.errorMsg = recoveryCaptchaRequired.value ? '本站要求人机验证，请通过原版登录页找回密码。' : publicSettings.value?.password_reset_enabled === false ? '管理员尚未开放密码找回。' : '请先重新读取站点设置'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountInput.value.trim())) { authStore.errorMsg = '请输入有效邮箱'; return; }
  } else if (mode.value === 'reset') {
    if (resetLinkInvalid.value || !resetEmail.value || !resetToken.value) { authStore.errorMsg = '重置链接无效，请重新申请'; return; }
    if (passwordInput.value.length < 6) { authStore.errorMsg = '新密码至少需要 6 个字符'; return; }
    if (passwordInput.value !== confirmPasswordInput.value) { authStore.errorMsg = '两次密码输入不一致'; return; }
  } else return;
  recoveryBusy.value = true;
  try {
    if (mode.value === 'forgot') {
      const proof = await getProof(); if (!proof) return;
      await forgotPassword({ email: accountInput.value.trim(), ...proof });
      recoveryMessage.value = '如果该邮箱可以找回密码，您将收到重置邮件。请检查收件箱和垃圾邮件。';
    } else {
      await resetPassword({ email: resetEmail.value, token: resetToken.value, new_password: passwordInput.value });
      resetToken.value = ''; passwordInput.value = ''; confirmPasswordInput.value = '';
      recoveryMessage.value = '密码已重置，请返回登录并使用新密码。';
    }
    recoveryComplete.value = true;
  } catch (err) {
    const failure = err as { code?: string; message?: string; response?: { data?: { code?: string } } };
    if (failure.code === 'INVALID_RESET_TOKEN' || failure.response?.data?.code === 'INVALID_RESET_TOKEN') {
      resetLinkInvalid.value = true; resetToken.value = '';
      authStore.errorMsg = '重置链接已失效或已使用，请重新申请。';
    } else authStore.errorMsg = failure.message || '操作失败，请稍后重试';
  } finally { recoveryBusy.value = false; captcha.value?.reset(); }
}

const accountInput = ref('');
const passwordInput = ref('');
const totpInput = ref('');
const isShaking = ref(false);
watch(accountInput, () => { emailCodeInput.value = ''; verifiedEmail.value = ''; codeMessage.value = ''; });

async function loadPublicSettings() {
  publicSettingsError.value = '';
  try { publicSettings.value = await getPublicSettings(); }
  catch { publicSettings.value = null; publicSettingsError.value = '站点设置读取失败'; }
}

async function sendRegistrationCode() {
  if (sendingCode.value || authStore.isLoading || resendSeconds.value || !basicRegistration.value || !publicSettings.value?.email_verify_enabled) return;
  const email = accountInput.value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { authStore.errorMsg = '请输入有效邮箱'; return; }
  sendingCode.value = true; authStore.errorMsg = null; codeMessage.value = '';
  try {
    const proof = await getProof(); if (!proof) return;
    const context = registrationContext.value;
    const payload = { email, ...proof, ...(context?.pendingToken ? { [context.pendingTokenField]: context.pendingToken } : {}) };
    const response = context?.provider ? await sendPendingOAuthVerifyCode(payload) : await sendVerifyCode(payload);
    verifiedEmail.value = email;
    const seconds = Number.isFinite(response.countdown) ? Math.max(0, response.countdown) : 60;
    resendAt.value = Date.now() + seconds * 1000; clock.value = Date.now();
    codeMessage.value = '验证码已发送，请查收邮箱。';
  } catch (err) { authStore.errorMsg = (err as { message?: string }).message || '验证码发送失败，请重试'; }
  finally { sendingCode.value = false; captcha.value?.reset(); }
}

function triggerShake() {
  isShaking.value = true;
  audio.playError();
  setTimeout(() => {
    isShaking.value = false;
  }, 500);
}

function setMode(newMode: LockMode) {
  if (authStore.isLoading || sendingCode.value || recoveryBusy.value || externalBusy.value) return;
  if (mode.value === 'reset' && newMode !== 'reset') { resetToken.value = ''; resetEmail.value = ''; }
  recoveryComplete.value = false; recoveryMessage.value = '';
  captcha.value?.reset();
  mode.value = newMode;
  passwordInput.value = '';
  totpInput.value = '';
  emailCodeInput.value = ''; confirmPasswordInput.value = ''; invitationInput.value = ''; codeMessage.value = '';
  authStore.requires2FA = false;
  authStore.temp2FAToken = null;
  authStore.errorMsg = null;
}

// Unified Action Handler based on macOS semantics
async function handleAction() {
  if (recoveryMode.value) { await submitRecovery(); return; }
  if (authStore.isLoading || sendingCode.value || externalBusy.value || oauthCallback.value) return;
  let proof: ActionCaptchaRequestProof = {};
  if (mode.value !== '2fa') {
    const current = ++externalGeneration;
    externalBusy.value = true;
    try {
      const obtained = await getProof();
      if (!obtained || current !== externalGeneration) return;
      proof = obtained;
    } finally { if (current === externalGeneration) externalBusy.value = false; }
  }
  try {
  if (mode.value === 'unlock') {
    const account = authStore.user?.email || authStore.user?.username;
    if (!account) { setMode('switch'); return; }
    const pwd = passwordInput.value;
    if (!pwd) { authStore.errorMsg = '请输入密码'; return; }
    const res = await authStore.login(account, pwd, proof);

    if (res.success) {
      audio.playClick();
      passwordInput.value = '';
      completeLogin();
    } else if (res.requires2FA) {
      mode.value = '2fa';
      passwordInput.value = '';
    } else {
      triggerShake();
    }
  } else if (mode.value === 'switch') {
    const account = accountInput.value.trim();
    const pwd = passwordInput.value;

    if (!account) {
      authStore.errorMsg = '请输入用户名或邮箱';
      triggerShake();
      return;
    }

    const res = await authStore.login(account, pwd, proof);
    if (res.success) {
      audio.playClick();
      setMode('unlock');
      completeLogin();
    } else if (res.requires2FA) {
      mode.value = '2fa';
      passwordInput.value = '';
    } else {
      triggerShake();
    }
  } else if (mode.value === 'register') {
    if (!basicRegistration.value) { authStore.errorMsg = '当前注册方式请联系站点管理员开通'; return; }
    const email = accountInput.value.trim();
    const pwd = passwordInput.value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pwd.length < 6) {
      authStore.errorMsg = '请输入有效邮箱和至少 6 位密码';
      triggerShake();
      return;
    }

    if (pwd !== confirmPasswordInput.value) { authStore.errorMsg = '两次密码输入不一致'; return; }
    if (publicSettings.value?.invitation_code_enabled && !invitationInput.value.trim()) { authStore.errorMsg = '请输入邀请码'; return; }
    if (publicSettings.value?.email_verify_enabled && (verifiedEmail.value !== email || !/^\d{6}$/.test(emailCodeInput.value))) { authStore.errorMsg = '请先发送并填写当前邮箱的 6 位验证码'; return; }
    if (!await checkPromo()) return;
    const registration = { email, password: pwd, ...proof,
      ...(publicSettings.value?.promo_code_enabled && promoInput.value.trim() ? { promo_code: promoInput.value.trim() } : {}),
      ...(referralInput.value.trim() ? { aff_code: referralInput.value.trim() } : {}),
      ...(publicSettings.value?.email_verify_enabled ? { verify_code: emailCodeInput.value } : {}),
      ...(publicSettings.value?.invitation_code_enabled ? { invitation_code: invitationInput.value.trim() } : {})
    };
    const context = registrationContext.value;
    let res: { success: boolean };
    if (context?.provider) {
      try {
        const response = await submitPendingOAuthAction('create-account', { ...registration,
          ...(context.pendingToken ? { [context.pendingTokenField]: context.pendingToken } : {}),
          adopt_display_name: context.decision.adopt_display_name === true, adopt_avatar: context.decision.adopt_avatar === true });
        if (!response.access_token) throw new Error('请返回第三方登录继续完成账户绑定。');
        await authStore.acceptExternalSession({ ...response, access_token: response.access_token }); res = { success: true };
        context.pendingToken = '';
      } catch (e) { authStore.errorMsg = (e as Error).message || '注册失败，请重试'; res = { success: false }; }
    } else res = await authStore.register(registration);
    if (res.success) {
      audio.playClick();
      setMode('unlock');
      completeLogin();
    } else {
      triggerShake();
    }
  } else if (mode.value === '2fa') {
    const code = totpInput.value.trim();
    if (!/^\d{6}$/.test(code)) {
      authStore.errorMsg = '请输入完整 6 位验证码';
      triggerShake();
      return;
    }

    const res = await authStore.verify2FA(code);
    if (res.success) {
      audio.playClick();
      setMode('unlock');
      completeLogin();
    } else {
      triggerShake();
    }
  }
  } finally { captcha.value?.reset(); passwordInput.value = ''; }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.target as HTMLElement | null)?.closest('[data-mac-modal-layer]') || oauthCallback.value) return;
  if (!systemStore.isLocked || e.isComposing || e.repeat || e.defaultPrevented) return;
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement) {
    e.preventDefault();
    handleAction();
  }
}

function handleSleep() {
  audio.playClick();
}

function handleRestart() {
  audio.playClick();
  emit('restart');
}

function handleShutdown() {
  audio.playClick();
  emit('shutdown');
}

onMounted(async () => {
  updateTime();
  timer = setInterval(updateTime, 1000);
  const initialURL = new URL(window.location.href);
  returnPath.value = safeAuthRedirect(initialURL.searchParams.get('redirect'), /^\/(login|register|email-verify|auth)(\/|$)/.test(initialURL.pathname) ? '/' : initialURL.pathname + initialURL.search);
  referralInput.value = desktopReferralCode(initialURL.searchParams.get('aff') || initialURL.searchParams.get('aff_code'));
  promoInput.value = initialURL.searchParams.get('promo') || initialURL.searchParams.get('promo_code') || '';
  oauthCallback.value = readDesktopOAuthCallback(window.location.href);
  if (oauthCallback.value) window.history.replaceState(window.history.state, '', oauthCallback.value.cleanPath);
  void loadPublicSettings();
  if (oauthCallback.value) return;
  registrationContext.value = restoreDesktopRegistration(window.location.href);
  if (registrationContext.value) {
    const restored = registrationContext.value;
    mode.value = 'register'; accountInput.value = restored.email; passwordInput.value = restored.password; confirmPasswordInput.value = restored.password;
    restored.password = ''; promoInput.value = restored.promo; invitationInput.value = restored.invitation; referralInput.value = restored.aff;
    returnPath.value = restored.redirect;
    // Never accept a password/token/captcha from URL query parameters.
    window.history.replaceState(window.history.state, '', initialURL.pathname + (returnPath.value !== '/' ? '?redirect=' + encodeURIComponent(returnPath.value) : ''));
    return;
  }
  if (readRecoveryLink()) return;
  await authStore.initAuth();
  if (authStore.isAuthenticated) { mode.value = 'unlock'; systemStore.unlock(); }
});

onUnmounted(() => {
  cancelExternal();
  if (oauthCallback.value) { oauthCallback.value.tokens = null; oauthCallback.value.pendingToken = ''; oauthCallback.value.code = ''; oauthCallback.value.state = ''; }
  oauthCallback.value = null;
  if (registrationContext.value) { registrationContext.value.password = ''; registrationContext.value.pendingToken = ''; }
  registrationContext.value = null;
  if (timer) clearInterval(timer);
  resetToken.value = ''; passwordInput.value = ''; confirmPasswordInput.value = '';
});
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-300"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition-all duration-500 ease-out"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-105 filter blur-sm"
  >
    <div
      v-if="systemStore.isLocked"
      class="mac-lockscreen fixed inset-0 z-[60000] bg-[#0a192f] flex flex-col items-center justify-between pb-10 select-none overflow-hidden text-white"
      :class="{ 'auth-expanded': oauthCallback || oauthProviders.length || publicSettings?.passkey_enabled || recoveryCaptchaRequired || publicSettings?.login_agreement_enabled }"
      @keydown="handleKeydown"
    >
      <!-- Native macOS Crystal Clear Wallpaper -->
      <div
        class="absolute inset-0 bg-cover bg-center transition-all duration-700 pointer-events-none -z-10"
        :style="{
          backgroundImage: `url(/assets/${systemStore.wallpaper}.jpg)`
        }"
      ></div>

      <!-- Subtle Vignette Overlay -->
      <div class="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/45 pointer-events-none -z-10"></div>

      <!-- Top Status Bar in Lock Screen -->
      <div class="w-full px-6 h-8 flex items-center justify-between text-[12px] font-medium text-white/80 pointer-events-none drop-shadow">
        <div class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
          <span class="text-[11.5px] opacity-90">Sub2 Desk</span>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-[11px] font-mono text-white/80 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-current"></span>
            {{ systemStore.connectionStatus === 'online' ? '后端已连接' : systemStore.connectionStatus === 'offline' ? '后端连接中断' : '等待后端连接' }}
          </span>
        </div>
      </div>

      <!-- Top Big Apple Ultralight Clock -->
      <div class="flex flex-col items-center mt-2 pointer-events-none drop-shadow-md select-none">
        <div class="text-[19px] font-normal opacity-90 tracking-tight">{{ dateStr }}</div>
        <div class="text-[92px] font-extralight tracking-tight leading-none my-1 font-sans">
          {{ timeStr }}
        </div>
      </div>

      <!-- Center macOS Tahoe Liquid Glass User Card -->
      <div
        class="login-card flex flex-col items-center gap-4 w-[320px] p-7 -mt-8 select-none"
        :class="{ 'animate-mac-shake': isShaking }"
        @click.stop
      >
        <!-- Circular Avatar -->
        <div class="login-avatar relative w-20 h-20 rounded-full overflow-hidden flex items-center justify-center">
          <template v-if="mode === 'unlock' && authStore.user?.avatar_url">
            <img :src="authStore.user.avatar_url" class="w-full h-full object-cover" alt="User Avatar" />
          </template>
          <template v-else-if="mode !== '2fa'">
            <svg class="w-10 h-10 text-white/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </template>
          <template v-else-if="mode === '2fa'">
            <svg class="w-10 h-10 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </template>
        </div>

        <!-- Identity Title -->
        <span class="login-title font-semibold text-[15.5px] text-white drop-shadow-md tracking-tight">
          <template v-if="mode === 'unlock'">
            {{ authStore.user?.username || authStore.user?.email || '欢迎使用 Sub2 Desk' }}
          </template>
          <template v-else-if="mode === 'switch'">
            登录 Sub2API
          </template>
          <template v-else-if="mode === 'register'">
            注册新开发者
          </template>
          <template v-else-if="mode === '2fa'">
            双重身份验证 (2FA)
          </template>
          <template v-else-if="mode === 'forgot'">找回密码</template>
          <template v-else-if="mode === 'reset'">重置密码</template>
        </span>

        <!-- Dynamic Inputs according to macOS Lockscreen Semantics -->
        <LoginAgreementPanel :settings="publicSettings" v-model="agreementAccepted" />
        <button v-if="publicSettingsError" type="button" class="text-xs underline" @click="loadPublicSettings">{{ publicSettingsError }}，重试</button>
        <OAuthCallbackPanel v-if="oauthCallback" :callback="oauthCallback" :settings="publicSettings" :allowed="agreementReady" @complete="finishOAuth" @cancel="cancelOAuth" />
        <div v-else-if="recoveryMode" class="w-full flex flex-col gap-3 text-xs text-center">
          <p v-if="recoveryMessage" role="status">{{ recoveryMessage }}</p>
          <template v-if="!recoveryComplete">
            <template v-if="mode === 'forgot'">
              <p>输入账户邮箱，我们将向您发送密码重置链接。</p>
              <input v-model="accountInput" type="email" autocomplete="email" aria-label="账户邮箱" placeholder="账户邮箱" class="registration-input" :disabled="recoveryBusy" />
              <p v-if="recoveryCaptchaRequired">提交前请完成人机验证。</p>
              <p v-else-if="publicSettings?.password_reset_enabled === false">管理员尚未开放密码找回。</p>
              <button v-if="!publicSettings || typeof publicSettings.password_reset_enabled !== 'boolean'" type="button" @click="loadPublicSettings">{{ publicSettingsError || '密码找回设置尚未确认' }}，重试</button>
              <button type="button" class="registration-submit rounded-full px-4 py-2 border border-white/40 bg-white/20" :disabled="recoveryBusy || !canRequestRecovery" @click="submitRecovery">{{ recoveryBusy ? '正在提交…' : '发送重置链接' }}</button>
            </template>
            <template v-else-if="resetLinkInvalid">
              <p role="alert">重置链接无效或已过期，请重新申请。</p>
              <button type="button" class="underline underline-offset-2" @click="setMode('forgot')">重新申请重置链接</button>
            </template>
            <template v-else>
              <p class="break-all">为 {{ resetEmail }} 设置新密码</p>
              <input v-model="passwordInput" type="password" autocomplete="new-password" aria-label="新密码" placeholder="至少 6 位新密码" class="registration-input" :disabled="recoveryBusy" />
              <input v-model="confirmPasswordInput" type="password" autocomplete="new-password" aria-label="确认新密码" placeholder="再次输入新密码" class="registration-input" :disabled="recoveryBusy" />
              <button type="button" class="registration-submit rounded-full px-4 py-2 border border-white/40 bg-white/20" :disabled="recoveryBusy" @click="submitRecovery">{{ recoveryBusy ? '正在重置…' : '确认重置密码' }}</button>
            </template>
          </template>
        </div>
        <div v-else class="w-full flex flex-col gap-2">
          <!-- Switch or Register Mode: Account/Email Capsule -->
          <div v-if="mode === 'switch' || mode === 'register'" class="w-full relative flex items-center">
            <input
              v-model="accountInput"
              autocomplete="username" aria-label="邮箱" :disabled="authStore.isLoading || sendingCode"
              type="text"
              class="w-full h-9 px-4 rounded-full bg-white/20 hover:bg-white/25 focus:bg-white/30 backdrop-blur-md border border-white/50 text-white placeholder-white/70 text-[12.5px] outline-none transition-all shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.4),0_2px_8px_rgba(0,0,0,0.15)] text-center tracking-wider"
              :placeholder="mode === 'register' ? '开发者邮箱' : '邮箱'"
              autofocus
            />
          </div>

          <!-- Unlock / Switch / Register: Password Capsule -->
          <div v-if="mode !== '2fa'" class="w-full relative flex items-center">
            <input
              v-model="passwordInput"
              :autocomplete="mode === 'register' ? 'new-password' : 'current-password'" aria-label="密码"
              type="password"
              class="w-full h-9 pl-4 pr-9 rounded-full bg-white/20 hover:bg-white/25 focus:bg-white/30 backdrop-blur-md border border-white/50 text-white placeholder-white/70 text-[12.5px] outline-none transition-all shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.4),0_2px_8px_rgba(0,0,0,0.15)] text-center tracking-wider"
              :placeholder="mode === 'register' ? '设置登录密码' : '输入密码'"
              :autofocus="mode === 'unlock'"
            />
            <!-- Arrow Action Button -->
            <button
              v-if="mode !== 'register'"
              class="login-submit absolute right-1 w-7 h-7 rounded-full bg-white/30 hover:bg-white/50 active:scale-95 flex items-center justify-center transition-all text-white focus:outline-none"
              :aria-label="mode === 'switch' ? '登录' : '解锁'"
              :disabled="authStore.isLoading"
              @click="handleAction"
            >
              <svg v-if="!authStore.isLoading" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <div v-else class="w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
            </button>
          </div>

          <!-- 2FA Code Capsule -->
          <div v-else class="w-full relative flex items-center">
            <input
              v-model="totpInput"
              type="text"
              maxlength="6"
              class="w-full h-9 pl-4 pr-9 rounded-full bg-white/20 hover:bg-white/25 focus:bg-white/30 backdrop-blur-md border border-white/50 text-white placeholder-white/70 text-[14px] font-mono outline-none transition-all shadow-[inset_0_1.5px_2px_rgba(255,255,255,0.4),0_2px_8px_rgba(0,0,0,0.15)] text-center tracking-widest"
              placeholder="000000"
              autofocus
              inputmode="numeric" autocomplete="one-time-code" aria-label="6 位动态验证码"
            />
            <button
              class="login-submit absolute right-1 w-7 h-7 rounded-full bg-white/30 hover:bg-white/50 active:scale-95 flex items-center justify-center transition-all text-white focus:outline-none"
              title="验证"
              :disabled="authStore.isLoading"
              @click="handleAction"
            >
              <svg v-if="!authStore.isLoading" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
              <div v-else class="w-3.5 h-3.5 border-2 border-white/80 border-t-transparent rounded-full animate-spin"></div>
            </button>
          </div>
          <template v-if="mode === 'register'">
            <input v-model="confirmPasswordInput" type="password" autocomplete="new-password" aria-label="确认密码" placeholder="再次输入密码" class="registration-input" :disabled="authStore.isLoading" />
            <input v-if="publicSettings?.promo_code_enabled" v-model="promoInput" aria-label="优惠码" placeholder="优惠码（选填）" class="registration-input" :disabled="authStore.isLoading" />
            <p v-if="promoNotice" role="status" class="text-xs">{{ promoNotice }}</p>
            <input v-if="publicSettings?.invitation_code_enabled" v-model="invitationInput" aria-label="邀请码" placeholder="邀请码" class="registration-input" :disabled="authStore.isLoading" />
            <template v-if="publicSettings?.email_verify_enabled">
              <input v-model="emailCodeInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-label="邮箱验证码" placeholder="6 位邮箱验证码" class="registration-input" :disabled="authStore.isLoading || sendingCode" />
              <button type="button" class="text-xs underline underline-offset-2 py-1" :disabled="sendingCode || authStore.isLoading || resendSeconds > 0" @click="sendRegistrationCode">{{ sendingCode ? '正在发送…' : resendSeconds ? `${resendSeconds} 秒后重发` : '发送邮箱验证码' }}</button>
            </template>
            <p v-if="codeMessage" class="text-xs text-center" role="status">{{ codeMessage }}</p>
            <button type="button" class="registration-submit rounded-full px-4 py-2 text-xs font-semibold border border-white/40 bg-white/20 hover:bg-white/30" :disabled="authStore.isLoading || sendingCode" @click="handleAction">{{ authStore.isLoading ? '正在注册…' : '创建账户' }}</button>
          </template>
        </div>

        <CaptchaGate v-if="!oauthCallback && mode !== '2fa' && mode !== 'reset'" ref="captcha" :key="mode" :settings="publicSettings" />
        <div v-if="!oauthCallback && (mode === 'switch' || mode === 'unlock')" class="w-full flex flex-wrap justify-center gap-2 text-xs">
          <button v-if="publicSettings?.passkey_enabled" type="button" class="registration-submit rounded-full border border-white/40 px-3 py-2" :disabled="externalBusy || authStore.isLoading" @click="signInWithPasskey">使用通行密钥</button>
          <button v-for="provider in oauthProviders" :key="provider" type="button" class="registration-submit rounded-full border border-white/40 px-3 py-2" :disabled="externalBusy || authStore.isLoading" @click="signInWithOAuth(provider)">{{ provider === 'oidc' ? publicSettings?.oidc_oauth_provider_name || 'OIDC' : oauthLabels[provider] }}</button>
        </div>
        <button v-if="externalBusy" type="button" class="text-xs underline" @click="cancelExternal">取消验证</button>
        <!-- Error feedback message -->
        <div v-if="authStore.errorMsg" class="login-error text-[11.5px] -mt-1 text-center font-medium" role="alert">
          {{ authStore.errorMsg }}
        </div>

        <!-- Secondary macOS semantic switches -->
        <div v-if="!oauthCallback" class="flex items-center justify-center gap-3 text-[11px] text-white/75 drop-shadow-sm pt-0.5">
          <template v-if="mode === 'unlock'">
            <button class="hover:text-white transition-colors focus:outline-none" @click="setMode('switch')">
              切换账户...
            </button>
            <span class="opacity-40">·</span>
            <span class="text-white/60">按 Return 解锁</span>
          </template>

          <template v-else-if="mode === 'switch'">
            <button class="hover:text-white underline underline-offset-2" @click="setMode('forgot')">忘记密码？</button>
            <button v-if="publicSettingsError" @click="loadPublicSettings">{{ publicSettingsError }}，重试</button>
            <button v-if="basicRegistration" class="hover:text-white transition-colors focus:outline-none underline underline-offset-2" @click="setMode('register')">
              注册新用户
            </button>
            <span v-if="basicRegistration && authStore.user" class="opacity-40">·</span>
            <button v-if="authStore.user" class="hover:text-white transition-colors focus:outline-none" @click="setMode('unlock')">
              返回锁屏
            </button>
          </template>

          <template v-else-if="mode === 'register'">
            <button class="hover:text-white transition-colors focus:outline-none" @click="setMode('switch')">
              已有账号？返回登录
            </button>
          </template>

          <template v-else-if="mode === '2fa'">
            <button class="hover:text-white transition-colors focus:outline-none" @click="setMode('switch')">
              返回重新登录
            </button>
          </template>
          <template v-else-if="recoveryMode">
            <button :disabled="recoveryBusy" class="hover:text-white underline underline-offset-2" @click="setMode('switch')">返回登录</button>
          </template>
        </div>
      </div>

      <!-- Bottom macOS Standard 3 Power Actions -->
      <div class="flex items-center gap-10 select-none pb-2" @click.stop>
        <!-- Restart -->
        <button
          class="flex flex-col items-center gap-1.5 text-white/80 hover:text-white group transition-all focus:outline-none"
          @click="handleRestart"
        >
          <div class="w-9 h-9 rounded-full bg-black/25 group-hover:bg-black/40 backdrop-blur-lg border border-white/20 flex items-center justify-center shadow-md transition-all group-active:scale-95">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </div>
          <span class="text-[11px] font-normal drop-shadow">重新载入</span>
        </button>


      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mac-lockscreen .login-card {
  position: relative;
  isolation: isolate;
  max-width: calc(100vw - 32px);
  color: #fff;
  background: linear-gradient(145deg, rgba(238,249,255,.17), rgba(124,165,204,.06) 48%, rgba(18,43,73,.22)), rgba(24,53,83,.22);
  border: 1px solid rgba(235,248,255,.45);
  border-radius: 30px;
  backdrop-filter: blur(24px) saturate(145%);
  -webkit-backdrop-filter: blur(24px) saturate(145%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.5), inset 0 -1px 0 rgba(199,226,255,.13), 0 20px 52px -14px rgba(7,23,43,.38);
}
.mac-lockscreen.auth-expanded { overflow-y: auto; gap: 24px; }
.mac-lockscreen.auth-expanded .login-card { margin-top: 0; flex-shrink: 0; }
.mac-lockscreen .login-card input[type="checkbox"] { min-height: 16px; width: 16px; height: 16px; flex-shrink: 0; }
.mac-lockscreen .login-avatar {
  color: #f5fbff;
  background: radial-gradient(circle at 28% 16%, rgba(219,244,255,.55), transparent 55%), linear-gradient(145deg, #70b9df, #306caa 65%, #285286);
  border: 1px solid rgba(242,252,255,.7);
  box-shadow: inset 0 1px 2px rgba(255,255,255,.55), 0 8px 22px rgba(8,27,49,.25);
}
.mac-lockscreen .login-title { color: #fff; text-shadow: 0 1px 6px rgba(6,27,51,.35); }
.mac-lockscreen .login-card input {
  min-height: 42px;
  color: #fff;
  background: rgba(12,34,58,.24);
  border: 1px solid rgba(235,248,255,.3);
  box-shadow: inset 0 1px 3px rgba(6,24,43,.12), 0 1px 0 rgba(255,255,255,.08);
  letter-spacing: .02em;
  transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
}
.mac-lockscreen .login-card input::placeholder { color: rgba(246,251,255,.8); opacity: 1; }
.mac-lockscreen .registration-input { width: 100%; min-width: 0; border-radius: 999px; padding: 8px 16px; text-align: center; font-size: 12px; }
.mac-lockscreen:has(.registration-input) { overflow-y: auto; gap: 24px; }
.mac-lockscreen:has(.registration-input) .login-card { margin-top: 0; flex-shrink: 0; }
.mac-lockscreen .login-card input:focus {
  background: rgba(10,33,58,.34);
  border-color: rgba(240,250,255,.8);
  box-shadow: 0 0 0 3px rgba(173,220,255,.16), inset 0 1px 3px rgba(6,24,43,.1);
  outline: none;
}
.mac-lockscreen .login-submit {
  color: #fff;
  background: rgba(185,225,255,.24);
  border: 1px solid rgba(237,250,255,.4);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.28);
  right: 6px;
}
.mac-lockscreen .login-submit:hover { background: rgba(185,225,255,.4); }
.mac-lockscreen .login-card button:focus-visible { outline: 2px solid #d7efff; outline-offset: 3px; }
.mac-lockscreen .login-card button:disabled { opacity: .5; }
.mac-lockscreen .login-error { color: #fff0ec; background: rgba(98,28,38,.48); border: 1px solid rgba(255,190,180,.4); border-radius: 10px; padding: 8px 10px; width: 100%; }
@media (prefers-reduced-transparency: reduce) {
  .mac-lockscreen .login-card { background: #29465f; backdrop-filter: none; -webkit-backdrop-filter: none; }
}
@media (max-height: 640px) {
  .mac-lockscreen { overflow-y: auto; gap: 24px; }
  .mac-lockscreen .login-card { margin-top: 0; flex-shrink: 0; }
}
</style>

<style scoped>
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-9px); }
  40%, 80% { transform: translateX(9px); }
}
.animate-mac-shake {
  animation: shake 0.4s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
}
</style>
