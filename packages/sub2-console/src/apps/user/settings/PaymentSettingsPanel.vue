<script setup lang="ts">
import { MacGroupCard, MacToggle } from '@sub2-mac/core';
import { MAX_RECHARGE_BONUS_PERCENT, MAX_RECHARGE_BONUS_TIERS, type RechargeBonusTierDraft } from './settingsForm';
import type { SettingsForm } from './settingsForm';
const props = defineProps<{ draft: SettingsForm; saved: Partial<SettingsForm>; disabled: boolean }>();
const numbers = [
  ['payment_min_amount', '最小充值金额（CNY，0 为不限）', 0, 0.01],
  ['payment_max_amount', '最大充值金额（CNY，0 为不限）', 0, 0.01],
  ['payment_daily_limit', '每日充值限额（CNY，0 为不限）', 0, 0.01],
  ['payment_balance_recharge_multiplier', '余额充值倍率', 0.01, 0.01],
  ['payment_subscription_usd_to_cny_rate', '订阅 USD → CNY 汇率（0 为不换算）', 0, 0.01],
  ['payment_recharge_fee_rate', '充值手续费（%）', 0, 0.01],
  ['payment_order_timeout_minutes', '订单超时（分钟）', 1, 1],
  ['payment_max_pending_orders', '每用户待付款订单上限', 1, 1],
] as const;
const flags = [['payment_enabled', '启用在线支付'], ['payment_balance_disabled', '关闭余额充值'], ['payment_alipay_force_qrcode', '支付宝移动端使用二维码'], ['payment_alipay_mobile_precreate_deep_link', '支付宝移动端预下单并唤起应用']] as const;
const providers = [['easypay', '易支付'], ['alipay', '支付宝官方'], ['wxpay', '微信官方'], ['stripe', 'Stripe'], ['airwallex', 'Airwallex']] as const;
function toggleType(draft: SettingsForm, type: string, checked: boolean) {
  draft.payment_enabled_types = checked ? [...new Set([...draft.payment_enabled_types, type])] : draft.payment_enabled_types.filter(t => t !== type);
}
function bonusTiers(draft: SettingsForm): RechargeBonusTierDraft[] {
  if (!Array.isArray(draft.payment_recharge_bonus_tiers)) draft.payment_recharge_bonus_tiers = [];
  return draft.payment_recharge_bonus_tiers;
}
function addBonusTier(draft: SettingsForm) {
  const tiers = bonusTiers(draft);
  if (tiers.length >= MAX_RECHARGE_BONUS_TIERS) return;
  // 与上游草稿行一致：新增行两个值都留空，未填好的行保存时丢弃，不提交 0/0。
  tiers.push({ min_amount: null, bonus_percent: null });
}
function removeBonusTier(draft: SettingsForm, index: number) {
  bonusTiers(draft).splice(index, 1);
}
// 空输入与非法输入都记为 null（未完成），与上游 RechargeBonusTierEditor.parseNumberInput 同语义。
function parseTierInput(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
function setTierAmount(draft: SettingsForm, index: number, event: Event) {
  bonusTiers(draft)[index]!.min_amount = parseTierInput(event);
}
function setTierPercent(draft: SettingsForm, index: number, event: Event) {
  bonusTiers(draft)[index]!.bonus_percent = parseTierInput(event);
}
</script>

<template>
  <MacGroupCard title="支付开关、限额与订单">
    <fieldset class="payment-settings" :disabled="disabled">
      <label v-for="[key, label] in flags" :key="key" class="toggle-row">{{ label }}<MacToggle :model-value="draft[key] === true" :aria-label="label" :disabled="disabled || typeof saved[key] !== 'boolean'" @update:model-value="draft[key] = $event" /></label>
      <p class="hint">仅已读取的设置可编辑；金额为人民币，倍率影响到账余额。</p>
      <div class="fields">
        <label v-for="[key, label, min, step] in numbers" :key="key">{{ label }}<input v-model.number="draft[key]" :aria-label="label" type="number" :min="min" :step="step" :max="key === 'payment_recharge_fee_rate' ? 100 : undefined" :disabled="typeof saved[key] !== 'number'" /></label>
        <label>收款分配策略<select v-model="draft.payment_load_balance_strategy" :disabled="typeof saved.payment_load_balance_strategy !== 'string'"><option v-if="!['round-robin', 'least-amount'].includes(draft.payment_load_balance_strategy)" :value="draft.payment_load_balance_strategy">当前：{{ draft.payment_load_balance_strategy || '未读取' }}</option><option value="round-robin">轮流分配</option><option value="least-amount">优先累计收款较少的提供方</option></select></label>
      </div>
      <fieldset :disabled="!Array.isArray(saved.payment_enabled_types)"><legend>启用的收款提供方类型</legend><div class="checks"><label v-for="[key, label] in providers" :key="key"><input type="checkbox" :checked="Array.isArray(draft.payment_enabled_types) && draft.payment_enabled_types.includes(key)" @change="toggleType(draft, key, ($event.target as HTMLInputElement).checked)" />{{ label }}</label></div></fieldset>
      <details><summary>订单取消限制与付款说明</summary>
        <label class="toggle-row">限制频繁取消订单<MacToggle :model-value="draft.payment_cancel_rate_limit_enabled" :disabled="disabled || typeof saved.payment_cancel_rate_limit_enabled !== 'boolean'" @update:model-value="draft.payment_cancel_rate_limit_enabled = $event" /></label>
        <div class="fields">
          <label>最多取消次数<input v-model.number="draft.payment_cancel_rate_limit_max" type="number" min="1" step="1" :disabled="typeof saved.payment_cancel_rate_limit_max !== 'number'" /></label>
          <label>统计时长<input v-model.number="draft.payment_cancel_rate_limit_window" type="number" min="1" step="1" :disabled="typeof saved.payment_cancel_rate_limit_window !== 'number'" /></label>
          <label>时长单位<select v-model="draft.payment_cancel_rate_limit_unit" :disabled="typeof saved.payment_cancel_rate_limit_unit !== 'string'"><option value="minute">分钟</option><option value="hour">小时</option><option value="day">天</option></select></label>
          <label>统计窗口<select v-model="draft.payment_cancel_rate_limit_window_mode" :disabled="typeof saved.payment_cancel_rate_limit_window_mode !== 'string'"><option value="rolling">滚动窗口</option><option value="fixed">固定窗口</option></select></label>
          <label>商品名称前缀<input v-model="draft.payment_product_name_prefix" :disabled="typeof saved.payment_product_name_prefix !== 'string'" /></label>
          <label>商品名称后缀<input v-model="draft.payment_product_name_suffix" :disabled="typeof saved.payment_product_name_suffix !== 'string'" /></label>
        </div>
        <label>帮助图片 URL<input v-model="draft.payment_help_image_url" :disabled="typeof saved.payment_help_image_url !== 'string'" /></label>
        <label>付款帮助说明<textarea v-model="draft.payment_help_text" rows="3" :disabled="typeof saved.payment_help_text !== 'string'" /></label>
      </details>
      <fieldset class="bonus"><legend>充值奖励档位</legend>
        <p class="hint">满金额按比例赠金或打折；新增档位为空行，未填好的行保存时自动丢弃，不会提交 0/0；填好的行金额不可重复，最多 {{ MAX_RECHARGE_BONUS_TIERS }} 档。</p>
        <label>奖励模式<select v-model="draft.payment_recharge_bonus_mode" :disabled="typeof saved.payment_recharge_bonus_mode !== 'string'"><option v-if="!['bonus', 'discount'].includes(draft.payment_recharge_bonus_mode ?? '')" :value="draft.payment_recharge_bonus_mode">当前：{{ draft.payment_recharge_bonus_mode || '未读取' }}</option><option value="bonus">赠金（按比例额外赠送余额）</option><option value="discount">折扣（按比例减免实付金额，须小于 100%）</option></select></label>
        <p v-if="(draft.payment_recharge_bonus_tiers ?? []).length === 0" class="hint">暂无档位，点击「添加档位」新增一行。</p>
        <div v-for="(tier, index) in draft.payment_recharge_bonus_tiers ?? []" :key="index" class="tier-row">
          <label>满金额（CNY）<input :value="tier.min_amount ?? ''" type="number" min="0" step="0.01" aria-label="档位满金额" :disabled="!Array.isArray(saved.payment_recharge_bonus_tiers)" @input="setTierAmount(draft, index, $event)" /></label>
          <label>{{ draft.payment_recharge_bonus_mode === 'discount' ? '折扣（% OFF）' : '赠送比例（%）' }}<input :value="tier.bonus_percent ?? ''" type="number" min="0" :max="draft.payment_recharge_bonus_mode === 'discount' ? 99.99 : MAX_RECHARGE_BONUS_PERCENT" step="0.01" aria-label="档位比例" :disabled="!Array.isArray(saved.payment_recharge_bonus_tiers)" @input="setTierPercent(draft, index, $event)" /></label>
          <button type="button" class="row-btn" :disabled="disabled || !Array.isArray(saved.payment_recharge_bonus_tiers)" @click="removeBonusTier(draft, index)">删除</button>
        </div>
        <button type="button" class="row-btn" :disabled="disabled || !Array.isArray(saved.payment_recharge_bonus_tiers) || (draft.payment_recharge_bonus_tiers ?? []).length >= MAX_RECHARGE_BONUS_TIERS" @click="addBonusTier(draft)">添加档位</button>
        <label>活动文案（Markdown）<textarea v-model="draft.payment_recharge_bonus_notice" rows="3" :disabled="typeof saved.payment_recharge_bonus_notice !== 'string'" placeholder="例如：充值满 100 赠 20%，活动长期有效" /></label>
        <p class="hint">档位金额须 ≥ 0，比例须在 0–1000 之间（折扣须小于 100），金额与比例最多两位小数；未填好的行保存时丢弃，填好的非法行会阻止保存。</p>
      </fieldset>
    </fieldset>
  </MacGroupCard>
</template>

<style scoped>
.payment-settings { padding: 16px; display: grid; gap: 14px; min-width: 0; border: 0; }
fieldset { min-width: 0; border: 0; padding: 0; } label, legend, summary { font-size: 12px; } label { display: grid; gap: 5px; min-width: 0; } .hint { color: var(--text-secondary); font-size: 11px; }
.fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; } .toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
input:not([type=checkbox]), select, textarea { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); } :disabled { opacity: .6; }
.checks { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; } .checks label { display: flex; align-items: center; gap: 5px; } details > * { margin-top: 12px; } .bonus > * + * { margin-top: 12px; } .tier-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 14px; align-items: end; } .row-btn { padding: 7px 12px; border: 1px solid var(--border-subtle); border-radius: 7px; background: var(--bg-surface); color: var(--text-primary); cursor: pointer; font-size: 12px; } summary { cursor: pointer; } input:focus-visible, select:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid #007aff; outline-offset: 2px; }
@media(max-width: 600px) { .fields { grid-template-columns: minmax(0, 1fr); } }
</style>
