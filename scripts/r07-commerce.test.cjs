// R07 commerce counterexamples: execute production SFC scripts and API adapters with no network.
// node --test scripts/r07-commerce.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), compiler = req('vue/compiler-sfc');
const { renderToString } = req('vue/server-renderer');
const { protection } = require('./payment-write-fixture.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const denied = () => { throw Error('Network forbidden in commerce fixture'); };
function adapter(file, apiClient) {
  const code = ts.transpileModule(fs.readFileSync(path.join(src, 'api/admin', file + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => { assert.equal(name, '../client'); return { apiClient }; }, exports);
  return exports;
}
function execute(file, extras = {}) {
  const filename = path.join(src, 'apps/admin', file);
  const descriptor = compiler.parse(fs.readFileSync(filename, 'utf8'), { filename }).descriptor;
  let code = descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n)
    ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text)
    : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) code = code.slice(0, n.pos) + code.slice(n.end);
  const scope = vue.effectScope(), mounted = [], unmounted = [];
  const guard = protection();
  const context = { ...vue, console, exports: {}, URL, Date, setTimeout: () => 1, clearTimeout() {},
    defineProps: () => ({}), onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), fetch: denied, getAppIcon: () => '',
    onBeforeUnmount() {}, useAuthStore: () => vue.reactive({ user: { id: 99 }, token: 'fixture-only', isAdmin: true }),
    usePaymentWriteGuard: guard.usePaymentWriteGuard,
    adminError: (error, fallback) => error?.message || error?.response?.data?.detail || fallback, ...extras };
  scope.run(() => vm.runInNewContext(ts.transpileModule(code + `\nglobalThis.subject = {${names.join(',')}}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context));
  return { s: context.subject, descriptor, filename, mount: async () => { for (const fn of mounted) await fn(); }, dispose: () => { unmounted.forEach(fn => fn()); guard.close(); scope.stop(); } };
}
function commerce(api = {}, extra = {}) {
  const calls = [];
  const transport = {
    get: async url => { calls.push(['get', url]); return { data: url.endsWith('/plans') ? [] : { items: [], total: 0 } }; },
    post: async (url, data) => { calls.push(['post', url, plain(data || {})]); return { data: { success: true } }; },
    put: async (url, data) => { calls.push(['put', url, plain(data)]); return { data }; },
    delete: denied
  };
  const f = execute('CommerceApp.vue', {
    adminPaymentAPI: { ...adapter('payment', transport).adminPaymentAPI, ...api },
    redeemAdminAPI: adapter('redeem', transport),
    groupsAdminAPI: { getAll: async () => [{ id: 73, name: '订阅组', subscription_type: 'subscription' }, { id: 9, name: '普通组', subscription_type: 'standard' }] },
    ...extra
  });
  return { ...f, calls };
}
async function subscription(api = {}) {
  const calls = [];
  // This suite tests signed DTOs/form validation. R10 executes the real persistence controller.
  const readyGuard = { blocked: vue.ref(false), pending: vue.ref(false), error: vue.ref(''), busy: vue.ref(false),
    snapshot: vue.ref(''), canAcknowledge: vue.ref(false), reset() {}, dispose() {}, capture: () => ({ current: () => true }),
    inspect: denied, acknowledge: denied };
  const f = execute('SubscriptionsApp.vue', { subsAPI: {
    createExtensionWriteGuard: async () => readyGuard,
    extend: async (...args) => { calls.push(plain(args)); }, list: async () => ({ items: [], total: 0 }), ...api
  }, groupsAPI: { getAll: async () => [] }, usersAPI: { list: async () => ({ items: [], total: 0 }) }, collectAdminPages: async () => [] });
  await f.mount();
  return { ...f, calls };
}
const order = (status = 'COMPLETED', extra = {}) => ({ id: 42, user_id: 7, status, amount: 100,
  pay_amount: 720, refund_amount: 0, order_type: 'balance', currency: 'CNY', ...extra });
const plan = (features = 'A\nB') => ({ id: 3, group_id: 73, name: '套餐', price: 10, features, validity_days: 30 });
const sub = days => ({ id: 19, expires_at: new Date(Date.now() + days * 86400000).toISOString() });
async function html(f) {
  const compiled = compiler.compileTemplate({ source: f.descriptor.template.content, filename: f.filename, id: 'r07', compilerOptions: { expressionPlugins: ['typescript'] } });
  assert.deepEqual(compiled.errors, []);
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(name => { assert.equal(name, 'vue'); return vue; }, exports);
  const sheet = { props: ['show', 'title'], setup: (props, { slots }) => () => props.show ? vue.h('section', [vue.h('h3', props.title), slots.default?.({ close() {} })]) : null };
  const app = vue.createSSRApp({ setup: () => ({ ...f.s, getAppIcon: () => '' }), render: exports.render,
    components: { MacSheet: sheet, MacAlertSheet: { render: () => null }, AdminFeedback: { render: () => null }, PromoInspector: { render: () => null } } });
  app.config.warnHandler = () => {};
  return renderToString(app);
}

for (const file of ['CommerceApp.vue', 'SubscriptionsApp.vue']) test(`${file}: production SFC compiles`, () => {
  const filename = path.join(src, 'apps/admin', file);
  const parsed = compiler.parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(parsed.errors, []);
  assert.ok(compiler.compileScript(parsed.descriptor, { id: 'r07' }).content);
  assert.deepEqual(compiler.compileTemplate({ source: parsed.descriptor.template.content, filename, id: 'r07', compilerOptions: { expressionPlugins: ['typescript'] } }).errors, []);
});

test('admin features string round trips through editor and real PUT adapter', async t => {
  const f = commerce(); t.after(f.dispose);
  f.s.openEditPlanModal(plan()); assert.equal(f.s.planForm.featuresText, 'A\nB');
  f.s.planForm.featuresText = ' A\r\n\n B ';
  await f.s.submitSavePlan();
  const write = f.calls.find(c => c[0] === 'put');
  assert.equal(write[1], '/admin/payment/plans/3'); assert.equal(write[2].features, 'A\nB');
  assert.equal(f.s.showPlanModal.value, false);
});
test('blank features are empty string on create; failed edit keeps the original draft', async t => {
  const f = commerce(); t.after(f.dispose);
  f.s.groups.value = [{ id: 73 }]; f.s.openCreatePlanModal(); f.s.planForm.name = 'Empty';
  await f.s.submitSavePlan(); assert.equal(f.calls.find(c => c[0] === 'post')[2].features, '');
  const failed = commerce({ updatePlan: async () => { throw { status: 400, message: '计划校验失败' }; } }); t.after(failed.dispose);
  failed.s.openEditPlanModal(plan()); await failed.s.submitSavePlan();
  assert.equal(failed.s.planForm.featuresText, 'A\nB'); assert.equal(failed.s.showPlanModal.value, true);
  assert.equal(failed.s.isSavingPlan.value, false); assert.equal(failed.s.toastMsg.value, '计划校验失败');
});
test('admin and checkout DTOs keep incompatible features types at compile time', () => {
  const filename = path.join(src, 'types/r07-virtual-contract.ts');
  const source = `import type {SubscriptionPlan, AdminSubscriptionPlan, CreateAdminPlanRequest} from './payment';
    const user: SubscriptionPlan['features'] = ['A']; const admin: AdminSubscriptionPlan['features'] = 'A\\nB';
    const create: CreateAdminPlanRequest['features'] = '';
    // @ts-expect-error Admin JSON must reject arrays.
    const wrongAdmin: AdminSubscriptionPlan['features'] = ['A'];
    // @ts-expect-error Checkout still renders a list.
    const wrongUser: SubscriptionPlan['features'] = 'A';
    // @ts-expect-error Create contract must reject arrays.
    const wrongCreate: CreateAdminPlanRequest['features'] = [];`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options), read = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => path.resolve(file) === filename ? ts.createSourceFile(file, source, options.target, true) : read(file, ...args);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host));
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
test('plan save in flight suppresses a duplicate create', async t => {
  const gate = deferred(); let writes = 0;
  const f = commerce({ createPlan: () => { writes++; return gate.promise; } }); t.after(f.dispose);
  f.s.groups.value = [{ id: 73 }]; f.s.openCreatePlanModal(); f.s.planForm.name = '套餐';
  const pending = f.s.submitSavePlan(); await f.s.submitSavePlan();
  assert.equal(writes, 1); assert.equal(f.s.isSavingPlan.value, true);
  gate.resolve({ data: plan() }); await pending; assert.equal(f.s.isSavingPlan.value, false);
});

test('refund actions render for four official states; PAID and pending never resubmit refunds', async t => {
  const f = commerce(); t.after(f.dispose);
  f.s.orders.value = ['REFUND_REQUESTED', 'REFUND_FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].map((s, i) => order(s, { id: i + 1 }));
  const rendered = await html(f);
  for (const text of ['审核退款', '重试退款', '查询退款', '继续退款']) assert.ok(rendered.includes(text), text);
  for (const status of ['PAID', 'PENDING', 'REFUND_PENDING', 'REFUNDING', 'REFUNDED']) {
    f.s.showRefundModal.value = false; f.s.openRefundModal(order(status)); assert.equal(f.s.showRefundModal.value, false, status);
  }
});
test('refund input uses credited USD, requested amount and actual partial remainder separately', t => {
  const f = commerce(); t.after(f.dispose);
  f.s.openRefundModal(order()); assert.equal(f.s.refundAmount.value, 100);
  f.s.openRefundModal(order('REFUND_REQUESTED', { refund_amount: 35, refund_request_reason: '误充值' }));
  assert.equal(f.s.refundAmount.value, 35); assert.equal(f.s.refundReason.value, '误充值');
  assert.equal(f.s.maxRefundable(f.s.selectedOrder.value), 100);
  f.s.openRefundModal(order('PARTIALLY_REFUNDED', { refund_amount: 35 })); assert.equal(f.s.refundAmount.value, 65);
  f.s.openRefundModal(order('REFUND_FAILED', { refund_amount: 35 })); assert.equal(f.s.refundAmount.value, 100);
});
test('partial refund rejects an excessive amount and sends only the remaining credited amount', async t => {
  const f = commerce(); t.after(f.dispose); f.s.openRefundModal(order('PARTIALLY_REFUNDED', { refund_amount: 35 }));
  f.s.refundAmount.value = 66; await f.s.handleConfirmRefund(); assert.equal(f.calls.length, 0);
  f.s.refundAmount.value = 65; await f.s.handleConfirmRefund();
  assert.deepEqual(f.calls[0], ['post', '/admin/payment/orders/42/refund', { amount: 65, reason: '管理员退款', deduct_balance: true, force: false }]);
});
test('require_force never retries automatically or submits without an explicit checkbox', async t => {
  const calls = []; const f = commerce({ refundOrder: async (id, body) => { calls.push(plain(body)); return { data: calls.length === 1 ? { success: false, require_force: true, warning: '余额不足' } : { success: true } }; } }); t.after(f.dispose);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund();
  assert.equal(calls.length, 1); assert.equal(calls[0].force, false); assert.equal(f.s.showRefundModal.value, true);
  assert.equal(f.s.refundForceConfirmed.value, false); assert.equal(f.s.refundWarning.value, '余额不足');
  assert.match(await html(f), /disabled[^>]*>\s*确认强制退款/);
  await f.s.handleConfirmRefund(); assert.equal(calls.length, 1);
  f.s.refundForceConfirmed.value = true; await f.s.handleConfirmRefund();
  assert.equal(calls.length, 2); assert.equal(calls[1].force, true); assert.equal(f.s.showRefundModal.value, false);
});
test('editing a force-confirmed request or opening another order revokes the old consent', async t => {
  const bodies = []; const f = commerce({ refundOrder: async (_, data) => { bodies.push(plain(data)); return { data: { success: false, require_force: true } }; } }); t.after(f.dispose);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund(); f.s.refundForceConfirmed.value = true;
  f.s.refundAmount.value = 20; await f.s.handleConfirmRefund(); assert.equal(bodies[1].force, false);
  f.s.refundForceConfirmed.value = true; f.s.openRefundModal(order('COMPLETED', { id: 99 }));
  assert.equal(f.s.refundForceConfirmed.value, false); assert.equal(f.s.refundRequireForce.value, false);
});
test('pending gateway response closes mutation form and exposes query after list refresh', async t => {
  const f = commerce({ refundOrder: async () => ({ data: { success: false, warning: 'gateway refund is still pending confirmation' } }),
    getOrders: async () => ({ data: { items: [order('REFUND_PENDING')], total: 1 } }) }); t.after(f.dispose);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund();
  assert.equal(f.s.showRefundModal.value, false); assert.match(f.s.toastMsg.value, /处理中/);
  assert.ok((await html(f)).includes('查询退款'));
});
test('pending query is guarded against duplicates, uses the official endpoint and releases on error', async t => {
  const gate = deferred(); let writes = 0;
  const f = commerce({ queryRefund: async () => { writes++; return gate.promise; } }); t.after(f.dispose);
  const pending = f.s.handleQueryRefund(order('REFUND_PENDING'));
  await f.s.handleQueryRefund(order('REFUND_PENDING')); assert.equal(writes, 1);
  gate.reject({ status: 503, message: '查询暂不可用' }); await pending;
  assert.equal(f.s.refundQueryingIds.value.size, 0); assert.equal(f.s.toastMsg.value, '查询暂不可用');
  const api = commerce(); t.after(api.dispose); await api.s.handleQueryRefund(order('REFUND_PENDING'));
  assert.equal(api.calls[0][1], '/admin/payment/orders/42/refund/query');
});
test('refund prevents duplicate submits and changing the target while a request is in flight', async t => {
  const gate = deferred(); let calls = 0; const f = commerce({ refundOrder: () => { calls++; return gate.promise; } }); t.after(f.dispose);
  f.s.openRefundModal(order()); const pending = f.s.handleConfirmRefund();
  await f.s.handleConfirmRefund(); f.s.openRefundModal(order('COMPLETED', { id: 99 })); f.s.openOrderDetail(order('COMPLETED', { id: 100 }));
  assert.equal(calls, 1); assert.equal(f.s.selectedOrder.value.id, 42);
  gate.resolve({ data: { success: true } }); await pending; assert.equal(f.s.isProcessingOrder.value, false);
});
test('unknown refund response blocks immediate repeat; backend rejection remains visible', async t => {
  let calls = 0; const f = commerce({ refundOrder: async () => { calls++; throw { status: 0, message: 'timeout' }; } }); t.after(f.dispose);
  f.s.openRefundModal(order()); await f.s.handleConfirmRefund(); await f.s.handleConfirmRefund();
  assert.equal(calls, 1); assert.equal(f.s.refundNeedsReview.value, true); assert.match(f.s.refundWarning.value, /尚未确认/);
  const rejected = commerce({ refundOrder: async () => { throw { status: 400, message: 'order status does not allow refund' }; } }); t.after(rejected.dispose);
  rejected.s.openRefundModal(order('PARTIALLY_REFUNDED', { refund_amount: 35 })); await rejected.s.handleConfirmRefund();
  assert.equal(rejected.s.showRefundModal.value, true); assert.match(rejected.s.refundWarning.value, /status does not allow/);
});

test('subscription code goes through real adapter with distinct group, duration and expiry fields', async t => {
  const f = commerce(); t.after(f.dispose); await f.s.loadRedeemGroups();
  Object.assign(f.s.generateForm.value, { type: 'subscription', count: 2, group_id: 73, validity_days: 14, expires_in_days: 7 });
  await f.s.submitGenerate();
  assert.deepEqual(f.calls.find(c => c[0] === 'post'), ['post', '/admin/redeem-codes/generate', { count: 2, type: 'subscription', value: 0, group_id: 73, validity_days: 14, expires_in_days: 7 }]);
});
test('switching subscription draft to invitation drops hidden entitlement fields and forces zero value', async t => {
  const f = commerce(); t.after(f.dispose);
  Object.assign(f.s.generateForm.value, { type: 'invitation', value: 999, group_id: 73, validity_days: 14 });
  await f.s.submitGenerate();
  assert.deepEqual(f.calls.find(c => c[0] === 'post')[2], { count: 5, type: 'invitation', value: 0 });
  const calls = []; const api = adapter('redeem', { post: async (_, body) => { calls.push(body); return { data: [] }; } });
  await api.generate(1, 'invitation', 900, 73, 14); assert.deepEqual(calls[0], { count: 1, type: 'invitation', value: 0 });
});
test('group failure blocks subscription generation but not invitation; retry only offers subscription groups', async t => {
  let fail = true; const f = commerce({}, { groupsAdminAPI: { getAll: async () => { if (fail) throw Error('分组读取失败'); return [{ id: 73, subscription_type: 'subscription' }, { id: 9, subscription_type: 'standard' }]; } } }); t.after(f.dispose);
  await f.s.loadRedeemGroups(); f.s.generateForm.value.type = 'subscription'; await f.s.submitGenerate(); assert.equal(f.calls.length, 0);
  fail = false; await f.s.loadRedeemGroups(); assert.deepEqual(plain(f.s.subscriptionGroups.value.map(g => g.id)), [73]);
  f.s.generateForm.value.group_id = 9; await f.s.submitGenerate(); assert.equal(f.calls.length, 0);
  f.s.generateForm.value.type = 'invitation'; await f.s.submitGenerate(); assert.equal(f.calls.filter(c => c[0] === 'post').length, 1);
});
test('invalid code count, expiry and subscription duration never write; numeric strings cannot swap positions', async t => {
  const f = commerce(); t.after(f.dispose); await f.s.loadRedeemGroups();
  const good = { type: 'subscription', count: 2, group_id: 73, validity_days: 14, expires_in_days: '' };
  for (const bad of [{ count: 0 }, { count: 101 }, { count: 1.5 }, { group_id: '73' }, { validity_days: 0 }, { validity_days: 1.5 }, { validity_days: -3 }, { expires_in_days: 0 }, { expires_in_days: 3651 }]) {
    Object.assign(f.s.generateForm.value, good, bad); await f.s.submitGenerate(); assert.equal(f.calls.length, 0, JSON.stringify(bad));
  }
});
test('balance/concurrency adapter fields stay independent from stale subscription draft', async t => {
  const f = commerce(); t.after(f.dispose);
  Object.assign(f.s.generateForm.value, { type: 'balance', value: 12.5, group_id: 73, validity_days: 14, expires_in_days: 7 });
  await f.s.submitGenerate(); assert.deepEqual(f.calls.find(c => c[0] === 'post')[2], { count: 5, type: 'balance', value: 12.5, expires_in_days: 7 });
  f.s.generateForm.value.type = 'concurrency'; f.s.generateForm.value.value = 2.5; await f.s.submitGenerate(); assert.equal(f.calls.filter(c => c[0] === 'post').length, 1);
});
test('redeem generation prevents double submit and retains draft on a normalized error', async t => {
  const gate = deferred(); let writes = 0; const f = commerce({}, { redeemAdminAPI: { generate: () => { writes++; return gate.promise; } } }); t.after(f.dispose);
  f.s.showGenerateModal.value = true; const pending = f.s.submitGenerate(); await f.s.submitGenerate(); assert.equal(writes, 1);
  gate.reject({ status: 400, message: '兑换码校验失败' }); await pending;
  assert.equal(f.s.showGenerateModal.value, true); assert.equal(f.s.generateForm.value.value, 10);
  assert.equal(f.s.isGenerating.value, false); assert.equal(f.s.generateError.value, '兑换码校验失败');
});
test('subscription/invitation controls render their own duration/group or registration meaning', async t => {
  const f = commerce(); t.after(f.dispose); await f.s.loadRedeemGroups(); f.s.showGenerateModal.value = true;
  f.s.generateForm.value.type = 'subscription'; const rendered = await html(f);
  for (const text of ['订阅分组', '兑换后订阅时长', '兑换码领取期限', '订阅组']) assert.ok(rendered.includes(text), text);
  assert.ok(!rendered.includes('>普通组</option>'));
  f.s.generateForm.value.type = 'invitation'; const invited = await html(f);
  assert.ok(invited.includes('邀请码用于邀请注册')); assert.ok(!invited.includes('兑换后订阅时长'));
});

test('negative subscription adjustment reaches the original API unchanged when expiry stays future', async t => {
  const f = await subscription(); t.after(f.dispose); f.s.openExtend(sub(30)); f.s.extendDays.value = -3;
  await f.s.submitExtend(); assert.deepEqual(f.calls, [[19, { days: -3 }]]); assert.equal(f.s.showExtendModal.value, false);
});
test('zero, fractional, past-expiry and unknown-expiry shortening make no request', async t => {
  const f = await subscription(); t.after(f.dispose);
  for (const [target, days] of [[sub(30), 0], [sub(30), 0.5], [sub(2), -3], [sub(-3), -1], [{ id: 19, expires_at: null }, -1], [{ id: 19, expires_at: 'invalid' }, -1]]) {
    f.s.openExtend(target); f.s.extendDays.value = days; await f.s.submitExtend(); assert.equal(f.calls.length, 0); assert.ok(f.s.actionError.value);
  }
});
test('expired subscription positive renewal remains allowed and failed shortening keeps input', async t => {
  const f = await subscription(); t.after(f.dispose); f.s.openExtend(sub(-30)); f.s.extendDays.value = 1; await f.s.submitExtend(); assert.deepEqual(f.calls, [[19, { days: 1 }]]);
  const failed = await subscription({ extend: async () => { throw { message: 'adjustment rejected' }; } }); t.after(failed.dispose);
  failed.s.openExtend(sub(30)); failed.s.extendDays.value = -3; await failed.s.submitExtend();
  assert.equal(failed.s.showExtendModal.value, true); assert.equal(failed.s.extendDays.value, -3); assert.equal(failed.s.saving.value, false);
});
test('subscription form renders signed input and duplicate adjustment is guarded', async t => {
  const gate = deferred(); let writes = 0; const f = await subscription({ extend: async () => { writes++; return gate.promise; } }); t.after(f.dispose);
  f.s.openExtend(sub(30)); f.s.extendDays.value = -3;
  const rendered = await html(f); assert.match(rendered, /正数延长，负数缩短/);
  const input = rendered.match(/<input[^>]*value="-3"[^>]*>/)?.[0]; assert.ok(input); assert.match(input, /step="1"/); assert.doesNotMatch(input, /\bmin=/);
  const pending = f.s.submitExtend(); await f.s.submitExtend(); f.s.openExtend({ ...sub(3), id: 99 }); assert.equal(writes, 1); assert.equal(f.s.targetSub.value.id, 19);
  gate.resolve(); await pending;
});
