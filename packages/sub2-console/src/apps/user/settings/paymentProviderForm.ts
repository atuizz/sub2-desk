import type { ProviderInstance } from '@/types/payment';

// v0.2.4: frontend/components/payment/providerConfig.ts and service/payment_config_providers.go.
export const providerOptions = [
  { value: 'easypay', label: '易支付' }, { value: 'alipay', label: '支付宝官方' },
  { value: 'wxpay', label: '微信支付官方' }, { value: 'stripe', label: 'Stripe' }, { value: 'airwallex', label: 'Airwallex' },
];
export const providerTypes: Record<string, string[]> = { easypay: ['alipay', 'wxpay'], alipay: ['alipay'], wxpay: ['wxpay'], stripe: ['card', 'alipay', 'wxpay', 'link'], airwallex: ['airwallex'] };
export const typeLabels: Record<string, string> = { alipay: '支付宝', wxpay: '微信支付', card: '银行卡', link: 'Link', airwallex: 'Airwallex', stripe: 'Stripe' };
export interface ConfigField { key: string; label: string; secret?: boolean; optional?: boolean; defaultValue?: string }
export const providerFields: Record<string, ConfigField[]> = {
  easypay: [{ key: 'pid', label: '商户 PID' }, { key: 'pkey', label: '商户密钥', secret: true }, { key: 'apiBase', label: '网关地址' }, { key: 'cidAlipay', label: '支付宝通道 ID', optional: true }, { key: 'cidWxpay', label: '微信通道 ID', optional: true }],
  alipay: [{ key: 'appId', label: '应用 App ID' }, { key: 'privateKey', label: '应用私钥', secret: true }, { key: 'publicKey', label: '支付宝公钥', secret: true }],
  wxpay: [{ key: 'appId', label: '应用 App ID' }, { key: 'mchId', label: '商户号' }, { key: 'privateKey', label: '商户私钥', secret: true }, { key: 'apiV3Key', label: 'API v3 密钥', secret: true }, { key: 'certSerial', label: '证书序列号' }, { key: 'publicKey', label: '微信支付公钥', secret: true }, { key: 'publicKeyId', label: '微信支付公钥 ID' }],
  stripe: [{ key: 'secretKey', label: 'Secret Key', secret: true }, { key: 'publishableKey', label: 'Publishable Key' }, { key: 'webhookSecret', label: 'Webhook 签名密钥', secret: true }, { key: 'currency', label: '结算币种', defaultValue: 'CNY' }],
  airwallex: [{ key: 'clientId', label: 'Client ID' }, { key: 'apiKey', label: 'API Key', secret: true }, { key: 'webhookSecret', label: 'Webhook 签名密钥', secret: true }, { key: 'apiBase', label: 'API 地址', defaultValue: 'https://api.airwallex.com/api/v1' }, { key: 'countryCode', label: '国家代码', defaultValue: 'CN' }, { key: 'currency', label: '结算币种', defaultValue: 'CNY' }, { key: 'accountId', label: '关联账户 ID', optional: true }],
};
export const currencies = ['CNY', 'HKD', 'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'JPY', 'KRW', 'NZD'];
export function configFields(key: string): ConfigField[] {
  return [...(providerFields[key] || []), ...(['easypay', 'alipay', 'wxpay'].includes(key) ? [{ key: 'notifyUrl', label: '异步通知完整 URL' }, ...(['easypay', 'alipay'].includes(key) ? [{ key: 'returnUrl', label: '付款返回完整 URL' }] : [])] : [])];
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function normalizeProviders(data: unknown): ProviderInstance[] {
  if (!Array.isArray(data)) throw new Error('收款提供方列表响应无效，请重新读取。');
  const ids = new Set<number>();
  return data.map(raw => {
    if (!record(raw) || !Number.isSafeInteger(raw.id) || (raw.id as number) < 1 || ids.has(raw.id as number) ||
      !['provider_key', 'name', 'payment_mode', 'limits'].every(k => typeof raw[k] === 'string') ||
      !['enabled', 'refund_enabled', 'allow_user_refund'].every(k => typeof raw[k] === 'boolean') || !Number.isSafeInteger(raw.sort_order) ||
      (raw.supported_types !== null && (!Array.isArray(raw.supported_types) || raw.supported_types.some(t => typeof t !== 'string'))) ||
      (raw.config !== null && !record(raw.config))) throw new Error('收款提供方列表响应不完整，请重新读取。');
    ids.add(raw.id as number);
    // Do not retain returned secrets, unknown keys or server-only fields in the UI state.
    const config: Record<string, string> = {};
    for (const field of [...configFields(raw.provider_key as string), { key: 'customMethods', label: '' }]) {
      const value = (raw.config as Record<string, unknown> | null)?.[field.key];
      if (field.secret || value === undefined) continue;
      if (typeof value !== 'string') throw new Error('收款配置字段类型无效，请重新读取。');
      config[field.key] = value;
    }
    return { id: raw.id, provider_key: raw.provider_key, name: raw.name, config, supported_types: raw.supported_types ?? [], enabled: raw.enabled, payment_mode: raw.payment_mode, refund_enabled: raw.refund_enabled, allow_user_refund: raw.allow_user_refund, limits: raw.limits, sort_order: raw.sort_order } as ProviderInstance;
  }).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}
export function newProvider(key = 'easypay', order = 0, origin = ''): ProviderInstance {
  if (!providerTypes[key]) throw new Error('暂不支持此收款提供方。');
  const config = Object.fromEntries(configFields(key).map(f => [f.key, f.defaultValue || (f.key === 'notifyUrl' ? `${origin}/api/v1/payment/webhook/${key}` : f.key === 'returnUrl' ? `${origin}/payment/result` : '')]));
  return { id: 0, provider_key: key, name: '', config, supported_types: [...providerTypes[key]], enabled: true, payment_mode: key === 'easypay' ? 'qrcode' : '', refund_enabled: false, allow_user_refund: false, limits: '', sort_order: order };
}
export function editProvider(provider: ProviderInstance): ProviderInstance { return clone(provider); }
export type ProviderLimits = Record<string, Record<string, unknown>>;
export function parseProviderLimits(value: string): ProviderLimits {
  if (!value) return {};
  try { const parsed = JSON.parse(value); if (record(parsed) && Object.values(parsed).every(record)) return parsed as ProviderLimits; } catch { /* sanitized below */ }
  throw new Error('现有提供方限额格式无法读取，请核对后再编辑。');
}
export interface CustomMethod { type: string; upstreamType: string; displayName: string }
export function parseCustomMethods(value?: string): CustomMethod[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every(v => record(v) && typeof v.type === 'string' && typeof v.upstreamType === 'string' && (v.displayName === undefined || typeof v.displayName === 'string'))) return parsed.map(v => ({ type: v.type, upstreamType: v.upstreamType, displayName: v.displayName || '' }));
  } catch { /* sanitized below */ }
  throw new Error('自定义支付方式格式无法读取，请核对后再编辑。');
}
export function providerPayload(draft: ProviderInstance, baseline: ProviderInstance | null): Partial<ProviderInstance> {
  const key = draft.provider_key;
  if (!providerTypes[key] || (baseline && key !== baseline.provider_key)) throw new Error('不能更改已有提供方类型。');
  if (!draft.name.trim()) throw new Error('请输入收款提供方名称。');
  if (!Number.isSafeInteger(draft.sort_order)) throw new Error('排序须为整数。');
  const custom = key === 'easypay' ? parseCustomMethods(draft.config.customMethods) : [];
  if (key === 'easypay' && (!baseline || draft.config.customMethods !== baseline.config.customMethods)) {
    const used = new Set<string>();
    for (const method of custom) {
      if (!/^[a-z0-9_-]+$/.test(method.type) || !/^[a-z0-9_-]+$/.test(method.upstreamType) || /^(alipay|wxpay)/.test(method.type) || used.has(method.type)) throw new Error('自定义方式代码须唯一，只能包含小写字母、数字、下划线和连字符，且不能以 alipay 或 wxpay 开头。');
      used.add(method.type);
    }
  }
  if (draft.supported_types.some(t => ![...providerTypes[key], ...custom.map(m => m.type), ...(baseline?.supported_types || [])].includes(t))) throw new Error('此提供方不支持所选支付方式。');
  const payload: Partial<ProviderInstance> = baseline ? {} : { provider_key: key };
  const values = { name: draft.name.trim(), supported_types: [...new Set(draft.supported_types)], enabled: draft.enabled, payment_mode: draft.payment_mode, refund_enabled: draft.refund_enabled, allow_user_refund: draft.refund_enabled && draft.allow_user_refund, sort_order: draft.sort_order, limits: draft.limits };
  const modes = key === 'easypay' ? ['qrcode', 'popup'] : key === 'alipay' ? ['', 'redirect'] : [''];
  if ((!baseline || values.payment_mode !== baseline.payment_mode) && !modes.includes(values.payment_mode)) throw new Error('请选择支持的付款打开方式。');
  if (!baseline || values.limits !== baseline.limits) {
    for (const limits of Object.values(parseProviderLimits(values.limits))) {
      for (const field of ['singleMin', 'singleMax', 'dailyLimit']) if (limits[field] !== undefined && (typeof limits[field] !== 'number' || !Number.isFinite(limits[field]) || (limits[field] as number) <= 0)) throw new Error('提供方限额须大于 0，留空使用默认设置。');
      if (typeof limits.singleMin === 'number' && typeof limits.singleMax === 'number' && limits.singleMin > limits.singleMax) throw new Error('提供方最大金额不能小于最小金额。');
    }
  }
  for (const [field, value] of Object.entries(values)) if (!baseline || JSON.stringify(value) !== JSON.stringify(baseline[field as keyof ProviderInstance])) Object.assign(payload, { [field]: value });
  const config: Record<string, string> = {};
  for (const field of configFields(key)) {
    const value = draft.config[field.key] ?? '';
    if (!field.optional && !(baseline && field.secret) && !value.trim() && draft.enabled) throw new Error(`请填写${field.label}。`);
    if (field.secret && !value.trim()) continue;
    if (!baseline || value !== (baseline.config[field.key] ?? '')) config[field.key] = value;
  }
  if (key === 'easypay' && (!baseline || draft.config.customMethods !== baseline.config.customMethods)) config.customMethods = draft.config.customMethods || '';
  if (Object.keys(config).length) payload.config = config;
  return payload;
}
