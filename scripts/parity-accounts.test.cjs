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
    const sandbox = {module,exports:module.exports,URL,Error,Date,AbortController,console,
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
  const context={...vue,...modules(async()=>[]).load('apps/admin/accounts/cn-provider.ts'),Error,URL,Date,AbortController,console,
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
for(const [platform,type,start,end] of [
  ['anthropic','oauth','/admin/accounts/generate-auth-url','/admin/accounts/exchange-code'],
  ['anthropic','setup-token','/admin/accounts/generate-setup-token-url','/admin/accounts/exchange-setup-token-code'],
  ['openai','oauth','/admin/openai/generate-auth-url','/admin/openai/exchange-code'],
  ['gemini','oauth','/admin/gemini/oauth/auth-url','/admin/gemini/oauth/exchange-code'],
  ['antigravity','oauth','/admin/antigravity/oauth/auth-url','/admin/antigravity/oauth/exchange-code'],
  ['grok','oauth','/admin/grok/oauth/auth-url','/admin/grok/oauth/exchange-code'],
]) test(`${platform}/${type}: real adapters generate then exchange exact provider payload`,async()=>{
  const f=oauthFixture();const options={platform,type,proxy_id:7,...(platform==='gemini'?{project_id:'project',oauth_type:'google_one',tier_id:'tier'}:{})};
  const session=await f.oauth.startOAuth(options);
  const result=await f.oauth.finishOAuth(options,session,'https://localhost/callback?code=fixture-code&state=fixture-state');
  assert.equal(f.calls[0].url,start);assert.equal(f.calls[1].url,end);
  assert.equal(f.calls[1].payload.code,'fixture-code');assert.equal(f.calls[1].payload.session_id,'fixture-session');assert.equal(f.calls[1].payload.proxy_id,7);
  assert.equal(f.calls[1].payload.state,platform==='anthropic'?undefined:'fixture-state');
  assert.equal(result.credentials.refresh_token,'fixture-refresh');
  assert.equal(result.credentials.expires_at,['gemini','antigravity'].includes(platform)?'123456':123456);
  if(platform==='gemini') {assert.equal(f.calls[0].payload.project_id,'project');assert.equal(f.calls[1].payload.oauth_type,'google_one');assert.equal(f.calls[1].payload.project_id,undefined);}
});
test('callback mismatch, denied consent, empty code, unsafe URL, missing state never exchange',async()=>{
  const f=oauthFixture();const opts={platform:'openai',type:'oauth'};const session=await f.oauth.startOAuth(opts);
  for(const input of ['https://localhost/?code=x&state=other','https://localhost/?error=access_denied','']) await assert.rejects(f.oauth.finishOAuth(opts,session,input));
  assert.equal(f.calls.length,1);
  const unsafe=oauthFixture(async()=>({auth_url:'javascript:alert(1)',session_id:'s'}));await assert.rejects(unsafe.oauth.startOAuth(opts));
  const noState=oauthFixture(async()=>({auth_url:'https://provider.example/',session_id:'s'}));await assert.rejects(noState.oauth.startOAuth(opts));
  await assert.rejects(f.oauth.startOAuth({platform:'unknown-provider',type:'oauth'}));assert.equal(f.calls.length,1);
});
test('provider mapping retains metadata without inventing expiry or empty refresh tokens',()=>{
  const {oauth}=oauthFixture();assert.throws(()=>oauth.mapOAuthResult('openai',{refresh_token:'x'}));
  const result=oauth.mapOAuthResult('openai',{access_token:'x',refresh_token:'',client_id:'c',email:'a',privacy_mode:'private',expires_in:60});
  assert.deepEqual(plain(result),{credentials:{access_token:'x',client_id:'c',email:'a'},extra:{email:'a',privacy_mode:'private'}});
  const gemini=oauth.mapOAuthResult('gemini',{access_token:'x',extra:{privacy_mode:'private'},expires_at:123.9});assert.equal(gemini.credentials.expires_at,'123');assert.equal(gemini.extra.privacy_mode,'private');
});
test('reauthorization uses dedicated API, omits empty secrets, never PUTs redacted credentials',async()=>{
  const f=oauthFixture(async()=>({id:9,status:'active'}));await f.oauth.saveReauthorization(9,'oauth',{credentials:{access_token:'new',refresh_token:''},extra:{email:'new'}});
  assert.deepEqual(f.calls,[{method:'post',url:'/admin/accounts/9/apply-oauth-credentials',payload:{type:'oauth',credentials:{access_token:'new'},extra:{email:'new'}}}]);
});
test('OAuth UI blocks duplicate exchange and keeps exchanged result for save',async()=>{
  const d=deferred();let exchanges=0;const {oauth}=oauthFixture();
  const f=component(prefix+'OAuthAuthorization.vue',{...oauth,startOAuth:async()=>({auth_url:'https://provider.example',session_id:'s'}),finishOAuth:()=>{exchanges++;return d.promise;}},{options:{platform:'anthropic',type:'oauth'}});
  await f.s.run(false);f.s.input.value='code';const pending=f.s.run(true);await f.s.run(true);assert.equal(exchanges,1);
  d.resolve({credentials:{access_token:'fixture'}});await pending;assert.equal(f.s.done.value,true);assert.equal(f.s.input.value,'');assert.equal(f.s.session.value,null);
  assert.equal(f.events.filter(e=>e[0]==='result'&&e[1]).length,1);await f.s.run(true);assert.equal(exchanges,1);f.dispose();
});
test('OAuth option changes and unmount invalidate late responses and wipe secrets',async()=>{
  const d=deferred();const {oauth}=oauthFixture();const props=vue.reactive({options:{platform:'anthropic',type:'oauth'}});
  const f=component(prefix+'OAuthAuthorization.vue',{...oauth,startOAuth:()=>d.promise},props);
  const pending=f.s.run(false);props.options={platform:'openai',type:'oauth'};d.resolve({auth_url:'https://old.example',session_id:'old'});await pending;assert.equal(f.s.session.value,null);
  f.s.input.value='sensitive';f.dispose();assert.equal(f.s.input.value,'');assert.equal(f.events.at(-1)[1],null);
});
test('OAuth plain API error remains visible and can retry',async()=>{
  const {oauth}=oauthFixture();let fail=true;
  const f=component(prefix+'OAuthAuthorization.vue',{...oauth,startOAuth:async()=>{if(fail)throw {message:'授权会话已过期'};return {auth_url:'https://provider.example',session_id:'s'};}},{options:{platform:'anthropic',type:'oauth'}});
  await f.s.run(false);assert.equal(f.s.error.value,'授权会话已过期');assert.equal(f.s.busy.value,false);fail=false;await f.s.run(false);assert.equal(f.s.session.value.session_id,'s');f.dispose();
});
test('visible OAuth URL copies exact session URL and ignores stale clipboard completion',async()=>{
 const {oauth}=oauthFixture();const copied=[];const pending=deferred();
 const f=component(prefix+'OAuthAuthorization.vue',{...oauth,startOAuth:async()=>({auth_url:'https://provider.example/auth?state=one',session_id:'one'}),navigator:{clipboard:{writeText:text=>{copied.push(text);return pending.promise;}}}},{options:{platform:'anthropic',type:'oauth'}});
 await f.s.run(false);const copy=f.s.copyAuthorizationURL();f.s.reset();pending.resolve();await copy;
 assert.equal(copied[0],'https://provider.example/auth?state=one');assert.equal(f.s.copyNotice.value,'');f.dispose();
});
test('clipboard refusal preserves selectable link with manual copy guidance',async()=>{
 const {oauth}=oauthFixture();const f=component(prefix+'OAuthAuthorization.vue',{...oauth,startOAuth:async()=>({auth_url:'https://provider.example/auth',session_id:'one'}),navigator:{clipboard:{writeText:async()=>{throw Error('denied');}}}},{options:{platform:'anthropic',type:'oauth'}});
 await f.s.run(false);await f.s.copyAuthorizationURL();assert.match(f.s.copyNotice.value,/手动复制/);assert.equal(f.s.session.value.auth_url,'https://provider.example/auth');f.dispose();
});
test('reauthorization partial success retries only clearing error, not applying credentials',async()=>{
  const {oauth}=oauthFixture();let applied=0,cleared=0;
  const f=component(prefix+'ReauthorizeSheet.vue',{...oauth,saveReauthorization:async()=>{applied++;return {status:'error'};},accountsAPI:{getById:async()=>({platform:'openai',type:'oauth',proxy_id:8,credentials:{}}),clearError:async()=>{cleared++;if(cleared===1)throw {message:'failed'};}}},{account:{id:9,name:'fixture'}});
  await f.s.load();f.s.result.value={credentials:{access_token:'x'}};await f.s.save();assert.equal(f.s.credentialsSaved.value,true);assert.match(f.s.error.value,/已保存/);
  await f.s.save();assert.equal(applied,1);assert.equal(cleared,2);assert.ok(f.events.some(e=>e[0]==='close'));f.dispose();
});
function schedules(overrides={}) {
  const calls=[];let plans=[];
  const api={listByAccount:async()=>plans,create:async p=>{calls.push(['create',plain(p)]);plans=[{...p,id:4}];return plans[0];},update:async(id,p)=>{calls.push(['update',id,plain(p)]);plans=plans.map(row=>row.id===id?{...row,...p}:row);},delete:async id=>{calls.push(['delete',id]);plans=plans.filter(p=>p.id!==id);},listResults:async()=>[],...overrides};
  const f=component(prefix+'ScheduledTestsSheet.vue',{scheduledTestsAPI:api,accountsAPI:{getAvailableModels:async()=>[{id:'model-fixture'}]},operationError:oauthFixture().oauth.operationError},{account:{id:9,name:'fixture'}});
  return {...f,api,calls};
}
test('plans create/edit/disable/delete payloads and reload are complete',async()=>{
  const f=schedules();await f.s.load();f.s.edit();f.s.form.value.model_id=' model-fixture ';await f.s.save();
  assert.deepEqual(f.calls[0],['create',{account_id:9,model_id:'model-fixture',cron_expression:'*/30 * * * *',enabled:true,max_results:100,auto_recover:false}]);
  f.s.edit(f.s.plans.value[0]);f.s.form.value.enabled=false;f.s.form.value.auto_recover=true;await f.s.save();assert.equal(f.calls[1][0],'update');assert.equal(f.calls[1][2].enabled,false);assert.equal('account_id' in f.calls[1][2],false);
  f.s.pendingDelete.value=f.s.plans.value[0];await f.s.remove();assert.deepEqual(f.calls[2],['delete',4]);assert.equal(f.s.plans.value.length,0);assert.equal(f.s.pendingDelete.value,null);f.dispose();
});
test('plan load failure blocks writes, retry unlocks; invalid input never posts',async()=>{
  let fail=true;const f=schedules({listByAccount:async()=>{if(fail)throw {status:404};return [];}});await f.s.load();assert.match(f.s.error.value,/未提供/);f.s.edit();await f.s.save();assert.equal(f.calls.length,0);
  fail=false;await f.s.load();f.s.edit();f.s.form.value.model_id='x';f.s.form.value.cron_expression='bad';await f.s.save();assert.equal(f.calls.length,0);
  f.s.form.value.cron_expression='0 * * * *';f.s.form.value.max_results=0;await f.s.save();assert.equal(f.calls.length,0);f.dispose();
});
test('plan duplicate submit is blocked; successful write + failed reload is not retryable create',async()=>{
  const d=deferred();let reads=0,creates=0;const f=schedules({listByAccount:async()=>{if(++reads>1)throw {message:'offline'};return [];},create:()=>{creates++;return d.promise;}});
  await f.s.load();f.s.edit();f.s.form.value.model_id='x';const pending=f.s.save();await f.s.save();assert.equal(creates,1);d.resolve({id:1});await pending;
  assert.equal(f.s.ready.value,false);assert.equal(f.s.editing.value,undefined);assert.match(f.s.error.value,/操作已成功/);await f.s.save();assert.equal(creates,1);f.dispose();
});
test('plan result races cannot show the previous plan data; failure offers retry',async()=>{
  const a=deferred(),b=deferred();const f=schedules({listResults:id=>id===1?a.promise:b.promise});const p=f.s.history(1);const q=f.s.history(2);
  b.resolve([{id:2,status:'failed',error_message:'fixture error'}]);await q;a.resolve([{id:1,status:'success'}]);await p;assert.equal(f.s.results.value[0].id,2);
  f.api.listResults=async()=>{throw {message:'results unavailable'};};await f.s.history(2);assert.equal(f.s.results.value.length,0);assert.equal(f.s.resultsError.value,'results unavailable');f.dispose();
});
test('scheduled API routes, false booleans, result limit and malformed list guard',async()=>{
  let response=[];const f=modules(async()=>response);const api=f.load('api/admin/scheduledTests.ts');
  await api.listByAccount(9);await api.create({account_id:9,model_id:'x',cron_expression:'0 * * * *'});await api.update(4,{enabled:false,auto_recover:false});await api.listResults(4,20);await api.deletePlan(4);
  assert.deepEqual(f.calls.map(c=>[c.method,c.url]),[['get','/admin/accounts/9/scheduled-test-plans'],['post','/admin/scheduled-test-plans'],['put','/admin/scheduled-test-plans/4'],['get','/admin/scheduled-test-plans/4/results'],['delete','/admin/scheduled-test-plans/4']]);
  assert.deepEqual(f.calls[2].payload,{enabled:false,auto_recover:false});assert.deepEqual(f.calls[3].payload,{params:{limit:20}});
  response={items:[]};await assert.rejects(api.listByAccount(9));await assert.rejects(api.listResults(4));
});
test('advanced fields preserve unchanged data; zero/free, clear sentinels and invalid numbers',()=>{
  const f=modules(async()=>[]).load(prefix+'advanced.ts');const initial=f.advancedForm({notes:'keep',expires_at:1700000000,load_factor:5,rate_multiplier:2,proxy_id:7});
  assert.deepEqual(plain(f.advancedPatch({...initial},initial,true)),{});
  const patch=f.advancedPatch({...initial,expires:'',load_factor:'',rate_multiplier:0,proxy_id:null},initial,true);
  assert.deepEqual(plain(patch),{proxy_id:null,load_factor:0,rate_multiplier:0,expires_at:0});
  for(const [key,value] of [['rate_multiplier',-1],['load_factor',1.5],['proxy_id',-1],['expires','invalid']])assert.throws(()=>f.advancedPatch({...initial,[key]:value},initial,true));
});
test('AccountsApp creation requires completed OAuth and submits advanced and provider metadata',async()=>{
  const m=modules(async()=>[]);const advanced=m.load(prefix+'advanced.ts');const {oauth}=oauthFixture();const writes=[];
  const policies=m.load(prefix+'policies.ts');
  const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,accountsAPI:{create:async p=>{writes.push(plain(p));return {id:123};},list:async()=>({items:[],total:0,page_size:20})},groupsAPI:{},getAppIcon:()=>''});
  f.s.openAddSheet();f.s.accountForm.value.name='Fixture';f.s.accountForm.value.platform='openai';f.s.accountForm.value.type='oauth';await vue.nextTick();
  await f.s.handleSaveAccount();assert.equal(writes.length,0);assert.match(f.s.formError.value,/交互式授权/);
  f.s.oauthResult.value={credentials:{access_token:'fixture',refresh_token:'refresh'},extra:{email:'fixture'}};f.s.advanced.value.rate_multiplier=0;
  await f.s.handleSaveAccount();assert.equal(writes.length,1);assert.equal(writes[0].type,'oauth');assert.equal(writes[0].credentials.refresh_token,'refresh');assert.equal(writes[0].rate_multiplier,0);assert.deepEqual(writes[0].extra,{email:'fixture'});assert.equal(f.s.showAddSheet.value,false);f.dispose();
});
test('all owned Vue templates compile using the real SFC compiler',()=>{
  for(const name of ['AccountAdvancedFields.vue','AccountPolicies.vue','BatchAuthorizationSheet.vue','OAuthAuthorization.vue','ReauthorizeSheet.vue','ScheduledTestsSheet.vue']) {
    const filename=path.join(src,prefix,name);const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(errors,[]);
    assert.deepEqual(compileTemplate({source:descriptor.template.content,filename,id:name,compilerOptions:{expressionPlugins:['typescript']}}).errors,[]);
  }
});
test('isolated vue-tsc checks owned files and the actual shared Sheet/Button dependencies',()=>{
  const os=require('node:os'),cp=require('node:child_process');
  const pkg=path.join(root,'packages/sub2-console');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sub2-accounts-typecheck-'));
  const core=path.join(root,'packages/mac-ui-core/src').replaceAll('\\','/');
  const entry=path.join(tmp,'core-entry.ts');
  // Narrow the barrel to real dependencies used here; do not check other workers' apps/core UI.
  fs.writeFileSync(entry,`export * from '${core}/types';\n`+['MacButton','MacSheet','MacAlertSheet'].map(n=>`export {default as ${n}} from '${core}/components/${n}.vue';`).join('\n'));
  const config=path.join(tmp,'tsconfig.json');
  const files=[path.join(src,'apps/admin/AccountsApp.vue'),...fs.readdirSync(path.join(src,prefix)).filter(x=>/\.(ts|vue)$/.test(x)).map(x=>path.join(src,prefix,x))];
  fs.writeFileSync(config,JSON.stringify({extends:path.join(pkg,'tsconfig.json'),compilerOptions:{types:[path.join(pkg,'node_modules/vite/client.d.ts')],paths:{'@/*':[path.join(src,'*')],'@sub2-mac/core':[entry]}},include:[],files}));
  try {
    const r=cp.spawnSync(process.execPath,[req.resolve('vue-tsc/bin/vue-tsc.js'),'--noEmit','--project',config],{cwd:pkg,encoding:'utf8',timeout:60000});
    assert.equal(r.status,0,(r.stdout||'')+(r.stderr||'')+(r.error?.message||''));
  } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});

test('Grok RT, SSO and password adapters persist only OAuth fields',async()=>{
  const f=oauthFixture(async()=>({access_token:'fixture-token',refresh_token:'fixture-rt',expires_at:777,client_id:'grok-client',team_id:'team',subscription_tier:'pro',password:'never',sso_token:'never'}));
  for(const [method,input,url] of [['refresh_token','rt','/admin/grok/oauth/refresh-token'],['sso_cookie','sso','/admin/grok/oauth/sso-token'],['email_password','mail@example.invalid----p----tail','/admin/grok/oauth/password']]) {
    const result=await f.oauth.finishGrokInput(method,input,7);assert.equal(f.calls.at(-1).url,url);assert.equal(result.credentials.password,undefined);assert.equal(result.credentials.sso_token,undefined);assert.equal(result.credentials.expires_at,777);assert.equal(result.extra.subscription_tier,'pro');
  }
  assert.equal(f.calls.at(-1).payload.password,'p----tail');assert.equal(f.calls.at(-1).payload.email,'mail@example.invalid');
});
test('Grok password capability gates the UI and errors clear the password',async()=>{
  const {oauth}=oauthFixture();let posts=0;
  const f=component(prefix+'OAuthAuthorization.vue',{...oauth,grokPasswordCapability:async()=>false,finishGrokInput:async()=>{posts++;throw {message:'failed'};}},{options:{platform:'grok',type:'oauth'}});
  await f.s.loadCapability();f.s.method.value='email_password';f.s.email.value='a';f.s.password.value='secret';await f.s.authorizeInput();assert.equal(posts,0);
  f.s.passwordEnabled.value=true;await f.s.authorizeInput();assert.equal(posts,1);assert.equal(f.s.password.value,'');f.dispose();
});
function batchFixture(handler) {
  const f=modules(handler);return {...f,api:f.load(prefix+'batchAuthorization.ts')};
}
const batchSettings={name:'Batch',platform:'openai',type:'oauth',proxy_id:7,group_ids:[3],concurrency:4,priority:2,rate_multiplier:0,credential_extras:{model_mapping:{alias:'target'}},extra:{base_rpm:15}};
for(const method of ['refresh_token','mobile_refresh_token'])test(`${method}: batch exact client contract and shared settings`,async()=>{
  const f=batchFixture(async(m,url)=>url.endsWith('/refresh-token')?{access_token:'new',refresh_token:'rotated',email:'fixture@example.invalid'}:{id:8});
  const b=f.api.createBatchAuthorization(method,'rt-one\nrt-two\nrt-one',batchSettings);await b.run();assert.equal(b.snapshot().length,2);assert.ok(b.snapshot().every(r=>r.status==='created'));
  const exchange=f.calls.filter(c=>c.url.endsWith('/refresh-token'));assert.equal(exchange.length,2);assert.equal(exchange[0].payload.client_id,method==='mobile_refresh_token'?f.api.MOBILE_CLIENT_ID:undefined);
  const writes=f.calls.filter(c=>c.url==='/admin/accounts');assert.equal(writes[0].payload.name,'Batch #1');assert.equal(writes[1].payload.name,'Batch #2');assert.deepEqual(writes[0].payload.group_ids,[3]);assert.equal(writes[0].payload.credentials.access_token,'new');assert.deepEqual(writes[0].payload.credentials.model_mapping,{alias:'target'});
  await b.run();assert.equal(f.calls.length,4);assert.ok(!JSON.stringify(b.snapshot()).includes('rt-one'));b.dispose();
});
for(const type of ['oauth','setup-token'])test(`Anthropic ${type} Cookie batch exchanges without persisting cookies`,async()=>{
  const f=batchFixture(async(m,url)=>url.endsWith('cookie-auth')?{access_token:'new',cookie:'raw',sessionKey:'raw',session_id:'raw',account_uuid:'uuid'}:{id:8});
  const b=f.api.createBatchAuthorization('cookie','fixture-cookie',{...batchSettings,platform:'anthropic',type});await b.run();
  assert.equal(f.calls[0].url,type==='oauth'?'/admin/accounts/cookie-auth':'/admin/accounts/setup-token-cookie-auth');assert.deepEqual(f.calls[0].payload,{session_id:'',code:'fixture-cookie',proxy_id:7});
  const saved=f.calls[1].payload;assert.equal(saved.credentials.cookie,undefined);assert.equal(saved.credentials.sessionKey,undefined);assert.equal(saved.credentials.session_id,undefined);assert.equal(saved.extra.account_uuid,'uuid');assert.equal(saved.type,type);b.dispose();
});
test('batch double-submit, retry only failed save without re-exchange or duplicate success',async()=>{
  const d=deferred();let creates=0;
  const f=batchFixture(async(m,url)=>{if(url.endsWith('refresh-token'))return {access_token:'new'};creates++;if(creates===1)return d.promise;if(creates===2)throw {status:422,message:'sensitive echo'};return {id:9};});
  const b=f.api.createBatchAuthorization('refresh_token','a\nb',batchSettings);const first=b.run();await b.run();await new Promise(r=>setImmediate(r));assert.equal(creates,1);d.resolve({id:8});await first;
  assert.deepEqual(plain(b.snapshot().map(r=>r.status)),['created','save_failed']);assert.ok(!JSON.stringify(b.snapshot()).includes('sensitive'));await b.run();assert.equal(f.calls.filter(c=>c.url.endsWith('refresh-token')).length,2);assert.equal(creates,3);assert.ok(b.snapshot().every(r=>r.status==='created'));b.dispose();
});
test('unknown write outcomes are never replayed, but independent entries continue',async()=>{
  let creates=0;const f=batchFixture(async(m,url)=>{if(url.endsWith('refresh-token'))return {access_token:'x'};if(++creates===1)throw {status:503};return {id:9};});
  const b=f.api.createBatchAuthorization('refresh_token','a\nb',batchSettings);await b.run();assert.deepEqual(plain(b.snapshot().map(r=>r.status)),['unknown','created']);await b.run();assert.equal(creates,2);b.dispose();
});
test('unmount during exchange prevents later account writes and further rows',async()=>{
  const d=deferred();const f=batchFixture(async()=>d.promise);const b=f.api.createBatchAuthorization('refresh_token','a\nb',batchSettings);const p=b.run();b.dispose();d.resolve({access_token:'x'});await p;await b.run();assert.equal(f.calls.length,1);
});
test('JSON, JSONL and Agent Identity validation happen before network requests',()=>{
  const {api}=batchFixture(async()=>{throw new Error('network');});
  assert.deepEqual(plain(api.parseBatch('codex_session','[{"tokens":{"access_token":"a"}},{"tokens":{"access_token":"b"}}]')).length,2);
  assert.equal(api.parseBatch('agent_identity','{"auth_mode":"agentidentity"}\n{"agentIdentity":{}}').length,2);
  for(const bad of ['[]','not-json','{"tokens":{}}'])assert.throws(()=>api.parseBatch('agent_identity',bad));
  assert.throws(()=>api.createBatchAuthorization('cookie','raw',batchSettings));
});
test('Codex Session and Agent Identity use import endpoint and exact safe extras',async()=>{
  for(const method of ['codex_session','agent_identity']) {
    let n=0;const f=batchFixture(async()=>({total:1,created:++n===1?1:0,updated:n===2?1:0,skipped:0,failed:0,items:[{index:1,account_id:n,action:n===1?'created':'updated'}]}));
    const content=method==='agent_identity'?'[{"auth_mode":"agentidentity"},{"agent_identity":{}}]':'[{"tokens":{"access_token":"one"}},{"tokens":{"access_token":"two"}}]';
    const b=f.api.createBatchAuthorization(method,content,{...batchSettings,update_existing:false,credential_extras:{model_mapping:{a:'b'},access_token:'never-copy',refresh_token:'never-copy'}});await b.run();
    assert.deepEqual(plain(b.snapshot().map(r=>r.status)),['created','updated']);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.url==='/admin/accounts/import/codex-session'));assert.equal(f.calls[0].payload.update_existing,false);assert.equal(f.calls[0].payload.platform,undefined);assert.equal(f.calls[0].payload.credentials,undefined);assert.deepEqual(f.calls[0].payload.credential_extras,{model_mapping:{a:'b'}});await b.run();assert.equal(f.calls.length,2);b.dispose();
  }
});
test('Codex import partial failures retry only failed input, skipped never retries',async()=>{
  let n=0;const f=batchFixture(async()=>{n++;return {total:1,created:n===4?1:0,updated:n===1?1:0,skipped:n===3?1:0,failed:n===2?1:0,errors:[{message:'secret input must not echo'}]};});
  const b=f.api.createBatchAuthorization('codex_session','[{"x":1},{"x":2},{"x":3}]',batchSettings);await b.run();assert.deepEqual(plain(b.snapshot().map(r=>r.status)),['updated','save_failed','skipped']);assert.ok(!JSON.stringify(b.snapshot()).includes('secret'));await b.run();assert.equal(n,4);assert.equal(f.calls[3].payload.content,'{"x":2}');b.dispose();
});
test('PAT batch uses only dedicated create endpoint; malformed response stays unknown',async()=>{
  let n=0;const f=batchFixture(async()=>++n===1?{id:1}:{});const b=f.api.createBatchAuthorization('codex_pat','pat-one\npat-two',batchSettings);await b.run();assert.deepEqual(plain(b.snapshot().map(r=>r.status)),['created','unknown']);assert.ok(f.calls.every(c=>c.url==='/admin/openai/create-from-codex-pat'));assert.equal(f.calls[0].payload.access_token,'pat-one');assert.equal(f.calls[0].payload.credentials,undefined);await b.run();assert.equal(n,2);b.dispose();
});
test('Batch Sheet freezes settings and input after submit and clears secrets on close',async()=>{
  const f=batchFixture(async()=>({id:1}));const ui=component(prefix+'BatchAuthorizationSheet.vue',{...f.api},{settings:{...batchSettings}});ui.s.method.value='codex_pat';await vue.nextTick();ui.s.content.value='fixture-pat';await ui.s.submit();assert.equal(ui.s.content.value,'');assert.equal(ui.s.rows.value[0].status,'created');await ui.s.submit();assert.equal(f.calls.length,1);assert.ok(ui.events.some(e=>e[0]==='saved'));ui.dispose();
});
test('policy mappings roundtrip, wildcard validation, no-op and latest extra preservation',()=>{
  const p=modules(async()=>[]).load(prefix+'policies.ts');const account={platform:'openai',type:'oauth',credentials:{model_mapping:{exact:'exact',alias:'target'},refresh_token:'existing'},extra:{runtime:11}};
  const initial=p.policyForm(account);assert.equal(initial.allowed,'exact');assert.deepEqual(plain(p.applyPolicies(initial,initial,account,true)),{});
  const form=structuredClone(plain(initial));form.mappings.push({from:'gpt-*',to:'target'});const patch=p.applyPolicies(form,initial,account,true);assert.equal(patch.credentials.model_mapping['gpt-*'],'target');assert.equal(patch.credentials.refresh_token,'existing');assert.equal(patch.extra,undefined);
  assert.throws(()=>p.buildMapping('bad*',[]));assert.throws(()=>p.buildMapping('',[{from:'x*y',to:'x'}]));assert.throws(()=>p.buildMapping('',[{from:'x',to:'y*'}]));
  assert.throws(()=>p.applyPolicies(form,initial,{...account,extra:{openai_passthrough:true}},true));
});
test('quota disable/reset and RPM/UMQ match official keys without clearing untouched runtime',()=>{
  const p=modules(async()=>[]).load(prefix+'policies.ts');const account={platform:'anthropic',type:'apikey',extra:{quota_daily_limit:5,quota_daily_used:4,quota_daily_start:'old',quota_weekly_used:8,other:'preserve'}};const initial=p.policyForm(account),form=structuredClone(plain(initial));form.quota_daily_limit='';form.quota_weekly_reset_mode='fixed';form.quota_weekly_reset_day=0;form.quota_weekly_reset_hour=0;form.quota_reset_timezone='UTC';
  const extra=p.applyPolicies(form,initial,account,true).extra;assert.equal(extra.quota_daily_used,undefined);assert.equal(extra.quota_daily_start,undefined);assert.equal(extra.quota_weekly_used,8);assert.equal(extra.quota_weekly_reset_day,0);assert.equal(extra.other,'preserve');
  const base=p.policyForm(),rpm=structuredClone(plain(base));rpm.rpmEnabled=true;rpm.user_msg_queue_mode='serialize';rpm.sessionsEnabled=true;rpm.max_sessions=3;rpm.windowEnabled=true;rpm.window_cost_limit=20;
  const result=p.applyPolicies(rpm,base,{platform:'anthropic',type:'oauth',extra:{other:1}},true).extra;assert.equal(result.base_rpm,15);assert.equal(result.rpm_strategy,'tiered');assert.equal(result.user_msg_queue_mode,'serialize');assert.equal(result.max_sessions,3);assert.equal(result.window_cost_sticky_reserve,10);assert.equal(result.other,1);
  rpm.base_rpm=-1;assert.throws(()=>p.applyPolicies(rpm,base,{platform:'anthropic',type:'oauth'},true));
});

test('AccountsApp batch entry validates, snapshots policies and excludes existing OAuth tokens',async()=>{
  const m=modules(async()=>[]),advanced=m.load(prefix+'advanced.ts'),policies=m.load(prefix+'policies.ts'),{oauth}=oauthFixture();
  const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,accountsAPI:{},groupsAPI:{},getAppIcon:()=>''});
  f.s.openAddSheet();f.s.accountForm.value.platform='openai';f.s.accountForm.value.type='oauth';await vue.nextTick();f.s.openBatchAuthorization();assert.equal(f.s.batchAuthorization.value,null);
  f.s.accountForm.value.name='Group';f.s.accountForm.value.groups=[5];f.s.policies.value.mappings=[{from:'alias',to:'target'}];f.s.oauthResult.value={credentials:{access_token:'never-copy'}};f.s.openBatchAuthorization();
  const settings=plain(f.s.batchAuthorization.value);assert.equal(settings.credentials,undefined);assert.deepEqual(settings.credential_extras,{model_mapping:{alias:'target'}});assert.deepEqual(settings.group_ids,[5]);f.s.accountForm.value.name='changed';assert.equal(settings.name,'Group');assert.ok(!JSON.stringify(settings).includes('never-copy'));f.dispose();
});
test('AccountsApp credential replacement plus policy changes keeps the new key',async()=>{
  const m=modules(async()=>[]),advanced=m.load(prefix+'advanced.ts'),policies=m.load(prefix+'policies.ts'),{oauth}=oauthFixture();const writes=[];
  const account={id:9,name:'fixture',platform:'openai',type:'apikey',concurrency:1,priority:0,credentials:{api_key:'old',model_mapping:{a:'a'}},extra:{runtime:42}};
  const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,accountsAPI:{getById:async()=>account,update:async(id,p)=>writes.push(plain(p)),list:async()=>({items:[],total:0,page_size:20})},groupsAPI:{},getAppIcon:()=>''});
  f.s.openEditSheet(account);await vue.nextTick();await new Promise(r=>setImmediate(r));f.s.replaceCredentials.value=true;f.s.accountForm.value.credentials='new';f.s.policies.value.mappings.push({from:'alias',to:'target'});await f.s.handleSaveAccount();
  assert.equal(writes.length,1);assert.equal(writes[0].credentials.api_key,'new');assert.equal(writes[0].credentials.model_mapping.alias,'target');assert.equal(writes[0].extra,undefined);f.dispose();
});

test('review: policy-only account edit never overwrites concurrently changed basic fields',async()=>{
 const m=modules(async()=>[]),advanced=m.load(prefix+'advanced.ts'),policies=m.load(prefix+'policies.ts'),{oauth}=oauthFixture();
 const original={id:9,name:'old',platform:'openai',type:'apikey',concurrency:5,priority:1,group_ids:[1],credentials:{api_key:'fixture'},extra:{}};
 let reads=0;const writes=[];
 const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,accountsAPI:{getById:async()=>++reads===1?original:{...original,name:'concurrent',concurrency:20,group_ids:[2]},update:async(id,p)=>writes.push({id,p:plain(p)}),list:async()=>({items:[],total:0,page_size:20})},groupsAPI:{},getAppIcon:()=>''});
 f.s.openEditSheet(original);await vue.nextTick();await new Promise(r=>setImmediate(r));f.s.policies.value.mappings.push({from:'alias',to:'target'});
 await f.s.handleSaveAccount();assert.equal(writes.length,1);assert.equal(writes[0].id,9);
 for(const key of ['name','concurrency','priority','group_ids'])assert.equal(Object.hasOwn(writes[0].p,key),false,key);
 assert.equal(writes[0].p.credentials.model_mapping.alias,'target');f.dispose();
});
test('review: account detail read completing after unmount cannot issue a write',async()=>{
 const m=modules(async()=>[]),advanced=m.load(prefix+'advanced.ts'),policies=m.load(prefix+'policies.ts'),{oauth}=oauthFixture();
 const original={id:9,name:'old',platform:'openai',type:'apikey',concurrency:5,priority:1,group_ids:[],credentials:{},extra:{}};
 const late=deferred();let reads=0,writes=0;
 const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,accountsAPI:{getById:()=>++reads===1?Promise.resolve(original):late.promise,update:async()=>writes++,list:async()=>({items:[],total:0,page_size:20})},groupsAPI:{},getAppIcon:()=>''});
 f.s.openEditSheet(original);await vue.nextTick();await new Promise(r=>setImmediate(r));f.s.accountForm.value.name='new';
 const pending=f.s.handleSaveAccount();f.dispose();late.resolve(original);await pending;assert.equal(writes,0);
});
test('CN edit switching adaptive to fixed protocol does not restore removed endpoints',async()=>{
 const m=modules(async()=>[]),advanced=m.load(prefix+'advanced.ts'),policies=m.load(prefix+'policies.ts'),cn=m.load(prefix+'cn-provider.ts'),{oauth}=oauthFixture();const writes=[];
 const account={id:9,name:'fixture',platform:'minimax',type:'apikey',concurrency:1,priority:0,group_ids:[],credentials:{api_key:'old',api_protocol:'adaptive',account_mode:'payg',base_url:'https://api.minimax.io/v1',api_base_urls:{chat_completions:'https://api.minimax.io/v1'},future:'preserved'},extra:{}};
 const f=component('apps/admin/AccountsApp.vue',{...advanced,...oauth,...policies,...cn,accountsAPI:{getById:async()=>account,update:async(id,p)=>writes.push(plain(p)),list:async()=>({items:[],total:0,page_size:20})},groupsAPI:{},getAppIcon:()=>''});
 f.s.openEditSheet(account);await vue.nextTick();await new Promise(r=>setImmediate(r));f.s.replaceCredentials.value=true;f.s.cnProvider.value=cn.changeCNProtocol(f.s.cnProvider.value,'chat_completions');f.s.cnProvider.value.api_key='new';await f.s.handleSaveAccount();
 assert.equal(writes.length,1);assert.equal(writes[0].credentials.api_key,'new');assert.equal(writes[0].credentials.api_base_urls,undefined);assert.equal(writes[0].credentials.future,'preserved');f.dispose();
});
