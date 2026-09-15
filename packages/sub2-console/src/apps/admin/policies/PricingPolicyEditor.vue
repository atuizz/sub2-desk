<script setup lang="ts">
import type { ChannelModelPricing } from '../../../api/admin/channels'
import PolicyNumber from './PolicyNumber.vue'
import ModelCatalogEditor from './ModelCatalogEditor.vue'
import ModelDefaultPrices from './ModelDefaultPrices.vue'
import { tokenPrices, multipliers, newInterval, newPricing, models } from './policy-contract'
const props = defineProps<{ modelValue: ChannelModelPricing[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: ChannelModelPricing[]] }>()
function add() { emit('update:modelValue', [...props.modelValue, newPricing()]) }
function remove(index: number) { emit('update:modelValue', props.modelValue.filter((_,i) => i !== index)) }
</script>
<template>
  <div class="pricing-policies">
    <ModelCatalogEditor :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)" />
    <p>Token 价格单位：美元 / 百万 Token。按次价格为美元 / 次。留空沿用默认价格，零表示免费。</p>
    <details v-for="(p,i) in modelValue" :key="i" open>
      <summary>{{ p.platform }} · {{ p.models.join('、') || '新模型定价' }}</summary>
      <div class="fields">
        <label>平台<input v-model="p.platform" placeholder="openai" /></label>
        <label>模型（逗号分隔）<input :value="p.models.join(', ')" @change="p.models = models(($event.target as HTMLInputElement).value)" /></label>
        <label>计费方式<select v-model="p.billing_mode"><option value="token">Token</option><option value="per_request">按次</option><option value="image">图片</option><option value="video">视频</option></select></label>
      </div>
      <ModelDefaultPrices :pricing="p" />
      <div class="fields">
        <PolicyNumber v-for="[key,label] in tokenPrices" :key="key" v-model="p[key]" :label="label + '（$/百万 Token）'" :scale="1000000" />
        <PolicyNumber v-model="p.image_input_price" label="图片输入（$/百万 Token）" :scale="1000000" />
        <PolicyNumber v-model="p.image_output_price" label="图片输出（$/百万 Token）" :scale="1000000" />
        <PolicyNumber v-model="p.per_request_price" label="按次价格（美元）" />
        <PolicyNumber v-model="p.fast_multiplier" label="Fast 倍率" />
        <PolicyNumber v-model="p.flex_multiplier" label="Flex 倍率" />
        <PolicyNumber v-if="'max_reasoning_effort_multiplier' in p" v-model="p.max_reasoning_effort_multiplier" label="最高推理强度倍率" />
      </div>
      <details><summary>阶梯定价 · {{ p.intervals?.length || 0 }} 段</summary>
        <p>Token 按 (下限, 上限] 分段；图片与按次模式按档位名称匹配。</p>
        <div v-for="(iv,j) in p.intervals" :key="j" class="tier">
          <div class="fields">
            <label>档位名称<input v-model="iv.tier_label" placeholder="例如 1K" /></label>
            <PolicyNumber v-model="iv.min_tokens" label="Token 下限" integer />
            <PolicyNumber v-model="iv.max_tokens" label="Token 上限（空=无限）" integer />
            <PolicyNumber v-model="iv.sort_order" label="排序" integer />
            <PolicyNumber v-for="[key,label] in tokenPrices" :key="key" v-model="iv[key]" :label="label + '（$/百万 Token）'" :scale="1000000" />
            <PolicyNumber v-for="[key,label] in multipliers" :key="key" v-model="iv[key]" :label="label" />
            <PolicyNumber v-model="iv.per_request_price" label="档位按次价格（美元）" />
          </div>
          <button type="button" @click="p.intervals.splice(j,1)">移除此阶梯</button>
        </div>
        <button type="button" @click="(p.intervals ||= []).push(newInterval())">添加阶梯</button>
      </details>
      <details><summary>时段定价</summary>
        <label><input type="checkbox" :checked="!!p.time_pricing" @change="p.time_pricing = ($event.target as HTMLInputElement).checked ? { timezone: 'Asia/Shanghai', periods: [{ start_time: '09:00:00', end_time: '18:00:00', multiplier: 1 }] } : null" />启用时段定价</label>
        <template v-if="p.time_pricing">
          <label>时区<input v-model="p.time_pricing.timezone" placeholder="Asia/Shanghai" /></label>
          <label><input v-model="p.time_pricing.weekdays_only" type="checkbox" />仅工作日</label>
          <p>使用 HH:mm:ss；结束 00:00:00 表示日末，跨午夜请拆成两段。</p>
          <div v-for="(period,j) in p.time_pricing.periods" :key="j" class="tier fields">
            <label>开始时间<input v-model="period.start_time" placeholder="09:00:00" /></label>
            <label>结束时间<input v-model="period.end_time" placeholder="18:00:00" /></label>
            <PolicyNumber v-model="period.multiplier" label="时段倍率" />
            <button type="button" @click="p.time_pricing.periods.splice(j,1)">移除此时段</button>
          </div>
          <button type="button" @click="p.time_pricing.periods.push({ start_time: '18:00:00', end_time: '00:00:00', multiplier: 1 })">添加时段</button>
        </template>
      </details>
      <button type="button" class="remove" @click="remove(i)">移除此模型定价</button>
    </details>
    <button type="button" @click="add">添加模型定价</button>
  </div>
</template>
<style scoped>
.pricing-policies { min-width: 0; display: grid; gap: 10px; }
details { min-width: 0; border-top: 1px solid var(--border-color); padding-top: 10px; }
summary { font-weight: 600; cursor: pointer; overflow-wrap: anywhere; padding: 4px 0 10px; }
.fields { display: grid; grid-template-columns: repeat(auto-fit,minmax(145px,1fr)); gap: 10px; margin: 10px 0; }
label { display: block; min-width: 0; color: var(--text-secondary); }
input:not([type=checkbox]), select { box-sizing: border-box; width: 100%; min-width: 0; margin-top: 5px; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--content-bg); color: var(--text-primary); }
.tier { border-top: 1px dashed var(--border-color); margin-top: 10px; padding-top: 8px; }
button { color: var(--accent); padding: 7px 0; } .remove { color: var(--status-danger, #d64545); }
p { color: var(--text-tertiary); line-height: 1.6; margin: 5px 0; }
</style>
