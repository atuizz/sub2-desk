<script setup lang="ts">
import { ref } from 'vue'
import type { UpdatePolicyGroup } from '../../../types/admin-policies'
import { copy,changedFields,validateGroup,validatePricing } from './policy-contract'
import PolicyNumber from './PolicyNumber.vue'
import PricingPolicyEditor from './PricingPolicyEditor.vue'
const props=defineProps<{source:UpdatePolicyGroup;platform?:string;creating?:boolean}>()
const base=copy(props.source),draft=ref(copy(props.source))
const videoRows=ref(Object.entries(base.video_model_prices || {}).flatMap(([model,tiers])=>Object.entries(tiers).map(([resolution,price])=>({model,resolution,price}))))
const videoTouched=ref(false)
const imageNumbers=[['image_rate_multiplier','图片独立倍率'],['batch_image_discount_multiplier','批量图片折扣倍率'],['batch_image_hold_multiplier','批量图片预扣倍率'],['image_price_1k','1K 图片（美元/张）'],['image_price_2k','2K 图片（美元/张）'],['image_price_4k','4K 图片（美元/张）']] as const
const videoNumbers=[['video_rate_multiplier','视频独立倍率'],['video_price_480p','480p（美元/秒）'],['video_price_720p','720p（美元/秒）'],['video_price_1080p','1080p（美元/秒）']] as const
const audioNumbers=[['search_price_per_1k','搜索（美元/千次）'],['audio_realtime_price_per_min','Realtime（美元/分钟）'],['audio_tts_price_per_million_chars','TTS（美元/百万字符）'],['audio_stt_price_per_hour','STT（美元/小时）']] as const
function available(key:keyof UpdatePolicyGroup){return !!props.creating || Object.prototype.hasOwnProperty.call(base,key)}
function patch():UpdatePolicyGroup{
  const result=changedFields(base,draft.value)
  if(videoTouched.value){
    if(props.platform!=='grok'||!available('video_model_prices'))throw Error('该分组不支持视频模型定价。')
    const prices:Record<string,Record<string,number>>={}
    for(const row of videoRows.value){const model=row.model.trim(),resolution=row.resolution.trim();if(!model||!resolution||[model,resolution].some(v=>['__proto__','constructor','prototype'].includes(v)))throw Error('请填写有效的视频模型与分辨率。');if(!Number.isFinite(row.price)||row.price<0)throw Error('视频单价必须为非负数字。');prices[model] ||= {};if(Object.prototype.hasOwnProperty.call(prices[model],resolution))throw Error('同模型分辨率不能重复。');prices[model][resolution]=row.price}
    result.video_model_prices=prices
  }
  validateGroup(result)
  for(const key of ['image_rate_multiplier','video_rate_multiplier','batch_image_discount_multiplier','batch_image_hold_multiplier','peak_rate_multiplier'] as const)if(result[key]===null)throw Error('倍率不能留空；如需保持原值请取消该项修改。')
  if(result.model_pricing)validatePricing(result.model_pricing)
  if(result.peak_start!==undefined||result.peak_end!==undefined||result.peak_rate_enabled){
    if(draft.value.peak_rate_enabled && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.value.peak_start || '') || !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.value.peak_end || '') || draft.value.peak_start===draft.value.peak_end))throw Error('高峰时段请使用不同的 HH:mm 开始与结束时间。')
  }
  return changedFields(base,{...base,...result})
}
defineExpose({patch})
</script>
<template><div class="policy-panel">
<details v-if="['openai','gemini','antigravity','grok','composite'].includes(platform || '')"><summary>图片与批量图片定价</summary><div class="actions"><label v-for="[key,label] in ([['allow_image_generation','允许图片生成'],['allow_batch_image_generation','允许批量图片生成'],['image_rate_independent','图片使用独立倍率']] as const)" :key="key"><input v-model="draft[key]" type="checkbox" :disabled="!available(key)" />{{ label }}</label></div><div class="fields"><fieldset v-for="[key,label] in imageNumbers" :key="key" :disabled="!available(key)"><PolicyNumber v-model="draft[key]" :label="label" /></fieldset></div></details>
<details v-if="platform==='grok'"><summary>视频分辨率与模型单价</summary><label><input v-model="draft.video_rate_independent" type="checkbox" :disabled="!available('video_rate_independent')" />视频使用独立倍率</label><div class="fields"><fieldset v-for="[key,label] in videoNumbers" :key="key" :disabled="!available(key)"><PolicyNumber v-model="draft[key]" :label="label" /></fieldset></div><fieldset :disabled="!available('video_model_prices')"><div v-for="(row,i) in videoRows" :key="i" class="row fields"><label>模型族<input v-model="row.model" @input="videoTouched=true" placeholder="grok-imagine-video" /></label><label>分辨率<input v-model="row.resolution" @input="videoTouched=true" placeholder="720p" /></label><label>美元 / 秒<input v-model.number="row.price" type="number" min="0" step="any" @input="videoTouched=true" /></label><button type="button" @click="videoRows.splice(i,1);videoTouched=true">移除档位</button></div><button type="button" @click="videoRows.push({model:'grok-imagine-video',resolution:'720p',price:0});videoTouched=true">添加模型分辨率档位</button></fieldset></details>
<details v-if="platform==='grok'"><summary>搜索与音频单价</summary><div class="fields"><fieldset v-for="[key,label] in audioNumbers" :key="key" :disabled="!available(key)"><PolicyNumber v-model="draft[key]" :label="label" /></fieldset></div></details>
<details v-if="available('web_search_price_per_call')"><summary>联网搜索单价</summary><PolicyNumber v-model="draft.web_search_price_per_call" label="联网搜索（美元/次）" /></details>
<details><summary>逐模型定价</summary><fieldset :disabled="!available('model_pricing')"><PricingPolicyEditor :model-value="draft.model_pricing || []" @update:model-value="draft.model_pricing=$event" /></fieldset></details>
<details v-if="available('peak_rate_enabled')"><summary>高峰费率</summary><label><input v-model="draft.peak_rate_enabled" type="checkbox" />启用高峰倍率</label><div class="fields"><label>开始时间<input v-model="draft.peak_start" type="time" /></label><label>结束时间<input v-model="draft.peak_end" type="time" /></label><PolicyNumber v-model="draft.peak_rate_multiplier" label="高峰倍率" /></div></details>
<p>单价留空使用默认值，零表示免费。灰色项表示当前详情未返回此字段。计费仍由服务端执行。</p>
</div></template>
<style scoped src="./policy-panel.css"></style>
