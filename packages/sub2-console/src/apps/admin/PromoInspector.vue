<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import * as api from '@/api/admin/promo';
import type { PromoCode, PromoCodeUsage, UpdatePromoCodeRequest } from '@/types';
const props=defineProps<{item:PromoCode|null}>();
const emit=defineEmits<{close:[];updated:[]}>();
const draft=ref<UpdatePromoCodeRequest>({}),expiry=ref(''),busy=ref(false),error=ref(''),history=ref<PromoCodeUsage[]>([]),page=ref(1),total=ref(0),reading=ref(false),deleting=ref(false);
let revision=0,historyRevision=0,disposed=false;
const historyError=ref(''),deleteError=ref('');
let originalExpiry='';
let baseline:UpdatePromoCodeRequest={};
function resetDraft(item:PromoCode|null){revision++;historyRevision++;reading.value=false;historyError.value='';deleteError.value='';
history.value=[];page.value=1;total.value=0;error.value='';deleting.value=false;
 if(!item){draft.value={};baseline={};expiry.value='';originalExpiry='';return;}
 if(item){draft.value={code:item.code,bonus_amount:item.bonus_amount,max_uses:item.max_uses,status:item.status,notes:item.notes||''}; baseline={...draft.value}; const d=item.expires_at?new Date(item.expires_at):null;expiry.value=d&&!Number.isNaN(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19):'';originalExpiry=expiry.value;if(d&&Number.isNaN(d.getTime()))error.value='原到期时间无效，请修正后保存';void loadHistory();}
}
watch(()=>props.item,resetDraft,{immediate:true});
onUnmounted(()=>{disposed=true;revision++;historyRevision++;});
const message=(e:unknown)=>(e as {message?:string})?.message||'请求失败，请重试';
async function loadHistory(){if(!props.item)return;const id=props.item.id,rev=++historyRevision,itemRev=revision;reading.value=true;historyError.value='';try{const data=await api.getUsages(id,page.value,20);if(disposed||rev!==historyRevision||itemRev!==revision)return;if(!data||!Array.isArray(data.items)||!Number.isSafeInteger(data.total)||data.total<0||data.items.length>data.total||!data.items.every(r=>Number.isSafeInteger(r?.id)&&Number.isSafeInteger(r.user_id)&&typeof r.used_at==='string'&&Number.isFinite(r.bonus_amount)))throw new Error('使用记录响应不完整，请重试');history.value=data.items;total.value=data.total;const last=Math.max(1,Math.ceil(data.total/20));if(page.value>last){page.value=last;void loadHistory();}}catch(e){if(!disposed&&rev===historyRevision&&itemRev===revision)historyError.value=message(e);}finally{if(rev===historyRevision)reading.value=false;}}
async function save(){if(!props.item||busy.value)return;if(!Number.isSafeInteger(props.item.id)||props.item.id<=0){error.value='优惠码标识无效，请刷新列表';return;}
 if(!draft.value.code?.trim()||!Number.isFinite(draft.value.bonus_amount)||Number(draft.value.bonus_amount)<0||!Number.isInteger(draft.value.max_uses)||Number(draft.value.max_uses)<0||!['active','disabled'].includes(draft.value.status||'')){error.value='请输入有效代号、非负金额及使用次数';return;}
 const expires=expiry.value?new Date(expiry.value).getTime():0;const parsed=new Date(expires);const local=Number.isFinite(expires)?new Date(expires-parsed.getTimezoneOffset()*60000).toISOString().slice(0,19):'';if(!Number.isFinite(expires)||(expiry.value&&local.slice(0,expiry.value.length)!==expiry.value)){error.value='到期时间无效';return;}
 if(props.item.expires_at&&!Number.isFinite(new Date(props.item.expires_at).getTime())&&expiry.value===originalExpiry){error.value='原到期时间无效，请修正后保存';return;}
 const id=props.item.id,rev=revision;
 const normalized={...draft.value,code:draft.value.code.trim()};
 const payload:UpdatePromoCodeRequest=Object.fromEntries(Object.entries(normalized).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(baseline[key as keyof UpdatePromoCodeRequest])));
 // Preserve original seconds/precision when untouched; upstream uses 0 to clear expiry.
 if(expiry.value!==originalExpiry)payload.expires_at=Math.floor(expires/1000);
 busy.value=true;error.value='';try{const updated=await api.update(id,payload);if(disposed||rev!==revision)return;if(!updated||updated.id!==id||typeof updated.code!=='string')throw new Error('保存已提交但响应无法确认，请刷新列表');emit('updated');emit('close');}catch(e){if(!disposed&&rev===revision)error.value=message(e);}finally{busy.value=false;}
}
function prepareDelete(){if(!props.item||busy.value)return;if(!Number.isSafeInteger(props.item.id)||props.item.id<=0){error.value='优惠码标识无效，请刷新列表';return;}deleteError.value='';deleting.value=true;}
async function remove(){if(!props.item||busy.value||!deleting.value)return;const id=props.item.id,rev=revision;busy.value=true;deleteError.value='';try{await api.deleteCode(id);if(disposed||rev!==revision)return;deleting.value=false;emit('updated');emit('close');}catch(e){if(!disposed&&rev===revision)deleteError.value=message(e);}finally{busy.value=false;}}

</script>
<template>
 <MacSheet :show="item!==null" title="优惠码详情" :loading="busy" @close="emit('close')">
  <p v-if="error" role="alert">{{ error }}</p>
  <div class="promo-fields"><label>代号<input v-model="draft.code"/></label><label>赠送金额<input v-model.number="draft.bonus_amount" type="number" min="0" step="0.01"/></label><label>使用次数上限<input v-model.number="draft.max_uses" type="number" min="0"/></label><label>状态<select v-model="draft.status"><option value="active">有效</option><option value="disabled">禁用</option></select></label><label>到期时间<input v-model="expiry" type="datetime-local" step="1"/></label><label>备注<textarea v-model="draft.notes"/></label></div>
  <h3 class="mt-5 font-semibold">使用记录 · {{ total }}</h3><p v-if="historyError" role="alert">{{ historyError }}</p><p v-if="reading">正在读取…</p><div v-for="usage in history" :key="usage.id" class="promo-row">{{ usage.user?.email || `用户 #${usage.user_id}` }} · ${{ usage.bonus_amount }} · {{ new Date(usage.used_at).toLocaleString() }}</div><p v-if="!reading&&!historyError&&!history.length">暂无使用记录</p><div class="flex gap-2 mt-3"><MacButton :disabled="reading||page<=1" @click="page--;loadHistory()">上一页</MacButton><MacButton :disabled="reading||page*20>=total" @click="page++;loadHistory()">下一页</MacButton><MacButton :loading="reading" @click="loadHistory">刷新记录</MacButton></div>
  <template #footer><MacButton variant="destructive" :disabled="busy" @click="prepareDelete">删除</MacButton><MacButton variant="primary" :loading="busy" @click="save">保存修改</MacButton></template>
 </MacSheet>
 <MacAlertSheet :show="deleting" title="删除优惠码" :message="`确认删除 ${item?.code}？该操作不可恢复。`" danger confirm-text="删除" :loading="busy" @confirm="remove" @cancel="deleting=false"><p v-if="deleteError" role="alert">{{ deleteError }}</p></MacAlertSheet>
</template>
<style scoped>.promo-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;font-size:12px}.promo-fields label{display:grid;gap:6px}.promo-fields input,.promo-fields textarea,.promo-fields select{width:100%;padding:8px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:7px}.promo-row{font-size:12px;overflow-wrap:anywhere;padding:8px 0;border-bottom:1px solid var(--border-subtle)}[role=alert]{color:var(--danger)}@media(max-width:450px){.promo-fields{grid-template-columns:1fr}}</style>
