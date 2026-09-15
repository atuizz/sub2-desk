<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { MacButton } from '@sub2-mac/core';
import type { ModelPlazaGroup } from '../api/modelPlaza';
import { money, priceFields, pricingRows, tierLabel } from './plazaPricing';
import type { UserPricingInterval } from '../api/channels';
const props = defineProps<{ group: ModelPlazaGroup; hideModelIdentity?: boolean }>();
const copying = ref(false); const copyStatus = ref(''); let generation = 0;
watch(() => props.group, () => { generation++; copying.value = false; copyStatus.value = ''; });
onBeforeUnmount(() => { generation++; });
async function copyName(name: string) {
  if (copying.value) return; const id = generation; copying.value = true; copyStatus.value = '';
  try { await navigator.clipboard.writeText(name); if (id === generation) copyStatus.value = '模型名称已复制'; }
  catch { if (id === generation) copyStatus.value = '复制失败，请手动选择模型名称。'; }
  finally { if (id === generation) copying.value = false; }
}
const models = computed(() => [...props.group.models].sort((a, b) => {
  const aToken = (a.pricing?.billing_mode || 'token') === 'token', bToken = (b.pricing?.billing_mode || 'token') === 'token';
  if (aToken !== bToken) return aToken ? -1 : 1;
  return (b.official_pricing?.output_price ?? -1) - (a.official_pricing?.output_price ?? -1) || b.name.localeCompare(a.name);
}).map(model => ({ model, ...pricingRows(model, props.group) })));
const label = (value: object) => 'min_tokens' in value ? tierLabel(value as UserPricingInterval) : '基础价';
</script>
<template>
  <section class="plaza-comparison" :aria-label="`${group.name}定价对比`">
    <p v-if="copyStatus" role="status">{{ copyStatus }}</p>
    <p>分组倍率 ×{{ group.rate_multiplier }}<span v-if="group.user_rate_multiplier != null"> · 当前用户倍率 ×{{ group.user_rate_multiplier }}</span> · {{ group.is_exclusive ? '专属分组' : '公开分组' }} · {{ group.subscription_type === 'subscription' ? '订阅' : '标准' }}</p>
    <p v-if="group.long_context_pricing_enabled === false">本组未启用长上下文阶梯；实付按服务端返回价格，官方阶梯仅供参考。</p>
    <p v-if="group.peak_rate_enabled">高峰 {{ group.peak_start }}–{{ group.peak_end }}（站点时区）额外 ×{{ group.peak_rate_multiplier }}；以下价格不包含高峰因子，重叠时段仍需叠乘。</p>
    <article v-for="entry in models" :key="`${entry.model.platform}:${entry.model.name}`">
      <h3 v-if="!hideModelIdentity">{{ entry.model.name }}</h3>
      <MacButton v-if="!hideModelIdentity" :disabled="copying" @click="copyName(entry.model.name)">复制模型名称</MacButton>
      <p>{{ entry.model.platform }} · {{ entry.token ? '美元 / 100 万 Token' : entry.model.pricing?.billing_mode === 'image' ? '美元 / 张' : '美元 / 次' }} · {{ entry.independent ? '图片独立倍率' : '生效倍率' }} ×{{ entry.rate }}</p>
      <p v-if="entry.model.long_context_basis">{{ entry.model.long_context_basis === 'marginal' ? '仅超出阈值部分按对应档位计费。' : '整单按所在档位单价计费。' }}</p>
      <p v-if="entry.model.time_pricing">分时价格时区：{{ entry.model.time_pricing.timezone }}{{ entry.model.time_pricing.weekdays_only ? ' · 仅工作日，周末使用标准时段' : '' }}</p>
      <p v-if="!entry.paid.length">暂未提供实付定价。</p>
      <div class="public-table-wrap"><table class="public-table"><caption>实付价格</caption><thead><tr><th>时段 / 档位</th><template v-if="entry.token"><th v-for="field in priceFields" :key="field[0]">{{ field[1] }}</th></template><th v-else>按{{ entry.model.pricing?.billing_mode === 'image' ? '张' : '次' }}价格</th></tr></thead><tbody><template v-for="period in entry.periods" :key="period.label"><tr v-for="(tier, index) in entry.paid" :key="index"><th>{{ period.label }} · {{ label(tier) }} · ×{{ period.rate }}</th><template v-if="entry.token"><td v-for="field in priceFields" :key="field[0]">{{ money(tier[field[0]], 1000000, period.rate) }}</td></template><td v-else>{{ money(tier.per_request_price, 1, period.rate) }}</td></tr></template></tbody></table></div>
      <div class="public-table-wrap"><table class="public-table"><caption>官方参考 · 美元 / 100 万 Token（不乘倍率）{{ entry.token ? '' : ' · 与按张/次不同量纲，不计算折扣' }}</caption><thead><tr><th>档位</th><th v-for="field in priceFields" :key="field[0]">{{ field[1] }}</th></tr></thead><tbody><tr v-for="(tier, index) in entry.official" :key="index"><th>{{ label(tier) }}</th><td v-for="field in priceFields" :key="field[0]">{{ money(tier[field[0]], 1000000) }}</td></tr><tr v-if="!entry.official.length"><td colspan="6">官方目录未提供参考价格。</td></tr></tbody></table></div>
    </article>
  </section>
</template>
<style scoped>
.plaza-comparison { min-width: 0; }.plaza-comparison .public-table-wrap{max-width:100%;overflow:auto}.plaza-comparison .public-table{width:100%;border-collapse:collapse;text-align:left;font-variant-numeric:tabular-nums}.plaza-comparison th,.plaza-comparison td{padding:8px;border-bottom:1px solid var(--border-subtle,#8883)}.plaza-comparison article { border-top: 1px solid var(--border-color, #8883); padding: 16px 0; }.plaza-comparison h3 { font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }.plaza-comparison p { font-size: 12px; margin: 8px 0; color: var(--text-secondary, #666); }.plaza-comparison caption { text-align: left; padding: 10px 0; font-weight: 600; }.plaza-comparison table { font-size: 12px; }.plaza-comparison td { white-space: nowrap; }
</style>
