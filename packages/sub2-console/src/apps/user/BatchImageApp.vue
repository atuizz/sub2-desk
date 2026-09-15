<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { MacButton, MacSheet, MacAlertSheet, type WindowInstance } from '@sub2-mac/core';
import { getAppIcon } from '@/assets/appIcons';
import { buildGatewayUrl } from '@/api/url';
import type { BatchImageJob, BatchImageSubmitItem, BatchImageSubmitRequest } from '@/api/batchImage';
import { useBatchImages, statusLabel, terminal, validatePayload, groupJobs } from './batch-image/useBatchImages';
import { agentGuide } from './batch-image/guide';
defineProps<{ win?: WindowInstance }>();
const state=useBatchImages();
const {keys,keyId,models,jobs,detail,items,loading,detailLoading,busy,keysLoading,modelLoading,error,detailError,notice,hasMore,itemsMore,filters,page,previews}=state;
const creating=ref(false), guideOpen=ref(false), taskName=ref(''), model=ref(''), format=ref('image/png');
const rows=ref<BatchImageSubmitItem[]>([]), prompt=ref(''), customId=ref(''), count=ref(1), references=ref<NonNullable<BatchImageSubmitItem['reference_images']>>([]);
const formError=ref(''), referenceBusy=ref(false), parentBatch=ref<string>();
const pending=ref<{kind:'cancel'|'delete';job:BatchImageJob}|null>(null);
const selection=ref<string[]>([]);
const deletingSelected=ref(false);
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const expanded=ref<string[]>([]), imageIndexes=ref<Record<string,number>>({});
const families=computed(()=>groupJobs([...new Map([...jobs.value,...Object.values(state.familyJobs.value).flat()].map(j=>[j.id,j])).values()]));
const selectedJobs=computed(()=>families.value.flatMap(f=>[f.root,...f.children]).filter(j=>selection.value.includes(j.id)));
const visibleJobs=computed(()=>families.value.flatMap(f=>expanded.value.includes(f.root.id)?[f.root,...f.children]:[f.root]));
function family(job:BatchImageJob){return families.value.find(f=>f.root.id===job.id);}
async function toggleFamily(job:BatchImageJob){const id=job.parent_batch_id || job.id;if(expanded.value.includes(id)){expanded.value=expanded.value.filter(x=>x!==id);return;}await state.loadFamily(job);if(!error.value)expanded.value=[...expanded.value,id];}
const refUri=ref(''),refMime=ref('image/png'),refPurpose=ref('subject');
function addUri(){try{const image={id:crypto.randomUUID(),type:refPurpose.value,mime_type:refMime.value,file_uri:refUri.value.trim()};validatePayload({model:model.value,items:[{custom_id:'reference-check',prompt:'reference-check',reference_images:[...references.value,image]}]});references.value.push(image);refUri.value='';formError.value='';}catch(e){formError.value=e instanceof Error?e.message:'参考图无效';}}
const total=computed(()=>rows.value.reduce((sum,row)=>sum+(row.output_count||1),0));
const instruction=computed(()=>agentGuide(buildGatewayUrl('/').replace(/\/$/,'')));
let fileGeneration=0;
const readers=new Set<FileReader>();
function abortReaders(){for(const reader of readers)reader.abort();readers.clear();}
function startCreate() { creating.value=true; taskName.value=new Date().toLocaleString('zh-CN'); model.value=models.value[0]?.id||''; rows.value=[]; references.value=[]; prompt.value=''; customId.value=''; parentBatch.value=undefined; formError.value=''; }
function closeCreate() { if(busy.value) return; creating.value=false; fileGeneration++;abortReaders();rows.value=[];prompt.value=''; references.value=[]; referenceBusy.value=false; }
async function addImages(event:Event) {
  const input=event.target as HTMLInputElement, files=Array.from(input.files||[]); input.value='';
  const g=++fileGeneration; referenceBusy.value=true; formError.value='';
  try { const result=[];
    for(const file of files) { if(g!==fileGeneration)return; if(file.size>10*1024*1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请使用10MB以内的PNG、JPEG或WebP参考图');
      const data=await new Promise<string>((resolve,reject)=>{const r=new FileReader();readers.add(r);const done=()=>{readers.delete(r);r.onload=null;r.onerror=null;r.onabort=null;};r.onload=()=>{const data=String(r.result).split(',')[1];done();resolve(data);};r.onerror=()=>{done();reject(new Error('参考图读取失败'));};r.onabort=()=>{done();reject(new Error('参考图读取已取消'));};r.readAsDataURL(file);});
      result.push({id:crypto.randomUUID(),type:refPurpose.value,mime_type:file.type,data});
    }
    if(g===fileGeneration) references.value.push(...result);
  } catch(e) { if(g===fileGeneration) formError.value=e instanceof Error?e.message:'读取失败'; }
  finally { if(g===fileGeneration) referenceBusy.value=false; }
}
function addRow() {
  formError.value='';
  const row={custom_id:customId.value.trim()||`img_${crypto.randomUUID().slice(0,8)}`,prompt:prompt.value.trim(),output_count:count.value,reference_images:references.value.map(i=>({...i}))};
  try {validatePayload({model:model.value,items:[...rows.value,row]}); rows.value.push(row); prompt.value=''; customId.value=''; references.value=[];}
  catch(e){formError.value=e instanceof Error?e.message:'提示词不正确';}
}
function editRow(index:number) { if(busy.value || referenceBusy.value) return; const row=rows.value[index]; prompt.value=row.prompt; customId.value=row.custom_id; count.value=row.output_count || 1; references.value=(row.reference_images || []).map(i=>({...i})); rows.value.splice(index,1); }
async function submit() {
  if(referenceBusy.value) return;
  if(!taskName.value.trim()) taskName.value=new Date().toLocaleString('zh-CN');
  const payload:BatchImageSubmitRequest={model:model.value,task_name:taskName.value.trim()||new Date().toLocaleString('zh-CN'),image_size:'1K',response_mime_type:format.value,items:rows.value,parent_batch_id:parentBatch.value};
  if(await state.submit(payload)) {creating.value=false;rows.value=[];references.value=[];}
}
async function prepareRetry() {
  try {const payload=state.retryPayload();const source=detail.value!;await state.selectOwner(source);state.closeDetail();startCreate();model.value=payload.model;taskName.value=payload.task_name||'';parentBatch.value=payload.parent_batch_id;rows.value=payload.items;formError.value='请核对完整提示词、输出格式及参考图后再提交；历史明细不保证保留原参考图。';}
  catch(e){error.value=e instanceof Error?e.message:'无法准备重试';}
}
async function confirm() {if(!pending.value)return;const p=pending.value;if(await state.action(p.kind,p.job))pending.value=null;}
function selectJob(id:string,checked:boolean){selection.value=checked?[...selection.value,id]:selection.value.filter(x=>x!==id);}
async function downloadSelected(){for(const job of selectedJobs.value){await state.action('download',job);if(error.value)break;}}
async function deleteSelected(){ for(const job of [...selectedJobs.value]){if(!await state.action('delete',job))return;selection.value=selection.value.filter(id=>id!==job.id);} deletingSelected.value=false;}
async function copyGuide(){try{await navigator.clipboard.writeText(instruction.value);notice.value='说明已复制';}catch{notice.value='复制不可用，请在下方选取文字手动复制';}}
async function switchKey(){selection.value=[];pending.value=null;expanded.value=[];await state.changeKey();}
const money=(job:BatchImageJob)=>job.actual_cost==null?`冻结 $${job.hold_amount.toFixed(2)}`:`结算 $${job.actual_cost.toFixed(2)}`;
onMounted(()=>{void state.loadKeys();refreshTimer=setInterval(()=>{if(!document.hidden && !busy.value && !creating.value && !loading.value && !detailLoading.value && detail.value && !terminal(detail.value.status)) void state.openDetail(detail.value);},60000);});
onUnmounted(()=>{if(refreshTimer)clearInterval(refreshTimer);fileGeneration++;abortReaders();state.dispose();});
</script>
<template>
  <div class="batch-app">
    <header class="toolbar"><div class="title"><img :src="getAppIcon('safari')" alt="" width="28" height="28" /><h1>批量生图</h1></div><div class="actions"><MacButton @click="guideOpen=true">使用说明</MacButton><MacButton :disabled="busy || !keyId || modelLoading" variant="primary" @click="startCreate">创建任务</MacButton></div></header>
    <div class="body">
      <p v-if="notice" role="status">{{notice}}</p><p v-if="error" class="error" role="alert">{{error}}</p>
      <div class="filters"><label>提交密钥<select v-model="keyId" :disabled="busy || keysLoading" @change="switchKey"><option :value="null">全部密钥（创建前请选择具体密钥）</option><option v-for="key in keys" :key="key.id" :value="key.id">{{key.name}} · #{{key.id}}</option></select></label><MacButton :loading="keysLoading" :disabled="busy" @click="state.loadKeys">刷新密钥</MacButton></div>
      <p v-if="!keysLoading && !keys.length && !error">没有可用密钥。请创建并绑定已开启批量生图的 Gemini 分组。</p>
      <form class="filters" @submit.prevent="selection=[];state.loadJobs(true)"><label>任务名称<input v-model="filters.taskName" placeholder="搜索任务" /></label><label>状态<select v-model="filters.status"><option value="">全部状态</option><option v-for="s in ['queued','running','processing_results','settling','completed','failed','cancelled','output_deleted']" :key="s" :value="s">{{statusLabel(s)}}</option></select></label><label>下载状态<select v-model="filters.downloaded"><option value="">全部</option><option value="true">已下载</option><option value="false">未下载</option></select></label><label>开始日期<input v-model="filters.from" type="date" /></label><label>结束日期<input v-model="filters.to" type="date" /></label><MacButton type="submit" :loading="loading" :disabled="!keys.length || busy">查询</MacButton></form>
      <div class="actions"><MacButton :disabled="busy || !selection.length" @click="downloadSelected">下载选中任务</MacButton><MacButton :disabled="busy || !selection.length || selectedJobs.some((j:BatchImageJob)=>!terminal(j.status))" @click="deletingSelected=true">删除选中记录</MacButton><MacButton :disabled="busy || !keys.length" :loading="loading" @click="state.loadJobs()">刷新任务</MacButton><span>每页20条 · 第{{page+1}}页</span></div>
      <div class="table-wrap"><table><thead><tr><th>选择</th><th>任务名称</th><th>状态 / 结果</th><th>费用</th><th>操作</th></tr></thead><tbody><tr v-for="job in visibleJobs" :key="job.id"><td><input type="checkbox" :aria-label="`选择任务 ${job.task_name || job.id}`" :checked="selection.includes(job.id)" @change="selectJob(job.id,($event.target as HTMLInputElement).checked)" /></td><td><button class="link" @click="state.openDetail(job)">{{job.task_name || job.id}}</button><small>{{state.ownerName(job)}}</small><button class="link" :disabled="state.familyLoading.value" :aria-expanded="expanded.includes(job.id)" @click="toggleFamily(job)">{{expanded.includes(job.id)?'收起':'展开'}} {{family(job)?.children.length || 0}} 个关联子任务 · 累计成功 {{family(job)?.success}} / 失败记录 {{family(job)?.failure}}</button><small>{{job.model}} · {{new Date(job.created_at*1000).toLocaleString()}}</small><small v-if="job.parent_batch_id">重试子任务 · 来源 {{job.parent_batch_id}}</small></td><td>{{statusLabel(job.status)}}<small>成功 {{job.success_count}} / 失败 {{job.fail_count}}</small></td><td>{{money(job)}}<small>{{job.downloaded_at?'已下载':'未下载'}}</small></td><td><div class="actions"><MacButton :disabled="busy" @click="state.openDetail(job)">详情</MacButton><MacButton :disabled="busy || !terminal(job.status) || !job.success_count || job.status==='output_deleted'" @click="state.action('download',job)">ZIP</MacButton><MacButton v-if="!terminal(job.status)" :disabled="busy" @click="pending={kind:'cancel',job}">取消任务</MacButton><MacButton v-else :disabled="busy" @click="pending={kind:'delete',job}">删除记录</MacButton></div></td></tr></tbody></table></div>
      <p v-if="!jobs.length && !loading && !error">暂无符合条件的任务。</p><p v-if="loading" role="status">正在加载任务…</p>
      <footer class="actions"><MacButton :disabled="loading || busy || page===0" @click="selection=[];state.turnPage(-1)">上一页</MacButton><MacButton :disabled="loading || busy || !hasMore" @click="selection=[];state.turnPage(1)">下一页</MacButton></footer>
    </div>
    <MacSheet :show="detail!==null" title="任务详情" :loading="busy" @close="state.closeDetail">
      <div v-if="detail" class="sheet-content"><h2>{{detail.task_name || detail.id}}</h2><p>{{statusLabel(detail.status)}} · {{money(detail)}}</p><p v-if="detailError" role="alert" class="error">{{detailError}}</p><div class="actions"><MacButton :loading="detailLoading" @click="state.openDetail(detail)">刷新详情</MacButton><MacButton :disabled="busy || detailLoading || !terminal(detail.status) || !detail.fail_count || itemsMore" @click="prepareRetry">准备失败项重试</MacButton></div><p v-if="itemsMore" class="error">接口返回的明细未完整，禁止自动重试以免漏项。</p><p v-if="detailLoading">正在读取明细…</p><article v-for="item in items" :key="`${item.batch_id}-${item.custom_id}`" class="item"><strong>{{item.custom_id}} · {{item.status}}</strong><p class="prompt">{{item.prompt_preview || '未保存提示词'}}</p><p v-if="item.error" class="error">{{item.error.code}} · {{item.error.source}} · {{item.error.message}}</p><div v-if="['success','succeeded'].includes(item.status) && item.image_count>0" class="actions"><label>预览图片<select v-model.number="imageIndexes[item.custom_id]"><option v-for="n in item.image_count" :key="n" :value="n-1">第{{n}}张</option></select></label><MacButton @click="state.preview(item,imageIndexes[item.custom_id] || 0)">加载所选图片</MacButton></div><img v-if="previews[item.custom_id+':'+(imageIndexes[item.custom_id] || 0)]" :src="previews[item.custom_id+':'+(imageIndexes[item.custom_id] || 0)]" :alt="`${item.custom_id} 第${(imageIndexes[item.custom_id] || 0)+1}张`" class="preview" /></article></div>
    </MacSheet>
    <MacSheet :show="creating" title="创建批量任务" :loading="busy || referenceBusy" @close="closeCreate"><div class="sheet-content"><p v-if="formError" role="alert" class="error">{{formError}}</p><p v-if="error" role="alert" class="error">{{error}}</p><label>任务名称<input v-model="taskName" :disabled="busy" placeholder="留空使用当前时间" /></label><label>模型<select v-model="model" :disabled="busy"><option value="">选择可用模型</option><option v-for="m in models" :key="m.id" :value="m.id">{{m.id}}</option></select></label><p v-if="!models.length">当前密钥没有可用模型，请刷新密钥或联系管理员。</p><label>输出格式<select v-model="format" :disabled="busy"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option></select></label><p>固定1K；每条1–4张，单任务最多200张。当前预计 {{total}} 张。</p><fieldset :disabled="busy || referenceBusy"><label>提示词<textarea v-model="prompt" rows="4" placeholder="完整输入一条提示词，换行会保留" /></label><div class="filters"><label>唯一编号（可选）<input v-model="customId" /></label><label>生成张数<input v-model.number="count" type="number" min="1" max="4" /></label></div><label>参考图用途<select v-model="refPurpose"><option value="subject">主体</option><option value="style">风格</option><option value="content">内容</option></select></label><label>本条参考图<input type="file" multiple accept="image/png,image/jpeg,image/webp" @change="addImages" /></label><label>GCS参考图地址<input v-model="refUri" placeholder="gs://bucket/path/image.png" /></label><label>引用图片格式<select v-model="refMime"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label><MacButton @click="addUri">添加GCS参考图</MacButton><div v-for="(image,i) in references" :key="image.id" class="actions"><span>{{image.file_uri || `本地图片 ${i+1}`}}</span><label>用途<select v-model="image.type"><option value="subject">主体</option><option value="style">风格</option><option value="content">内容</option></select></label><MacButton @click="references.splice(i,1)">移除此图</MacButton></div><p>已附 {{references.length}} 张参考图。Flash最多3张，Pro最多14张。<button class="link" @click="references=[]">清除</button></p><MacButton @click="addRow">添加提示词</MacButton></fieldset><article v-for="(row,index) in rows" :key="row.custom_id" class="item"><strong>{{row.custom_id}} · {{row.output_count}}张 · {{row.reference_images?.length || 0}}张参考图</strong><p class="prompt">{{row.prompt}}</p><div class="actions"><MacButton :disabled="busy || referenceBusy" @click="editRow(index)">移回编辑区</MacButton><MacButton :disabled="busy" @click="rows.splice(index,1)">移除</MacButton></div></article><p v-if="parentBatch">来源任务 {{parentBatch}}；只提交上方失败项。</p></div><template #footer><MacButton :disabled="busy || referenceBusy" @click="closeCreate">返回</MacButton><MacButton variant="primary" :loading="busy" :disabled="!rows.length || !model || referenceBusy" @click="submit">提交任务（将冻结费用）</MacButton></template></MacSheet>
    <MacSheet :show="guideOpen" title="批量生图使用说明" @close="guideOpen=false"><div class="sheet-content"><ol><li>选择已开启批量生图的Gemini密钥，模型按所属分组加载。</li><li>逐条添加完整提示词、参考图与生成张数，核对预计输出后提交。</li><li>任务先排队，再生成、整理结果、结算。可手动刷新；打开的进行中详情每60秒刷新，后台标签暂停。预览仅按需加载。</li><li>完成后下载ZIP。失败项可准备重试，先核对提示词和原参考图；只按成功图片结算，取消时已成功项仍扣费。</li></ol><MacButton @click="copyGuide">复制完整Agent说明</MacButton><pre>{{instruction}}</pre></div></MacSheet>
    <MacAlertSheet :show="deletingSelected" title="删除选中任务记录" :message="error || '仅删除选中的已结束任务记录，账务记录仍保留。逐项执行，失败时停止并保留未完成项。确认删除？'" danger :loading="busy" @confirm="deleteSelected" @cancel="deletingSelected=false" />
    <MacAlertSheet :show="pending!==null" :title="pending?.kind==='delete'?'删除任务记录':'取消批量任务'" :message="error || (pending?.kind==='delete'?'任务将从列表隐藏，账务记录仍保留。确认删除？':'取消后，已索引成功的图片仍按成功项结算，其余冻结金额释放。确认取消？')" danger :loading="busy" @confirm="confirm" @cancel="pending=null" />
  </div>
</template>
<style scoped>
.batch-app{height:100%;min-height:0;display:flex;flex-direction:column;position:relative;color:var(--text-primary);background:var(--window-bg-solid);font-size:12px}.toolbar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border-subtle);gap:12px;flex-wrap:wrap}.title,.actions,.filters{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.title h1{font-size:15px;font-weight:600}.body{overflow:auto;flex:1;min-height:0;padding:16px;display:flex;flex-direction:column;gap:16px}.filters{align-items:end}label{display:grid;gap:6px;min-width:0}input:not([type=checkbox]),select,textarea{border:1px solid var(--border-subtle);border-radius:7px;padding:8px;background:var(--bg-surface,var(--window-bg-solid));color:inherit;max-width:100%;min-width:0}input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:10px;border-bottom:1px solid var(--border-subtle);vertical-align:top}th{white-space:nowrap;color:var(--text-secondary)}small{display:block;color:var(--text-secondary);margin-top:5px;overflow-wrap:anywhere}.link{color:var(--accent);text-align:left;overflow-wrap:anywhere}.error{color:var(--status-danger,#bd3434);overflow-wrap:anywhere}.sheet-content{padding:16px;display:grid;gap:14px;line-height:1.7;min-width:0}.item{padding:12px;border:1px solid var(--border-subtle);border-radius:8px;min-width:0}.prompt,pre{white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}pre{font-size:12px;max-height:50vh;overflow:auto}.preview{max-width:100%;max-height:360px;object-fit:contain;display:block;margin-top:12px}fieldset{border:0;padding:0;display:grid;gap:12px}ol{padding-left:20px}@media(max-width:560px){.body{padding:10px}.filters>label{flex:1 1 140px}.toolbar{padding:10px}th,td{padding:8px}.actions{gap:6px}}
</style>
