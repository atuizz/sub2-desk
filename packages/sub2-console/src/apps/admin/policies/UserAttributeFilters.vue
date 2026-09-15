<script setup lang="ts">
import { ref,onMounted,onUnmounted } from 'vue'
import * as api from '../../../api/admin/users'
import type { AttributeDefinition } from '../../../types/admin-policies'
const emit=defineEmits<{apply:[filters:Record<number,string>]}>()
const definitions=ref<AttributeDefinition[]>([]),filters=ref<Record<number,string>>({}),error=ref(''),loading=ref(false)
let alive=true
onUnmounted(()=>{alive=false})
async function load(){if(loading.value)return;loading.value=true;error.value='';try{const data=await api.listAttributeDefinitions();if(alive){if(!Array.isArray(data))throw Error('属性定义响应不完整。');definitions.value=data.filter(d=>d.enabled)}}catch(e){if(alive)error.value=e instanceof Error?e.message:'属性读取失败'}finally{if(alive)loading.value=false}}
function apply(){emit('apply',Object.fromEntries(Object.entries(filters.value).filter(([,v])=>v!=='')))}
function clear(){filters.value={};emit('apply',{})}
onMounted(load)
</script>
<template><details class="policy-panel"><summary>按用户属性筛选</summary><p v-if="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p><form @submit.prevent="apply"><fieldset :disabled="loading || !!error" class="fields"><label v-for="d in definitions" :key="d.id">{{ d.name }}<select v-if="d.type==='select' || d.type==='multi_select'" v-model="filters[d.id]"><option value="">不限</option><option v-for="o in d.options" :key="o.value" :value="o.value">{{ o.label }}</option></select><input v-else v-model="filters[d.id]" :type="d.type==='number'?'number':d.type==='date'?'date':'text'" placeholder="不限" step="any" /></label><button type="submit">应用属性筛选</button><button type="button" @click="clear">清除属性筛选</button></fieldset></form></details></template>
<style scoped src="./policy-panel.css"></style>
