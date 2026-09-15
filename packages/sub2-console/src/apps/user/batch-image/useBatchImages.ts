import { computed, reactive, ref, toRaw } from 'vue';
import * as api from '@/api/batchImage';
import * as keysAPI from '@/api/keys';
import type { ApiKey } from '@/types';
export const terminal = (status: string) => ['completed','failed','cancelled','output_deleted'].includes(status);
export const statusLabel = (status: string) => ({queued:'排队中',running:'生成中',indexing:'整理结果',processing_results:'整理结果',settling:'结算中',completed:'已完成',failed:'失败',cancelled:'已取消',output_deleted:'结果已删除'}[status] || status);
export async function validateZip(blob: Blob) {
  const mime=blob.type.toLowerCase().split(';')[0].trim();
  if (!['application/zip','application/x-zip-compressed','application/octet-stream'].includes(mime)) throw new Error('下载响应不是ZIP类型，已阻止保存');
  const bytes=new Uint8Array(await blob.slice(0,4).arrayBuffer());
  if(bytes.length!==4 || bytes[0]!==0x50 || bytes[1]!==0x4b || !((bytes[2]===3 && bytes[3]===4)||(bytes[2]===5 && bytes[3]===6))) throw new Error('下载文件缺少ZIP签名，可能是错误页面，已阻止保存');
}
export function groupJobs(jobs: api.BatchImageJob[]) {
  const roots=jobs.filter(job=>!job.parent_batch_id || !jobs.some(parent=>parent.id===job.parent_batch_id));
  return roots.map(root=>{const children=jobs.filter(child=>child.parent_batch_id===root.id);return {root,children,success:root.success_count+children.reduce((n,j)=>n+j.success_count,0),failure:root.fail_count+children.reduce((n,j)=>n+j.fail_count,0)};});
}
export function validatePayload(payload: api.BatchImageSubmitRequest) {
  if (!payload.model || !payload.items.length) throw new Error('请选择模型并添加提示词');
  let total = 0, attachments = 0, bytes = 0;
  const ids = new Set<string>();
  const limit = /2\.5|flash/i.test(payload.model) ? 3 : 14;
  for (const item of payload.items) {
    if (!item.custom_id.trim() || ids.has(item.custom_id) || !item.prompt.trim()) throw new Error('每条提示词及唯一编号不能为空');
    ids.add(item.custom_id);
    const count = item.output_count ?? 1;
    if (!Number.isInteger(count) || count < 1 || count > 4) throw new Error('每条生成1–4张');
    total += count;
    if ((item.reference_images?.length || 0) > limit) throw new Error(`当前模型每条最多${limit}张参考图`);
    for (const image of item.reference_images || []) {
      if (!['image/png','image/jpeg','image/webp'].includes(image.mime_type)) throw new Error('参考图仅支持PNG、JPEG、WebP');
      if (Boolean(image.data) === Boolean(image.file_uri)) throw new Error('参考图必须提供一种内容来源');
      if (image.file_uri && !/^gs:\/\/[^/\s]+\/[^\s]+$/.test(image.file_uri)) throw new Error('文件引用须使用gs://地址');
      if (image.data) {
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) || image.data.length % 4) throw new Error('参考图base64格式不正确');
        const size = image.data.length * 3 / 4 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
        if (size > 10 * 1024 * 1024) throw new Error('单张参考图不能超过10MB');
        bytes += size * count;
      }
      attachments += count;
    }
  }
  if (total > 200) throw new Error('单个任务最多生成200张，请拆分任务');
  if (attachments > 1000 || bytes > 128 * 1024 * 1024) throw new Error('参考图总量过大，请拆分任务');
  // Check actual UTF-8 wire bytes, including base64, prompts and metadata.
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 268435456) throw new Error('请求内容超过256 MiB，请拆分后重试。');
  return total;
}
export function useBatchImages(service = api, keyService = keysAPI) {
  const keys = ref<ApiKey[]>([]), keyId = ref<number | null>(null), models = ref<api.BatchImageModel[]>([]);
  const jobs = ref<api.BatchImageJob[]>([]), detail = ref<api.BatchImageJob | null>(null), items = ref<api.BatchImageItem[]>([]);
  const loading = ref(false), detailLoading = ref(false), busy = ref(false), keysLoading = ref(false), modelLoading = ref(false);
  const error = ref(''), detailError = ref(''), notice = ref(''), hasMore = ref(false), itemsMore = ref(false);
  const filters = reactive({status:'',taskName:'',downloaded:'',from:'',to:''});
  const cursors = ref<string[]>(['']), page = ref(0);
  const familyJobs=ref<Record<string,api.BatchImageJob[]>>({});
  const familyLoading=ref(false);
  const jobKeys = new Map<string, ApiKey>();
  const jobOrigins = new WeakMap<api.BatchImageJob,{owner:ApiKey;scope:number}>();
  function remember(job:api.BatchImageJob,owner:ApiKey){jobKeys.set(job.id,owner);jobOrigins.set(toRaw(job),{owner,scope:generation});}
  const key = computed(() => keys.value.find(k => k.id === keyId.value));
  let generation = 0, detailGeneration = 0, listGeneration = 0, disposed = false;
  let submission: { fingerprint: string; id: string } | null = null;
  const previews = ref<Record<string,string>>({});
  const message = (e: unknown) => { const value=e as {message?:unknown;error?:{message?:unknown};detail?:unknown}; const text=value?.error?.message || value?.message || value?.detail; return typeof text==='string'?text:'请求未完成，请重试'; };
  function clearPreviews() { Object.values(previews.value).forEach(URL.revokeObjectURL); previews.value = {}; }
  function closeDetail() { detailGeneration++; detail.value = null; items.value = []; detailError.value = ''; detailLoading.value = false; clearPreviews(); }
  async function loadKeys() {
    if (keysLoading.value) return;
    keysLoading.value = true; error.value = '';
    try {
      const first = await keyService.list(1,100); const all = [...first.items];
      for (let p=2; all.length < first.total; p++) { const next = await keyService.list(p,100); if (!next.items.length) throw new Error('密钥列表未完整返回'); all.push(...next.items); }
      if (disposed) return;
      keys.value = all.filter(k => k.status === 'active' && k.group?.platform === 'gemini' && k.group.allow_batch_image_generation === true);
      if (keyId.value!==null && !keys.value.some(k => k.id === keyId.value)) keyId.value = null;
      await changeKey();
    } catch(e) { if (!disposed) error.value = message(e); }
    finally { if (!disposed) keysLoading.value = false; }
  }
  async function changeKey() {
    generation++; listGeneration++; closeDetail(); jobs.value=[]; models.value=[]; hasMore.value=false; page.value=0; cursors.value=['']; loading.value=false; modelLoading.value=false;
    jobKeys.clear(); familyJobs.value={};
    if (!key.value) { await loadJobs(true); return; }
    const g=generation, token=key.value.key; modelLoading.value=true;
    await Promise.all([loadJobs(true), (async()=>{
      try { const r=await service.listBatchImageModels(token); if (!disposed && g===generation) models.value=r.data; }
      catch(e) { if (!disposed && g===generation) error.value=message(e); }
      finally { if (!disposed && g===generation) modelLoading.value=false; }
    })()]);
  }
  async function loadJobs(reset=false) {
    const selected=key.value?[key.value]:keys.value;
    if(!selected.length) return;
    if(reset) {page.value=0;cursors.value=[''];familyJobs.value={};}
    const g=++listGeneration, scope=generation, currentPage=page.value, query={...filters};
    loading.value=true;error.value='';
    try {
      const results=await Promise.all(selected.map(async owner=>{
        const rows:api.BatchImageJob[]=[];
        // Fetch a prefix from EVERY key before slicing the globally sorted page.
        // A single offset applied to all keys would silently skip interleaved jobs.
        const start=selected.length===1?currentPage*20:0;
        let more=false;
        for(let offset=start;offset<=(currentPage*20);offset+=20){
          const r=await service.listBatchImageJobs(owner.key,{limit:20,cursor:String(offset),...query});
          if(disposed || g!==listGeneration || scope!==generation)return {owner,rows:[],more:false};
          if(r.has_more && !r.data.length)throw new Error('任务分页返回不完整，请重试');
          rows.push(...r.data);more=r.has_more;if(!more)break;
        }
        return {owner,rows,more};
      }));
      if(disposed || g!==listGeneration || scope!==generation)return;
      const merged=new Map<string,api.BatchImageJob>();
      for(const result of results)for(const job of result.rows){if(merged.has(job.id) && jobKeys.get(job.id)?.id!==result.owner.id)throw new Error('不同密钥返回相同任务 ID，已阻止不明确的归属操作');merged.set(job.id,job);remember(job,result.owner);}
      const sorted=[...merged.values()].sort((a,b)=>b.created_at-a.created_at || a.id.localeCompare(b.id));
      const offset=selected.length===1?0:currentPage*20;
      jobs.value=sorted.slice(offset,offset+20);hasMore.value=sorted.length>offset+20 || results.some(r=>r.more);
    }catch(e){if(!disposed && g===listGeneration && scope===generation)error.value=message(e);}
    finally{if(!disposed && g===listGeneration)loading.value=false;}
  }
  function ownerOf(job:api.BatchImageJob){
    const origin=jobOrigins.get(toRaw(job));
    if(origin)return origin.scope===generation?origin.owner:undefined;
    const owner=jobKeys.get(job.id);
    if(owner)jobOrigins.set(toRaw(job),{owner,scope:generation});
    return owner;
  }
  function ownerName(job:api.BatchImageJob){return ownerOf(job)?.name || '未知密钥';}
  async function selectOwner(job:api.BatchImageJob){const owner=ownerOf(job);if(!owner)throw new Error('无法确定任务所属密钥');keyId.value=owner.id;await changeKey();}
  async function loadFamily(job:api.BatchImageJob){
    const owner=ownerOf(job);if(!owner || familyLoading.value)return;
    const rootId=job.parent_batch_id || job.id, scope=generation;
    familyLoading.value=true;error.value='';
    try{
      const all:api.BatchImageJob[]=[];const seen=new Set<string>();let complete=false;
      for(let offset=0;offset<10000;offset+=100){
        const result=await service.listBatchImageJobs(owner.key,{limit:100,cursor:String(offset)});
        if(disposed || scope!==generation)return;
        const fresh=result.data.filter(item=>!seen.has(item.id));
        if(result.has_more && !fresh.length)throw new Error('关联任务分页未前进，无法确认完整结果');
        fresh.forEach(item=>seen.add(item.id));all.push(...fresh);
        if(!result.has_more){complete=true;break;}
      }
      if(!complete)throw new Error('关联任务超过本次查询上限，未显示不完整汇总');
      const family=all.filter(item=>item.id===rootId || item.parent_batch_id===rootId);
      if(!family.some(item=>item.id===rootId))throw new Error('原任务不可见，无法确认父子任务汇总');
      family.forEach(item=>remember(item,owner));familyJobs.value={...familyJobs.value,[rootId]:family};
    }catch(e){if(!disposed && scope===generation)error.value=message(e);}
    finally{if(!disposed)familyLoading.value=false;}
  }
  async function turnPage(delta:number) {
    if (loading.value || (delta>0 && !hasMore.value) || page.value+delta<0) return;
    page.value+=delta; familyJobs.value={}; await loadJobs();
  }
  async function openDetail(job:api.BatchImageJob) {
    clearPreviews(); const g=++detailGeneration, scope=generation, token=ownerOf(job)?.key;
    detail.value=job; items.value=[]; itemsMore.value=false; detailError.value='';
    if (!token) {detailError.value='无法确认任务所属密钥，请重新加载任务列表';return;}
    detailLoading.value=true;
    try {
      const [fresh,result]=await Promise.all([service.getBatchImageJob(token,job.id),service.listBatchImageItems(token,job.id)]);
      if (disposed || g!==detailGeneration || scope!==generation) return;
      const owner=ownerOf(job);if(!owner)return;remember(fresh,owner);
      detail.value=fresh; items.value=result.data; itemsMore.value=result.has_more;
    } catch(e) { if (!disposed && g===detailGeneration) detailError.value=message(e); }
    finally { if (!disposed && g===detailGeneration) detailLoading.value=false; }
  }
  async function submit(payload:api.BatchImageSubmitRequest) {
    if (busy.value || !key.value) return false;
    error.value='';
    try { validatePayload(payload); if (!models.value.some(m=>m.id===payload.model)) throw new Error('模型不属于当前密钥可用列表'); }
    catch(e) { error.value=message(e); return false; }
    const fingerprint=JSON.stringify([keyId.value,key.value.key,payload]);
    if (submission?.fingerprint!==fingerprint) submission={fingerprint,id:crypto.randomUUID()};
    busy.value=true; const scope=generation;
    try {
      const job=await service.submitBatchImageJob(key.value.key,payload,submission.id);
      if (disposed || scope!==generation) return false;
      remember(job,key.value); submission=null; notice.value='任务已提交'; await loadJobs(true); await openDetail(job); return true;
    } catch(e) { if (!disposed && scope===generation) error.value=message(e)+'；若响应丢失，先刷新列表核对。同一内容重试将复用请求标识。'; return false; }
    finally { if (!disposed) busy.value=false; }
  }
  async function action(kind:'cancel'|'delete'|'download',job:api.BatchImageJob) {
    const owner=ownerOf(job);
    if (busy.value) return false;
    if(!owner){error.value='无法确认任务所属密钥，请重新加载任务列表';return false;}
    if (kind==='delete' && !terminal(job.status)) { error.value='任务结束后才能删除记录'; return false; }
    if (kind==='cancel' && terminal(job.status)) return false;
    if (kind==='download' && (!terminal(job.status) || job.status==='output_deleted' || !job.success_count)) { error.value='当前任务没有可下载的成功图片'; return false; }
    busy.value=true; error.value=''; const scope=generation;
    try {
      if(kind==='download') { const blob=await service.downloadBatchImageZip(owner.key,job.id); await validateZip(blob); if (!disposed && scope===generation) service.saveBlob(blob,`batch-${job.id.replace(/[^\w.-]/g,'_')}.zip`); }
      if(kind==='cancel') await service.cancelBatchImageJob(owner.key,job.id);
      if(kind==='delete') await service.deleteBatchImageJobRecord(owner.key,job.id);
      if (disposed || scope!==generation) return;
      notice.value=kind==='download'?'下载已交给浏览器':kind==='cancel'?'已请求取消，请刷新确认最终状态':'任务记录已删除，账务记录保留';
      if(kind!=='download')familyJobs.value={};
      if(kind==='delete' && detail.value?.id===job.id) closeDetail();
      await loadJobs();
      if(kind==='cancel' && detail.value?.id===job.id) await openDetail(job);
      return true;
    } catch(e) { if(!disposed && scope===generation) error.value=message(e);return false; }
    finally { if(!disposed) busy.value=false; }
  }
  async function preview(item:api.BatchImageItem, imageIndex=0) {
    if (!detail.value || !['success','succeeded'].includes(item.status)) return;
    const owner=ownerOf(detail.value); if(!owner || !Number.isInteger(imageIndex) || imageIndex<0 || imageIndex>=item.image_count)return;
    const g=detailGeneration, id=detail.value.id, previewKey=item.custom_id+':'+imageIndex;
    try { const blob=await service.getBatchImageItemContent(owner.key,item.batch_id || id,item.custom_id,imageIndex);
      if(disposed || g!==detailGeneration) return;
      if(previews.value[previewKey]) URL.revokeObjectURL(previews.value[previewKey]);
      previews.value={...previews.value,[previewKey]:URL.createObjectURL(blob)};
    } catch(e) { if(!disposed && g===detailGeneration) detailError.value=message(e); }
  }
  function retryPayload():api.BatchImageSubmitRequest {
    const job=detail.value;
    if(!job || !terminal(job.status) || itemsMore.value || detailError.value) throw new Error('请完整加载已结束任务的明细后重试');
    const failed=items.value.filter(i=>i.status==='failed');
    if(!failed.length || failed.some(i=>!i.prompt_preview?.trim())) throw new Error('缺少失败项完整提示词，无法自动重试，请使用原始提示词重新创建');
    return {model:job.model,parent_batch_id:job.parent_batch_id || job.id,task_name:`${job.task_name} 重试失败项`,image_size:'1K',response_mime_type:'image/png',items:failed.map((i,index)=>({custom_id:`retry_${index+1}`,prompt:i.prompt_preview!,output_count:1}))};
  }
  function dispose(){ disposed=true; generation++; listGeneration++; closeDetail(); keys.value=[]; jobKeys.clear(); submission=null; }
  return {familyJobs,familyLoading,loadFamily,keys,keyId,models,jobs,detail,items,loading,detailLoading,busy,keysLoading,modelLoading,error,detailError,notice,hasMore,itemsMore,filters,page,previews,loadKeys,changeKey,loadJobs,turnPage,openDetail,closeDetail,submit,action,preview,retryPayload,ownerName,selectOwner,dispose};
}
