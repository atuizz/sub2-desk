<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { MacButton, MacSheet, useWindowManager } from '@sub2-mac/core';
import PlazaComparison from '@/public/PlazaComparison.vue';
import type { UserSupportedModel } from '@/api/channels';
import type { ModelPlazaGroup, PlazaModel } from '@/api/modelPlaza';

const props = defineProps<{ model: UserSupportedModel | PlazaModel | null; group?: ModelPlazaGroup }>();
const emit = defineEmits<{ close: [] }>();
const wm = useWindowManager();
const copyState = ref('');
const copying = ref(false);
watch(() => props.model, () => { copyState.value = ''; });
const comparisonGroup = computed<ModelPlazaGroup|null>(()=>props.group&&props.model?{...props.group,models:[{...props.model,official_pricing:'official_pricing' in props.model?props.model.official_pricing:null}]}:null);
const mode = computed(() => props.model?.pricing?.billing_mode || 'token');
const rate = computed(() => mode.value === 'image' && props.group?.image_rate_independent
  ? props.group.image_rate_multiplier : props.group?.user_rate_multiplier ?? props.group?.rate_multiplier ?? 1);
const plazaModel = computed(() => props.model as PlazaModel | null);
const fields = [
  { key: 'input_price', label: '输入' }, { key: 'output_price', label: '输出' },
  { key: 'cache_write_price', label: '缓存写入 · 5 分钟' },
  { key: 'cache_write_1h_price', label: '缓存写入 · 1 小时' },
  { key: 'cache_read_price', label: '缓存读取' },
] as const;
const tiers = computed(() => {
  const sorted = [...(props.model?.pricing?.intervals || [])].sort((a, b) => a.min_tokens - b.min_tokens);
  return props.group?.long_context_pricing_enabled === false ? sorted.slice(0, 1) : sorted;
});
function price(value: number | null | undefined, token = true, multiplier = rate.value) {
  if (value == null || !Number.isFinite(value)) return '未提供';
  return `$${(value * (token ? 1_000_000 : 1) * multiplier).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}`;
}
async function copyName() {
  if (!props.model || copying.value) return;
  const model = props.model;
  copying.value = true;
  try {
    await navigator.clipboard.writeText(model.name);
    if (props.model === model) copyState.value = '模型名称已复制';
  } catch { if (props.model === model) copyState.value = '复制失败，请选中上方模型名称手动复制。'; }
  finally { copying.value = false; }
}
</script>

<template>
  <MacSheet :show="model !== null" title="模型定价" @close="emit('close')">
    <div v-if="model" class="pricing-inspector">
      <div class="pricing-identity"><strong>{{ model.name }}</strong><span>{{ group?.name || model.platform }} · {{ { token: '按 Token', per_request: '按次', image: '按图片', video: '按视频' }[mode] }}</span></div>
      <PlazaComparison v-if="comparisonGroup" :group="comparisonGroup" hide-model-identity />
      <template v-else>
      <p v-if="group" class="pricing-note">标准时段 · 已计入{{ mode === 'image' && group.image_rate_independent ? '图片独立' : '分组' }}倍率 ×{{ rate }}</p>
      <p v-else class="pricing-note">渠道基础单价，实付还需结合密钥分组倍率。</p>
      <p v-if="!model.pricing">暂未提供定价，请联系管理员确认。</p>
      <template v-else>
        <table v-if="mode === 'token'" class="pricing-table">
          <thead><tr><th>每 100 万 Token</th><th>{{ group ? '分组价格' : '渠道单价' }}</th><th v-if="plazaModel?.official_pricing">官方参考</th></tr></thead>
          <tbody><tr v-for="field in fields" :key="field.key"><th>{{ field.label }}</th><td>{{ price(model.pricing[field.key]) }}</td><td v-if="plazaModel?.official_pricing">{{ price(plazaModel.official_pricing[field.key], true, 1) }}</td></tr></tbody>
        </table>
        <dl v-else class="pricing-facts"><dt>{{ mode === 'image' ? '每张图片' : '每次请求' }}</dt><dd>{{ price(model.pricing.per_request_price, false) }}</dd></dl>
        <details v-if="tiers.length" open>
          <summary>上下文阶梯{{ group?.long_context_pricing_enabled === false ? '（仅最低档生效）' : '' }}</summary>
          <p class="pricing-note">{{ plazaModel?.long_context_basis === 'marginal' ? '仅超出阈值部分按对应档位计费。' : '整单按所在档位单价计费。' }}</p>
          <div class="pricing-tier" v-for="(tier, index) in tiers" :key="index">
            <strong>{{ tier.tier_label || `${tier.min_tokens} – ${tier.max_tokens ?? '∞'} Token` }}</strong>
            <template v-if="mode === 'token'"><span v-for="field in fields" :key="field.key">{{ field.label }}：{{ price(tier[field.key] ?? model.pricing[field.key]) }} / 1M</span></template>
            <span v-else>{{ price(tier.per_request_price, false) }} / {{ mode === 'image' ? '张' : '次' }}</span>
          </div>
        </details>
        <div v-if="plazaModel?.time_pricing?.periods.length">
          <h4>分时倍率</h4><p class="pricing-note">{{ plazaModel.time_pricing.timezone }}{{ plazaModel.time_pricing.weekdays_only ? ' · 仅工作日' : '' }}</p>
          <dl class="pricing-facts" v-for="(period, index) in plazaModel.time_pricing.periods" :key="index"><dt>{{ period.start_time }} – {{ period.end_time }}</dt><dd>额外 ×{{ period.multiplier }}</dd></dl>
        </div>
        <p v-if="group?.peak_rate_enabled" class="pricing-note">高峰 {{ group.peak_start }} – {{ group.peak_end }} 额外 ×{{ group.peak_rate_multiplier }}（按站点时区）。</p>
      </template>
      </template>
      <p v-if="copyState" role="status">{{ copyState }}</p>
    </div>
    <template #footer><MacButton @click="emit('close')">完成</MacButton><MacButton v-if="wm" @click="wm.openApp('keychain'); emit('close')">管理密钥</MacButton><MacButton variant="primary" :loading="copying" @click="copyName">复制模型名称</MacButton></template>
  </MacSheet>
</template>

<style scoped>
.pricing-inspector { display:grid;gap:14px;font-size:12px;line-height:1.6;min-width:0; }
.pricing-identity { display:grid;gap:4px; }.pricing-identity strong { font-size:16px;overflow-wrap:anywhere;user-select:text; }.pricing-identity span,.pricing-note { color:var(--text-secondary);font-size:11px; }
.pricing-table { width:100%;border-collapse:collapse;font-size:11px; }.pricing-table th,.pricing-table td { padding:8px 4px;border-bottom:1px solid var(--border-subtle);text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere; }.pricing-table th:first-child { text-align:left;font-weight:500; }.pricing-table thead { color:var(--text-secondary); }
.pricing-facts { display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--border-subtle); }.pricing-facts dd { font-variant-numeric:tabular-nums; }
summary { cursor:pointer;font-weight:600; } .pricing-tier { display:grid;gap:4px;padding:10px 0;border-bottom:1px solid var(--border-subtle);font-variant-numeric:tabular-nums; }.pricing-tier span { font-size:11px; }
</style>
