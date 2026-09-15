<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue'
import * as api from '../../../api/admin/users'
import type { AttributeDefinition } from '../../../types/admin-policies'
import { copy,validateAttributes } from './policy-contract'
import AttributeFields from './AttributeFields.vue'
const props=defineProps<{disabled?:boolean}>()
const definitions=ref<AttributeDefinition[]>([]),values=ref<Record<number,string>>({}),ready=ref(false),loading=ref(false),error=ref('')
let alive=true
onUnmounted(()=>{alive=false})
async function load(){
  if(loading.value || props.disabled)return
  loading.value=true;ready.value=false;error.value=''
  try{const result=await api.listAttributeDefinitions();if(!alive)return;if(!Array.isArray(result))throw Error('属性定义响应不完整。');definitions.value=result.filter(d=>d.enabled);ready.value=true}
  catch(e){if(alive)error.value=e instanceof Error?e.message:'属性定义读取失败，请重试。'}finally{if(alive)loading.value=false}
}
function payload(){if(!ready.value)throw Error('用户属性尚未读取成功，请重试后再创建。');validateAttributes(definitions.value,values.value);return copy(values.value)}
defineExpose({payload})
onMounted(load)
</script>
<template><section class="policy-panel"><strong>用户属性</strong><p v-if="loading" role="status">读取属性定义…</p><p v-if="error" role="alert">{{ error }}</p><button v-if="!ready" type="button" :disabled="loading || disabled" @click="load">重试读取属性</button><fieldset :disabled="!ready || disabled"><AttributeFields :definitions="definitions" v-model="values" /></fieldset><p v-if="ready && !definitions.length">暂无已启用的属性。</p></section></template>
<style scoped src="./policy-panel.css"></style>
