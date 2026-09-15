<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, useId } from 'vue';
import { MacButton } from '@sub2-mac/core';
import { getAll } from '../../api/admin/groups';
import { adminError } from './admin-feedback';
import type { AdminGroup, AnnouncementTargeting, AnnouncementCondition, AnnouncementConditionType } from '@/types';
const props = defineProps<{ modelValue: AnnouncementTargeting; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: AnnouncementTargeting): void; (e: 'validation', value: string): void }>();
const id = useId();
const groups = ref<AdminGroup[]>([]), loading = ref(false), error = ref(''), groupSearch = ref('');
let version = 0;
const anyOf = computed(() => props.modelValue.any_of ?? []);
const filteredGroups = computed(() => groups.value.filter(g => `${g.name} ${g.id}`.toLowerCase().includes(groupSearch.value.toLowerCase())));
async function loadGroups() {
  const request = ++version;
  loading.value = true; error.value = '';
  try {
    const all = await getAll();
    if (request === version) groups.value = all.filter(g => g.subscription_type === 'subscription');
  } catch (err) { if (request === version) error.value = adminError(err, '套餐加载失败，请重试。'); }
  finally { if (request === version) loading.value = false; }
}
onMounted(loadGroups);
onUnmounted(() => { version++; });
function update(mutator: (draft: AnnouncementTargeting) => void) {
  if (props.disabled) return;
  const draft = JSON.parse(JSON.stringify(props.modelValue)) as AnnouncementTargeting;
  draft.any_of ??= [];
  mutator(draft); emit('update:modelValue', draft);
}
function defaultCondition(type: AnnouncementConditionType = 'subscription'): AnnouncementCondition {
  return type === 'subscription' ? { type, operator: 'in', group_ids: [] } : { type, operator: 'gte', value: 0 };
}
function setMode(mode: string) {
  if (mode === 'all') update(d => { d.any_of = []; });
  else if (!anyOf.value.length) addGroup();
}
function addGroup() { update(d => { if (d.any_of!.length < 50) d.any_of!.push({ all_of: [defaultCondition()] }); }); }
function removeGroup(index: number) { update(d => { d.any_of!.splice(index, 1); }); }
function addCondition(gi: number) { update(d => { const g = d.any_of![gi]; g.all_of ??= []; if (g.all_of.length < 50) g.all_of.push(defaultCondition()); }); }
function removeCondition(gi: number, ci: number) { update(d => { d.any_of![gi].all_of!.splice(ci, 1); }); }
function setType(gi: number, ci: number, type: AnnouncementConditionType) { update(d => { d.any_of![gi].all_of![ci] = defaultCondition(type); }); }
function patchCondition(gi: number, ci: number, patch: Partial<AnnouncementCondition>) { update(d => { Object.assign(d.any_of![gi].all_of![ci], patch); }); }
function setBalance(gi: number, ci: number, value: string) { patchCondition(gi, ci, { value: value.trim() ? Number(value) : undefined }); }
function toggleGroup(gi: number, ci: number, groupId: number) {
  update(d => {
    const c = d.any_of![gi].all_of![ci];
    const ids = new Set(c.group_ids ?? []);
    if (ids.has(groupId)) ids.delete(groupId); else ids.add(groupId);
    c.group_ids = [...ids];
  });
}
const validationError = computed(() => {
  if (anyOf.value.length > 50) return '最多添加 50 个条件组。';
  for (const g of anyOf.value) {
    if (!g.all_of?.length) return '每个条件组至少需要一个条件。';
    if (g.all_of.length > 50) return '每个条件组最多添加 50 个条件。';
    for (const c of g.all_of) {
      if (c.type === 'subscription') {
        if (c.operator !== 'in' || !c.group_ids?.length || c.group_ids.some(n => !Number.isInteger(n) || n <= 0)) return '请选择至少一个订阅套餐。';
      } else if (c.type === 'balance') {
        if (!['gt', 'gte', 'lt', 'lte', 'eq'].includes(c.operator) || !Number.isFinite(c.value)) return '请填写有效的余额条件。';
      } else return '存在不支持的受众条件，请修改后保存。';
    }
  }
  return '';
});
watch(validationError, value => emit('validation', value), { immediate: true, flush: 'sync' });
</script>

<template>
  <fieldset data-testid="announcement-targeting" class="announcement-targeting" :disabled="disabled">
    <legend>展示对象</legend>
    <div class="mode-row">
      <label><input type="radio" :name="id" :checked="!anyOf.length" @change="setMode('all')" />全部用户</label>
      <label><input type="radio" :name="id" :checked="!!anyOf.length" @change="setMode('custom')" />定向用户</label>
    </div>
    <template v-if="anyOf.length">
      <p class="hint">满足任一条件组即可；同组内须满足全部条件。</p>
      <label class="field">筛选订阅套餐<input v-model="groupSearch" type="search" placeholder="套餐名称或编号" /></label>
      <p v-if="loading" role="status">正在加载订阅套餐…</p>
      <div v-else-if="error" role="alert"><p>{{ error }}</p><MacButton size="sm" @click="loadGroups">重试加载套餐</MacButton></div>
      <p v-else-if="!groups.length" class="hint">暂无可选订阅套餐，仍可使用余额条件。</p>
      <fieldset v-for="(group, gi) in anyOf" :key="gi" class="condition-group">
        <legend>条件组 {{ gi + 1 }} · 全部满足</legend>
        <MacButton size="sm" :aria-label="`删除条件组 ${gi + 1}`" @click="removeGroup(gi)">删除条件组</MacButton>
        <div v-for="(condition, ci) in group.all_of" :key="ci" class="condition">
          <label class="field">条件 {{ ci + 1 }}
            <select :value="condition.type" @change="setType(gi, ci, ($event.target as HTMLSelectElement).value as AnnouncementConditionType)">
              <option value="subscription">持有订阅套餐</option><option value="balance">账户余额</option>
            </select>
          </label>
          <fieldset v-if="condition.type === 'subscription'" class="packages" :disabled="loading || !!error">
            <legend>订阅套餐（可多选）</legend>
            <label v-for="g in filteredGroups" :key="g.id" class="package">
              <input type="checkbox" :checked="condition.group_ids?.includes(g.id)" @change="toggleGroup(gi, ci, g.id)" />
              <span>{{ g.name }} · #{{ g.id }}</span>
            </label>
            <p v-if="!loading && !error && groups.length && !filteredGroups.length">没有匹配的套餐。</p>
            <label v-for="missing in (condition.group_ids ?? []).filter(n => !groups.some(g => g.id === n))" :key="missing" class="package">
              <input type="checkbox" checked @change="toggleGroup(gi, ci, missing)" />
              <span>已选套餐 #{{ missing }}（当前列表不可用）</span>
            </label>
          </fieldset>
          <div v-else class="balance-fields">
            <label class="field">比较方式<select :value="condition.operator" @change="patchCondition(gi, ci, { operator: ($event.target as HTMLSelectElement).value as AnnouncementCondition['operator'] })">
              <option value="gt">大于</option><option value="gte">大于或等于</option><option value="lt">小于</option><option value="lte">小于或等于</option><option value="eq">等于</option>
            </select></label>
            <label class="field">余额（美元）<input type="number" step="any" :value="condition.value" @input="setBalance(gi, ci, ($event.target as HTMLInputElement).value)" /></label>
          </div>
          <MacButton size="sm" :aria-label="`删除条件组 ${gi + 1} 的条件 ${ci + 1}`" @click="removeCondition(gi, ci)">删除条件</MacButton>
        </div>
        <MacButton size="sm" :disabled="(group.all_of?.length ?? 0) >= 50" @click="addCondition(gi)">添加同时满足的条件</MacButton>
      </fieldset>
      <MacButton size="sm" :disabled="anyOf.length >= 50" @click="addGroup">添加任一满足的条件组（{{ anyOf.length }}/50）</MacButton>
      <p v-if="validationError" role="alert" class="admin-form-error">{{ validationError }}</p>
    </template>
  </fieldset>
</template>

<style scoped>
.announcement-targeting { min-width: 0; margin-top: 18px; font-size: 12px; container-type: inline-size; }
legend { font-weight: 600; padding: 0 4px; }
.mode-row, .package { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.mode-row { margin: 8px 0; }
.mode-row label { display: flex; gap: 6px; align-items: center; }
.hint { color: var(--text-secondary); margin: 8px 0; }
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; margin: 8px 0; }
input:not([type=checkbox]):not([type=radio]), select { width: 100%; min-width: 0; padding: 7px 9px; border: 1px solid var(--border-color); border-radius: 7px; background: var(--input-bg, var(--window-bg-solid)); color: var(--text-primary); }
input:focus-visible, select:focus-visible { outline: 2px solid var(--accent-color, #007aff); outline-offset: 2px; }
.condition-group { min-width: 0; border: 1px solid var(--border-color); padding: 10px; border-radius: 9px; margin: 12px 0; }
.condition { border-bottom: 1px solid var(--border-color); padding: 8px 0 12px; margin-bottom: 10px; }
.packages { min-width: 0; max-height: 180px; overflow: auto; margin: 10px 0; }
.package { flex-wrap: nowrap; align-items: flex-start; gap: 7px; padding: 6px 0; overflow-wrap: anywhere; }
.package input { flex-shrink: 0; margin-top: 2px; }
.balance-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@container (max-width: 340px) { .balance-fields { grid-template-columns: minmax(0, 1fr); } }
</style>
