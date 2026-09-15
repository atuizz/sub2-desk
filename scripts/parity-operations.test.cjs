// Isolated source execution: no HTTP, backend, account/config writes or global build.
// node --test scripts/parity-operations.test.cjs
// node scripts/parity-operations.test.cjs --typecheck  (only owned entry points)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'packages/sub2-console');
const local = createRequire(path.join(pkg, 'package.json'));
const ts = local('typescript'), vue = local('vue');
const { parse, compileScript, compileTemplate } = local('vue/compiler-sfc');
const files = ['OpsApp.vue', 'PluginsApp.vue', 'SecurityApp.vue', 'operations/OperationsPanel.vue',
  'operations/RecordDetails.vue', 'operations/RiskPolicySheet.vue', 'operations/PromptPolicySheet.vue', 'operations/CapacityPanel.vue', 'operations/AdvancedSettingsSheet.vue', 'operations/HashCacheSheet.vue', 'operations/TrafficAnalysis.vue', 'operations/RiskKeysSheet.vue', 'operations/AlertSettingsSheet.vue', 'operations/LogMaintenanceSheet.vue', 'plugins/PluginConfiguration.vue'];
const full = file => path.join(pkg, 'src/apps/admin', file);
const plain = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const adminError = (err, fallback) => err?.message || fallback;
const platformModule = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(full('operations/platforms.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{module:platformModule,exports:platformModule.exports});

if (process.argv.includes('--typecheck')) {
  const filename = path.join(os.tmpdir(), `sub2-parity-operations-${process.pid}.json`);
  try {
    fs.writeFileSync(filename, JSON.stringify({ extends: path.join(pkg, 'tsconfig.json'),
      include: [...files.map(full), path.join(pkg, 'src/apps/user/BatchImageApp.vue'), path.join(pkg, 'src/**/*.d.ts')], exclude: [],
      compilerOptions: { incremental: false, composite: false, types: [path.join(path.dirname(local.resolve('vite/package.json')), 'client.d.ts')] } }));
    const result = spawnSync(process.execPath, [local.resolve('vue-tsc/bin/vue-tsc.js'), '--noEmit', '-p', filename], { encoding: 'utf8', cwd: pkg });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    process.exitCode = result.status ?? 1;
  } finally { if (fs.existsSync(filename)) fs.unlinkSync(filename); }
} else {
function fixture(file, overrides = {}) {
  let source = parse(fs.readFileSync(full(file), 'utf8')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n)
    ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text)
    : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0,n.pos) + source.slice(n.end);
  const mounted = [], unmounted = [], emitted = [], timers = new Map(); let timerID = 0;
  const context = { ...vue, ...platformModule.exports, Date, URL, Error, console, crypto: { randomUUID: () => 'fixture-node' },
    defineProps: () => ({}), defineEmits: () => (...args) => emitted.push(args),
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), watch: () => () => {},
    setTimeout: fn => { timers.set(++timerID, fn); return timerID; }, clearTimeout: id => timers.delete(id),
    setInterval: () => ++timerID, clearInterval: () => {},
    adminError, fetch: () => { throw new Error('Network forbidden'); },
    document: {hidden:false,addEventListener(){},removeEventListener(){}}, window: { addEventListener() {}, removeEventListener() {} }, location: { href: 'https://console.test/' }, ...overrides };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = {${names.join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None }
  }).outputText, context);
  return { s: context.subject, mounted, unmounted, emitted, context, timers };
}
test('R07 risk config can save when unrelated logs fail, but not after config failure', async () => {
  let configFails=false, writes=0;
  const api={getConfig:async()=>{if(configFails)throw Error('offline');return {enabled:true,mode:'observe',base_url:'https://moderation.invalid',model:'fixture',worker_count:4,queue_size:10,timeout_ms:1000};},getStatus:async()=>({}),listLogs:async()=>{throw Error('log offline')},updateConfig:async()=>{writes++;}};
  const {s}=fixture('SecurityApp.vue',{riskControlAPI:api});
  await s.loadRiskData();assert(s.riskError.value);assert.equal(s.riskConfigReady.value,true);
  s.editRiskForm.mode='pre_block';await s.handleSaveRiskConfig();assert.equal(writes,1);
  await tick();configFails=true;await s.loadRiskData();await s.handleSaveRiskConfig();assert.equal(writes,1);assert.equal(s.riskConfigReady.value,false);
});
test('R07 every official platform and group filter reaches overview, request and event queries',async()=>{
  const {opsPlatforms,optionalGroupId}=platformModule.exports;assert.equal(opsPlatforms.length,9);
  assert.equal(optionalGroupId(31),31);
  for(const bad of ['0','-1','1.5','NaN'])assert.throws(()=>optionalGroupId(bad));
  let seen;const o=fixture('OpsApp.vue',{opsAPI:{getDashboardOverview:async p=>{seen=p;return {}}}}).s;
  o.platform.value='grok';o.groupId.value='31';await o.loadDashboard();assert.equal(seen.platform,'grok');assert.equal(seen.group_id,31);
  const props={tab:'requests'};const p=fixture('operations/OperationsPanel.vue',{defineProps:()=>props,opsAPI:{listRequestDetails:async p=>{seen=p;return {items:[],total:0}},listAlertEvents:async p=>{seen=p;return []}}}).s;
  p.platform.value='minimax';p.groupId.value='42';await p.load();assert.equal(seen.platform,'minimax');assert.equal(seen.group_id,42);
  props.tab='events';await p.load();assert.equal(seen.group_id,42);
});
for (const file of files) test(`Vue SFC and template compile: ${file}`, () => {
  const filename = full(file); const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []); const script = compileScript(descriptor, { id: file });
  const result = compileTemplate({ source: descriptor.template.content, filename, id: file,
    compilerOptions: { bindingMetadata: script.bindings } }); assert.deepEqual(result.errors, []);
});

test('Ops split endpoints, filters, pagination and failed refresh preserve rows', async () => {
  const calls = []; let fail = false;
  const props = { tab: 'upstream' };
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => props,
    opsAPI: { listUpstreamErrors: async q => { calls.push(plain(q)); if(fail) throw Error('fixture 503'); return { items: [{ id: 5 }], total: 51 }; } } });
  s.page.value = 2; s.query.value = 'timeout'; s.status.value = 'false'; s.platform.value = 'openai';
  await s.load(); assert.equal(calls[0].page, 2); assert.equal(calls[0].resolved, 'false'); assert.equal(calls[0].q, 'timeout'); assert.equal(calls[0].platform, 'openai');
  fail = true; await s.load(); assert.equal(s.rows.value[0].id, 5); assert.match(s.error.value, /503/);
});
test('Ops late response and unmount cannot replace latest tab data', async () => {
  const first = defer(), second = defer(); let count = 0;
  const { s, unmounted } = fixture('operations/OperationsPanel.vue', { defineProps: () => ({ tab: 'logs' }),
    opsAPI: { listSystemLogs: () => (++count === 1 ? first.promise : second.promise) } });
  const a = s.load(), b = s.load(); second.resolve({ items: [{ id: 2 }], total: 1 }); await b;
  first.resolve({ items: [{ id: 1 }], total: 1 }); await a; assert.equal(s.rows.value[0].id, 2);
  unmounted.forEach(fn => fn()); assert.equal(s.loading.value, false);
});
test('Ops request and system-log endpoints carry their own filters', async () => {
  const calls = []; const props = { tab: 'requests' };
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => props, opsAPI: {
    listRequestDetails: async p => { calls.push(['requests', plain(p)]); return { items: [], total: 0 }; },
    listSystemLogs: async p => { calls.push(['logs', plain(p)]); return { items: [], total: 0 }; }
  } });
  s.kind.value = 'error'; await s.load(); props.tab = 'logs'; s.level.value = 'warn'; await s.load();
  assert.equal(calls[0][1].kind, 'error'); assert.equal(calls[1][1].level, 'warn');
});
test('Ops alert event pagination uses timestamp and id cursor, not offsets', async () => {
  const queries = [];
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => ({ tab: 'events' }), opsAPI: {
    listAlertEvents: async q => { queries.push(plain(q)); return Array.from({ length: 26 }, (_, i) => ({ id: 100-i, fired_at: `time-${i}` })); }
  } });
  await s.load(); assert.equal(s.events.value.length,25); assert.equal(s.hasMoreEvents.value,true);
  s.next(); await tick(); assert.equal(queries[1].before_id,76); assert.equal(queries[1].before_fired_at,'time-24');
  s.search(); await tick(); assert.equal(queries[2].before_id, undefined);
});
test('Ops detail retries, closes safely and resolves the right upstream record', async () => {
  let fail = true; const actions = [];
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => ({ tab: 'upstream' }), opsAPI: {
    getUpstreamErrorDetail: async id => { if(fail) throw Error('detail failed'); return { id, resolved: false, error_body: 'actual detail' }; },
    updateUpstreamErrorResolved: async (...args) => actions.push(args), listUpstreamErrors: async () => ({items:[],total:0})
  } });
  s.showRow({id:7}); await tick(); assert.match(s.detailError.value,/failed/); fail=false;
  await s.readDetail(); assert.equal(s.detail.value.error_body,'actual detail'); s.resolveError(); await s.execute();
  assert.deepEqual(actions,[[7,true]]); assert.equal(s.detailOpen.value,false);
});
test('Ops rule create/edit preserve filters, omit server fields, reject invalid forms and prevent duplicate save', async () => {
  const calls = [], pending = defer();
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => ({tab:'rules'}), opsAPI: {
    createAlertRule: async p => calls.push(['create',plain(p)]), updateAlertRule: async (id,p) => { calls.push([id,plain(p)]); await pending.promise; }, listAlertRules: async () => []
  } });
  s.edit(); await s.saveRule(); assert.equal(calls.length,0); s.draft.value.name = 'Errors'; await s.saveRule(); assert.equal(calls[0][0],'create');
  s.edit({...calls[0][1],id:9,created_at:'server',filters:{platform:'openai',group_id:2}}); const a=s.saveRule(); const b=s.saveRule();
  assert.equal(calls.length,2); assert.deepEqual(calls[1][1].filters,{platform:'openai',group_id:2}); assert.equal(calls[1][1].created_at,undefined);
  pending.resolve(); await Promise.all([a,b]);
});
test('Ops partial traffic failures retain successful concurrency data', async () => {
  const { s } = fixture('operations/OperationsPanel.vue', { defineProps: () => ({tab:'traffic'}), opsAPI: {
    getThroughputTrend: async () => { throw Error('trend'); }, getConcurrencyStats: async () => ({enabled:true,platform:{},group:{},account:{}})
  } }); await s.load(); assert.equal(s.concurrency.value.enabled,true); assert.ok(s.error.value);
});
test('Ops invalid 200/fallback responses are errors, never empty success', async () => {
  const props = {tab:'logs'};
  const {s}=fixture('operations/OperationsPanel.vue',{defineProps:()=>props,opsAPI:{listSystemLogs:async()=>'<html>SPA</html>',listAlertRules:async()=>({})}});
  await s.load();assert.match(s.error.value,/响应无效/);props.tab='rules';await s.load();assert.match(s.error.value,/响应无效/);
});
test('Ops group metric refuses save without a valid group and retains unknown filter dimensions',async()=>{
  const calls=[];const {s}=fixture('operations/OperationsPanel.vue',{defineProps:()=>({tab:'rules'}),opsAPI:{createAlertRule:async p=>calls.push(plain(p)),listAlertRules:async()=>[]}});
  s.edit();s.draft.value.name='Group capacity';s.draft.value.metric_type='group_available_accounts';await s.saveRule();assert.equal(calls.length,0);
  s.ruleGroup.value='8';s.filtersText.value='{"region":"zone-a"}';await s.saveRule();assert.deepEqual(calls[0].filters,{region:'zone-a',group_id:8});
});
test('Ops request links read full upstream attempts with pagination and fence close',async()=>{
  const d=defer(),calls=[];const {s}=fixture('operations/OperationsPanel.vue',{defineProps:()=>({tab:'errors'}),opsAPI:{listRequestErrorUpstreamErrors:(...args)=>{calls.push(plain(args));return d.promise;}}});
  s.detailSource.value={id:32,tab:'errors'};s.linkedPage.value=2;const run=s.loadLinked();assert.deepEqual(calls[0],[32,{page:2,page_size:25},{include_detail:true}]);
  s.closeDetail();d.resolve({items:[{id:44}],total:30});await run;assert.equal(s.linked.value.length,0);assert.equal(s.linkedTotal.value,null);
});
test('Ops silence uses explicit dimensions and absolute expiration, rejects invalid group',async()=>{
  const calls=[];const {s}=fixture('operations/OperationsPanel.vue',{defineProps:()=>({tab:'events'}),opsAPI:{createAlertSilence:async p=>calls.push(plain(p))}});
  s.openSilence({rule_id:7,dimensions:{platform:'openai',group_id:8,region:'west'}});s.silence.value.group='-1';await s.saveSilence();assert.equal(calls.length,0);
  s.silence.value.group='8';s.silence.value.minutes=30;const before=Date.now();await s.saveSilence();assert.equal(calls[0].rule_id,7);assert.equal(calls[0].group_id,8);assert.equal(calls[0].region,'west');
  assert.ok(Date.parse(calls[0].until)>=before+30*60000);assert.equal(s.silence.value,null);
});

function bridgeFixture(overrides={}) {
  const exports = {}, timers = new Map(); let timer=0;
  const context = { exports, URL, Date, Error, setTimeout: fn => {timers.set(++timer,fn);return timer;}, clearTimeout: id=>timers.delete(id) };
  vm.createContext(context); vm.runInContext(ts.transpileModule(fs.readFileSync(full('plugins/bridge.ts'),'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}
  }).outputText,context);
  const sent=[],calls=[]; const target={postMessage: (...a)=>sent.push(a)};
  const session={url:'/api/v1/admin/plugins/1/ui',bridge_token:'fixture-secret',ui_bridge_version:1,expires_at:new Date(Date.now()+60000).toISOString()};
  const b=exports.createPluginBridge({session,frame:()=>target,load:async()=>{calls.push('load');return {saved:true};},
    save:async config=>{calls.push(['save',config]);return config;},test:async()=>({success:true,message:'ok',latency_ms:1}),resize:()=>{},notify:()=>{},...overrides});
  const event=(changes={})=>({source:target,origin:'null',data:{source:'sub2api-plugin-ui',bridge_token:session.bridge_token,request_id:'r1',type:'config.load'},...changes});
  return {b,event,session,calls,sent,target,timers,exports};
}
test('Plugin bridge rejects forged origins, source, token, unknown types and missing IDs',async()=>{
  const f=bridgeFixture();
  await f.b.handle(f.event({origin:'https://console.test'})); await f.b.handle(f.event({source:{}}));
  await f.b.handle(f.event({data:{...f.event().data,bridge_token:'bad'}}));
  await f.b.handle(f.event({data:{...f.event().data,type:'admin.delete'}}));
  await f.b.handle(f.event({data:{...f.event().data,request_id:''}}));
  assert.equal(f.calls.length,0); await f.b.handle(f.event()); assert.equal(f.calls.length,1);
  assert.equal(f.sent[0][0].type,'config.load.result'); assert.equal(f.sent[0][0].request_id,'r1'); assert.equal(f.sent[0][0].ok,true); f.b.dispose();
});
test('Plugin bridge duplicate IDs, navigation, reused ID and close discard stale responses',async()=>{
  const old=defer(),newer=defer();let n=0;
  const f=bridgeFixture({load:()=>++n===1?old.promise:newer.promise});
  const a=f.b.handle(f.event()); await f.b.handle(f.event());assert.equal(n,1);
  f.b.invalidate(); const b=f.b.handle(f.event());old.resolve({secret:'old'});await a;assert.equal(f.sent.length,0);
  newer.resolve({fresh:true});await b;assert.equal(f.sent.length,1);assert.equal(f.sent[0][0].config.fresh,true);
  f.b.dispose();await f.b.handle(f.event());assert.equal(n,2);
});
test('Plugin bridge times out and rejects expired sessions or nonobject config',async()=>{
  const d=defer(); const f=bridgeFixture({load:()=>d.promise}); const run=f.b.handle(f.event());
  for(const fn of f.timers.values())fn();d.resolve({late:true});await run;assert.equal(f.sent.length,0);
  await f.b.handle(f.event({data:{...f.event().data,type:'config.save',config:[]}})); assert.equal(f.sent[0][0].ok,false);
  f.session.expires_at='2000-01-01T00:00:00Z';await f.b.handle(f.event());assert.equal(f.calls.length,0);f.b.dispose();
});
test('Plugin session validation rejects external origin, credentials, expired dates and unknown bridge',()=>{
  const f=bridgeFixture();assert.ok(f.exports.validatePluginSession(f.session,'https://console.test/').url.startsWith('https://console.test/'));
  for(const patch of [{url:'https://evil.test/'},{url:'https://user:pass@console.test/'},{url:'javascript:alert(1)'},{expires_at:'invalid'},{ui_bridge_version:2}])
    assert.throws(()=>f.exports.validatePluginSession({...f.session,...patch},'https://console.test/'));
  f.b.dispose();
});
test('Plugin UI session late load cannot reopen a closed sheet',async()=>{
  const d=defer(); const {s,emitted}=fixture('plugins/PluginConfiguration.vue',{ defineProps:()=>({plugin:{id:5}}),
    pluginsAPI:{createUISession:()=>d.promise},validatePluginSession:()=>{throw Error('must not validate stale');},createPluginBridge:()=>{throw Error('must not bridge stale');} });
  const run=s.open();s.close();d.resolve({});await run;assert.equal(s.session.value,null);assert.deepEqual(emitted,[['close']]);
});
test('Plugin host cancels writes and completes official step-up before retry',async()=>{
  let writes=0,verified=0;
  const {s}=fixture('plugins/PluginConfiguration.vue',{totpAPI:{stepUp:async()=>{verified++;return {verified:true};}}});
  s.session.value={expires_at:new Date(Date.now()+60000).toISOString()};
  let run=s.sensitive('save',async()=>{writes++;});s.settle(false);await assert.rejects(run,/取消/);assert.equal(writes,0);
  run=s.sensitive('save',async()=>{writes++;if(writes===1)throw {code:'STEP_UP_REQUIRED'};return 'ok';});
  await s.confirm();await tick();assert.equal(s.needCode.value,true);s.code.value='123456';await s.confirm();assert.equal(await run,'ok');assert.equal(verified,1);assert.equal(writes,2);
});
test('Plugin host navigation while confirming prevents config mutation',async()=>{
  let writes=0; const {s}=fixture('plugins/PluginConfiguration.vue');s.session.value={expires_at:new Date(Date.now()+60000).toISOString()};
  s.onLoad();const run=s.sensitive('save',async()=>{writes++;});s.onLoad();await assert.rejects(run,/取消/);assert.equal(writes,0);
});
test('Plugin first frame load preserves initial request; expired approval never writes',async()=>{
  let writes=0;const {s}=fixture('plugins/PluginConfiguration.vue');s.session.value={expires_at:new Date(Date.now()+60000).toISOString()};
  const first=s.sensitive('save',async()=>writes++);s.onLoad();await s.confirm();await first;assert.equal(writes,1);
  let active=true;const expired=s.sensitive('save',async()=>writes++,()=>active);active=false;await s.confirm();await assert.rejects(expired,/失效/);assert.equal(writes,1);
});
test('Plugin bridge expiry guard is passed into pending writes',async()=>{
  let valid;const d=defer();const f=bridgeFixture({save:async(config,active)=>{valid=active;await d.promise;return config;}});
  const p=f.b.handle(f.event({data:{...f.event().data,type:'config.save',config:{x:1}}}));assert.equal(valid(),true);
  for(const callback of f.timers.values())callback();assert.equal(valid(),false);d.resolve();await p;assert.equal(f.sent.length,0);f.b.dispose();
});

const riskConfig = () => ({sample_rate:0.5,all_groups:false,group_ids:[2],thresholds:{violence:0.5},block_status:403,
  block_message:'blocked',record_non_hits:true,email_on_hit:false,auto_ban_enabled:false,ban_threshold:10,violation_window_hours:24,
  hit_retention_days:180,non_hit_retention_days:3,pre_hash_check_enabled:true,blocked_keywords:['bad'],keyword_blocking_mode:'keyword_only',
  model_filter:{type:'include',models:['gpt-test']},cyber_policy_exclude_from_ban_count:false,api_key_masked:'never-save-this'});
test('Risk policy preserves selected scope, rejects invalid input and sends only editable policy',async()=>{
  const calls=[]; const {s,emitted}=fixture('operations/RiskPolicySheet.vue',{riskControlAPI:{getConfig:async()=>riskConfig(),updateConfig:async p=>calls.push(plain(p))}});
  await s.load();s.groups.value='2,3,3';s.keywords.value='alpha\nalpha\nbeta';await s.save();
  assert.deepEqual(calls[0].group_ids,[2,3]);assert.deepEqual(calls[0].blocked_keywords,['alpha','beta']);assert.equal(calls[0].api_key_masked,undefined);assert.equal(calls[0].model_filter.type,'include');assert.ok(emitted.some(e=>e[0]==='saved'));
  s.groups.value='-2';await s.save();assert.equal(calls.length,1);assert.ok(s.error.value);
  s.groups.value='2';s.config.value.non_hit_retention_days=4;await s.save();assert.equal(calls.length,1);
});
test('Risk failed initial read cannot save defaults; close fences stale load',async()=>{
  let writes=0;const {s}=fixture('operations/RiskPolicySheet.vue',{riskControlAPI:{getConfig:async()=>{throw Error('offline');},updateConfig:async()=>writes++}});
  await s.load();await s.save();assert.equal(writes,0);assert.equal(s.config.value,null);
});
const promptConfig = () => ({enabled:true,blocking_enabled:false,blocking_latest_turn_only:true,store_pass_events:false,worker_count:2,queue_capacity:128,
  all_groups:true,group_ids:[],scanners:['violent'],config_version:7,endpoints:[{id:'a',name:'Node A',base_url:'https://audit.test/v1',model:'guard',timeout_ms:3000,input_limit:8000,enabled:true,protocol:'openai_compatible',has_token:true,token_status:'configured'}]});
test('Prompt policy preserves blank secrets and expected version; failures keep draft for recovery',async()=>{
  const calls=[];const {s}=fixture('operations/PromptPolicySheet.vue',{promptAuditAPI:{getConfig:async()=>promptConfig(),updateConfig:async p=>{calls.push(plain(p));throw Error('version conflict');}}});
  await s.load();s.endpoints.value[0].name='Updated';await s.save();assert.equal(calls[0].expected_config_version,7);assert.equal(calls[0].endpoints[0].token,undefined);
  assert.equal(calls[0].endpoints[0].clear_token,false);assert.match(s.error.value,/conflict/);assert.equal(s.endpoints.value[0].name,'Updated');
  s.endpoints.value[0].token='new';s.endpoints.value[0].clear_token=true;await s.save();assert.equal(calls.length,1);
});
test('Prompt node ordering, test failure and no duplicate test',async()=>{
  const d=defer();let calls=0;const {s}=fixture('operations/PromptPolicySheet.vue',{promptAuditAPI:{getConfig:async()=>promptConfig(),probeEndpoint:async()=>{calls++;return d.promise;}}});
  await s.load();s.add();s.move(1,-1);assert.equal(s.endpoints.value[0].id,'fixture-node');s.move(0,1);
  const a=s.probe(s.endpoints.value[0]),b=s.probe(s.endpoints.value[0]);assert.equal(calls,1);d.resolve({ok:false,message:'denied'});await Promise.all([a,b]);assert.equal(s.error.value,'denied');assert.equal(s.probing.value,null);
});
test('Security audit detail consumes detail endpoint and does not leak late response into closed dialog',async()=>{
  const d=defer();const ids=[];const {s}=fixture('SecurityApp.vue',{auditAPI:{get:id=>{ids.push(id);return d.promise;}}});
  const run=s.viewLogDetail({id:22});s.closeAuditDetail();d.resolve({id:22,request_body:'full'});await run;
  assert.deepEqual(ids,[22]);assert.equal(s.selectedLog.value,null);assert.equal(s.showDetailModal.value,false);
});
test('Security prompt detail fetches full prompt and page deletion sends only captured IDs',async()=>{
  const deleted=[];const {s}=fixture('SecurityApp.vue',{promptAuditAPI:{getEvent:async id=>({id,full_prompt:'full prompt'}),batchDeleteEvents:async ids=>deleted.push(plain(ids)),getConfig:async()=>promptConfig(),listEvents:async()=>({items:[],total:0})}});
  await s.viewPromptDetail({id:9});assert.equal(s.promptDetail.value.full_prompt,'full prompt');s.deletePromptIDs.value=[9,10];await s.deletePromptPage();assert.deepEqual(deleted,[[9,10]]);
});
test('Security moderation filters use official result/page contract',async()=>{
  const calls=[];const {s}=fixture('SecurityApp.vue',{riskControlAPI:{getConfig:async()=>riskConfig(),getStatus:async()=>({}),listLogs:async p=>{calls.push(plain(p));return {items:[],total:0};}}});
  s.riskPage.value=2;s.riskFilters.result='pass';s.riskFilters.group_id='8';s.riskFilters.search='request-123';await s.loadRiskData();
  assert.equal(calls[0].page,2);assert.equal(calls[0].result,'pass');assert.equal(calls[0].group_id,8);assert.equal(calls[0].search,'request-123');
});
test('Security window tab initializes all supported entries and falls back safely',()=>{
  for (const tab of ['audit','risk','prompt',undefined,'invalid']) {
    const {s}=fixture('SecurityApp.vue',{defineProps:()=>({win:{customData:{tab}}})});
    assert.equal(s.activeTab.value,['audit','risk','prompt'].includes(tab)?tab:'audit');
  }
  assert.equal(fixture('SecurityApp.vue').s.activeTab.value,'audit');
});
test('Security actual Vue watch follows nested tab changes, data/window replacement and ignores invalid values',async()=>{
  const props=vue.reactive({win:{customData:{tab:'risk',other:0}}});
  const {s,unmounted}=fixture('SecurityApp.vue',{defineProps:()=>props,watch:vue.watch});
  assert.equal(s.activeTab.value,'risk'); props.win.customData.tab='prompt';await vue.nextTick();assert.equal(s.activeTab.value,'prompt');
  props.win.customData={tab:'audit'};await vue.nextTick();assert.equal(s.activeTab.value,'audit');
  s.activeTab.value='risk';props.win.customData={tab:'audit'};await vue.nextTick();assert.equal(s.activeTab.value,'audit');
  s.activeTab.value='prompt';props.win.customData.other=1;await vue.nextTick();assert.equal(s.activeTab.value,'prompt');
  props.win.customData.tab='invalid';await vue.nextTick();assert.equal(s.activeTab.value,'prompt');
  props.win={customData:{tab:'risk'}};await vue.nextTick();assert.equal(s.activeTab.value,'risk');
  props.win.customData=undefined;await vue.nextTick();assert.equal(s.activeTab.value,'risk');
  unmounted.forEach(fn=>fn());props.win={customData:{tab:'audit'}};await vue.nextTick();assert.equal(s.activeTab.value,'risk');
});
function stepUpFixture(stepUp) {
  const unmounted=[];const context={exports:{},Error,require:id=> {
    if(id==='vue')return {...vue,onUnmounted:fn=>unmounted.push(fn)};
    if(id==='../../../api/totp')return {totpAPI:{stepUp}};
    if(id==='../admin-feedback')return {adminError};
    throw Error('Unexpected module '+id);
  }};
  vm.createContext(context);vm.runInContext(ts.transpileModule(fs.readFileSync(full('plugins/usePluginStepUp.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
  return {s:context.exports.usePluginStepUp(),unmounted};
}
test('Plugin management step-up retries exactly once after verified TOTP and prevents duplicate verify',async()=>{
  const d=defer();let writes=0,checks=0;const {s}=stepUpFixture(async()=>{checks++;return d.promise;});
  const run=s.run(async()=>{if(++writes===1)throw {reason:'STEP_UP_REQUIRED'};return 'saved';});await tick();assert.equal(s.visible.value,true);
  s.code.value='12';await s.verify();assert.equal(checks,0);s.code.value='123456';const a=s.verify(),b=s.verify();assert.equal(checks,1);
  d.resolve({verified:true});await Promise.all([a,b]);assert.equal(await run,'saved');assert.equal(writes,2);assert.equal(s.code.value,'');
});
test('Plugin management cancellation, blocked identity and unmount never retry',async()=>{
  for(const reason of ['cancel','unmount']) {
    const {s,unmounted}=stepUpFixture(async()=>({verified:true}));let writes=0;
    const run=s.run(async()=>{writes++;throw {code:'STEP_UP_REQUIRED'};});await tick();
    if(reason==='cancel')s.cancel();else unmounted.forEach(fn=>fn());await assert.rejects(run,/取消/);assert.equal(writes,1);
  }
  const {s}=stepUpFixture(async()=>({verified:true}));let calls=0;await assert.rejects(s.run(async()=>{calls++;throw {code:'STEP_UP_TOTP_NOT_ENABLED'};}));assert.equal(calls,1);assert.equal(s.visible.value,false);
});
test('Plugin all management mutations route through step-up with original payload',async()=>{
  const actions=[];let wrapped=0;const {s}=fixture('PluginsApp.vue',{usePluginStepUp:()=>({run:async fn=>{wrapped++;return fn();}}),pluginsAPI:{
    list:async()=>[],upload:async f=>actions.push(['upload',f.name]),enable:async(...a)=>actions.push(['enable',...a]),disable:async id=>actions.push(['disable',id]),remove:async id=>actions.push(['remove',id]),test:async id=>{actions.push(['test',id]);return {success:true,latency_ms:2};}
  }});
  await s.handleFileSelected({target:{files:[{name:'test.s2plugin'}]}});
  await s.togglePlugin({id:1,state:'disabled',compatibility:{tested:true}});await s.togglePlugin({id:1,state:'enabled'});await s.testPlugin({id:1,name:'test'});await s.handleUninstall({id:1});
  assert.equal(wrapped,5);assert.deepEqual(actions,[['upload','test.s2plugin'],['enable',1,100,false],['disable',1],['test',1],['remove',1]]);
});
const loggingConfig=()=>({level:'info',persist_access_logs:true,enable_sampling:true,sampling_initial:100,sampling_thereafter:100,caller:false,stacktrace_level:'error',retention_days:30,source:'server',updated_by_user_id:9});
test('Log maintenance loads config independently of sink failure and saves editable fields only',async()=>{
  const writes=[];const {s}=fixture('operations/LogMaintenanceSheet.vue',{defineProps:()=>({filters:{}}),opsAPI:{getRuntimeLogConfig:async()=>loggingConfig(),getSystemLogSinkHealth:async()=>{throw Error('sink offline');},updateRuntimeLogConfig:async p=>{writes.push(plain(p));return p;}}});
  await s.load();assert.ok(s.config.value);assert.match(s.healthError.value,/offline/);s.config.value.retention_days=3651;await s.save();assert.equal(writes.length,0);
  s.config.value.retention_days=7;await s.save();assert.equal(writes[0].retention_days,7);assert.equal(writes[0].persist_access_logs,true);assert.equal(writes[0].source,undefined);assert.equal(writes[0].updated_by_user_id,undefined);
});

test('Log persistence false is explicit, and failed save retains the edited flag',async()=>{
  const writes=[];let fail=true;const {s}=fixture('operations/LogMaintenanceSheet.vue',{opsAPI:{getRuntimeLogConfig:async()=>loggingConfig(),getSystemLogSinkHealth:async()=>({queue_depth:0}),updateRuntimeLogConfig:async p=>{writes.push(plain(p));if(fail)throw Error('save offline');return p;}}});
  await s.load();s.config.value.persist_access_logs=false;await s.save();assert.equal(writes[0].persist_access_logs,false);assert.equal(s.config.value.persist_access_logs,false);assert.match(s.error.value,/offline/);assert.equal(s.notice.value,'');
  fail=false;await s.save();assert.equal(writes[1].persist_access_logs,false);assert.match(s.notice.value,/已保存/);
});

for(const value of [undefined,null,'true'])test(`Log unknown persistence ${value} cannot be overwritten by a default`,async()=>{
  let writes=0;const {s}=fixture('operations/LogMaintenanceSheet.vue',{opsAPI:{getRuntimeLogConfig:async()=>({...loggingConfig(),persist_access_logs:value}),getSystemLogSinkHealth:async()=>({queue_depth:0}),updateRuntimeLogConfig:async()=>writes++}});
  await s.load();assert.equal(s.persistenceKnown.value,false);s.config.value.level='warn';await s.save();assert.equal(writes,0);assert.match(s.error.value,/持久化状态/);
});
test('Log cleanup rejects empty/reversed time and snapshots confirmed scope before mutation',async()=>{
  const writes=[];const props={filters:{platform:'openai',level:'error',q:'needle'}};
  const {s}=fixture('operations/LogMaintenanceSheet.vue',{defineProps:()=>props,opsAPI:{cleanupSystemLogs:async p=>{writes.push(plain(p));return {deleted:12};}}});
  s.prepareCleanup();assert.equal(s.pending.value,null);s.start.value='2026-09-11T12:00';s.end.value='2026-09-11T11:00';s.prepareCleanup();assert.equal(s.pending.value,null);
  s.end.value='2026-09-11T13:00';s.prepareCleanup();assert.equal(writes.length,0);props.filters.q='changed';s.start.value='2000-01-01T00:00';await s.confirm();
  assert.equal(writes[0].q,'needle');assert.equal(writes[0].platform,'openai');assert.ok(writes[0].start_time.startsWith('2026-09-11'));assert.match(s.notice.value,/12/);
});
test('Log maintenance reset is confirmed and failed initial read cannot save defaults',async()=>{
  let resets=0,saves=0;const {s}=fixture('operations/LogMaintenanceSheet.vue',{opsAPI:{getRuntimeLogConfig:async()=>{throw Error('disabled');},getSystemLogSinkHealth:async()=>({queue_depth:0}),updateRuntimeLogConfig:async()=>saves++,resetRuntimeLogConfig:async()=>{resets++;return loggingConfig();}}});
  await s.load();await s.save();assert.equal(saves,0);assert.ok(s.health.value);await s.confirm();assert.equal(resets,0);s.pending.value='reset';await s.confirm();assert.equal(resets,1);assert.equal(s.config.value.level,'info');
});
const mailConfig=()=>({alert:{enabled:true,recipients:['a@example.com'],min_severity:'warning',rate_limit_per_hour:10,batching_window_seconds:30,include_resolved_alerts:true},report:{enabled:false,recipients:[],daily_summary_enabled:false,daily_summary_schedule:'0 9 * * *',weekly_summary_enabled:false,weekly_summary_schedule:'0 9 * * 1',error_digest_enabled:false,error_digest_schedule:'0 * * * *',error_digest_min_count:1,account_health_enabled:false,account_health_schedule:'0 9 * * *',account_health_error_rate_threshold:10}});
const runtimeConfig=()=>({evaluation_interval_seconds:30,distributed_lock:{enabled:true,key:'ops:leader',ttl_seconds:30},thresholds:{sla_percent_min:99},silencing:{enabled:true,global_until_rfc3339:'',global_reason:'',entries:[{rule_id:8,severities:['P1'],until_rfc3339:'2027-01-01T00:00:00Z',reason:'existing'}]}});
test('Mail settings validate recipients, preserve report settings and submit through official endpoint',async()=>{
 const calls=[];const {s}=fixture('operations/AlertSettingsSheet.vue',{defineProps:()=>({mode:'email'}),opsAPI:{getEmailNotificationConfig:async()=>mailConfig(),updateEmailNotificationConfig:async p=>calls.push(plain(p))}});
 await s.load();s.recipients.value='bad';await s.save();assert.equal(calls.length,0);s.recipients.value='a@example.com;a@example.com b@example.com';await s.save();assert.deepEqual(calls[0].alert.recipients,['a@example.com','b@example.com']);assert.equal(calls[0].report.weekly_summary_schedule,'0 9 * * 1');
 s.email.value.report.enabled=true;s.reportRecipients.value='report@example.com';s.email.value.report.daily_summary_enabled=true;s.email.value.report.daily_summary_schedule='invalid';await s.save();assert.equal(calls.length,1);
});
test('Runtime settings preserve silence entries, validate lock/thresholds and support nullable threshold',async()=>{
 const calls=[];const {s}=fixture('operations/AlertSettingsSheet.vue',{defineProps:()=>({mode:'runtime'}),opsAPI:{getAlertRuntimeSettings:async()=>runtimeConfig(),updateAlertRuntimeSettings:async p=>calls.push(plain(p))}});
 await s.load();s.runtime.value.distributed_lock.key='bad';await s.save();assert.equal(calls.length,0);s.runtime.value.distributed_lock.key='ops:valid';s.runtime.value.thresholds.sla_percent_min=101;await s.save();assert.equal(calls.length,0);
 s.setThreshold('sla_percent_min',{target:{value:''}});await s.save();assert.equal(calls[0].thresholds.sla_percent_min,null);assert.equal(calls[0].silencing.entries[0].rule_id,8);
});
test('Alert settings failure cannot write defaults and closing fences late read',async()=>{
 let writes=0;const d=defer();const {s,unmounted}=fixture('operations/AlertSettingsSheet.vue',{defineProps:()=>({mode:'email'}),opsAPI:{getEmailNotificationConfig:()=>d.promise,updateEmailNotificationConfig:async()=>writes++}});
 await s.save();assert.equal(writes,0);const run=s.load();unmounted.forEach(fn=>fn());d.resolve(mailConfig());await run;assert.equal(s.email.value,null);
});
const poolConfig=()=>({...riskConfig(),api_key_count:1,api_key_statuses:[{key_hash:'hash-a',configured:true,masked:'sk-***',status:'ok'}],base_url:'https://audit.test',model:'moderation',timeout_ms:3000,proxy_id:7});
test('Risk key pool append/remove/replace/clear are explicit confirmed payloads',async()=>{
 const calls=[];const {s}=fixture('operations/RiskKeysSheet.vue',{riskControlAPI:{getConfig:async()=>poolConfig(),updateConfig:async p=>calls.push(plain(p))}});
 await s.load();s.input.value='new-key';s.deleted.value=['hash-a'];s.prepare();assert.equal(calls.length,0);await s.save();assert.deepEqual(calls[0],{api_keys:['new-key'],api_keys_mode:'append',delete_api_key_hashes:['hash-a']});assert.equal(s.input.value,'');
 s.mode.value='replace';s.prepare();assert.equal(s.pending.value,null);s.input.value='replacement';s.prepare();await s.save();assert.equal(calls[1].api_keys_mode,'replace');
 s.clear.value=true;s.input.value='contradiction';s.prepare();assert.equal(s.pending.value,null);s.input.value='';s.prepare();await s.save();assert.deepEqual(calls[2],{clear_api_key:true});
});
test('Risk key probes preserve configured routing and distinguish failed individual keys',async()=>{
 const calls=[];const {s}=fixture('operations/RiskKeysSheet.vue',{riskControlAPI:{getConfig:async()=>poolConfig(),testAPIKeys:async p=>{calls.push(plain(p));return {items:[{masked:'***',status:'error',last_error:'denied'}],audit_result:{flagged:true}};}}});
 await s.load();s.prompt.value='fixture';s.images.value='https://example.test/image.png';await s.probe(false);assert.deepEqual(calls[0].api_keys,[]);assert.equal(calls[0].proxy_id,7);assert.equal(calls[0].model,'moderation');assert.equal(s.tested.value[0].status,'error');assert.equal(s.audit.value.flagged,true);
 s.deleted.value=['hash-a'];await s.probe(false);assert.equal(calls.length,1);s.input.value='new';await s.probe(true);assert.deepEqual(calls[1].api_keys,['new']);
});
test('Risk key read failure prevents writes; pending secrets and late probes clear on close',async()=>{
 const d=defer();let writes=0;const {s,unmounted}=fixture('operations/RiskKeysSheet.vue',{riskControlAPI:{getConfig:async()=>poolConfig(),updateConfig:async()=>writes++,testAPIKeys:()=>d.promise}});
 s.input.value='secret';s.prepare();assert.equal(s.pending.value,null);assert.equal(writes,0);await s.load();s.input.value='secret';s.prepare();const run=s.probe(true);unmounted.forEach(fn=>fn());d.resolve({items:[{status:'ok'}]});await run;assert.equal(s.input.value,'');assert.equal(s.pending.value,null);assert.equal(s.tested.value.length,0);
});
test('Risk unban requires confirmation target, blocks duplicates, updates all same-user records',async()=>{
 const d=defer(),calls=[];const {s}=fixture('SecurityApp.vue',{riskControlAPI:{unbanUser:async id=>{calls.push(id);return d.promise;}}});
 await s.confirmUnban();assert.equal(calls.length,0);s.riskLogs.value=[{user_id:5,user_status:'disabled'},{user_id:5,user_status:'disabled'},{user_id:6,user_status:'disabled'}];s.selectedRiskLog.value={user_id:5,user_status:'disabled'};
 s.unbanTarget.value={id:5,email:'fixture'};const a=s.confirmUnban(),b=s.confirmUnban();assert.deepEqual(calls,[5]);d.resolve({user_id:5,status:'active'});await Promise.all([a,b]);assert.equal(s.riskLogs.value[0].user_status,'active');assert.equal(s.riskLogs.value[1].user_status,'active');assert.equal(s.riskLogs.value[2].user_status,'disabled');assert.equal(s.selectedRiskLog.value.user_status,'active');
});
test('Traffic charts load independently and retain successful distribution when latency fails',async()=>{
 const calls=[];const {s}=fixture('operations/TrafficAnalysis.vue',{defineProps:()=>({platform:'openai',range:'6h'}),opsAPI:{getLatencyHistogram:async p=>{calls.push(plain(p));throw Error('latency failed');},getErrorDistribution:async()=>({total:2,items:[{status_code:500,total:2}]}),getErrorTrend:async()=>({points:[]})}});
 await s.loadCharts();assert.match(s.errors.value.latency,/failed/);assert.equal(s.distribution.value.total,2);assert.deepEqual(calls[0],{time_range:'6h',platform:'openai'});assert.equal(s.width(1,2),'50%');
});
test('Realtime summary uses official 1min window, gates hidden/background polls and never invents zero on failure',async()=>{
 const calls=[];let fail=false;const document={hidden:true};const {s}=fixture('operations/TrafficAnalysis.vue',{defineProps:()=>({platform:'openai',range:'1h'}),document,opsAPI:{getRealtimeTrafficSummary:async(...args)=>{calls.push(args);if(fail)throw Error('offline');return {enabled:true,summary:{qps:{current:2,peak:3,avg:1},tps:{current:4,peak:5,avg:2}}};}}});
 s.auto.value=true;s.poll();assert.equal(calls.length,0);document.hidden=false;s.poll();await tick();assert.deepEqual(calls[0],['1min','openai']);assert.equal(s.realtime.value.summary.qps.current,2);
 fail=true;await s.loadLive();assert.equal(s.realtime.value.summary.qps.current,2);assert.match(s.errors.value.live,/offline/);s.auto.value=false;s.poll();assert.equal(calls.length,2);
});
test('Traffic token pagination uses separate OpenAI range and closes stale responses',async()=>{
 const calls=[],d=defer();const {s,unmounted}=fixture('operations/TrafficAnalysis.vue',{defineProps:()=>({platform:'anthropic',range:'1h'}),opsAPI:{getOpenAITokenStats:async p=>{calls.push(plain(p));return d.promise;}}});
 s.tokenRange.value='15d';s.tokenPage.value=2;const run=s.loadTokens();assert.deepEqual(calls[0],{time_range:'15d',platform:'openai',page:2,page_size:25});unmounted.forEach(fn=>fn());d.resolve({items:[{model:'old'}],total:26});await run;assert.equal(s.tokens.value,null);
});
test('Realtime disabled and malformed samples remain distinct from measured zero',async()=>{
 let data={enabled:false,summary:null};const {s}=fixture('operations/TrafficAnalysis.vue',{defineProps:()=>({platform:'',range:'1h'}),opsAPI:{getRealtimeTrafficSummary:async()=>data}});
 await s.loadLive();assert.equal(s.realtime.value.enabled,false);data={enabled:true,summary:null};await s.loadLive();assert.match(s.errors.value.live,/无效/);assert.equal(s.realtime.value.enabled,false);
});
test('Mail save errors retain draft and concurrent clicks issue one update',async()=>{
 const d=defer();let calls=0;const {s}=fixture('operations/AlertSettingsSheet.vue',{defineProps:()=>({mode:'email'}),opsAPI:{getEmailNotificationConfig:async()=>mailConfig(),updateEmailNotificationConfig:async()=>{calls++;return d.promise;}}});
 await s.load();s.recipients.value='new@example.com';const a=s.save(),b=s.save();assert.equal(calls,1);d.reject(Error('write failed'));await Promise.all([a,b]);assert.match(s.error.value,/write failed/);assert.equal(s.recipients.value,'new@example.com');assert.equal(s.saving.value,false);
});
test('Risk unban failure retains confirmation and close rejects late status update',async()=>{
 let fail=true;const d=defer();const {s,unmounted}=fixture('SecurityApp.vue',{riskControlAPI:{unbanUser:async()=>{if(fail)throw Error('denied');return d.promise;}}});
 s.riskLogs.value=[{user_id:5,user_status:'disabled'}];s.unbanTarget.value={id:5,email:'fixture'};await s.confirmUnban();assert.match(s.unbanError.value,/denied/);assert.equal(s.unbanTarget.value.id,5);
 fail=false;const run=s.confirmUnban();unmounted.forEach(fn=>fn());d.resolve({user_id:5,status:'active'});await run;assert.equal(s.riskLogs.value[0].user_status,'disabled');
});
test('Runtime entries without optional severities remain editable and invalid rule IDs reject save',async()=>{
 const cfg=runtimeConfig();delete cfg.silencing.entries[0].severities;let calls=0;const {s}=fixture('operations/AlertSettingsSheet.vue',{defineProps:()=>({mode:'runtime'}),opsAPI:{getAlertRuntimeSettings:async()=>cfg,updateAlertRuntimeSettings:async()=>calls++}});
 await s.load();assert.deepEqual(plain(s.runtime.value.silencing.entries[0].severities),[]);s.runtime.value.silencing.entries[0].rule_id=-1;await s.save();assert.equal(calls,0);s.runtime.value.silencing.entries[0].rule_id=8;await s.save();assert.equal(calls,1);
});
test('Advanced retention preserves unrelated server settings and requires confirmed valid days/cron',async()=>{
 const cfg={data_retention:{cleanup_enabled:true,cleanup_schedule:'0 3 * * *',error_log_retention_days:30,minute_metrics_retention_days:7,hourly_metrics_retention_days:90},aggregation:{aggregation_enabled:true},ignore_context_canceled:true,openai_account_quota_auto_pause:{default_threshold_5h:0.2,default_threshold_7d:0.5}};
 const calls=[];const {s}=fixture('operations/AdvancedSettingsSheet.vue',{opsAPI:{getAdvancedSettings:async()=>cfg,updateAdvancedSettings:async p=>{calls.push(plain(p));return p;}}});
 await s.load();s.config.value.data_retention.error_log_retention_days=366;s.prepare();assert.equal(s.pending.value,null);s.config.value.data_retention.error_log_retention_days=0;s.prepare();assert.equal(calls.length,0);s.config.value.data_retention.error_log_retention_days=20;await s.save();assert.equal(calls[0].data_retention.error_log_retention_days,0);assert.equal(calls[0].ignore_context_canceled,true);assert.equal(calls[0].openai_account_quota_auto_pause.default_threshold_5h,0.2);
});
test('Advanced retention cannot save failed load or invalid cron; pending failure preserves draft',async()=>{
 let calls=0;const {s}=fixture('operations/AdvancedSettingsSheet.vue',{opsAPI:{getAdvancedSettings:async()=>{throw Error('read failed');},updateAdvancedSettings:async()=>{calls++;throw Error('save failed');}}});await s.load();s.prepare();await s.save();assert.equal(calls,0);
 s.config.value={data_retention:{cleanup_enabled:true,cleanup_schedule:'bad',error_log_retention_days:3,minute_metrics_retention_days:3,hourly_metrics_retention_days:3},aggregation:{aggregation_enabled:false}};s.prepare();assert.equal(s.pending.value,null);s.config.value.data_retention.cleanup_schedule='0 3 * * *';s.prepare();await s.save();assert.equal(calls,1);assert.ok(s.pending.value);assert.match(s.error.value,/save failed/);
});
test('Hash cache validates SHA256 and snapshots a confirmed single delete separately from clear-all',async()=>{
 const calls=[];const {s}=fixture('operations/HashCacheSheet.vue',{riskControlAPI:{getStatus:async()=>({flagged_hash_count:4}),deleteFlaggedHash:async hash=>{calls.push(['one',hash]);return {deleted:false};},clearFlaggedHashes:async()=>{calls.push(['all']);return {deleted:4};}}});
 await s.load();s.input.value='bad';s.prepare('one');assert.equal(s.pending.value,null);s.input.value='A'.repeat(64);s.prepare('one');assert.equal(calls.length,0);s.input.value='b'.repeat(64);await s.confirm();assert.deepEqual(calls[0],['one','a'.repeat(64)]);assert.match(s.notice.value,/未找到/);s.prepare('all');await s.confirm();assert.deepEqual(calls[1],['all']);assert.match(s.notice.value,/4/);
});
test('Hash cache load failure disables destructive actions and clear failure keeps confirmation',async()=>{
 let calls=0;const {s}=fixture('operations/HashCacheSheet.vue',{riskControlAPI:{getStatus:async()=>{throw Error('disabled');},clearFlaggedHashes:async()=>{calls++;throw Error('denied');}}});
 await s.load();s.prepare('all');await s.confirm();assert.equal(calls,0);s.count.value=3;s.prepare('all');await s.confirm();assert.equal(calls,1);assert.equal(s.pending.value.kind,'all');assert.match(s.error.value,/denied/);
});
function liveFixture(){
 const callbacks=[],timers=new Map(),statuses=[],errors=[];let refreshes=0,visible=true,disposals=0,id=0;
 const context={exports:{},require:name=>({opsAPI:{subscribeQPS:(message,options)=>{callbacks.push({message,options});return()=>disposals++;}}}),setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
 vm.createContext(context);vm.runInContext(ts.transpileModule(fs.readFileSync(full('operations/liveConnection.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
 const s=context.exports.createLiveConnection({visible:()=>visible,status:s=>statuses.push(s),refresh:()=>refreshes++,error:e=>errors.push(e)});
 return {s,callbacks,timers,statuses,errors,hide:()=>visible=false,show:()=>visible=true,counts:()=>({refreshes,disposals})};
}
test('Live connection debounces pushes, pauses on hidden and reconnects on visible without stale refresh',()=>{
 const f=liveFixture();f.s.setEnabled(true);assert.equal(f.callbacks.length,1);const first=f.callbacks[0];first.options.onOpen();assert.equal(f.counts().refreshes,1);first.message({qps:2});first.message({qps:3});assert.equal(f.timers.size,1);
 f.hide();f.s.visibilityChanged();assert.equal(f.timers.size,0);assert.equal(f.counts().disposals,1);assert.equal(f.statuses.at(-1),'paused');first.message({late:true});assert.equal(f.timers.size,0);
 f.show();f.s.visibilityChanged();assert.equal(f.callbacks.length,2);f.callbacks[1].message({signal:true});for(const cb of f.timers.values())cb();assert.equal(f.counts().refreshes,2);f.s.dispose();assert.equal(f.counts().disposals,2);f.callbacks[1].options.onOpen();assert.equal(f.counts().refreshes,2);
});
test('Live connection disabled fatal close requires explicit retry and ignores invalid messages',()=>{
 const f=liveFixture();f.hide();f.s.setEnabled(true);assert.equal(f.callbacks.length,0);assert.equal(f.statuses.at(-1),'paused');f.show();f.s.visibilityChanged();f.callbacks[0].message(null);f.callbacks[0].message('bad');assert.equal(f.timers.size,0);
 f.callbacks[0].options.onFatalClose();assert.equal(f.statuses.at(-1),'disabled');f.hide();f.s.visibilityChanged();f.show();f.s.visibilityChanged();assert.equal(f.callbacks.length,1);f.s.reconnect();assert.equal(f.callbacks.length,2);f.s.setEnabled(false);assert.equal(f.statuses.at(-1),'closed');f.s.dispose();
});
function socketFixture(){
 const sockets=[],timeouts=new Map(),intervals=new Map(),listeners=new Map();let id=0;
 class Socket{static OPEN=1;static CONNECTING=0;constructor(url,protocols){this.url=url;this.protocols=protocols;this.readyState=0;sockets.push(this);}close(){this.readyState=3;this.onclose?.({code:1000});}open(){this.readyState=1;this.onopen?.();}fail(code=1006){this.readyState=3;this.onclose?.({code});}}
 const context={exports:{},WebSocket:Socket,URL,Date,Event,Math,console:{warn(){},error(){}},navigator:{onLine:true},localStorage:{getItem:()=> 'fixture-token'},window:{location:{protocol:'https:'},addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},setTimeout:fn=>{timeouts.set(++id,fn);return id;},clearTimeout:key=>timeouts.delete(key),setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:key=>intervals.delete(key),__testEnv:{},require:name=>({apiClient:{},buildGatewayUrl:path=>'https://console.test'+path})};
 vm.createContext(context);vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(pkg,'src/api/admin/ops.ts'),'utf8').replaceAll('import.meta.env','globalThis.__testEnv'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return {api:context.exports,sockets,timeouts,intervals,listeners,context,fireRetry:()=>{const [key,fn]=timeouts.entries().next().value;timeouts.delete(key);fn();}};
}
test('Official WS transport uses auth subprotocol, retries initial failures within budget and disposes listeners',()=>{
 const f=socketFixture(),statuses=[];const stop=f.api.subscribeQPS(()=>{}, {maxReconnectAttempts:2,onStatusChange:s=>statuses.push(s)});
 assert.equal(f.sockets[0].url,'wss://console.test/api/v1/admin/ops/ws/qps');assert.deepEqual(plain(f.sockets[0].protocols),['sub2api-admin','jwt.fixture-token']);assert.ok(!f.sockets[0].url.includes('fixture-token'));
 f.sockets[0].fail();f.fireRetry();f.sockets[1].fail();f.fireRetry();f.sockets[2].fail();assert.equal(f.timeouts.size,0);assert.equal(statuses.at(-1),'closed');stop();assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);
});
test('Official WS transport handles valid/invalid messages, fatal disabled close and late socket callbacks',()=>{
 const f=socketFixture(),messages=[];let fatal=0;const stop=f.api.subscribeQPS(data=>messages.push(data),{onFatalClose:()=>fatal++});const socket=f.sockets[0];socket.open();assert.equal(f.intervals.size,1);socket.onmessage({data:'bad'});socket.onmessage({data:'{"qps":2}'});assert.equal(messages.length,1);
 socket.fail(4001);assert.equal(fatal,1);assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);socket.onmessage({data:'{"qps":99}'});assert.equal(messages.length,1);stop();assert.equal(f.listeners.size,0);
});
test('Official WS transport survives offline reconnect and explicit disposal prevents any reconnect',()=>{
 const f=socketFixture();const stop=f.api.subscribeQPS(()=>{},{});f.sockets[0].open();f.context.navigator.onLine=false;f.sockets[0].fail();assert.equal(f.timeouts.size,0);f.context.navigator.onLine=true;f.listeners.get('online')();assert.equal(f.sockets.length,2);stop();assert.equal(f.timeouts.size,0);assert.equal(f.intervals.size,0);assert.equal(f.listeners.size,0);f.sockets[1].open();assert.equal(f.intervals.size,0);
});
test('Official WS heartbeat closes stale connection, schedules retry and clears timers',()=>{
 const f=socketFixture();let now=1000;f.context.Date={now:()=>now};const stop=f.api.subscribeQPS(()=>{},{staleTimeoutMs:100,staleCheckIntervalMs:50});f.sockets[0].open();now=1200;for(const fn of [...f.intervals.values()])fn();assert.equal(f.sockets[0].readyState,3);assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,1);stop();assert.equal(f.timeouts.size,0);
});
test('Official WS construction failure respects zero retries and leaves no listeners after dispose',()=>{
 const f=socketFixture();let errors=0;f.context.WebSocket=class {constructor(){throw Error('unavailable');}};const stop=f.api.subscribeQPS(()=>{},{maxReconnectAttempts:0,onError:()=>errors++});assert.equal(errors,1);assert.equal(f.timeouts.size,0);stop();assert.equal(f.listeners.size,0);
});
test('Hash cache malformed deletion response cannot be reported as success',async()=>{
 const {s}=fixture('operations/HashCacheSheet.vue',{riskControlAPI:{getStatus:async()=>({flagged_hash_count:2}),clearFlaggedHashes:async()=>({})}});await s.load();s.prepare('all');await s.confirm();assert.equal(s.notice.value,'');assert.match(s.error.value,/响应无效/);assert.equal(s.pending.value.kind,'all');
});
const advancedConfig=()=>({data_retention:{cleanup_enabled:true,cleanup_schedule:'0 3 * * *',error_log_retention_days:30,minute_metrics_retention_days:7,hourly_metrics_retention_days:90},aggregation:{aggregation_enabled:true},ignore_count_tokens_errors:false,ignore_context_canceled:true,ignore_no_available_accounts:false,ignore_invalid_api_key_errors:false,ignore_insufficient_balance_errors:true,display_openai_token_stats:true,display_alert_events:true,auto_refresh_enabled:true,auto_refresh_interval_seconds:30,openai_account_quota_auto_pause:{default_threshold_5h:0.25,default_threshold_7d:0.8}});
test('Advanced structured UI preserves flags, converts percentages and emits saved preferences',async()=>{
 const calls=[];const {s,emitted}=fixture('operations/AdvancedSettingsSheet.vue',{opsAPI:{getAdvancedSettings:async()=>advancedConfig(),updateAdvancedSettings:async p=>{calls.push(plain(p));return p;}}});await s.load();assert.equal(s.quotaPercent('default_threshold_5h'),25);s.setQuota('default_threshold_5h',{target:{value:'37.5'}});s.setQuota('default_threshold_7d',{target:{value:'0'}});s.config.value.ignore_invalid_api_key_errors=true;s.config.value.display_openai_token_stats=false;s.config.value.auto_refresh_interval_seconds=15;s.prepare();await s.save();
 assert.equal(calls[0].openai_account_quota_auto_pause.default_threshold_5h,0.375);assert.equal(calls[0].openai_account_quota_auto_pause.default_threshold_7d,0);assert.equal(calls[0].ignore_context_canceled,true);assert.equal(calls[0].ignore_invalid_api_key_errors,true);assert.equal(calls[0].display_openai_token_stats,false);assert.equal(emitted[0][0],'saved');assert.equal(emitted[0][1].auto_refresh_interval_seconds,15);
});
test('Advanced quota rejects blank/out of range and invalid refresh interval without writes',async()=>{
 let calls=0;const {s}=fixture('operations/AdvancedSettingsSheet.vue',{opsAPI:{getAdvancedSettings:async()=>advancedConfig(),updateAdvancedSettings:async()=>calls++}});await s.load();
 for(const value of ['', '-1','101']){s.setQuota('default_threshold_5h',{target:{value}});s.prepare();assert.equal(s.pending.value,null);}
 s.setQuota('default_threshold_5h',{target:{value:'100'}});s.config.value.auto_refresh_interval_seconds=0;s.prepare();assert.equal(s.pending.value,null);assert.equal(calls,0);
});
test('Ops saved preferences fence a late initial read and hide late alert widget response',async()=>{
 const old=defer(),alerts=defer();const {s}=fixture('OpsApp.vue',{opsAPI:{getAdvancedSettings:()=>old.promise,listAlertEvents:()=>alerts.promise}});
 const pending=s.loadPreferences();const newer={...advancedConfig(),display_alert_events:false};s.applyPreferences(newer);old.resolve({...advancedConfig(),auto_refresh_interval_seconds:60});await pending;assert.equal(s.preferences.value.auto_refresh_interval_seconds,30);assert.equal(s.preferences.value.display_alert_events,false);
 s.applyPreferences(advancedConfig());s.applyPreferences(newer);alerts.resolve([{id:9}]);await tick();assert.equal(s.overviewAlerts.value.length,0);
});
test('Ops overview respects saved auto-refresh cadence, disabled state, hidden tab and active subview',async()=>{
 let now=0,calls=0;class FakeDate extends Date{static now(){return now;}}const document={hidden:false};const {s}=fixture('OpsApp.vue',{Date:FakeDate,document,opsAPI:{getDashboardOverview:async()=>{calls++;return {};}}});s.applyPreferences({...advancedConfig(),display_alert_events:false,auto_refresh_interval_seconds:15});now=14000;s.refreshAutomatically();assert.equal(calls,0);now=15000;s.refreshAutomatically();await tick();assert.equal(calls,1);
 now=30000;document.hidden=true;s.refreshAutomatically();assert.equal(calls,1);document.hidden=false;s.opsTab.value='traffic';s.refreshAutomatically();assert.equal(calls,1);s.opsTab.value='overview';s.preferences.value.auto_refresh_enabled=false;s.refreshAutomatically();assert.equal(calls,1);
});
test('Ops subview automatic refresh respects preferences and avoids interrupting rule editing',async()=>{
 let now=0,calls=0;class FakeDate extends Date{static now(){return now;}}const props={tab:'rules',preferences:advancedConfig()};const {s}=fixture('operations/OperationsPanel.vue',{Date:FakeDate,defineProps:()=>props,opsAPI:{listAlertRules:async()=>{calls++;return [];}}});now=30000;s.edit();s.autoRefresh();assert.equal(calls,0);s.draft.value=null;s.autoRefresh();await tick();assert.equal(calls,1);now=60000;props.preferences.auto_refresh_enabled=false;s.autoRefresh();assert.equal(calls,1);
});
test('Token display preference suppresses requests and real Vue watch discards in-flight hidden stats',async()=>{
 const props=vue.reactive({platform:'openai',range:'1h',showTokens:false});const d=defer();let calls=0;const {s}=fixture('operations/TrafficAnalysis.vue',{defineProps:()=>props,watch:vue.watch,opsAPI:{getOpenAITokenStats:async()=>{calls++;return d.promise;}}});await s.loadTokens();assert.equal(calls,0);props.showTokens=true;await vue.nextTick();assert.equal(calls,1);props.showTokens=false;await vue.nextTick();d.resolve({items:[{model:'stale'}],total:1});await tick();assert.equal(s.tokens.value,null);assert.equal(s.tokenLoading.value,false);
});
const capacityAccounts=()=>({enabled:true,platform:{},group:{},account:Object.fromEntries(Array.from({length:30},(_,i)=>[i+1,{account_id:i+1,account_name:'Account '+(i+1),group_name:'Group',group_id:8,platform:'openai',status:'active',is_available:i%2===0,is_rate_limited:i===1,is_overloaded:i===2,has_error:i===3,error_message:i===3?'fixture error':''}])),timestamp:'fixture-time'});
test('Account availability uses platform/group API and supports full snapshot paging and filters',async()=>{
 const calls=[];const {s}=fixture('operations/CapacityPanel.vue',{defineProps:()=>({platform:'openai'}),opsAPI:{getAccountAvailabilityStats:async(...args)=>{calls.push(args);return capacityAccounts();}}});s.group.value='8';await s.load();assert.deepEqual(calls[0],['openai',8]);assert.equal(s.allRows.value.length,30);assert.equal(s.pageRows.value.length,25);s.page.value=2;assert.equal(s.pageRows.value.length,5);s.page.value=1;s.state.value='limited';assert.equal(s.filtered.value.length,1);assert.equal(s.filtered.value[0].account_id,2);s.state.value='all';s.search.value='Account 30';assert.equal(s.filtered.value[0].account_id,30);
});
test('User concurrency is independent of platform and supports queue filtering',async()=>{
 let calls=0;const {s}=fixture('operations/CapacityPanel.vue',{defineProps:()=>({platform:'gemini'}),opsAPI:{getUserConcurrencyStats:async()=>{calls++;return {enabled:true,user:{1:{user_id:1,user_email:'a@example.com',username:'A',current_in_use:2,max_capacity:3,waiting_in_queue:1,load_percentage:66},2:{user_id:2,user_email:'b@example.com',username:'B',current_in_use:0,max_capacity:3,waiting_in_queue:0,load_percentage:0}}};}}});s.tab.value='users';await s.load();assert.equal(calls,1);s.state.value='waiting';assert.equal(s.filtered.value.length,1);assert.equal(s.filtered.value[0].user_id,1);
});
test('Capacity old responses cannot replace a switched view; failed refresh retains previous snapshot',async()=>{
 const d=defer();let fail=false;const {s}=fixture('operations/CapacityPanel.vue',{defineProps:()=>({platform:''}),opsAPI:{getAccountAvailabilityStats:()=>d.promise,getUserConcurrencyStats:async()=>{if(fail)throw Error('offline');return {enabled:true,user:{}};}}});const a=s.load();s.tab.value='users';await s.load();d.resolve(capacityAccounts());await a;assert.equal(s.accounts.value,null);assert.equal(s.users.value.enabled,true);fail=true;await s.load();assert.match(s.error.value,/offline/);assert.equal(s.users.value.enabled,true);
});
test('Capacity malformed response, disabled feature and invalid group are distinct states',async()=>{
 let data={enabled:false};let calls=0;const {s}=fixture('operations/CapacityPanel.vue',{defineProps:()=>({platform:''}),opsAPI:{getAccountAvailabilityStats:async()=>{calls++;return data;}}});await s.load();assert.equal(s.enabled.value,false);data={enabled:true,account:[],platform:{},group:{}};await s.load();assert.match(s.error.value,/不完整/);s.group.value='-2';await s.load();assert.equal(calls,2);assert.match(s.error.value,/正整数/);
});
test('Plugin cancelled in-flight verification cannot settle a newer approval or keep it busy',async()=>{
  const old=defer();const {s}=fixture('plugins/PluginConfiguration.vue',{totpAPI:{stepUp:()=>old.promise}});
  s.session.value={expires_at:new Date(Date.now()+60000).toISOString()};s.needCode.value=true;
  const cancelled=s.approve('first');const caught=assert.rejects(cancelled,/取消/);s.code.value='123456';const verifying=s.confirm();assert.equal(s.verifying.value,true);
  s.settle(false);await caught;assert.equal(s.verifying.value,false);
  const next=s.approve('second');old.resolve({verified:true});await verifying;assert.equal(s.confirmation.value,'second');assert.equal(s.verifying.value,false);s.settle(true);await next;
});
test('Disposed WS queued offline callback and replaced socket cannot change connection state',()=>{
 const f=socketFixture(),statuses=[],messages=[];const stop=f.api.subscribeQPS(data=>messages.push(data),{onStatusChange:s=>statuses.push(s)});
 const first=f.sockets[0],offline=f.listeners.get('offline');first.open();first.fail();f.fireRetry();const second=f.sockets[1];second.open();const count=statuses.length;
 first.onopen?.();first.onmessage?.({data:'{"qps":99}'});first.onclose?.({code:1006});assert.equal(messages.length,0);assert.equal(statuses.length,count);
 stop();const finalCount=statuses.length;offline();assert.equal(statuses.length,finalCount);assert.equal(f.timeouts.size,0);
});
test('Security list generation accepts new filters while old request is pending and fences unmount',async()=>{
 const old=defer(),latest=defer();let calls=0;const {s,unmounted}=fixture('SecurityApp.vue',{auditAPI:{list:()=>++calls===1?old.promise:latest.promise}});
 const first=s.loadAuditLogs();s.auditFilters.q='new';const second=s.loadAuditLogs();latest.resolve({items:[{id:2}],total:1});await second;old.resolve({items:[{id:1}],total:1});await first;assert.equal(s.auditLogs.value[0].id,2);
 const late=defer();s.auditLogs.value=[];const {s:other,unmounted:close}=fixture('SecurityApp.vue',{auditAPI:{list:()=>late.promise}});const pending=other.loadAuditLogs();close.forEach(fn=>fn());late.resolve({items:[{id:3}],total:1});await pending;assert.equal(other.auditLogs.value.length,0);unmounted.forEach(fn=>fn());
});
test('Audit clear validates TOTP and never reports malformed response as deleted',async()=>{
 let calls=0;const {s}=fixture('SecurityApp.vue',{auditAPI:{clear:async()=>{calls++;return{};}}});s.showClearModal.value=true;s.totpCode.value='123';await s.handleClearLogs();assert.equal(calls,0);assert.match(s.clearError.value,/6位/);
 s.totpCode.value='123456';await s.handleClearLogs();assert.equal(calls,1);assert.equal(s.showClearModal.value,true);assert.match(s.clearError.value,/不完整/);assert.equal(s.totpCode.value,'');
});
test('Plugin enable with omitted compatibility metadata remains confirmable and API-driven',async()=>{
 let accepted;const {s}=fixture('PluginsApp.vue',{usePluginStepUp:()=>({run:fn=>fn()}),pluginsAPI:{enable:async(id,priority,flag)=>{accepted=flag},list:async()=>[]}});
 await s.togglePlugin({id:1,name:'fixture',state:'disabled'});assert.equal(accepted,true);assert.equal(s.actionError.value,'');
});
test('Actual API wrappers use official ops and plugin routes and payloads',async()=>{
  const calls=[];const client=Object.fromEntries(['get','post','put','delete'].map(method=>[method,async(...args)=>{calls.push([method,...args.map(x=>typeof x==='object'?plain(x):x)]);return {data:{}};}]));
  function api(name) {
    const context={exports:{},URL,console,__testEnv:{},require:id=>{assert.equal(id,'../client');return {apiClient:client,buildGatewayUrl:x=>x};}};
    vm.createContext(context);vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(pkg,'src/api/admin',name+'.ts'),'utf8').replaceAll('import.meta.env','globalThis.__testEnv'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,context);return context.exports;
  }
  const ops=api('ops'),plugins=api('plugins');await ops.listRequestErrors({page:2});await ops.listUpstreamErrors({page:3});await ops.listSystemLogs({level:'error'});
  await ops.getRequestErrorDetail(4);await ops.updateUpstreamErrorResolved(5,true);await ops.createAlertRule({name:'fixture'});await ops.updateAlertEventStatus(6,'manual_resolved');
  await plugins.createUISession(7);await plugins.getConfig(7);await plugins.saveConfig(7,{sample:'fixture'});await plugins.test(7);
  assert.deepEqual(calls.map(c=>[c[0],c[1]]),[
    ['get','/admin/ops/request-errors'],['get','/admin/ops/upstream-errors'],['get','/admin/ops/system-logs'],
    ['get','/admin/ops/request-errors/4'],['put','/admin/ops/upstream-errors/5/resolve'],['post','/admin/ops/alert-rules'],['put','/admin/ops/alert-events/6/status'],
    ['post','/admin/plugins/7/ui-session'],['get','/admin/plugins/7/config'],['put','/admin/plugins/7/config'],['post','/admin/plugins/7/test']]);
  assert.deepEqual(calls[4][2],{resolved:true});assert.deepEqual(calls[9][2],{sample:'fixture'});
});
}
