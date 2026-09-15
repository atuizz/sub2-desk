<script setup lang="ts">
import { getAppIcon } from '@/assets/appIcons';
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { MacAlertSheet, MacSheet } from '@sub2-mac/core';
import AdminFeedback from './AdminFeedback.vue';
import PromoInspector from './PromoInspector.vue';
import { adminError } from './admin-feedback';
import { adminPaymentAPI, type AdminPaymentConfig } from '../../api/admin/payment';
import * as redeemAdminAPI from '../../api/admin/redeem';
import * as promoAdminAPI from '../../api/admin/promo';
import * as groupsAdminAPI from '../../api/admin/groups';
import {
  affiliatesAPI,
  type AffiliateInviteRecord,
  type AffiliateRebateRecord,
  type AffiliateTransferRecord,
  type AffiliateAdminEntry,
  type AffiliateUserOverview
} from '../../api/admin/affiliates';
import type { PaymentOrder, AdminSubscriptionPlan, CreateAdminPlanRequest, DashboardStats } from '@/types/payment';
import type { RedeemCode, RedeemCodeType, PromoCode, AdminGroup } from '@/types';
import { useAuthStore } from '@/stores/auth';
import { usePaymentWriteGuard } from '@/utils/usePaymentWriteGuard';
import type { PaymentWriteMarker } from '@/utils/paymentWriteJournal';

const props = defineProps<{
  win?: any;
}>();
const auth = useAuthStore();
const refundGuard = usePaymentWriteGuard(() => auth.isAdmin ? auth.user?.id : null, () => auth.token, () => auth.sessionRevision);

// Active Tab: 6 total tabs aligning 100% with original Sub2API
type CommerceTab = 'orders' | 'plans' | 'dashboard' | 'redeem' | 'promo' | 'affiliates';
const activeTab = ref<CommerceTab>((props.win as any)?.customData?.tab || 'orders');
const loading = ref(false);
const loadError = ref('');
const dataPage = ref(1);
const currentTotal = computed(() => activeTab.value === 'orders' ? ordersTotal.value : activeTab.value === 'redeem' ? redeemTotal.value : activeTab.value === 'promo' ? promoTotal.value : affTotal.value);
const isPaginated = computed(() => ['orders', 'redeem', 'promo', 'affiliates'].includes(activeTab.value));
const totalPages = computed(() => Math.max(1, Math.ceil(currentTotal.value / 20)));
let loadVersion = 0;

// Toast feedback
const toastMsg = ref<string | null>(null);
function showToast(msg: string) {
  toastMsg.value = msg;
  setTimeout(() => {
    if (toastMsg.value === msg) toastMsg.value = null;
  }, 2600);
}

// Mac Alert Sheet
const alertSheet = ref({
  show: false,
  title: '',
  message: '',
  confirmText: '',
  danger: true,
  loading: false,
  action: null as (() => Promise<void>) | null
});

async function handleAlertConfirm() {
  if (alertSheet.value.action && !alertSheet.value.loading) {
    await alertSheet.value.action();
  }
}

// ==================== Tab 1: Orders ====================
const orders = ref<PaymentOrder[]>([]);
const ordersTotal = ref(0);
const orderSearch = ref('');
const orderStatus = ref('');
const orderPayType = ref('');

// Order Refund / Actions State
const selectedOrder = ref<PaymentOrder | null>(null);
const showOrderDetailModal = ref(false);
const showRefundModal = ref(false);
const refundAmount = ref(0);
const refundReason = ref('');
const refundDeductBalance = ref(true);
const isProcessingOrder = ref(false);
const refundRequireForce = ref(false);
const refundForceConfirmed = ref(false);
const refundWarning = ref('');
const pendingRefunds = computed(() => refundGuard.entries.value.filter(entry => entry.scope.startsWith('refund:')));
const selectedRefundWrite = computed(() => pendingRefunds.value.find(entry => entry.scope === `refund:${selectedOrder.value?.id}`));
const refundNeedsReview = computed(() => !refundGuard.available.value || !!selectedRefundWrite.value);
const refundReview = ref<PaymentWriteMarker | null>(null);
const reviewingRefund = ref(false);
const refundQueryingIds = ref(new Set<number>());
const refundActionLabels: Partial<Record<PaymentOrder['status'], string>> = {
  COMPLETED: '退款', REFUND_REQUESTED: '审核退款', REFUND_FAILED: '重试退款', PARTIALLY_REFUNDED: '继续退款'
};
function maxRefundable(order: PaymentOrder): number {
  // Requested/pending amounts have not been refunded. The refund API uses credited USD.
  const refunded = ['PARTIALLY_REFUNDED', 'REFUNDED'].includes(order.status) ? order.refund_amount || 0 : 0;
  return Math.max(0, Math.round((order.amount - refunded) * 100) / 100);
}
function isRefundPendingWarning(warning?: string): boolean {
  return /pending|处理中|待确认/i.test(warning || '');
}
watch([refundAmount, refundReason, refundDeductBalance], () => {
  refundRequireForce.value = false;
  refundForceConfirmed.value = false;
  refundWarning.value = '';
}, { flush: 'sync' });

async function loadOrders() {
  const context = refundGuard.capture();
  if (!context.current()) return;
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await adminPaymentAPI.getOrders({
      page: dataPage.value,
      page_size: 20,
      status: orderStatus.value || undefined,
      payment_type: orderPayType.value || undefined,
      keyword: orderSearch.value || undefined
    });
    const data = res.data;
    if (version !== loadVersion || !context.current()) return;
    orders.value = data?.items || [];
    ordersTotal.value = data?.total ?? orders.value.length;
  } catch (err) {
    if (version === loadVersion && context.current()) loadError.value = adminError(err, '订单列表加载失败，请重试。');
  } finally {
    if (version === loadVersion && context.current()) loading.value = false;
  }
}

function openOrderDetail(ord: PaymentOrder) {
  if (isProcessingOrder.value || showRefundModal.value) return;
  selectedOrder.value = ord;
  showOrderDetailModal.value = true;
}

function openRefundModal(ord: PaymentOrder) {
  if (isProcessingOrder.value || !refundActionLabels[ord.status]) return;
  selectedOrder.value = ord;
  refundAmount.value = ord.status === 'REFUND_REQUESTED' && ord.refund_amount > 0
    ? Math.min(ord.refund_amount, maxRefundable(ord)) : maxRefundable(ord);
  refundReason.value = ord.refund_request_reason || ord.refund_reason || '';
  refundDeductBalance.value = true;
  refundRequireForce.value = false;
  refundForceConfirmed.value = false;
  refundWarning.value = '';
  showRefundModal.value = true;
}

async function handleConfirmRefund() {
  if (!showRefundModal.value || !selectedOrder.value || isProcessingOrder.value || refundNeedsReview.value) return;
  if (!refundActionLabels[selectedOrder.value.status]) return;
  if (!Number.isFinite(refundAmount.value) || refundAmount.value <= 0 || refundAmount.value > maxRefundable(selectedOrder.value)) { refundWarning.value = '退款金额须大于 0 且不超过剩余可退额度'; return; }
  if (refundRequireForce.value && !refundForceConfirmed.value) return;
  const context = refundGuard.capture(), order = selectedOrder.value;
  if (!context.current()) { refundGuard.refresh(); return; }
  isProcessingOrder.value = true;
  refundWarning.value = '';
  const payload = { amount: refundAmount.value, reason: refundReason.value.trim() || '管理员退款',
    deduct_balance: refundDeductBalance.value, force: refundRequireForce.value && refundForceConfirmed.value };
  try {
    const outcome = await refundGuard.journal.run(context, `refund:${order.id}`, 'refund', [order.id],
      () => adminPaymentAPI.refundOrder(order.id, payload), res => res.data?.success === true || res.data?.require_force === true ||
        (res.data?.success === false && !!res.data.warning && !isRefundPendingWarning(res.data.warning)));
    if (!context.current()) return;
    const res = outcome.value;
    if (outcome.kind === 'blocked' || !res) {
      refundWarning.value = outcome.message || (outcome.kind === 'rejected' ? adminError(outcome.error, '退款被拒绝，请核对订单后重试。') : '退款结果尚未确认。关闭或刷新不会解除保护，请核对操作结果。');
      return;
    }
    if (outcome.kind === 'confirmed' && res.data?.success) {
      showToast('退款处理成功');
      showRefundModal.value = false;
      await loadOrders();
    } else if (outcome.kind === 'confirmed' && res.data?.require_force) {
      refundRequireForce.value = true;
      refundForceConfirmed.value = false;
      refundWarning.value = res.data.warning || '无法完成正常扣回，请确认是否强制退款。';
    } else if (isRefundPendingWarning(res.data?.warning)) {
      showToast('退款处理中，请在订单列表查询退款状态');
      showRefundModal.value = false;
      await loadOrders();
    } else {
      refundWarning.value = res.data?.warning || '退款失败，请核对订单后重试。';
      await loadOrders();
    }
  } finally {
    if (context.current()) isProcessingOrder.value = false;
  }
}

async function handleQueryRefund(ord: PaymentOrder) {
  if (ord.status !== 'REFUND_PENDING' || refundQueryingIds.value.has(ord.id)) return;
  const context = refundGuard.capture();
  if (!context.current()) { refundGuard.refresh(); return; }
  refundQueryingIds.value.add(ord.id);
  try {
    const resume = pendingRefunds.value.find(entry => entry.scope === `refund:${ord.id}`);
    const outcome = await refundGuard.journal.run(context, `refund:${ord.id}`, 'refund-query', [ord.id],
      () => adminPaymentAPI.queryRefund(ord.id), res => res.data?.success === true, { resume });
    if (!context.current()) return;
    const res = outcome.value;
    if (!res) { showToast(outcome.message || adminError(outcome.error, '查询结果尚未确认，请稍后再核对。')); return; }
    showToast(res.data?.success ? '退款处理成功' : isRefundPendingWarning(res.data?.warning)
      ? '退款仍在处理中，请稍后再次查询' : res.data?.warning || '退款状态查询失败');
    await loadOrders();
  } finally {
    if (context.current()) refundQueryingIds.value.delete(ord.id);
  }
}
function askReviewRefund(marker: PaymentWriteMarker) {
  if (isProcessingOrder.value || reviewingRefund.value) return;
  refundReview.value = { ...marker };
}
async function confirmReviewRefund() {
  if (!refundReview.value || reviewingRefund.value) return;
  const context = refundGuard.capture(), marker = refundReview.value;
  if (!context.current()) { refundGuard.refresh(); return; }
  reviewingRefund.value = true;
  try {
    const result = await refundGuard.journal.resolve(context, marker);
    if (!context.current()) return;
    if (result.kind === 'confirmed') {
      refundReview.value = null; showRefundModal.value = false;
      refundForceConfirmed.value = false; refundRequireForce.value = false;
      showToast('已记录核对确认，请按最新订单状态决定下一步。');
      await loadOrders();
    } else showToast(result.message || '保护记录已变化，请重新核对。');
  } finally { if (context.current()) reviewingRefund.value = false; }
}

function promptCancelOrder(ord: PaymentOrder) {
  alertSheet.value = {
    show: true,
    title: '确定要取消此订单吗？',
    message: `将取消订单 #${ord.id}（金额 $${(ord.amount || 0).toFixed(2)}）。此操作无法撤销。`,
    confirmText: '取消订单',
    danger: true,
    loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await adminPaymentAPI.cancelOrder(ord.id);
        showToast('订单已取消');
        alertSheet.value.show = false;
        await loadOrders();
      } catch (err: any) {
        showToast(err.response?.data?.detail || '取消订单失败');
      } finally {
        alertSheet.value.loading = false;
      }
    }
  };
}

async function handleRetryRecharge(ord: PaymentOrder) {
  try {
    await adminPaymentAPI.retryRecharge(ord.id);
    showToast('已重新触发充值入账');
    await loadOrders();
  } catch (err: any) {
    showToast(err.response?.data?.detail || '重试充值失败');
  }
}

// ==================== Tab 2: Subscription Plans ====================
const plans = ref<AdminSubscriptionPlan[]>([]);
const groups = ref<AdminGroup[]>([]);
const showPlanModal = ref(false);
const isEditingPlan = ref(false);
const editingPlanId = ref<number | null>(null);
const isSavingPlan = ref(false);

const planForm = reactive({
  name: '',
  description: '',
  group_id: 0,
  price: 10,
  original_price: 0,
  currency: 'USD',
  validity_days: 30,
  validity_unit: 'days',
  featuresText: '',
  sort_order: 0,
  for_sale: true
});

async function loadPlans() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const [plansRes, groupsRes] = await Promise.all([
      adminPaymentAPI.getPlans(),
      groupsAdminAPI.getAll()
    ]);
    if (version !== loadVersion) return;
    plans.value = plansRes.data || [];
    groups.value = groupsRes || [];
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '订阅计划加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function openCreatePlanModal() {
  isEditingPlan.value = false;
  editingPlanId.value = null;
  planForm.name = '';
  planForm.description = '';
  planForm.group_id = groups.value[0]?.id || 0;
  planForm.price = 10;
  planForm.original_price = 0;
  planForm.currency = 'USD';
  planForm.validity_days = 30;
  planForm.validity_unit = 'days';
  planForm.featuresText = '';
  planForm.sort_order = 0;
  planForm.for_sale = true;
  showPlanModal.value = true;
}

function openEditPlanModal(p: AdminSubscriptionPlan) {
  isEditingPlan.value = true;
  editingPlanId.value = p.id;
  planForm.name = p.name;
  planForm.description = p.description || '';
  planForm.group_id = p.group_id;
  planForm.price = p.price;
  planForm.original_price = p.original_price || 0;
  planForm.currency = p.currency || 'USD';
  planForm.validity_days = p.validity_days;
  planForm.validity_unit = p.validity_unit || 'days';
  planForm.featuresText = p.features || '';
  planForm.sort_order = p.sort_order || 0;
  planForm.for_sale = p.for_sale !== false;
  showPlanModal.value = true;
}

async function submitSavePlan() {
  if (isSavingPlan.value) return;
  if (!planForm.name || !planForm.group_id) {
    showToast('请填写计划名称并选择对应分组');
    return;
  }
  const features = planForm.featuresText
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean).join('\n');

  const payload: CreateAdminPlanRequest = {
    name: planForm.name,
    description: planForm.description,
    group_id: Number(planForm.group_id),
    price: Number(planForm.price),
    original_price: planForm.original_price ? Number(planForm.original_price) : undefined,
    currency: planForm.currency.toUpperCase() || 'USD',
    validity_days: Number(planForm.validity_days),
    validity_unit: planForm.validity_unit,
    features,
    sort_order: Number(planForm.sort_order),
    for_sale: planForm.for_sale
  };

  isSavingPlan.value = true;
  try {
    if (isEditingPlan.value && editingPlanId.value) {
      await adminPaymentAPI.updatePlan(editingPlanId.value, payload);
      showToast('计划更新成功');
    } else {
      await adminPaymentAPI.createPlan(payload);
      showToast('计划创建成功');
    }
    showPlanModal.value = false;
    await loadPlans();
  } catch (err) {
    showToast(adminError(err, '保存计划失败'));
  } finally {
    isSavingPlan.value = false;
  }
}

function promptDeletePlan(p: AdminSubscriptionPlan) {
  alertSheet.value = {
    show: true,
    title: '确定要永久删除此订阅计划吗？',
    message: `将删除计划 “${p.name}”。已订购该计划的用户不受影响，但新用户将无法选购此计划。`,
    confirmText: '删除计划',
    danger: true,
    loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await adminPaymentAPI.deletePlan(p.id);
        showToast('计划已删除');
        alertSheet.value.show = false;
        await loadPlans();
      } catch (err: any) {
        showToast(err.response?.data?.detail || '删除计划失败');
      } finally {
        alertSheet.value.loading = false;
      }
    }
  };
}

async function handleTogglePlanSale(p: AdminSubscriptionPlan) {
  try {
    await adminPaymentAPI.updatePlan(p.id, { for_sale: !p.for_sale });
    p.for_sale = !p.for_sale;
    showToast(p.for_sale ? '计划已上架发售' : '计划已下架');
  } catch (err: any) {
    showToast(err.response?.data?.detail || '更改在售状态失败');
  }
}

function getGroupName(groupId: number): string {
  const g = groups.value.find(item => item.id === groupId);
  return g ? g.name : `#${groupId}`;
}

// ==================== Tab 3: Payment Dashboard ====================
const dashboardStats = ref<DashboardStats | null>(null);
const dashboardDays = ref<number>(30);

async function loadDashboard() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await adminPaymentAPI.getDashboard(dashboardDays.value);
    if (version !== loadVersion) return;
    dashboardStats.value = res.data;
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '财务概览加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function formatCurrencyAmount(amounts?: Record<string, number>): string {
  if (!amounts || Object.keys(amounts).length === 0) return '$0.00';
  return Object.entries(amounts)
    .map(([curr, val]) => `${curr} $${(val || 0).toFixed(2)}`)
    .join(' / ');
}

// ==================== Tab 4: Redeem Codes ====================
const redeemCodes = ref<RedeemCode[]>([]);
const redeemTotal = ref(0);
const redeemSearch = ref('');
const redeemType = ref('');
const redeemStatus = ref('');
const showGenerateModal = ref(false);
const isGenerating = ref(false);
const generateError = ref('');
const redeemGroups = ref<AdminGroup[]>([]);
const redeemGroupsLoading = ref(false);
const redeemGroupsError = ref('');
const subscriptionGroups = computed(() => redeemGroups.value.filter(group => group.subscription_type === 'subscription'));

const generateForm = ref({
  count: 5,
  type: 'balance' as RedeemCodeType,
  value: 10,
  group_id: 0,
  validity_days: 30,
  expires_in_days: '' as number | ''
});

async function loadRedeemGroups() {
  if (redeemGroupsLoading.value) return;
  redeemGroupsLoading.value = true;
  redeemGroupsError.value = '';
  try { redeemGroups.value = await groupsAdminAPI.getAll(); }
  catch (err) { redeemGroups.value = []; redeemGroupsError.value = adminError(err, '订阅分组加载失败，请重试。'); }
  finally { redeemGroupsLoading.value = false; }
}
function openGenerateModal() {
  generateError.value = '';
  showGenerateModal.value = true;
  void loadRedeemGroups();
}

async function loadRedeem() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await redeemAdminAPI.list(dataPage.value, 20, {
      type: (redeemType.value as any) || undefined,
      status: (redeemStatus.value as any) || undefined,
      search: redeemSearch.value || undefined
    });
    if (version !== loadVersion) return;
    redeemCodes.value = res?.items || [];
    redeemTotal.value = res?.total ?? redeemCodes.value.length;
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '兑换码加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function submitGenerate() {
  if (isGenerating.value) return;
  const form = generateForm.value;
  generateError.value = '';
  if (!Number.isInteger(form.count) || form.count < 1 || form.count > 100) { generateError.value = '生成数量须为 1–100 的整数。'; return; }
  if (form.type === 'subscription') {
    if (redeemGroupsLoading.value || redeemGroupsError.value || !subscriptionGroups.value.some(group => group.id === form.group_id)) { generateError.value = '请选择已成功加载的订阅分组。'; return; }
    if (!Number.isInteger(form.validity_days) || form.validity_days < 1 || form.validity_days > 365) { generateError.value = '订阅时长须为 1–365 天的整数。'; return; }
  } else if (form.type !== 'invitation' && (!Number.isFinite(form.value) || form.value === 0 || (form.type === 'concurrency' && !Number.isInteger(form.value)))) {
    generateError.value = '面值须为非零数字，并发数须为整数。'; return;
  }
  if (form.expires_in_days !== '' && (!Number.isInteger(form.expires_in_days) || form.expires_in_days < 1 || form.expires_in_days > 3650)) { generateError.value = '兑换期限须为 1–3650 天的整数，留空为永久有效。'; return; }
  isGenerating.value = true;
  try {
    await redeemAdminAPI.generate(
      form.count,
      form.type,
      form.type === 'invitation' || form.type === 'subscription' ? 0 : form.value,
      form.type === 'subscription' ? form.group_id : undefined,
      form.type === 'subscription' ? form.validity_days : undefined,
      form.expires_in_days === '' ? undefined : form.expires_in_days
    );
    showGenerateModal.value = false;
    showToast('兑换码生成成功');
    await loadRedeem();
  } catch (err) {
    generateError.value = adminError(err, '生成失败');
  } finally {
    isGenerating.value = false;
  }
}

function promptDeleteRedeem(code: RedeemCode) {
  alertSheet.value = {
    show: true, title: '删除兑换码？', message: `兑换码 ${code.code} 删除后无法恢复。`,
    confirmText: '删除兑换码', danger: true, loading: false,
    action: async () => {
      alertSheet.value.loading = true;
      try {
        await redeemAdminAPI.deleteCode(code.id);
        alertSheet.value.show = false;
        await loadRedeem();
        showToast('兑换码已删除');
      } catch (err) { showToast(adminError(err, '删除失败，请重试。')); }
      finally { alertSheet.value.loading = false; }
    }
  };
}

const exportingRedeem = ref(false);
async function exportCSV() {
  if (exportingRedeem.value) return;
  exportingRedeem.value = true;
  try {
    const blob = await redeemAdminAPI.exportCodes({
      type: (redeemType.value as any) || undefined,
      status: (redeemStatus.value as any) || undefined,
      search: redeemSearch.value || undefined
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sub2-redeem-codes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('已导出当前筛选的全部兑换码');
  } catch (err) { showToast(adminError(err, '导出失败，请重试。')); }
  finally { exportingRedeem.value = false; }
}

// ==================== Tab 5: Promo Codes ====================
const promoCodes = ref<PromoCode[]>([]);
const selectedPromo = ref<PromoCode|null>(null);
const promoTotal = ref(0);
const promoSearch = ref('');
const promoStatus = ref('');
const showPromoModal = ref(false);

const promoForm = ref({
  code: '',
  bonus_amount: 5,
  max_uses: 100,
  expires_in_days: 30
});

async function loadPromo() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    const res = await promoAdminAPI.list(dataPage.value, 20, {
      status: promoStatus.value || undefined,
      search: promoSearch.value || undefined
    });
    if (version !== loadVersion) return;
    promoCodes.value = res?.items || [];
    promoTotal.value = res?.total ?? promoCodes.value.length;
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '优惠码加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function submitCreatePromo() {
  if (!promoForm.value.code) return;
  try {
    const expireTimestamp = promoForm.value.expires_in_days
      ? Math.floor((Date.now() + promoForm.value.expires_in_days * 86400000) / 1000)
      : null;
    await promoAdminAPI.create({
      code: promoForm.value.code,
      bonus_amount: promoForm.value.bonus_amount,
      max_uses: promoForm.value.max_uses,
      expires_at: expireTimestamp
    });
    showPromoModal.value = false;
    showToast('优惠码创建成功');
    await loadPromo();
  } catch (err: any) {
    showToast(err.response?.data?.detail || '创建优惠码失败');
  }
}

// ==================== Tab 6: Affiliates ====================
type AffiliateSubTab = 'invites' | 'rebates' | 'transfers' | 'users';
const affSubTab = ref<AffiliateSubTab>(props.win?.customData?.subtab || 'invites');
const affSearch = ref('');
const affInvites = ref<AffiliateInviteRecord[]>([]);
const affRebates = ref<AffiliateRebateRecord[]>([]);
const affTransfers = ref<AffiliateTransferRecord[]>([]);
const affUsers = ref<AffiliateAdminEntry[]>([]);
const affTotal = ref(0);

// User Overview Modal & Settings Modal
const selectedAffOverview = ref<AffiliateUserOverview | null>(null);
const showAffOverviewModal = ref(false);
const isOverviewLoading = ref(false);

const showAffSettingsModal = ref(false);
const affSettingUser = ref<AffiliateAdminEntry | null>(null);
const affCustomCode = ref('');
const affCustomRate = ref<number | null>(null);
const affClearRate = ref(false);

async function loadAffiliateData() {
  const version = ++loadVersion;
  loading.value = true;
  loadError.value = '';
  try {
    if (affSubTab.value === 'invites') {
      const res = await affiliatesAPI.listInviteRecords({ search: affSearch.value, page: dataPage.value, page_size: 20 });
      if (version !== loadVersion) return;
      affInvites.value = res.items || [];
      affTotal.value = res.total;
    } else if (affSubTab.value === 'rebates') {
      const res = await affiliatesAPI.listRebateRecords({ search: affSearch.value, page: dataPage.value, page_size: 20 });
      if (version !== loadVersion) return;
      affRebates.value = res.items || [];
      affTotal.value = res.total;
    } else if (affSubTab.value === 'transfers') {
      const res = await affiliatesAPI.listTransferRecords({ search: affSearch.value, page: dataPage.value, page_size: 20 });
      if (version !== loadVersion) return;
      affTransfers.value = res.items || [];
      affTotal.value = res.total;
    } else if (affSubTab.value === 'users') {
      const res = await affiliatesAPI.listUsers({ search: affSearch.value, page: dataPage.value, page_size: 20 });
      if (version !== loadVersion) return;
      affUsers.value = res.items || [];
      affTotal.value = res.total;
    }
  } catch (err) {
    if (version === loadVersion) loadError.value = adminError(err, '返利记录加载失败，请重试。');
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function viewUserAffOverview(userId: number) {
  isOverviewLoading.value = true;
  showAffOverviewModal.value = true;
  try {
    selectedAffOverview.value = await affiliatesAPI.getUserOverview(userId);
  } catch (err: any) {
    showToast(err.response?.data?.detail || '加载用户返利概览失败');
  } finally {
    isOverviewLoading.value = false;
  }
}

function openAffSettings(u: AffiliateAdminEntry) {
  affSettingUser.value = u;
  affCustomCode.value = u.aff_code;
  affCustomRate.value = u.aff_rebate_rate_percent ?? null;
  affClearRate.value = false;
  showAffSettingsModal.value = true;
}

async function submitSaveAffSettings() {
  if (!affSettingUser.value) return;
  try {
    await affiliatesAPI.updateUserSettings(affSettingUser.value.user_id, {
      aff_code: affCustomCode.value.trim() || undefined,
      aff_rebate_rate_percent: affClearRate.value ? null : affCustomRate.value,
      clear_rebate_rate: affClearRate.value
    });
    showToast('专属邀请设置保存成功');
    showAffSettingsModal.value = false;
    await loadAffiliateData();
  } catch (err: any) {
    showToast(err.response?.data?.detail || '保存失败');
  }
}

// ==================== Tab Switcher & Lifecycle ====================
function resetRefundSession() {
  loadVersion++; orders.value = []; ordersTotal.value = 0; selectedOrder.value = null;
  showRefundModal.value = false; showOrderDetailModal.value = false; isProcessingOrder.value = false;
  refundForceConfirmed.value = false; refundRequireForce.value = false; refundWarning.value = '';
  refundReview.value = null; reviewingRefund.value = false; refundQueryingIds.value = new Set();
  toastMsg.value = null; loading.value = false;
}
watch([() => auth.user?.id, () => auth.sessionRevision, () => refundGuard.sessionIdentity.value, () => refundGuard.sessionValid.value], () => {
  resetRefundSession();
  if (auth.isAdmin && refundGuard.sessionValid.value && activeTab.value === 'orders') void loadOrders();
}, { flush: 'sync' });
onBeforeUnmount(() => { loadVersion++; });

function handleTabChange(tab: CommerceTab) {
  if (activeTab.value !== tab) dataPage.value = 1;
  activeTab.value = tab;
  if (tab === 'orders') loadOrders();
  else if (tab === 'plans') loadPlans();
  else if (tab === 'dashboard') loadDashboard();
  else if (tab === 'redeem') loadRedeem();
  else if (tab === 'promo') loadPromo();
  else if (tab === 'affiliates') loadAffiliateData();
}

function formatDateTime(dtStr?: string | null) {
  if (!dtStr) return '-';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

onMounted(() => {
  handleTabChange(activeTab.value);
});
watch(() => props.win?.customData, data => {
  if (!data || !['orders', 'plans', 'dashboard', 'redeem', 'promo', 'affiliates'].includes(data.tab)) return;
  if (['invites', 'rebates', 'transfers', 'users'].includes(data.subtab)) affSubTab.value = data.subtab;
  handleTabChange(data.tab);
});
</script>

<template>
  <div class="admin-polish commerce-app flex flex-col h-full select-none overflow-hidden">
    <!-- Top Bar -->
    <div class="admin-toolbar">
      <!-- Title & Segmented Control -->
      <div class="flex flex-wrap items-center gap-3">
        <div class="flex items-center gap-3">
          <img :src="getAppIcon('commerce')" alt="Commerce" class="w-8 h-8 object-contain drop-shadow-sm" />
          <div>
            <h1 class="text-[15px] font-bold text-[var(--text-primary)] leading-tight">商业与订单</h1>
            <p class="text-[10.5px] text-[var(--text-tertiary)] mt-0.5">订单处理、订阅计划、财务概览与返利推广</p>
          </div>
        </div>

        <div class="admin-tabs">
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'orders' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('orders')"
          >
            订单管理
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'plans' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('plans')"
          >
            订阅计划
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'dashboard' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('dashboard')"
          >
            财务概览
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'redeem' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('redeem')"
          >
            兑换码
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'promo' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('promo')"
          >
            优惠码
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="activeTab === 'affiliates' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'"
            @click="handleTabChange('affiliates')"
          >
            推广返利
          </button>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-2">
        <button
          class="p-1.5 rounded-[7px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-[var(--text-secondary)] transition-colors"
          :class="loading ? 'animate-spin' : ''"
          title="刷新"
          @click="handleTabChange(activeTab)"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>

        <template v-if="activeTab === 'plans'">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0062cc] text-white shadow-sm transition-all"
            @click="openCreatePlanModal"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>创建计划</span>
          </button>
        </template>

        <template v-if="activeTab === 'redeem'">
          <button
            class="px-3 py-1.5 rounded-[7px] border border-[var(--border-color)] hover:bg-black/5 dark:hover:bg-white/10 text-xs font-medium text-[var(--text-primary)] transition-colors"
            :disabled="exportingRedeem" @click="exportCSV"
          >
            导出本页 CSV
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-all"
            @click="openGenerateModal"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>生成兑换码</span>
          </button>
        </template>

        <template v-if="activeTab === 'promo'">
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-xs font-semibold bg-[#007aff] hover:bg-[#0071e3] text-white shadow-sm transition-all"
            @click="showPromoModal = true"
          >
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>创建优惠码</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Toast Notification -->
    <div v-if="toastMsg" class="absolute top-14 right-6 z-50 px-3.5 py-2 rounded-lg bg-neutral-900/90 text-white text-xs shadow-lg backdrop-blur-md border border-white/10 animate-fade-in">
      {{ toastMsg }}
    </div>

    <!-- Filter Bar -->
    <div class="admin-filters">
      <!-- 1. Orders Filter -->
      <div v-if="activeTab === 'orders'" class="flex items-center gap-2.5">
        <div class="relative w-56">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="orderSearch"
            type="text"
            placeholder="搜索订单编号/用户/外部号..."
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
            @keyup.enter="dataPage = 1; loadOrders()"
          />
        </div>
        <select
          v-model="orderStatus"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="dataPage = 1; loadOrders()"
        >
          <option value="">全部状态</option>
          <option value="PAID">已支付 (PAID)</option>
          <option value="COMPLETED">已完成 (COMPLETED)</option>
          <option value="PENDING">待支付 (PENDING)</option>
          <option value="REFUNDED">已退款 (REFUNDED)</option>
          <option value="REFUND_REQUESTED">待审核退款</option>
          <option value="REFUND_FAILED">退款失败</option>
          <option value="REFUND_PENDING">退款待确认</option>
          <option value="PARTIALLY_REFUNDED">部分退款</option>
          <option value="CANCELLED">已取消 (CANCELLED)</option>
          <option value="FAILED">已失败 (FAILED)</option>
        </select>
        <select
          v-model="orderPayType"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="dataPage = 1; loadOrders()"
        >
          <option value="">全部支付方式</option>
          <option value="alipay">支付宝</option>
          <option value="wxpay">微信支付</option>
          <option value="stripe">Stripe</option>
          <option value="easypay">易支付</option>
          <option value="airwallex">Airwallex</option>
        </select>
      </div>

      <!-- 2. Plans Filter -->
      <div v-else-if="activeTab === 'plans'" class="flex items-center gap-2.5">
        <span class="text-xs text-[var(--text-secondary)]">共配置 {{ plans.length }} 个订阅套餐计划</span>
      </div>

      <!-- 3. Dashboard Filter -->
      <div v-else-if="activeTab === 'dashboard'" class="flex items-center gap-2.5">
        <span class="text-xs text-[var(--text-secondary)]">统计周期：</span>
        <div class="flex items-center p-0.5 rounded-lg bg-black/5 dark:bg-white/10 text-xs">
          <button
            v-for="d in [7, 30, 90]"
            :key="d"
            class="px-2.5 py-1 rounded-[6px] transition-all"
            :class="dashboardDays === d ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold' : 'text-[var(--text-tertiary)]'"
            @click="dashboardDays = d; loadDashboard()"
          >
            最近 {{ d }} 天
          </button>
        </div>
      </div>

      <!-- 4. Redeem Filter -->
      <div v-else-if="activeTab === 'redeem'" class="flex items-center gap-2.5">
        <div class="relative w-56">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="redeemSearch"
            type="text"
            placeholder="搜索兑换码或邮箱..."
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
            @keyup.enter="dataPage = 1; loadRedeem()"
          />
        </div>
        <select
          v-model="redeemType"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="dataPage = 1; loadRedeem()"
        >
          <option value="">全部类型</option>
          <option value="balance">余额</option>
          <option value="concurrency">并发数</option>
          <option value="subscription">订阅</option>
          <option value="invitation">邀请码</option>
        </select>
        <select
          v-model="redeemStatus"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="dataPage = 1; loadRedeem()"
        >
          <option value="">全部状态</option>
          <option value="unused">未使用</option>
          <option value="used">已使用</option>
          <option value="expired">已过期</option>
          <option value="disabled">已禁用</option>
        </select>
      </div>

      <!-- 5. Promo Filter -->
      <div v-else-if="activeTab === 'promo'" class="flex items-center gap-2.5">
        <div class="relative w-56">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="promoSearch"
            type="text"
            placeholder="搜索优惠码..."
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
            @keyup.enter="dataPage = 1; loadPromo()"
          />
        </div>
        <select
          v-model="promoStatus"
          class="px-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] focus:outline-none"
          @change="dataPage = 1; loadPromo()"
        >
          <option value="">全部状态</option>
          <option value="active">有效</option>
          <option value="disabled">禁用</option>
        </select>
      </div>

      <!-- 6. Affiliates Sub-tabs & Filter -->
      <div v-else-if="activeTab === 'affiliates'" class="flex flex-wrap items-center justify-between gap-3 w-full">
        <!-- Sub-segmented control -->
        <div class="flex items-center p-0.5 rounded-lg bg-black/5 dark:bg-white/10 text-xs">
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="affSubTab === 'invites' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold' : 'text-[var(--text-tertiary)]'"
            @click="affSubTab = 'invites'; dataPage = 1; loadAffiliateData()"
          >
            邀请记录
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="affSubTab === 'rebates' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold' : 'text-[var(--text-tertiary)]'"
            @click="affSubTab = 'rebates'; dataPage = 1; loadAffiliateData()"
          >
            返利明细
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="affSubTab === 'transfers' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold' : 'text-[var(--text-tertiary)]'"
            @click="affSubTab = 'transfers'; dataPage = 1; loadAffiliateData()"
          >
            划转记录
          </button>
          <button
            class="px-3 py-1 rounded-[6px] transition-all"
            :class="affSubTab === 'users' ? 'bg-white dark:bg-[#3a3a3c] text-[var(--text-primary)] shadow-sm font-semibold' : 'text-[var(--text-tertiary)]'"
            @click="affSubTab = 'users'; dataPage = 1; loadAffiliateData()"
          >
            用户费率与代码
          </button>
        </div>

        <div class="relative w-56">
          <svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="affSearch"
            type="text"
            placeholder="搜索邀请人/受邀人..."
            class="w-full pl-8 pr-2.5 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[12px] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] focus:outline-none"
            @keyup.enter="dataPage = 1; loadAffiliateData()"
          />
        </div>
      </div>
    </div>

    <!-- Table Container -->
    <AdminFeedback :loading="loading" :error="loadError" @retry="handleTabChange(activeTab)" />
    <div v-if="activeTab === 'orders'" class="px-4 space-y-2 text-xs">
      <p v-if="refundGuard.storageError.value" role="alert" class="admin-form-error">{{ refundGuard.storageError.value }}</p>
      <div v-for="marker in pendingRefunds" :key="marker.id" role="status" class="p-3 border border-[var(--border-color)] rounded-lg">
        <p>订单 #{{ marker.targets[0] }} 的退款操作仍需核对（{{ formatDateTime(new Date(marker.startedAt).toISOString()) }}）。关闭窗口、刷新或重新读取列表不会解除保护。</p>
        <button type="button" :disabled="isProcessingOrder || reviewingRefund || refundQueryingIds.has(marker.targets[0]!)" class="mt-2 text-[var(--accent)]" @click="askReviewRefund(marker)">核对退款结果</button>
      </div>
    </div>
    <div class="admin-table-scroll">
      <!-- ==================== Tab 1: Orders Table ==================== -->
      <div v-if="activeTab === 'orders'" class="h-full">
        <div v-if="!loading && !loadError && orders.length === 0" class="admin-state flex flex-col items-center justify-center h-full">
          <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-400">
            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">暂无订单数据</h3>
          <p class="text-xs text-[var(--text-tertiary)]">当前暂无匹配的订单记录</p>
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">订单 ID</th>
              <th class="px-4 py-2.5">订单编号 / 外部号</th>
              <th class="px-4 py-2.5">用户</th>
              <th class="px-3 py-2.5">类型</th>
              <th class="px-3 py-2.5">金额</th>
              <th class="px-3 py-2.5">实付</th>
              <th class="px-3 py-2.5">支付方式</th>
              <th class="px-3 py-2.5">状态</th>
              <th class="px-4 py-2.5">创建时间</th>
              <th class="px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="o in orders" :key="o.id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3 font-mono text-xs">#{{ o.id }}</td>
              <td class="px-4 py-3 font-mono text-xs max-w-48 truncate" :title="o.out_trade_no">
                {{ o.out_trade_no || '-' }}
              </td>
              <td class="px-4 py-3">用户 #{{ o.user_id }}</td>
              <td class="px-3 py-3">
                <span class="px-2 py-0.5 rounded text-[10.5px] font-medium" :class="o.order_type === 'balance' ? 'bg-blue-500/10 text-blue-600' : 'bg-purple-500/10 text-purple-600'">
                  {{ o.order_type === 'balance' ? '余额充值' : '订阅计划' }}
                </span>
              </td>
              <td class="px-3 py-3 font-mono font-medium">${{ (o.amount || 0).toFixed(2) }}</td>
              <td class="px-3 py-3 font-mono font-semibold text-[#007aff]">${{ (o.pay_amount || 0).toFixed(2) }}</td>
              <td class="px-3 py-3 capitalize">{{ o.payment_type }}</td>
              <td class="px-3 py-3">
                <span
                  class="admin-status"
                  :data-tone="o.status === 'PAID' || o.status === 'COMPLETED' ? 'success' : o.status === 'PENDING' ? 'warning' : o.status === 'FAILED' ? 'danger' : 'neutral'"
                >
                  {{ ({ PAID: '已支付', COMPLETED: '已完成', PENDING: '待支付', REFUNDED: '已退款', CANCELLED: '已取消', FAILED: '失败', REFUND_REQUESTED: '待审核退款', REFUND_FAILED: '退款失败', REFUND_PENDING: '退款待确认', REFUNDING: '退款中', PARTIALLY_REFUNDED: '部分退款' } as Record<string, string>)[o.status] || o.status }}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(o.created_at) }}</td>
              <td class="px-5 py-3 text-right space-x-2">
                <button class="text-xs text-[#007aff] hover:underline" @click="openOrderDetail(o)">详情</button>
                <button
                  v-if="refundActionLabels[o.status]"
                  :disabled="isProcessingOrder"
                  class="text-xs text-purple-600 hover:underline"
                  @click="openRefundModal(o)"
                >
                  {{ refundActionLabels[o.status] }}
                </button>
                <button v-if="o.status === 'REFUND_PENDING'" :disabled="refundQueryingIds.has(o.id)" class="text-xs text-amber-600 hover:underline" @click="handleQueryRefund(o)">
                  {{ refundQueryingIds.has(o.id) ? '查询中…' : '查询退款' }}
                </button>
                <button
                  v-if="o.status === 'PENDING'"
                  class="text-xs text-amber-600 hover:underline"
                  @click="promptCancelOrder(o)"
                >
                  取消
                </button>
                <button
                  v-if="o.status === 'PAID'"
                  class="text-xs text-blue-600 hover:underline"
                  title="重新执行入账逻辑"
                  @click="handleRetryRecharge(o)"
                >
                  重入账
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ==================== Tab 2: Subscription Plans Table ==================== -->
      <div v-else-if="activeTab === 'plans'" class="h-full">
        <div v-if="!loading && !loadError && plans.length === 0" class="admin-state flex flex-col items-center justify-center h-full">
          <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-400">
            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">暂无订阅计划</h3>
          <p class="text-xs text-[var(--text-tertiary)]">点击右上角创建新的订阅套餐</p>
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">计划名称</th>
              <th class="px-4 py-2.5">绑定分组</th>
              <th class="px-4 py-2.5">售价 / 原价</th>
              <th class="px-3 py-2.5">有效期</th>
              <th class="px-3 py-2.5">排序</th>
              <th class="px-3 py-2.5">在售状态</th>
              <th class="px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="p in plans" :key="p.id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3">
                <div class="font-medium text-[var(--text-primary)]">{{ p.name }}</div>
                <div class="text-[11px] text-[var(--text-tertiary)] truncate max-w-xs">{{ p.description || '-' }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-600">
                  {{ getGroupName(p.group_id) }}
                </span>
              </td>
              <td class="px-4 py-3 font-mono">
                <span class="font-semibold text-[var(--text-primary)]">${{ (p.price || 0).toFixed(2) }}</span>
                <span class="text-[11px] text-[var(--text-tertiary)] ml-1">{{ p.currency || 'USD' }}</span>
                <span v-if="p.original_price" class="text-xs text-[var(--text-tertiary)] line-through ml-2">
                  ${{ p.original_price.toFixed(2) }}
                </span>
              </td>
              <td class="px-3 py-3">{{ p.validity_days }} {{ p.validity_unit === 'months' ? '个月' : '天' }}</td>
              <td class="px-3 py-3 font-mono text-xs">{{ p.sort_order || 0 }}</td>
              <td class="px-3 py-3">
                <button
                  type="button"
                  class="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out"
                  :class="p.for_sale ? 'bg-[#34c759]' : 'bg-black/20 dark:bg-white/20'"
                  @click="handleTogglePlanSale(p)"
                >
                  <span
                    class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                    :class="p.for_sale ? 'translate-x-4' : 'translate-x-0'"
                  />
                </button>
              </td>
              <td class="px-5 py-3 text-right space-x-2">
                <button class="text-xs text-[#007aff] hover:underline" @click="openEditPlanModal(p)">编辑</button>
                <button class="text-xs text-red-500 hover:underline" @click="promptDeletePlan(p)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ==================== Tab 3: Payment Dashboard View ==================== -->
      <div v-else-if="activeTab === 'dashboard'" class="p-6 space-y-6">
        <div v-if="!dashboardStats" class="flex flex-col items-center justify-center p-12 text-center text-xs text-[var(--text-tertiary)]">
          暂无统计数据
        </div>
        <template v-else>
          <!-- Metric Cards -->
          <div class="admin-responsive-metrics grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div class="admin-card p-4">
              <p class="text-[11px] text-[var(--text-tertiary)]">总交易营收</p>
              <p class="text-xl font-bold mt-1 text-[#007aff]">{{ formatCurrencyAmount(dashboardStats.total_amount) }}</p>
              <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">历史全周期总收入</p>
            </div>
            <div class="admin-card p-4">
              <p class="text-[11px] text-[var(--text-tertiary)]">今日营收</p>
              <p class="text-xl font-bold mt-1 text-emerald-600 dark:text-emerald-400">
                {{ formatCurrencyAmount(dashboardStats.today_amount) }}
              </p>
              <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">今日入账款项</p>
            </div>
            <div class="admin-card p-4">
              <p class="text-[11px] text-[var(--text-tertiary)]">总订单量</p>
              <p class="text-xl font-bold mt-1">{{ dashboardStats.total_count || 0 }} 笔</p>
              <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">累计订单记录</p>
            </div>
            <div class="admin-card p-4">
              <p class="text-[11px] text-[var(--text-tertiary)]">今日订单数</p>
              <p class="text-xl font-bold mt-1">{{ dashboardStats.today_count || 0 }} 笔</p>
              <p class="text-[10px] text-[var(--text-tertiary)] mt-0.5">今日交易发生量</p>
            </div>
          </div>

          <!-- Payment Methods Distribution & Top Users -->
          <div class="admin-responsive-grid grid grid-cols-1 lg:grid-cols-2 gap-5">
            <!-- Payment Methods -->
            <div class="admin-card p-5">
              <h3 class="text-xs font-semibold text-[var(--text-primary)] mb-3">支付渠道分布</h3>
              <div v-if="!dashboardStats.payment_methods || dashboardStats.payment_methods.length === 0" class="text-xs text-[var(--text-tertiary)] py-6 text-center">
                暂无渠道支付数据
              </div>
              <div v-else class="space-y-3">
                <div v-for="pm in dashboardStats.payment_methods" :key="pm.type" class="flex items-center justify-between text-xs">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-[#007aff]" />
                    <span class="font-medium capitalize">{{ pm.type }}</span>
                  </div>
                  <div class="text-right">
                    <span class="font-mono font-medium">{{ formatCurrencyAmount(pm.amount) }}</span>
                    <span class="text-[var(--text-tertiary)] ml-2">({{ pm.count }} 笔)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Top Users -->
            <div class="admin-card p-5">
              <h3 class="text-xs font-semibold text-[var(--text-primary)] mb-3">充值排行榜 Top Users</h3>
              <div v-if="!dashboardStats.top_users || Object.keys(dashboardStats.top_users).length === 0" class="text-xs text-[var(--text-tertiary)] py-6 text-center">
                暂无用户排行数据
              </div>
              <div v-else class="space-y-2 max-h-56 overflow-y-auto">
                <template v-for="(usersList, currency) in dashboardStats.top_users" :key="currency">
                  <div v-for="(u, idx) in usersList" :key="u.user_id" class="flex items-center justify-between text-xs py-1 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                    <div class="flex items-center gap-2.5">
                      <span class="w-5 h-5 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center font-bold text-[10px]">
                        {{ idx + 1 }}
                      </span>
                      <span class="font-mono text-[var(--text-secondary)]">{{ u.email || `用户 #${u.user_id}` }}</span>
                    </div>
                    <span class="font-mono font-semibold text-[#007aff]">{{ currency }} ${{ (u.amount || 0).toFixed(2) }}</span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- ==================== Tab 4: Redeem Codes Table ==================== -->
      <div v-else-if="activeTab === 'redeem'" class="h-full">
        <div v-if="!loading && !loadError && redeemCodes.length === 0" class="admin-state flex flex-col items-center justify-center h-full">
          <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-400">
            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            </svg>
          </div>
          <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">暂无兑换码</h3>
          <p class="text-xs text-[var(--text-tertiary)]">点击右上角生成新的兑换码</p>
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">兑换码</th>
              <th class="px-4 py-2.5">类型</th>
              <th class="px-3 py-2.5">面值</th>
              <th class="px-3 py-2.5">状态</th>
              <th class="px-4 py-2.5">使用者</th>
              <th class="px-4 py-2.5">使用时间</th>
              <th class="px-4 py-2.5">过期时间</th>
              <th class="px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="c in redeemCodes" :key="c.id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3 font-mono text-xs font-semibold">{{ c.code }}</td>
              <td class="px-4 py-3">{{ ({ balance: '余额', concurrency: '并发数', subscription: '订阅', invitation: '邀请码' })[c.type] }}</td>
              <td class="px-3 py-3 font-medium">
                <template v-if="c.type === 'subscription'">{{ c.group?.name || `分组 #${c.group_id}` }} · {{ c.validity_days || 30 }} 天</template>
                <template v-else-if="c.type === 'invitation'">邀请注册</template>
                <template v-else>{{ c.type === 'balance' ? '$' : '' }}{{ c.value }}</template>
              </td>
              <td class="px-3 py-3">
                <span class="px-2 py-0.5 rounded-full text-[10.5px] font-medium" :class="c.status === 'unused' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-gray-500/10 text-gray-500'">
                  {{ c.status === 'unused' ? '未使用' : c.status === 'used' ? '已使用' : '已过期' }}
                </span>
              </td>
              <td class="px-4 py-3">{{ c.used_by || '-' }}</td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(c.used_at) }}</td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(c.expires_at) }}</td>
              <td class="px-5 py-3 text-right">
                <button class="text-xs text-red-500 hover:underline" @click="promptDeleteRedeem(c)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ==================== Tab 5: Promo Codes Table ==================== -->
      <div v-else-if="activeTab === 'promo'" class="h-full">
        <div v-if="!loading && !loadError && promoCodes.length === 0" class="admin-state flex flex-col items-center justify-center h-full">
          <div class="w-14 h-14 rounded-2xl bg-gray-500/10 flex items-center justify-center mb-3 text-gray-400">
            <svg class="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="8" width="18" height="12" rx="2"/>
              <path d="M12 8V4M8 4h8"/>
            </svg>
          </div>
          <h3 class="text-[14px] font-semibold text-[var(--text-primary)] mb-1">暂无优惠码</h3>
          <p class="text-xs text-[var(--text-tertiary)]">点击右上角创建注册赠金优惠码</p>
        </div>

        <table v-else class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">优惠码</th>
              <th class="px-4 py-2.5">赠送金额</th>
              <th class="px-3 py-2.5">使用量</th>
              <th class="px-3 py-2.5">状态</th>
              <th class="px-4 py-2.5">过期时间</th>
              <th class="px-4 py-2.5">创建时间</th>
              <th class="px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="p in promoCodes" :key="p.id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3 font-mono text-xs font-semibold">{{ p.code }}</td>
              <td class="px-4 py-3 font-mono font-medium text-emerald-600">${{ p.bonus_amount }}</td>
              <td class="px-3 py-3">{{ p.used_count }} / {{ p.max_uses }}</td>
              <td class="px-3 py-3">
                <span class="px-2 py-0.5 rounded-full text-[10.5px] font-medium" :class="p.status === 'active' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'">
                  {{ p.status === 'active' ? '有效' : '禁用' }}
                </span>
              </td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(p.expires_at) }}</td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(p.created_at) }}</td>
              <td class="px-5 py-3 text-right">
                <button class="text-xs text-blue-500 hover:underline" @click="selectedPromo=p">详情与编辑</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ==================== Tab 6: Affiliates View ==================== -->
      <div v-else-if="activeTab === 'affiliates'" class="h-full">
        <!-- Sub-tab 1: Invites Table -->
        <table v-if="affSubTab === 'invites'" class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">邀请人</th>
              <th class="px-4 py-2.5">受邀注册人</th>
              <th class="px-4 py-2.5">所用邀请码</th>
              <th class="px-4 py-2.5 text-right">累计返利贡献</th>
              <th class="px-5 py-2.5">受邀注册时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="inv in affInvites" :key="inv.invitee_id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3">
                <button class="text-[#007aff] hover:underline text-left" @click="viewUserAffOverview(inv.inviter_id)">
                  {{ inv.inviter_email || `#${inv.inviter_id}` }}
                </button>
                <div class="text-[11px] text-[var(--text-tertiary)]">{{ inv.inviter_username }}</div>
              </td>
              <td class="px-4 py-3">
                <button class="text-[#007aff] hover:underline text-left" @click="viewUserAffOverview(inv.invitee_id)">
                  {{ inv.invitee_email || `#${inv.invitee_id}` }}
                </button>
                <div class="text-[11px] text-[var(--text-tertiary)]">{{ inv.invitee_username }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs font-semibold">{{ inv.aff_code }}</td>
              <td class="px-4 py-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                ${{ (inv.total_rebate || 0).toFixed(2) }}
              </td>
              <td class="px-5 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(inv.created_at) }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Sub-tab 2: Rebates Table -->
        <table v-else-if="affSubTab === 'rebates'" class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">关联订单</th>
              <th class="px-4 py-2.5">邀请人</th>
              <th class="px-4 py-2.5">消费受邀人</th>
              <th class="px-3 py-2.5">订单金额</th>
              <th class="px-3 py-2.5">实付金额</th>
              <th class="px-3 py-2.5 font-semibold text-[#007aff]">返利佣金</th>
              <th class="px-3 py-2.5">支付方式</th>
              <th class="px-4 py-2.5">返利时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="reb in affRebates" :key="reb.order_id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3 font-mono text-xs">#{{ reb.order_id }}</td>
              <td class="px-4 py-3 font-medium">{{ reb.inviter_email || `#${reb.inviter_id}` }}</td>
              <td class="px-4 py-3">{{ reb.invitee_email || `#${reb.invitee_id}` }}</td>
              <td class="px-3 py-3 font-mono">${{ (reb.order_amount || 0).toFixed(2) }}</td>
              <td class="px-3 py-3 font-mono">${{ (reb.pay_amount || 0).toFixed(2) }}</td>
              <td class="px-3 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">+${{ (reb.rebate_amount || 0).toFixed(2) }}</td>
              <td class="px-3 py-3 capitalize">{{ reb.payment_type }}</td>
              <td class="px-4 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(reb.created_at) }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Sub-tab 3: Transfers Table -->
        <table v-else-if="affSubTab === 'transfers'" class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">划转用户</th>
              <th class="px-4 py-2.5">划转佣金</th>
              <th class="px-4 py-2.5">划转后余额</th>
              <th class="px-4 py-2.5">划转后剩余返利</th>
              <th class="px-5 py-2.5">划转时间</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="tra in affTransfers" :key="tra.ledger_id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3 font-medium">{{ tra.user_email || `#${tra.user_id}` }}</td>
              <td class="px-4 py-3 font-mono font-bold text-emerald-600 dark:text-emerald-400">${{ (tra.amount || 0).toFixed(2) }}</td>
              <td class="px-4 py-3 font-mono">${{ (tra.balance_after || 0).toFixed(2) }}</td>
              <td class="px-4 py-3 font-mono text-[var(--text-tertiary)]">${{ (tra.available_quota_after || 0).toFixed(2) }}</td>
              <td class="px-5 py-3 font-mono text-xs text-[var(--text-tertiary)]">{{ formatDateTime(tra.created_at) }}</td>
            </tr>
          </tbody>
        </table>

        <!-- Sub-tab 4: Users Custom Affiliates Table -->
        <table v-else-if="affSubTab === 'users'" class="admin-table">
          <thead>
            <tr class="border-b border-[var(--border-color)] bg-black/[0.02] dark:bg-white/[0.02] text-[11.5px] font-semibold text-[var(--text-secondary)] whitespace-nowrap">
              <th class="px-5 py-2.5">用户</th>
              <th class="px-4 py-2.5">邀请码</th>
              <th class="px-4 py-2.5">定制专属代码</th>
              <th class="px-4 py-2.5">返利费率</th>
              <th class="px-3 py-2.5 text-center">已邀请人数</th>
              <th class="px-5 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border-color)] text-[12.5px] whitespace-nowrap">
            <tr v-for="u in affUsers" :key="u.user_id" class="hover:bg-black/[0.015] dark:hover:bg-white/[0.02]">
              <td class="px-5 py-3">
                <div class="font-medium text-[var(--text-primary)]">{{ u.email || `#${u.user_id}` }}</div>
                <div class="text-[11px] text-[var(--text-tertiary)]">{{ u.username }}</div>
              </td>
              <td class="px-4 py-3 font-mono text-xs font-semibold">{{ u.aff_code }}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded text-[10.5px] font-medium" :class="u.aff_code_custom ? 'bg-purple-500/10 text-purple-600' : 'bg-gray-500/10 text-gray-400'">
                  {{ u.aff_code_custom ? '专属定制' : '系统默认' }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span v-if="u.aff_rebate_rate_percent != null" class="font-semibold text-emerald-600">
                  {{ u.aff_rebate_rate_percent }}% (专享)
                </span>
                <span v-else class="text-[var(--text-tertiary)]">跟随系统全局设置</span>
              </td>
              <td class="px-3 py-3 text-center font-mono font-medium">{{ u.aff_count }}</td>
              <td class="px-5 py-3 text-right space-x-2">
                <button class="text-xs text-[#007aff] hover:underline" @click="viewUserAffOverview(u.user_id)">概览</button>
                <button class="text-xs text-emerald-600 hover:underline" @click="openAffSettings(u)">设置费率/代码</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pagination Footer -->
    <div class="admin-footer">
      <span>
        共 {{ activeTab === 'orders' ? ordersTotal : activeTab === 'plans' ? plans.length : activeTab === 'redeem' ? redeemTotal : activeTab === 'promo' ? promoTotal : affTotal }} 条结果
      </span>
      <div v-if="isPaginated" class="flex items-center gap-3">
        <button :disabled="loading || dataPage <= 1" @click="dataPage--; handleTabChange(activeTab)">上一页</button>
        <span>{{ dataPage }} / {{ totalPages }}</span>
        <button :disabled="loading || dataPage >= totalPages" @click="dataPage++; handleTabChange(activeTab)">下一页</button>
      </div>
    </div>

    <!-- ==================== Modals ==================== -->

    <!-- 1. Plan Edit & Create Modal -->
    <MacSheet v-if="showPlanModal" v-slot="{ close }" :show="true" :title="isEditingPlan ? '编辑订阅计划' : '创建订阅计划'" protect-changes :loading="isSavingPlan" @close="!isSavingPlan && (showPlanModal = false)">
        <p class="text-[11px] text-[var(--text-tertiary)] mb-4">配置供用户购买订阅的模型权限、额度与价格周期</p>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitSavePlan">
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">计划名称 *</label>
              <input v-model="planForm.name" type="text" required placeholder="如 Pro 团队月度订阅" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]" />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">对应分组 *</label>
              <select v-model="planForm.group_id" required class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]">
                <option v-for="g in groups" :key="g.id" :value="g.id">
                  {{ g.name }} (平台: {{ g.platform || '通用' }})
                </option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">套餐描述</label>
            <textarea v-model="planForm.description" rows="2" placeholder="计划简短描述与优势亮点..." class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]"></textarea>
          </div>

          <div class="grid grid-cols-3 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">售价 *</label>
              <input v-model.number="planForm.price" type="number" step="0.01" min="0" required class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">原价 (可划线展示)</label>
              <input v-model.number="planForm.original_price" type="number" step="0.01" min="0" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">计价币种</label>
              <input v-model="planForm.currency" type="text" maxlength="3" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] uppercase font-mono" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">有效时长 *</label>
              <input v-model.number="planForm.validity_days" type="number" min="1" required class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
            </div>
            <div>
              <label class="block text-[var(--text-secondary)] font-medium mb-1">时长单位</label>
              <select v-model="planForm.validity_unit" class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]">
                <option value="days">天 (Days)</option>
                <option value="months">月 (Months)</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">特性亮点 (每行一条)</label>
            <textarea v-model="planForm.featuresText" rows="3" placeholder="支持 Claude 3.5 Sonnet 模型&#10;每日 1000 次调用额度&#10;专享优先路由接入" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-[11px]"></textarea>
          </div>

          <div class="flex items-center justify-between pt-2">
            <div class="flex items-center gap-2">
              <label class="text-[var(--text-secondary)] font-medium">排序号 (越小越靠前)</label>
              <input v-model.number="planForm.sort_order" type="number" class="w-16 px-2 py-1 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono text-center" />
            </div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="planForm.for_sale" type="checkbox" class="rounded text-[#007aff]" />
              <span class="font-medium text-[var(--text-primary)]">立即在售</span>
            </label>
          </div>

          <div class="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[var(--border-color)]">
            <button type="button" :disabled="isSavingPlan" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="close">取消</button>
            <button type="submit" :disabled="isSavingPlan" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] text-white font-medium">{{ isSavingPlan ? '保存中…' : '保存套餐' }}</button>
          </div>
        </form>
    </MacSheet>

    <!-- 2. Order Detail Modal -->
    <div v-if="showOrderDetailModal && selectedOrder" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div class="admin-dialog w-full max-w-md bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-2xl p-5 text-xs space-y-3">
        <h3 class="font-bold text-[14px] text-[var(--text-primary)]">订单详细信息 #{{ selectedOrder.id }}</h3>
        <div class="space-y-2 p-3 rounded-lg border border-[var(--border-color)] bg-[var(--content-bg)] font-mono text-[11.5px]">
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">商户单号:</span> <span>{{ selectedOrder.out_trade_no }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">用户 ID:</span> <span>{{ selectedOrder.user_id }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">订单类型:</span> <span>{{ selectedOrder.order_type }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">订单金额:</span> <span>${{ selectedOrder.amount.toFixed(2) }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">实付金额:</span> <span class="font-bold text-[#007aff]">${{ selectedOrder.pay_amount.toFixed(2) }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">支付渠道:</span> <span>{{ selectedOrder.payment_type }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">订单状态:</span> <span class="font-bold">{{ selectedOrder.status }}</span></div>
          <div class="flex justify-between"><span class="text-[var(--text-tertiary)]">创建时间:</span> <span>{{ formatDateTime(selectedOrder.created_at) }}</span></div>
          <div v-if="selectedOrder.paid_at" class="flex justify-between"><span class="text-[var(--text-tertiary)]">支付时间:</span> <span>{{ formatDateTime(selectedOrder.paid_at) }}</span></div>
          <div v-if="selectedOrder.refund_amount" class="flex justify-between text-purple-600"><span class="text-[var(--text-tertiary)]">已退金额:</span> <span>${{ selectedOrder.refund_amount.toFixed(2) }}</span></div>
        </div>
        <div class="flex justify-end pt-2">
          <button type="button" class="px-4 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="showOrderDetailModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 3. Order Refund Modal -->
    <MacSheet v-if="showRefundModal && selectedOrder" v-slot="{ close }" :show="true" :title="`${refundActionLabels[selectedOrder.status] || '订单退款'} #${selectedOrder.id}`" protect-changes :loading="isProcessingOrder" @close="!isProcessingOrder && (showRefundModal = false)">
      <form class="text-xs space-y-3" @submit.prevent="handleConfirmRefund">
        <p v-if="refundGuard.storageError.value" role="alert" class="admin-form-error">{{ refundGuard.storageError.value }}</p>
        <div v-if="selectedRefundWrite" role="status">
          <p>此订单已有未核对的退款操作，已阻止再次提交。</p>
          <button type="button" :disabled="isProcessingOrder || reviewingRefund" class="mt-2 text-[var(--accent)]" @click="askReviewRefund(selectedRefundWrite)">核对退款结果</button>
        </div>
        <p class="text-[var(--text-secondary)]">按入账额度填写退款金额，实付款项由收款渠道折算后原路退回。</p>
        <p v-if="selectedOrder.refund_request_reason" class="text-[var(--text-secondary)]">申请原因：{{ selectedOrder.refund_request_reason }}</p>
        <p class="text-[var(--text-secondary)]">剩余可退额度：USD {{ maxRefundable(selectedOrder).toFixed(2) }}</p>
        <fieldset :disabled="isProcessingOrder || refundNeedsReview" class="space-y-3">
        <div>
          <label class="block text-[var(--text-secondary)] font-medium mb-1">退款额度 (USD) *</label>
          <input v-model.number="refundAmount" aria-label="退款额度 (USD)" required type="number" step="0.01" min="0.01" :max="maxRefundable(selectedOrder)" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
        </div>
        <div>
          <label class="block text-[var(--text-secondary)] font-medium mb-1">退款原因</label>
          <input v-model="refundReason" aria-label="退款原因" type="text" placeholder="如 用户协商退款 / 误操作充值" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]" />
        </div>
        <label class="flex items-center gap-2 cursor-pointer pt-1">
          <input v-model="refundDeductBalance" type="checkbox" class="rounded text-purple-600" />
          <span class="text-[var(--text-primary)]">{{ selectedOrder.order_type === 'subscription' ? '同步扣回对应订阅时长' : '同步扣回对应入账余额' }}</span>
        </label>
        <p v-if="refundWarning" role="alert" class="admin-form-error">{{ refundWarning }}</p>
        <label v-if="refundRequireForce" class="flex items-start gap-2 text-red-600 dark:text-red-400">
          <input v-model="refundForceConfirmed" type="checkbox" class="mt-0.5" />
          <span>我确认强制退款，接受余额或订阅时长可能无法足额扣回。</span>
        </label>
        </fieldset>
        <div class="flex justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
          <button type="button" :disabled="isProcessingOrder" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="close">取消</button>
          <button type="submit" :disabled="isProcessingOrder || refundNeedsReview || (refundRequireForce && !refundForceConfirmed)" class="px-3.5 py-1.5 rounded-[6px] bg-purple-600 text-white font-medium">
            {{ isProcessingOrder ? '处理中...' : refundRequireForce ? '确认强制退款' : '确认退款' }}
          </button>
        </div>
      </form>
    </MacSheet>

    <MacAlertSheet :show="!!refundReview" :title="`核对订单 #${refundReview?.targets[0] || ''} 的退款结果`"
      message="请核对最新订单及收款渠道的退款记录，确认此前操作已完成或明确未执行。仅刷新列表不能证明没有退款。解除保护后可再次提交，请勿对已完成的退款重复操作。"
      danger confirm-text="已核对，解除保护" cancel-text="继续核对" :loading="reviewingRefund" @cancel="refundReview = null" @confirm="confirmReviewRefund" />

    <!-- 4. Affiliate User Overview Modal -->
    <div v-if="showAffOverviewModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div class="admin-dialog w-full max-w-sm bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-2xl p-5 text-xs space-y-3">
        <h3 class="font-bold text-[14px] text-[var(--text-primary)]">推广用户返利概览</h3>
        <div v-if="isOverviewLoading" class="py-8 text-center text-[var(--text-tertiary)]">加载中...</div>
        <div v-else-if="selectedAffOverview" class="space-y-2">
          <div class="p-3 rounded-lg border border-[var(--border-color)] bg-[var(--content-bg)]">
            <div class="font-medium text-[var(--text-primary)]">{{ selectedAffOverview.email || `用户 #${selectedAffOverview.user_id}` }}</div>
            <div class="text-[11px] text-[var(--text-tertiary)]">用户名: {{ selectedAffOverview.username || '-' }}</div>
          </div>
          <div class="grid grid-cols-2 gap-2 font-mono text-[11.5px]">
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">邀请码</span>{{ selectedAffOverview.aff_code }}</div>
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">返利比例</span>{{ selectedAffOverview.rebate_rate_percent }}%</div>
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">邀请注册人数</span>{{ selectedAffOverview.invited_count }} 人</div>
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">成功产生返利人数</span>{{ selectedAffOverview.rebated_invitee_count }} 人</div>
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">可用佣金余额</span>${{ (selectedAffOverview.available_quota || 0).toFixed(2) }}</div>
            <div class="p-2 rounded bg-black/5 dark:bg-white/5"><span class="text-[var(--text-tertiary)] block text-[10px]">累计总返利佣金</span>${{ (selectedAffOverview.history_quota || 0).toFixed(2) }}</div>
          </div>
        </div>
        <div class="flex justify-end pt-2">
          <button type="button" class="px-4 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="showAffOverviewModal = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 5. Affiliate Custom Settings Modal -->
    <div v-if="showAffSettingsModal && affSettingUser" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div class="admin-dialog w-full max-w-sm bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-2xl p-5 text-xs space-y-3">
        <h3 class="font-bold text-[14px] text-[var(--text-primary)]">定制用户返利属性</h3>
        <p class="text-[11px] text-[var(--text-tertiary)]">为 {{ affSettingUser.email }} 定制专属邀请代码与特殊返利比例</p>
        <div>
          <label class="block text-[var(--text-secondary)] font-medium mb-1">专属邀请代码</label>
          <input v-model="affCustomCode" type="text" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono uppercase" />
        </div>
        <div>
          <label class="block text-[var(--text-secondary)] font-medium mb-1">专属返利比例 (%)</label>
          <input v-model.number="affCustomRate" type="number" min="0" max="100" step="1" :disabled="affClearRate" placeholder="留空使用全局系统配置" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
        </div>
        <label class="flex items-center gap-2 cursor-pointer pt-1">
          <input v-model="affClearRate" type="checkbox" class="rounded text-[#007aff]" />
          <span class="text-[var(--text-primary)]">重置为全局默认费率 (清除个人定制)</span>
        </label>
        <div class="flex justify-end gap-2 pt-3 border-t border-[var(--border-color)]">
          <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="showAffSettingsModal = false">取消</button>
          <button type="button" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] text-white font-medium" @click="submitSaveAffSettings">保存</button>
        </div>
      </div>
    </div>

    <!-- 6. Generate Redeem Modal -->
    <MacSheet v-if="showGenerateModal" v-slot="{ close }" :show="true" title="批量生成兑换码" protect-changes :loading="isGenerating" @close="!isGenerating && (showGenerateModal = false)">
        <p v-if="generateError" role="alert" class="admin-form-error mb-3">{{ generateError }}</p>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitGenerate">
          <fieldset :disabled="isGenerating" class="flex flex-col gap-3">
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">生成数量</label>
            <input v-model.number="generateForm.count" aria-label="生成数量" required type="number" min="1" max="100" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">卡券类型</label>
            <select v-model="generateForm.type" aria-label="卡券类型" class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)]">
              <option value="balance">余额充值</option>
              <option value="concurrency">增加并发</option>
              <option value="subscription">订阅</option>
              <option value="invitation">邀请码</option>
            </select>
          </div>
          <div v-if="generateForm.type === 'balance' || generateForm.type === 'concurrency'">
            <label class="block text-[var(--text-secondary)] font-medium mb-1">{{ generateForm.type === 'balance' ? '面值 (USD)' : '并发数' }}</label>
            <input v-model.number="generateForm.value" aria-label="卡券面值" required type="number" :step="generateForm.type === 'concurrency' ? 1 : 0.01" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
          </div>
          <p v-if="generateForm.type === 'invitation'" class="text-[var(--text-secondary)]">邀请码用于邀请注册，不增加余额或并发。</p>
          <template v-if="generateForm.type === 'subscription'">
            <p v-if="redeemGroupsLoading" role="status">正在加载订阅分组…</p>
            <div v-else-if="redeemGroupsError" role="alert" class="admin-form-error">{{ redeemGroupsError }} <button type="button" class="text-[var(--accent)]" @click="loadRedeemGroups">重试</button></div>
            <p v-else-if="!subscriptionGroups.length" role="status">暂无订阅分组，请先在分组管理中创建。</p>
            <label class="flex flex-col gap-1">订阅分组
              <select v-model.number="generateForm.group_id" aria-label="订阅分组" :disabled="redeemGroupsLoading || !!redeemGroupsError" required class="w-full px-2.5 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)]">
                <option :value="0" disabled>选择订阅分组</option>
                <option v-for="group in subscriptionGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">兑换后订阅时长 (天)
              <input v-model.number="generateForm.validity_days" type="number" min="1" max="365" step="1" required class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] font-mono" />
            </label>
          </template>
          <label class="flex flex-col gap-1">兑换码领取期限 (天)
            <input v-model.number="generateForm.expires_in_days" type="number" min="1" max="3650" step="1" placeholder="留空为永久有效" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] font-mono" />
          </label>
          </fieldset>
          <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
            <button type="button" :disabled="isGenerating" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="close">取消</button>
            <button type="submit" :disabled="isGenerating || (generateForm.type === 'subscription' && (redeemGroupsLoading || !!redeemGroupsError || !subscriptionGroups.length))" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white font-medium">{{ isGenerating ? '生成中…' : '生成' }}</button>
          </div>
        </form>
    </MacSheet>

    <!-- 7. Create Promo Modal -->
    <div v-if="showPromoModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div class="admin-dialog w-full max-w-sm bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-2xl p-5">
        <h3 class="font-bold text-[14px] text-[var(--text-primary)] mb-1">创建优惠码</h3>
        <p class="text-[11px] text-[var(--text-tertiary)] mb-4">创建用于用户注册赠送余额的优惠码</p>
        <form class="flex flex-col gap-3 text-xs" @submit.prevent="submitCreatePromo">
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">优惠码代号 *</label>
            <input v-model="promoForm.code" type="text" required placeholder="如 WELCOME2026" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] uppercase font-mono" />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">赠送余额 ($)</label>
            <input v-model.number="promoForm.bonus_amount" type="number" step="0.5" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
          </div>
          <div>
            <label class="block text-[var(--text-secondary)] font-medium mb-1">最大使用次数</label>
            <input v-model.number="promoForm.max_uses" type="number" min="1" class="w-full px-3 py-1.5 rounded-[6px] border border-[var(--border-color)] bg-[var(--content-bg)] text-[var(--text-primary)] font-mono" />
          </div>
          <div class="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-[var(--border-color)]">
            <button type="button" class="px-3.5 py-1.5 rounded-[6px] border border-[var(--border-color)]" @click="showPromoModal = false">取消</button>
            <button type="submit" class="px-3.5 py-1.5 rounded-[6px] bg-[#007aff] hover:bg-[#0071e3] text-white font-medium">创建</button>
          </div>
        </form>
      </div>
    </div>

    <PromoInspector :item="selectedPromo" @close="selectedPromo=null" @updated="loadPromo" />
    <!-- MacAlertSheet for Confirmation -->
    <MacAlertSheet
      :show="alertSheet.show"
      :title="alertSheet.title"
      :message="alertSheet.message"
      :confirm-text="alertSheet.confirmText"
      cancel-text="取消"
      :danger="alertSheet.danger"
      :loading="alertSheet.loading"
      @confirm="handleAlertConfirm"
      @cancel="alertSheet.show = false"
    />
  </div>
</template>
