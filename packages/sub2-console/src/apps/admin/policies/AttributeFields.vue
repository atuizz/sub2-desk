<script setup lang="ts">
import type { AttributeDefinition } from '../../../types/admin-policies'
const props=defineProps<{definitions:AttributeDefinition[];modelValue:Record<number,string>;optional?:boolean}>()
const emit=defineEmits<{'update:modelValue':[value:Record<number,string>]}>()
function set(id:number,value:string){emit('update:modelValue',{...props.modelValue,[id]:value})}
function selected(id:number):string[]{try{const value=JSON.parse(props.modelValue[id] || '[]');return Array.isArray(value)?value:[]}catch{return[]}}
function toggle(id:number,value:string,checked:boolean){const values=selected(id);set(id,JSON.stringify(checked?[...new Set([...values,value])]:values.filter(v=>v!==value)))}
</script>
<template>
  <div class="policy-panel">
    <div v-for="d in definitions" :key="d.id"><label>{{ d.name }}{{ d.required && !optional?' *':'' }}
      <textarea v-if="d.type==='textarea'" :value="modelValue[d.id]" :required="d.required && !optional" :placeholder="d.placeholder" @input="set(d.id,($event.target as HTMLTextAreaElement).value)" />
      <select v-else-if="d.type==='select'" :value="modelValue[d.id] || ''" :required="d.required && !optional" @change="set(d.id,($event.target as HTMLSelectElement).value)"><option value="">未设置</option><option v-for="o in d.options" :key="o.value" :value="o.value">{{ o.label }}</option></select>
      <input v-else-if="d.type!=='multi_select'" :value="modelValue[d.id]" :type="d.type" :required="d.required && !optional" :placeholder="d.placeholder" :min="d.validation?.min" :max="d.validation?.max" :minlength="d.validation?.min_length" :maxlength="d.validation?.max_length" :pattern="d.validation?.pattern" step="any" @input="set(d.id,($event.target as HTMLInputElement).value)" />
    </label><fieldset v-if="d.type==='multi_select'"><legend>{{ d.name }}选项</legend><label v-for="o in d.options" :key="o.value"><input type="checkbox" :checked="selected(d.id).includes(o.value)" @change="toggle(d.id,o.value,($event.target as HTMLInputElement).checked)" />{{ o.label }}</label></fieldset>
    <p v-if="d.description">{{ d.description }}</p></div>
  </div>
</template>
<style scoped src="./policy-panel.css"></style>
