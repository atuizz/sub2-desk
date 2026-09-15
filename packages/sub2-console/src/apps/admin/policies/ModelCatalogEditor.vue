<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import type { ChannelModelPricing } from '../../../api/admin/channels'
import { syncPricingModels } from '../../../api/admin/channels'
import { newPricing } from './policy-contract'
const props=defineProps<{modelValue:ChannelModelPricing[]}>()
const emit=defineEmits<{'update:modelValue':[value:ChannelModelPricing[]]}>()
const platform=ref('openai'),loadedPlatform=ref(''),candidates=ref<string[]>([]),selected=ref<string[]>([]),loading=ref(false),error=ref(''),notice=ref('')
let alive=true
onUnmounted(()=>{alive=false})
function covered(model:string,p:string){return props.modelValue.some(row=>row.platform===p && row.models.some(m=>m.toLowerCase()===model.toLowerCase() || m.endsWith('*') && model.toLowerCase().startsWith(m.slice(0,-1).toLowerCase())))}
async function sync(){
  if(loading.value || !platform.value.trim())return
  const target=platform.value.trim();loading.value=true;error.value='';notice.value='';candidates.value=[];selected.value=[];loadedPlatform.value=''
  try{
    const data=await syncPricingModels(target)
    if(!alive || platform.value.trim()!==target)return
    if(!Array.isArray(data.models) || data.models.some(m=>typeof m!=='string'))throw Error('模型目录响应不完整。')
    candidates.value=[...new Map(data.models.filter(m=>m.trim()).map(m=>[m.toLowerCase(),m])).values()].filter(m=>!covered(m,target));loadedPlatform.value=target
    notice.value=candidates.value.length?`发现 ${candidates.value.length} 个未配置模型，请选择后加入草稿。`:'没有新的未配置模型。'
  }catch(e){if(alive)error.value=e instanceof Error?e.message:'同步失败，请重试。'}finally{if(alive)loading.value=false}
}
function addSelected(){
  if(loading.value || !loadedPlatform.value || loadedPlatform.value!==platform.value.trim())return
  const models=selected.value.filter(m=>candidates.value.includes(m) && !covered(m,loadedPlatform.value))
  if(!models.length){notice.value='请选择尚未配置的模型。';return}
  emit('update:modelValue',[...props.modelValue,{...newPricing(),platform:loadedPlatform.value,models}])
  candidates.value=candidates.value.filter(m=>!models.includes(m));selected.value=[];notice.value=`已加入 ${models.length} 个模型；保存渠道后生效。`
}
</script>
<template>
  <details class="policy-panel"><summary>同步价格目录中的模型</summary>
    <label>平台<select v-model="platform" :disabled="loading"><option v-for="p in ['openai','anthropic','gemini','antigravity','grok','deepseek','kimi','zhipu']" :key="p">{{ p }}</option></select></label>
    <button type="button" :disabled="loading" @click="sync">{{ loading?'正在同步…':'读取最新模型目录' }}</button>
    <p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="loadedPlatform===platform && candidates.length"><div class="actions"><button type="button" @click="selected=[...candidates]">全选</button><button type="button" @click="selected=[]">取消选择</button></div>
      <div style="max-height:180px;overflow:auto"><label v-for="model in candidates" :key="model"><input v-model="selected" type="checkbox" :value="model" />{{ model }}</label></div>
      <button type="button" :disabled="!selected.length" @click="addSelected">将所选模型加入定价草稿</button>
    </template>
  </details>
</template>
<style scoped src="./policy-panel.css"></style>
