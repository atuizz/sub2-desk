import type { WechatJSAPIPayload } from '@/types/payment';
interface Bridge { invoke(name: string, payload: WechatJSAPIPayload, callback: (result: { err_msg?: string }) => void): void }
export function invokeWechat(payload: WechatJSAPIPayload, signal: AbortSignal, host: Window = window, doc: Document = document): Promise<'ok' | 'cancel'> {
  return new Promise((resolve, reject) => {
    let invoked = false, settled = false;
    const cleanup = () => { host.clearTimeout(timer); doc.removeEventListener('WeixinJSBridgeReady', ready); doc.removeEventListener('onWeixinJSBridgeReady', ready); signal.removeEventListener('abort', abort); };
    const finish = (error?: Error, result: 'ok' | 'cancel' = 'ok') => { if (settled) return; settled = true; cleanup(); error ? reject(error) : resolve(result); };
    const abort = () => finish(new Error('支付操作已关闭'));
    const ready = () => {
      const bridge = (host as Window & { WeixinJSBridge?: Bridge }).WeixinJSBridge;
      if (!bridge || invoked || settled) return;
      invoked = true;
      try { bridge.invoke('getBrandWCPayRequest', payload, result => {
        const message = String(result?.err_msg || '').toLowerCase();
        if (message.includes('cancel')) finish(undefined, 'cancel');
        else if (message === 'get_brand_wcpay_request:ok') finish();
        else finish(new Error('微信支付未完成，请重试或返回钱包选择其他支付方式'));
      }); } catch { finish(new Error('微信支付无法启动，请在微信内重试')); }
    };
    const timer = host.setTimeout(() => finish(new Error('微信支付响应超时，请查询订单后再重试')), 60000);
    signal.addEventListener('abort', abort, { once: true });
    doc.addEventListener('WeixinJSBridgeReady', ready); doc.addEventListener('onWeixinJSBridgeReady', ready);
    if (signal.aborted) abort(); else ready();
  });
}
