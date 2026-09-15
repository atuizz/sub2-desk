import { ref, watch, onBeforeUnmount } from 'vue';
import { paymentAPI, type PublicOrderVerifyResult } from '@/api/payment';
import type { PaymentOrder } from '@/types/payment';
import { PENDING } from './flow';
export interface OrderLookup { orderId?: number; token?: string; trade?: string; authenticated?: boolean }
export function usePaymentStatus(context: () => OrderLookup | null, completed: () => void) {
  const status = ref(''), issue = ref(''), busy = ref(false);
  let generation = 0, notified = false, attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  function stop() { generation++; clearTimeout(timer); controller?.abort(); }
  async function refresh() {
    const lookup = context(); if (!lookup || busy.value) return;
    clearTimeout(timer); const current = generation;
    controller = new AbortController(); const signal = controller.signal;
    busy.value = true; issue.value = '';
    try {
      const { data } = await resolvePaymentStatus(lookup, paymentAPI, signal);
      if (current !== generation) return;
      status.value = data.status;
      if (data.status === 'COMPLETED' && !notified) { notified = true; completed(); }
      if (PENDING.has(data.status) && ++attempts < 40) timer = setTimeout(() => void refresh(), 3000);
      else if (PENDING.has(data.status)) issue.value = '自动查询已暂停，可手动查询最新结果';
    } catch (error) { if (current === generation) issue.value = error instanceof Error ? error.message : '订单查询失败，请重试'; }
    finally { if (current === generation) busy.value = false; }
  }
  watch(context, () => { stop(); notified = false; attempts = 0; status.value = ''; issue.value = ''; busy.value = false; void refresh(); }, { immediate: true });
  onBeforeUnmount(stop);
  return { status, issue, busy, refresh };
}
type VerifyAPI = Pick<typeof paymentAPI, 'getOrder' | 'verifyOrder' | 'verifyOrderPublic' | 'resolveOrderPublicByResumeToken'>;
export async function resolvePaymentStatus(context: OrderLookup, api: VerifyAPI, signal?: AbortSignal): Promise<{ data: PaymentOrder | PublicOrderVerifyResult }> {
  let lastError: unknown;
  if (context.token) {
    try { return await api.resolveOrderPublicByResumeToken(context.token, signal); } catch (error) { lastError = error; }
  }
  if (signal?.aborted) throw new Error('查询已取消');
  if (context.authenticated !== false && context.orderId && Number.isSafeInteger(context.orderId) && context.orderId > 0) {
    try { return await api.getOrder(context.orderId, signal); } catch (error) { lastError = error; }
  }
  if (signal?.aborted) throw new Error('查询已取消');
  if (context.trade) {
    if (context.authenticated !== false) {
      try { return await api.verifyOrder(context.trade, signal); } catch (error) { lastError = error; }
    }
    if (signal?.aborted) throw new Error('查询已取消');
    try { return await api.verifyOrderPublic(context.trade, signal); } catch (error) { lastError = error; }
  }
  throw lastError || new Error(context.authenticated === false && context.orderId ? '此订单需要登录后在钱包中查询' : '缺少订单标识，请从钱包订单记录查询');
}
