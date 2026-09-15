<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import QRCode from 'qrcode';
import { MacButton, MacSheet, MacAlertSheet } from '@sub2-mac/core';
import { paymentAPI } from '@/api/payment';
import type { CreateOrderResult, CreateOrderRequest } from '@/types/payment';
import ProviderPayment from './payments/ProviderPayment.vue';
import { paymentKind, safeURL, oauthURL, statusText, clearRecovery, alipayDeepLink } from './payments/flow';
import { usePaymentStatus } from './payments/usePaymentStatus';
import QrFallbackSheet from './payments/QrFallbackSheet.vue';
import { supportsQrFallback } from './payments/qrFallback';
import { createAlipayLauncher, type AlipayLaunchState } from './payments/alipayLauncher';
import { navigatePaymentApp } from './payments/navigation';
const props = defineProps<{ order: CreateOrderResult | null; request?: CreateOrderRequest; publishableKey?: string; method?: string; popup?: boolean }>();
const emit = defineEmits<{ close: []; paid: []; replaced: [order: CreateOrderResult, request: CreateOrderRequest] }>();
const qr = ref(''), issue = ref(''), cancelling = ref(false), confirmCancel = ref(false), now = ref(Date.now());
const fallbackOpen = ref(false), providerUnavailable = ref(false), launchState = ref<AlipayLaunchState>('idle');
let alipayLauncher: ReturnType<typeof createAlipayLauncher> | undefined;
let generation = 0;
const clock = setInterval(() => { now.value = Date.now(); }, 1000);
const kind = computed(() => props.order ? paymentKind(props.order) : 'unsupported');
const lookup = computed(() => props.order?.order_id ? { orderId: props.order.order_id, token: props.order.resume_token, trade: props.order.out_trade_no } : null);
const { status, issue: statusIssue, busy, refresh } = usePaymentStatus(() => lookup.value, () => {
  if (props.order) { try { clearRecovery(localStorage, props.order.order_id); } catch { /* optional recovery */ } }
  emit('paid');
});
const expires = computed(() => Date.parse(props.order?.expires_at || ''));
const expired = computed(() => Number.isFinite(expires.value) && expires.value <= now.value);
const remaining = computed(() => Number.isFinite(expires.value) ? Math.max(0, Math.ceil((expires.value - now.value) / 1000)) : null);
const canPay = computed(() => status.value === 'PENDING' && !expired.value);
const payLink = computed(() => safeURL(props.order?.pay_url || ''));
const amount = computed(() => Number.isFinite(props.order?.pay_amount) ? props.order!.pay_amount.toFixed(2) : '—');
const alipayAppLink = computed(() => props.order && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? alipayDeepLink(props.order) : '');
const fallbackMethod = computed(() => props.request?.payment_type || (props.method === 'wechat_pay' ? 'wxpay' : props.method === 'alipay' ? 'alipay' : props.order?.payment_type || ''));
const canFallback = computed(() => canPay.value && supportsQrFallback(fallbackMethod.value) && (providerUnavailable.value || kind.value === 'unsupported'));
watch(alipayAppLink, url => {
  alipayLauncher?.dispose(); alipayLauncher = undefined; launchState.value = 'idle';
  if (url) alipayLauncher = createAlipayLauncher({ url, userAgent: navigator.userAgent, doc: document, host: window,
    navigate: navigatePaymentApp, update: state => { launchState.value = state; }, returned: () => void refresh() });
}, { immediate: true });
watch(() => props.order, async order => {
  const current = ++generation; qr.value = ''; issue.value = ''; confirmCancel.value = false; cancelling.value = false;
  providerUnavailable.value = false; fallbackOpen.value = false;
  if (!order?.qr_code) return;
  try { const image = await QRCode.toDataURL(order.qr_code, { width: 240, margin: 2 }); if (current === generation) qr.value = image; }
  catch { if (current === generation) issue.value = '支付二维码生成失败，请使用支付链接或重新加载。'; }
}, { immediate: true });
function authorize() {
  if (!props.order) return;
  try { window.location.assign(oauthURL(props.order, props.request, window.location.origin)); }
  catch (error) { issue.value = error instanceof Error ? error.message : '授权无法启动'; }
}
async function cancel() {
  if (!props.order || cancelling.value || !canPay.value) return;
  const current = generation, id = props.order.order_id; cancelling.value = true;
  try { await paymentAPI.cancelOrder(id); if (current !== generation) return; confirmCancel.value = false; await refresh(); }
  catch { if (current === generation) issue.value = '取消失败，请查询订单后重试'; }
  finally { if (current === generation) cancelling.value = false; }
}
onBeforeUnmount(() => { generation++; clearInterval(clock); alipayLauncher?.dispose(); });
</script>
<template>
  <MacSheet :show="order !== null && !fallbackOpen" title="完成支付" @close="emit('close')">
    <div v-if="order" class="checkout-body">
      <template v-if="kind === 'oauth'">
        <p>请先完成微信授权，再继续支付。</p>
        <MacButton variant="primary" @click="authorize">继续微信授权</MacButton>
      </template>
      <template v-else>
        <p class="checkout-amount">{{ order.currency || '金额' }} {{ amount }}</p>
        <p class="checkout-meta">订单 #{{ order.order_id }}</p>
        <p v-if="canPay && remaining !== null">付款有效期剩余 {{ Math.floor(remaining / 60) }} 分 {{ remaining % 60 }} 秒</p>
        <template v-if="canPay">
          <ProviderPayment v-if="['stripe', 'airwallex', 'jsapi'].includes(kind)" :key="order.order_id" :order="order" :publishable-key="publishableKey" :method="method" :popup="popup" @submitted="refresh" @unavailable="providerUnavailable = true" />
          <template v-else>
            <img v-if="qr" :src="qr" width="240" height="240" alt="订单支付二维码" />
            <MacButton v-if="alipayAppLink" :disabled="launchState === 'launching'" @click="alipayLauncher?.launch()">打开支付宝 App</MacButton>
            <p v-if="launchState === 'launching'" role="status">正在打开支付宝…</p>
            <p v-else-if="launchState === 'backgrounded'" role="status">已切换支付应用，返回后将查询订单结果。</p>
            <p v-else-if="launchState === 'fallback'" role="status">未能打开支付宝，请使用上方二维码，或在系统浏览器中打开本页。</p>
            <a v-if="payLink" :href="payLink" target="_blank" rel="noopener noreferrer">打开支付页面 ↗</a>
            <p v-if="!qr && !payLink">付款信息无法恢复，请在订单记录查看或取消后重新下单。</p>
          </template>
        </template>
        <MacButton v-if="canFallback" @click="fallbackOpen = true">改用二维码支付…</MacButton>
        <p role="status">{{ expired && status === 'PENDING' ? '付款入口已过期，仍可查询最终订单结果' : statusText(status) }}</p>
        <p v-if="statusIssue" role="alert">{{ statusIssue }}</p>
      </template>
      <p v-if="issue" role="alert">{{ issue }}</p>
    </div>
    <template #footer>
      <MacButton @click="emit('close')">返回</MacButton>
      <MacButton v-if="canPay" :disabled="cancelling" @click="confirmCancel = true">取消订单</MacButton>
      <MacButton v-if="lookup" variant="primary" :loading="busy" @click="refresh">查询支付结果</MacButton>
    </template>
    <MacAlertSheet :show="confirmCancel" title="取消此订单？" message="取消后请勿继续向此订单付款。" confirm-text="取消订单" :danger="true" :loading="cancelling" @confirm="cancel" @cancel="confirmCancel = false" />
  </MacSheet>
  <QrFallbackSheet :show="fallbackOpen" :order-id="order?.order_id" :request="request" :payment-type="fallbackMethod" @close="fallbackOpen = false" @created="(result, payload) => emit('replaced', result, payload)" @changed="refresh" />
</template>
<style scoped>
.checkout-body { display:flex; flex-direction:column; align-items:center; gap:12px; text-align:center; font-size:12px; line-height:1.7; min-width:0; }
.checkout-amount { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; }
.checkout-meta { color:var(--text-secondary); }img { max-width:100%; border-radius:12px; }a { color:var(--accent); }[role="alert"] { color:var(--danger);overflow-wrap:anywhere; }
</style>
