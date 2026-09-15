<script setup lang="ts">
import { ref, shallowRef, onUnmounted } from 'vue'
import { getModelDefaultPricing, type ModelDefaultPricing, type ChannelModelPricing } from '../../../api/admin/channels'
const props=defineProps<{pricing:ChannelModelPricing}>()
const model=ref(props.pricing.models[0] || ''),loading=ref(false),error=ref(''),notice=ref(''),result=ref<ModelDefaultPricing|null>(null),loadedModel=ref('')
const loadedPricing=shallowRef<ChannelModelPricing|null>(null)
let alive=true
onUnmounted(()=>{alive=false})
async function fetchPrices(){
  if(loading.value || !props.pricing.models.includes(model.value))return
  const target=model.value,targetPricing=props.pricing;loading.value=true;result.value=null;loadedModel.value='';error.value='';notice.value=''
  try{const data=await getModelDefaultPricing(target);if(!alive || props.pricing!==targetPricing || model.value!==target || !props.pricing.models.includes(target))return;if(!data.found){notice.value='该模型没有可用的默认价格。';return}result.value=data;loadedPricing.value=targetPricing;loadedModel.value=target;notice.value='已读取默认价，可填入当前定价的空白字段。已有价格（含零）保持不变。'}
  catch(e){if(alive)error.value=e instanceof Error?e.message:'默认价格读取失败，请重试。'}finally{if(alive)loading.value=false}
}
function apply(){
  if(loading.value || !result.value || loadedPricing.value!==props.pricing || model.value!==loadedModel.value || !props.pricing.models.includes(loadedModel.value))return
  const keys=['input_price','output_price','cache_write_price','cache_write_1h_price','cache_read_price','image_input_price','image_output_price','max_reasoning_effort_multiplier'] as const
  let count=0
  for(const key of keys){const value=result.value[key];if(props.pricing[key]==null && typeof value==='number' && Number.isFinite(value) && value>=0){props.pricing[key]=value;count++}}
  notice.value=`已填入 ${count} 个空白价格字段；保存后生效。`;result.value=null
}
</script>
<template>
  <details class="policy-panel"><summary>读取模型默认价格</summary>
    <label>参考模型<select v-model="model" :disabled="loading"><option value="">选择模型</option><option v-for="m in pricing.models" :key="m">{{ m }}</option></select></label>
    <button type="button" :disabled="loading || !pricing.models.includes(model)" @click="fetchPrices">{{ loading?'正在读取…':'查询默认价' }}</button>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <button v-if="result" type="button" :disabled="model!==loadedModel || !pricing.models.includes(loadedModel)" @click="apply">仅填充空白价格</button>
  </details>
</template>
<style scoped src="./policy-panel.css"></style>
