import type { SystemSettings, UpdateSettingsRequest, TestSmtpRequest } from '@/api/admin/settings';

export const settingsFields = {
  admin_general: ['backend_mode_enabled', 'site_name', 'site_subtitle', 'api_base_url', 'custom_endpoints'],
  admin_terms: ['login_agreement_enabled', 'login_agreement_mode', 'login_agreement_documents'],
  admin_features: ['registration_enabled', 'email_verify_enabled', 'promo_code_enabled', 'model_plaza_enabled', 'channel_monitor_hide_user_ranking'],
  admin_security: ['turnstile_enabled', 'turnstile_site_key', 'linuxdo_connect_enabled', 'wechat_connect_enabled'],
  admin_defaults: ['default_balance', 'default_concurrency', 'default_user_rpm_limit', 'account_scheduling_thresholds'],
  admin_payment: ['payment_enabled', 'payment_subscription_usd_to_cny_rate', 'payment_recharge_fee_rate', 'payment_min_amount', 'payment_max_amount', 'payment_daily_limit', 'payment_order_timeout_minutes', 'payment_max_pending_orders', 'payment_balance_disabled', 'payment_balance_recharge_multiplier', 'payment_load_balance_strategy', 'payment_enabled_types', 'payment_product_name_prefix', 'payment_product_name_suffix', 'payment_help_image_url', 'payment_help_text', 'payment_cancel_rate_limit_enabled', 'payment_cancel_rate_limit_max', 'payment_cancel_rate_limit_window', 'payment_cancel_rate_limit_unit', 'payment_cancel_rate_limit_window_mode', 'payment_alipay_force_qrcode', 'payment_alipay_mobile_precreate_deep_link'],
  admin_email: ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_from_email', 'smtp_from_name', 'smtp_use_tls'],
} as const satisfies Record<string, readonly (keyof UpdateSettingsRequest)[]>;
export type SettingsTab = keyof typeof settingsFields;
type FormKey = typeof settingsFields[SettingsTab][number];
export type SettingsForm = Pick<SystemSettings, FormKey> & Partial<Pick<SystemSettings, 'smtp_password_configured' | 'turnstile_secret_key_configured'>>;
export const formKeys = [...new Set(Object.values(settingsFields).flat())];

export function isSettingsTab(tab: string): tab is SettingsTab { return tab in settingsFields; }
export function copySettings(data: Partial<SystemSettings>): Partial<SettingsForm> {
  const keys = [...formKeys, 'smtp_password_configured', 'turnstile_secret_key_configured'] as const;
  return Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key,
    key === 'payment_enabled_types' && data[key] === null ? [] : JSON.parse(JSON.stringify(data[key]))]));
}
export function settingsPatch(tab: SettingsTab, draft: SettingsForm, saved: Partial<SettingsForm>): UpdateSettingsRequest {
  const entries = settingsFields[tab].filter(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]));
  for (const key of entries) {
    if (saved[key] === undefined) throw new Error('该后端未返回完整模块配置，请重新读取或核对支持的后端版本。');
    if (typeof draft[key] === 'number' && !Number.isFinite(draft[key])) throw new Error('请输入有效数值。');
    if (typeof saved[key] === 'number' && (typeof draft[key] !== 'number' || !Number.isFinite(draft[key]))) throw new Error('请输入有效数值。');
    if (typeof saved[key] === 'boolean' && typeof draft[key] !== 'boolean') throw new Error('开关值无效。');
    if (key === 'smtp_port' && (!Number.isInteger(draft[key]) || draft[key]! < 1 || draft[key]! > 65535)) throw new Error('SMTP 端口须为 1 至 65535 的整数。');
    if (key === 'channel_monitor_hide_user_ranking' && (typeof saved[key] !== 'boolean' || typeof draft[key] !== 'boolean')) throw new Error('请先重新读取用户排行设置。');
    if (key === 'account_scheduling_thresholds') {
      const before = saved.account_scheduling_thresholds, after = draft.account_scheduling_thresholds;
      for (const platform of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
        const oldValue = (before as Record<string, number> | undefined)?.[platform];
        const value = (after as Record<string, number> | undefined)?.[platform];
        if (oldValue === value) continue;
        if (!Number.isInteger(oldValue) || oldValue! < 1 || oldValue! > 100) throw new Error('该平台尚未返回有效的暂停阈值，请重新读取后再编辑。');
        if (!Number.isInteger(value) || value! < 1 || value! > 100) throw new Error('暂停阈值须为 1 至 100 的整数。');
      }
    }
  }
  if (tab === 'admin_payment' && entries.length) validatePaymentSettings(draft, entries);
  return Object.fromEntries(entries.map(key => [key, JSON.parse(JSON.stringify(draft[key]))]));
}

export const secretFields = { admin_email: 'smtp_password', admin_security: 'turnstile_secret_key' } as const;
export type SettingsSecrets = { smtp_password: string; turnstile_secret_key: string };
export const emptySettingsSecrets = (): SettingsSecrets => ({ smtp_password: '', turnstile_secret_key: '' });
export function smtpTestPayload(draft: SettingsForm, secrets: SettingsSecrets, saved: Partial<SettingsForm>): TestSmtpRequest {
  for (const key of settingsFields.admin_email) if (saved[key] === undefined) throw new Error('请先完整读取邮件配置。');
  if (typeof saved.smtp_password_configured !== 'boolean') throw new Error('请先读取邮件密码状态。');
  if (!draft.smtp_host.trim() || !Number.isInteger(draft.smtp_port) || draft.smtp_port < 1 || draft.smtp_port > 65535) throw new Error('请填写 SMTP 主机和有效端口（1 至 65535）。');
  return { smtp_host: draft.smtp_host, smtp_port: draft.smtp_port, smtp_username: draft.smtp_username, smtp_password: secrets.smtp_password.trim() ? secrets.smtp_password : '', smtp_use_tls: draft.smtp_use_tls };
}

export function confirmedSettingsResponse(payload: UpdateSettingsRequest, data: Partial<SystemSettings>): Partial<SettingsForm> {
  const updated = copySettings(data || {});
  for (const [field, submitted] of Object.entries(payload)) {
    const secret = field === 'smtp_password' || field === 'turnstile_secret_key';
    const key = (secret ? `${field}_configured` : field) as keyof SettingsForm;
    const returned = updated[key];
    if (returned === undefined || (secret ? returned !== true : typeof submitted !== typeof returned)) throw new Error('配置已提交，但返回内容无法确认，请重新读取核对。');
  }
  return updated;
}
export function settingsSecretPatch(tab: SettingsTab, secrets: SettingsSecrets, saved: Partial<SettingsForm>): UpdateSettingsRequest {
  if (!(tab in secretFields)) return {};
  const key = secretFields[tab as keyof typeof secretFields];
  if (!secrets[key].trim()) return {};
  if (typeof saved[`${key}_configured`] !== 'boolean') throw new Error('尚未读取凭据配置状态，请重新读取后再保存。');
  return { [key]: secrets[key] };
}

// A timeout/5xx may follow a committed write. Never surface server echoes of secrets.
export function settingsWriteUnknown(error: unknown): boolean {
  const e = error as { status?: number; response?: { status?: number } } | null;
  const status = e?.status ?? e?.response?.status;
  return !status || status >= 500 || status === 408;
}

function validatePaymentSettings(draft: SettingsForm, changed: readonly string[]) {
  const positiveIntegers = ['payment_order_timeout_minutes', 'payment_max_pending_orders', 'payment_cancel_rate_limit_max', 'payment_cancel_rate_limit_window'];
  for (const key of changed) {
    const value = draft[key as keyof SettingsForm];
    if (typeof value === 'number' && (value < 0 || (positiveIntegers.includes(key) && (!Number.isInteger(value) || value < 1)))) throw new Error('限额须为非负数，超时、订单数量和取消频率须为正整数。');
  }
  if (changed.includes('payment_balance_recharge_multiplier') && !(draft.payment_balance_recharge_multiplier! > 0)) throw new Error('充值倍率须大于 0。');
  if (changed.includes('payment_recharge_fee_rate') && draft.payment_recharge_fee_rate! > 100) throw new Error('充值费率须在 0 至 100 之间。');
  if (changed.includes('payment_recharge_fee_rate') && Math.abs(Math.round(draft.payment_recharge_fee_rate! * 100) - draft.payment_recharge_fee_rate! * 100) > 1e-8) throw new Error('充值费率最多保留两位小数。');
  if (changed.some(k => ['payment_min_amount', 'payment_max_amount'].includes(k))) {
    if (typeof draft.payment_min_amount !== 'number' || typeof draft.payment_max_amount !== 'number') throw new Error('请先读取完整充值限额。');
    if (draft.payment_max_amount > 0 && draft.payment_min_amount > draft.payment_max_amount) throw new Error('最大充值金额不能小于最小充值金额。');
  }
  const enums: Record<string, string[]> = { payment_load_balance_strategy: ['round-robin', 'least-amount'], payment_cancel_rate_limit_unit: ['minute', 'hour', 'day'], payment_cancel_rate_limit_window_mode: ['rolling', 'fixed'] };
  for (const key of changed) if (enums[key] && !enums[key].includes(draft[key as keyof SettingsForm] as string)) throw new Error('请选择支持的支付策略。');
  if (changed.includes('payment_enabled_types') && (!Array.isArray(draft.payment_enabled_types) || draft.payment_enabled_types.some(t => typeof t !== 'string'))) throw new Error('支付提供方类型无效。');
}
