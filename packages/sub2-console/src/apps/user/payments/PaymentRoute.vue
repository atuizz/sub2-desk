<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { MacButton } from '@sub2-mac/core';
import CheckoutSheet from '../CheckoutSheet.vue';
import { paymentAPI } from '@/api/payment';
import { useAuthStore } from '@/stores/auth';
import type { CreateOrderRequest, CreateOrderResult } from '@/types/payment';
import { RECOVERY_KEY, readRecovery, saveRecovery, clearRecovery, createPayload, parseWechatReturn, resultURL, statusText } from './flow';
import { usePaymentStatus, type OrderLookup } from './usePaymentStatus';
const emit = defineEmits<{ close: []; paid: [] }>();
const auth = useAuthStore();
const url = new URL(window.location.href);
url.pathname = url.pathname.replace(/\/+$/, '') || '/';
const isResult = url.pathname.replace(/\/$/, '') === '/payment/result';
const isPopup = url.pathname.replace(/\/$/, '') === '/payment/stripe-popup';
const lookup = ref<OrderLookup | null>(null), order = ref<CreateOrderResult | null>(null), request = ref<CreateOrderRequest>();
const error = ref(''), loading = ref(false), key = ref(''), resumed = ref(false);
const creationStarted = ref(false);
let identityGeneration = 0;
const method = url.searchParams.get('method') || undefined;
let alive = true, controller = new AbortController();
let handler: ((event: MessageEvent) => void) | undefined, timeout: ReturnType<typeof setTimeout> | undefined;
function completed() { const id = lookup.value?.orderId || order.value?.order_id; if (id) { try { clearRecovery(localStorage, id); } catch { /* optional */ } } emit('paid'); }
const { status, issue, busy, refresh } = usePaymentStatus(() => lookup.value, completed);
const title = computed(() => request.value && !resumed.value ? '继续微信支付' : '支付结果');
function cleanupHandshake() { if (handler) window.removeEventListener('message', handler); handler = undefined; clearTimeout(timeout); }
function replacePayment(result: CreateOrderResult, payload: CreateOrderRequest) {
  order.value = result; request.value = payload; resumed.value = true;
  try { saveRecovery(localStorage, result, auth.user?.id ?? null); } catch { error.value = '新订单已创建，但无法保存恢复信息，请保持页面打开'; }
  if (!result.qr_code) error.value = '新订单已创建，但支付服务未返回二维码，请查看当前付款入口或订单记录';
  if (result.order_id > 0) window.history.replaceState(null, '', resultURL(result, window.location.origin));
}
function back() { emit('close'); if (isPopup && window.opener) window.close(); else window.location.assign('/'); }
async function resume() {
  if (!request.value || loading.value || resumed.value || creationStarted.value) return;
  const current = identityGeneration;
  loading.value = true; error.value = '';
  try {
    const payload = createPayload(request.value, window.location.origin, navigator.userAgent);
    creationStarted.value = true;
    const { data } = await paymentAPI.createOrder(payload);
    if (!alive || current !== identityGeneration) return;
    order.value = { ...data, payment_type: data.payment_type || payload.payment_type };
    resumed.value = true;
    try { saveRecovery(localStorage, order.value, auth.user?.id ?? null); } catch { error.value = '浏览器无法保存恢复信息，请保持此页面打开'; }
    // Remove OAuth credentials only after successful order creation; never use global auth tokens.
    if (data.order_id > 0) window.history.replaceState(null, '', resultURL(data, window.location.origin));
  } catch (cause) {
    if (alive && current === identityGeneration) {
      const status = (cause as { status?: number; response?: { status?: number } })?.status ?? (cause as { response?: { status?: number } })?.response?.status;
      if (status && [400, 401, 403, 404, 405, 422, 429].includes(status)) creationStarted.value = false;
      error.value = creationStarted.value ? '订单提交结果未知，请先在钱包核对订单；为避免重复下单已停止重试。' : '继续支付失败，请检查登录状态后重试';
    }
  }
  finally { if (alive && current === identityGeneration) loading.value = false; }
}
async function initialize() {
  const current = identityGeneration;
  loading.value = true; error.value = '';
  try {
    request.value = ['/auth/wechat/payment/callback', '/purchase', '/payment'].includes(url.pathname) ? parseWechatReturn(url) || undefined : undefined;
    if (request.value) return;
    if (url.pathname === '/auth/wechat/payment/callback') throw new Error('微信授权返回信息不完整，请返回钱包重新授权');
    const id = Number(url.searchParams.get('order_id'));
    const context = { orderId: Number.isSafeInteger(id) && id > 0 ? id : undefined, token: url.searchParams.get('resume_token') || undefined, trade: url.searchParams.get('out_trade_no') || undefined };
    if (isResult) { lookup.value = { ...context, authenticated: !!auth.token && !!auth.user?.id }; return; }
    if (!auth.token || !auth.user?.id) {
      lookup.value = { ...context, authenticated: false };
      error.value = '当前浏览器未登录，仅查询可公开验证的订单结果。继续付款请登录钱包；付款凭据不会凭空恢复。';
      return;
    }
    if (!context.orderId) throw new Error('缺少有效订单编号，请返回钱包');
    const { data } = await paymentAPI.getOrder(context.orderId, controller.signal);
    if (!alive || current !== identityGeneration) return;
    let restored: CreateOrderResult | null = null;
    try { restored = readRecovery(localStorage.getItem(RECOVERY_KEY), { ...context, owner: auth.user?.id ?? null }); } catch { /* private browsing */ }
    const base: CreateOrderResult = { ...restored, order_id: data.id, amount: data.amount, pay_amount: data.pay_amount, currency: data.currency || restored?.currency, fee_rate: data.fee_rate, expires_at: data.expires_at, out_trade_no: data.out_trade_no, payment_type: restored?.payment_type || data.payment_type, resume_token: context.token || restored?.resume_token };
    if (isPopup) {
      if (!window.opener) throw new Error('支付窗口来源已关闭，请返回钱包继续付款');
      handler = event => {
        if (event.origin !== window.location.origin || event.source !== window.opener || event.data?.type !== 'STRIPE_POPUP_INIT') return;
        if (typeof event.data.clientSecret !== 'string' || !event.data.clientSecret || typeof event.data.publishableKey !== 'string' || !event.data.publishableKey) return;
        cleanupHandshake(); key.value = event.data.publishableKey;
        order.value = { ...base, client_secret: event.data.clientSecret, payment_type: 'stripe' };
      };
      window.addEventListener('message', handler);
      timeout = setTimeout(() => { cleanupHandshake(); error.value = '支付窗口连接超时，请关闭后从钱包重新打开'; }, 15000);
      window.opener.postMessage({ type: 'STRIPE_POPUP_READY' }, window.location.origin);
    } else {
      if (url.pathname === '/payment/stripe') base.client_secret = url.searchParams.get('client_secret') || restored?.client_secret;
      if (url.pathname === '/payment/airwallex') base.payment_type = 'airwallex';
      if (url.pathname === '/payment/qrcode') { base.qr_code = url.searchParams.get('qr') || restored?.qr_code; base.pay_url = url.searchParams.get('pay_url') || restored?.pay_url; }
      order.value = base;
    }
  } catch (cause) { if (alive && current === identityGeneration) error.value = cause instanceof Error ? cause.message : '支付信息读取失败，请返回钱包重试'; }
  finally { if (alive && current === identityGeneration) loading.value = false; }
}
onMounted(initialize);
watch([() => !!auth.token, () => auth.user?.id, () => auth.user?.role, () => auth.sessionRevision], () => {
  identityGeneration++; controller.abort(); cleanupHandshake(); lookup.value = null; order.value = null; request.value = undefined;
  key.value = ''; loading.value = false; error.value = '登录账户已变化，请返回钱包重新打开订单。';
}, { flush: 'sync' });
onBeforeUnmount(() => { alive = false; controller.abort(); cleanupHandshake(); });
</script>
<template>
  <main class="payment-landing">
    <section class="payment-summary">
      <h1>{{ title }}</h1>
      <p v-if="loading" role="status">正在读取支付信息…</p>
      <p v-if="error || issue" role="alert">{{ error || issue }}</p>
      <template v-if="isResult || lookup"><p role="status">{{ statusText(status) }}</p><MacButton :loading="busy" @click="refresh">重新查询</MacButton></template>
      <p v-if="request && !resumed">微信授权已返回，点击继续创建支付订单。最终金额与结果以收银台及订单为准。</p>
      <MacButton v-if="request && !resumed" variant="primary" :loading="loading" :disabled="creationStarted" @click="resume">继续支付</MacButton>
      <MacButton @click="back">返回钱包桌面</MacButton>
    </section>
    <CheckoutSheet :order="order" :request="request" :publishable-key="key" :method="method" :popup="isPopup" @close="back" @paid="completed" @replaced="replacePayment" />
  </main>
</template>
<style scoped>
.payment-landing { min-height:100dvh;display:grid;place-items:center;padding:20px;background:var(--bg-base);color:var(--text-primary);position:relative; }.payment-summary { width:min(440px,100%);padding:24px;border:1px solid var(--border-subtle);border-radius:16px;background:var(--bg-surface);display:flex;flex-direction:column;gap:16px; }h1 { font-size:20px;font-weight:600; }p { font-size:13px;line-height:1.7;overflow-wrap:anywhere; }[role=alert] { color:var(--danger); }
</style>
