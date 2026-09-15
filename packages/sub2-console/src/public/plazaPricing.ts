import type { ModelPlazaGroup, PlazaModel } from '../api/modelPlaza';
import type { UserPricingInterval } from '../api/channels';
// Official 0.2.4 optional multiplier fields; local shared policy types remain untouched.
type Interval = UserPricingInterval & { input_multiplier?: number | null; output_multiplier?: number | null; cache_write_multiplier?: number | null; cache_read_multiplier?: number | null };
export const priceFields = [
  ['input_price', '输入'], ['output_price', '输出'], ['cache_write_price', '缓存写入 5m'],
  ['cache_write_1h_price', '缓存写入 1h'], ['cache_read_price', '缓存读取'],
] as const;
export function resolvePrices(iv: Interval, base: NonNullable<PlazaModel['pricing']>) {
  const price = (absolute: number | null | undefined, multiplier: number | null | undefined, fallback: number | null | undefined) => absolute ?? (fallback == null ? null : fallback * (multiplier ?? 1));
  return { ...iv, input_price: price(iv.input_price, iv.input_multiplier, base.input_price), output_price: price(iv.output_price, iv.output_multiplier, base.output_price),
    cache_write_price: price(iv.cache_write_price, iv.cache_write_multiplier, base.cache_write_price),
    cache_write_1h_price: iv.cache_write_1h_price ?? iv.cache_write_price ?? price(null, iv.cache_write_multiplier, base.cache_write_1h_price),
    cache_read_price: price(iv.cache_read_price, iv.cache_read_multiplier, base.cache_read_price) };
}
export function money(value: number | null | undefined, scale = 1, rate = 1) {
  if (value == null || !Number.isFinite(value) || !Number.isFinite(rate)) return '未提供';
  return '$' + (value * scale * rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 12 });
}
export function tierLabel(iv: UserPricingInterval) { return iv.tier_label || (iv.max_tokens == null ? `>${iv.min_tokens.toLocaleString()} Token` : `≤${iv.max_tokens.toLocaleString()} Token`); }
export function pricingRows(model: PlazaModel, group: ModelPlazaGroup) {
  const token = !model.pricing?.billing_mode || model.pricing.billing_mode === 'token';
  const groupRate = group.user_rate_multiplier ?? group.rate_multiplier;
  const independent = model.pricing?.billing_mode === 'image' && group.image_rate_independent;
  const rate = independent ? group.image_rate_multiplier ?? 1 : groupRate;
  const intervals = [...(model.pricing?.intervals || [])].sort((a, b) => a.min_tokens - b.min_tokens);
  // Backend supplies display prices. Do not discard returned tiers based on a group flag.
  const paid = intervals.length ? token ? intervals.map(iv => resolvePrices(iv, model.pricing!)) : intervals.filter(iv => iv.per_request_price != null) : model.pricing ? [model.pricing] : [];
  const official = [...(model.official_pricing?.intervals || [])].sort((a, b) => a.min_tokens - b.min_tokens);
  return { token, independent, rate, paid, official: official.length ? official : model.official_pricing ? [model.official_pricing] : [],
    periods: [{ label: '标准时段', rate }, ...(model.time_pricing?.periods || []).map(period => ({ label: `${period.start_time}–${period.end_time}`, rate: token ? Math.round(groupRate * period.multiplier * 1000) / 1000 : rate }))] };
}
