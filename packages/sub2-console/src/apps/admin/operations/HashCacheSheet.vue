<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { MacSheet, MacButton, MacAlertSheet } from '@sub2-mac/core';
import { riskControlAPI } from '../../../api/admin/riskControl';
import { adminError } from '../admin-feedback';
const emit=defineEmits<{close:[];changed:[]}>();
const count=ref<number|null>(null),input=ref(''),loading=ref(false),busy=ref(false),error=ref(''),notice=ref('');
const pending=ref<{kind:'one'|'all';hash:string}|null>(null);let epoch=0;
async function load(){const version=++epoch;loading.value=true;error.value='';count.value=null;try{const data=await riskControlAPI.getStatus();if(version!==epoch)return;if(!Number.isSafeInteger(data.flagged_hash_count)||data.flagged_hash_count<0)throw new Error('命中缓存状态无效');count.value=data.flagged_hash_count;}catch(err){if(version===epoch)error.value=adminError(err,'缓存状态读取失败');}finally{if(version===epoch)loading.value=false;}}
function prepare(kind:'one'|'all'){if(busy.value||loading.value||count.value===null)return;error.value='';notice.value='';const hash=input.value.trim().toLowerCase();if(kind==='one'&&!/^[a-f0-9]{64}$/.test(hash)){error.value='请输入64位十六进制SHA-256内容哈希';return;}pending.value={kind,hash:kind==='one'?hash:''};}
async function confirm(){if(!pending.value||busy.value)return;busy.value=true;error.value='';const version=epoch;
 try{if(pending.value.kind==='one'){const result=await riskControlAPI.deleteFlaggedHash(pending.value.hash);if(version!==epoch)return;if(typeof result.deleted!=='boolean')throw new Error('删除响应无效，请刷新状态后确认');notice.value=result.deleted?'该命中缓存已移除':'未找到该内容哈希，缓存未变更';}else{const result=await riskControlAPI.clearFlaggedHashes();if(version!==epoch)return;if(!Number.isSafeInteger(result.deleted)||result.deleted<0)throw new Error('清空响应无效，请刷新状态后确认');notice.value=`已清空 ${result.deleted} 条命中缓存`;}
 pending.value=null;input.value='';emit('changed');await load();}catch(err){if(version===epoch)error.value=adminError(err,'缓存维护失败');}finally{busy.value=false;}}
onMounted(load);onUnmounted(()=>{epoch++;pending.value=null;input.value='';});
</script>
<template>
 <MacSheet :show="true" title="审核命中缓存" :loading="busy" @close="emit('close')"><p v-if="loading" role="status">读取中…</p><p v-if="error" role="alert">{{ error }}</p><p v-if="notice" role="status">{{ notice }}</p><p>已记录 {{ count ?? '—' }} 条命中内容哈希。移除缓存后，相同内容需重新判定；历史审核日志不受影响。</p>
  <MacButton :disabled="busy||loading" @click="load">刷新缓存状态</MacButton><form @submit.prevent="prepare('one')"><label>内容SHA-256哈希<input v-model="input" spellcheck="false" maxlength="64" /></label><MacButton :disabled="busy||loading||count===null" @click="prepare('one')">删除指定缓存</MacButton></form>
  <template #footer><MacButton :disabled="busy" @click="emit('close')">关闭</MacButton><MacButton variant="destructive" :disabled="busy||loading||count===null||count===0" @click="prepare('all')">清空全部命中缓存</MacButton></template>
 </MacSheet>
 <MacAlertSheet :show="!!pending" :title="pending?.kind==='one'?'删除指定命中缓存？':'清空全部命中缓存？'" :message="error || (pending?.kind==='one'?`将移除内容哈希 ${pending.hash} 的缓存记录。`:`将清空当前所有命中缓存，当前读到 ${count} 条。此操作不可撤销。`)" danger :loading="busy" confirm-text="确认删除" @confirm="confirm" @cancel="pending=null" />
</template>
<style scoped>form{display:grid;gap:12px;margin-top:16px;}label{display:grid;gap:8px;}input{min-width:0;width:100%;padding:6px;background:var(--window-bg-solid);color:var(--text-primary);border:1px solid var(--border-color);border-radius:6px;}</style>
