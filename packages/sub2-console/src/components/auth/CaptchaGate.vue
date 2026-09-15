<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import type { ActionCaptchaRequestProof, PublicSettings } from '@/types';
const props = defineProps<{ settings: PublicSettings | null }>();
// SDK handles stay local to this component; never remove other consumers' scripts.
const sdk = window as unknown as Record<string, any>;
const host = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
const error = ref(''), ready = ref(false), verifying = ref(false);
const kind = computed(() => props.settings?.turnstile_enabled ? 'turnstile' : props.settings?.tencent_captcha_enabled ? 'tencent' : props.settings?.aliyun_captcha_enabled ? 'aliyun' : 'none');
const uid = `auth-captcha-${Math.random().toString(36).slice(2)}`;
let generation = 0, widget: string | null = null, instance: any = null, disposed = false;
let proof: ActionCaptchaRequestProof = {}, expiresAt = 0;
let pending: ((value: ActionCaptchaRequestProof | null) => void) | null = null;
let expiry: ReturnType<typeof setTimeout> | undefined;
let popupWatch: ReturnType<typeof setInterval> | undefined;
function settle(value: ActionCaptchaRequestProof | null) { const resolve = pending; pending = null; verifying.value = false; clearTimeout(expiry); clearInterval(popupWatch); resolve?.(value); }
function cleanup() {
  generation++; proof = {}; expiresAt = 0; settle(null);
  try { if (widget !== null) sdk.turnstile?.remove(widget); instance?.destroy?.(); } catch { /* SDK may already have removed its instance. */ }
  widget = null; instance = null; ready.value = false;
}
// Recreate the SDK callback closure as well as clearing its proof. A callback
// from a cancelled popup must never satisfy the next verification attempt.
function reset() { if (!disposed) void initialize(); }
async function script(src: string, check: () => boolean) {
  if (check()) return;
  await new Promise<void>((resolve, reject) => {
    let tag = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    const owned = !tag;
    if (!tag) { tag = document.createElement('script'); tag.src = src; tag.async = true; }
    const fail = () => { clearTimeout(timeout); tag?.removeEventListener('load', done); tag?.removeEventListener('error', fail); if (owned) tag?.remove(); reject(new Error('验证码加载失败，请重试。')); };
    const done = () => { if (!check()) { fail(); return; } clearTimeout(timeout); tag?.removeEventListener('load', done); tag?.removeEventListener('error', fail); resolve(); };
    const timeout = setTimeout(fail, 15000);
    tag.addEventListener('load', done); tag.addEventListener('error', fail);
    if (owned) document.head.appendChild(tag);
  });
}
async function initialize() {
  if (disposed) return;
  cleanup(); const current = generation; error.value = '';
  const s = props.settings;
  if (!s) return;
  try {
    await nextTick();
    if (kind.value === 'turnstile') {
      if (!s.turnstile_site_key) throw new Error('站点验证码配置不完整。');
      await script('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit', () => Boolean(sdk.turnstile));
      if (current !== generation || !host.value) return;
      widget = sdk.turnstile.render(host.value, { sitekey: s.turnstile_site_key, size: 'flexible',
        callback: (token: string) => { if (current === generation) { proof = { turnstile_token: token }; expiresAt = Date.now() + 240000; } },
        'expired-callback': () => { if (current === generation) { proof = {}; expiresAt = 0; } },
        'error-callback': () => { if (current === generation) { proof = {}; expiresAt = 0; error.value = '验证失败，请重试。'; } },
      });
    } else if (kind.value === 'tencent') {
      if (!s.tencent_captcha_app_id) throw new Error('站点验证码配置不完整。');
      const intl = s.tencent_captcha_region === 'intl';
      if (sdk.TencentCaptcha && Boolean(sdk.TCaptchaGlobal) !== intl) throw new Error('验证码区域已变更，请刷新页面。');
      await script(intl ? 'https://ca.turing.captcha.qcloud.com/TJNCaptcha-global.js' : 'https://turing.captcha.qcloud.com/TJCaptcha.js', () => Boolean(sdk.TencentCaptcha) && Boolean(sdk.TCaptchaGlobal) === intl);
      if (current !== generation) return;
      const callback = (result: { ret: number; ticket?: string; randstr?: string }) => {
        if (current !== generation || !pending) return;
        settle(result.ret === 0 && result.ticket && result.randstr ? { tencent_captcha_ticket: result.ticket, tencent_captcha_randstr: result.randstr } : null);
      };
      instance = intl ? new sdk.TencentCaptcha(host.value, s.tencent_captcha_app_id, callback, {}) : new sdk.TencentCaptcha(s.tencent_captcha_app_id, callback, {});
    } else if (kind.value === 'aliyun') {
      if (!s.aliyun_captcha_scene_id || !s.aliyun_captcha_prefix) throw new Error('站点验证码配置不完整。');
      const config = { region: s.aliyun_captcha_region === 'sgp' ? 'sgp' : 'cn', prefix: s.aliyun_captcha_prefix };
      if (sdk.initAliyunCaptcha && JSON.stringify(sdk.AliyunCaptchaConfig) !== JSON.stringify(config)) throw new Error('验证码配置已变更，请刷新页面。');
      sdk.AliyunCaptchaConfig = config;
      await script('https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js', () => Boolean(sdk.initAliyunCaptcha));
      if (current !== generation) return;
      sdk.initAliyunCaptcha({ SceneId: s.aliyun_captcha_scene_id, prefix: s.aliyun_captcha_prefix, mode: 'popup', element: `#${uid}`, button: `#${uid}-button`, language: 'cn',
        captchaVerifyCallback: (param: string) => { if (current === generation && pending) settle({ turnstile_token: param }); return { captchaResult: true }; },
        onBizResultCallback: () => {}, getInstance: (value: unknown) => { if (current === generation) instance = value; },
      });
    }
    if (current === generation) ready.value = true;
  } catch (e) { if (current === generation) error.value = (e as Error).message; }
}
async function verify(): Promise<ActionCaptchaRequestProof | null> {
  error.value = '';
  if (!props.settings) { error.value = '请先读取站点设置。'; return null; }
  if (kind.value === 'none') return {};
  if (!ready.value) { error.value = '验证码尚未就绪，请重试。'; return null; }
  if (kind.value === 'turnstile') {
    if (!proof.turnstile_token || Date.now() >= expiresAt) { error.value = '请先完成人机验证。'; return null; }
    const result = proof; proof = {}; expiresAt = 0; return result;
  }
  if (pending) return null;
  return new Promise(resolve => {
    pending = resolve; verifying.value = true;
    expiry = setTimeout(() => { error.value = '验证已超时，可重新尝试。'; settle(null); }, 120000);
    try {
      if (kind.value === 'tencent') instance.show();
      else {
        trigger.value?.click();
        const openedAt = Date.now(); let wasVisible = false;
        popupWatch = setInterval(() => {
          const popup = document.getElementById('aliyunCaptcha-window-popup');
          const visible = popup && window.getComputedStyle(popup).display !== 'none';
          if (visible) wasVisible = true;
          else if (wasVisible || Date.now() - openedAt > 8000) settle(null);
          else trigger.value?.click();
        }, 300);
      }
    }
    catch { error.value = '无法打开验证码，请重试。'; settle(null); }
  });
}
watch(() => JSON.stringify(props.settings && [props.settings.turnstile_enabled, props.settings.turnstile_site_key, props.settings.tencent_captcha_enabled, props.settings.tencent_captcha_app_id, props.settings.tencent_captcha_region, props.settings.aliyun_captcha_enabled, props.settings.aliyun_captcha_scene_id, props.settings.aliyun_captcha_prefix, props.settings.aliyun_captcha_region]), initialize, { immediate: true });
onUnmounted(() => { disposed = true; cleanup(); });
defineExpose({ verify, reset });
</script>
<template>
  <div v-if="kind !== 'none'" class="w-full min-w-0 text-xs space-y-2">
    <div :id="uid" ref="host"></div><button :id="`${uid}-button`" ref="trigger" type="button" hidden tabindex="-1">开始验证</button>
    <p v-if="!ready">验证码准备中…</p><p v-if="error" role="alert">{{ error }}</p>
    <button v-if="error" type="button" class="underline" @click="initialize">重新加载验证码</button>
    <button v-if="verifying" type="button" class="underline" @click="reset">取消验证</button>
  </div>
</template>
