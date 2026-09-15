<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue';
import { MacButton, MacSheet, useWindowManager } from '@sub2-mac/core';
import { getUserBalanceHistory, getById, type BalanceHistoryItem } from '@/api/admin/users';
import { adminUsageAPI } from '@/api/admin/usage';
const wm=useWindowManager();
const props=defineProps<{user:{id:number;email:string}|null}>();
const emit=defineEmits<{close:[]}>();
const rows=ref<BalanceHistoryItem[]>([]),page=ref(1),total=ref(0),recharged=ref<number|null>(null),kind=ref(''),loading=ref(false),error=ref('');
const types=[['balance','充值'],['affiliate_balance','邀请返佣转入'],['admin_balance','管理员余额调整'],['concurrency','并发兑换'],['admin_concurrency','管理员并发调整'],['subscription','订阅']];
const pages=computed(()=>Math.max(1,Math.ceil(total.value/15)));
let sequence=0,overviewSequence=0,disposed=false;
const overview=ref<{email:string;username?:string;balance:number;created_at:string;notes?:string;deleted_at?:string|null}|null>(null),overviewLoading=ref(false),overviewError=ref(''),spent=ref<number|null>(null),spentError=ref('');
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
async function loadOverview(){const id=props.user?.id,rev=++overviewSequence;overview.value=null;spent.value=null;overviewError.value='';spentError.value='';overviewLoading.value=false;if(!id||disposed)return;overviewLoading.value=true;
  try{const u=await getById(id,true);if(disposed||rev!==overviewSequence||id!==props.user?.id)return;
    if(u?.id!==id||typeof u.email!=='string'||!Number.isFinite(u.balance)||!Number.isFinite(Date.parse(u.created_at)))throw new Error('用户概况响应不完整，请重试');
    overview.value={email:u.email,username:u.username,balance:u.balance,created_at:u.created_at,notes:u.notes,deleted_at:u.deleted_at};
    try{const stats=await adminUsageAPI.getStats({user_id:id,start_date:localDate(new Date(u.created_at)),end_date:localDate(new Date()),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});if(disposed||rev!==overviewSequence||id!==props.user?.id)return;if(!Number.isFinite(stats?.total_actual_cost))throw new Error('消费统计响应不完整');spent.value=stats.total_actual_cost;}catch(e){if(!disposed&&rev===overviewSequence)spentError.value='消费统计读取失败，刷新概况可重试';}
  }catch(e){if(!disposed&&rev===overviewSequence)overviewError.value=e instanceof Error?e.message:'用户概况读取失败，请重试';}
  finally{if(rev===overviewSequence)overviewLoading.value=false;}
}
function openAudit(event:MouseEvent){if(!wm)return;event.preventDefault();wm.openApp('security',{tab:'audit'});close();}

function close(){sequence++;overviewSequence++;overview.value=null;spent.value=null;overviewLoading.value=false;rows.value=[];recharged.value=null;loading.value=false;emit('close');}
function valueLabel(item:BalanceHistoryItem){
  if(['balance','affiliate_balance','admin_balance'].includes(item.type))return `${item.value>=0?'+':'-'}$${Math.abs(item.value).toFixed(6)}`;
  if(item.type==='subscription')return `${item.validity_days||Math.round(item.value)} 天${item.group?.name?' · '+item.group.name:''}`;
  return `${item.value>=0?'+':''}${item.value}${['concurrency','admin_concurrency'].includes(item.type)?' 并发':''}`;
}
async function load(){const id=props.user?.id,rev=++sequence;rows.value=[];recharged.value=null;total.value=0;error.value='';loading.value=false;if(!id||disposed)return;loading.value=true;
  try{const result=await getUserBalanceHistory(id,page.value,15,kind.value||undefined);if(disposed||rev!==sequence||id!==props.user?.id)return;
    if(!result||!Array.isArray(result.items)||!Number.isSafeInteger(result.total)||result.total<0||!Number.isFinite(result.total_recharged)||!result.items.every(r=>Number.isSafeInteger(r?.id)&&typeof r.type==='string'&&Number.isFinite(r.value)&&typeof r.created_at==='string'))throw new Error('余额历史响应不完整，请重试');
    rows.value=result.items;total.value=result.total;recharged.value=result.total_recharged;
    if(page.value>pages.value){page.value=pages.value;void load();}
  }catch(e){if(!disposed&&rev===sequence)error.value=e&&typeof e==='object'&&'message' in e?String(e.message):'余额历史读取失败，请检查管理员权限后重试';}
  finally{if(rev===sequence)loading.value=false;}
}
watch(()=>props.user?.id,()=>{page.value=1;kind.value='';void load();void loadOverview();},{immediate:true});
onUnmounted(()=>{disposed=true;sequence++;overviewSequence++;});
</script>
<template>
  <MacSheet :show="!!user" :title="`余额与权益历史 · ${user?.email||''}`" @close="close">
    <div class="balance-history">
      <p>充值、返佣转入与管理员调整，以及并发和订阅变更。调用扣费请查看用量记录。</p>
      <section class="balance-overview" aria-label="用户概况"><div class="balance-tools"><strong>用户概况</strong><MacButton :loading="overviewLoading" @click="loadOverview">刷新概况</MacButton><a href="/admin/audit-logs" target="_blank" rel="noopener noreferrer" @click="openAudit">打开操作审计</a></div><p v-if="overviewError" role="alert">{{ overviewError }}</p><p v-else-if="!overview" role="status">正在读取概况…</p><template v-if="overview"><p>{{ overview.email }} · {{ overview.username||'未设置用户名' }} <span v-if="overview.deleted_at">（已删除）</span></p><dl><dt>当前余额</dt><dd>${{ overview.balance.toFixed(6) }}</dd><dt>注册时间</dt><dd>{{ overview.created_at }}</dd><dt>备注</dt><dd>{{ overview.notes||'无' }}</dd><dt>记录内累计消费</dt><dd>{{ spent===null?'—':'$'+spent.toFixed(6) }}</dd></dl><p>按注册日至今仍保留的用量记录统计。</p><p v-if="spentError" role="alert">{{ spentError }}</p></template></section>
      <div class="balance-tools"><label>记录类型 <select aria-label="记录类型" v-model="kind" @change="page=1;load()"><option value="">全部类型</option><option v-for="t in types" :key="t[0]" :value="t[0]">{{ t[1] }}</option></select></label><MacButton :loading="loading" @click="load">刷新历史</MacButton></div>
      <p v-if="loading" role="status">正在读取历史…</p><p v-else-if="error" role="alert">{{ error }}</p>
      <template v-else><p>累计充值：{{ recharged===null?'—':'$'+recharged.toFixed(6) }}</p><ul><li v-for="item in rows" :key="item.id"><div><strong>{{ types.find(t=>t[0]===item.type)?.[1]||item.type }}</strong><strong>{{ valueLabel(item) }}</strong></div><p>{{ item.used_at||item.created_at }}</p><p v-if="item.notes">{{ item.notes }}</p></li></ul><p v-if="!rows.length">暂无此类记录</p></template>
    </div>
    <template #footer><span>{{ page }} / {{ pages }} · 共 {{ total }} 条</span><MacButton :disabled="loading||page<=1" @click="page--;load()">上一页</MacButton><MacButton :disabled="loading||page>=pages" @click="page++;load()">下一页</MacButton><MacButton @click="close">关闭</MacButton></template>
  </MacSheet>
</template>
<style scoped>
.balance-overview{margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-subtle)}.balance-overview dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 12px;margin:10px 0}.balance-overview a{color:var(--accent);text-decoration:underline}.balance-history{font-size:12px;min-width:0;overflow-wrap:anywhere}.balance-history>p{color:var(--text-secondary);margin-bottom:12px}.balance-tools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.balance-tools select{background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;padding:5px;max-width:100%}.balance-history li{padding:12px 0;border-bottom:1px solid var(--border-subtle)}.balance-history li>div{display:flex;justify-content:space-between;gap:12px}.balance-history li p{margin-top:6px;color:var(--text-secondary)}.balance-history [role=alert]{color:var(--status-danger,#c43731)}
</style>
