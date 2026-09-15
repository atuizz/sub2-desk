<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton } from '@sub2-mac/core';
import { opsAPI, type OpsAccountAvailabilityStatsResponse, type OpsUserConcurrencyStatsResponse, type AccountAvailability, type UserConcurrencyInfo } from '../../../api/admin/ops';
import { adminError } from '../admin-feedback';
import RecordDetails from './RecordDetails.vue';
const props=defineProps<{platform:string;refreshRevision?:number}>();
const tab=ref<'accounts'|'users'>('accounts'),group=ref(''),search=ref(''),state=ref('all'),page=ref(1);
const accounts=ref<OpsAccountAvailabilityStatsResponse|null>(null),users=ref<OpsUserConcurrencyStatsResponse|null>(null),loading=ref(false),error=ref('');
const detail=ref<AccountAvailability|UserConcurrencyInfo|null>(null);let epoch=0;
const allRows=computed(()=>tab.value==='accounts'?Object.values(accounts.value?.account||{}):Object.values(users.value?.user||{}));
const filtered=computed(()=>{const text=search.value.trim().toLowerCase();return allRows.value.filter(row=>{
 const label='account_id'in row?`${row.account_id} ${row.account_name} ${row.group_name}`:`${row.user_id} ${row.user_email} ${row.username}`;
 if(text&&!label.toLowerCase().includes(text))return false;
 if('account_id'in row){if(state.value==='available')return row.is_available;if(state.value==='limited')return row.is_rate_limited;if(state.value==='overloaded')return row.is_overloaded;if(state.value==='error')return row.has_error;if(state.value==='unavailable')return !row.is_available;}
 else {if(state.value==='waiting')return row.waiting_in_queue>0;if(state.value==='busy')return row.current_in_use>0;}
 return true;
 });});
const pageRows=computed(()=>filtered.value.slice((page.value-1)*25,page.value*25));
const enabled=computed(()=>tab.value==='accounts'?accounts.value?.enabled:users.value?.enabled);
const timestamp=computed(()=>tab.value==='accounts'?accounts.value?.timestamp:users.value?.timestamp);
function isRecord(value:unknown){return !!value&&typeof value==='object'&&!Array.isArray(value);}
async function load(){const version=++epoch;loading.value=true;error.value='';const current=tab.value;
 try{
  if(current==='accounts'){
   const id=group.value?Number(group.value):undefined;if(id!==undefined&&(!Number.isSafeInteger(id)||id<1))throw new Error('分组ID必须为正整数');
   const data=await opsAPI.getAccountAvailabilityStats(props.platform||undefined,id);if(version!==epoch)return;
   if(!data||typeof data.enabled!=='boolean'||(data.enabled&&(!isRecord(data.account)||!isRecord(data.platform)||!isRecord(data.group))))throw new Error('账号可用性响应不完整');accounts.value=data;
  }else{const data=await opsAPI.getUserConcurrencyStats();if(version!==epoch)return;if(!data||typeof data.enabled!=='boolean'||(data.enabled&&!isRecord(data.user)))throw new Error('用户并发响应不完整');users.value=data;}
  page.value=Math.min(page.value,Math.max(1,Math.ceil(filtered.value.length/25)));
 }catch(err){if(version===epoch)error.value=adminError(err,'读取失败，保留上次快照');}finally{if(version===epoch)loading.value=false;}}
function changeView(){state.value='all';search.value='';page.value=1;detail.value=null;void load();}
function queryAccounts(){page.value=1;void load();}
watch([search,state],()=>{page.value=1;});
watch(()=>props.platform,()=>{if(tab.value==='accounts'){accounts.value=null;page.value=1;void load();}});
watch(()=>props.refreshRevision,()=>{if(!loading.value)void load();});
onMounted(load);onUnmounted(()=>{epoch++;detail.value=null;});
</script>
<template>
 <section class="admin-card p-3 space-y-3">
  <h3 class="font-semibold">账号可用性与用户并发</h3><div class="flex flex-wrap gap-2"><label>视图<select v-model="tab" @change="changeView"><option value="accounts">账号可用性</option><option value="users">用户并发</option></select></label><MacButton :disabled="loading" @click="load">刷新快照</MacButton></div>
  <form v-if="tab==='accounts'" class="flex flex-wrap gap-2" @submit.prevent="queryAccounts"><label>分组ID（可选）<input v-model="group" type="number" min="1" /></label><MacButton :disabled="loading" @click="queryAccounts">查询分组</MacButton><span>平台：{{ platform||'全部' }}</span></form><p v-else>用户并发为全局快照，不受平台/分组筛选限制。</p>
  <p v-if="loading" role="status">正在读取…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="enabled===false">后端未启用此项统计</p>
  <template v-if="enabled===true">
   <div v-if="tab==='accounts' && accounts" class="space-y-2"><details><summary>平台与分组汇总</summary><div v-for="(item,key) in accounts.platform" :key="key">{{ item.platform }}：可用 {{ item.available_count }}/{{ item.total_accounts }} · 限流 {{ item.rate_limit_count }} · 异常 {{ item.error_count }}</div><div v-for="(item,key) in accounts.group" :key="key">{{ item.group_name }} #{{ item.group_id }}：可用 {{ item.available_count }}/{{ item.total_accounts }} · 限流 {{ item.rate_limit_count }} · 异常 {{ item.error_count }}</div></details></div>
   <div class="flex flex-wrap gap-2"><label>本地搜索<input v-model="search" placeholder="ID、名称或邮箱" /></label><label>状态<select v-model="state"><option value="all">全部</option><template v-if="tab==='accounts'"><option value="available">可用</option><option value="unavailable">不可用</option><option value="limited">限流</option><option value="overloaded">过载</option><option value="error">异常</option></template><template v-else><option value="busy">使用中</option><option value="waiting">有排队</option></template></select></label></div>
   <div class="admin-table-scroll"><table class="admin-table"><thead><tr><th>对象</th><th>{{ tab==='accounts'?'状态 / 分组':'使用 / 容量' }}</th><th>{{ tab==='accounts'?'限制 / 原因':'排队 / 负载' }}</th><th>操作</th></tr></thead><tbody>
    <tr v-for="row in pageRows" :key="'account_id'in row?row.account_id:row.user_id"><template v-if="'account_id'in row"><td>{{ row.account_name }} #{{ row.account_id }}</td><td>{{ row.is_available?'可用':'不可用' }} · {{ row.status }}<div>{{ row.group_name }} #{{ row.group_id }}</div></td><td>{{ row.is_rate_limited?'限流 ':'' }}{{ row.is_overloaded?'过载 ':'' }}{{ row.error_message||'—' }}<div v-if="row.rate_limit_reset_at">限流恢复 {{ row.rate_limit_reset_at }}</div></td></template><template v-else><td>{{ row.user_email||row.username }} #{{ row.user_id }}</td><td>{{ row.current_in_use }} / {{ row.max_capacity }}</td><td>{{ row.waiting_in_queue }} · {{ row.load_percentage }}%</td></template><td><MacButton size="sm" @click="detail=row">详情</MacButton></td></tr>
    <tr v-if="!pageRows.length&&!loading"><td colspan="4">当前快照中无符合条件的记录</td></tr>
   </tbody></table></div>
   <div class="flex flex-wrap gap-2"><span>快照 {{ timestamp||'未提供时间' }} · 筛选 {{ filtered.length }}/{{ allRows.length }} 项</span><MacButton :disabled="page<=1" @click="page--">上一页</MacButton><span>{{ page }}</span><MacButton :disabled="page*25>=filtered.length" @click="page++">下一页</MacButton></div>
  </template>
  <MacSheet :show="!!detail" title="状态详情" @close="detail=null"><RecordDetails v-if="detail" :record="detail" /><template #footer><MacButton @click="detail=null">关闭</MacButton></template></MacSheet>
 </section>
</template>
<style scoped>label{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}input,select{min-width:0;max-width:100%;padding:6px;background:var(--window-bg-solid);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;}td{overflow-wrap:anywhere;}</style>
