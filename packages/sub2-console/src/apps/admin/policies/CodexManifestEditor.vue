<script setup lang="ts">
import { ref,onUnmounted } from 'vue'
import type { UpdatePolicyGroup } from '../../../types/admin-policies'
import { searchManifestAccounts } from '../../../api/admin/groups'
import { copy,changedFields } from './policy-contract'
const props=defineProps<{source:UpdatePolicyGroup;groupId?:number;platform?:string}>()
const base=copy(props.source.codex_models_manifest_config || {enabled:false,account_ids:[],fallback_to_scheduler:false})
const draft=ref(copy(base)),error=ref(''),search=ref(''),loading=ref(false),results=ref<{id:number;name:string}[]>([]),page=ref(1),total=ref(0),names=ref<Record<number,string>>({})
let alive=true,version=0
onUnmounted(()=>{alive=false;version++})
async function find(next=1){
  if(!props.groupId)return
  const current=++version;loading.value=true;error.value=''
  try{const data=await searchManifestAccounts(props.groupId,search.value,next);if(!alive||current!==version)return;results.value=data.items;page.value=next;total.value=data.total}
  catch(e){if(alive&&current===version){results.value=[];error.value=e instanceof Error?e.message:'账号搜索失败'}}finally{if(alive&&current===version)loading.value=false}
}
function add(account:{id:number;name:string}){if(!draft.value.account_ids.includes(account.id))draft.value.account_ids.push(account.id);names.value[account.id]=account.name}
function patch():UpdatePolicyGroup{
  if(!Object.keys(changedFields(base,draft.value)).length)return{}
  if(props.platform!=='openai'||!Object.prototype.hasOwnProperty.call(props.source,'codex_models_manifest_config'))throw Error('当前详情未返回 Codex manifest 配置能力。')
  if(draft.value.enabled&&!draft.value.account_ids.length)throw Error('启用 Codex manifest 前至少选择一个账号。')
  if(draft.value.account_ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(draft.value.account_ids).size!==draft.value.account_ids.length)throw Error('Manifest 账号 ID 必须为不重复的正整数。')
  return {codex_models_manifest_config:copy(draft.value)}
}
defineExpose({patch})
</script>
<template><details v-if="platform==='openai'" class="policy-panel"><summary>Codex 模型清单来源</summary><p v-if="!('codex_models_manifest_config' in source)">当前详情未返回此能力；请在已有分组详情支持后配置。</p><fieldset :disabled="!('codex_models_manifest_config' in source)" class="policy-panel"><label><input v-model="draft.enabled" type="checkbox" />从固定账号获取 Codex 模型清单</label><div v-for="(id,i) in draft.account_ids" :key="id" class="actions"><span>{{ names[id] || '#' + id }}</span><button type="button" @click="draft.account_ids.splice(i,1)">移除账号</button></div>
<label>搜索本分组 OpenAI 账号<input v-model="search" @keydown.enter.prevent="find()" /></label><button type="button" :disabled="loading || !groupId" @click="find()">搜索账号</button><p v-if="error" role="alert">{{ error }}</p><button v-for="account in results" :key="account.id" type="button" :disabled="draft.account_ids.includes(account.id)" @click="add(account)">{{ account.name }} #{{ account.id }} · 添加</button><div class="actions"><button type="button" :disabled="loading || page<=1" @click="find(page-1)">上一页</button><span>{{ page }} / {{ Math.max(1,Math.ceil(total/20)) }}</span><button type="button" :disabled="loading || page*20>=total" @click="find(page+1)">下一页</button></div>
<label><input v-model="draft.fallback_to_scheduler" type="checkbox" />固定账号不可用时回退到调度器</label></fieldset></details></template>
<style scoped src="./policy-panel.css"></style>
