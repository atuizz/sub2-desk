// node --test scripts/grok-media-eligibility.test.cjs
// Integration: <GrokMediaEligibilitySheet :account="account" @close="close" @saved="reload" />
// `saved` carries the validated eligibility state, not an Account or extra patch.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),req=createRequire(path.join(root,'packages/sub2-console/package.json'));
const ts=req('typescript'),vue=req('vue'),sfc=req('vue/compiler-sfc');
const apiFile=path.join(root,'packages/sub2-console/src/api/admin/accounts.ts');
const sheetFile=path.join(root,'packages/sub2-console/src/apps/admin/accounts/GrokMediaEligibilitySheet.vue');
const apiSource=fs.readFileSync(apiFile,'utf8'),sheetSource=fs.readFileSync(sheetFile,'utf8');
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const plain=x=>JSON.parse(JSON.stringify(x)),flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const response=(id=12,mode='auto',eligible=false,reason='billing_unobserved')=>({account_id:id,mode,eligible,reason});
const account=(id=12,platform='grok',type='oauth')=>({id,platform,type,name:'Grok '+id,credentials:{},extra:{grok_media_eligible:true,base_rpm:10,quota:{preserve:1}}});
function adapter(handler=async(method,url,payload)=>response(Number(url.split('/')[3]),payload?.mode||'auto',payload?.mode==='enabled')){
  const calls=[],exports={};
  const client=Object.fromEntries(['get','put','post','delete'].map(method=>[method,async(...args)=>{calls.push({method,args});return {data:await handler(method,...args)};}]));
  vm.runInNewContext(compile(apiSource),{exports,URL,require:spec=>{assert.equal(spec,'../client');return {apiClient:client};}});
  return {api:exports.accountsAPI,exports,calls};
}
function sheet(handler,value=account()){
  const f=adapter(handler),props=vue.reactive({account:value}),events=[],unmounted=[];
  const {descriptor,errors}=sfc.parse(sheetSource,{filename:sheetFile});assert.deepEqual(errors,[]);
  let code=descriptor.scriptSetup.content;
  const ast=ts.createSourceFile(sheetFile,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
  for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))code=code.slice(0,n.pos)+code.slice(n.end);
  const scope=vue.effectScope(),ctx={...vue,exports:{},accountsAPI:f.api,defineProps:()=>props,defineEmits:()=> (...a)=>events.push(a),onBeforeUnmount:fn=>unmounted.push(fn)};
  scope.run(()=>vm.runInNewContext(compile(code+'\nglobalThis.subject={'+names.join(',')+'};'),ctx));
  return {...f,s:ctx.subject,events,props,dispose(){unmounted.forEach(fn=>fn());scope.stop();}};
}
test('GET exact official URL, named/default API exports and no payload',async()=>{
  const f=adapter();assert.equal(f.exports.getGrokMediaEligibility,f.api.getGrokMediaEligibility);
  assert.deepEqual(plain(await f.api.getGrokMediaEligibility(12)),response());
  assert.deepEqual(plain(f.calls),[{method:'get',args:['/admin/accounts/12/grok-media-eligibility']}]);
});
for(const mode of ['auto','enabled','disabled'])test(`PUT ${mode} sends only official mode payload`,async()=>{
  const f=adapter();const s=await f.api.updateGrokMediaEligibility(12,mode);assert.equal(s.mode,mode);
  assert.deepEqual(plain(f.calls),[{method:'put',args:['/admin/accounts/12/grok-media-eligibility',{mode}]}]);
});
for(const [name,data] of [
  ['null',null],['array',[]],['missing id',{mode:'auto',eligible:false,reason:'x'}],['foreign id',response(13)],
  ['string id',{...response(),account_id:'12'}],['missing eligible',{account_id:12,mode:'auto',reason:'x'}],
  ['string eligible',{...response(),eligible:'false'}],['numeric eligible',{...response(),eligible:0}],
  ['null eligible',{...response(),eligible:null}],['unknown mode',{...response(),mode:'unknown'}],
  ['array mode',{...response(),mode:['auto']}],['missing reason',{account_id:12,mode:'auto',eligible:true}],['object reason',{...response(),reason:{message:'x'}}]
])test(`GET/PUT reject invalid ${name}`,async()=>{
  const f=adapter(async()=>data);await assert.rejects(f.api.getGrokMediaEligibility(12),/响应无效/);await assert.rejects(f.api.updateGrokMediaEligibility(12,'auto'),/响应无效/);
});
test('false eligibility and future reason remain valid without coercion',async()=>{
  const f=adapter(async()=>({...response(12,'auto',false,'future_reason'),future_field:true}));const s=await f.api.getGrokMediaEligibility(12);
  assert.equal(s.eligible,false);assert.equal(s.reason,'future_reason');
});
test('bad IDs and mode never issue network calls',async()=>{
  const f=adapter();for(const id of [0,-1,1.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'12']){await assert.rejects(f.api.getGrokMediaEligibility(id));await assert.rejects(f.api.updateGrokMediaEligibility(id,'auto'));}
  await assert.rejects(f.api.updateGrokMediaEligibility(12,'true'));assert.equal(f.calls.length,0);
});
test('request failures propagate without fallback or secondary writes',async()=>{
  const error={response:{status:503}};const f=adapter(async()=>{throw error;});await assert.rejects(f.api.getGrokMediaEligibility(12),e=>e===error);await assert.rejects(f.api.updateGrokMediaEligibility(12,'enabled'),e=>e===error);assert.equal(f.calls.length,2);
});
test('initial state is unknown and cannot save or infer eligibility from extra',async()=>{
  const pending=deferred(),f=sheet(()=>pending.promise);assert.equal(f.s.state.value,null);assert.equal(f.s.canSave.value,false);assert.equal(f.s.loading.value,true);
  await f.s.save();assert.equal(f.calls.length,1);pending.resolve(response());await flush();
  assert.equal(f.s.state.value.eligible,false);assert.equal(f.s.mode.value,'auto');assert.equal(f.s.dirty.value,false);assert.equal(f.s.canSave.value,false);f.dispose();
});
for(const [platform,type] of [['grok','apikey'],['grok','upstream'],['openai','oauth'],['minimax','apikey']])test(`unsupported ${platform}/${type} never reads or saves`,async()=>{
  const f=sheet(undefined,account(12,platform,type));await flush();await f.s.load();await f.s.save();assert.equal(f.calls.length,0);assert.equal(f.s.supported.value,false);f.dispose();
});
test('no-op save is skipped; successful save emits validated state without mutating account',async()=>{
  const a=account(),before=JSON.stringify(a),f=sheet(undefined,a);await flush();await f.s.save();assert.equal(f.calls.length,1);
  f.s.mode.value='enabled';await f.s.save();assert.equal(f.calls.length,2);assert.equal(f.s.state.value.eligible,true);assert.equal(f.s.canSave.value,false);assert.equal(f.s.notice.value,'媒体资格设置已保存。');
  assert.equal(f.events.length,1);assert.equal(f.events[0][0],'saved');assert.equal(f.events[0][1].mode,'enabled');assert.equal(JSON.stringify(a),before);assert(!('extra'in f.events[0][1]));f.dispose();
});
test('failed initial read leaves controls blocked and does not claim auto success',async()=>{
  const f=sheet(async()=>{throw {response:{status:404}};});await flush();assert.equal(f.s.ready.value,false);assert.equal(f.s.state.value,null);assert.equal(f.s.canSave.value,false);assert.match(f.s.error.value,/后端/);assert.equal(f.events.length,0);f.dispose();
});
test('failed refresh preserves previous state/draft and successful retry keeps draft',async()=>{
  let fail=false;const f=sheet(async()=>{if(fail)throw Error('failure');return response();});await flush();f.s.mode.value='enabled';fail=true;await f.s.load();
  assert.equal(f.s.mode.value,'enabled');assert.equal(f.s.state.value.mode,'auto');assert.equal(f.s.ready.value,false);assert.equal(f.s.canSave.value,false);
  fail=false;await f.s.load();assert.equal(f.s.mode.value,'enabled');assert.equal(f.s.state.value.mode,'auto');assert.equal(f.s.canSave.value,true);f.dispose();
});
test('failed PUT keeps draft/state and requires read before retry; no automatic write or extra patch',async()=>{
  let fail=true;const f=sheet(async(method,_url,payload)=>{if(method==='put'&&fail)throw Error('network unknown');return response(12,payload?.mode||'auto',payload?.mode==='enabled');});await flush();f.s.mode.value='enabled';await f.s.save();
  assert.equal(f.s.mode.value,'enabled');assert.equal(f.s.state.value.mode,'auto');assert.equal(f.s.ready.value,false);assert.equal(f.events.length,0);assert.match(f.s.error.value,/结果未确认/);
  await f.s.save();assert.equal(f.calls.filter(c=>c.method==='put').length,1);await f.s.load();fail=false;await f.s.save();assert.equal(f.s.state.value.mode,'enabled');assert.equal(f.events.length,1);f.dispose();
});
test('read reconciles a previously ambiguous write without replaying PUT',async()=>{
  let remote='auto';const f=sheet(async(method,_url,payload)=>{if(method==='put'){remote=payload.mode;throw Error('response lost');}return response(12,remote,remote==='enabled');});await flush();f.s.mode.value='enabled';await f.s.save();await f.s.load();
  assert.equal(f.s.state.value.mode,'enabled');assert.equal(f.s.mode.value,'enabled');assert.equal(f.s.canSave.value,false);assert.equal(f.events.length,0);assert.equal(f.calls.filter(c=>c.method==='put').length,1);f.dispose();
});
test('PUT with foreign ID/missing eligible/mismatched mode never publishes success',async()=>{
  for(const invalid of [response(13,'enabled',true),{account_id:12,mode:'enabled',reason:'x'},response(12,'disabled',false)]){
    const f=sheet(async method=>method==='put'?invalid:response());await flush();f.s.mode.value='enabled';await f.s.save();assert.equal(f.s.state.value.mode,'auto');assert.equal(f.s.mode.value,'enabled');assert.equal(f.events.length,0);assert.equal(f.s.needsReload.value,true);f.dispose();
  }
});
test('duplicate reads/saves and close during save are fenced',async()=>{
  const reading=deferred(),writing=deferred(),f=sheet(method=>method==='get'?reading.promise:writing.promise);
  await f.s.load();assert.equal(f.calls.length,1);reading.resolve(response());await flush();f.s.mode.value='enabled';const p=f.s.save();await f.s.save();await f.s.load();f.s.close();
  assert.equal(f.calls.length,2);assert.equal(f.events.length,0);writing.resolve(response(12,'enabled',true));await p;assert.equal(f.events.length,1);f.s.close();assert.equal(f.events[1][0],'close');f.dispose();
});
test('late read for previous account cannot populate or clear current busy state',async()=>{
  const old=deferred(),next=deferred(),f=sheet((_method,url)=>url.includes('/12/')?old.promise:next.promise);f.props.account=account(13);
  old.resolve(response(12,'enabled',true));await flush();assert.equal(f.s.state.value,null);assert.equal(f.s.loading.value,true);
  next.resolve(response(13,'disabled',false));await flush();assert.equal(f.s.state.value.account_id,13);assert.equal(f.s.mode.value,'disabled');f.dispose();
});
test('late rejected PUT cannot damage next account state or emit saved',async()=>{
  const old=deferred(),f=sheet(async(method,url)=>method==='put'?old.promise:response(Number(url.split('/')[3])));await flush();f.s.mode.value='enabled';const p=f.s.save();f.props.account=account(13);await flush();old.reject(Error('late'));await p;
  assert.equal(f.s.state.value.account_id,13);assert.equal(f.s.error.value,'');assert.equal(f.s.saving.value,false);assert.equal(f.events.length,0);f.dispose();
});
test('late fulfilled PUT and A-B-A identity cycles remain fenced by generation',async()=>{
  const pending=deferred(),f=sheet(async(method,url)=>method==='put'?pending.promise:response(Number(url.split('/')[3])));await flush();f.s.mode.value='enabled';const p=f.s.save();f.props.account=account(13);f.props.account=account(12);await flush();pending.resolve(response(12,'enabled',true));await p;
  assert.equal(f.s.state.value.mode,'auto');assert.equal(f.events.length,0);f.dispose();
});
test('same-account object refresh preserves draft without reloading',async()=>{
  const f=sheet();await flush();f.s.mode.value='disabled';const count=f.calls.length;f.props.account={...f.props.account,name:'new name',extra:{server:'new'}};await flush();assert.equal(f.calls.length,count);assert.equal(f.s.mode.value,'disabled');f.dispose();
});
test('changing type in place clears eligibility immediately and ignores old response',async()=>{
  const pending=deferred(),f=sheet(()=>pending.promise);f.props.account.type='apikey';pending.resolve(response(12,'enabled',true));await flush();assert.equal(f.s.supported.value,false);assert.equal(f.s.state.value,null);assert.equal(f.events.length,0);f.dispose();
});
test('close during read and unmount during save fence late results/events',async()=>{
  const pending=deferred(),f=sheet(()=>pending.promise);f.s.close();pending.resolve(response());await flush();assert.equal(f.s.state.value,null);assert.deepEqual(plain(f.events),[['close']]);f.dispose();
  const write=deferred(),g=sheet(method=>method==='put'?write.promise:response());await flush();g.s.mode.value='enabled';const p=g.s.save();g.dispose();write.resolve(response(12,'enabled',true));await p;assert.equal(g.events.length,0);assert.equal(g.s.state.value.mode,'auto');
});
test('actual eligible boolean wins over reason labels',async()=>{
  const f=sheet(async()=>response(12,'auto',true,'billing_inconclusive'));await flush();assert.equal(f.s.state.value.eligible,true);assert.match(f.s.reasonText.value,/不足/);f.dispose();
});
test('Sheet and CSS compile, reuse MacSheet, no extra writes or secret rendering',()=>{
  const {descriptor,errors}=sfc.parse(sheetSource,{filename:sheetFile});assert.deepEqual(errors,[]);const script=sfc.compileScript(descriptor,{id:'grok-media-test',inlineTemplate:true});assert(script.content.includes('MacSheet'));assert.deepEqual(sfc.compileStyle({source:descriptor.styles[0].content,filename:sheetFile,id:'grok-media-test',scoped:true}).errors,[]);
  assert(!/account\.extra|account\.credentials|apiClient\.|accountsAPI\.update\(/.test(sheetSource));assert.match(sheetSource,/:loading="saving"/);assert.match(sheetSource,/:disabled="!canSave"/);
  assert(!sheetSource.includes(':loading="loading"'),'read indicators must not lock shared modal dismissal');
});
