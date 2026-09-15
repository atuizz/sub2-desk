<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue'
import { MacAlertSheet } from '@sub2-mac/core'
import * as api from '../../../api/admin/users'
import type { AttributeDefinition } from '../../../types/admin-policies'
import { copy,validateAttributes } from './policy-contract'
import AttributeFields from './AttributeFields.vue'
const props=defineProps<{userIds:number[]}>()
const emit=defineEmits<{busy:[value:boolean];saved:[]}>()
const mode=ref<'limits'|'attributes'>('limits'),busy=ref(false),error=ref(''),notice=ref(''),definitions=ref<AttributeDefinition[]>([]),ready=ref(false)
const enabledIds=ref<number[]>([]),values=ref<Record<number,string>>({}),enableConcurrency=ref(false),enableRpm=ref(false),concurrency=ref<number|string>(''),rpm=ref<number|string>('')
const pending=ref<{mode:'limits'|'attributes';ids:number[];values:Record<number,string>;limits:api.BatchUpdateUserLimitsRequest}|null>(null)
const failedIds=ref<number[]>([])
let failedRequest: NonNullable<typeof pending.value> | null = null
let alive=true
onUnmounted(()=>{alive=false})
async function load(){ready.value=false;error.value='';try{const data=await api.listAttributeDefinitions();if(alive){if(!Array.isArray(data))throw Error('属性定义响应不完整。');definitions.value=data.filter(d=>d.enabled);ready.value=true}}catch(e){if(alive)error.value=e instanceof Error?e.message:'属性读取失败'}}
function prepare(retry=false){
  if(busy.value)return
  error.value='';notice.value=''
  try{
    if (retry) {
      if (!failedRequest || !failedIds.value.length) throw Error('没有可重试的失败项。')
      pending.value = { ...copy(failedRequest), ids: [...failedIds.value] }
      return
    }
    const ids=[...new Set(props.userIds)]
    if(!ids.length || ids.length>500 || ids.some(id=>!Number.isSafeInteger(id)||id<=0))throw Error('请选择 1–500 个用户。')
    const limits:api.BatchUpdateUserLimitsRequest={user_ids:ids,all:false},attrs:Record<number,string>={}
    if(mode.value==='limits'){
      for(const [enabled,value,key] of [[enableConcurrency.value,concurrency.value,'concurrency'],[enableRpm.value,rpm.value,'rpm_limit']] as const){if(!enabled)continue;if(String(value).trim()===''||!Number.isSafeInteger(Number(value))||Number(value)<0)throw Error('限制须为非负整数。');limits[key]=Number(value)}
      if(limits.concurrency===undefined&&limits.rpm_limit===undefined)throw Error('请至少选择一个要修改的限制。')
    }else{
      if(!ready.value)throw Error('属性定义未读取成功。')
      const selected=definitions.value.filter(d=>enabledIds.value.includes(d.id))
      if(!selected.length)throw Error('请选择要批量覆盖的属性。')
      for(const d of selected)attrs[d.id]=values.value[d.id]??''
      validateAttributes(selected,attrs)
    }
    pending.value={mode:mode.value,ids,values:copy(attrs),limits}
  }catch(e){error.value=e instanceof Error?e.message:'请检查输入'}
}
async function submit(){
  if(busy.value||!pending.value)return
  const request=copy(pending.value);busy.value=true;emit('busy',true);error.value='';notice.value=''
  try{
    if(request.mode==='limits'){failedIds.value=[];failedRequest=null;const result=await api.batchUpdateLimits(request.limits);if(alive)notice.value=`已更新 ${result.affected} 个用户的限制。`}
    else{
      const failed:number[]=[];let succeeded=0
      // Official API has batch READ only. Attribute writes use per-user PUT, bounded sequentially.
      for(const id of request.ids){if(!alive)break;try{await api.updateAttributeValues(id,request.values);succeeded++}catch{failed.push(id)}}
      if(alive){failedIds.value=failed;failedRequest=failed.length?copy(request):null;notice.value=`属性更新成功 ${succeeded} 个，失败 ${failed.length} 个。`;if(failed.length)error.value=`未完成用户 ID：${failed.join(', ')}。可仅重试失败项。`}
    }
    if(alive){pending.value=null;emit('saved')}
  }catch(e){if(alive)error.value=e instanceof Error?e.message:'批量保存失败'}finally{busy.value=false;emit('busy',false)}
}
onMounted(load)
</script>
<template><section class="policy-panel"><p>已选 {{ userIds.length }} 个用户。仅更新显式选择的字段。</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><fieldset :disabled="busy" class="policy-panel"><label>操作<select v-model="mode"><option value="limits">并发 / RPM 限制</option><option value="attributes">覆盖指定属性</option></select></label>
<template v-if="mode==='limits'"><label><input v-model="enableConcurrency" type="checkbox" />更新并发限制<input v-if="enableConcurrency" v-model="concurrency" type="number" min="0" step="1" /></label><label><input v-model="enableRpm" type="checkbox" />更新 RPM（0 不限）<input v-if="enableRpm" v-model="rpm" type="number" min="0" step="1" /></label></template>
<template v-else><button v-if="!ready" type="button" @click="load">重新读取属性定义</button><label v-for="d in definitions" :key="d.id"><input v-model="enabledIds" type="checkbox" :value="d.id" />修改 {{ d.name }}</label><AttributeFields :definitions="definitions.filter(d=>enabledIds.includes(d.id))" v-model="values" /><p>已勾选属性留空会清除值；未勾选属性保持原值。</p></template>
<button type="button" @click="prepare()">确认批量更新</button><button v-if="mode==='attributes' && failedIds.length" type="button" @click="prepare(true)">仅重试失败项</button></fieldset>
<MacAlertSheet :show="!!pending" title="批量更新用户？" :message="`将更新 ${pending?.ids.length || 0} 个用户的${pending?.mode==='limits'?'并发/RPM 限制':'已选属性'}。${error}`" :loading="busy" confirm-text="执行更新" @confirm="submit" @cancel="!busy && (pending=null)" /></section></template>
<style scoped src="./policy-panel.css"></style>
