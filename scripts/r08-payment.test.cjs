// R08: production journal, composable and SFC handlers; never sends network traffic.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { protection, memoryStorage, memoryLocks } = require('./payment-write-fixture.cjs');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const vue = req('vue'), ts = req('typescript'), sfc = req('vue/compiler-sfc');
const plain = value => JSON.parse(JSON.stringify(value));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(file, api = {}, shared = {}) {
  const auth = vue.reactive({ user: { id: 99 }, token: 'fixture-only', isAdmin: true, sessionRevision: 0 });
  const p = protection(shared), scope = vue.effectScope(), unmount = [], stops = [];
  let code = sfc.parse(fs.readFileSync(path.join(src, file), 'utf8')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) code = code.slice(0, n.pos) + code.slice(n.end);
  const provider = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(src, 'apps/user/settings/paymentProviderForm.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: provider, URL });
  const context = { ...vue, ...provider, useAuthStore: () => auth, usePaymentWriteGuard: p.usePaymentWriteGuard,
    defineProps: () => ({}), onMounted() {}, onBeforeUnmount: fn => unmount.push(fn), onUnmounted: fn => unmount.push(fn),
    watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); return stop; },
    adminPaymentAPI: { getOrders: async () => ({ data: { items: [], total: 0 } }), getProviders: async () => ({ data: [sample()] }), ...api },
    adminError: (error, fallback) => error?.message || fallback, console, location: { origin: 'https://fixture.invalid' }, URL, setTimeout() {}, clearTimeout() {}, fetch: () => { throw Error('Network forbidden'); } };
  scope.run(() => vm.runInNewContext(ts.transpileModule(code + `\nglobalThis.subject={${names.join(',')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context));
  return { s: context.subject, auth, p, close() { p.close(); unmount.forEach(fn => fn()); scope.stop(); stops.forEach(fn => fn()); } };
}
const panel = (api, shared) => fixture('apps/user/settings/PaymentProvidersPanel.vue', api, shared);
const commerce = (api, shared) => fixture('apps/admin/CommerceApp.vue', api, shared);
const sample = (id = 1) => ({ id, name: `Provider ${id}`, provider_key: 'stripe', config: { publishableKey: 'pk_fixture', currency: 'CNY' }, supported_types: ['card'], enabled: true, refund_enabled: false, allow_user_refund: false, payment_mode: '', limits: '', sort_order: id - 1 });
const order = (status = 'COMPLETED') => ({ id: 42, status, amount: 100, pay_amount: 720, refund_amount: 0, order_type: 'balance' });
const alive = () => ({ owner: 99, current: () => true });
async function leaveUnknown(p, scope = 'providers', action = 'provider-update') {
  return p.paymentWriteJournal.run(alive(), scope, action, [42], async () => { throw { status: 0 }; }, () => false);
}

test('journal and composable TypeScript sources parse cleanly; full strict typing is a separate gate', () => {
  for (const file of ['paymentWriteJournal.ts', 'usePaymentWriteGuard.ts', 'paymentWriteCoordination.ts']) {
    const result = ts.transpileModule(fs.readFileSync(path.join(src, 'utils', file), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true
    });
    assert.deepEqual((result.diagnostics || []).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
  }
});
for (const status of [0, 408, 500, 502, 503, undefined]) test(`status ${status}: unknown survives journal recreation and blocks dispatch`, async () => {
  const p = protection(); let calls = 0;
  await p.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => { calls++; throw { status, message: 'SECRET' }; }, () => true);
  const next = protection({ storage: p.storage, locks: p.locks });
  assert.equal((await next.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => { calls++; }, () => true)).kind, 'blocked');
  assert.equal(calls, 1); assert.equal(next.paymentWriteJournal.list(99).length, 1); p.close(); next.close();
});
for (const status of [400, 401, 403, 409, 422, 429]) test(`status ${status}: explicit refusal clears only this operation`, async () => {
  const p = protection(); await leaveUnknown(p, 'refund:42', 'refund');
  const result = await p.paymentWriteJournal.run(alive(), 'providers', 'provider-delete', [1], async () => { throw { status }; }, () => true);
  assert.equal(result.kind, 'rejected'); assert.equal(p.paymentWriteJournal.read(99, 'providers'), null); assert.ok(p.paymentWriteJournal.read(99, 'refund:42')); p.close();
});
test('marker precedes API, schema includes no secrets, write body, names, reasons or credential hashes', async () => {
  const p = protection(); let observed;
  const result = await p.paymentWriteJournal.run(alive(), 'providers', 'provider-update', [7], async () => {
    observed = p.paymentWriteJournal.read(99, 'providers'); return { config: { key: 'SUPER-SECRET' }, name: 'PRIVATE-NAME' };
  }, () => false);
  assert.equal(result.kind, 'unknown'); assert.deepEqual(Object.keys(observed).sort(), ['action', 'id', 'owner', 'scope', 'startedAt', 'targets', 'version']);
  assert.ok(!JSON.stringify(p.paymentWriteJournal.list(99)).includes('SECRET')); p.close();
});
test('blocked/quota/readback storage or missing Web Locks never invokes API', async () => {
  for (const mode of ['set', 'readback', 'read', 'locks']) {
    const storage = memoryStorage(), p = protection({ storage, locks: mode === 'locks' ? null : memoryLocks() });
    let calls = 0; const get = storage.getItem;
    if (mode === 'set') storage.setItem = () => { throw Error('QuotaExceededError'); };
    if (mode === 'readback') storage.setItem = () => {};
    if (mode === 'read') storage.getItem = key => { if (key.startsWith(p.PAYMENT_WRITE_PREFIX)) throw Error('SecurityError'); return get(key); };
    const result = await p.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => { calls++; }, () => true);
    assert.equal(result.kind, 'blocked', mode); assert.equal(calls, 0); p.close();
  }
});
test('simultaneous same-owner windows and manual unlock cannot overlap an in-flight request', async () => {
  const a = protection(), b = protection({ storage: a.storage, locks: a.locks }), gate = defer(); let calls = 0;
  const first = a.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => { calls++; return gate.promise; }, () => true);
  assert.equal((await b.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => { calls++; }, () => true)).kind, 'blocked');
  assert.equal((await b.paymentWriteJournal.resolve(alive(), a.paymentWriteJournal.read(99, 'providers'))).kind, 'blocked');
  gate.resolve({}); await first; assert.equal(calls, 1); assert.equal(a.paymentWriteJournal.list(99).length, 0); a.close(); b.close();
});
test('late old-owner success and ABA session changes leave the old marker and no new-owner mutation', async () => {
  const p = protection(), auth = vue.reactive({ id: 99, token: 'fixture-only', revision: 0 }), scope = vue.effectScope();
  const guard = scope.run(() => p.usePaymentWriteGuard(() => auth.id, () => auth.token, () => auth.revision));
  const gate = defer(), context = guard.capture();
  const run = p.paymentWriteJournal.run(context, 'providers', 'provider-update', [1], () => gate.promise, () => true);
  p.setIdentity(100, 'other'); auth.id = 100; auth.token = 'other'; auth.revision++;
  p.setIdentity(99); auth.id = 99; auth.token = 'fixture-only'; auth.revision++;
  gate.resolve({}); assert.equal((await run).kind, 'stale'); assert.equal(p.paymentWriteJournal.list(99).length, 1); assert.equal(p.paymentWriteJournal.list(100).length, 0);
  p.close(); scope.stop();
});
test('old marker confirmation cannot delete a newly recorded operation', async () => {
  const p = protection(); await leaveUnknown(p); const old = p.paymentWriteJournal.read(99, 'providers');
  await p.paymentWriteJournal.resolve(alive(), old); await leaveUnknown(p);
  const next = p.paymentWriteJournal.read(99, 'providers'); assert.notEqual(next.id, old.id);
  assert.equal((await p.paymentWriteJournal.resolve(alive(), old)).kind, 'blocked'); assert.equal(p.paymentWriteJournal.read(99, 'providers').id, next.id); p.close();
});
test('malformed marker fails closed and removal storage failure cannot report unlocked', async () => {
  const p = protection(); await leaveUnknown(p); const marker = p.paymentWriteJournal.read(99, 'providers');
  p.storage.removeItem = () => { throw Error('storage denied'); };
  assert.equal((await p.paymentWriteJournal.resolve(alive(), marker)).kind, 'blocked');
  p.storage.setItem(p.PAYMENT_WRITE_PREFIX + '99:providers', '{broken'); let calls = 0;
  assert.equal((await p.paymentWriteJournal.run(alive(), 'providers', 'provider-create', [], async () => calls++, () => true)).kind, 'blocked');
  assert.equal(calls, 0); p.close();
});
test('storage events and same-page events synchronize guards without switching owner data', async () => {
  const a = protection(), b = protection({ storage: a.storage, locks: a.locks }), scope = vue.effectScope();
  const one = scope.run(() => a.usePaymentWriteGuard(() => 99, () => 'fixture-only', () => 1));
  const two = scope.run(() => b.usePaymentWriteGuard(() => 99, () => 'fixture-only', () => 1));
  await leaveUnknown(a); assert.equal(one.entries.value.length, 1); b.event(a.PAYMENT_WRITE_PREFIX + '99:providers'); assert.equal(two.entries.value.length, 1);
  await a.paymentWriteJournal.resolve(alive(), one.entries.value[0]); b.event(a.PAYMENT_WRITE_PREFIX + '99:providers'); assert.equal(two.entries.value.length, 0);
  b.setIdentity(100, 'other'); b.event('auth_user'); assert.equal(two.available.value, false); assert.equal(two.capture().current(), false); a.close(); b.close(); scope.stop();
});
test('a rejected query cannot release the original unknown refund; definitive success can', async () => {
  const p = protection(); await leaveUnknown(p, 'refund:42', 'refund'); const marker = p.paymentWriteJournal.read(99, 'refund:42');
  const failed = await p.paymentWriteJournal.run(alive(), marker.scope, 'refund-query', [42], async () => { throw { status: 400 }; }, () => false, { resume: marker });
  assert.equal(failed.kind, 'unknown'); assert.equal(p.paymentWriteJournal.read(99, marker.scope).id, marker.id);
  const success = await p.paymentWriteJournal.run(alive(), marker.scope, 'refund-query', [42], async () => true, value => value, { resume: marker });
  assert.equal(success.kind, 'confirmed'); assert.equal(p.paymentWriteJournal.read(99, marker.scope), null); p.close();
});

test('refund unknown survives close/reopen/list read, and manual review enables only a new deliberate submit', async t => {
  let calls = 0; const a = commerce({ refundOrder: async () => { calls++; throw { status: 408 }; } });
  a.s.openRefundModal(order()); await a.s.handleConfirmRefund(); a.close();
  const b = commerce({ refundOrder: async () => { calls++; return { data: { success: true } }; } }, { storage: a.p.storage, locks: a.p.locks }); t.after(b.close);
  await b.s.loadOrders(); b.s.openRefundModal(order()); await b.s.handleConfirmRefund(); assert.equal(calls, 1); assert.equal(b.s.refundNeedsReview.value, true);
  b.s.askReviewRefund(b.s.pendingRefunds.value[0]); await b.s.confirmReviewRefund(); assert.equal(calls, 1); assert.equal(b.s.pendingRefunds.value.length, 0);
  b.s.openRefundModal(order()); await b.s.handleConfirmRefund(); assert.equal(calls, 2);
});
test('refund force warning is known refusal; second POST still requires checkbox and a fresh persisted lock', async t => {
  const seen = []; const f = commerce({ refundOrder: async (_, body) => { seen.push({ body: plain(body), marker: plain(f.p.paymentWriteJournal.read(99, 'refund:42')) }); return { data: body.force ? { success: true } : { success: false, require_force: true, warning: '余额不足' } }; } }); t.after(f.close);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund(); assert.equal(f.s.pendingRefunds.value.length, 0);
  await f.s.handleConfirmRefund(); assert.equal(seen.length, 1);
  f.s.refundForceConfirmed.value = true; await f.s.handleConfirmRefund(); assert.equal(seen.length, 2); assert.notEqual(seen[0].marker.id, seen[1].marker.id);
});
test('pending refund list reads never unlock, query success is a definitive resolution', async t => {
  const f = commerce({ refundOrder: async () => ({ data: { success: false, warning: 'gateway refund pending confirmation' } }), queryRefund: async () => ({ data: { success: true } }) }); t.after(f.close);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund(); await f.s.loadOrders(); assert.equal(f.s.pendingRefunds.value.length, 1);
  await f.s.handleQueryRefund(order('REFUND_PENDING')); assert.equal(f.s.pendingRefunds.value.length, 0);
});
for (const op of ['create', 'update', 'delete', 'sort']) test(`provider ${op}: unknown marker survives component replacement and every list read`, async t => {
  let calls = 0;
  const api = { getProviders: async () => ({ data: [sample(), sample(2)] }), createProvider: async () => { calls++; throw { status: 503 }; }, updateProvider: async () => { calls++; throw { status: 503 }; }, deleteProvider: async () => { calls++; throw { status: 503 }; } };
  const a = panel(api); await a.s.load();
  if (op === 'delete') { a.s.askDelete(a.s.providers.value[0]); await a.s.remove(); }
  else if (op === 'sort') await a.s.move(a.s.providers.value[1], -1);
  else { a.s.open(op === 'update' ? a.s.providers.value[0] : undefined); a.s.draft.value.name = 'Changed'; a.s.draft.value.enabled = false; await a.s.save(); }
  assert.equal(calls, 1); a.close();
  const b = panel(api, { storage: a.p.storage, locks: a.p.locks }); t.after(b.close); await b.s.load(); await b.s.load();
  b.s.open(); b.s.askDelete(b.s.providers.value[0]); await b.s.remove(); await b.s.move(b.s.providers.value[1], -1);
  assert.equal(calls, 1); assert.equal(b.s.writable.value, false); assert.ok(b.s.pendingWrite.value);
  b.s.askReviewWrite(); await b.s.confirmReviewWrite(); assert.equal(calls, 1); assert.equal(b.s.writable.value, true);
});
test('provider secrets are never persisted even if replacement write is ambiguous', async t => {
  const f = panel({ updateProvider: async () => { throw { status: 502, message: 'PRIVATE-RESPONSE' }; } }); t.after(f.close);
  await f.s.load(); f.s.open(f.s.providers.value[0]); f.s.draft.value.config.secretKey = 'NEVER-PERSIST'; f.s.draft.value.name = 'PRIVATE-NAME'; await f.s.save();
  const saved = [...f.p.storage.values.entries()].filter(([key]) => key.startsWith(f.p.PAYMENT_WRITE_PREFIX)).map(([,value]) => value).join('');
  for (const text of ['NEVER-PERSIST', 'PRIVATE-NAME', 'PRIVATE-RESPONSE', 'config', 'secretKey']) assert.ok(!saved.includes(text), text);
  assert.ok(!f.s.error.value.includes('PRIVATE-RESPONSE'));
});
test('provider partial sort + 400 stays protected, while first-step 400 is clear refusal', async t => {
  let steps = 0; const f = panel({ getProviders: async () => ({ data: [sample(), sample(2)] }), updateProvider: async () => { if (++steps === 2) throw { status: 400 }; return { data: { id: 2 } }; } }); t.after(f.close);
  await f.s.load(); await f.s.move(f.s.providers.value[1], -1); assert.ok(f.s.pendingWrite.value); await f.s.load(); assert.equal(f.s.writable.value, false);
  const no = panel({ getProviders: async () => ({ data: [sample(), sample(2)] }), updateProvider: async () => { throw { status: 400 }; } }); t.after(no.close);
  await no.s.load(); await no.s.move(no.s.providers.value[1], -1); assert.equal(no.s.pendingWrite.value, undefined); assert.equal(no.s.writable.value, true);
});
test('storage stops working at click time: neither provider nor refund dispatches or stays busy', async t => {
  let calls = 0; const p = panel({ updateProvider: async () => calls++ }); t.after(p.close);
  await p.s.load(); p.s.open(p.s.providers.value[0]); p.s.draft.value.name = 'Changed'; p.p.storage.getItem = () => { throw Error('Storage denied'); };
  await p.s.save(); assert.equal(calls, 0); assert.equal(p.s.saving.value, false);
  const f = commerce({ refundOrder: async () => calls++ }); t.after(f.close); f.s.openRefundModal(order()); f.p.storage.getItem = () => { throw Error('Storage denied'); };
  await f.s.handleConfirmRefund(); assert.equal(calls, 0); assert.equal(f.s.isProcessingOrder.value, false);
});
test('late provider success after A to B cannot clear A marker, replace B rows or close B editor', async t => {
  const gate = defer(); const f = panel({ updateProvider: () => gate.promise }); t.after(f.close);
  await f.s.load(); f.s.open(f.s.providers.value[0]); f.s.draft.value.name = 'A edit'; const pending = f.s.save();
  f.p.setIdentity(100, 'B-token'); f.auth.user = { id: 100 }; f.auth.token = 'B-token'; f.auth.sessionRevision++;
  gate.resolve({ data: { id: 1 } }); await pending;
  assert.equal(f.p.paymentWriteJournal.list(99).length, 1); assert.equal(f.p.paymentWriteJournal.list(100).length, 0); assert.equal(f.s.notice.value, ''); assert.equal(f.s.draft.value, null);
});
test('late refund result after owner change cannot show success or remove the old lock', async t => {
  const gate = defer(); const f = commerce({ refundOrder: () => gate.promise }); t.after(f.close);
  f.s.openRefundModal(order()); const pending = f.s.handleConfirmRefund(); f.p.setIdentity(100, 'B-token'); f.auth.user = { id: 100 }; f.auth.token = 'B-token'; f.auth.sessionRevision++;
  gate.resolve({ data: { success: true } }); await pending;
  assert.equal(f.s.toastMsg.value, null); assert.equal(f.s.showRefundModal.value, false); assert.equal(f.p.paymentWriteJournal.list(99).length, 1); assert.equal(f.s.pendingRefunds.value.length, 0);
});
