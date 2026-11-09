// node --test scripts/parity-113-settings.test.cjs
// Settings 1.1.3 parity fixtures: admin access keys, registration email
// blacklist, OpenCode GO global usage settings. All HTTP is replaced by
// fixtures; no live backend, no production keys, no real config is touched.
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
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function modules(handler) {
  const calls = [];
  const cache = new Map();
  const apiClient = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, payload) => {
    calls.push({ method, url, payload: plain(payload ?? null) });
    return { data: await handler(method, url, payload) };
  }]));
  function load(file) {
    file = path.resolve(src, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = {
      module, exports: module.exports, URL, Error, Date, AbortController, console, TextEncoder,
      require(spec) {
        if (spec === '../client') return { apiClient };
        if (spec.endsWith('.json')) {
          const target = path.resolve(path.dirname(file), spec);
          return JSON.parse(fs.readFileSync(target, 'utf8'));
        }
        if (spec.startsWith('@/')) return load(spec.slice(2) + '.ts');
        if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec) + '.ts');
        throw new Error(`Forbidden import: ${spec}`);
      }, fetch() { throw new Error('Live network forbidden'); }
    };
    vm.runInNewContext(js, sandbox, { filename: file });
    return module.exports;
  }
  return { load, calls };
}

function component(file, overrides = {}, props = {}) {
  const filename = path.join(src, file);
  const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(errors, []);
  const compiled = compileTemplate({ source: descriptor.template.content, filename, id: 'fixture', compilerOptions: { expressionPlugins: ['typescript'] } });
  assert.deepEqual(compiled.errors, []);
  let source = descriptor.scriptSetup.content;
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const events = [], mounted = [], unmounted = [];
  const scope = vue.effectScope();
  const auth = vue.reactive({ user: { id: 8, role: 'admin' }, isAdmin: true, sessionRevision: 0 });
  const copied = [];
  const context = {
    ...vue, ...overrides, Error, URL, Date, AbortController, console, TextEncoder,
    useAuthStore: () => auth,
    defineProps: () => props, defineEmits: () => (...args) => events.push(args),
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    document: { hidden: false, removeEventListener() {} },
    navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
    fetch() { throw new Error('Live network forbidden'); }
  };
  const js = ts.transpileModule(source + `\nglobalThis.subject={${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  scope.run(() => vm.runInNewContext(js, context, { filename }));
  return { s: context.subject, events, mounted, copied, auth, dispose() { unmounted.forEach(fn => fn()); scope.stop(); } };
}

const helpers = modules(async () => []).load('apps/user/settings/registrationEmailBlacklist.ts');
const { normalizeBlacklistEmail, parseBlacklistInput, mergeIntoBlacklist, chunkUserIds } = helpers;

// ── 1. 黑名单纯函数 ──────────────────────────────────────────────
test('blacklist normalize: ASCII case, trailing domain dot, byte limits, bad domain', () => {
  assert.equal(normalizeBlacklistEmail('  Foo.Bar@GMail.COM. '), 'foo.bar@gmail.com');
  assert.equal(normalizeBlacklistEmail('a@b'), null);
  assert.equal(normalizeBlacklistEmail('a@b..c'), null);
  assert.equal(normalizeBlacklistEmail('a b@c.com'), null);
  assert.equal(normalizeBlacklistEmail('a\x01b@c.com'), null);
  assert.equal(normalizeBlacklistEmail('@c.com'), null);
  assert.equal(normalizeBlacklistEmail('a@c.com@d.com'), null);
  assert.equal(normalizeBlacklistEmail(`${'x'.repeat(65)}@c.com`), null);
  assert.equal(normalizeBlacklistEmail(`a@${'y'.repeat(250)}.com`), null);
  assert.equal(normalizeBlacklistEmail('a@-bad.com'), null);
  assert.equal(normalizeBlacklistEmail('a@bad-.com'), null);
  assert.equal(normalizeBlacklistEmail('user+tag@example.com'), 'user+tag@example.com');
});

test('blacklist parse: splits on whitespace/commas/semicolons, dedups, keeps invalid', () => {
  const parsed = parseBlacklistInput('A@x.com, b@x.com；c@x.com d@x.com\nA@x.com bad-token @@ e@x');
  assert.deepEqual(plain(parsed.valid), ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com']);
  assert.equal(parsed.duplicates, 1);
  assert.deepEqual(plain(parsed.invalid), ['bad-token', '@@', 'e@x']);
});

test('blacklist merge: new addresses prepended, existing order kept, duplicates counted', () => {
  const merged = mergeIntoBlacklist(['old@x.com', 'keep@x.com'], ['new@x.com', 'old@x.com', 'new2@x.com']);
  assert.deepEqual(plain(merged.list), ['new@x.com', 'new2@x.com', 'old@x.com', 'keep@x.com']);
  assert.deepEqual(plain(merged.added), ['new@x.com', 'new2@x.com']);
  assert.equal(merged.duplicates, 1);
});

test('blacklist disable batching: 2500 ids split 1000/1000/500, 1000 stays whole', () => {
  const ids = Array.from({ length: 2500 }, (_, i) => i + 1);
  const chunks = chunkUserIds(ids);
  assert.deepEqual(plain(chunks.map(c => c.length)), [1000, 1000, 500]);
  assert.equal(chunks[2][0], 2001);
  assert.equal(chunkUserIds([1, 2]).length, 1);
});

// ── 2. API 路由与请求体（夹具） ──────────────────────────────────
test('admin access keys API: list/create/update/rotate/revoke/deleteRecord routes', async () => {
  const f = modules(async () => ({ items: [], permissions: [] }));
  const api = f.load('api/admin/adminAccessKeys.ts');
  await api.list();
  await api.create({ name: 'k', description: '', enabled: true, expires_at: null, allowed_ips: [], policy: { rules: [], global_permissions: [] }, confirm_full_access: true });
  await api.update('abc', { name: 'k', description: '', enabled: false, expires_at: null, allowed_ips: [], policy: { rules: [], global_permissions: [] } });
  await api.rotate('abc');
  await api.revoke('abc');
  await api.deleteRecord('abc');
  assert.deepEqual(f.calls.map(c => [c.method, c.url]), [
    ['get', '/admin/settings/admin-api-keys'],
    ['post', '/admin/settings/admin-api-keys'],
    ['put', '/admin/settings/admin-api-keys/abc'],
    ['post', '/admin/settings/admin-api-keys/abc/rotate'],
    ['delete', '/admin/settings/admin-api-keys/abc'],
    ['delete', '/admin/settings/admin-api-keys/abc/record']
  ]);
  assert.equal(f.calls[1].payload.confirm_full_access, true);
  assert.equal(f.calls[2].payload.enabled, false);
});

test('registration blacklist API: get + full-replace PUT payload', async () => {
  const f = modules(async () => ({ emails: ['a@x.com'], max: 20000 }));
  const api = f.load('api/admin/settings.ts');
  const got = await api.getRegistrationEmailBlacklist();
  assert.equal(got.max, 20000);
  await api.updateRegistrationEmailBlacklist(['a@x.com', 'b@x.com']);
  assert.deepEqual(f.calls, [
    { method: 'get', url: '/admin/settings/registration-email-blacklist', payload: null },
    { method: 'put', url: '/admin/settings/registration-email-blacklist', payload: { emails: ['a@x.com', 'b@x.com'] } }
  ]);
});

test('users blacklist APIs: find matches + batch disable payloads', async () => {
  const f = modules(async () => ({ items: [], total: 0, affected: 3 }));
  const api = f.load('api/admin/users.ts');
  await api.findBlacklistedEmailUsers(['a@x.com']);
  await api.batchDisable([1, 2, 3]);
  assert.deepEqual(f.calls, [
    { method: 'post', url: '/admin/users/blacklist-matches', payload: { emails: ['a@x.com'] } },
    { method: 'post', url: '/admin/users/batch-disable', payload: { user_ids: [1, 2, 3] } }
  ]);
});

test('opencode GO global settings API: get + put exact payload', async () => {
  const f = modules(async () => ({ enabled: true, interval_minutes: 60, debounce_minutes: 5 }));
  const api = f.load('api/admin/accounts.ts');
  const got = await api.getOpenCodeGoUsageSettings();
  assert.deepEqual(plain(got), { enabled: true, interval_minutes: 60, debounce_minutes: 5 });
  await api.updateOpenCodeGoUsageSettings({ enabled: false, interval_minutes: 120, debounce_minutes: 10 });
  assert.deepEqual(f.calls, [
    { method: 'get', url: '/admin/accounts/opencode-go-usage/settings', payload: null },
    { method: 'put', url: '/admin/accounts/opencode-go-usage/settings', payload: { enabled: false, interval_minutes: 120, debounce_minutes: 10 } }
  ]);
});

// ── 3. SFC 模板编译 ─────────────────────────────────────────────
test('all owned settings 1.1.3 templates compile using the real SFC compiler', () => {
  for (const name of ['apps/user/settings/AdminAccessKeysPanel.vue', 'apps/user/settings/RegistrationEmailBlacklistPanel.vue', 'apps/user/settings/OpenCodeGoUsagePanel.vue', 'apps/user/SettingsApp.vue']) {
    const filename = path.join(src, name);
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(errors, []);
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { expressionPlugins: ['typescript'] } }).errors, []);
  }
});

// ── 4. OpenCode GO 面板行为 ─────────────────────────────────────
function opencodeFixture(overrides = {}) {
  const calls = [];
  const settings = { enabled: true, interval_minutes: 60, debounce_minutes: 5 };
  const api = {
    getOpenCodeGoUsageSettings: async () => ({ ...settings }),
    updateOpenCodeGoUsageSettings: async next => { calls.push(plain(next)); Object.assign(settings, next); return { ...settings }; },
    ...overrides
  };
  const f = component('apps/user/settings/OpenCodeGoUsagePanel.vue', {
    getOpenCodeGoUsageSettings: (...args) => api.getOpenCodeGoUsageSettings(...args),
    updateOpenCodeGoUsageSettings: (...args) => api.updateOpenCodeGoUsageSettings(...args)
  });
  return { ...f, api, calls, settings };
}

test('opencode panel: load fills form; invalid ranges never post; save failure keeps draft', async () => {
  const f = opencodeFixture();
  await f.s.load();
  assert.equal(f.s.loaded.value, true);
  assert.equal(f.s.form.value.debounce_minutes, 5);
  for (const bad of [{ debounce_minutes: 0 }, { debounce_minutes: 61 }, { debounce_minutes: 60, interval_minutes: 60 }, { interval_minutes: 4 }, { interval_minutes: 1441 }]) {
    Object.assign(f.s.form.value, bad);
    await f.s.save();
    assert.match(f.s.error.value, /分钟|必须小于/);
  }
  assert.equal(f.calls.length, 0);
  Object.assign(f.s.form.value, { debounce_minutes: 10, interval_minutes: 120 });
  await f.s.save();
  assert.deepEqual(f.calls[0], { enabled: true, interval_minutes: 120, debounce_minutes: 10 });
  assert.match(f.s.message.value, /已保存/);
  f.api.updateOpenCodeGoUsageSettings = async () => { throw { message: '后端拒绝' }; };
  f.s.form.value.debounce_minutes = 20;
  await f.s.save();
  assert.equal(f.s.error.value, '后端拒绝');
  assert.equal(f.s.form.value.debounce_minutes, 20);
  f.dispose();
});

// ── 5. 黑名单面板行为 ───────────────────────────────────────────
function blacklistFixture(overrides = {}) {
  const calls = [];
  let saved = ['saved@x.com'];
  const users = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, email: `u${i + 1}@x.com`, username: `u${i + 1}` }));
  const api = {
    getRegistrationEmailBlacklist: async () => ({ emails: [...saved], max: 20000 }),
    updateRegistrationEmailBlacklist: async emails => {
      calls.push(['put', plain(emails)]);
      const added = emails.filter(e => !saved.includes(e));
      saved = [...emails];
      return { emails: [...saved], max: 20000, added };
    },
    findBlacklistedEmailUsers: async () => ({ items: [], total: 0 }),
    batchDisable: async ids => { calls.push(['disable', plain(ids)]); return { affected: ids.length }; },
    ...overrides
  };
  const f = component('apps/user/settings/RegistrationEmailBlacklistPanel.vue', {
    getRegistrationEmailBlacklist: (...args) => api.getRegistrationEmailBlacklist(...args),
    updateRegistrationEmailBlacklist: (...args) => api.updateRegistrationEmailBlacklist(...args),
    findBlacklistedEmailUsers: (...args) => api.findBlacklistedEmailUsers(...args),
    batchDisable: (...args) => api.batchDisable(...args),
    parseBlacklistInput, mergeIntoBlacklist, chunkUserIds,
    BLACKLIST_VISIBLE_LIMIT: 200, DISABLE_BATCH_SIZE: 1000
  });
  return { ...f, api, calls, users, get saved() { return saved; } };
}

test('blacklist panel: bulk add parses, invalid stays in input, save full-replaces and auto-checks added', async () => {
  const f = blacklistFixture();
  await f.s.load();
  assert.equal(f.s.loaded.value, true);
  f.s.openEditor();
  f.s.bulkInput.value = 'New@X.com, saved@x.com; bad-token\nsecond@x.com';
  f.s.addBulk();
  assert.deepEqual(plain(f.s.draft.value), ['new@x.com', 'second@x.com', 'saved@x.com']);
  assert.equal(f.s.bulkInput.value, 'bad-token');
  assert.match(f.s.bulkFeedback.value, /新增 2 个/);
  assert.match(f.s.bulkFeedback.value, /1 个格式无效/);
  let checked = null;
  f.api.findBlacklistedEmailUsers = async emails => { checked = plain(emails); return { items: [], total: 0 }; };
  await f.s.saveDraft();
  assert.deepEqual(f.calls[0], ['put', ['new@x.com', 'second@x.com', 'saved@x.com']]);
  assert.equal(f.s.editorOpen.value, false);
  assert.match(f.s.notice.value, /黑名单已保存，共 3 个邮箱/);
  assert.deepEqual(checked, ['new@x.com', 'second@x.com']);
  f.dispose();
});

test('blacklist panel: save failure keeps draft open; disable batches 1000 and resumes from breakpoint', async () => {
  let failPut = true;
  const f = blacklistFixture({
    updateRegistrationEmailBlacklist: async emails => { if (failPut) throw { message: '后端拒绝' }; return { emails: plain(emails), max: 20000, added: [] }; }
  });
  await f.s.load();
  f.s.openEditor();
  f.s.draft.value = ['a@x.com'];
  await f.s.saveDraft();
  assert.equal(f.s.editorOpen.value, true);
  assert.equal(f.s.editorError.value, '后端拒绝');
  assert.deepEqual(plain(f.s.draft.value), ['a@x.com']);
  failPut = false;
  await f.s.saveDraft();
  assert.equal(f.s.editorOpen.value, false);

  // 2500 命中用户：分 3 批；第 2 批失败时只剩 1500 人可重试。
  let disables = 0;
  f.api.batchDisable = async ids => {
    disables++;
    if (disables === 2) throw { message: '第二批失败' };
    return { affected: ids.length };
  };
  f.s.matchedUsers.value = plain(f.users);
  f.s.disableOpen.value = true;
  await f.s.disableMatchedUsers();
  assert.equal(f.s.matchedUsers.value.length, 1500);
  assert.match(f.s.disableError.value, /第二批失败/);
  assert.equal(f.s.disableOpen.value, true);
  await f.s.disableMatchedUsers();
  assert.equal(f.s.matchedUsers.value.length, 0);
  // 上游同款：affected 只累计单次调用内成功的批次，重试成功提示为本次的 1500 人。
  assert.match(f.s.notice.value, /已禁用 1,500 个用户/);
  f.dispose();
});

// ── 6. 管理员密钥面板行为 ───────────────────────────────────────
function keysFixture(overrides = {}) {
  const calls = [];
  const key = {
    id: 'k1', name: 'ops', description: '', enabled: true, expires_at: null, allowed_ips: [],
    key_prefix: 'sk-admin-abcd', created_by: 8, created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z', last_used_at: null, last_used_ip: '',
    revoked_at: null, policy: { rules: [], global_permissions: [] }
  };
  const api = {
    list: async () => ({
      items: [plain(key)],
      permissions: [
        { id: 'accounts.read', label: '查看账户（脱敏）', category: '账户', scope: 'account' },
        { id: 'groups.models.write', label: '编辑所选分组模型白名单', category: '分组模型', scope: 'group' },
        { id: 'system.read', label: '读取系统版本', category: '系统', scope: 'global' }
      ]
    }),
    create: async input => { calls.push(['create', plain(input)]); return { key: 'sk-admin-full-secret', item: { ...plain(key), id: 'k2', name: input.name } }; },
    update: async (id, input) => { calls.push(['update', id, plain(input)]); return { ...plain(key), id, ...plain(input) }; },
    rotate: async id => { calls.push(['rotate', id]); return { key: 'sk-admin-rotated', item: { ...plain(key), id } }; },
    revoke: async id => { calls.push(['revoke', id]); return { message: 'ok' }; },
    deleteRecord: async id => { calls.push(['delete', id]); return { message: 'ok' }; },
    ...overrides
  };
  const stepUp = {
    visible: vue.ref(false), verifying: vue.ref(false), code: vue.ref(''), error: vue.ref(''),
    verify: async () => {}, cancel: () => { stepUp.visible.value = false; },
    run: async action => action()
  };
  const f = component('apps/user/settings/AdminAccessKeysPanel.vue', {
    adminAccessKeysAPI: api,
    getAllIncludingInactive: async () => [{ id: 3, name: 'ccmax' }],
    listPlatformIds: () => ['openai', 'anthropic'],
    platformDisplayName: id => id,
    usePluginStepUp: () => stepUp
  });
  return { ...f, api, calls, key, stepUp };
}

test('admin keys panel: load normalizes nulls, status and rule summary follow upstream', async () => {
  const f = keysFixture();
  await f.s.load();
  assert.equal(f.s.loaded.value, true);
  assert.equal(f.s.items.value[0].key_prefix, 'sk-admin-abcd');
  assert.equal(f.s.groups.value[0].name, 'ccmax');
  assert.equal(f.s.status(f.s.items.value[0]), '已启用');
  assert.equal(f.s.status({ ...f.s.items.value[0], revoked_at: '2026-01-02T00:00:00Z' }), '已撤销');
  assert.equal(f.s.status({ ...f.s.items.value[0], enabled: false }), '已停用');
  assert.equal(f.s.status({ ...f.s.items.value[0], expires_at: '2020-01-01T00:00:00Z' }), '已过期');
  const rule = { permissions: ['accounts.read'], group_ids: [3], all_groups: false, include_ungrouped: true, account_types: ['oauth'], platforms: [] };
  assert.equal(f.s.ruleSummary(rule), 'ccmax，含未分组；账户类型：oauth（仅限制账户操作）；平台：不限平台；操作：1 项');
  assert.equal(f.s.ruleSummary({ ...rule, all_groups: true, group_ids: [], account_types: [], platforms: ['openai'] }), '所有分组（含未来分组），含未分组；账户类型：未选择类型（无账户权限）（仅限制账户操作）；平台：openai；操作：1 项');
  f.dispose();
});

test('admin keys panel: full-access phrase gate, create payload, secret shown once, save failure keeps draft', async () => {
  const f = keysFixture();
  await f.s.load();
  f.s.edit();
  assert.equal(f.s.draft.value.name, '');
  f.s.draft.value.name = '  ops-new  ';
  f.s.draft.value.policy.rules[0].permissions = ['accounts.read'];
  f.s.ips.value = '192.0.2.1\n2001:db8::/32, 10.0.0.1';
  // 全权确认：错词不生效，逐字正确才开启。
  f.s.fullAccessPrompt.value = true;
  f.s.fullAccessPhrase.value = '开启全权';
  f.s.confirmFullAccess();
  assert.equal(f.s.draft.value.policy.full_access, undefined);
  f.s.fullAccessPhrase.value = '开启全权访问';
  f.s.confirmFullAccess();
  assert.equal(f.s.draft.value.policy.full_access, true);
  assert.equal(f.s.fullAccessPrompt.value, false);
  await f.s.save();
  assert.equal(f.calls[0][0], 'create');
  assert.equal(f.calls[0][1].name, 'ops-new');
  assert.equal(f.calls[0][1].confirm_full_access, true);
  assert.deepEqual(f.calls[0][1].allowed_ips, ['192.0.2.1', '2001:db8::/32', '10.0.0.1']);
  assert.equal(f.s.secret.value, 'sk-admin-full-secret');
  assert.equal(f.s.draft.value, null);
  assert.match(f.s.notice.value, /密钥已保存/);
  await f.s.copySecret();
  assert.deepEqual(f.copied, ['sk-admin-full-secret']);

  // 保存失败保留草稿。
  f.api.create = async () => { throw { message: '后端拒绝' }; };
  f.s.edit();
  f.s.draft.value.name = 'kept';
  await f.s.save();
  assert.equal(f.s.draft.value.name, 'kept');
  assert.equal(f.s.error.value, '后端拒绝');
  f.dispose();
});

test('admin keys panel: rotate/revoke/deleteRecord go through confirm state, revoked keys only delete', async () => {
  const f = keysFixture();
  await f.s.load();
  const item = f.s.items.value[0];
  f.s.requestAction('rotate', item);
  assert.equal(f.s.pendingAction.value.kind, 'rotate');
  assert.match(f.s.pendingMessage(), /轮换“ops”将立即使原密钥失效/);
  await f.s.confirmPendingAction();
  assert.deepEqual(f.calls[0], ['rotate', 'k1']);
  assert.equal(f.s.secret.value, 'sk-admin-rotated');
  f.s.requestAction('revoke', item);
  await f.s.confirmPendingAction();
  assert.deepEqual(f.calls[1], ['revoke', 'k1']);
  assert.equal(f.s.items.value[0].revoked_at.length > 0, true);
  f.s.requestAction('delete', f.s.items.value[0]);
  await f.s.confirmPendingAction();
  assert.deepEqual(f.calls[2], ['delete', 'k1']);
  assert.equal(f.s.items.value.length, 0);
  f.dispose();
});
