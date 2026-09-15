// R10 A2: actual API adapters, persistent journal, composable and SFC handlers; zero network.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { memoryStorage, memoryLocks } = require('./payment-write-fixture.cjs');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), compiler = req('vue/compiler-sfc');
const plain = v => JSON.parse(JSON.stringify(v));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const user = { id: 17, email: 'fixture@example.invalid', balance: 20 };
const sub = { id: 23, expires_at: '2035-01-01T00:00:00Z' };
function fixture(options = {}) {
  const storage = options.storage || memoryStorage(), locks = options.locks === undefined ? memoryLocks() : options.locks;
  if (!storage.getItem('auth_user')) {
    storage.setItem('auth_user', JSON.stringify({ id: 99 })); storage.setItem('auth_token','fixture-only');
  }
  const auth = vue.reactive({ user: JSON.parse(storage.getItem('auth_user')), token: storage.getItem('auth_token'), isAdmin: true, sessionRevision: 0 });
  const events = new EventTarget(), cleanup = [], scope = vue.effectScope(), modules = new Map(), calls = [];
  const window = { localStorage: storage, addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events), dispatchEvent: events.dispatchEvent.bind(events) };
  const transport = {
    get: async (...args) => { calls.push(['get', ...plain(args)]); return options.get ? options.get(...args) : { data: args[0].includes('subscriptions/') ? { ...sub } : { ...user } }; },
    post: async (...args) => { calls.push(['post', ...plain(args)]); return options.post ? options.post(...args) : { data: args[0].includes('subscriptions') ? { ...sub } : { ...user } }; }
  };
  const vueShim = { ...vue, onBeforeUnmount: fn => cleanup.push(fn), onUnmounted: fn => cleanup.push(fn), onMounted() {} };
  const globals = { window, localStorage: storage, navigator: { locks }, crypto: require('node:crypto').webcrypto,
    Event, Date, TextEncoder, console, setTimeout, clearTimeout, fetch() { throw Error('Network forbidden'); } };
  function load(file) {
    file = path.resolve(file);
    if (modules.has(file)) return modules.get(file);
    const exports = {}; modules.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file + '.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { ...globals, exports, require(name) {
      if (name === 'vue') return vueShim;
      const dest = path.resolve(path.dirname(file), name);
      if (dest === path.join(src, 'stores/auth')) return { useAuthStore: () => auth };
      if (dest === path.join(src, 'api/client')) return { apiClient: transport };
      return load(dest);
    } });
    return exports;
  }
  const api = { users: load(path.join(src,'api/admin/users')), subscriptions: load(path.join(src,'api/admin/subscriptions')) };
  const module = load(path.join(src,'utils/incrementalWriteGuard'));
  async function app(name) {
    const mounted = [];
    const file = path.join(src, 'apps/admin', name+'App.vue');
    let code = compiler.parse(fs.readFileSync(file,'utf8')).descriptor.scriptSetup.content;
    const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
    for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) code = code.slice(0,n.pos)+code.slice(n.end);
    const context = { ...globals, ...vueShim, onMounted: fn => mounted.push(fn), defineProps: () => ({}), usersAPI: api.users, subsAPI: api.subscriptions,
      groupsAPI: { getAll: async () => [] }, apiKeysAPI: {}, collectAdminPages: async () => [], adminError: (e, fallback) => e?.message || fallback };
    scope.run(() => vm.runInNewContext(ts.transpileModule(code+`\nglobalThis.subject={${names.join(',')}}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context));
    for (const fn of mounted) await fn();
    await Promise.resolve(); calls.length = 0;
    return context.subject;
  }
  function identity(id, token = `fixture-${id}`) {
    storage.setItem('auth_user',JSON.stringify({ id })); storage.setItem('auth_token',token);
    auth.user = { id }; auth.token = token; auth.sessionRevision++;
    window.dispatchEvent(new Event('storage'));
  }
  return { storage, locks, auth, api, module, calls, app, identity, scope, window,
    close() { cleanup.forEach(fn => fn()); scope.stop(); } };
}
const specs = [
  { kind:'balance', target:17, app:'Users', open:'openDeposit', submit:'submitDeposit', modal:'showDepositModal', guard:'balanceGuard', object:user,
    write:f => f.api.users.updateBalance(17,10,'add','private note'), acknowledge:'acknowledgeBalance' },
  { kind:'subscription', target:23, app:'Subscriptions', open:'openExtend', submit:'submitExtend', modal:'showExtendModal', guard:'extensionGuard', object:sub,
    write:f => f.api.subscriptions.extend(23,{ days:3 }), acknowledge:'acknowledgeExtension' }
];
async function render(name, state) {
  const filename=path.join(src,'apps/admin',name+'App.vue');
  const descriptor=compiler.parse(fs.readFileSync(filename,'utf8')).descriptor;
  const compiled=compiler.compileTemplate({source:descriptor.template.content,filename,id:'r10',compilerOptions:{expressionPlugins:['typescript']}});
  assert.deepEqual(compiled.errors,[]);
  const exports={};
  new Function('require','exports',ts.transpileModule(compiled.code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>vue,exports);
  const sheet={props:['show'],setup:(props,{slots})=>()=>props.show?vue.h('section',slots.default?.({close(){}})):null};
  const app=vue.createSSRApp({setup:()=>({...state,getAppIcon:()=>''}),render:exports.render,
    components:{MacSheet:sheet,MacAlertSheet:{render:()=>null},AdminFeedback:{render:()=>null}}});
  app.config.warnHandler=()=>{};
  return req('vue/server-renderer').renderToString(app);
}
for (const spec of specs) {
  for (const response of ['wrong-id','malformed']) test(`${spec.kind}: ${response} POST success body remains unknown and cannot be retried`,async t=>{
    const f=fixture({post:async()=>({data:response==='wrong-id'?{...spec.object,id:800}:{id:spec.target}})});t.after(f.close);
    await assert.rejects(spec.write(f));await assert.rejects(spec.write(f));
    assert.equal(f.calls.length,1);assert.ok(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target));
  });
  test(`${spec.kind}: controller initialization failure is fail-closed in both handler and rendered button`,async t=>{
    const f=fixture();t.after(f.close);
    const api=spec.kind==='balance'?f.api.users:f.api.subscriptions;
    const factory=spec.kind==='balance'?'createBalanceWriteGuard':'createExtensionWriteGuard';
    api[factory]=async()=>{throw Error('fixture initialization failure');};
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();
    assert.equal(f.calls.length,0);assert.equal(s[spec.guard].value,undefined);
    assert.match(await render(spec.app,s),/<button type="submit" disabled[^>]*>确认调整<\/button>/);
  });
  for (const status of [0,408,409,500,502,503,undefined]) test(`${spec.kind}: ${status} persists stable key across refresh; direct API retry cannot dispatch`, async t => {
    const f = fixture({ post:async () => { throw { status }; } }); t.after(f.close);
    await assert.rejects(spec.write(f));
    const marker = f.module.incrementalWriteJournal.read(99,spec.kind,spec.target);
    assert.equal(f.calls[0][3].headers['Idempotency-Key'],marker.id);
    const next=fixture({ storage:f.storage, locks:f.locks });t.after(next.close);
    await assert.rejects(spec.write(next)); assert.equal(next.calls.length,0);
    assert.equal(next.module.incrementalWriteJournal.read(99,spec.kind,spec.target).id,marker.id);
    assert.deepEqual(Object.keys(marker).sort(),['id','kind','owner','startedAt','target','version']);
    assert.ok(!JSON.stringify(marker).includes('private'));
  });
  test(`${spec.kind}: same-owner windows and detail reads cannot overlap in-flight POST`, async t => {
    const gate=deferred(), f=fixture({post:()=>gate.promise});t.after(f.close);
    const first=spec.write(f), other=fixture({ storage:f.storage, locks:f.locks });t.after(other.close);
    await assert.rejects(spec.write(other));
    await assert.rejects(other.module.incrementalWriteJournal.inspect(other.module.captureIncrementalOwner(),spec.kind,spec.target,async()=>spec.object,()=>true));
    assert.equal(other.calls.length,0); gate.resolve({data:spec.object}); await first;
    assert.equal(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target),null);
  });
  test(`${spec.kind}: modal close/reopen and list read retain protection; only successful detail + explicit ack ends operation`, async t => {
    const f=fixture({post:async()=>{throw {status:0};}});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();
    assert.equal(s[spec.modal].value,true); assert.equal(s.saving.value,false);
    await s[spec.submit]();assert.equal(f.calls.filter(c=>c[0]==='post').length,1);
    s[spec.modal].value=false;s[spec.open](spec.object);
    await s[spec.acknowledge]();assert.equal(s[spec.guard].value.pending.value,true);
    if(spec.kind==='balance') await s.loadUsers(); else await s.loadSubscriptions();
    assert.equal(s[spec.guard].value.pending.value,true);
    await s[spec.guard].value.inspect();assert.ok(s[spec.guard].value.snapshot.value);
    assert.equal(s[spec.guard].value.pending.value,true);
    await s[spec.acknowledge]();assert.equal(s[spec.modal].value,false);
    assert.equal(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target),null);
    assert.equal(f.calls.filter(c=>c[0]==='post').length,1);
  });
  test(`${spec.kind}: refreshed component restores pending but never restores previous read proof`,async t=>{
    const f=fixture({post:async()=>{throw {status:0};}});
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();await s[spec.guard].value.inspect();f.close();
    const next=fixture({storage:f.storage,locks:f.locks});t.after(next.close);
    const fresh=await next.app(spec.app);fresh[spec.open](spec.object);
    assert.equal(fresh[spec.guard].value.pending.value,true);assert.equal(fresh[spec.guard].value.canAcknowledge.value,false);
    await fresh[spec.submit]();assert.equal(next.calls.length,0);
  });
  for(const response of ['fail','wrong-id','malformed']) test(`${spec.kind}: ${response} detail cannot produce unlock proof`,async t=>{
    const f=fixture({post:async()=>{throw {status:0};},get:async()=>{
      if(response==='fail')throw {status:503};return {data:response==='wrong-id'?{...spec.object,id:800}:{id:spec.target}};
    }});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();await s[spec.guard].value.inspect();
    assert.equal(s[spec.guard].value.canAcknowledge.value,false);await s[spec.acknowledge]();
    assert.ok(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target));
  });
  test(`${spec.kind}: owner switch fences late POST and retains old owner's marker`,async t=>{
    const gate=deferred(),f=fixture({post:()=>gate.promise});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);const write=s[spec.submit]();
    while (!f.calls.some(c => c[0] === 'post')) await Promise.resolve();
    f.identity(100); gate.resolve({data:spec.object}); await write;
    assert.ok(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target));
    assert.equal(f.module.incrementalWriteJournal.read(100,spec.kind,spec.target),null);
    assert.equal(s[spec.modal].value,true);
    assert.equal(f.calls.filter(c=>c[0]==='get').length,0);
  });
  test(`${spec.kind}: late detail after close/target change/ABA cannot enable acknowledgement`,async t=>{
    const gate=deferred(),f=fixture({post:async()=>{throw {status:0};},get:()=>gate.promise});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();const read=s[spec.guard].value.inspect();
    s[spec.modal].value=false;f.identity(100);f.identity(99,'fixture-only');s[spec.open]({...spec.object,id:700});
    gate.resolve({data:spec.object});await read;
    assert.equal(s[spec.guard].value.snapshot.value,'');assert.equal(s[spec.guard].value.canAcknowledge.value,false);
    assert.ok(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target));
  });
  test(`${spec.kind}: rendered pending sheet disables mutation and exposes ack only after a valid detail read`,async t=>{
    const f=fixture({post:async()=>{throw {status:0};}});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();
    const before=await render(spec.app,s);
    assert.match(before,/读取当前结果/);assert.doesNotMatch(before,/已核对记录，结束本次操作/);
    assert.match(before,/<button type="submit" disabled[^>]*>确认调整<\/button>/);
    await s[spec.guard].value.inspect();const after=await render(spec.app,s);
    assert.match(after,/已核对记录，结束本次操作/);assert.match(after,/<button type="submit" disabled/);
  });
  test(`${spec.kind}: a failed second detail read invalidates the earlier acknowledgement`,async t=>{
    let fail=false;const f=fixture({post:async()=>{throw {status:0};},get:async()=>{if(fail)throw {status:503};return{data:spec.object};}});t.after(f.close);
    const s=await f.app(spec.app);s[spec.open](spec.object);await s[spec.submit]();await s[spec.guard].value.inspect();
    assert.equal(s[spec.guard].value.canAcknowledge.value,true);fail=true;await s[spec.guard].value.inspect();
    assert.equal(s[spec.guard].value.canAcknowledge.value,false);await s[spec.acknowledge]();
    assert.ok(f.module.incrementalWriteJournal.read(99,spec.kind,spec.target));
  });
  test(`${spec.kind}: changing owner before lazy import finishes sends no request under the new owner`,async t=>{
    const f=fixture();t.after(f.close);const write=spec.write(f);f.identity(100);
    await assert.rejects(write);assert.equal(f.calls.length,0);
  });
  test(`${spec.kind}: changing owner locks an already open old-owner form until reopened`,async t=>{
    const f=fixture();t.after(f.close);const s=await f.app(spec.app);s[spec.open](spec.object);f.identity(100);
    await s[spec.submit]();assert.equal(f.calls.length,0);assert.equal(s[spec.guard].value.blocked.value,true);
  });
}
for(const mode of ['read','write','readback','locks','malformed'])test(`${mode} storage/coordination fault prevents POST`,async t=>{
  const f=fixture({locks:mode==='locks'?null:undefined});t.after(f.close);
  if(mode==='write')f.storage.setItem=()=>{throw Error('quota');};
  if(mode==='readback')f.storage.setItem=()=>{};
  if(mode==='read'){const original=f.storage.getItem;f.storage.getItem=key=>{if(key.startsWith(f.module.INCREMENTAL_WRITE_PREFIX))throw Error('denied');return original(key);};}
  if(mode==='malformed')f.storage.setItem(f.module.INCREMENTAL_WRITE_PREFIX+'99:balance:17','{broken');
  await assert.rejects(specs[0].write(f));assert.equal(f.calls.length,0);
});
for(const status of [400,401,403,404,422,429])test(`definite ${status} refusal releases only current marker`,async t=>{
  const f=fixture({post:async()=>{throw {status};}});t.after(f.close);
  await assert.rejects(specs[0].write(f));assert.equal(f.module.incrementalWriteJournal.read(99,'balance',17),null);
});
test('owner-isolated scopes allow independent operators and never clear other owner markers',async t=>{
  const f=fixture({post:async()=>{throw {status:0};}});t.after(f.close);
  await assert.rejects(specs[0].write(f));f.identity(100);await assert.rejects(specs[0].write(f));
  const j=f.module.incrementalWriteJournal,c=f.module.captureIncrementalOwner();
  const r=await j.inspect(c,'balance',17,async()=>user,()=>true);await j.acknowledge(c,r.proof);
  assert.ok(j.read(99,'balance',17));assert.equal(j.read(100,'balance',17),null);
});
test('proof forgery, replacement marker and failed removal never report successful unlock',async t=>{
  const f=fixture({post:async()=>{throw {status:0};}});t.after(f.close);await assert.rejects(specs[0].write(f));
  const j=f.module.incrementalWriteJournal,c=f.module.captureIncrementalOwner();
  await assert.rejects(j.acknowledge(c,{}));
  const r=await j.inspect(c,'balance',17,async()=>user,()=>true);
  const m=j.read(99,'balance',17),key=f.module.INCREMENTAL_WRITE_PREFIX+'99:balance:17';
  f.storage.setItem(key,JSON.stringify({...m,id:'replacement-operation'}));await assert.rejects(j.acknowledge(c,r.proof));
  const r2=await j.inspect(c,'balance',17,async()=>user,()=>true);
  f.storage.removeItem=()=>{};await assert.rejects(j.acknowledge(c,r2.proof));assert.ok(j.read(99,'balance',17));
});
test('normal token refresh keeps the original Idempotency-Key and owner session valid',async t=>{
  const f=fixture({post:async()=>{
    const file=path.join(src,'api/authTokenLineage.ts'); const exports={};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,localStorage:f.storage,TextEncoder});
    exports.publishTokenRotation(99,'fixture-only','old-refresh','new-access','new-refresh');
    f.storage.setItem('auth_token','new-access');f.storage.setItem('refresh_token','new-refresh');
    return {data:user};
  }});t.after(f.close);f.storage.setItem('refresh_token','old-refresh');
  await specs[0].write(f);assert.equal(f.calls.length,1);assert.ok(f.calls[0][3].headers['Idempotency-Key']);
  assert.equal(f.module.incrementalWriteJournal.read(99,'balance',17),null);
});
test('existing positional args/defaults and signed days reach official payload unchanged',async t=>{
  const f=fixture();t.after(f.close);
  for(const operation of ['set','add','subtract'])await f.api.users.updateBalance(17,12.5,operation,'note');
  await f.api.users.updateBalance(17,0); await f.api.subscriptions.extend(23,{days:-3});
  assert.deepEqual(f.calls.map(c=>c[2]),[
    {balance:12.5,operation:'set',notes:'note'},{balance:12.5,operation:'add',notes:'note'},
    {balance:12.5,operation:'subtract',notes:'note'},{balance:0,operation:'set',notes:''},{days:-3}
  ]);
  assert.equal(new Set(f.calls.map(c=>c[3].headers['Idempotency-Key'])).size,5);
});
test('both SFC scripts/templates compile and recovery uses disabled controls and explicit acknowledgement',()=>{
  for(const name of ['Users','Subscriptions']){
    const filename=path.join(src,'apps/admin',name+'App.vue'),parsed=compiler.parse(fs.readFileSync(filename,'utf8'),{filename});
    assert.deepEqual(parsed.errors,[]);assert.ok(compiler.compileScript(parsed.descriptor,{id:'r10'}).content);
    const result=compiler.compileTemplate({source:parsed.descriptor.template.content,filename,id:'r10',compilerOptions:{expressionPlugins:['typescript']}});
    assert.deepEqual(result.errors,[]);assert.match(parsed.descriptor.template.content,/已核对记录，结束本次操作/);
    assert.doesNotMatch(parsed.descriptor.scriptSetup.content,/if\s*\(typeof (usersAPI|subsAPI)\.create\w+WriteGuard|create\w+WriteGuard\?\./);
    assert.match(parsed.descriptor.template.content,/type="submit" :disabled="saving \|\| !(balanceGuard|extensionGuard) \|\| (balanceGuard|extensionGuard)\.blocked.value"/);
  }
});
