<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { MacButton } from '@sub2-mac/core';
import type { Stripe, StripeElements, StripePaymentElement, PaymentIntentResult } from '@stripe/stripe-js';
import type { CreateOrderResult } from '@/types/payment';
import { paymentAPI } from '@/api/payment';
import { paymentKind, resultURL, safeURL } from './flow';
import { invokeWechat } from './wechat';
const props = defineProps<{ order: CreateOrderResult; publishableKey?: string; method?: string; popup?: boolean }>();
const emit = defineEmits<{ submitted: []; unavailable: [] }>();
const mountPoint = ref<HTMLElement | null>(null), issue = ref(''), busy = ref(false), ready = ref(false), qr = ref('');
const kind = computed(() => paymentKind(props.order));
const method = computed(() => props.method !== undefined
  ? (['alipay', 'wechat_pay'].includes(props.method) ? props.method : '')
  : props.order.payment_type === 'stripe' ? '' : ['wxpay', 'wxpay_direct'].includes(props.order.payment_type || '') ? 'wechat_pay' : 'alipay');
let stripe: Stripe | null = null, elements: StripeElements | null = null, element: StripePaymentElement | null = null;
let generation = 0, controller = new AbortController();
let popup: Window | null = null, popupHandler: ((event: MessageEvent) => void) | undefined;
let popupTimer: ReturnType<typeof setTimeout> | undefined;
function cleanupPopup() { if (popupHandler) window.removeEventListener('message', popupHandler); popupHandler = undefined; clearTimeout(popupTimer); }
function cleanup() { generation++; controller.abort(); controller = new AbortController(); element?.destroy(); element = null; stripe = null; elements = null; cleanupPopup(); }
async function initialize() {
  cleanup(); const current = generation; busy.value = true; ready.value = false; issue.value = ''; qr.value = '';
  try {
    if (kind.value !== 'stripe') { ready.value = true; return; }
    const key = props.publishableKey || (await paymentAPI.getConfig()).data.stripe_publishable_key;
    if (current !== generation) return;
    if (!key) throw new Error('此站点尚未配置 Stripe 支付');
    const { loadStripe } = await import('@stripe/stripe-js/pure');
    const sdk = await loadStripe(key);
    if (current !== generation) return;
    if (!sdk) throw new Error('支付组件加载失败，请重试');
    stripe = sdk;
    if (method.value) { ready.value = true; return; }
    await nextTick(); if (current !== generation || !mountPoint.value) return;
    elements = sdk.elements({ clientSecret: props.order.client_secret!, appearance: { theme: document.documentElement.classList.contains('dark') ? 'night' : 'stripe', variables: { borderRadius: '8px' } } });
    element = elements.create('payment', { layout: 'tabs', paymentMethodOrder: ['alipay', 'wechat_pay', 'card', 'link'] });
    element.on('ready', () => { if (current === generation) ready.value = true; });
    element.on('loaderror', event => { if (current === generation) issue.value = event.error.message || '支付组件加载失败'; });
    element.mount(mountPoint.value);
  } catch (error) { if (current === generation) { issue.value = error instanceof Error ? error.message : '支付组件加载失败'; emit('unavailable'); } }
  finally { if (current === generation) busy.value = false; }
}
function openPopup() {
  cleanupPopup();
  const url = new URL('/payment/stripe-popup', window.location.origin);
  url.searchParams.set('order_id', String(props.order.order_id)); url.searchParams.set('method', method.value);
  // No client secret in the popup URL. Handshake is bound to both origin and window.
  popup = window.open(url.href, `sub2-payment-${props.order.order_id}`, 'popup,width=520,height=720');
  if (!popup) { issue.value = '浏览器阻止了支付窗口，可点击“在当前页面继续”'; return; }
  const current = generation;
  popupHandler = async event => {
    if (event.origin !== window.location.origin || event.source !== popup || event.data?.type !== 'STRIPE_POPUP_READY') return;
    cleanupPopup();
    try {
      const key = props.publishableKey || (await paymentAPI.getConfig()).data.stripe_publishable_key;
      if (current !== generation) return;
      popup?.postMessage({ type: 'STRIPE_POPUP_INIT', clientSecret: props.order.client_secret, publishableKey: key }, window.location.origin);
    } catch { if (current === generation) issue.value = '支付窗口初始化失败，请在当前页面继续'; }
  };
  window.addEventListener('message', popupHandler);
  popupTimer = setTimeout(() => { cleanupPopup(); if (current === generation) issue.value = '支付窗口未响应，请在当前页面继续'; }, 15000);
}
async function pay() {
  if (busy.value || !ready.value) return;
  const current = generation; busy.value = true; issue.value = '';
  try {
    const order = props.order; const returnUrl = resultURL(order, window.location.origin);
    if (kind.value === 'jsapi') {
      const payload = order.jsapi ?? order.jsapi_payload;
      if (!payload) throw new Error('微信支付信息不完整，请返回钱包');
      const result = await invokeWechat(payload, controller.signal);
      if (current !== generation) return;
      if (result === 'cancel') { issue.value = '已取消本次微信支付，订单仍可查询或重试'; emit('unavailable'); return; }
    } else if (kind.value === 'airwallex') {
      const airwallex = await import('@airwallex/components-sdk');
      if (current !== generation) return;
      const sdk = await airwallex.init({ env: order.payment_env === 'prod' ? 'prod' : 'demo', enabledElements: ['payments'], locale: 'zh' });
      if (current !== generation) return;
      if (!sdk.payments) throw new Error('支付组件加载失败');
      const target = await sdk.payments.redirectToCheckout({ intent_id: order.intent_id!, client_secret: order.client_secret!, currency: order.currency || 'CNY', country_code: order.country_code || 'CN', successUrl: returnUrl });
      if (current !== generation) return;
      if (typeof target === 'string' && target) { const safe = safeURL(target); if (!safe) throw new Error('支付跳转地址无效'); window.location.assign(safe); }
    } else if (stripe) {
      if (method.value === 'alipay') {
        const result = await stripe.confirmAlipayPayment(order.client_secret!, { return_url: returnUrl });
        if (result.error) throw new Error(result.error.message || '支付宝支付未完成');
      } else if (method.value === 'wechat_pay') {
        // Upstream 0.2.4 uses mobile_web; Stripe 9.0.1 only declares web.
        const wechatStripe = stripe as unknown as { confirmWechatPayPayment(secret: string, options: { payment_method_options: { wechat_pay: { client: 'web' | 'mobile_web' } } }): Promise<PaymentIntentResult> };
        const result = await wechatStripe.confirmWechatPayPayment(order.client_secret!, { payment_method_options: { wechat_pay: { client: /Android|iPhone|Mobile/i.test(navigator.userAgent) ? 'mobile_web' : 'web' } } });
        if (current !== generation) return;
        if (result.error) throw new Error(result.error.message || '微信支付未完成');
        const image = result.paymentIntent?.next_action?.wechat_pay_display_qr_code?.image_data_url;
        if (image && /^data:image\/(png|jpeg|webp);base64,/.test(image)) qr.value = image;
      } else if (elements) {
        const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl }, redirect: 'if_required' });
        if (result.error) throw new Error(result.error.message || '支付未完成');
      } else throw new Error('支付组件尚未就绪');
    }
    if (current === generation) emit('submitted'); // SDK success never means credited.
  } catch (error) { if (current === generation) { issue.value = error instanceof Error ? error.message : '支付未完成，请重试'; emit('unavailable'); } }
  finally { if (current === generation) busy.value = false; }
}
watch(() => [props.order.order_id, props.order.client_secret, props.publishableKey, props.method], () => void initialize(), { immediate: true, flush: 'post' });
onBeforeUnmount(cleanup);
</script>
<template>
  <div class="provider-payment">
    <div v-if="kind === 'stripe' && !method" ref="mountPoint" class="payment-element" />
    <img v-if="qr" :src="qr" width="240" height="240" alt="微信支付二维码" />
    <p v-if="busy" role="status">正在连接支付服务…</p>
    <p v-if="issue" role="alert">{{ issue }}</p>
    <MacButton v-if="!ready && !busy" @click="initialize">重新加载支付组件</MacButton>
    <MacButton v-if="kind === 'stripe' && method === 'alipay' && !popup" :disabled="!ready || busy" @click="openPopup">打开支付宝支付窗口</MacButton>
    <MacButton variant="primary" :disabled="!ready || busy" @click="pay">{{ kind === 'stripe' && method === 'alipay' && !popup ? '在当前页面继续' : kind === 'jsapi' ? '打开微信支付' : '继续支付' }}</MacButton>
  </div>
</template>
<style scoped>
.provider-payment { width:100%;display:flex;flex-direction:column;gap:12px;align-items:stretch; }.payment-element { min-height:180px; }img { max-width:100%;align-self:center; }[role=alert] { color:var(--danger);overflow-wrap:anywhere; }
</style>
