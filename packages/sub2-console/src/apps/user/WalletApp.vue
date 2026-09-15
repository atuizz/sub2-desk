<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import './app-polish.css';
import type { WindowInstance } from '@sub2-mac/core';
import { MacButton, MacSheet, MacTable, MacAlertSheet, type TableColumn, useSystemAudio } from '@sub2-mac/core';
import { useAuthStore } from '@/stores/auth';
import { captureUserSession, isUserSessionCurrent, publishUserProfile } from '@/stores/userSession';
import CheckoutSheet from './CheckoutSheet.vue';
import type { CreateOrderResult, CreateOrderRequest } from '@/types/payment';
import { createPayload, saveRecovery, readRecovery, RECOVERY_KEY } from './payments/flow';
import QrFallbackSheet from './payments/QrFallbackSheet.vue';
import { isMobileQrFailure } from './payments/qrFallback';
import { paymentAPI } from '@/api/payment';
import { userAPI } from '@/api/user';
import type {
  CheckoutInfoResponse,
  PaymentOrder,
  SubscriptionPlan,
  MethodLimit
} from '@/types/payment';
import type { UserAffiliateDetail } from '@/types';

const props = defineProps<{
  win?: WindowInstance;
}>();

const authStore = useAuthStore();
const audio = useSystemAudio();

// Active tab: 'recharge' | 'subscription' | 'orders' | 'affiliate'
const activeTab = ref<'recharge' | 'subscription' | 'orders' | 'affiliate'>((props.win as any)?.customData?.tab || 'recharge');

const loading = ref(false);
const checkoutError = ref('');
const ordersError = ref('');
const submitting = ref(false);
const checkoutInfo = ref<CheckoutInfoResponse | null>(null);
const plans = ref<SubscriptionPlan[]>([]);
const orders = ref<PaymentOrder[]>([]);
const currentStatusFilter = ref('');
const isOrdersLoading = ref(false);
const ordersPage = ref(1);
const ordersTotal = ref(0);
const ordersPageSize = 25;
const ordersPages = computed(() => Math.max(1, Math.ceil(ordersTotal.value / ordersPageSize)));
let ordersRequest = 0;
onBeforeUnmount(() => { ordersRequest++; });
watch(() => props.win?.customData?.tab, tab => {
  if (['recharge', 'subscription', 'orders', 'affiliate'].includes(tab)) {
    activeTab.value = tab;
    if (tab === 'orders') void loadOrders();
    else if (tab === 'affiliate') void loadAffiliateDetail();
    else if (!checkoutInfo.value) void loadData();
  }
});

// Recharge Form State
const selectedAmount = ref<number>(50);
const customAmount = ref<string>('');
const selectedMethod = ref<string>('');
const presetAmounts = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];

// Order Dialog & Paying State
const paymentResult = ref<CreateOrderResult | null>(null);
const paymentRequest = ref<CreateOrderRequest>();
const initialFallbackRequest = ref<CreateOrderRequest>();
const initialFallbackOpen = ref(false);
const recoverableOrder = ref<CreateOrderResult | null>(null);
const unknownOrder = ref(false);
const unknownOrderReviewed = ref(false);
const confirmNewOrder = ref(false);
let creatingPayment = false;
const unknownOrderKey = (owner: number | null) => `sub2-mac.payment.unknown.v1:${owner ?? 'anonymous'}`;
function restoreUnknownOrder() {
  try { unknownOrder.value = sessionStorage.getItem(unknownOrderKey(authStore.user?.id ?? null)) === '1'; } catch { unknownOrder.value = false; }
  unknownOrderReviewed.value = false; confirmNewOrder.value = false;
}
function markUnknownOrder(owner: number | null, value: boolean) {
  unknownOrder.value = value; unknownOrderReviewed.value = false;
  try { if (value) sessionStorage.setItem(unknownOrderKey(owner), '1'); else sessionStorage.removeItem(unknownOrderKey(owner)); } catch { /* In-memory fence still applies when storage is unavailable. */ }
}
function reviewUnknownOrder() { activeTab.value = 'orders'; selectedPlan.value = null; void loadOrders(1); }
function allowNewOrder() {
  if (!confirmNewOrder.value || !unknownOrderReviewed.value || isOrdersLoading.value || creatingPayment) return;
  markUnknownOrder(authStore.user?.id ?? null, false); confirmNewOrder.value = false;
}
restoreUnknownOrder();
let paymentGeneration = 0;
onBeforeUnmount(() => { paymentGeneration++; });
watch(() => authStore.user?.id, () => {
  paymentGeneration++;
  paymentResult.value = null;
  paymentRequest.value = undefined;
  initialFallbackRequest.value = undefined; initialFallbackOpen.value = false;
  recoverableOrder.value = null;
  creatingPayment = false; submitting.value = false; restoreUnknownOrder();
  ordersRequest++; orders.value = []; ordersTotal.value = 0; isOrdersLoading.value = false;
}, { flush: 'sync' });
onMounted(() => {
  try { recoverableOrder.value = readRecovery(localStorage.getItem(RECOVERY_KEY), { owner: authStore.user?.id ?? null }); } catch { /* storage optional */ }
});
async function submitPayment(request: CreateOrderRequest) {
  if (creatingPayment || unknownOrder.value) throw new Error('上次下单结果尚未确认，请先核对订单记录。');
  const current = paymentGeneration;
  const owner = authStore.user?.id ?? null;
  const payload = createPayload(request, window.location.origin, navigator.userAgent, checkoutInfo.value);
  initialFallbackRequest.value = undefined;
  creatingPayment = true;
  markUnknownOrder(owner, true); // Persist before POST so closing/reopening cannot replay an uncertain write.
  let data: CreateOrderResult;
  try {
    data = (await paymentAPI.createOrder(payload)).data;
    if (!data || (!Number.isSafeInteger(data.order_id) || data.order_id <= 0) && !(data.result_type === 'oauth_required' && data.oauth?.authorize_url)) throw new Error('订单响应不完整');
  }
  catch (error) {
    if (current !== paymentGeneration || owner !== (authStore.user?.id ?? null)) return;
    const status = (error as { status?: number; response?: { status?: number } })?.status ?? (error as { response?: { status?: number } })?.response?.status;
    if (status && [400, 401, 403, 404, 405, 422, 429].includes(status)) {
      markUnknownOrder(owner, false);
      if (isMobileQrFailure(error, request.payment_type, navigator.userAgent)) initialFallbackRequest.value = payload;
    } else throw new Error('订单提交结果未知，已停止重复下单。请先在订单记录核对，勿直接另建二维码订单。');
    throw error;
  } finally {
    if (current === paymentGeneration) creatingPayment = false;
  }
  if (current !== paymentGeneration || owner !== (authStore.user?.id ?? null)) return;
  markUnknownOrder(owner, false);
  paymentRequest.value = payload;
  paymentResult.value = { ...data, payment_type: data.payment_type || request.payment_type };
  try { saveRecovery(localStorage, paymentResult.value, owner); recoverableOrder.value = paymentResult.value.order_id > 0 ? paymentResult.value : null; }
  catch { showToast('订单已创建，但浏览器无法保存恢复信息，请保持窗口打开'); }
}
function replacePayment(order: CreateOrderResult, request: CreateOrderRequest) {
  paymentRequest.value = request; paymentResult.value = order;
  initialFallbackRequest.value = undefined; initialFallbackOpen.value = false;
  try { saveRecovery(localStorage, order, authStore.user?.id ?? null); recoverableOrder.value = order; }
  catch { showToast('新订单已创建，但浏览器无法保存恢复信息，请保持窗口打开'); }
  if (!order.qr_code) showToast('新订单已创建，但支付服务未返回二维码，请查看当前付款入口或订单记录');
}
async function resumeOrder(order: PaymentOrder) {
  if (submitting.value) return;
  submitting.value = true;
  try {
    let saved: CreateOrderResult | null = null;
    try { saved = readRecovery(localStorage.getItem(RECOVERY_KEY), { orderId: order.id, owner: authStore.user?.id ?? null }); } catch { /* optional */ }
    paymentRequest.value = undefined;
    paymentResult.value = saved || { order_id: order.id, amount: order.amount, pay_amount: order.pay_amount, fee_rate: order.fee_rate, currency: order.currency, expires_at: order.expires_at, payment_type: order.payment_type, out_trade_no: order.out_trade_no };
  } finally { submitting.value = false; }
}
const selectedPlan = ref<SubscriptionPlan | null>(null);

// Refund State
const refundTarget = ref<PaymentOrder | null>(null);
const refundReason = ref('');
const isRefunding = ref(false);
const cancelTargetId = ref<number | null>(null);

const toastMsg = ref<string | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(toastTimer));
function showToast(msg: string) {
  clearTimeout(toastTimer);
  toastMsg.value = msg;
  toastTimer = setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2500);
}

// Available payment methods from checkoutInfo
const enabledMethods = computed(() => {
  if (!checkoutInfo.value?.methods) return [];
  return Object.entries(checkoutInfo.value.methods).map(([key, item]) => ({
    key,
    ...item
  })).filter(m => m.available !== false);
});

const validAmount = computed(() => {
  if (customAmount.value) {
    const val = parseFloat(customAmount.value);
    return isNaN(val) ? 0 : val;
  }
  return selectedAmount.value || 0;
});

const feeRate = computed(() => {
  if (!selectedMethod.value || !checkoutInfo.value?.methods) return 0;
  const m = checkoutInfo.value.methods[selectedMethod.value];
  return m?.fee_rate || 0;
});

const feeAmount = computed(() => {
  return Math.round((validAmount.value * feeRate.value) / 100 * 100) / 100;
});

const totalAmount = computed(() => {
  return validAmount.value + feeAmount.value;
});

const creditedAmount = computed(() => {
  const mult = checkoutInfo.value?.balance_recharge_multiplier || 1;
  return validAmount.value * mult;
});

// Order Table Columns
const orderColumns: TableColumn[] = [
  { key: 'id', label: '订单号', width: '90px' },
  { key: 'order_type', label: '类型', width: '90px' },
  { key: 'amount', label: '金额', width: '100px', align: 'right' },
  { key: 'pay_amount', label: '实付金额', width: '110px', align: 'right' },
  { key: 'payment_type', label: '支付方式', width: '110px' },
  { key: 'status', label: '状态', width: '100px' },
  { key: 'created_at', label: '创建时间', width: '160px' },
  { key: 'actions', label: '操作', width: '100px', align: 'right' }
];

async function loadData() {
  loading.value = true;
  checkoutError.value = '';
  try {
    const res = await paymentAPI.getCheckoutInfo();
    if (res.data) {
      checkoutInfo.value = res.data;
      plans.value = res.data.plans || [];
      const methods = Object.keys(res.data.methods || {});
      if (methods.length > 0 && !selectedMethod.value) {
        selectedMethod.value = methods[0];
      }
    }
  } catch {
    checkoutError.value = '购买信息加载失败，请重试。';
  } finally {
    loading.value = false;
  }
}

async function loadOrders(page = ordersPage.value) {
  const request = ++ordersRequest;
  const status = currentStatusFilter.value;
  isOrdersLoading.value = true;
  ordersError.value = '';
  unknownOrderReviewed.value = false;
  try {
    const res = await paymentAPI.getMyOrders({ page, page_size: ordersPageSize, status: status || undefined });
    if (request !== ordersRequest) return;
    if (!Array.isArray(res.data?.items) || !Number.isFinite(res.data?.total)) throw new Error('订单列表响应无效');
    const total = res.data?.total || 0;
    const lastPage = Math.max(1, Math.ceil(total / ordersPageSize));
    if (page > lastPage) { await loadOrders(lastPage); return; }
    orders.value = res.data?.items || [];
    ordersTotal.value = total;
    ordersPage.value = page;
    if (unknownOrder.value && !status && page === 1 && !creatingPayment) unknownOrderReviewed.value = true;
  } catch {
    if (request !== ordersRequest) return;
    ordersError.value = '订单列表加载失败，请重试。';
  } finally {
    if (request === ordersRequest) isOrdersLoading.value = false;
  }
}
function filterOrders() {
  orders.value = [];
  ordersTotal.value = 0;
  ordersPage.value = 1;
  void loadOrders(1);
}

async function handleCreateRechargeOrder() {
  if (submitting.value || unknownOrder.value || validAmount.value <= 0 || !selectedMethod.value) return;
  const current = paymentGeneration;
  submitting.value = true;
  try {
    await submitPayment({
      order_type: 'balance',
      amount: validAmount.value,
      payment_type: selectedMethod.value
    });
  } catch (err: any) {
    if (current === paymentGeneration) showToast(err.message || err.response?.data?.detail || '创建充值订单失败');
  } finally {
    if (current === paymentGeneration) submitting.value = false;
  }
}

async function createSubscription() {
  if (!selectedPlan.value || !selectedMethod.value || submitting.value || unknownOrder.value) return;
  const current = paymentGeneration;
  submitting.value = true;
  try {
    await submitPayment({ order_type: 'subscription', plan_id: selectedPlan.value.id, amount: selectedPlan.value.price, payment_type: selectedMethod.value });
    if (current === paymentGeneration) selectedPlan.value = null;
  } catch (error: any) { if (current === paymentGeneration) showToast(error.message || '创建订阅订单失败'); }
  finally { if (current === paymentGeneration) submitting.value = false; }
}
async function paymentCompleted() {
  recoverableOrder.value = null;
  const generation = paymentGeneration, session = captureUserSession(authStore);
  if (!session) return;
  showToast('支付已完成，正在刷新账户');
  try {
    const profile = await userAPI.getProfile();
    if (generation !== paymentGeneration || !publishUserProfile(authStore, session, profile)) return;
    await loadOrders();
  } catch { if (generation === paymentGeneration) showToast('支付已完成，账户信息稍后可刷新查看'); }
}

const orderToCancel = ref<PaymentOrder | null>(null);
const isCancellingOrder = ref(false);

function promptCancelOrder(ord: PaymentOrder) {
  orderToCancel.value = ord;
}

async function confirmCancelOrder() {
  if (!orderToCancel.value || isCancellingOrder.value) return;
  isCancellingOrder.value = true;
  try {
    await paymentAPI.cancelOrder(orderToCancel.value.id);
    showToast('订单已取消');
    orderToCancel.value = null;
    loadOrders();
  } catch (err: any) {
    showToast(err.message || err.response?.data?.detail || '取消订单失败');
  } finally {
    isCancellingOrder.value = false;
  }
}

async function handleRefundRequest() {
  if (!refundTarget.value || !refundReason.value.trim() || isRefunding.value) return;
  isRefunding.value = true;
  try {
    await paymentAPI.requestRefund(refundTarget.value.id, { reason: refundReason.value.trim() });
    showToast('退款申请已提交');
    refundTarget.value = null;
    refundReason.value = '';
    loadOrders();
  } catch (err: any) {
    showToast(err.message || err.response?.data?.detail || '申请退款失败');
  } finally {
    isRefunding.value = false;
  }
}

function selectPreset(amt: number) {
  selectedAmount.value = amt;
  customAmount.value = '';
}

function statusBadgeClass(status: string) {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
    case 'PENDING':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    case 'FAILED':
    case 'CANCELLED':
      return 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
    case 'REFUNDED':
      return 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300';
    default:
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'COMPLETED': return '已完成';
    case 'PENDING': return '待支付';
    case 'CANCELLED': return '已取消';
    case 'REFUNDED': return '已退款';
    default: return status;
  }
}

// ==================== Affiliate (推广返利) ====================
const affDetail = ref<UserAffiliateDetail | null>(null);
const isAffLoading = ref(false);
const isAffTransferring = ref(false);

const inviteLink = computed(() => {
  if (!affDetail.value?.aff_code) return '';
  if (typeof window === 'undefined') return `/register?aff=${encodeURIComponent(affDetail.value.aff_code)}`;
  return `${window.location.origin}/register?aff=${encodeURIComponent(affDetail.value.aff_code)}`;
});

const formattedRebateRate = computed(() => {
  const v = affDetail.value?.effective_rebate_rate_percent ?? 0;
  const rounded = Math.round(v * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString();
});

async function loadAffiliateDetail() {
  isAffLoading.value = true;
  try {
    affDetail.value = await userAPI.getAffiliateDetail();
  } catch (err: any) {
    showToast(err.message || err.response?.data?.detail || '加载返利信息失败');
  } finally {
    isAffLoading.value = false;
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    audio.playClick();
    showToast(`${label}已复制到剪贴板`);
  } catch {
    showToast('复制失败，请手动选择复制');
  }
}

async function handleTransferQuota() {
  if (!affDetail.value || affDetail.value.aff_quota <= 0 || isAffTransferring.value) return;
  const session = captureUserSession(authStore), generation = paymentGeneration;
  if (!session) return;
  const current = () => generation === paymentGeneration && isUserSessionCurrent(authStore, session);
  isAffTransferring.value = true;
  try {
    const res = await userAPI.transferAffiliateQuota();
    if (!current()) return;
    audio.playCoin();
    showToast(`成功划转 $${(res.transferred_quota || 0).toFixed(2)} 到账户余额`);
    await Promise.all([
      loadAffiliateDetail(),
      userAPI.getProfile().then(u => { if (current()) publishUserProfile(authStore, session, u); }).catch(() => undefined)
    ]);
  } catch (err: any) {
    if (!current()) return;
    showToast(err.message || err.response?.data?.detail || '划转失败');
  } finally {
    if (current()) isAffTransferring.value = false;
  }
}

onMounted(() => {
  if (activeTab.value === 'affiliate') {
    loadAffiliateDetail();
  } else if (activeTab.value === 'orders') {
    loadOrders();
  } else {
    loadData();
  }
});
</script>

<template>
  <div class="user-app-polish wallet-app relative flex flex-col h-full bg-[var(--window-bg)] text-[var(--text-primary)] select-none overflow-hidden">
    <CheckoutSheet :order="paymentResult" :request="paymentRequest" :publishable-key="checkoutInfo?.stripe_publishable_key" @close="paymentResult = null" @paid="paymentCompleted" @replaced="replacePayment" />
    <div v-if="unknownOrder && !submitting" class="p-3 text-xs flex flex-wrap items-center gap-3" role="alert">
      <span>上次下单结果未知，已暂停新建订单。请核对订单记录，避免重复付款。</span>
      <MacButton :disabled="isOrdersLoading" @click="currentStatusFilter = ''; reviewUnknownOrder()">核对订单记录</MacButton>
      <MacButton :disabled="!unknownOrderReviewed || isOrdersLoading" @click="confirmNewOrder = true">核对后重新下单…</MacButton>
    </div>
    <MacAlertSheet :show="confirmNewOrder" title="确认已核对订单？" message="订单可能已创建或仍在处理中。若找到原订单，请继续原订单；只有确认无需等待或支付原订单时才允许重新下单。" confirm-text="已核对，允许重新下单" :danger="true" @confirm="allowNewOrder" @cancel="confirmNewOrder = false" />
    <div v-if="initialFallbackRequest && !paymentResult" class="p-3 text-xs flex items-center gap-3"><span>当前移动支付暂不可用，可另建二维码订单。</span><MacButton @click="initialFallbackOpen = true">改用二维码支付…</MacButton></div>
    <QrFallbackSheet :show="initialFallbackOpen" :request="initialFallbackRequest" :payment-type="initialFallbackRequest?.payment_type || ''" @close="initialFallbackOpen = false" @created="replacePayment" />
    <div v-if="recoverableOrder && !paymentResult" class="p-3 text-xs flex items-center gap-3" role="status">
      <span>有待查询的支付订单 #{{ recoverableOrder.order_id }}</span>
      <MacButton @click="paymentRequest = undefined; paymentResult = recoverableOrder">恢复支付 / 查询结果</MacButton>
      <MacButton @click="recoverableOrder = null">暂不查看</MacButton>
    </div>
    <MacSheet :show="selectedPlan !== null" title="订阅套餐" :loading="submitting" @close="selectedPlan = null">
      <p class="text-sm">{{ selectedPlan?.name }} · {{ selectedPlan?.currency || '金额' }} {{ selectedPlan?.price }}</p>
      <label class="block mt-4 text-xs">支付方式<select v-model="selectedMethod" class="block mt-2 w-full p-2 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg"><option v-for="method in enabledMethods" :key="method.key" :value="method.key">{{ method.display_name || method.key }}</option></select></label>
      <p v-if="unknownOrder" class="mt-3 text-xs" role="alert">上次下单结果未知，请关闭此弹层并核对订单记录。</p>
      <template #footer><MacButton :disabled="submitting" @click="selectedPlan = null">取消</MacButton><MacButton variant="primary" :disabled="!selectedMethod || unknownOrder" :loading="submitting" @click="createSubscription">创建订单</MacButton></template>
    </MacSheet>
    <MacSheet :show="refundTarget !== null" title="申请退款" :loading="isRefunding" @close="refundTarget = null">
      <p class="text-sm">订单 #{{ refundTarget?.id }}，申请提交后由站点审核。</p>
      <label class="block mt-4 text-xs">退款原因<textarea v-model="refundReason" rows="4" class="w-full mt-2 p-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)]" /></label>
      <template #footer><MacButton :disabled="isRefunding" @click="refundTarget = null">取消</MacButton><MacButton variant="primary" :loading="isRefunding" :disabled="!refundReason.trim()" @click="handleRefundRequest">提交申请</MacButton></template>
    </MacSheet>
    <!-- Header Bar -->
    <div class="app-toolbar px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
      <div class="flex items-center gap-3">
        <img :src="getAppIcon('wallet')" alt="Wallet" class="w-8 h-8 object-contain drop-shadow-sm" />
        <div>
          <h2 class="text-[17px] font-semibold tracking-tight text-[var(--text-primary)]">钱包与充值</h2>
          <p class="text-[11px] text-[var(--text-secondary)] mt-0.5">余额充值、订阅套餐与返利中心</p>
        </div>
      </div>

      <!-- Segmented Control -->
      <div class="app-filterbar flex items-center p-0.5 rounded-lg bg-black/[0.06] dark:bg-white/[0.08] text-xs font-medium">
        <button
          type="button"
          class="px-4 py-1.5 rounded-md transition-all"
          :class="activeTab === 'recharge' ? 'bg-white dark:bg-neutral-800 text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
          @click="activeTab = 'recharge'"
        >
          充值
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-md transition-all"
          :class="activeTab === 'subscription' ? 'bg-white dark:bg-neutral-800 text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
          @click="activeTab = 'subscription'"
        >
          订阅
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-md transition-all"
          :class="activeTab === 'orders' ? 'bg-white dark:bg-neutral-800 text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
          @click="activeTab = 'orders'; loadOrders()"
        >
          我的订单
        </button>
        <button
          type="button"
          class="px-4 py-1.5 rounded-md transition-all"
          :class="activeTab === 'affiliate' ? 'bg-white dark:bg-neutral-800 text-[var(--text-primary)] shadow-xs font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'"
          @click="activeTab = 'affiliate'; loadAffiliateDetail()"
        >
          推广返利
        </button>
      </div>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="absolute top-16 right-6 z-50 px-3.5 py-2 rounded-lg bg-neutral-900/90 text-white text-xs shadow-lg backdrop-blur-md border border-white/10 animate-fade-in">
      {{ toastMsg }}
    </div>

    <!-- Main Content Body -->
    <div class="app-content flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto space-y-4">
        <div v-if="loading && (activeTab === 'recharge' || activeTab === 'subscription')" class="app-notice" role="status">正在读取购买信息…</div>
        <div v-if="checkoutError && (activeTab === 'recharge' || activeTab === 'subscription')" class="app-notice" data-tone="error" role="alert"><span>{{ checkoutError }}</span><button @click="loadData" :disabled="loading">重试</button></div>
        <div v-if="ordersError && activeTab === 'orders'" class="app-notice" data-tone="error" role="alert"><span>{{ ordersError }}</span><button @click="loadOrders()" :disabled="isOrdersLoading">重试</button></div>

        <!-- ========================================== -->
        <!-- 1. Recharge Tab -->
        <!-- ========================================== -->
        <template v-if="activeTab === 'recharge'">
          <!-- Recharge Account Card (100% 对齐原版) -->
          <div class="app-panel p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs space-y-1">
            <div class="text-xs font-medium text-[var(--text-tertiary)]">充值账户</div>
            <div class="text-base font-semibold text-[var(--text-primary)]">
              {{ authStore.user?.username || authStore.user?.email || 'admin@sub2api.local' }}
            </div>
            <div class="text-sm font-medium text-emerald-600 dark:text-emerald-400 font-mono pt-0.5">
              当前余额: {{ (authStore.user?.balance || 0).toFixed(2) }}
            </div>
          </div>

          <!-- Empty State: When no payment methods configured (100% 对齐原版) -->
          <div v-if="loading" class="app-empty" role="status">正在读取支付方式…</div>
          <div v-else-if="checkoutError" class="app-empty"><strong>暂时无法显示购买选项</strong><p>重新加载后继续。</p></div>
          <div v-else-if="enabledMethods.length === 0" class="p-16 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center shadow-2xs">
            <p class="text-sm text-[var(--text-secondary)]">充值功能暂未开放</p>
          </div>

          <!-- When payment methods are available -->
          <template v-else>
            <!-- Preset amounts -->
            <div class="app-panel p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs space-y-3">
              <div class="text-xs font-semibold text-[var(--text-primary)]">充值金额</div>
              <div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                <button
                  v-for="amt in presetAmounts"
                  :key="amt"
                  type="button"
                  class="h-10 rounded-xl border text-xs font-semibold font-mono transition-all"
                  :class="selectedAmount === amt && !customAmount ? 'border-[#007aff] bg-[#007aff]/10 text-[#007aff] ring-1 ring-[#007aff]' : 'border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'"
                  @click="selectPreset(amt)"
                >
                  ${{ amt }}
                </button>
              </div>
              <div class="pt-1">
                <input
                  v-model="customAmount"
                  type="number"
                  placeholder="其他自定义金额"
                  class="w-full h-9 px-3 text-xs rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[#007aff]"
                  @input="selectedAmount = 0"
                />
              </div>
            </div>

            <!-- Payment Method Selector -->
            <div class="app-panel p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs space-y-3">
              <div class="text-xs font-semibold text-[var(--text-primary)]">支付方式</div>
              <div class="grid grid-cols-2 gap-2.5">
                <button
                  v-for="m in enabledMethods"
                  :key="m.key"
                  type="button"
                  class="p-3 rounded-xl border text-left flex items-center justify-between transition-all"
                  :class="selectedMethod === m.key ? 'border-[#007aff] bg-[#007aff]/5 ring-1 ring-[#007aff]' : 'border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/5'"
                  @click="selectedMethod = m.key"
                >
                  <div>
                    <div class="text-xs font-semibold text-[var(--text-primary)] capitalize">{{ m.display_name || m.key }}</div>
                    <div v-if="m.fee_rate > 0" class="text-[10px] text-[var(--text-secondary)] mt-0.5">手续费 {{ m.fee_rate }}%</div>
                  </div>
                  <div class="w-4 h-4 rounded-full border flex items-center justify-center" :class="selectedMethod === m.key ? 'border-[#007aff] bg-[#007aff]' : 'border-neutral-400'">
                    <div v-if="selectedMethod === m.key" class="w-1.5 h-1.5 rounded-full bg-white"></div>
                  </div>
                </button>
              </div>
            </div>

            <!-- Breakdown & Submit -->
            <div class="app-panel p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs space-y-3 text-xs">
              <div class="flex justify-between text-[var(--text-secondary)]">
                <span>支付金额</span>
                <span class="font-mono font-medium text-[var(--text-primary)]">${{ validAmount.toFixed(2) }}</span>
              </div>
              <div v-if="feeRate > 0" class="flex justify-between text-[var(--text-secondary)]">
                <span>手续费 ({{ feeRate }}%)</span>
                <span class="font-mono font-medium text-[var(--text-primary)]">${{ feeAmount.toFixed(2) }}</span>
              </div>
              <div class="flex justify-between border-t border-[var(--border-subtle)] pt-3 font-semibold">
                <span>实际支付</span>
                <span class="text-base font-mono text-[#007aff]">${{ totalAmount.toFixed(2) }}</span>
              </div>
              <div v-if="checkoutInfo?.balance_recharge_multiplier && checkoutInfo.balance_recharge_multiplier !== 1" class="flex justify-between text-[var(--text-secondary)] text-[11px]">
                <span>到账额度</span>
                <span class="font-mono">${{ creditedAmount.toFixed(2) }}</span>
              </div>
            </div>

            <MacButton
              size="lg"
              variant="primary"
              class="w-full h-11 text-sm font-semibold shadow-md"
              :disabled="validAmount <= 0 || submitting || unknownOrder"
              :loading="submitting"
              @click="handleCreateRechargeOrder"
            >
              创建订单 ${{ totalAmount.toFixed(2) }}
            </MacButton>
          </template>
        </template>

        <!-- ========================================== -->
        <!-- 2. Subscription Tab -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'subscription'">
          <div v-if="plans.length === 0" class="p-16 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-center shadow-2xs">
            <p class="text-sm text-[var(--text-secondary)]">暂无可购买的订阅计划</p>
          </div>
          <div v-else class="app-model-grid grid grid-cols-1 md:grid-cols-2 gap-4">
            <div
              v-for="plan in plans"
              :key="plan.id"
              class="app-panel p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs space-y-4 flex flex-col justify-between"
            >
              <div>
                <div class="flex items-center justify-between gap-2">
                  <span class="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    {{ plan.group_platform || '通用' }}
                  </span>
                  <div class="text-xs font-bold text-amber-600 dark:text-amber-400 font-mono">
                    ×{{ plan.rate_multiplier ?? 1 }} 倍率
                  </div>
                </div>
                <h3 class="text-base font-bold text-[var(--text-primary)] mt-2">{{ plan.name }}</h3>
                <p v-if="plan.description" class="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{{ plan.description }}</p>

                <div class="mt-4 flex items-baseline gap-1">
                  <span class="text-2xl font-bold font-mono text-[var(--text-primary)]">${{ plan.price }}</span>
                  <span class="text-xs text-[var(--text-secondary)]">/ 周期</span>
                </div>
              </div>

              <MacButton size="sm" variant="primary" class="w-full" :disabled="!plan.for_sale || submitting" @click="selectedPlan = plan">
                立即订阅
              </MacButton>
            </div>
          </div>
        </template>

        <!-- ========================================== -->
        <!-- 3. Orders Tab -->
        <!-- ========================================== -->
        <template v-else-if="activeTab === 'orders'">
          <!-- Filter Bar -->
          <div class="p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] flex items-center justify-between gap-3 text-xs">
            <div class="flex items-center gap-2">
              <span class="text-[var(--text-secondary)]">状态过滤:</span>
              <select
                v-model="currentStatusFilter"
                class="h-7 px-2 text-xs rounded-lg bg-black/[0.04] dark:bg-white/[0.06] border border-[var(--border-subtle)] focus:outline-none"
                @change="filterOrders"
              >
                <option value="">全部</option>
                <option value="PENDING">待支付</option>
                <option value="COMPLETED">已完成</option>
                <option value="PAID">已支付</option>
                <option value="RECHARGING">入账中</option>
                <option value="EXPIRED">已过期</option>
                <option value="CANCELLED">已取消</option>
                <option value="FAILED">已失败</option>
                <option value="REFUNDED">已退款</option>
              </select>
            </div>
            <button
              type="button"
              class="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10"
              :disabled="isOrdersLoading"
              @click="loadOrders()"
            >
              刷新
            </button>
          </div>

          <!-- Orders Table -->
          <div class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-2xs">
            <div v-if="isOrdersLoading" class="app-empty" role="status">正在读取订单…</div>
            <div v-else-if="ordersError && orders.length === 0" class="app-empty">订单暂时无法显示，请点击上方重试。</div>
            <div v-else-if="orders.length === 0" class="p-12 text-center text-xs text-[var(--text-secondary)]">
              暂无订单记录
            </div>
            <div v-else class="overflow-x-auto">
              <table class="app-table w-full min-w-[680px] text-left text-xs border-collapse">
                <thead>
                  <tr class="border-b border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--text-tertiary)] font-medium">
                    <th class="p-3">订单号</th>
                    <th class="p-3">类型</th>
                    <th class="p-3 text-right">金额</th>
                    <th class="p-3 text-right">实付金额</th>
                    <th class="p-3">支付方式</th>
                    <th class="p-3">状态</th>
                    <th class="p-3">创建时间</th>
                    <th class="p-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[var(--border-subtle)]">
                  <tr v-for="ord in orders" :key="ord.id" class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                    <td class="p-3 font-mono font-medium">#{{ ord.id }}</td>
                    <td class="p-3">{{ ord.order_type === 'balance' ? '余额充值' : '计划订阅' }}</td>
                    <td class="p-3 text-right font-mono">${{ ord.amount.toFixed(2) }}</td>
                    <td class="p-3 text-right font-mono font-semibold text-[#007aff]">${{ ord.pay_amount.toFixed(2) }}</td>
                    <td class="p-3 capitalize">{{ ord.payment_type }}</td>
                    <td class="p-3">
                      <span class="px-2 py-0.5 rounded-full text-[10px] font-medium" :class="statusBadgeClass(ord.status)">
                        {{ statusLabel(ord.status) }}
                      </span>
                    </td>
                    <td class="p-3 text-[11px] text-[var(--text-secondary)] font-mono">
                      {{ ord.created_at ? new Date(ord.created_at).toLocaleString('zh-CN', { hour12: false }) : '-' }}
                    </td>
                    <td class="p-3 text-right space-x-1">
                      <button v-if="ord.status === 'PENDING'" type="button" class="text-xs text-[var(--accent)] hover:underline" @click="resumeOrder(ord)">继续支付</button>
                      <button
                        v-if="ord.status === 'PENDING'"
                        type="button"
                        class="text-xs text-amber-600 hover:underline"
                        @click="promptCancelOrder(ord)"
                      >
                        取消
                      </button>
                      <button
                        v-if="ord.status === 'COMPLETED'"
                        type="button"
                        class="text-xs text-purple-600 hover:underline"
                        @click="refundTarget = ord"
                      >
                        退款
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="orders-pagination" aria-label="订单分页">
            <span role="status">共 {{ ordersTotal }} 条 · 第 {{ ordersPage }} / {{ ordersPages }} 页</span>
            <div><MacButton :disabled="isOrdersLoading || ordersPage <= 1" @click="loadOrders(ordersPage - 1)">上一页</MacButton><MacButton :disabled="isOrdersLoading || ordersPage >= ordersPages" @click="loadOrders(ordersPage + 1)">下一页</MacButton></div>
          </div>
        </template>

        <!-- ========================================== -->
        <!-- 4. Affiliate Tab (推广返利)               -->
        <!-- ========================================== -->
        <template v-if="activeTab === 'affiliate'">
          <div v-if="isAffLoading" class="p-12 text-center text-xs text-[var(--text-secondary)]">
            加载返利数据中...
          </div>
          <template v-else-if="affDetail">
            <!-- Affiliate Metrics Cards -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div class="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs">
                <p class="text-[11px] text-[var(--text-secondary)]">返利比例</p>
                <p class="text-xl font-semibold mt-1 text-[#007aff]">{{ formattedRebateRate }}%</p>
                <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">每笔充值或订阅有效返利</p>
              </div>
              <div class="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs">
                <p class="text-[11px] text-[var(--text-secondary)]">成功邀请人数</p>
                <p class="text-xl font-semibold mt-1">{{ affDetail.aff_count || 0 }}</p>
                <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">名注册用户</p>
              </div>
              <div class="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs">
                <p class="text-[11px] text-[var(--text-secondary)]">可用返佣额度</p>
                <p class="text-xl font-semibold mt-1 text-emerald-600 dark:text-emerald-400">
                  ${{ (affDetail.aff_quota || 0).toFixed(2) }}
                </p>
                <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">可实时划转至余额</p>
              </div>
              <div class="p-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-2xs">
                <p class="text-[11px] text-[var(--text-secondary)]">累计总返佣</p>
                <p class="text-xl font-semibold mt-1">
                  ${{ (affDetail.aff_history_quota || 0).toFixed(2) }}
                </p>
                <p v-if="affDetail.aff_frozen_quota > 0" class="text-[10px] text-amber-600 mt-0.5">
                  冻结中: ${{ (affDetail.aff_frozen_quota || 0).toFixed(2) }}
                </p>
                <p v-else class="text-[10px] text-[var(--text-tertiary)] mt-0.5">历史累计总收益</p>
              </div>
            </div>

            <!-- Invite Code & Link Card -->
            <div class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-2xs space-y-4">
              <h3 class="text-xs font-semibold text-[var(--text-primary)]">专属推广代码与邀请链接</h3>
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <!-- Code -->
                <div>
                  <label class="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">我的邀请码</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      :value="affDetail.aff_code"
                      class="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.04] text-xs font-mono font-semibold"
                    />
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium shrink-0 transition-colors"
                      @click="copyText(affDetail.aff_code, '邀请码')"
                    >
                      复制
                    </button>
                  </div>
                </div>

                <!-- Link -->
                <div>
                  <label class="block text-[11px] font-medium text-[var(--text-secondary)] mb-1.5">专属邀请链接</label>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readonly
                      :value="inviteLink"
                      class="flex-1 px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.04] text-xs font-mono truncate"
                    />
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium shrink-0 transition-colors"
                      @click="copyText(inviteLink, '邀请链接')"
                    >
                      复制链接
                    </button>
                  </div>
                </div>
              </div>

              <!-- Rules Tip -->
              <div class="rounded-xl border border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] p-3 text-[11px] text-[var(--text-secondary)] space-y-1">
                <p class="font-medium text-[var(--text-primary)]">推广返利说明：</p>
                <p>1. 将专属邀请码或推广链接分享给好友；</p>
                <p>2. 好友注册并成功充值余额或订阅计划后，您将获得消费金额 {{ formattedRebateRate }}% 的佣金返利；</p>
                <p>3. 返利额度可随时转入个人主账户余额直接用于 API 调用；</p>
                <p v-if="affDetail.aff_frozen_quota > 0">4. 订单审核结算后，冻结中的额度将自动转为可用额度。</p>
              </div>
            </div>

            <!-- Transfer to Balance Card -->
            <div class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 class="text-xs font-semibold text-[var(--text-primary)]">划转至账户余额</h3>
                <p class="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  将当前可用返佣额度实时划转至您的主账户余额，可直接用于购买套餐或 API 计费抵扣。
                </p>
              </div>
              <button
                type="button"
                class="px-4 py-2 rounded-xl text-xs font-medium text-white bg-[#007aff] hover:bg-[#0062cc] disabled:opacity-50 transition-all shrink-0 shadow-xs"
                :disabled="isAffTransferring || affDetail.aff_quota <= 0"
                @click="handleTransferQuota"
              >
                {{ isAffTransferring ? '划转中...' : `一键划转全部额度 ($${(affDetail.aff_quota || 0).toFixed(2)})` }}
              </button>
            </div>

            <!-- Invitees Records Table -->
            <div class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] overflow-hidden shadow-2xs">
              <div class="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between">
                <div>
                  <h3 class="text-xs font-semibold text-[var(--text-primary)]">我的邀请明细</h3>
                  <p class="text-[10px] text-[var(--text-secondary)] mt-0.5">已受邀注册的好友及其返利贡献</p>
                </div>
                <button
                  type="button"
                  class="px-2.5 py-1 text-xs rounded-lg border border-[var(--border-subtle)] hover:bg-black/5 dark:hover:bg-white/10"
                  :disabled="isAffLoading"
                  @click="loadAffiliateDetail"
                >
                  刷新
                </button>
              </div>

              <div v-if="!affDetail.invitees || affDetail.invitees.length === 0" class="p-10 text-center text-xs text-[var(--text-secondary)]">
                暂无邀请记录，快去分享您的专属链接吧
              </div>
              <div v-else class="overflow-x-auto">
                <table class="app-table w-full min-w-[680px] text-left text-xs border-collapse">
                  <thead>
                    <tr class="border-b border-[var(--border-subtle)] bg-black/[0.02] dark:bg-white/[0.02] text-[var(--text-tertiary)] font-medium">
                      <th class="p-3">受邀用户</th>
                      <th class="p-3">用户名</th>
                      <th class="p-3 text-right">累计返利贡献</th>
                      <th class="p-3">加入时间</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-[var(--border-subtle)]">
                    <tr v-for="inv in affDetail.invitees" :key="inv.user_id" class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                      <td class="p-3 font-medium">{{ inv.email || '-' }}</td>
                      <td class="p-3 text-[var(--text-secondary)]">{{ inv.username || '-' }}</td>
                      <td class="p-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        ${{ (inv.total_rebate || 0).toFixed(2) }}
                      </td>
                      <td class="p-3 text-[11px] text-[var(--text-secondary)] font-mono">
                        {{ inv.created_at ? new Date(inv.created_at).toLocaleString('zh-CN', { hour12: false }) : '-' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </template>
        </template>

      </div>
    </div>

    <!-- MacAlertSheet for Order Cancellation -->
    <MacAlertSheet
      :show="!!orderToCancel"
      title="确定要取消此支付订单吗？"
      :message="`订单 #${orderToCancel?.id}（金额 $${orderToCancel?.amount || 0}）。取消后该订单的支付通道及二维码将立即失效。`"
      confirm-text="取消订单"
      cancel-text="关闭"
      :danger="true"
      :loading="isCancellingOrder"
      @confirm="confirmCancelOrder"
      @cancel="orderToCancel = null"
    />
  </div>
</template>

<style scoped>
.orders-pagination { display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:9px 12px;border-top:1px solid var(--border-subtle);font-size:11px;color:var(--text-secondary); }.orders-pagination>div { display:flex;gap:6px; }
</style>
