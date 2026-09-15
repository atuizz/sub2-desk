import type { CreateOrderRequest, PaymentOrder } from '@/types/payment';

export function supportsQrFallback(method: string) {
  return ['wxpay', 'wxpay_direct', 'alipay', 'alipay_direct'].includes(method);
}
export function isMobileQrFailure(error: unknown, method: string, agent: string): boolean {
  if (!supportsQrFallback(method) || !/Android|iPhone|iPad|Mobile/i.test(agent)) return false;
  const reason = error && typeof error === 'object' && 'reason' in error ? String(error.reason) : '';
  const common = ['PAYMENT_GATEWAY_ERROR', 'UNHANDLED_PAYMENT_SCENARIO'];
  return [...common, ...(method.startsWith('wxpay') ? ['WECHAT_H5_NOT_AUTHORIZED', 'WECHAT_PAYMENT_MP_NOT_CONFIGURED', 'WECHAT_JSAPI_FAILED'] : [])].includes(reason);
}
export function qrPayload(request: CreateOrderRequest, origin: string): CreateOrderRequest {
  if (!supportsQrFallback(request.payment_type) || !Number.isFinite(request.amount) || request.amount <= 0
    || !['balance', 'subscription'].includes(request.order_type)
    || request.order_type === 'subscription' && (!Number.isSafeInteger(request.plan_id) || request.plan_id! <= 0)) {
    throw new Error('缺少原订单的有效金额或订阅计划，请返回钱包重新选择');
  }
  // Allowlist: never replay an OAuth token/openid or mobile/JSAPI source.
  return { amount: request.amount, order_type: request.order_type, payment_type: request.payment_type,
    ...(request.order_type === 'subscription' ? { plan_id: request.plan_id } : {}),
    return_url: new URL('/payment/result', origin).href, is_mobile: false, payment_source: 'hosted_redirect' };
}
export function requestFromOrder(order: PaymentOrder, method: string): CreateOrderRequest {
  return { amount: order.amount, order_type: order.order_type, plan_id: order.plan_id, payment_type: method };
}
