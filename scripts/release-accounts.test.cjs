// node --test scripts/parity-accounts.test.cjs
// Actual TypeScript adapters and Vue setup scripts; all HTTP is replaced by fixtures.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
const vue = req('vue');
const { parse, compileTemplate } = req('vue/compiler-sfc');
const plain = v => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function modules(handler) {
  const calls = [];
  const cache = new Map();
  const apiClient = Object.fromEntries(['get','post','put','delete'].map(method => [method, async (url, payload) => {
    calls.push({method,url,payload:plain(payload ?? null)});
    return {data:await handler(method,url,payload)};
  }]));
  function load(file) {
    file = path.resolve(src,file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = {exports:{}}; cache.set(file,module);
    const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const sandbox = {module,exports:module.exports,URL,Error,Date,AbortController,TextEncoder,console,
      require(spec) {
        if (spec === '../client') return {apiClient};
        if (spec.startsWith('@/')) return load(spec.slice(2)+'.ts');
        if (spec.startsWith('.')) return load(path.resolve(path.dirname(file),spec)+'.ts');
        throw new Error(`Forbidden import: ${spec}`);
      },fetch(){throw new Error('Live network forbidden');}};
    vm.runInNewContext(js,sandbox,{filename:file});
    return module.exports;
  }
  return {load,calls};
}
function component(file, overrides={}, props={}) {
  const filename=path.join(src,file);
  const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename});
  assert.deepEqual(errors,[]);
  const compiled=compileTemplate({source:descriptor.template.content,filename,id:'fixture',compilerOptions:{expressionPlugins:['typescript']}});
  assert.deepEqual(compiled.errors,[]);
  let source=descriptor.scriptSetup.content;
  const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
  for(const n of [...ast.statements].reverse()) if(ts.isImportDeclaration(n)) source=source.slice(0,n.pos)+source.slice(n.end);
  const events=[],mounted=[],unmounted=[];
  const scope=vue.effectScope();
  const auth=vue.reactive({user:{id:8,role:'admin'},token:'fixture-token',sessionRevision:0});
  const storage=()=>{const values=new Map();return {
    getItem:key=>values.get(String(key))??null,
    setItem:(key,value)=>{values.set(String(key),String(value));},
    removeItem:key=>{values.delete(String(key));}
  };};
  const context={...vue,...modules(async()=>[]).load('apps/admin/accounts/cn-provider.ts'),Error,URL,Date,AbortController,TextEncoder,console,
    useAuthStore:()=>auth,localStorage:storage(),sessionStorage:storage(),
    defineProps:()=>props,defineEmits:()=> (...args)=>events.push(args),
    onMounted:fn=>mounted.push(fn),onUnmounted:fn=>unmounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn),
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    document:{hidden:false,removeEventListener(){}},
    fetch(){throw new Error('Live network forbidden');},...overrides};
  const js=ts.transpileModule(source+`\nglobalThis.subject={${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  scope.run(()=>vm.runInNewContext(js,context,{filename}));
  return {s:context.subject,events,mounted,dispose(){unmounted.forEach(fn=>fn());scope.stop();}};
}
const prefix='apps/admin/accounts/';
function oauthFixture(handler=async(method,url)=>url.includes('exchange')?{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:123456}:{auth_url:'https://provider.example/authorize?state=fixture-state',session_id:'fixture-session',state:'fixture-state'}) {
  const f=modules(handler); return {...f,oauth:f.load(prefix+'oauth.ts')};
}
const tick=()=>new Promise(r=>setImmediate(r));
const adapters=()=>modules(async()=>[]).load(prefix+'platform-controls.ts');
test('AI Studio checks custom-client capability before auth URL and persists OAuth type',async()=>{
 const f=oauthFixture(async(m,url)=>url.endsWith('capabilities')?{ai_studio_oauth_enabled:true,required_redirect_uris:['https://fixture.invalid/callback']}:url.endsWith('exchange-code')?{access_token:'fixture',oauth_type:'ai_studio',extra:{tier:'fixture'}}:{auth_url:'https://provider.invalid/?state=x',session_id:'s',state:'x'});
 const o={platform:'gemini',type:'oauth',oauth_type:'ai_studio'};const session=await f.oauth.startOAuth(o);const result=await f.oauth.finishOAuth(o,session,'code');
 assert.equal(f.calls[0].url,'/admin/gemini/oauth/capabilities');assert.equal(f.calls[1].payload.oauth_type,'ai_studio');assert.equal(f.calls[2].payload.oauth_type,'ai_studio');assert.equal(result.credentials.oauth_type,'ai_studio');assert.equal(result.extra.tier,'fixture');
});
for(const fail of [false,'error'])test(`AI Studio unavailable ${fail} never generates a URL`,async()=>{
 const f=oauthFixture(async()=>{if(fail==='error')throw Error('fixture offline');return {ai_studio_oauth_enabled:false}});
 await assert.rejects(()=>f.oauth.startOAuth({platform:'gemini',type:'oauth',oauth_type:'ai_studio'}));assert.equal(f.calls.length,1);
});
test('Gemini capability late response cannot enable a replaced platform',async()=>{
 const late=deferred();const f=component(prefix+'OAuthAuthorization.vue',{gemini:{getCapabilities:()=>late.promise},operationError:(e,m)=>m},{options:vue.reactive({platform:'gemini',type:'oauth'})});
 f.s.geminiEnabled.value=false; f.s.reset();f.dispose();late.resolve({ai_studio_oauth_enabled:true});await tick();assert.equal(f.s.geminiEnabled.value,false);
});
for(const [platform,type] of [['anthropic','oauth'],['anthropic','apikey'],['openai','oauth'],['openai','apikey'],['antigravity','oauth'],['grok','oauth'],['minimax','apikey']])test(`${platform}/${type} every exposed switch writes exact location and preserves concurrent fields`,()=>{
 const a=adapters(),account={platform,type,credentials:{token:'keep'},extra:{future:'keep'}},initial=a.platformForm(account);
 assert.deepEqual(plain(a.applyPlatform(initial,initial,account)),{});
 for(const d of a.controls.filter(d=>d.scope(platform,type))){const f=structuredClone(plain(initial));f.values[d.key]=d.numeric?0.8:d.choices?d.choices[1]:true;const patch=a.applyPlatform(f,initial,account);assert.equal((d.credential?patch.credentials:patch.extra)[d.key],f.values[d.key]);assert.equal((d.credential?patch.credentials:patch.extra)[d.credential?'token':'future'],'keep');}
});
test('headers reject auth, session, duplicates, controls and UTF8 oversize; blank means deletion',()=>{
 const a=adapters(),account={platform:'openai',type:'apikey',credentials:{api_key:'keep'},extra:{}},initial=a.platformForm(account);
 for(const headers of [[{name:'Authorization',value:'x'}],[{name:'session_id',value:''}],[{name:'x-a',value:'1'},{name:'X-A',value:'2'}],[{name:'x-a',value:'x\ny'}],[{name:'x-a',value:'测'.repeat(3000)}]]){const f={...initial,headersEnabled:true,headers};assert.throws(()=>a.applyPlatform(f,initial,account));}
 const patch=a.applyPlatform({...initial,headersEnabled:true,headers:[{name:'X-App',value:''}]},initial,account);assert.equal(patch.credentials.header_overrides['x-app'],'');assert.equal(patch.credentials.api_key,'keep');
});
test('TLS TTL masking restore flattened fields, clear dependent keys, preserve latest unknowns',()=>{
 const a=adapters(),account={platform:'anthropic',type:'oauth',enable_tls_fingerprint:true,tls_fingerprint_profile_id:8,cache_ttl_override_enabled:true,cache_ttl_override_target:'1h',extra:{future:1}},initial=a.platformForm(account);assert.equal(initial.tlsProfile,8);assert.equal(initial.ttl,'1h');
 const f=structuredClone(plain(initial));f.values.enable_tls_fingerprint=false;f.values.cache_ttl_override_enabled=false;f.values.session_id_masking_enabled=true;
 const patch=a.applyPlatform(f,initial,{...account,extra:{future:2,tls_fingerprint_profile_id:8,cache_ttl_override_target:'1h'}});assert.equal(patch.extra.future,2);assert.equal(patch.extra.tls_fingerprint_profile_id,undefined);assert.equal(patch.extra.cache_ttl_override_target,undefined);assert.equal(patch.extra.session_id_masking_enabled,true);
});
test('OpenAI endpoint and image tool changes clear obsolete keys without changing secrets',()=>{
 const a=adapters(),account={platform:'openai',type:'apikey',credentials:{api_key:'keep'},extra:{openai_responses_mode:'force_responses'}},initial=a.platformForm(account);
 const p=a.applyPlatform({...initial,capabilities:['embeddings']},initial,account);assert.deepEqual(plain(p.credentials.openai_capabilities),['embeddings']);assert.equal(p.extra.openai_responses_mode,undefined);
 const oauth={...account,type:'oauth',extra:{codex_image_generation_bridge:true}};const i=a.platformForm(oauth);const q=a.applyPlatform({...i,imageTool:'strip'},i,oauth);assert.equal(q.extra.codex_image_generation_explicit_tool_policy,'strip');assert.equal(q.extra.codex_image_generation_bridge,undefined);
});
test('temporary scheduling rules validate before write and serialize keyword array',()=>{
 const a=adapters(),account={platform:'anthropic',type:'oauth'},i=a.platformForm(account);assert.throws(()=>a.applyPlatform({...i,tempEnabled:true},i,account));
 const p=a.applyPlatform({...i,tempEnabled:true,tempRules:[{error_code:429,keywords:'quota,limit',duration_minutes:30,description:' fixture '}]},i,account);assert.deepEqual(plain(p.credentials.temp_unschedulable_rules),[{error_code:429,keywords:['quota','limit'],duration_minutes:30,description:'fixture'}]);
});
function editor(api={}){
 const m=modules(async()=>[]),writes=[];const f=component('apps/admin/AccountsApp.vue',{...m.load(prefix+'advanced.ts'),...m.load(prefix+'oauth.ts'),...m.load(prefix+'policies.ts'),accountsAPI:{checkMixedChannelRisk:async()=>({has_risk:true,details:{group_name:'Fixture'}}),create:async p=>{writes.push(plain(p));return {id:1}},list:async()=>({items:[],total:0,page_size:20}),...api},groupsAPI:{},getAppIcon:()=>''});
 f.s.showAddSheet.value=true;f.s.accountForm.value.name='Fixture';f.s.accountForm.value.credentials='fixture-key';f.s.accountForm.value.groups=[1];return {...f,writes};
}
test('mixed risk cancel writes zero; explicit confirmation writes once with flag',async()=>{
 const f=editor();let p=f.s.handleSaveAccount();await tick();assert.ok(f.s.mixedRisk.value);assert.equal(f.writes.length,0);f.s.resolveMixedRisk(false);await p;assert.equal(f.writes.length,0);assert.equal(f.s.accountForm.value.name,'Fixture');
 p=f.s.handleSaveAccount();await tick();await f.s.handleSaveAccount();f.s.resolveMixedRisk(true);await p;assert.equal(f.writes.length,1);assert.equal(f.writes[0].confirm_mixed_channel_risk,true);f.dispose();
});
test('failed or stale mixed risk checks cannot create accounts',async()=>{
 const f=editor({checkMixedChannelRisk:async()=>{throw Error('offline')}});await f.s.handleSaveAccount();assert.equal(f.writes.length,0);assert.match(f.s.formError.value,/offline/);f.dispose();
 const late=deferred(),g=editor({checkMixedChannelRisk:()=>late.promise});const p=g.s.handleSaveAccount();g.dispose();late.resolve({has_risk:true});await p;assert.equal(g.writes.length,0);
});
test('409 warning asks for explicit reconfirmation; no blind retry',async()=>{
 let n=0;const f=editor({checkMixedChannelRisk:async()=>({has_risk:false}),create:async p=>{n++;if(n===1)throw {status:409,error:'mixed_channel_warning'};assert.equal(p.confirm_mixed_channel_risk,true);return {id:1}}});
 const pending=f.s.handleSaveAccount();await tick();assert.equal(n,1);assert.ok(f.s.mixedRisk.value);f.s.resolveMixedRisk(true);await pending;assert.equal(n,2);f.dispose();
});
test('batch group change asks risk confirmation before a single bulk write',async()=>{
 let n=0;const f=editor({bulkUpdate:async(ids,p)=>{n++;assert.deepEqual(plain(ids),[1]);assert.equal(p.confirm_mixed_channel_risk,true);return {success:1,failed:0}}});
 f.s.accounts.value=[{id:1,platform:'anthropic'}];f.s.selectedIds.value=[1];f.s.openBatchEdit();f.s.batchForm.value.group_ids=[2];
 const pending=f.s.handleBulkUpdateSubmit();await tick();assert.equal(n,0);f.s.resolveMixedRisk(true);await pending;assert.equal(n,1);f.dispose();
});
test('turning passthrough on cannot simultaneously change model mappings',()=>{
 const p=modules(async()=>[]).load(prefix+'policies.ts'),account={platform:'openai',type:'apikey',credentials:{},extra:{}},initial=p.policyForm(account),form=structuredClone(plain(initial));
 form.allowed='gpt-fixture';form.platformControls.values.openai_passthrough=true;assert.throws(()=>p.applyPolicies(form,initial,account,true));
});
test('all platform defaults and toggled-back values produce no new credential or extra keys',()=>{
 const a=adapters();
 for(const platform of ['anthropic','openai','gemini','antigravity','grok','minimax'])for(const type of ['apikey','oauth','setup-token']){
  const account={platform,type,credentials:{untouched:'fixture'},extra:{cache_runtime:{bytes:[1,2,3]}}};const i=a.platformForm(account),f=structuredClone(plain(i));
  for(const d of a.controls.filter(d=>d.scope(platform,type))){f.values[d.key]=d.numeric?0.5:d.choices?d.choices[1]:true;f.values[d.key]=i.values[d.key];}
  assert.deepEqual(plain(a.applyPlatform(f,i,account)),{});
 }
});
test('TTL-only update preserves cache and fingerprint bytes without sending credentials',()=>{
 const a=adapters(),account={platform:'anthropic',type:'oauth',credentials:{header_overrides:{'x-private':'fixture-secret'}},extra:{cache_ttl_override_enabled:true,cache_ttl_override_target:'5m',cache_runtime:{used:9},fingerprint_bytes:[0,128,255],tls_fingerprint_profile_id:7}};
 const i=a.platformForm(account),p=a.applyPlatform({...i,ttl:'1h'},i,account);assert.equal(p.credentials,undefined);assert.deepEqual(plain(p.extra.cache_runtime),{used:9});assert.deepEqual(plain(p.extra.fingerprint_bytes),[0,128,255]);assert.equal(p.extra.tls_fingerprint_profile_id,7);
});
test('header UTF8 boundary accepts exactly 8192 bytes and rejects 8193 without echoing values',()=>{
 const a=adapters(),account={platform:'openai',type:'apikey'},i=a.platformForm(account),value='测'.repeat(2730)+'ab';
 assert.equal(new TextEncoder().encode(value).length,8192);
 assert.equal(a.applyPlatform({...i,headersEnabled:true,headers:[{name:'x-fixture',value}]},i,account).credentials.header_overrides['x-fixture'],value);
 assert.throws(()=>a.applyPlatform({...i,headersEnabled:true,headers:[{name:'x-fixture',value:value+'c'}]},i,account),e=>!e.message.includes(value));
});
test('both initial and reconfirmed save errors never display echoed headers or fingerprint bytes',async()=>{
 for(const second of [false,true]){
  let n=0;const secret='fixture-private-header-012345';const f=editor({checkMixedChannelRisk:async()=>({has_risk:false}),create:async()=>{n++;if(second&&n===1)throw {status:409,error:'mixed_channel_warning'};throw {status:400,message:secret+' fingerprint=[0,128,255]'};}});
  const pending=f.s.handleSaveAccount();await tick();if(second)f.s.resolveMixedRisk(true);await pending;
  assert.equal(n,second?2:1);assert.ok(f.s.showAddSheet.value);assert.match(f.s.formError.value,/HTTP 400/);assert.ok(!f.s.formError.value.includes(secret));assert.ok(!f.s.formError.value.includes('128'));f.dispose();
 }
});
