// Run from workspace: node --test packages/sub2-console/src/apps/user/settings/__tests__/final-fixes.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const pkg = path.resolve(__dirname, '../../../../..'), root = path.resolve(pkg, '../..');
const local = createRequire(path.join(pkg, 'package.json'));
const ts = local('typescript'), vue = local('vue'), sfc = local('vue/compiler-sfc');
const dir = path.resolve(__dirname, '..');
const { protection } = require(path.join(root, 'scripts/payment-write-fixture.cjs'));
const plain = v => JSON.parse(JSON.stringify(v));
function moduleSource(file) {
  const out = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { exports: out.exports, module: out, URL });
  return out.exports;
}
const form = moduleSource(path.join(dir, 'settingsForm.ts')), provider = moduleSource(path.join(dir, 'paymentProviderForm.ts'));
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(file, api = {}, extra = {}) {
  let source = sfc.parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const auth = vue.reactive({ user: { id: 99 }, token: 'fixture-only', isAdmin: true }), unmounted = [], stops = [];
  const protectedWrites = protection({ vue: { watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); return stop; } } });
  const context = { ...vue, ...form, ...provider, ...extra, useAuthStore: () => auth, useSystemStore: () => ({}), defineProps: () => ({}),
    settingsAPI: api, adminPaymentAPI: api, usePaymentWriteGuard: protectedWrites.usePaymentWriteGuard, normalizeAccountSchedulingThresholdsMap: () => ({}), extraWallpapers: [],
    watch: (...args) => { const stop = vue.watch(...args); stops.push(stop); return stop; },
    onMounted() {}, onUnmounted: fn => unmounted.push(fn), setTimeout() {}, clearTimeout() {},
    location: { origin: 'https://fixture.invalid' }, fetch() { throw Error('Network forbidden'); }, URL, console };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = {${names.join(',')}};`, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText, context);
  return { s: context.subject, auth, close() { protectedWrites.close(); unmounted.forEach(fn => fn()); stops.forEach(fn => fn()); } };
}
const settings = api => fixture(path.join(dir, '../SettingsApp.vue'), api);
const panel = api => fixture(path.join(dir, 'PaymentProvidersPanel.vue'), api);
const smtpBase = () => ({ smtp_host: 'smtp.fixture.invalid', smtp_port: 587, smtp_username: 'fixture', smtp_from_email: 'fixture@example.invalid', smtp_from_name: 'Fixture', smtp_use_tls: true, smtp_password_configured: true });
const paymentBase = () => ({ payment_enabled: false, payment_min_amount: 1, payment_max_amount: 500, payment_daily_limit: 1000, payment_order_timeout_minutes: 30, payment_max_pending_orders: 3, payment_balance_disabled: false, payment_balance_recharge_multiplier: 1, payment_subscription_usd_to_cny_rate: 0, payment_recharge_fee_rate: 0, payment_load_balance_strategy: 'round-robin', payment_enabled_types: ['stripe'], payment_product_name_prefix: '', payment_product_name_suffix: '', payment_help_image_url: '', payment_help_text: '', payment_cancel_rate_limit_enabled: false, payment_cancel_rate_limit_max: 3, payment_cancel_rate_limit_window: 1, payment_cancel_rate_limit_unit: 'hour', payment_cancel_rate_limit_window_mode: 'rolling' });
const sample = (id = 1) => ({ id, provider_key: 'stripe', name: 'Fixture ' + id, config: { publishableKey: 'pk_fixture', currency: 'CNY' }, supported_types: ['card'], enabled: true, payment_mode: '', refund_enabled: false, allow_user_refund: false, limits: '', sort_order: id - 1 });

test('settings and provider templates compile, native sheet protects cancellation, provider stays mounted across tabs', () => {
  for (const name of ['../SettingsApp.vue', 'PaymentSettingsPanel.vue', 'PaymentProvidersPanel.vue']) {
    const filename = path.join(dir, name), { descriptor, errors } = sfc.parse(fs.readFileSync(filename, 'utf8'));
    assert.deepEqual(errors, []); const script = sfc.compileScript(descriptor, { id: name });
    assert.deepEqual(sfc.compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { bindingMetadata: script.bindings } }).errors, []);
  }
  const ui = fs.readFileSync(path.join(dir, 'PaymentProvidersPanel.vue'), 'utf8');
  assert.match(ui, /protect-changes :dirty="dirty"/); assert.match(ui, /#footer="\{ close \}"/); assert.match(ui, /@click="close">取消/);
  assert.match(fs.readFileSync(path.join(dir, '../SettingsApp.vue'), 'utf8'), /PaymentProvidersPanel v-if="authStore.isAdmin" v-show=/);
});
test('all payment settings writable keys exist in official request DTO, provider metadata matches official fields and supported types', (t) => {
  const upstream = path.join(root, 'output/upstream-current-20260912');
  if (!fs.existsSync(path.join(upstream, 'backend/internal/handler/admin/setting_handler_update.go'))) { t.skip('Optional official checkout is not part of the source archive'); return; }
  const dto = fs.readFileSync(path.join(upstream, 'backend/internal/handler/admin/setting_handler_update.go'), 'utf8').split('func ')[0];
  for (const key of form.settingsFields.admin_payment) assert(dto.includes(`json:"${key}"`), key);
  const official = moduleSource(path.join(upstream, 'frontend/src/components/payment/providerConfig.ts'));
  assert.deepEqual(plain(provider.providerTypes), plain(official.PROVIDER_SUPPORTED_TYPES));
  for (const [key, fields] of Object.entries(provider.providerFields)) assert.deepEqual(plain(fields.map(f => ({ key: f.key, secret: !!f.secret, optional: !!f.optional, defaultValue: f.defaultValue || '' }))), plain(official.PROVIDER_CONFIG_FIELDS[key].map(f => ({ key: f.key, secret: !!f.sensitive, optional: !!f.optional, defaultValue: f.defaultValue || '' }))));
});
test('read discards secrets and future fields; configured flags are read-only', () => {
  const copied = form.copySettings({ ...smtpBase(), smtp_password: 'DO-NOT-RETAIN', turnstile_secret_key: 'DO-NOT-RETAIN', unknown: 1 });
  assert(!JSON.stringify(copied).includes('DO-NOT-RETAIN')); assert.equal(copied.smtp_password_configured, true);
  assert.deepEqual(plain(form.settingsPatch('admin_email', copied, copied)), {});
});
for (const [tab, key] of Object.entries(form.secretFields)) {
  test(`${key}: blank and whitespace preserve; nonempty only submitted in matching tab`, () => {
    const saved = { [`${key}_configured`]: true };
    for (const value of ['', '  \t']) assert.deepEqual(plain(form.settingsSecretPatch(tab, { ...form.emptySettingsSecrets(), [key]: value }, saved)), {});
    const draft = { ...form.emptySettingsSecrets(), [key]: 'new-fixture-secret' };
    assert.deepEqual(plain(form.settingsSecretPatch(tab, draft, saved)), { [key]: draft[key] });
    assert.deepEqual(plain(form.settingsSecretPatch('admin_payment', draft, saved)), {});
    assert.throws(() => form.settingsSecretPatch(tab, draft, {}), /状态/);
  });
}
test('SMTP tests use newly typed secret or empty stored-secret sentinel and reject invalid port', () => {
  const base = smtpBase();
  for (const value of ['', '   ', 'new-fixture-secret']) assert.equal(form.smtpTestPayload(base, { ...form.emptySettingsSecrets(), smtp_password: value }, base).smtp_password, value.trim() ? value : '');
  for (const port of [0, 65536, 1.1, '587', NaN]) assert.throws(() => form.smtpTestPayload({ ...base, smtp_port: port }, form.emptySettingsSecrets(), base), /端口/);
});
test('payment patch sends only changed official fields, retains future enabled types and refuses unread defaults', () => {
  const base = paymentBase(), draft = { ...base, payment_min_amount: 3, payment_max_pending_orders: 5, payment_load_balance_strategy: 'least-amount' };
  assert.deepEqual(plain(form.settingsPatch('admin_payment', draft, base)), { payment_min_amount: 3, payment_max_pending_orders: 5, payment_load_balance_strategy: 'least-amount' });
  assert.throws(() => form.settingsPatch('admin_payment', draft, {}), /完整模块/);
  const future = { ...base, payment_load_balance_strategy: 'future', payment_enabled_types: ['stripe', 'future'] };
  assert.deepEqual(plain(form.settingsPatch('admin_payment', { ...future, payment_daily_limit: 0 }, future)), { payment_daily_limit: 0 });
});
for (const [key, value] of [['payment_min_amount', 501], ['payment_daily_limit', -1], ['payment_order_timeout_minutes', 0], ['payment_max_pending_orders', 2.5], ['payment_recharge_fee_rate', 101], ['payment_balance_recharge_multiplier', 0], ['payment_load_balance_strategy', 'random'], ['payment_min_amount', ''], ['payment_max_amount', NaN]]) test(`invalid payment ${key}=${value} blocked`, () => assert.throws(() => form.settingsPatch('admin_payment', { ...paymentBase(), [key]: value }, paymentBase())));
test('SMTP save success clears only submitted secret and verifies configured flag', async () => {
  const writes = []; const { s, close } = settings({ getSettings: async () => smtpBase(), updateSettings: async p => { writes.push(plain(p)); return smtpBase(); } });
  await s.loadAdminSettings(); s.activeTab.value = 'admin_email'; s.settingsSecrets.value.smtp_password = 'new-fixture';
  await s.saveAdminSettings(); assert.deepEqual(writes, [{ smtp_password: 'new-fixture' }]); assert.equal(s.settingsSecrets.value.smtp_password, ''); assert.equal(s.adminSettingsReady.value, true); close();
});
test('SMTP save preserves edits made during pending save and unsubmitted other-tab secrets', async () => {
  const pending = defer(); const { s, close } = settings({ getSettings: async () => smtpBase(), updateSettings: () => pending.promise });
  await s.loadAdminSettings(); s.activeTab.value = 'admin_email'; s.settingsSecrets.value.smtp_password = 'sent'; s.settingsSecrets.value.turnstile_secret_key = 'other';
  const saving = s.saveAdminSettings(); s.settingsSecrets.value.smtp_password = 'newer'; pending.resolve(smtpBase()); await saving;
  assert.equal(s.settingsSecrets.value.smtp_password, 'newer'); assert.equal(s.settingsSecrets.value.turnstile_secret_key, 'other'); close();
});
for (const response of ['timeout', 'missing', 'not-configured']) test(`settings ${response} blocks duplicate write and never echoes secrets`, async () => {
  let writes = 0; const { s, close } = settings({ getSettings: async () => smtpBase(), updateSettings: async () => { writes++; if (response === 'timeout') throw { status: 0, message: 'PRIVATE-ECHO' }; return response === 'missing' ? {} : { ...smtpBase(), smtp_password_configured: false }; } });
  await s.loadAdminSettings(); s.activeTab.value = 'admin_email'; s.settingsSecrets.value.smtp_password = 'PRIVATE-ECHO';
  await s.saveAdminSettings(); await s.saveAdminSettings(); assert.equal(writes, 1); assert.equal(s.adminSettingsReady.value, false); assert(!s.saveToast.value.includes('PRIVATE-ECHO')); assert.equal(s.settingsSecrets.value.smtp_password, 'PRIVATE-ECHO'); close();
});
test('SMTP actual handlers deliver draft credentials, no duplicate while pending, and late result after logout is ignored', async () => {
  const pending = defer(), calls = []; const { s, auth, close } = settings({ getSettings: async () => smtpBase(), testSmtpConnection: async p => { calls.push(plain(p)); return pending.promise; }, sendTestEmail: async p => { calls.push(plain(p)); return {}; } });
  await s.loadAdminSettings(); s.settingsSecrets.value.smtp_password = 'new-fixture';
  const run = s.handleTestSmtpConnection(); await s.handleTestSmtpConnection(); assert.equal(calls.length, 1); assert.equal(calls[0].smtp_password, 'new-fixture');
  pending.resolve({}); await run; s.settingsSecrets.value.smtp_password = ''; s.testEmailAddress.value = 'test@example.invalid'; await s.handleSendTestEmail(); assert.equal(calls[1].smtp_password, ''); assert.equal(calls[1].email, 'test@example.invalid');
  auth.isAdmin = false; await s.handleSendTestEmail(); assert.equal(calls.length, 2); assert.equal(s.settingsSecrets.value.smtp_password, ''); close();
});
test('SMTP test unknown result blocks a second send, omits server error echoes', async () => {
  let writes = 0; const { s, close } = settings({ getSettings: async () => smtpBase(), sendTestEmail: async () => { writes++; throw { status: 0, message: 'SECRET-ECHO' }; } });
  await s.loadAdminSettings(); s.testEmailAddress.value = 'fixture@example.invalid'; await s.handleSendTestEmail(); await s.handleSendTestEmail(); assert.equal(writes, 1); assert(!s.saveToast.value.includes('SECRET-ECHO')); close();
});
test('settings loading failure and stale identity response cannot enable writes', async () => {
  const pending = defer(); let writes = 0; const { s, auth, close } = settings({ getSettings: () => pending.promise, updateSettings: async () => writes++ });
  const run = s.loadAdminSettings(); auth.isAdmin = false; pending.resolve(smtpBase()); await run; await s.saveAdminSettings(); assert.equal(s.adminSettingsReady.value, false); assert.equal(writes, 0); close();
});
test('provider read normalizes null types and strips secret/server config including unexpected secret response', () => {
  const normalized = provider.normalizeProviders([{ ...sample(), supported_types: null, config: { ...sample().config, secretKey: 'PRIVATE', webhookSecret: 'PRIVATE', unknown: 'PRIVATE' }, encrypted_config: 'PRIVATE' }]);
  assert.deepEqual(plain(normalized[0].supported_types), []); assert(!JSON.stringify(normalized).includes('PRIVATE'));
  for (const raw of [null, {}, [sample(), sample()], [{ ...sample(), config: [] }]]) assert.throws(() => provider.normalizeProviders(raw));
});
test('provider edit is a patch, blanks omit secrets, explicit optional clear supported, unknown data never written', () => {
  const baseline = sample(), draft = provider.editProvider(baseline); draft.name = 'Changed'; draft.config.secretKey = '  '; draft.config.unknown = 'must-not-write';
  assert.deepEqual(plain(provider.providerPayload(draft, baseline)), { name: 'Changed' });
  draft.config.secretKey = 'new-fixture'; assert.equal(provider.providerPayload(draft, baseline).config.secretKey, 'new-fixture');
  const air = { ...sample(), provider_key: 'airwallex', config: { clientId: 'fixture', apiBase: 'https://api.airwallex.com/api/v1', countryCode: 'CN', currency: 'CNY', accountId: 'old' } };
  assert.deepEqual(plain(provider.providerPayload({ ...air, config: { ...air.config, accountId: '' } }, air)), { config: { accountId: '' } });
});
test('provider update preserves unknown types and limits, permits empty supported types and cascades refund off', () => {
  const base = { ...sample(), supported_types: ['future'], limits: '{"future":{"futureLimit":42}}', refund_enabled: true, allow_user_refund: true };
  const draft = provider.editProvider(base); draft.supported_types = []; draft.refund_enabled = false;
  assert.deepEqual(plain(provider.providerPayload(draft, base)), { supported_types: [], refund_enabled: false, allow_user_refund: false });
});
test('provider limits invalid input and min/max are blocked; custom method mapping stays a config JSON string', () => {
  const base = sample();
  for (const limits of ['[]', '{', '{"stripe":{"singleMin":-1}}', '{"stripe":{"singleMin":5,"singleMax":2}}']) assert.throws(() => provider.providerPayload({ ...base, limits }, base));
  const draft = provider.newProvider('easypay', 4, 'https://fixture.invalid'); draft.name = 'Custom'; draft.enabled = false; draft.config.customMethods = '[{"type":"custom","upstreamType":"bank","displayName":"自定义"}]'; draft.supported_types.push('custom');
  const payload = provider.providerPayload(draft, null); assert.equal(typeof payload.config.customMethods, 'string'); assert.equal(payload.sort_order, 4); assert.equal(payload.config.notifyUrl, 'https://fixture.invalid/api/v1/payment/webhook/easypay');
});
test('pasted multiline PEM stays intact in the masked editor payload', async () => {
  let payload;
  const row = { ...sample(), provider_key: 'alipay', config: { appId: 'fixture', notifyUrl: 'https://fixture.invalid/api/v1/payment/webhook/alipay', returnUrl: 'https://fixture.invalid/payment/result' }, supported_types: ['alipay'] };
  const { s, close } = panel({ getProviders: async () => ({ data: [row] }), updateProvider: async (id, p) => { payload = plain(p); return { data: { id } }; } });
  await s.load(); s.open(s.providers.value[0]);
  const pem = '-----BEGIN PRIVATE KEY-----\nfixture-not-a-real-key\n-----END PRIVATE KEY-----'; let prevented = false;
  s.pasteSecret('privateKey', { clipboardData: { getData: () => pem }, preventDefault() { prevented = true; } }); await s.save();
  assert.equal(prevented, true); assert.equal(payload.config.privateKey, pem); close();
});
test('all five providers create complete official typed payloads, new enabled providers require secrets', () => {
  for (const key of Object.keys(provider.providerTypes)) {
    const draft = provider.newProvider(key, 0, 'https://fixture.invalid'); draft.name = key;
    assert.throws(() => provider.providerPayload(draft, null), /填写/);
    for (const field of provider.configFields(key)) if (!draft.config[field.key]) draft.config[field.key] = 'fixture';
    const payload = provider.providerPayload(draft, null);
    assert.equal(payload.provider_key, key); assert.deepEqual(plain(payload.supported_types), plain(provider.providerTypes[key]));
    assert.equal(typeof payload.limits, 'string'); assert.equal(payload.allow_user_refund, false);
  }
});
test('provider confirmed write with failed reload and unknown delete cannot be replayed', async () => {
  let reads = 0, writes = 0;
  const a = panel({ getProviders: async () => { if (++reads > 1) throw { status: 503 }; return { data: [sample()] }; }, updateProvider: async id => { writes++; return { data: { id } }; } });
  await a.s.load(); a.s.open(a.s.providers.value[0]); a.s.draft.value.name = 'Changed'; await a.s.save(); await a.s.save(); assert.equal(writes, 1); assert.equal(a.s.unknown.value, true); a.close();
  const b = panel({ getProviders: async () => ({ data: [sample()] }), deleteProvider: async () => { writes++; throw { status: 0 }; } });
  await b.s.load(); b.s.askDelete(b.s.providers.value[0]); await b.s.remove(); b.s.askDelete(b.s.providers.value[0]); await b.s.remove(); assert.equal(writes, 2); assert.equal(b.s.ready.value, false); b.close();
});
test('fee precision follows official maximum of two decimals', () => assert.throws(() => form.settingsPatch('admin_payment', { ...paymentBase(), payment_recharge_fee_rate: 1.234 }, paymentBase()), /两位小数/));
test('provider CRUD methods are wired with exact official id/config DTO, reload uses GET, delete requires confirmation state', async () => {
  let rows = [], nextId = 1; const calls = [];
  const api = { getProviders: async () => ({ data: rows }), createProvider: async p => { calls.push(['create', plain(p)]); rows.push({ ...p, id: nextId++ }); return { data: { id: 1, config: 'encrypted-private' } }; }, updateProvider: async (id, p) => { calls.push(['update', id, plain(p)]); rows = rows.map(r => r.id === id ? { ...r, ...p } : r); return { data: { id } }; }, deleteProvider: async id => { calls.push(['delete', id]); rows = rows.filter(r => r.id !== id); return {}; } };
  const { s, close } = panel(api); await s.load(); s.open(); s.draft.value.name = 'Disabled draft'; s.draft.value.enabled = false; await s.save();
  assert.equal(calls[0][0], 'create'); assert.equal(calls[0][1].provider_key, 'easypay'); assert.equal(s.draft.value, null); assert(!JSON.stringify(s.providers.value).includes('encrypted-private'));
  s.open(s.providers.value[0]); s.draft.value.name = 'Edited'; await s.save(); assert.deepEqual(calls[1], ['update', 1, { name: 'Edited' }]);
  await s.remove(); assert.equal(calls.length, 2); s.askDelete(s.providers.value[0]); assert.equal(calls.length, 2); await s.remove(); assert.deepEqual(calls[2], ['delete', 1]); assert.equal(s.providers.value.length, 0); close();
});
test('provider list failure blocks create/delete/reorder and supports explicit retry', async () => {
  let fail = true, writes = 0; const { s, close } = panel({ getProviders: async () => { if (fail) throw Error('PRIVATE'); return { data: [] }; }, createProvider: async () => writes++, deleteProvider: async () => writes++ });
  await s.load(); s.open(); await s.save(); await s.move(sample(), 1); s.askDelete(sample()); await s.remove(); assert.equal(writes, 0); assert.equal(s.draft.value, null); assert(!s.error.value.includes('PRIVATE'));
  fail = false; await s.load(); assert.equal(s.ready.value, true); close();
});
test('provider pending create deduplicates and unknown outcome survives list read until reviewed', async () => {
  const pending = defer(); let writes = 0; const { s, close } = panel({ getProviders: async () => ({ data: [] }), createProvider: async () => { writes++; return pending.promise; } });
  await s.load(); s.open(); s.draft.value.name = 'Unknown'; s.draft.value.enabled = false;
  const run = s.save(); await s.save(); assert.equal(writes, 1); pending.reject({ status: 0, message: 'PRIVATE' }); await run; await s.save(); assert.equal(writes, 1); assert.equal(s.unknown.value, true); assert(!s.error.value.includes('PRIVATE'));
  s.closeEditor(); s.open(); assert.equal(s.draft.value, null); await s.load(); assert.equal(s.unknown.value, true);
  s.askReviewWrite(); await s.confirmReviewWrite(); assert.equal(s.unknown.value, false); close();
});
test('provider 400 retains draft, hides server echo, and allows correction', async () => {
  const { s, close } = panel({ getProviders: async () => ({ data: [sample()] }), updateProvider: async () => { throw { status: 400, message: 'PRIVATE' }; } });
  await s.load(); s.open(s.providers.value[0]); s.draft.value.config.secretKey = 'PRIVATE'; await s.save(); assert.equal(s.draft.value.config.secretKey, 'PRIVATE'); assert.equal(s.unknown.value, false); assert(!s.error.value.includes('PRIVATE')); close();
});
test('provider sorting sends only sort_order, reads new order, no secret or other setting writes', async () => {
  let rows = [sample(1), sample(2)]; const calls = []; const { s, close } = panel({ getProviders: async () => ({ data: rows }), updateProvider: async (id, p) => { calls.push([id, plain(p)]); rows = rows.map(r => r.id === id ? { ...r, ...p } : r); return { data: { id } }; } });
  await s.load(); await s.move(s.providers.value[1], -1); assert.deepEqual(calls, [[2, { sort_order: 0 }], [1, { sort_order: 1 }]]); assert.equal(s.providers.value[0].id, 2); close();
});
test('partial reorder failure blocks another write and honestly reports partial result', async () => {
  let writes = 0; const { s, close } = panel({ getProviders: async () => ({ data: [sample(1), sample(2)] }), updateProvider: async () => { if (++writes === 2) throw { status: 400 }; return {}; } });
  await s.load(); await s.move(s.providers.value[1], -1); await s.move(s.providers.value[1], -1); assert.equal(writes, 2); assert.equal(s.ready.value, false); assert.match(s.error.value, /一部分/); close();
});
test('late provider read and save after close or identity switch cannot publish data or success', async () => {
  const pending = defer(); const a = panel({ getProviders: () => pending.promise }); const run = a.s.load(); a.close(); pending.resolve({ data: [sample()] }); await run; assert.equal(a.s.providers.value.length, 0);
  const saved = defer(); const b = panel({ getProviders: async () => ({ data: [sample()] }), updateProvider: () => saved.promise }); await b.s.load(); b.s.open(b.s.providers.value[0]); b.s.draft.value.name = 'Late'; const save = b.s.save(); b.auth.isAdmin = false; saved.resolve({ data: { id: 1 } }); await save; assert.equal(b.s.draft.value, null); assert.equal(b.s.notice.value, ''); b.close();
});
