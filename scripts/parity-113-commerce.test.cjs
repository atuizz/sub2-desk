// node --test scripts/parity-113-commerce.test.cjs
// 1.1.3 分块：MCP 接入 / 订阅批量操作（含批量分配）/ 推广线下提现 / 分组按张计费。
// 只用隔离夹具验证，不调真实生产后端，不用生产 key，不写真实配置。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'); const vue = req('vue'); const compiler = req('vue/compiler-sfc');
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
function storageMock(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    _map: map
  };
}
function execute(file, mocks = {}) {
  let source = file.endsWith('.vue') ? compiler.parse(read(file)).descriptor.scriptSetup.content : read(file);
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const cleanup = [];
  const context = { ...vue, exports: {}, URL, URLSearchParams, AbortController, Date, Intl, console,
    setTimeout, clearTimeout, crypto,
    localStorage: storageMock({ auth_user: JSON.stringify({ id: 7 }) }),
    sessionStorage: storageMock(),
    navigator: {},
    window: { location: { assign: () => {} } },
    watch: () => {}, onMounted: () => {}, onUnmounted: () => {}, onBeforeUnmount: f => cleanup.push(f),
    defineProps: () => ({}), withDefaults: (p, defaults) => ({ ...defaults, ...p }),
    buildApiUrl: p => '/api/v1' + p, buildGatewayUrl: p => 'https://gateway.invalid' + p,
    fetch: () => { throw Error('Network forbidden'); },
    // 通用 TOTP step-up 默认 mock：直接放行；需要验证流程的夹具在 mocks 里覆盖。
    useStepUp: () => ({ visible: { value: false }, blockedReason: { value: '' }, prompt: async () => true, onVerified: () => {}, onCancel: () => {}, run: async (action) => action() }),
    isStepUpCancelled: () => false,
    isStepUpBlocked: () => false,
    stepUpBlockReason: () => '',
    ...mocks };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { s: context.subject, cleanup, context };
}
const flush = (ms = 10) => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

const vueFiles = [
  'apps/user/MCPApp.vue',
  'apps/admin/SubscriptionsApp.vue',
  'apps/admin/CommerceApp.vue',
  'apps/admin/GroupsApp.vue',
  'apps/admin/policies/GroupMediaEditor.vue'
];
for (const file of vueFiles) test(`${file}: SFC script and template compile`, () => {
  const { descriptor, errors } = compiler.parse(read(file), { filename: file }); assert.deepEqual(errors, []);
  assert.doesNotThrow(() => compiler.compileScript(descriptor, { id: 'parity-113', inlineTemplate: true }));
  assert.deepEqual(compiler.compileTemplate({ source: descriptor.template.content, filename: file, id: 'parity-113' }).errors, []);
});
test('manifest registers MCP app; rebates order_id null key fix intact', () => {
  const manifest = fs.readFileSync(path.join(sourceRoot, 'apps/manifest.ts'), 'utf8');
  assert.ok(manifest.includes("id: 'mcp'")); assert.ok(manifest.includes('MCPApp')); assert.ok(manifest.includes("category: 'user'"));
  const commerce = read('apps/admin/CommerceApp.vue');
  assert.ok(commerce.includes('reb.order_id ?? `rebate-${rebIndex}`'));
  assert.ok(commerce.includes('登记线下提现'));
});

// ==================== MCP ====================
const validQuery = () => ({
  response_type: 'code', client_id: 'client-1', redirect_uri: 'https://client.test/cb',
  code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: 'https://api.test/api/v1/mcp', scope: 'mcp'
});
function mcpFixture(overrides = {}) {
  const calls = { config: 0, grants: 0, revoke: [], preview: 0, authorize: [] };
  const assigned = [];
  const api = {
    getConnectionConfig: async () => { calls.config++; return { resource: 'https://api.test/api/v1/mcp' }; },
    listGrants: async () => { calls.grants++; return []; },
    revokeGrant: async id => { calls.revoke.push(id); },
    previewAuthorization: async () => { calls.preview++; return { client_id: 'client-1', client_name: 'Fixture App', redirect_uri: 'https://client.test/cb', resource: 'https://api.test/api/v1/mcp', scope: 'mcp' }; },
    authorize: async input => { calls.authorize.push(input); return { redirect_url: 'https://client.test/cb?code=x' }; },
    ...overrides
  };
  const auth = { user: { id: 1, email: 'a@b.c' }, isAdmin: false, isAuthenticated: true };
  const stepUpCalls = [];
  const stepUp = {
    visible: { value: false }, blockedReason: { value: '' },
    prompt: async () => true, onVerified: () => {}, onCancel: () => {},
    run: async (action) => { stepUpCalls.push(action); return action(); },
  };
  const f = execute('apps/user/MCPApp.vue', {
    getPublicSettings: async () => ({ mcp_enabled: true }),
    mcpAPI: api, useAuthStore: () => auth,
    useStepUp: () => stepUp,
    isStepUpCancelled: (err) => err && err.code === 'STEP_UP_CANCELLED',
    isStepUpBlocked: (err) => err && typeof err.code === 'string' && err.code.startsWith('STEP_UP_') && err.code !== 'STEP_UP_REQUIRED',
    stepUpBlockReason: (err) => (err && err.code) || '',
    window: { location: { assign: url => { assigned.push(url); } } },
    navigator: { clipboard: { writeText: async () => {} } }
  });
  return { ...f, calls, assigned, api, auth, stepUp, stepUpCalls };
}
test('MCP authorization query validation rejects malformed requests', () => {
  const { s } = mcpFixture();
  assert.equal(s.parseMcpAuthorization(validQuery()).client_id, 'client-1');
  for (const mutate of [
    q => { delete q.client_id; },
    q => { q.response_type = 'token'; },
    q => { q.code_challenge_method = 'plain'; },
    q => { q.code_challenge = 'short'; },
    q => { q.scope = 'other'; },
    q => { q.extra = 'nope'; },
    q => { q.client_id = 'x'.repeat(4097); },
    q => { q.state = ['array']; }
  ]) {
    const q = validQuery(); mutate(q);
    assert.throws(() => s.parseMcpAuthorization(q), /授权请求无效或不完整/);
  }
});
test('MCP preview and redirect validation reject mismatched or unsafe URLs', () => {
  const { s } = mcpFixture();
  const request = s.parseMcpAuthorization(validQuery());
  const good = { client_id: 'client-1', client_name: 'App', redirect_uri: 'https://client.test/cb', resource: 'https://api.test/api/v1/mcp', scope: 'mcp' };
  assert.doesNotThrow(() => s.validateMcpPreview(good, request));
  for (const bad of [
    { ...good, client_id: 'other' },
    { ...good, redirect_uri: 'https://client.test/other' },
    { ...good, scope: 'user' },
    { ...good, client_name: 42 },
    { ...good, redirect_uri: 'https://user:pass@client.test/cb' },
    { ...good, redirect_uri: 'https://client.test/cb#frag' },
    { ...good, redirect_uri: 'ftp://client.test/cb' }
  ]) assert.throws(() => s.validateMcpPreview(bad, request), /授权请求无效或不完整/);
  assert.doesNotThrow(() => s.validateMcpRedirect('https://client.test/cb?code=x', 'https://client.test/cb'));
  for (const bad of ['https://evil.test/cb', 'https://client.test/other', 'https://user:pass@client.test/cb', 'https://client.test/cb#frag']) {
    assert.throws(() => s.validateMcpRedirect(bad, 'https://client.test/cb'), /非预期的地址/);
  }
});
test('MCP grant status follows revoked/invalidated/expiry rules', () => {
  const { s } = mcpFixture();
  const base = { id: 'g1', client_id: 'c', client_name: 'App', scope: 'user', read_only: true, created_at: '2026-01-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z', last_used_at: null, revoked_at: null, invalidated: false };
  assert.equal(s.grantStatusText(base), '有效'); assert.equal(s.isGrantActive(base), true);
  assert.equal(s.grantStatusText({ ...base, revoked_at: '2026-01-02T00:00:00Z' }), '已撤销');
  assert.equal(s.grantStatusText({ ...base, invalidated: true }), '已失效（账户权限或密码已变更）');
  assert.equal(s.grantStatusText({ ...base, expires_at: '2020-01-01T00:00:00Z' }), '已过期');
});
test('MCP entry hides when mcp_enabled is false and issues no MCP calls; 503 disables too', async () => {
  const f = execute('apps/user/MCPApp.vue', {
    getPublicSettings: async () => ({ mcp_enabled: false }),
    mcpAPI: { getConnectionConfig: async () => { throw Error('must not be called'); }, listGrants: async () => { throw Error('must not be called'); } },
    useAuthStore: () => ({ user: { id: 1, email: 'a@b.c' }, isAdmin: false, isAuthenticated: true })
  });
  await f.s.loadSettings(); await flush();
  assert.equal(f.s.mcpEnabled.value, false);
  const f503 = mcpFixture({ getConnectionConfig: async () => { const e = new Error('MCP disabled'); e.status = 503; throw e; } });
  await f503.s.loadSettings(); await flush();
  assert.equal(f503.s.serverDisabled.value, true); assert.equal(f503.s.endpoint.value, '');
  const live = mcpFixture();
  await live.s.loadSettings(); await flush();
  assert.equal(live.s.mcpEnabled.value, true); assert.equal(live.s.endpoint.value, 'https://api.test/api/v1/mcp');
  assert.equal(live.calls.config, 1); assert.equal(live.calls.grants, 1);
});
test('MCP revoke marks the row revoked in place; consent approve/deny validate redirect', async () => {
  const f = mcpFixture();
  const grant = { id: 'g1', client_id: 'c', client_name: 'App', scope: 'user', read_only: true, created_at: '2026-01-01T00:00:00Z', expires_at: '2999-01-01T00:00:00Z', last_used_at: null, revoked_at: null, invalidated: false };
  f.s.grants.value = [grant]; f.s.revokeTarget.value = grant;
  await f.s.revokeGrant();
  assert.ok(f.s.grants.value[0].revoked_at); assert.equal(f.s.revokeTarget.value, null); assert.deepEqual(f.calls.revoke, ['g1']);
  await f.s.openMcpAuthorization(validQuery()); await flush();
  assert.equal(f.s.consent.value.client_name, 'Fixture App');
  await f.s.decideAuthorization(true); await flush();
  assert.deepEqual(f.assigned, ['https://client.test/cb?code=x']);
  assert.equal(f.calls.authorize[0].approved, true); assert.equal(f.calls.authorize[0].scope, 'user'); assert.equal(f.calls.authorize[0].read_only, true);
  await f.s.openMcpAuthorization(validQuery()); await flush();
  await f.s.decideAuthorization(false); await flush();
  assert.equal(f.calls.authorize[1].approved, false); assert.equal(f.calls.authorize[1].scope, 'user'); assert.equal(f.calls.authorize[1].read_only, true);
});
test('MCP admin scope approval goes through TOTP step-up instead of being blocked', async () => {
  const f = mcpFixture(); f.auth.isAdmin = true;
  await f.s.openMcpAuthorization(validQuery()); await flush();
  f.s.consentScope.value = 'admin'; f.s.consentReadOnly.value = false;
  await f.s.decideAuthorization(true); await flush();
  assert.equal(f.stepUpCalls.length, 1);
  assert.equal(f.calls.authorize.length, 1);
  assert.equal(f.calls.authorize[0].scope, 'admin');
  assert.equal(f.calls.authorize[0].read_only, false);
  assert.deepEqual(f.assigned, ['https://client.test/cb?code=x']);
});
test('MCP admin approval surfaces step-up blocked error without redirect', async () => {
  const f = mcpFixture(); f.auth.isAdmin = true;
  f.stepUp.run = async () => { const e = new Error('totp not enabled'); e.code = 'STEP_UP_TOTP_NOT_ENABLED'; throw e; };
  await f.s.openMcpAuthorization(validQuery()); await flush();
  f.s.consentScope.value = 'admin';
  await f.s.decideAuthorization(true); await flush();
  assert.equal(f.calls.authorize.length, 0);
  assert.match(f.s.submitError.value, /两步验证/);
  assert.deepEqual(f.assigned, []);
});
test('MCP user scope approval does not invoke step-up', async () => {
  const f = mcpFixture();
  await f.s.openMcpAuthorization(validQuery()); await flush();
  await f.s.decideAuthorization(true); await flush();
  assert.equal(f.stepUpCalls.length, 0);
  assert.equal(f.calls.authorize.length, 1);
  assert.equal(f.calls.authorize[0].scope, 'user');
});

// ==================== 订阅批量操作 ====================
function subsFixture(overrides = {}) {
  const calls = { bulkAction: [], bulkAssign: [], assign: [], list: 0 };
  const api = {
    list: async () => { calls.list++; return { items: [], total: 0 }; },
    assign: async req => { calls.assign.push(req); return { id: 99 }; },
    bulkAssign: async req => { calls.bulkAssign.push(req); return { success_count: 1, created_count: 1, reused_count: 0, failed_count: 1, subscriptions: [], errors: ['用户 #2 已有订阅'] }; },
    bulkAction: async (req, key) => { calls.bulkAction.push([req, key]); return { success_count: 1, failed_count: 1, results: [{ subscription_id: 1, success: true }, { subscription_id: 2, success: false, error: 'boom' }] }; },
    ...overrides
  };
  const f = execute('apps/admin/SubscriptionsApp.vue', {
    subsAPI: api, groupsAPI: { getAll: async () => [] }, usersAPI: { list: async () => ({ items: [], total: 0 }) },
    adminError: (err, fallback) => (err && err.message) || fallback,
    collectAdminPages: async () => [], getAppIcon: id => id
  });
  return { ...f, calls, api };
}
const subRows = () => ([
  { id: 1, user_id: 11, group_id: 1, status: 'active', user: { email: 'a@x' }, group: { name: 'g1' } },
  { id: 2, user_id: 12, group_id: 1, status: 'active', user: { email: 'b@x' }, group: { name: 'g1' } },
  { id: 3, user_id: 13, group_id: 1, status: 'revoked', user: { email: 'c@x' }, group: { name: 'g1' } }
]);
test('bulk operation key is canonical, persisted and reused on uncertain retry', () => {
  const { s, context } = subsFixture();
  const op = s.prepareBulkSubscriptionOperation({ subscription_ids: [3, 1, 3, 2], action: 'extend', days: 30 });
  assert.deepEqual([...op.request.subscription_ids], [1, 2, 3]); assert.equal(op.request.days, 30);
  assert.match(op.key, /^subscription-bulk-7-/); assert.equal(op.outcomeUncertain, false);
  assert.ok(context.sessionStorage._map.size > 0);
  const again = s.prepareBulkSubscriptionOperation({ subscription_ids: [2, 1, 3], action: 'extend', days: 30 });
  assert.equal(again.key, op.key); assert.equal(again.outcomeUncertain, true);
  s.completeBulkSubscriptionOperation(op);
  const fresh = s.prepareBulkSubscriptionOperation({ subscription_ids: [1, 2, 3], action: 'extend', days: 30 });
  assert.notEqual(fresh.key, op.key); assert.equal(fresh.outcomeUncertain, false);
  const reset = s.prepareBulkSubscriptionOperation({ subscription_ids: [5], action: 'reset_quota', daily: 1, weekly: 0, monthly: undefined });
  assert.deepEqual([reset.request.daily, reset.request.weekly, reset.request.monthly], [true, false, false]);
});
test('bulk validation: empty, over 100, extend days, reset windows', () => {
  const { s } = subsFixture();
  const windows = { daily: true, weekly: true, monthly: true };
  assert.match(s.validateBulkAction(0, 'extend', 30, windows), /选择/);
  assert.match(s.validateBulkAction(101, 'extend', 30, windows), /100/);
  assert.match(s.validateBulkAction(2, 'extend', 0, windows), /天数/);
  assert.match(s.validateBulkAction(2, 'extend', 36501, windows), /天数/);
  assert.match(s.validateBulkAction(2, 'extend', 1.5, windows), /天数/);
  assert.equal(s.validateBulkAction(2, 'extend', -36500, windows), '');
  assert.equal(s.validateBulkAction(2, 'extend', 36500, windows), '');
  assert.match(s.validateBulkAction(2, 'reset_quota', 30, { daily: false, weekly: false, monthly: false }), /窗口/);
  assert.equal(s.validateBulkAction(2, 'reset_quota', 30, { daily: false, weekly: true, monthly: false }), '');
});
test('bulk revoke applies only to active rows and shows per-item failures', async () => {
  const f = subsFixture(); const { s } = f;
  s.subscriptions.value = subRows(); s.selectedIds.value = [1, 2, 3];
  assert.deepEqual([s.bulkApplicable.value.extend, s.bulkApplicable.value.reset_quota, s.bulkApplicable.value.revoke, s.bulkApplicable.value.restore], [2, 2, 2, 1]);
  f.s.openBulkModal('revoke');
  assert.deepEqual([...f.s.bulkDialogTargets.value.map(x => x.id)], [1, 2]);
  await f.s.submitBulk();
  assert.equal(f.s.bulkResult.value.success_count, 1); assert.equal(f.s.bulkResult.value.failed_count, 1);
  assert.equal(f.s.bulkFailedResults.value.length, 1); assert.equal(f.s.bulkTargetLabel(2), 'b@x · #2');
  assert.equal(f.calls.bulkAction.length, 1); assert.deepEqual([...f.calls.bulkAction[0][0].subscription_ids], [1, 2]);
  assert.equal(f.calls.bulkAction[0][0].action, 'revoke');
  s.subscriptions.value = subRows(); s.selectedIds.value = [1, 2]; f.s.openBulkModal('extend');
  s.bulkDays.value = 0; // openBulkModal resets days to 30; set invalid value after opening
  await f.s.submitBulk();
  assert.equal(f.calls.bulkAction.length, 1); // validation blocks the submit
  assert.match(f.s.bulkValidationError.value, /天数/);
});
test('bulk uncertain failure keeps the key for retry; deterministic 4xx clears it', async () => {
  let fail = true;
  const seen = [];
  const f = subsFixture({ bulkAction: async (req, key) => {
    seen.push([req, key]);
    if (fail) { const e = new Error('bad gateway'); e.status = 503; throw e; }
    return { success_count: 2, failed_count: 0, results: [{ subscription_id: 1, success: true }, { subscription_id: 2, success: true }] };
  } });
  f.s.subscriptions.value = subRows(); f.s.selectedIds.value = [1, 2]; f.s.openBulkModal('revoke');
  await f.s.submitBulk();
  assert.ok(f.s.pendingBulkOp.value); assert.equal(f.s.pendingBulkOp.value.outcomeUncertain, true);
  assert.match(f.s.bulkRequestError.value, /bad gateway/);
  fail = false; const key = f.s.pendingBulkOp.value.key;
  await f.s.submitBulk();
  assert.equal(f.s.bulkResult.value.success_count, 2); assert.equal(f.s.pendingBulkOp.value, null);
  assert.equal(seen.length, 2); assert.equal(seen[1][1], key);
  const g = subsFixture({ bulkAction: async () => { const e = new Error('bad request'); e.status = 400; throw e; } });
  g.s.subscriptions.value = subRows(); g.s.selectedIds.value = [1]; g.s.openBulkModal('revoke');
  await g.s.submitBulk();
  assert.equal(g.s.pendingBulkOp.value, null); assert.equal(g.s.submittedBulkAction.value, null);
});
test('bulk assign shows created/reused/failed counts and errors', async () => {
  const f = subsFixture(); const { s } = f;
  s.auxReady.value = true;
  s.users.value = [{ id: 1, email: 'a@x' }, { id: 2, email: 'b@x' }];
  s.groups.value = [{ id: 1, name: 'g1', platform: 'openai' }];
  s.assignForm.value = { user_id: 1, group_id: 1, expires_in_days: 30 };
  s.batchAssign.value = true; s.batchUserIds.value = [1, 2]; s.showAssignModal.value = true;
  s.toggleBatchUser(2); assert.deepEqual([...s.batchUserIds.value], [1]);
  s.toggleBatchUser(2); assert.deepEqual([...s.batchUserIds.value], [1, 2]);
  assert.equal(s.batchUserEmail(2), 'b@x');
  await s.submitAssign();
  assert.equal(s.assignResult.value.created_count, 1); assert.equal(s.assignResult.value.reused_count, 0);
  assert.equal(s.assignResult.value.failed_count, 1); assert.deepEqual([...s.assignResult.value.errors], ['用户 #2 已有订阅']);
  assert.equal(JSON.stringify(f.calls.bulkAssign[0]), JSON.stringify({ user_ids: [1, 2], group_id: 1, validity_days: 30 }));
  assert.equal(s.showAssignModal.value, true); // result stays visible in the sheet
});

// ==================== 推广线下提现 ====================
function commerceFixture(overrides = {}) {
  const calls = { lookup: [], overview: [], withdraw: [] };
  const api = {
    listInviteRecords: async () => ({ items: [], total: 0 }),
    listRebateRecords: async () => ({ items: [], total: 0 }),
    listTransferRecords: async () => ({ items: [], total: 0 }),
    listUsers: async () => ({ items: [], total: 0 }),
    lookupUsers: async q => { calls.lookup.push(q); return [{ id: 7, email: 'a@x', username: 'u' }]; },
    getUserOverview: async id => { calls.overview.push(id); return { user_id: id, email: 'a@x', username: 'u', aff_code: 'CODE', rebate_rate_percent: 10, invited_count: 1, rebated_invitee_count: 1, available_quota: 10, history_quota: 10 }; },
    withdrawUserQuota: async (userId, payload, key) => { calls.withdraw.push([userId, payload, key]); return { result: { ledger_id: 99, user_id: userId, amount: payload.amount, available_quota_after: 5, frozen_quota_after: 0, history_quota_after: 5 }, replayed: false }; },
    ...overrides
  };
  const f = execute('apps/admin/CommerceApp.vue', {
    adminPaymentAPI: {}, redeemAdminAPI: {}, promoAdminAPI: {}, groupsAdminAPI: {},
    affiliatesAPI: api, adminError: (err, fallback) => (err && err.message) || fallback, getAppIcon: id => id,
    useAuthStore: () => ({ user: { id: 1 }, isAdmin: true, token: 't', sessionRevision: 1 }),
    usePaymentWriteGuard: () => ({ sessionIdentity: vue.ref(null), sessionValid: vue.ref(true), storageError: vue.ref('') })
  });
  return { ...f, calls, api };
}
test('withdraw amount formatting and validation use 8-decimal ledger precision', () => {
  const { s } = commerceFixture();
  assert.equal(s.formatPreciseAmount(1), '1.00');
  assert.equal(s.formatPreciseAmount(0.1), '0.10');
  assert.equal(s.formatPreciseAmount(1.5), '1.50');
  assert.equal(s.formatPreciseAmount(1.23456789), '1.23456789');
  assert.equal(s.formatPreciseAmount(0), '0.00');
  assert.equal(s.validateWithdrawAmount('', 10), '');
  assert.equal(s.validateWithdrawAmount('0', 10), '请输入大于 0 的金额');
  assert.equal(s.validateWithdrawAmount('-5', 10), '请输入大于 0 的金额');
  assert.equal(s.validateWithdrawAmount('abc', 10), '请输入大于 0 的金额');
  assert.equal(s.validateWithdrawAmount('11', 10), '提现金额不能超过当前可提取额度');
  assert.equal(s.validateWithdrawAmount('10.00000001', 10), '提现金额不能超过当前可提取额度');
  assert.equal(s.validateWithdrawAmount('10', 10), '');
});
test('withdraw operation normalizes amount and reuses the key on uncertain retry', () => {
  const { s, context } = commerceFixture();
  const op = s.prepareAffiliateWithdrawOperation(7, 1.234567891);
  assert.equal(op.amount, 1.23456789);
  assert.match(op.key, /^affiliate-withdraw-7-/); assert.equal(op.outcomeUncertain, false);
  assert.ok(context.sessionStorage._map.size > 0);
  const again = s.prepareAffiliateWithdrawOperation(7, 1.23456789);
  assert.equal(again.key, op.key); assert.equal(again.outcomeUncertain, true);
  s.completeAffiliateWithdrawOperation(op);
  assert.notEqual(s.prepareAffiliateWithdrawOperation(7, 1.23456789).key, op.key);
});
test('withdraw flow shows ledger fields; replayed reports no double deduction', async () => {
  const f = commerceFixture(); const { s } = f;
  await s.searchWithdrawUsers('a@x');
  assert.equal(s.withdrawUserResults.value[0].email, 'a@x');
  s.selectWithdrawUser({ id: 7, email: 'a@x', username: 'u' }); await flush();
  assert.equal(s.withdrawAvailableQuota.value, 10);
  s.fillWithdrawAll(); assert.equal(s.withdrawAmount.value, 10);
  s.withdrawAmount.value = 5; assert.equal(s.withdrawCanSubmit.value, true);
  await s.submitWithdraw();
  assert.equal(s.withdrawResult.value.ledger_id, 99);
  assert.equal(s.withdrawResult.value.available_quota_after, 5);
  assert.equal(s.withdrawReplayed.value, false);
  assert.equal(JSON.stringify(f.calls.withdraw[0].slice(0, 2)), JSON.stringify([7, { amount: 5 }]));
  const g = commerceFixture({ withdrawUserQuota: async (userId, payload, key) => ({ result: { ledger_id: 98, user_id: userId, amount: payload.amount, available_quota_after: 5, frozen_quota_after: 0, history_quota_after: 5 }, replayed: true }) });
  g.s.withdrawSelectedUser.value = { id: 7, email: 'a@x', username: 'u' };
  g.s.withdrawAmount.value = 5; g.s.withdrawAvailableQuota.value = 10;
  await g.s.submitWithdraw();
  assert.equal(g.s.withdrawReplayed.value, true); assert.equal(g.s.withdrawResult.value.ledger_id, 98);
});
test('withdraw USER_NOT_FOUND means zero quota and keeps the user; uncertain keeps the operation', async () => {
  const f = commerceFixture({ getUserOverview: async () => { const e = new Error('no affiliate profile'); e.code = 'USER_NOT_FOUND'; throw e; } });
  f.s.selectWithdrawUser({ id: 7, email: 'a@x', username: 'u' }); await flush();
  assert.equal(f.s.withdrawAvailableQuota.value, 0);
  assert.equal(f.s.withdrawSelectedUser.value.id, 7); assert.equal(f.s.withdrawError.value, '');
  let fail = true;
  const seen = [];
  const g = commerceFixture({ withdrawUserQuota: async (userId, payload, key) => {
    seen.push([userId, payload, key]);
    if (fail) { const e = new Error('bad gateway'); e.status = 503; throw e; }
    return { result: { ledger_id: 99, user_id: userId, amount: payload.amount, available_quota_after: 5, frozen_quota_after: 0, history_quota_after: 5 }, replayed: false };
  } });
  g.s.withdrawSelectedUser.value = { id: 7, email: 'a@x', username: 'u' };
  g.s.withdrawAmount.value = 5; g.s.withdrawAvailableQuota.value = 10;
  await g.s.submitWithdraw();
  assert.ok(g.s.pendingWithdrawOp.value); assert.equal(g.s.pendingWithdrawOp.value.outcomeUncertain, true);
  assert.equal(g.s.withdrawCanSubmit.value, true); // retry allowed while uncertain
  fail = false; const key = g.s.pendingWithdrawOp.value.key;
  await g.s.submitWithdraw();
  assert.equal(g.s.withdrawResult.value.ledger_id, 99); assert.equal(seen[1][2], key);
});

// ==================== 分组按张计费 ====================
const policyMocks = {
  copy: v => JSON.parse(JSON.stringify(v)),
  changedFields: (before, after) => Object.fromEntries(Object.entries(after).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key]))),
  validateGroup: () => {}, validatePricing: () => {}
};
function mediaFixture(source, platform, creating) {
  return execute('apps/admin/policies/GroupMediaEditor.vue', {
    defineProps: () => ({ source, platform, creating }),
    ...policyMocks
  });
}
test('group media patch sends image_count_billing true/false explicitly, only for composite/openai with image generation', () => {
  const create = mediaFixture({}, 'composite', true);
  create.s.draft.value.allow_image_generation = true;
  assert.equal(create.s.showCountBilling.value, true);
  assert.equal(create.s.patch().image_count_billing, false); // default false, explicit
  create.s.draft.value.image_count_billing = true;
  assert.equal(create.s.patch().image_count_billing, true);
  const editOff = mediaFixture({ allow_image_generation: true, image_count_billing: true, image_rate_multiplier: 1 }, 'openai', false);
  editOff.s.draft.value.image_count_billing = false;
  assert.equal(editOff.s.patch().image_count_billing, false); // off is sent, not omitted
  const editOn = mediaFixture({ allow_image_generation: true, image_count_billing: false, image_rate_multiplier: 1 }, 'composite', false);
  editOn.s.draft.value.image_count_billing = true;
  assert.equal(editOn.s.patch().image_count_billing, true);
  const gemini = mediaFixture({ allow_image_generation: true, image_count_billing: false }, 'gemini', false);
  assert.equal(gemini.s.showCountBilling.value, false);
  assert.equal('image_count_billing' in gemini.s.patch(), false);
  const noImage = mediaFixture({ allow_image_generation: false, image_count_billing: false }, 'composite', false);
  assert.equal(noImage.s.showCountBilling.value, false);
  assert.equal('image_count_billing' in noImage.s.patch(), false);
});
