<script setup lang="ts">
import { ref, computed } from 'vue'
import type { UpdatePolicyGroup } from '../../../types/admin-policies'
import { copy, changedFields } from './policy-contract'
const props=defineProps<{source:UpdatePolicyGroup;platform?:string}>()
const base=copy(props.source), draft=ref(copy(props.source))
const config=ref(copy(base.messages_dispatch_model_config || {}))
const exact=ref(Object.entries(config.value.exact_model_mappings || {}).map(([from,to])=>({from,to})))
const configTouched=ref(false),exactTouched=ref(false)
const messagesSupported=computed(()=>['openai','composite'].includes(props.platform || ''))
const reasoningSupported=computed(()=>['openai','anthropic','composite'].includes(props.platform || ''))
const levels=computed(()=>props.platform==='anthropic'?['low','medium','high','xhigh','max']:['minimal','low','medium','high','xhigh','max'])
function supported(key:keyof UpdatePolicyGroup){return Object.prototype.hasOwnProperty.call(base,key)}
function patch():UpdatePolicyGroup {
  const data=changedFields(base,draft.value)
  if(configTouched.value || exactTouched.value){
    if(!messagesSupported.value || !supported('messages_dispatch_model_config'))throw Error('当前分组不支持 Messages 映射配置。')
    const next=copy(config.value)
    if(exactTouched.value){
      const entries:Record<string,string>={}
      for(const row of exact.value){const from=row.from.trim(),to=row.to.trim();if(!from || !to || ['__proto__','constructor','prototype'].includes(from) || Object.prototype.hasOwnProperty.call(entries,from))throw Error('精确模型映射须完整且来源不能重复。');entries[from]=to}
      next.exact_model_mappings=entries
    }
    data.messages_dispatch_model_config=next
  }
  const changed=changedFields(base,{...base,...data})
  for(const key of ['max_reasoning_effort','max_reasoning_effort_over_limit','reasoning_effort_mappings'] as const){
    if(Object.prototype.hasOwnProperty.call(changed,key) && (!supported(key) || !reasoningSupported.value))throw Error('当前分组未返回该推理策略能力。')
  }
  if(changed.max_reasoning_effort!==undefined && changed.max_reasoning_effort!=='' && !levels.value.includes(changed.max_reasoning_effort))throw Error('该平台不支持所选推理上限。')
  if(changed.max_reasoning_effort_over_limit!==undefined && !['downgrade','deny'].includes(changed.max_reasoning_effort_over_limit))throw Error('请选择降级或拒绝请求。')
  if(changed.reasoning_effort_mappings){
    const seen=new Set<string>()
    for(const row of changed.reasoning_effort_mappings){
      const unchanged=base.reasoning_effort_mappings?.some(original=>JSON.stringify(original)===JSON.stringify(row))
      if(!unchanged && (!['none',...levels.value].includes(row.from) || ![...levels.value,'deny'].includes(row.to)))throw Error('请选择有效的来源与目标推理强度。')
      if(!unchanged && row.match_type && !['exact','prefix','suffix'].includes(row.match_type))throw Error('推理模型匹配方式无效。')
      const key=`${row.model?.trim().toLowerCase() || ''}:${row.model?.trim()?row.match_type || 'exact':''}:${row.from}`
      if(seen.has(key))throw Error('同一模型范围的来源推理强度不能重复。');seen.add(key)
    }
    changed.reasoning_effort_mappings=changed.reasoning_effort_mappings.map(row=>{
      if(base.reasoning_effort_mappings?.some(original=>JSON.stringify(original)===JSON.stringify(row)))return row
      const normalized={...row}
      if(!row.model?.trim()){delete normalized.model;delete normalized.match_type}
      else{normalized.model=row.model.trim();normalized.match_type=row.match_type || 'exact'}
      return normalized
    })
  }
  return changed
}
defineExpose({patch})
</script>
<template>
  <div class="policy-panel">
    <details v-if="messagesSupported"><summary>Messages 模型调度</summary>
      <fieldset :disabled="!supported('messages_dispatch_model_config')" class="policy-panel">
        <p v-if="!supported('messages_dispatch_model_config')">当前详情未返回模型调度配置，暂不可编辑。</p>
        <label v-for="[key,label] in ([['opus_mapped_model','Opus 目标模型'],['sonnet_mapped_model','Sonnet 目标模型'],['haiku_mapped_model','Haiku 目标模型']] as const)" :key="key">{{ label }}<input v-model="config[key]" @input="configTouched=true" placeholder="留空沿用服务端默认" /></label>
        <strong>精确模型覆盖</strong><div v-for="(row,i) in exact" :key="i" class="fields row"><label>Claude 模型<input v-model="row.from" @input="exactTouched=true" /></label><label>目标模型<input v-model="row.to" @input="exactTouched=true" /></label><button type="button" @click="exact.splice(i,1);exactTouched=true">移除映射</button></div>
        <button type="button" @click="exact.push({from:'',to:''});exactTouched=true">添加精确映射</button>
      </fieldset>
    </details>
    <details v-if="reasoningSupported"><summary>推理强度策略</summary>
      <div class="fields"><label>最高推理强度<select v-model="draft.max_reasoning_effort" :disabled="!supported('max_reasoning_effort')"><option value="">不限制</option><option v-for="level in levels" :key="level">{{ level }}</option></select></label>
      <label>超过上限时<select v-model="draft.max_reasoning_effort_over_limit" :disabled="!supported('max_reasoning_effort_over_limit')"><option value="downgrade">降至上限</option><option value="deny">拒绝请求</option></select></label></div>
      <fieldset :disabled="!supported('reasoning_effort_mappings')" class="policy-panel">
        <p>模型留空表示全部模型；同一模型范围可分别设置多种来源强度。</p>
        <div v-for="(row,i) in draft.reasoning_effort_mappings" :key="i" class="row fields">
          <label>模型范围<input v-model="row.model" placeholder="全部模型" /></label>
          <label>匹配方式<select v-model="row.match_type"><option value="exact">精确</option><option value="prefix">前缀</option><option value="suffix">后缀</option></select></label>
          <label>来源强度<select v-model="row.from"><option v-for="level in ['none',...levels]" :key="level">{{ level }}</option></select></label>
          <label>目标强度<select v-model="row.to"><option v-for="level in [...levels,'deny']" :key="level" :value="level">{{ level==='deny'?'拒绝请求':level }}</option></select></label>
          <button type="button" @click="draft.reasoning_effort_mappings?.splice(i,1)">移除规则</button>
        </div><button type="button" @click="(draft.reasoning_effort_mappings ||= []).push({from:'high',to:'medium'})">添加推理规则</button>
      </fieldset>
    </details>
  </div>
</template>
<style scoped src="./policy-panel.css"></style>
