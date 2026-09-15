const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), sfc = req('vue/compiler-sfc');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function extract(file, names) {
  const source = sfc.parse(read('packages/sub2-console/src/apps/' + file)).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.text))).map(n => n.getText(ast)).join('\n');
}
function run(file, names, extra) {
  const ctx = { ...vue, Error, ...extra };
  vm.runInNewContext(compile(extract(file, names) + '\nglobalThis.subject={' + names.join(',') + '}'), ctx);
  return ctx.subject;
}
for (const file of ['admin/AdminUsageApp.vue', 'admin/AccountsApp.vue', 'user/ActivityApp.vue', 'user/KeyChainApp.vue']) test(file + ' SFC compiles', () => {
  const { descriptor, errors } = sfc.parse(read('packages/sub2-console/src/apps/' + file));
  assert.deepEqual(errors, []);
  sfc.compileScript(descriptor, { id: 'r10', inlineTemplate: true });
});
const point = { date: '2026-09-14', input_tokens: 1, output_tokens: 2, cache_creation_tokens: 0, cache_read_tokens: 0, total_tokens: 3 };
for (const [label, data, valid] of [
  ['omitted', {}, true], ['empty', { trend: [] }, true], ['valid', { trend: [point] }, true],
  ['null response', null, false], ['array response', [], false], ['string response', 'oops', false],
  ['null field', { trend: null }, false], ['undefined field', { trend: undefined }, false],
  ['object field', { trend: {} }, false], ['missing metrics', { trend: [{ date: 'today' }] }, false],
  ['NaN metrics', { trend: [{ ...point, total_tokens: NaN }] }, false], ['null row', { trend: [null] }, false]
]) test('F2 trend ' + label, async () => {
  const ctx = { trendVersion: 0, trendLoading: vue.ref(false), trendError: vue.ref(''), trend: vue.ref([point]), disposed: false, aggregateParams: () => ({}), granularity: vue.ref('day'), getSnapshotV2: async () => data, text: e => e.message };
  const s = run('admin/AdminUsageApp.vue', ['finiteFields', 'loadTrend'], ctx);
  await s.loadTrend(); assert.equal(!ctx.trendError.value, valid); assert.equal(ctx.trendLoading.value, false);
  assert.equal(ctx.trend.value.length, valid && data.trend?.length ? 1 : 0);
});
for (const origin of ['https://console.example.invalid', 'http://localhost:5173']) for (const endpoint of ['', '  ', 'https://gateway.example.invalid/prefix/', 'https://gateway.example.invalid/prefix/v1/']) for (const tab of ['claude', 'openai', 'cursor', 'chatbox', 'curl']) test(`S4 ${origin} ${endpoint || 'empty'} ${tab}`, () => {
  const c = { publicSettings: vue.ref({ api_base_url: endpoint }), endpointLoadError: vue.ref(false), selectedKey: vue.ref({ key: 'fixture-key' }), activeClientTab: vue.ref(tab), window: { location: { origin } } };
  const s = run('user/KeyChainApp.vue', ['apiBaseUrl', 'currentSnippet'], c);
  const base = (endpoint.trim() || origin).replace(/\/+$/, '').replace(/\/v1$/, '');
  assert(s.currentSnippet.value.includes(tab === 'claude' ? base + '"' : base + '/v1'));
  assert(!s.currentSnippet.value.includes('/v1/v1')); assert(!s.currentSnippet.value.includes('127.0.0.1:8000'));
  if (tab === 'curl') assert(s.currentSnippet.value.includes(base + '/v1/chat/completions'));
});
test('S4 endpoint load failure suppresses guide and clipboard', () => {
  let copied = false;
  const s = run('user/KeyChainApp.vue', ['apiBaseUrl', 'currentSnippet', 'copyCurrentSnippet'], { endpointLoadError: vue.ref(true), publicSettings: vue.ref(null), selectedKey: vue.ref({ key: 'fixture' }), activeClientTab: vue.ref('openai'), copyToClipboard: () => { copied = true; } });
  s.copyCurrentSnippet(); assert.equal(s.currentSnippet.value, ''); assert.equal(copied, false);
  assert(read('packages/sub2-console/src/apps/user/KeyChainApp.vue').includes('<pre v-else>{{ currentSnippet }}</pre>'));
});
const row = id => ({ id, created_at: '2026-09-14', model: 'row-' + id, input_tokens: 1, actual_cost: 1, total_cost: 1 });
async function csvFixture(mode) {
  let blob, downloaded = false; const calls = [];
  const total = mode === 'partial last' ? 205 : 200;
  const original = Array.from({ length: total }, (_, i) => row(total - i));
  const ctx = { AbortController, Blob, disposed: false, exportController: null, pagination: { total }, normalizedFilters: vue.ref({}), sortState: { sort_by: 'created_at', sort_order: 'desc' }, exportError: vue.ref(''), exportProgress: { current: 0, total: 0 }, startDate: vue.ref('2026-09-14'), endDate: vue.ref('2026-09-14'),
    usageAPI: { query: async p => {
      calls.push(p.page);
      let rows = p.page === 1 || !['insert', 'same total duplicate'].includes(mode) ? original : [row(201), ...original];
      let items = rows.slice((p.page - 1) * 100, p.page * 100);
      if (mode === 'short page' && p.page === 2) items.pop();
      if (mode === 'bad ID') items[0] = row(0);
      if (mode === 'missing items') items = null;
      if (mode === 'abort') ctx.exportController?.abort();
      return { items, total: mode === 'insert' ? rows.length : total };
    } }, formatReasoningEffort: () => '', resolveUsageRequestType: () => '', getBillingModeLabel: () => '', getDisplayBillingMode: () => '', isAbortError: () => false, console: { error() {} },
    window: { URL: { createObjectURL: b => { blob = b; return 'blob:fixture'; }, revokeObjectURL() {} } }, document: { createElement: () => ({ click() { downloaded = true; } }) } };
  // Keep controller state in the same VM, as in the reviewed production-function fixture.
  const context = { ...vue, Error, ...ctx };
  // Do not mutate the shared API object when wrapping it.
  context.usageAPI = { query: mode === 'abort' ? async () => { context.exportController.abort(); return { items: original.slice(0, 100), total }; } : ctx.usageAPI.query };
  vm.runInNewContext(compile(extract('user/ActivityApp.vue', ['exporting', 'escapeCSV', 'exportToCSV']) + '\nglobalThis.run=exportToCSV'), context);
  await context.run(); return { blob, downloaded, error: ctx.exportError.value, calls };
}
for (const mode of ['insert', 'same total duplicate', 'short page', 'bad ID', 'missing items']) test('S5 refuses incomplete CSV: ' + mode, async () => {
  const f = await csvFixture(mode); assert.equal(f.downloaded, false); assert.equal(f.blob, undefined); assert(f.error);
});
for (const mode of ['stable', 'partial last']) test('S5 complete unique CSV: ' + mode, async () => {
  const f = await csvFixture(mode); assert.equal(f.downloaded, true); assert.equal(f.error, '');
  const csv = await f.blob.text(); assert.equal((csv.match(/,row-101,/g) || []).length, 1); assert(csv.includes(',row-1,'));
  assert.equal(csv.split('\n').length, mode === 'stable' ? 201 : 206);
});
test('S5 canceled response never downloads', async () => { const f = await csvFixture('abort'); assert.equal(f.downloaded, false); });

// Reuse only the Accounts fixture setup; the original suite runs in its own file.
let accountHarness = read('scripts/parity-r07-accounts.test.cjs');
accountHarness = accountHarness.slice(0, accountHarness.indexOf("test('lost create response"));
const accountContext = { require, __dirname, console, URL, setImmediate, AbortController, TextEncoder };
vm.runInNewContext(accountHarness + '\nglobalThis.make=fixture;', accountContext);
const make = accountContext.make;
const fallback = (m, u) => u.endsWith('/accounts') ? { items: [], total: 0 } : [];
test('Accounts A unknown marker survives B create/clear and A remount', async () => {
  const storage = new Map();
  const a = make((m,u) => { if (m === 'post') throw { status: 500 }; return fallback(m,u); }, storage);
  await a.prepare(); await a.s.handleSaveAccount(); assert.equal(a.calls.filter(x => x.method === 'post').length, 1); const marker = a.s.pendingCreate.value; a.dispose();
  const b = make((m,u) => m === 'post' ? { id: 99 } : fallback(m,u), storage, { user: { id: 9 }, sessionRevision: 0 });
  assert.equal(b.s.hasPendingCreate(), false); await b.prepare(); await b.s.handleSaveAccount(); assert.equal(b.calls.filter(x => x.method === 'post').length, 1); assert.equal(b.s.pendingCreate.value, ''); b.dispose();
  const restored = make(fallback, storage); assert.equal(restored.s.pendingCreate.value, marker); assert(restored.s.hasPendingCreate()); restored.dispose();
  assert(!JSON.stringify([...storage]).includes('private-fixture-only'));
});
for (const mode of ['get', 'set', 'silent set']) test('Accounts storage ' + mode + ' failure sends zero POSTs', async () => {
  const storage = new Map();
  if (mode === 'get') storage.get = () => { throw Error('denied'); };
  else storage.set = () => { if (mode === 'set') throw Error('quota'); };
  const f = make(fallback, storage); await f.prepare(); await f.s.handleSaveAccount(); assert.equal(f.calls.filter(x => x.method === 'post').length, 0); assert(f.s.createStorageError.value); f.dispose();
});
test('Accounts failed marker removal keeps review and lock', () => {
  const storage = new Map(), f = make(fallback, storage); assert(f.s.setPendingCreate('opaque'));
  storage.delete = () => { throw Error('denied'); }; assert.equal(f.s.clearPendingCreate('opaque'), false); assert.equal(f.s.pendingCreate.value, 'opaque'); assert(f.s.hasPendingCreate()); f.dispose();
});
test('Accounts token renewal preserves owner, replaced session cannot write/clear old marker', () => {
  const auth = vue.reactive({ user: { id: 8 }, token: 'A', sessionRevision: 0 }); const f = make(fallback, new Map(), auth);
  assert(f.s.setPendingCreate('old')); auth.token = 'renewed'; assert(f.s.ownsCreateSession()); auth.user = { id: 9 }; assert.equal(f.s.clearPendingCreate('old'), false); assert.equal(f.s.setPendingCreate('new'), false);
  auth.user = { id: 8 }; auth.sessionRevision++; assert.equal(f.s.setPendingCreate('new'), false); f.dispose();
});
test('Accounts missing verified owner fails closed', async () => {
  const f = make(fallback, new Map(), { user: null, sessionRevision: 0 }); await f.prepare(); await f.s.handleSaveAccount(); assert.equal(f.calls.filter(x => x.method === 'post').length, 0); assert(f.s.hasPendingCreate()); f.dispose();
});
test('Accounts missing sessionStorage blocks before POST', async () => {
  const context = { require, __dirname, console, URL, setImmediate, AbortController, TextEncoder };
  vm.runInNewContext(accountHarness.replace(/sessionStorage: \{ getItem:[^\n]+/, 'sessionStorage: undefined,') + '\nglobalThis.make=fixture;', context);
  const f = context.make(fallback); await f.prepare(); await f.s.handleSaveAccount();
  assert(f.s.createStorageError.value); assert.equal(f.calls.filter(x => x.method === 'post').length, 0); f.dispose();
});
test('Accounts late A success cannot clear B marker or publish success after owner replacement', async () => {
  let resolve; const storage = new Map(), auth = vue.reactive({ user: { id: 8 }, sessionRevision: 0 });
  const a = make((m,u) => m === 'post' ? new Promise(r => { resolve = r; }) : fallback(m,u), storage, auth);
  await a.prepare(); const pending = a.s.handleSaveAccount(); await new Promise(setImmediate);
  const oldMarker = a.s.pendingCreate.value; assert(oldMarker);
  auth.user = { id: 9 };
  const b = make(fallback, storage, auth); assert(b.s.setPendingCreate('B-pending'));
  resolve({ id: 77 }); await pending;
  assert.equal(b.s.readPendingCreate(), 'B-pending'); assert.equal(a.s.pendingCreate.value, oldMarker); assert.equal(a.s.showAddSheet.value, true);
  a.dispose(); b.dispose();
});
const legacyKey = 'sub2api:admin:account-create-pending';
function confirmLegacy(f) {
  f.s.showCreateReview.value = true;
  f.s.legacyReviewConfirmed.value = true;
  f.s.showLegacyConfirmation.value = true;
  f.s.finishLegacyReview();
}
test('legacy blocks A, reload and B; ordinary review/clear cannot remove or assign it', async () => {
  const storage = new Map([[legacyKey, 'legacy-A']]);
  for (const id of [8, 8, 9]) {
    const f = make(fallback, storage, { user: { id }, sessionRevision: 0 });
    await f.prepare(); await f.s.handleSaveAccount();
    assert(f.s.hasPendingCreate()); assert.equal(f.s.showCreateReview.value, true);
    assert.equal(f.s.pendingCreate.value, ''); assert.equal(f.s.legacyPendingCreate.value, 'legacy-A');
    f.s.reviewAbsent.value = true; f.s.finishAbsentReview();
    f.s.reviewedAccount.value = { id: 7 }; f.s.reviewAccountId.value = 7; f.s.reviewConfirmed.value = true; f.s.finishCreateReview();
    f.s.clearPendingCreate('legacy-A'); f.s.finishLegacyReview();
    assert.equal(f.calls.filter(x => x.method === 'post').length, 0);
    assert.deepEqual([...storage], [[legacyKey, 'legacy-A']]); f.dispose();
  }
});
test('legacy appearing after editor opens still blocks POST and direct marker writes', async () => {
  const storage = new Map(), f = make(fallback, storage); await f.prepare();
  storage.set(legacyKey, 'late-legacy'); await f.s.handleSaveAccount();
  assert.equal(f.calls.filter(x => x.method === 'post').length, 0); assert.equal(f.s.setPendingCreate('new'), false);
  assert.deepEqual([...storage], [[legacyKey, 'late-legacy']]); f.dispose();
});
test('legacy removal requires explicit checkbox plus confirmation; cancel/reopen resets consent', () => {
  const storage = new Map([[legacyKey, 'legacy']]), f = make(fallback, storage);
  f.s.showCreateReview.value = true;
  f.s.showLegacyConfirmation.value = true; f.s.finishLegacyReview(); assert(storage.has(legacyKey));
  f.s.legacyReviewConfirmed.value = true; f.s.showLegacyConfirmation.value = false; f.s.finishLegacyReview(); assert(storage.has(legacyKey));
  f.s.showCreateReview.value = false; f.s.showCreateReview.value = true;
  assert.equal(f.s.legacyReviewConfirmed.value, false); assert.equal(f.s.showLegacyConfirmation.value, false);
  confirmLegacy(f); assert.equal(storage.has(legacyKey), false); assert.equal(f.s.hasPendingCreate(), false);
  assert.equal(f.calls.filter(x => x.method === 'post').length, 0); f.dispose();
});
test('explicit legacy removal never clears current or other owner markers', () => {
  const aKey = legacyKey + ':owner:8', bKey = legacyKey + ':owner:9';
  const storage = new Map([[legacyKey, 'legacy'], [aKey, 'A'], [bKey, 'B']]);
  const f = make(fallback, storage, { user: { id: 9 }, sessionRevision: 0 }); confirmLegacy(f);
  assert.deepEqual([...storage], [[aKey, 'A'], [bKey, 'B']]);
  assert.equal(f.s.pendingCreate.value, 'B'); assert(f.s.hasPendingCreate()); assert(f.s.showCreateReview.value); f.dispose();
});
test('legacy replaced during review cannot be cleared with stale consent', () => {
  const storage = new Map([[legacyKey, 'old']]), f = make(fallback, storage);
  f.s.showCreateReview.value = true; f.s.legacyReviewConfirmed.value = true; f.s.showLegacyConfirmation.value = true;
  storage.set(legacyKey, 'replacement'); f.s.finishLegacyReview();
  assert.equal(storage.get(legacyKey), 'replacement'); assert.equal(f.s.legacyReviewConfirmed.value, false); assert(f.s.reviewError.value); assert(f.s.hasPendingCreate()); f.dispose();
});
for (const mode of ['throw', 'silent']) test('legacy removal storage ' + mode + ' failure stays blocked', () => {
  const storage = new Map([[legacyKey, 'legacy']]), f = make(fallback, storage);
  storage.delete = () => { if (mode === 'throw') throw Error('denied'); return false; };
  confirmLegacy(f); assert.equal(storage.get(legacyKey), 'legacy'); assert(f.s.hasPendingCreate()); assert(f.s.reviewError.value); assert(f.s.showCreateReview.value); f.dispose();
});
test('legacy consent from A cannot be used after switch to B', () => {
  const storage = new Map([[legacyKey, 'legacy']]), auth = vue.reactive({ user: { id: 8 }, sessionRevision: 0 });
  const f = make(fallback, storage, auth); f.s.showCreateReview.value = true; f.s.legacyReviewConfirmed.value = true; f.s.showLegacyConfirmation.value = true;
  auth.user = { id: 9 }; f.s.finishLegacyReview(); assert.equal(storage.get(legacyKey), 'legacy'); f.dispose();
});
test('late ordinary create success never automatically clears a newly discovered legacy marker', async () => {
  let resolve; const storage = new Map();
  const f = make((m,u) => m === 'post' ? new Promise(r => { resolve = r; }) : fallback(m,u), storage);
  await f.prepare(); const saving = f.s.handleSaveAccount(); await new Promise(setImmediate);
  storage.set(legacyKey, 'legacy'); resolve({ id: 42 }); await saving;
  assert.equal(storage.get(legacyKey), 'legacy'); assert(f.s.hasPendingCreate()); f.dispose();
});
