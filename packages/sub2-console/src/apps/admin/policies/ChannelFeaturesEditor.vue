<script setup lang="ts">
import { computed } from 'vue'
const props=defineProps<{modelValue?:Record<string,unknown>}>()
const emit=defineEmits<{'update:modelValue':[value:Record<string,unknown>]}>()
const features=[
  {key:'web_search_emulation',platform:'anthropic',name:'Anthropic 联网搜索模拟',hint:'为 Anthropic 渠道启用联网搜索模拟。'},
  {key:'codex_image_generation_bridge',platform:'openai',name:'OpenAI Codex 图片生成桥接',hint:'允许 Codex 图片生成请求使用渠道桥接。'},
  {key:'bedrock_cc_compat',platform:'anthropic',name:'Bedrock Claude Code 兼容',hint:'为 Anthropic 渠道启用 Bedrock / Claude Code 兼容。'},
] as const
function enabled(key:string,platform:string){const value=props.modelValue?.[key];return typeof value==='boolean'?value:!!(value && typeof value==='object' && !Array.isArray(value) && (value as Record<string,unknown>)[platform]===true)}
function editable(key:string){const value=props.modelValue?.[key];return value==null || typeof value==='boolean' || typeof value==='object' && !Array.isArray(value)}
function set(key:string,platform:string,value:boolean){
  if(!editable(key))return
  const previous=props.modelValue?.[key]
  // Preserve legacy boolean shape when it was actually returned, and unknown platform keys.
  const next=typeof previous==='boolean'?value:{...(previous as Record<string,unknown> || {}),[platform]:value}
  emit('update:modelValue',{...props.modelValue,[key]:next})
}
const unknownCount=computed(()=>Object.keys(props.modelValue || {}).filter(key=>!features.some(f=>f.key===key)).length)
</script>
<template>
  <details class="policy-panel"><summary>渠道功能</summary>
    <div v-for="feature in features" :key="feature.key" class="row">
      <label><input type="checkbox" :disabled="!editable(feature.key)" :checked="enabled(feature.key,feature.platform)" @change="set(feature.key,feature.platform,($event.target as HTMLInputElement).checked)" />{{ feature.name }}</label>
      <p>{{ feature.hint }}</p><p v-if="!editable(feature.key)">此配置的格式暂不支持编辑，原值将保留。</p>
    </div><p v-if="unknownCount">另有 {{ unknownCount }} 项扩展配置保持原值。</p>
  </details>
</template>
<style scoped src="./policy-panel.css"></style>
