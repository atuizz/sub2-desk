import type { CheckoutInfoResponse, CreateOrderRequest, CreateOrderResult } from '@/types/payment';

export const RECOVERY_KEY = 'sub2-mac.payment.recovery.v1';
export const PENDING = new Set(['PENDING', 'CREATED', 'WAITING', 'PROCESSING', 'PAID', 'RECHARGING']);
export function statusText(status: string): string {
  return ({ COMPLETED: '支付已完成', PAID: '已收到支付，正在入账', RECHARGING: '已收到支付，正在入账', PENDING: '等待支付', EXPIRED: '订单已过期，请重新下单', CANCELLED: '订单已取消', FAILED: '支付失败，请查看订单记录', REFUNDED: '订单已退款', REFUNDING: '退款处理中', REFUND_REQUESTED: '已申请退款', REFUND_PENDING: '退款待处理', PARTIALLY_REFUNDED: '已部分退款', REFUND_FAILED: '退款失败，请联系管理员' } as Record<string, string>)[status] || '支付结果尚未确认';
}
export function safeURL(raw: string, origin?: string): string {
  if (!raw.trim()) return '';
  try { const url = new URL(raw, origin); return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
export function alipayDeepLink(order: CreateOrderResult): string {
  return order.alipay_mobile_precreate_deep_link && order.qr_code && ['alipay', 'alipay_direct'].includes(order.payment_type || '')
    ? 'alipays://platformapi/startapp?saId=10000007&qrcode=' + encodeURIComponent(order.qr_code.trim()) : '';
}
export function paymentKind(order: CreateOrderResult) {
  if (order.result_type === 'oauth_required') return 'oauth';
  if (order.result_type === 'jsapi_ready') return order.jsapi || order.jsapi_payload ? 'jsapi' : 'unsupported';
  if (order.payment_type === 'airwallex') return order.intent_id && order.client_secret ? 'airwallex' : 'unsupported';
  if (order.client_secret) return 'stripe';
  return order.qr_code || order.pay_url ? 'qr' : 'unsupported';
}
export function createPayload(input: CreateOrderRequest, origin: string, agent: string, config?: CheckoutInfoResponse | null): CreateOrderRequest {
  const wx = ['wxpay', 'wxpay_direct'].includes(input.payment_type);
  const alipay = ['alipay', 'alipay_direct'].includes(input.payment_type);
  return { ...input, return_url: new URL('/payment/result', origin).href,
    is_mobile: alipay && config?.alipay_force_qrcode && !config.alipay_mobile_precreate_deep_link ? false : /Android|iPhone|iPad|Mobile/i.test(agent),
    payment_source: wx && /MicroMessenger/i.test(agent) ? 'wechat_in_app_resume' : 'hosted_redirect' };
}
export function saveRecovery(storage: Pick<Storage, 'setItem'>, order: CreateOrderResult, owner: number | null) {
  if (!Number.isSafeInteger(order.order_id) || order.order_id <= 0) return;
  // JSAPI signatures and OAuth responses are deliberately not persisted.
  const { jsapi, jsapi_payload, oauth, ...saved } = order;
  storage.setItem(RECOVERY_KEY, JSON.stringify({ order: saved, owner, savedAt: Date.now() }));
}
export function readRecovery(raw: string | null, context: { orderId?: number; token?: string; trade?: string; owner?: number | null }, now = Date.now()): CreateOrderResult | null {
  try {
    const data = JSON.parse(raw || 'null'); const o = data?.order;
    if (!o || !Number.isSafeInteger(o.order_id) || o.order_id <= 0 || !Number.isFinite(data.savedAt) || now - data.savedAt > 86400000 || data.savedAt > now + 60000) return null;
    if (!Number.isFinite(o.amount) || !Number.isFinite(o.pay_amount) || typeof o.expires_at !== 'string') return null;
    for (const key of ['pay_url', 'qr_code', 'client_secret', 'intent_id', 'currency', 'country_code', 'payment_env', 'payment_type', 'out_trade_no', 'payment_mode', 'resume_token']) {
      if (o[key] !== undefined && typeof o[key] !== 'string') return null;
    }
    if (context.orderId && context.orderId !== o.order_id || context.token && context.token !== o.resume_token || context.trade && context.trade !== o.out_trade_no) return null;
    if (context.owner !== undefined && context.owner !== data.owner) return null;
    if (!context.orderId && !context.token && !context.trade && context.owner === undefined) return null;
    return o;
  } catch { return null; }
}
export function clearRecovery(storage: Pick<Storage, 'getItem' | 'removeItem'>, id: number) {
  try { if (JSON.parse(storage.getItem(RECOVERY_KEY) || 'null')?.order?.order_id === id) storage.removeItem(RECOVERY_KEY); } catch { /* Unavailable storage cannot block verification. */ }
}
export function resultURL(order: CreateOrderResult, origin: string) {
  const url = new URL('/payment/result', origin);
  if (order.order_id > 0) url.searchParams.set('order_id', String(order.order_id));
  if (order.out_trade_no) url.searchParams.set('out_trade_no', order.out_trade_no);
  if (order.resume_token) url.searchParams.set('resume_token', order.resume_token);
  return url.href;
}
export function oauthURL(order: CreateOrderResult, request: CreateOrderRequest | undefined, origin: string) {
  const raw = safeURL(order.oauth?.authorize_url || '', origin);
  if (!raw) throw new Error('微信授权地址无效，请重新选择支付方式');
  const url = new URL(raw); const redirect = new URL('/purchase', origin);
  if (request) for (const key of ['payment_type', 'order_type', 'plan_id', 'amount'] as const) {
    if (request[key] !== undefined) redirect.searchParams.set(key, String(request[key]));
  }
  url.searchParams.set('redirect', redirect.pathname + redirect.search);
  return url.href;
}
export function parseWechatReturn(url: URL): CreateOrderRequest | null {
  const fragment = new URLSearchParams(url.hash.slice(1));
  const get = (key: string) => fragment.get(key) || url.searchParams.get(key) || '';
  if (get('error') || get('err_msg') || get('errmsg')) throw new Error(get('error_description') || get('message') || get('error') || get('err_msg') || get('errmsg'));
  const token = get('wechat_resume_token'); const openid = get('openid');
  if (!token && !openid) return null;
  // Legacy callbacks may carry the purchase context inside a same-origin redirect.
  let redirect: URL | null = null;
  try { const candidate = new URL(get('redirect'), url.origin); if (candidate.origin === url.origin) redirect = candidate; } catch { /* no context */ }
  const value = (key: string) => get(key) || redirect?.searchParams.get(key) || '';
  const plan = Number(value('plan_id')); const type = value('order_type') === 'subscription' || plan > 0 ? 'subscription' : 'balance';
  const amount = token ? 0 : Number(value('amount'));
  if (!token && (!Number.isFinite(amount) || amount <= 0)) throw new Error('授权返回缺少有效金额，请返回钱包重新下单');
  if (type === 'subscription' && !token && (!Number.isSafeInteger(plan) || plan <= 0)) throw new Error('授权返回缺少订阅计划');
  return { amount, order_type: type, payment_type: value('payment_type') || 'wxpay', ...(plan > 0 ? { plan_id: plan } : {}), ...(token ? { wechat_resume_token: token } : { openid }) };
}
export function isPaymentRoute(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const fragment = new URLSearchParams(url.hash.slice(1));
  const resume = [url.searchParams, fragment].some(params => params.has('wechat_resume_token') || params.has('openid') || params.get('wechat_resume') === '1');
  return /^\/payment\/(result|qrcode|stripe|stripe-popup|airwallex)$/.test(pathname)
    || pathname === '/auth/wechat/payment/callback'
    || ['/purchase', '/payment'].includes(pathname) && resume;
}
