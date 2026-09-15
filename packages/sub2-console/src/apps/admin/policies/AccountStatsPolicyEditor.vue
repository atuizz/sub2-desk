<script setup lang="ts">
import type { AccountStatsPricingRule } from '../../../api/admin/channels'
import PricingPolicyEditor from './PricingPolicyEditor.vue'
defineProps<{ modelValue: AccountStatsPricingRule[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: AccountStatsPricingRule[]] }>()
function parseIds(value: string) { return value.trim() ? value.split(/[,，\s]+/).filter(Boolean).map(Number) : [] }
</script>
<template>
  <div class="stats-policies">
    <p>按分组与账号限定统计定价范围；每条规则分别维护价格。</p>
    <details v-for="(rule,i) in modelValue" :key="i" open>
      <summary>{{ rule.name || '新统计定价规则' }}</summary>
      <label>规则名称<input v-model="rule.name" /></label>
      <label>分组 ID（逗号分隔）<input :value="rule.group_ids.join(', ')" @change="rule.group_ids = parseIds(($event.target as HTMLInputElement).value)" /></label>
      <label>账号 ID（逗号分隔）<input :value="rule.account_ids.join(', ')" @change="rule.account_ids = parseIds(($event.target as HTMLInputElement).value)" /></label>
      <PricingPolicyEditor v-model="rule.pricing" />
      <button type="button" @click="emit('update:modelValue', modelValue.filter((_,j) => j !== i))">移除此统计规则</button>
    </details>
    <button type="button" @click="emit('update:modelValue', [...modelValue, { name: '', group_ids: [], account_ids: [], pricing: [] }])">添加统计定价规则</button>
  </div>
</template>
<style scoped>
.stats-policies { display: grid; gap: 12px; min-width: 0; } summary { cursor: pointer; font-weight: 600; padding: 10px 0; }
label { display: block; margin-bottom: 10px; color: var(--text-secondary); }
input { box-sizing: border-box; width: 100%; min-width: 0; margin-top: 5px; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--content-bg); color: var(--text-primary); }
button { padding: 6px 0; color: var(--accent); } p { color: var(--text-tertiary); line-height: 1.6; }
</style>
