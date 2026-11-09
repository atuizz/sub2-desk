import type { SystemSettings, UpdateSettingsRequest, TestSmtpRequest, RechargeBonusTier } from '@/api/admin/settings';

// payment_balance_disabled 同时在 admin_features 与 admin_payment：功能开关页的「站点类型」
// 选择器与支付页共用它，settingsPatch 按 tab 各自取 changed 字段，重复列出无害。
export const settingsFields = {
  admin_general: ['backend_mode_enabled', 'site_name', 'site_subtitle', 'api_base_url', 'custom_endpoints'],
  admin_terms: ['login_agreement_enabled', 'login_agreement_mode', 'login_agreement_documents'],
  admin_features: ['registration_enabled', 'email_verify_enabled', 'promo_code_enabled', 'model_plaza_enabled', 'channel_monitor_hide_user_ranking', 'subscription_enabled', 'payment_balance_disabled'],
  admin_security: ['turnstile_enabled', 'turnstile_site_key', 'linuxdo_connect_enabled', 'wechat_connect_enabled'],
  admin_defaults: ['default_balance', 'default_concurrency', 'default_user_rpm_limit', 'account_scheduling_thresholds'],
  admin_payment: ['payment_enabled', 'payment_subscription_usd_to_cny_rate', 'payment_recharge_fee_rate', 'payment_recharge_bonus_tiers', 'payment_recharge_bonus_mode', 'payment_recharge_bonus_notice', 'payment_min_amount', 'payment_max_amount', 'payment_daily_limit', 'payment_order_timeout_minutes', 'payment_max_pending_orders', 'payment_balance_disabled', 'payment_balance_recharge_multiplier', 'payment_load_balance_strategy', 'payment_enabled_types', 'payment_product_name_prefix', 'payment_product_name_suffix', 'payment_help_image_url', 'payment_help_text', 'payment_cancel_rate_limit_enabled', 'payment_cancel_rate_limit_max', 'payment_cancel_rate_limit_window', 'payment_cancel_rate_limit_unit', 'payment_cancel_rate_limit_window_mode', 'payment_alipay_force_qrcode', 'payment_alipay_mobile_precreate_deep_link'],
  admin_email: ['smtp_host', 'smtp_port', 'smtp_username', 'smtp_from_email', 'smtp_from_name', 'smtp_use_tls'],
} as const satisfies Record<string, readonly (keyof UpdateSettingsRequest)[]>;
export type SettingsTab = keyof typeof settingsFields;
type FormKey = typeof settingsFields[SettingsTab][number];
/** 充值奖励档位草稿行：与上游 0.2.20 RechargeBonusTierDraft 一致，金额/比例都允许留空；提交时未完成行丢弃。 */
export interface RechargeBonusTierDraft {
  min_amount: number | null;
  bonus_percent: number | null;
}
export type SettingsForm = Omit<Pick<SystemSettings, FormKey>, 'payment_recharge_bonus_tiers'> & {
  payment_recharge_bonus_tiers?: RechargeBonusTierDraft[];
} & Partial<Pick<SystemSettings, 'smtp_password_configured' | 'turnstile_secret_key_configured'>>;

/** 充值奖励档位上限：与上游 0.2.20 前端 utils/rechargeBonus.ts 及后端 maxRechargeBonusTiers 同值（20）。 */
export const MAX_RECHARGE_BONUS_TIERS = 20;
/** 充值奖励比例上限（赠金模式）：与上游 0.2.20 前端 MAX_RECHARGE_BONUS_PERCENT 及后端写路径同值（1000）；折扣模式另限 <100。 */
export const MAX_RECHARGE_BONUS_PERCENT = 1000;
export const formKeys = [...new Set(Object.values(settingsFields).flat())];

function isBonusAmountValid(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Math.abs(Math.round(value * 100) - value * 100) <= 1e-8;
}
function isBonusPercentValid(value: unknown): value is number {
  return isBonusAmountValid(value) && value <= MAX_RECHARGE_BONUS_PERCENT;
}
/** 提交清洗（与上游 0.2.20 sanitizeRechargeBonusTiersForSubmit 同语义）：留空/非法的行整行丢弃，同阈值保留先出现，按阈值升序。 */
export function sanitizeRechargeBonusTiersForSubmit(tiers: readonly RechargeBonusTierDraft[] | null | undefined): RechargeBonusTier[] {
  if (!Array.isArray(tiers)) return [];
  const seen = new Set<string>();
  const out: RechargeBonusTier[] = [];
  for (const tier of tiers) {
    if (!tier || !isBonusAmountValid(tier.min_amount) || !isBonusPercentValid(tier.bonus_percent)) continue;
    const key = tier.min_amount.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ min_amount: tier.min_amount, bonus_percent: tier.bonus_percent });
  }
  out.sort((a, b) => a.min_amount - b.min_amount);
  return out;
}

export function isSettingsTab(tab: string): tab is SettingsTab { return tab in settingsFields; }
export function copySettings(data: Partial<SystemSettings> | Partial<SettingsForm>): Partial<SettingsForm> {
  const keys = [...formKeys, 'smtp_password_configured', 'turnstile_secret_key_configured'] as const;
  return Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key,
    key === 'payment_enabled_types' && data[key] === null ? [] : JSON.parse(JSON.stringify(data[key]))]));
}
export function settingsPatch(tab: SettingsTab, draft: SettingsForm, saved: Partial<SettingsForm>): UpdateSettingsRequest {
  const entries = settingsFields[tab].filter(key => {
    // 充值奖励档位按提交清洗后的值比较：两边都先清洗（未返回/未填都归一为空数组），只加了空行的草稿与已保存值相同，不算改动。
    if (key === 'payment_recharge_bonus_tiers') return JSON.stringify(sanitizeRechargeBonusTiersForSubmit(draft.payment_recharge_bonus_tiers)) !== JSON.stringify(sanitizeRechargeBonusTiersForSubmit(saved.payment_recharge_bonus_tiers));
    return JSON.stringify(draft[key]) !== JSON.stringify(saved[key]);
  });
  // 站点类型由 subscription_enabled 与 payment_balance_disabled 两个开关派生，分属功能 / 支付两个 tab；
  // 任一变化时两个字段一起提交，避免改完站点类型切 tab 保存只带走其中一个。
  // 只在功能 / 支付两个计费相关 tab 生效：其他 tab（邮件等）保存时不应把计费字段带进 patch，
  // 否则后端未返回这些字段的场景下会误触发“配置不完整”报错、阻断无关 tab 的保存。
  if (tab === 'admin_features' || tab === 'admin_payment') {
    const billingModeFields = ['subscription_enabled', 'payment_balance_disabled'] as const;
    if (billingModeFields.some(key => JSON.stringify(draft[key]) !== JSON.stringify(saved[key]))) {
      for (const key of billingModeFields) if (!entries.includes(key) && JSON.stringify(draft[key]) !== JSON.stringify(saved[key])) entries.push(key);
    }
  }
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
  return Object.fromEntries(entries.map(key => [key, key === 'payment_recharge_bonus_tiers' ? sanitizeRechargeBonusTiersForSubmit(draft.payment_recharge_bonus_tiers) : JSON.parse(JSON.stringify(draft[key]))]));
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
  if (changed.includes('payment_recharge_bonus_mode') && !['bonus', 'discount'].includes(draft.payment_recharge_bonus_mode as string)) throw new Error('请选择支持的充值奖励模式。');
  if (changed.includes('payment_recharge_bonus_tiers')) {
    const tiers = draft.payment_recharge_bonus_tiers;
    if (!Array.isArray(tiers)) throw new Error('充值奖励档位无效。');
    if (tiers.length > MAX_RECHARGE_BONUS_TIERS) throw new Error(`充值奖励档位最多 ${MAX_RECHARGE_BONUS_TIERS} 个。`);
    const seen = new Set<string>();
    for (const tier of tiers) {
      // 未完成行（金额或比例留空）提交时丢弃，这里不报错。
      if (!tier || tier.min_amount === null || tier.bonus_percent === null) continue;
      if (typeof tier.min_amount !== 'number' || !Number.isFinite(tier.min_amount) || tier.min_amount < 0) throw new Error('档位金额须为不小于 0 的数字。');
      if (typeof tier.bonus_percent !== 'number' || !Number.isFinite(tier.bonus_percent) || tier.bonus_percent < 0 || tier.bonus_percent > MAX_RECHARGE_BONUS_PERCENT) throw new Error(`档位比例须在 0 至 ${MAX_RECHARGE_BONUS_PERCENT} 之间。`);
      if (draft.payment_recharge_bonus_mode === 'discount' && tier.bonus_percent >= 100) throw new Error('折扣模式下档位比例须小于 100。');
      if (Math.abs(Math.round(tier.min_amount * 100) - tier.min_amount * 100) > 1e-8 || Math.abs(Math.round(tier.bonus_percent * 100) - tier.bonus_percent * 100) > 1e-8) throw new Error('档位金额与比例最多保留两位小数。');
      const key = tier.min_amount.toFixed(2);
      if (seen.has(key)) throw new Error('档位金额不能重复。');
      seen.add(key);
    }
  }
  if (changed.some(k => ['payment_min_amount', 'payment_max_amount'].includes(k))) {
    if (typeof draft.payment_min_amount !== 'number' || typeof draft.payment_max_amount !== 'number') throw new Error('请先读取完整充值限额。');
    if (draft.payment_max_amount > 0 && draft.payment_min_amount > draft.payment_max_amount) throw new Error('最大充值金额不能小于最小充值金额。');
  }
  const enums: Record<string, string[]> = { payment_load_balance_strategy: ['round-robin', 'least-amount'], payment_cancel_rate_limit_unit: ['minute', 'hour', 'day'], payment_cancel_rate_limit_window_mode: ['rolling', 'fixed'] };
  for (const key of changed) if (enums[key] && !enums[key].includes(draft[key as keyof SettingsForm] as string)) throw new Error('请选择支持的支付策略。');
  if (changed.includes('payment_enabled_types') && (!Array.isArray(draft.payment_enabled_types) || draft.payment_enabled_types.some(t => typeof t !== 'string'))) throw new Error('支付提供方类型无效。');
}
