const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), compiler = req('vue/compiler-sfc');
const tick = () => new Promise(r => setImmediate(r));
function fixture(handler, storage = new Map(), auth = vue.reactive({ user: { id: 8 }, sessionRevision: 0 })) {
  const calls = [], cache = new Map(), scope = vue.effectScope(), cleanups = [];
  const client = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, data, config) => {
    calls.push({ method, url, data, config });
    return { data: await handler(method, url, data, config) };
  }]));
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file);
    const module = { exports: {} };
    const isVue = file.endsWith('.vue');
    let code = fs.readFileSync(file, 'utf8');
    if (isVue) {
      const { descriptor } = compiler.parse(code);
      assert.doesNotThrow(() => compiler.compileScript(descriptor, { id: 'r07-accounts', inlineTemplate: true }));
      code = descriptor.scriptSetup.content;
      const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
      const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
      code += '\nmodule.exports = {' + names.join(',') + '};';
    }
    const sandbox = {
      module, exports: module.exports, console, URL, Date, Error, AbortController, TextEncoder,
      sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
      crypto: require('node:crypto').webcrypto,
      setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
      document: { hidden: false, addEventListener() {}, removeEventListener() {} },
      defineProps: () => ({}), defineEmits: () => () => {}, defineOptions() {},
      require(spec) {
        if (spec === '@/stores/auth') return { useAuthStore: () => auth };
        if (spec === 'vue') return { ...vue, onMounted() {}, onUnmounted: f => cleanups.push(f) };
        if (spec === '@sub2-mac/core' || spec.endsWith('.vue')) return {};
        let target = spec.startsWith('@/') ? path.join(src, spec.slice(2)) : path.resolve(path.dirname(file), spec);
        if (target === path.join(src, 'api/client')) return { apiClient: client };
        return load(target + (path.extname(target) ? '' : '.ts'));
      },
    };
    scope.run(() => vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, sandbox, { filename: file }));
    cache.set(file, module.exports);
    return module.exports;
  }
  const s = load(path.join(src, 'apps/admin/AccountsApp.vue'));
  async function prepare(type = 'apikey', platform = 'openai') {
    s.openAddSheet(); s.accountForm.value.platform = platform; s.accountForm.value.type = type;
    await tick(); s.accountForm.value.name = 'local fixture'; s.accountForm.value.credentials = 'private-fixture-only';
  }
  return { s, calls, storage, prepare, dispose() { cleanups.forEach(f => f()); scope.stop(); } };
}
const fallback = (method,url) => url.endsWith('/accounts') ? { items: [], total: 0 } : [];
test('lost create response locks repeat click, close/reopen and reload without persisting secrets', async () => {
  const f = fixture((m,u) => { if (m==='post' && u==='/admin/accounts') throw { status:0,message:'secret-fixture' }; return fallback(m,u); });
  await f.prepare(); await f.s.handleSaveAccount(); await f.s.handleSaveAccount();
  assert.equal(f.calls.filter(c=>c.method==='post').length,1);
  assert(f.s.pendingCreate.value); assert(!f.s.formError.value.includes('secret-fixture'));
  const write=f.calls.find(c=>c.method==='post'); assert.match(write.config.headers['Idempotency-Key'],/^account-create-/);
  f.s.showAddSheet.value=false; f.s.openAddSheet(); assert.equal(f.s.showCreateReview.value,true);
  assert(!JSON.stringify([...f.storage]).includes('private-fixture-only'));
  const restored=fixture(fallback,f.storage); restored.s.openAddSheet(); assert.equal(restored.s.showCreateReview.value,true);
  assert.equal(restored.s.showAddSheet.value,false); restored.dispose(); f.dispose();
});
test('definitive rejection permits corrected new request, server warning needs explicit confirmation', async () => {
  let posts=0;
  const f=fixture((m,u)=>{if(m==='post'&&u==='/admin/accounts'){if(++posts===1)throw {status:422};return {id:9};}return fallback(m,u)});
  await f.prepare();await f.s.handleSaveAccount();assert.equal(f.s.pendingCreate.value,'');
  f.s.accountForm.value.name='corrected';await f.s.handleSaveAccount();assert.equal(posts,2);assert.equal(f.s.showAddSheet.value,false);f.dispose();
  let risks=0;
  const r=fixture((m,u)=>{if(m==='post'&&u==='/admin/accounts'){if(++risks===1)throw {status:409,error:'mixed_channel_warning'};return {id:10};}return fallback(m,u)});
  await r.prepare();const saving=r.s.handleSaveAccount();await tick();assert(r.s.mixedRisk.value);assert.equal(risks,1);
  r.s.resolveMixedRisk(true);await saving;assert.equal(risks,2);
  const writes=r.calls.filter(c=>c.method==='post');assert.equal(writes[1].data.confirm_mixed_channel_risk,true);
  assert.notEqual(writes[0].config.headers['Idempotency-Key'],writes[1].config.headers['Idempotency-Key']);r.dispose();
});
for(const error of [{status:408},{status:409},{status:500}])test(`ambiguous HTTP ${error.status} keeps creation fenced`,async()=>{
  const f=fixture((m,u)=>{if(m==='post')throw error;return fallback(m,u)});await f.prepare();await f.s.handleSaveAccount();await f.s.handleSaveAccount();assert.equal(f.calls.filter(c=>c.method==='post').length,1);assert(f.s.pendingCreate.value);f.dispose();
});
test('review requires reading matching id plus confirmation, and never resubmits the old draft',async()=>{
  const f=fixture((m,u)=>u==='/admin/accounts/7'?{id:7,name:'verified',platform:'openai',type:'apikey',credentials:{api_key:'never-render'}}:fallback(m,u));
  f.s.setPendingCreate('pending');f.s.showCreateReview.value=true;await tick();f.s.finishCreateReview();assert(f.s.pendingCreate.value);
  f.s.reviewAccountId.value=7;await tick();await f.s.readCreatedAccount();assert(!JSON.stringify(f.s.reviewedAccount.value).includes('never-render'));
  f.s.finishCreateReview();assert(f.s.pendingCreate.value);f.s.reviewConfirmed.value=true;f.s.finishCreateReview();assert.equal(f.s.pendingCreate.value,'');assert.equal(f.calls.filter(c=>c.method==='post').length,0);f.dispose();
});
for(const platform of ['openai','anthropic'])test(`${platform} pure batch reaches settings without single OAuth, snapshot retains group and scheduling`,async()=>{
  const f=fixture(fallback);await f.prepare('oauth',platform);f.s.creationMode.value='batch';f.s.editorStep.value=1;
  assert.deepEqual([...f.s.missingRequired.value],[]);await f.s.moveEditor(2);assert.equal(f.s.editorStep.value,2);
  f.s.accountForm.value.concurrency=6;f.s.accountForm.value.priority=2;
  if(platform==='openai')f.s.accountForm.value.groups=[3];
  await f.s.handleSaveAccount();assert.equal(f.s.batchAuthorization.value.concurrency,6);assert.equal(f.s.batchAuthorization.value.priority,2);
  if(platform==='openai')assert.deepEqual([...f.s.batchAuthorization.value.group_ids],[3]);
  assert.equal(f.calls.filter(c=>c.method==='post').length,0);
  f.s.creationMode.value='single';assert(f.s.missingRequired.value.includes('完成平台授权'));f.dispose();
});
