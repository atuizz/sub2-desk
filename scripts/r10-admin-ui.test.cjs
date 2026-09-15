// Offline only: execute current production SFC bodies and API adapters in memory.
// Run: node --test scripts/r10-admin-ui.test.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue');
const plain = v => JSON.parse(JSON.stringify(v));
const denied = () => { throw Error('Real network is forbidden'); };
const netError = () => ({ status: 0, message: 'Network error. Please check your connection.' });
function adapter(name, transport) {
  const code = ts.transpileModule(fs.readFileSync(path.join(src, 'api/admin', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(id => {
    assert.equal(id, '../client'); return { apiClient: transport };
  }, exports);
  return exports;
}
function execute(name, extras) {
  const file = path.join(src, 'apps/admin', name + '.vue');
  let code = req('vue/compiler-sfc').parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n)
    ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text)
    : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) code = code.slice(0, n.pos) + code.slice(n.end);
  const context = { ...vue, onMounted() {}, onUnmounted() {}, watch() {}, defineProps: () => ({}),
    exports: {}, console, URL, Date, AbortController, useId: () => 'fixture', defineEmits: () => () => {}, setTimeout: denied, fetch: denied,
    adminError: (e, fallback) => e?.message || fallback, ...extras };
  vm.runInNewContext(ts.transpileModule(code + `\nglobalThis.subject = {${names.join(',')}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return context.subject;
}
const list = async () => ({ data: { items: [], total: 0 } });

function announcement(transport = {}) { return execute('AnnouncementsApp', { annAPI: adapter('announcements', { get: list, ...transport }) }); }
const item = { id: 7, title: 'Fixture', content: 'Body', status: 'active', notify_mode: 'silent', targeting: { any_of: [] }, starts_at: '2030-01-01T00:00:17Z', ends_at: '2030-01-02T00:00:23Z' };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
test('A1 create sends Unix seconds through real adapter', async () => {
  const calls=[]; const s=announcement({ post: async (...args) => { calls.push(plain(args)); return {data:{}}; } });
  s.openCreate(); Object.assign(s.form.value, { title:'Fixture', content:'Body', starts_at:'2030-01-01T12:00:17', ends_at:'2030-01-02T12:00:23' });
  await s.handleSave(); assert.equal(calls[0][0], '/admin/announcements');
  assert.equal(calls[0][1].starts_at, Math.floor(new Date('2030-01-01T12:00:17').getTime()/1000));
  assert.equal(calls[0][1].ends_at, Math.floor(new Date('2030-01-02T12:00:23').getTime()/1000));
  assert.deepEqual(calls[0][1].targeting, {any_of:[]});
});
test('A1 clear uses 0, unchanged schedule/content omitted, seconds preserved', async () => {
  const calls=[]; const s=announcement({ put: async (...args) => {calls.push(plain(args));return {data:{}};} });
  s.openEdit(item); assert.match(s.form.value.starts_at, /:17$/); s.form.value.content='Changed'; await s.handleSave();
  assert.deepEqual(calls[0][1], {content:'Changed'});
  s.openEdit(item); s.form.value.starts_at='';s.form.value.ends_at='';await s.handleSave();
  assert.deepEqual(calls[1][1], {starts_at:0,ends_at:0});
  s.openEdit(item); await s.handleSave(); assert.equal(calls.length,2);
});
test('A1 optional create dates omitted; changed time numeric; invalid order rejected', async () => {
  const calls=[]; const s=announcement({ post:async (...args)=>{calls.push(plain(args));return {data:{}};}, put:async (...args)=>{calls.push(plain(args));return {data:{}};} });
  s.openCreate(); Object.assign(s.form.value,{title:'T',content:'C'});await s.handleSave();assert.ok(!('starts_at' in calls[0][1]));
  s.openEdit(item);s.form.value.starts_at='2030-01-01T01:00:00';await s.handleSave();assert.equal(typeof calls[1][1].starts_at,'number');
  for(const value of ['invalid','2031-01-01T00:00']) {s.openEdit(item);s.form.value.starts_at=value;await s.handleSave();assert.ok(s.actionError.value);}
  assert.equal(calls.length,2);
});
test('A1 save failure preserves draft and in-flight guard prevents duplicate', async () => {
  const d=deferred();let count=0;const s=announcement({put:()=>{count++;return d.promise;}});
  s.openEdit(item);s.form.value.title='Draft';const first=s.handleSave();await s.handleSave();assert.equal(count,1);
  d.reject({message:'fixture failure'});await first;assert.equal(s.showEditDialog.value,true);assert.equal(s.form.value.title,'Draft');assert.match(s.actionError.value,/fixture/);
});
for (const mixed of [false,true]) test(`A3 ${mixed?'partial':'all skipped'} delete retains failures and reasons`,async()=>{
  const result={deleted_ids:mixed?[30]:[],skipped:[{id:31,reason:'proxy is in use'}]};
  const s=execute('ProxiesApp',{proxiesAPI:adapter('proxies',{post:async()=>({data:result}),get:async()=>({data:{items:[{id:31}],total:1}})}).proxiesAPI});
  s.selectedIds.value=new Set(mixed?[30,31]:[31]);s.showBatchDeleteAlert.value=true;await s.confirmBatchDelete();
  assert.deepEqual(plain(s.batchDeleteResult.value),result);assert.deepEqual([...s.selectedIds.value],[31]);assert.equal(s.showBatchDeleteAlert.value,false);
});
test('A3 full success reports count, failed transport keeps selection and confirmation',async()=>{
  const s=execute('ProxiesApp',{proxiesAPI:{batchDelete:async()=>{throw {message:'failed'};}}});
  s.selectedIds.value=new Set([1]);s.showBatchDeleteAlert.value=true;await s.confirmBatchDelete();assert.equal(s.selectedIds.value.size,1);assert.equal(s.showBatchDeleteAlert.value,true);assert.match(s.actionError.value,/failed/);
  const good=execute('ProxiesApp',{proxiesAPI:{batchDelete:async()=>({deleted_ids:[1],skipped:[]}),list:async()=>({items:[],total:0})}});
  good.selectedIds.value=new Set([1]);await good.confirmBatchDelete();assert.equal(good.batchDeleteResult.value.deleted_ids.length,1);assert.equal(good.selectedIds.value.size,0);
});
for(const staleFailure of [false,true]) test(`A4 A late ${staleFailure?'error':'success'} cannot replace B`,async()=>{
  const a=deferred(),b=deferred();const s=execute('ProxiesApp',{proxiesAPI:{getProxyAccounts:id=>id===1?a.promise:b.promise}});
  const pa=s.openAccountsModal({id:1,name:'A'});s.closeAccountsModal();const pb=s.openAccountsModal({id:2,name:'B'});
  b.resolve([{id:202,name:'B account'}]);await pb;
  if(staleFailure)a.reject({message:'old failure'});else a.resolve([{id:101}]);await pa;
  assert.equal(s.accountsProxy.value.id,2);assert.equal(s.proxyAccounts.value[0].id,202);assert.equal(s.accountsError.value,'');assert.equal(s.loadingAccounts.value,false);
});
test('A4 stale finally does not stop B spinner; closed request cannot repopulate',async()=>{
  const a=deferred(),b=deferred();const s=execute('ProxiesApp',{proxiesAPI:{getProxyAccounts:id=>id===1?a.promise:b.promise}});
  const pa=s.openAccountsModal({id:1});const pb=s.openAccountsModal({id:2});a.resolve([{id:1}]);await pa;assert.equal(s.loadingAccounts.value,true);
  s.closeAccountsModal();b.resolve([{id:2}]);await pb;assert.equal(s.proxyAccounts.value.length,0);assert.equal(s.showAccountsModal.value,false);
});
function targeting(model={any_of:[]}, overrides={}) {
  const props=vue.reactive({modelValue:model,disabled:false});const events=[];
  const s=execute('AnnouncementTargetingEditor',{defineProps:()=>props,defineEmits:()=> (e,v)=>{events.push([e,v]);if(e==='update:modelValue')props.modelValue=v;},getAll:async()=>[],...overrides});
  return {s,props,events};
}
test('A5 full OR/AND editor, subscription multiselect, all five balance operators',()=>{
  const {s,props}=targeting();s.setMode('custom');assert.equal(props.modelValue.any_of.length,1);assert.ok(s.validationError.value);
  s.toggleGroup(0,0,2);s.toggleGroup(0,0,3);assert.deepEqual(plain(props.modelValue.any_of[0].all_of[0].group_ids),[2,3]);assert.equal(s.validationError.value,'');
  s.addCondition(0);s.setType(0,1,'balance');s.setBalance(0,1,'-0.25');
  for(const operator of ['gt','gte','lt','lte','eq']){s.patchCondition(0,1,{operator});assert.equal(s.validationError.value,'');}
  s.setBalance(0,1,'');assert.ok(s.validationError.value);s.setBalance(0,1,'1.25');s.addGroup();s.removeGroup(1);s.removeCondition(0,1);
  s.toggleGroup(0,0,2);assert.deepEqual(plain(props.modelValue.any_of[0].all_of[0].group_ids),[3]);
  s.setMode('all');assert.deepEqual(plain(props.modelValue),{any_of:[]});
});
test('A5 group/condition limits, invalid empty group, disabled editor',()=>{
  const {s,props}=targeting();for(let i=0;i<55;i++)s.addGroup();assert.equal(props.modelValue.any_of.length,50);
  for(let i=0;i<55;i++)s.addCondition(0);assert.equal(props.modelValue.any_of[0].all_of.length,50);
  s.setMode('all');s.addGroup();s.removeCondition(0,0);assert.match(s.validationError.value,/至少/);
  props.disabled=true;s.setMode('all');assert.equal(props.modelValue.any_of.length,1);
});
test('A5 package lookup filters official subscription groups; failure/retry and search',async()=>{
  let fail=true;const {s}=targeting({any_of:[]},{getAll:async()=>{if(fail)throw {message:'failed'};return [{id:1,name:'Alpha',subscription_type:'subscription'},{id:2,name:'Other',subscription_type:'standard'}];}});
  await s.loadGroups();assert.match(s.error.value,/failed/);fail=false;await s.loadGroups();assert.equal(s.error.value,'');assert.equal(s.groups.value.length,1);
  s.groupSearch.value='Alpha';assert.equal(s.filteredGroups.value.length,1);s.groupSearch.value='none';assert.equal(s.filteredGroups.value.length,0);
});
test('A5 editing targeting is detached; difference sent and returning to all clears',async()=>{
  const calls=[];const s=announcement({put:async(...args)=>{calls.push(plain(args));return {data:{}};}});
  const original={...item,targeting:{any_of:[{all_of:[{type:'subscription',operator:'in',group_ids:[4]}]}]}};
  s.openEdit(original);s.form.value.targeting.any_of[0].all_of[0].group_ids.push(5);assert.deepEqual(original.targeting.any_of[0].all_of[0].group_ids,[4]);await s.handleSave();assert.equal(calls[0][1].targeting.any_of[0].all_of[0].group_ids.length,2);
  s.openEdit(original);s.form.value.targeting={any_of:[]};await s.handleSave();assert.deepEqual(calls[1][1],{targeting:{any_of:[]}});
  s.openEdit(original);s.targetingError.value='请选择套餐';await s.handleSave();assert.equal(calls.length,2);
});
function reads(transport) {return execute('AnnouncementReadStatus',{defineProps:()=>({announcement:{id:8,title:'Fixture'}}),annAPI:adapter('announcements',transport)});}
test('A5 read-status real adapter search, sort, page size, pagination and empty state',async()=>{
  const calls=[];const s=reads({get:async(...args)=>{calls.push(args);return {data:{items:[],total:101}};}});
  await s.load();assert.equal(calls[0][0],'/admin/announcements/8/read-status');assert.equal(calls[0][1].params.sort_by,'email');
  s.page.value=3;s.search.value=' Alice ';await s.applySearch();assert.equal(calls.at(-1)[1].params.search,'Alice');assert.equal(s.page.value,1);
  for(const sort of ['email','username','balance']) {s.sortBy.value=sort;s.sortOrder.value='desc';await s.changeSort();assert.equal(calls.at(-1)[1].params.sort_by,sort);assert.equal(calls.at(-1)[1].params.sort_order,'desc');}
  s.pageSize.value=50;await s.changePageSize();await s.changePage(2);assert.equal(calls.at(-1)[1].params.page,2);assert.equal(calls.at(-1)[1].params.page_size,50);assert.equal(s.items.value.length,0);
});
test('A5 read-status stale errors/success isolated and close cancels',async()=>{
  const a=deferred(),b=deferred();let n=0;const s=reads({get:()=>++n===1?a.promise:b.promise});
  const pa=s.load(),pb=s.applySearch();a.reject({message:'old failure'});await pa;assert.equal(s.loading.value,true);assert.equal(s.error.value,'');
  s.close();b.resolve({data:{items:[{user_id:1}],total:1}});await pb;assert.equal(s.items.value.length,0);
});
test('A5 read-status error recovery and disappearing final page',async()=>{
  let fail=true;const s=reads({get:async()=>{if(fail)throw {message:'failed'};return {data:{items:[{user_id:1,eligible:false}],total:1}};}});
  await s.load();assert.match(s.error.value,/failed/);fail=false;s.page.value=4;await s.load();assert.equal(s.page.value,1);assert.equal(s.error.value,'');assert.equal(s.items.value[0].eligible,false);
});
test('SFCs compile and native sheet/labels/responsive UI wiring present',()=>{
  for(const name of ['AnnouncementsApp','ProxiesApp','AnnouncementTargetingEditor','AnnouncementReadStatus']) {
    const source=fs.readFileSync(path.join(src,'apps/admin',name+'.vue'),'utf8');
    const compiler=req('vue/compiler-sfc');const parsed=compiler.parse(source);assert.deepEqual(parsed.errors,[]);
    const script=compiler.compileScript(parsed.descriptor,{id:name});
    const template=compiler.compileTemplate({id:name,source:parsed.descriptor.template.content,filename:name+'.vue',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  }
  const app=fs.readFileSync(path.join(src,'apps/admin/AnnouncementsApp.vue'),'utf8');assert.match(app,/v-model="form.targeting"/);assert.match(app,/@validation="targetingError = \$event"/);assert.match(app,/AnnouncementReadStatus v-if/);
  const read=fs.readFileSync(path.join(src,'apps/admin/AnnouncementReadStatus.vue'),'utf8');for(const field of ['email','username','balance','eligible','read_at'])assert.match(read,new RegExp('item\\.'+field));
  assert.match(read,/<MacSheet/);assert.match(read,/role="alert"/);assert.match(read,/@container/);
});

test('A5 validation event is synchronous and target-only changes register dirty draft',()=>{
  const {s,events}=targeting({any_of:[]},{watch:vue.watch});s.setMode('custom');
  assert.equal(events.at(-1)[0],'validation');assert.ok(events.at(-1)[1]);
  s.toggleGroup(0,0,1);assert.deepEqual(events.at(-1),['validation','']);
  const app=announcement();app.openCreate();assert.equal(app.editorDirty.value,false);
  app.form.value.targeting={any_of:[{all_of:[{type:'balance',operator:'gte',value:0}]}]};assert.equal(app.editorDirty.value,true);
  app.openEdit(item);assert.equal(app.editorDirty.value,false);app.form.value.targeting={any_of:[{all_of:[]}]};assert.equal(app.editorDirty.value,true);
});
test('A4 current request failure stays in sheet and retry clears error',async()=>{
  let failed=true;const s=execute('ProxiesApp',{proxiesAPI:{getProxyAccounts:async()=>{if(failed)throw {message:'current failure'};return [{id:5}];}}});
  await s.openAccountsModal({id:1});assert.match(s.accountsError.value,/current failure/);assert.equal(s.loadingAccounts.value,false);assert.equal(s.showAccountsModal.value,true);
  failed=false;await s.openAccountsModal({id:1});assert.equal(s.accountsError.value,'');assert.equal(s.proxyAccounts.value[0].id,5);
});
