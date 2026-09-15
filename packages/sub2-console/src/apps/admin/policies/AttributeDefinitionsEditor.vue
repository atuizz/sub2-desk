<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { MacAlertSheet } from '@sub2-mac/core'
import * as api from '../../../api/admin/users'
import type { AttributeDefinition, AttributeDefinitionInput } from '../../../types/admin-policies'
import { copy, changedFields } from './policy-contract'
import PolicyNumber from './PolicyNumber.vue'
const emit=defineEmits<{busy:[value:boolean]}>()
const rows=ref<AttributeDefinition[]>([]),ready=ref(false),loading=ref(false),busy=ref(false),error=ref(''),notice=ref('')
const editingId=ref<number|null>(null),pendingDelete=ref<AttributeDefinition|null>(null)
const types:AttributeDefinition['type'][]=['text','textarea','number','email','url','date','select','multi_select']
const blank=():AttributeDefinitionInput=>({key:'',name:'',description:'',type:'text',options:[],required:false,enabled:true,placeholder:'',display_order:0,validation:{}})
const form=ref(blank()),baseline=ref(blank())
let alive=true
onUnmounted(()=>{alive=false})
function lock(value:boolean){busy.value=value;emit('busy',value)}
function message(e:unknown){return e instanceof Error?e.message:'请求失败，请重试。'}
async function load(){
  if(loading.value || busy.value)return
  loading.value=true;ready.value=false;error.value=''
  try{const data=await api.listAttributeDefinitions(false);if(!alive)return;if(!Array.isArray(data))throw Error('属性定义响应不完整。');rows.value=data.sort((a,b)=>a.display_order-b.display_order);ready.value=true}
  catch(e){if(alive)error.value=`属性定义读取失败，暂不可修改。${message(e)}`}finally{if(alive)loading.value=false}
}
function reset(){editingId.value=null;form.value=blank();baseline.value=blank()}
function edit(row:AttributeDefinition){
  if(busy.value)return
  editingId.value=row.id
  form.value=copy({key:row.key,name:row.name,description:row.description,type:row.type,options:row.options || [],required:row.required,enabled:row.enabled,placeholder:row.placeholder,display_order:row.display_order,validation:row.validation || {}})
  baseline.value=copy(form.value);error.value='';notice.value=''
}
function payload(){
  const data=copy(form.value)
  if(!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(data.key) || !data.name.trim())throw Error('属性标识须以字母开头，只含字母、数字和下划线；名称不能为空。')
  if(!Number.isSafeInteger(data.display_order) || data.display_order<0)throw Error('排序须为非负整数。')
  if(['select','multi_select'].includes(data.type)){
    const seen=new Set<string>()
    if(!data.options.length)throw Error('选择型属性至少需要一个选项。')
    for(const option of data.options){if(!option.value.trim() || !option.label.trim() || seen.has(option.value))throw Error('选项值与名称不能为空，选项值不能重复。');seen.add(option.value)}
  }
  const v=data.validation
  if(v?.pattern){try{new RegExp(v.pattern)}catch{throw Error('校验正则表达式无效。')}}
  for(const [min,max] of [[v?.min,v?.max],[v?.min_length,v?.max_length]])if(min!=null && max!=null && min>max)throw Error('校验下限不能超过上限。')
  for(const value of [v?.min,v?.max])if(value!=null && !Number.isFinite(value))throw Error('数值限制须为有限数字。')
  for(const value of [v?.min_length,v?.max_length])if(value!=null && (!Number.isSafeInteger(value) || value<0))throw Error('长度限制须为非负整数。')
  return data
}
async function save(){
  if(!ready.value || busy.value)return
  error.value='';notice.value=''
  try{
    const data=payload();lock(true)
    let result:AttributeDefinition
    if(editingId.value==null)result=await api.createAttributeDefinition(data)
    else{const patch=changedFields(baseline.value,data);delete patch.key;if(!Object.keys(patch).length){notice.value='没有需要保存的更改。';return}result=await api.updateAttributeDefinition(editingId.value,patch)}
    if(!alive)return
    const index=rows.value.findIndex(row=>row.id===result.id);if(index<0)rows.value.push(result);else rows.value[index]=result
    rows.value.sort((a,b)=>a.display_order-b.display_order);reset();notice.value='属性定义已保存。'
  }catch(e){if(alive)error.value=message(e)}finally{lock(false)}
}
async function move(index:number,direction:number){
  if(!ready.value || busy.value || index+direction<0 || index+direction>=rows.value.length)return
  const reordered=[...rows.value];[reordered[index],reordered[index+direction]]=[reordered[index+direction],reordered[index]]
  lock(true);error.value=''
  try{
    await api.reorderAttributeDefinitions(reordered.map(row=>row.id))
    if(!alive)return
    rows.value=reordered;notice.value='属性顺序已保存。'
    try{
      const fresh=await api.listAttributeDefinitions(false)
      if(!alive)return
      if(!Array.isArray(fresh))throw Error('属性定义响应不完整。')
      rows.value=fresh.sort((a,b)=>a.display_order-b.display_order)
      const current=fresh.find(row=>row.id===editingId.value)
      if(current){if(form.value.display_order===baseline.value.display_order)form.value.display_order=current.display_order;baseline.value.display_order=current.display_order}
    }catch(e){if(alive){ready.value=false;error.value=`排序已保存，但重新读取失败；请刷新后继续编辑。${message(e)}`}}
  }catch(e){if(alive)error.value=message(e)}finally{lock(false)}
}
async function remove(){
  if(!ready.value || busy.value || !pendingDelete.value)return
  const id=pendingDelete.value.id;lock(true);error.value=''
  try{await api.deleteAttributeDefinition(id);if(!alive)return;rows.value=rows.value.filter(row=>row.id!==id);if(editingId.value===id)reset();pendingDelete.value=null;notice.value='属性定义已删除。'}catch(e){if(alive)error.value=message(e)}finally{lock(false)}
}
onMounted(load)
</script>
<template>
  <section class="policy-panel">
    <p v-if="loading" role="status">读取属性定义…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p>
    <button type="button" :disabled="busy || loading" @click="load">重新读取定义</button><p v-if="ready && !rows.length">暂无属性定义。</p>
    <div v-for="(row,i) in rows" :key="row.id" class="row"><strong>{{ row.name }}</strong><p>{{ row.key }} · {{ row.type }} · {{ row.enabled?'启用':'停用' }}{{ row.required?' · 必填':'' }}</p><div class="actions">
      <button type="button" :disabled="busy || !ready" @click="edit(row)">编辑</button><button type="button" :disabled="busy || !ready || i===0" @click="move(i,-1)">上移</button><button type="button" :disabled="busy || !ready || i===rows.length-1" @click="move(i,1)">下移</button><button type="button" :disabled="busy || !ready" @click="error='';pendingDelete=row">删除</button>
    </div></div>
    <form @submit.prevent="save"><fieldset :disabled="!ready || busy" class="policy-panel">
      <strong>{{ editingId==null?'添加属性定义':'编辑属性定义' }}</strong><div class="fields">
        <label>属性标识<input v-model="form.key" :disabled="editingId!=null" required pattern="[a-zA-Z][a-zA-Z0-9_]*" /></label><label>显示名称<input v-model="form.name" required /></label>
        <label>属性类型<select v-model="form.type"><option v-for="t in types" :key="t">{{ t }}</option></select></label><label>排序<input v-model.number="form.display_order" type="number" min="0" step="1" required /></label>
      </div><label>描述<input v-model="form.description" /></label><label>输入提示<input v-model="form.placeholder" /></label>
      <div class="actions"><label><input v-model="form.required" type="checkbox" />必填</label><label><input v-model="form.enabled" type="checkbox" />启用</label></div>
      <section v-if="form.type==='select' || form.type==='multi_select'" class="policy-panel"><strong>可选项</strong><div v-for="(option,i) in form.options" :key="i" class="fields"><label>选项值<input v-model="option.value" required /></label><label>显示名称<input v-model="option.label" required /></label><button type="button" @click="form.options.splice(i,1)">移除选项</button></div><button type="button" @click="form.options.push({value:'',label:''})">添加选项</button></section>
      <details v-if="form.validation"><summary>输入校验</summary><div class="fields">
        <PolicyNumber v-for="[key,label] in ([['min_length','最短长度'],['max_length','最长长度']] as const)" :key="key" :label="label" :model-value="form.validation[key]" integer @update:model-value="form.validation[key]=$event ?? undefined" />
        <label v-for="[key,label] in ([['min','最小数值'],['max','最大数值']] as const)" :key="key">{{ label }}<input type="number" step="any" :value="form.validation[key]" @input="form.validation[key]=($event.target as HTMLInputElement).value==='' ? undefined : Number(($event.target as HTMLInputElement).value)" /></label>
      </div><label>正则表达式<input v-model="form.validation.pattern" /></label><label>校验失败提示<input v-model="form.validation.message" /></label></details>
      <div class="actions"><button type="submit">保存属性定义</button><button type="button" @click="reset">新建 / 清空表单</button></div>
    </fieldset></form>
    <MacAlertSheet :show="!!pendingDelete" title="删除用户属性定义？" :message="`将删除「${pendingDelete?.name || ''}」及其关联的属性值。此操作无法撤销。${error ? ' 删除失败：' + error : ''}`" danger confirm-text="删除定义" :loading="busy" @confirm="remove" @cancel="!busy && (pendingDelete=null)" />
  </section>
</template>
<style scoped src="./policy-panel.css"></style>
