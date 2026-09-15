// node --test scripts/parity-public.test.cjs
// Browser: $env:PARITY_PUBLIC_BROWSER='1'; node --test scripts/parity-public.test.cjs
// Optional PARITY_PUBLIC_PLAYWRIGHT points to an installed playwright/core package.
// No server, real API, account writes, or global build. Browser requests are fulfilled locally.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'); const vue = req('vue'); const compiler = req('vue/compiler-sfc');
const files = ['apps/user/ModelPricingSheet.vue', 'public/SafeContent.vue', 'public/KeyUsagePage.vue', 'public/PublicCatalog.vue', 'public/PublicPages.vue', 'public/MonitorV2.vue', 'public/PlazaComparison.vue', 'apps/user/UserAnnouncementsApp.vue'];
const read = file => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
function execute(file, mocks = {}) {
  let source = file.endsWith('.vue') ? compiler.parse(read(file)).descriptor.scriptSetup.content : read(file);
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const cleanup = [];
  const context = { ...vue, exports: {}, URL, URLSearchParams, AbortController, Date, Intl, console,
    watch: () => {}, onMounted: () => {}, onBeforeUnmount: f => cleanup.push(f), defineProps: () => ({}), withDefaults: (p, defaults) => ({ ...defaults, ...p }),
    buildApiUrl: p => '/api/v1' + p, buildGatewayUrl: p => 'https://gateway.invalid' + p,
    fetch: () => { throw Error('Network forbidden'); }, ...mocks };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { s: context.subject, cleanup, context };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const authenticated = () => ({ token: 'account-fixture', isAuthenticated: true, isAdmin: false, user: { id: 1 } });
for (const file of files) test(`${file}: SFC script and template compile`, () => {
  const { descriptor, errors } = compiler.parse(read(file), { filename: file }); assert.deepEqual(errors, []);
  assert.doesNotThrow(() => compiler.compileScript(descriptor, { id: 'public-parity', inlineTemplate: true }));
  assert.deepEqual(compiler.compileTemplate({ source: descriptor.template.content, filename: file, id: 'public-parity' }).errors, []);
});
test('public API uses submitted key, omits cookies/storage, refuses redirects and has no key in URL', async () => {
  let call;
  const { s } = execute('api/public.ts', { fetch: async (...args) => { call = args; return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ balance: 0 }) }; } });
  const result = await s.queryKeyUsage(' fixture-key ', { start_date: '2026-09-01', end_date: '2026-09-11', days: 7, timezone: 'Asia/Shanghai' });
  assert.equal(result.balance, 0); assert.equal(call[1].headers.Authorization, 'Bearer fixture-key');
  assert.equal(call[1].credentials, 'omit'); assert.equal(call[1].redirect, 'error'); assert.equal(call[1].cache, 'no-store');
  assert.ok(!call[0].includes('fixture-key')); assert.equal(new URL(call[0]).searchParams.get('days'), '7');
  await assert.rejects(s.queryKeyUsage('key', { start_date: '2026-09-11', end_date: '2026-09-01', days: 7, timezone: 'UTC' }));
  await assert.rejects(s.getCustomPage('../private')); await assert.rejects(s.getCustomPage('x%2fy'));
});
test('public API rejects HTML fallback, business errors and forbidden responses', async () => {
  for (const response of [
    { ok: true, headers: new Headers({ 'content-type': 'text/html' }) },
    { ok: false, status: 403 },
    { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 3, data: {} }) },
  ]) await assert.rejects(execute('api/public.ts', { fetch: async () => response }).s.getPublicSettings());
});
test('URL and route boundaries reject credentials, schemes, traversal and malformed encodings', () => {
  const { s } = execute('public/content.ts');
  for(const url of ['/home','./help','../docs','?page=2','#安装说明'])assert.equal(s.safeContentUrl(url),url);
  for(const url of ['//evil.test','/%2Fevil.test','javascript:alert(1)','jav%61script:alert(1)','data:text/html,x','/\\evil.test','/%0Aevil'])assert.equal(s.safeContentUrl(url),'');
  for (const value of ['javascript:alert(1)', 'data:text/html,x', '//evil.test', 'https://user:password@evil.test', 'https://good.test\\@evil.test', 'https://good.test\n']) {
    if (value.endsWith('\n')) continue; // trimming surrounding whitespace is intentional
    assert.equal(s.safeExternalUrl(value), '');
  }
  assert.equal(s.safeExternalUrl('https://example.test/path'), 'https://example.test/path');
  for (const url of ['/admin/dashboard', '/', '/custom/..', '/custom/%2e%2e', '/custom/a%2fb', '/legal/%E0%A4%A']) assert.equal(s.resolvePublicRoute(url), null);
  assert.equal(s.resolvePublicRoute('/legal/terms?ignored=1').id, 'terms');
  assert.equal(s.resolvePublicRoute('/monitor').page, 'monitor');
  assert.equal(s.resolvePublicRoute('/available-channels').page, 'available-channels');
});
test('key query double submit, clear, stale success and failure cannot restore secret results', async () => {
  const pending = deferred(); let calls = 0;
  const { s } = execute('public/KeyUsagePage.vue', { queryKeyUsage: () => { calls++; return pending.promise; } });
  s.key.value = 'key'; const first = s.query(); await s.query(); assert.equal(calls, 1);
  s.clear(); pending.resolve({ balance: 123 }); await first;
  assert.equal(s.key.value, ''); assert.equal(s.result.value, null); assert.equal(s.loading.value, false);
  const failed = deferred(); const other = execute('public/KeyUsagePage.vue', { queryKeyUsage: () => failed.promise }).s;
  other.key.value = 'key'; const request = other.query(); other.clear(); failed.reject(Error('secret')); await request;
  assert.equal(other.error.value, '');
});
test('public route change isolates old settings and content; custom pages require identity', async () => {
  const { s: content } = execute('public/content.ts'); const props = { path: '/home' }; const old = deferred(); let count = 0;
  const auth = authenticated();
  const { s } = execute('public/PublicPages.vue', { defineProps: () => props, useAuthStore: () => auth,
    resolvePublicRoute: content.resolvePublicRoute, safeExternalUrl: content.safeExternalUrl,
    getPublicSettings: () => ++count === 1 ? old.promise : Promise.resolve({ site_name: 'new', home_content: 'new' }) });
  const first = s.load(); await s.load(); old.resolve({ home_content: 'OLD' }); await first; assert.equal(s.content.value, 'new');
  const guest = { ...auth, isAuthenticated: false }; let reads = 0;
  const custom = execute('public/PublicPages.vue', { defineProps: () => ({ path: '/custom/docs' }), useAuthStore: () => guest,
    resolvePublicRoute: content.resolvePublicRoute, safeExternalUrl: content.safeExternalUrl,
    getPublicSettings: async () => ({ custom_menu_items: [{ id: 'docs', page_slug: 'docs', visibility: 'user' }] }),
    getCustomPage: () => { reads++; } }).s;
  await custom.load(); assert.equal(custom.restricted.value, true); assert.equal(reads, 0);
});
function announcementFixture(api) {
  const auth = authenticated(); const f = execute('apps/user/UserAnnouncementsApp.vue', { useAuthStore: () => auth, announcementsAPI: api });
  return { ...f, auth };
}
const notice = (id, notify_mode = 'popup') => ({ id, title: 'Notice ' + id, content: '# fixture', notify_mode, created_at: '2026-09-11', updated_at: '2026-09-11' });
test('announcement popup skips silent/read; closing does not write; explicit read advances queue', async () => {
  const calls = []; const f = announcementFixture({ list: async () => [notice(1, 'silent'), notice(2), notice(3)], markRead: async id => { calls.push(id); } });
  await f.s.load(); assert.equal(f.s.selected.value.id, 2); f.s.close(); assert.deepEqual(calls, []);
  f.s.open(f.s.items.value[1]); await f.s.markRead(); assert.deepEqual(calls, [2]); assert.ok(f.s.items.value[1].read_at); assert.equal(f.s.selected.value.id, 3);
});
test('failed announcement acknowledgement retains unread and supports retry', async () => {
  let fail = true; const f = announcementFixture({ list: async () => [notice(1)], markRead: async () => { if (fail) throw Error('fixture'); } });
  await f.s.load(); await f.s.markRead(); assert.equal(f.s.items.value[0].read_at, undefined); assert.ok(f.s.readError.value); assert.equal(f.s.selected.value.id, 1);
  fail = false; await f.s.markRead(); assert.ok(f.s.items.value[0].read_at);
});
test('announcement in-flight acknowledgement deduplicates and ignores account replacement', async () => {
  const pending = deferred(); let count = 0; const f = announcementFixture({ list: async () => [notice(1)], markRead: () => { count++; return pending.promise; } });
  await f.s.load(); const first = f.s.markRead(); await f.s.markRead(); assert.equal(count, 1);
  f.auth.user = { id: 2 }; pending.resolve({}); await first; assert.equal(f.s.items.value[0].read_at, undefined);
});
test('catalog feature/auth gates issue no protected reads; monitor detail close fences response', async () => {
  let reads = 0; const auth = { ...authenticated(), isAuthenticated: false };
  const blocked = execute('public/PublicCatalog.vue', { defineProps: () => ({ page: 'monitor', settings: { channel_monitor_enabled: true } }), useAuthStore: () => auth,
    channelMonitorUserAPI: { list: () => { reads++; } } }).s;
  await blocked.load(); assert.equal(reads, 0); assert.ok(blocked.denied.value);
  const pending = deferred(); const live = execute('public/PublicCatalog.vue', { defineProps: () => ({ page: 'monitor', settings: { channel_monitor_enabled: true } }), useAuthStore: authenticated,
    channelMonitorUserAPI: { status: () => pending.promise } }).s;
  const request = live.inspect(1); live.closeDetail(); pending.resolve({ id: 1, models: [] }); await request;
  assert.equal(live.detail.value, null); assert.equal(live.detailLoading.value, false);
});
test('available channels auth gate and partial rate failure preserve real channel data', async () => {
  let reads = 0; const auth = { ...authenticated(), isAuthenticated: false };
  const mocks = { defineProps: () => ({ page: 'available-channels', settings: { available_channels_enabled: true } }), useAuthStore: () => auth,
    userChannelsAPI: { getAvailable: async () => { reads++; return [{ name: 'fixture', description: '', platforms: [] }]; } },
    userGroupsAPI: { getUserGroupRates: async () => { throw Error('rate failure'); } } };
  const blocked = execute('public/PublicCatalog.vue', mocks).s; await blocked.load(); assert.equal(reads, 0);
  auth.isAuthenticated = true; const live = execute('public/PublicCatalog.vue', mocks).s; await live.load();
  assert.equal(reads, 1); assert.equal(live.channels.value[0].name, 'fixture'); assert.ok(live.ratesError.value); assert.equal(live.error.value, '');
});

const monitorMetric = () => ({ request_count: 10, error_rate: 0.1, cache_rate: 0.2, rpm: 1, tpm: 60, ttft: { sample_count: 5, p50_ms: 100, p90_ms: 200, p95_ms: 240, avg_ms: 110 } });
const monitorHealth = () => ({ overall: 'healthy', error_rate: 'warning', ttft: 'healthy', cache: 'warning', score: 90, error_rate_score: 80, ttft_score: 95, cache_score: 70, minimum_sample: 5 });
const monitorCoverage = () => ({ requested_start: '2026-09-11T00:00:00Z', requested_end: '2026-09-11T00:03:00Z', data_through: '2026-09-11T00:02:00Z', bucket_seconds: 60, coverage_complete: false, aggregation_lag_seconds: 2 });
const monitorSnapshot = () => ({ config: { refresh_interval_seconds: 60 }, coverage: monitorCoverage(), metrics: monitorMetric(), health: monitorHealth(), trend: [{ bucket_start: '2026-09-11T00:00:00Z', metrics: monitorMetric(), health: monitorHealth() }] });
const monitorMatrix = () => ({ coverage: monitorCoverage(), group_by: 'platform_group', items: [{ platform: 'openai', group_id: 1, group_name: '监控夹具组', metrics: monitorMetric(), health: monitorHealth(), buckets: [{ bucket_start: '2026-09-11T00:00:00Z', metrics: monitorMetric(), health: monitorHealth() }] }] });
function monitorFixture(overrides = {}, settings = {}) {
  const calls = []; const timers = new Map(); const auth = vue.reactive(authenticated()); const document = { hidden: false, addEventListener() {}, removeEventListener() {} }; let timerId = 0;
  const api = {
    getDimensions: async () => ({ platforms: [], groups: [], models: [] }), getSnapshot: async () => monitorSnapshot(),
    getMatrix: async () => monitorMatrix(), getModels: async () => ({ items: [] }), getErrors: async () => ({ items: [] }), getUsers: async () => ({ items: [] }), ...overrides,
  };
  for (const name of Object.keys(api)) { const original = api[name]; api[name] = (...args) => { calls.push([name, ...args]); return original(...args); }; }
  const result = execute('public/MonitorV2.vue', { useAuthStore: () => auth,
    defineProps: () => ({ settings: { channel_monitor_enabled: true, channel_monitor_mode: 'v2', ...settings } }), api, document,
    ...execute('public/monitorTimeline.ts').s,
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id) });
  return { ...result, auth, document, calls, timers };
}
test('monitor API preserves repeated filters, grouping, abort signals and user/admin endpoints', async () => {
  const calls = []; const s = execute('api/channelMonitorV2.ts', { apiClient: { get: async (url, config) => { calls.push([url, config]); return { data: {} }; } } }).s;
  const filter = { range: '7d', platforms: ['openai', 'anthropic'], groupIds: [1, 2], models: ['a/b', 'a&b'] }; const abort = new AbortController();
  await s.getMatrix(filter, 'platform_group_model', false, abort.signal); await s.getDimensions(filter, true, abort.signal);
  assert.equal(calls[0][0], '/channel-monitor-v2/matrix'); assert.equal(calls[1][0], '/admin/channel-monitor-v2/dimensions');
  assert.equal(calls[0][1].signal, abort.signal);
  const params = new URLSearchParams(calls[0][1].paramsSerializer.serialize(calls[0][1].params));
  assert.deepEqual(params.getAll('platform'), filter.platforms); assert.deepEqual(params.getAll('group_id'), ['1', '2']); assert.deepEqual(params.getAll('model'), filter.models); assert.equal(params.get('group_by'), 'platform_group_model');
});
test('matrix alignment includes missing history, excludes end, bounds window and handles old coverage', () => {
  const { matrixWindow } = execute('public/monitorTimeline.ts').s;
  const matrix = monitorMatrix(); const result = matrixWindow(matrix.items, matrix.coverage, 0, 60);
  assert.equal(result.count, 3); assert.equal(result.rows[0].slots[0].bucket.bucket_start, '2026-09-11T00:00:00Z'); assert.equal(result.rows[0].slots[1].bucket, undefined);
  const old = { ...matrix.coverage }; delete old.requested_end;
  assert.equal(matrixWindow(matrix.items, old, 0, 60).count, 2);
  assert.equal(matrixWindow([], { ...old, requested_start: 'invalid' }, 0, 60).count, 0);
  assert.equal(matrixWindow(matrix.items, matrix.coverage, 999, 1).begin, 2);
});
test('V2 catalog uses range-only filters; typed filter and grouping reach metrics unchanged', async () => {
  const f = monitorFixture(); f.s.filter.value = { range: '7d', platforms: ['openai'], groupIds: [1], models: ['model'] }; f.s.groupBy.value = 'platform_group_model';
  await f.s.reload(true);
  const dimension = f.calls.find(c => c[0] === 'getDimensions'); assert.equal(dimension[1].platforms.length, 0); assert.equal(dimension[1].models.length, 0); assert.equal(dimension[1].range, '7d');
  const matrix = f.calls.find(c => c[0] === 'getMatrix'); assert.equal(matrix[2], 'platform_group_model'); assert.equal(matrix[1].groupIds[0], 1); assert.equal(matrix[3], false);
  assert.equal(f.s.snapshot.value.metrics.request_count, 10); assert.equal([...f.timers.values()][0].ms, 60000);
});
test('V2 partial failure preserves same-filter result and recovers; old requests cannot overwrite new filters', async () => {
  let fail = false; const f = monitorFixture({ getMatrix: async () => { if (fail) throw Error('fixture'); return monitorMatrix(); } });
  await f.s.reload(); fail = true; await f.s.reload(); assert.equal(f.s.matrix.value.items.length, 1); assert.ok(f.s.errors.value['矩阵']); assert.ok(f.s.snapshot.value);
  fail = false; await f.s.reload(); assert.equal(Object.keys(f.s.errors.value).length, 0);
  const old = deferred(); let count = 0; const race = monitorFixture({ getSnapshot: () => ++count === 1 ? old.promise : Promise.resolve({ ...monitorSnapshot(), marker: 'new' }) });
  const pending = race.s.reload(); const firstSignal = race.calls.find(c => c[0] === 'getSnapshot')[3]; await race.s.reload(true);
  assert.equal(firstSignal.aborted, true); old.resolve({ ...monitorSnapshot(), marker: 'old' }); await pending; assert.equal(race.s.snapshot.value.marker, 'new');
});
test('V2 hidden ranking/throughput, role selection, TTFT and missing samples respect privacy', async () => {
  const f = monitorFixture({}, { channel_monitor_hide_throughput: true, channel_monitor_hide_user_ranking: true }); f.s.tab.value = 'users'; await f.s.reload();
  assert.equal(f.calls.some(c => c[0] === 'getUsers'), false); assert.equal(f.s.showThroughput.value, false); assert.equal(f.s.showUsers.value, false);
  const bucket = { metrics: { ...monitorMetric(), request_count: 0 }, health: monitorHealth() };
  assert.equal(f.s.successRate(bucket.metrics), '90%'); assert.equal(f.s.health(bucket), 'healthy');
  f.s.mode.value = 'ttft'; bucket.metrics.ttft.p50_ms = null; assert.equal(f.s.health(bucket), 'unknown');
  f.auth.isAdmin = true; await f.s.reload(); assert.ok(f.calls.find(c => c[0] === 'getUsers' && c[2] === true));
});
test('V2 bootstrap polling, visibility pause, disable and unmount release only owned timer/request', async () => {
  const f = monitorFixture({ getSnapshot: async () => ({ ...monitorSnapshot(), coverage: { ...monitorCoverage(), bootstrap: { active: true, progress_percent: 30 } } }) });
  await f.s.reload(); assert.equal([...f.timers.values()][0].ms, 10000); assert.equal(f.timers.size, 1);
  f.document.hidden = true; f.s.visibilityChanged(); assert.equal(f.timers.size, 0);
  f.document.hidden = false; f.s.schedule(); assert.equal(f.timers.size, 1);
  f.s.autoRefresh.value = false; f.s.schedule(); assert.equal(f.timers.size, 0);
  f.cleanup.forEach(fn => fn()); await f.s.reload(); assert.equal(f.timers.size, 0);
  const signal = f.calls.find(c => c[0] === 'getSnapshot')[3]; assert.equal(signal.aborted, true);
});

test('plaza price resolution preserves zero, absolute precedence, multiplier inheritance and 1h fallback', () => {
  const { resolvePrices, money } = execute('public/plazaPricing.ts').s;
  const base = { input_price: 1e-6, output_price: 4e-6, cache_write_price: 2e-6, cache_write_1h_price: 3e-6, cache_read_price: 0.5e-6 };
  const result = resolvePrices({ input_price: 0, input_multiplier: 100, output_multiplier: 2, cache_write_price: 8e-6, cache_write_multiplier: 9 }, base);
  assert.equal(result.input_price, 0); assert.equal(result.output_price, 8e-6); assert.equal(result.cache_write_1h_price, 8e-6); assert.equal(result.cache_read_price, base.cache_read_price);
  assert.equal(money(0, 1e6, 3), '$0.00'); assert.equal(money(null), '未提供'); assert.equal(money(1e-6, 1e6, 0.5), '$0.50');
});
test('plaza comparison keeps independent ladders, backend tiers, time rates and image units', () => {
  const { pricingRows } = execute('public/plazaPricing.ts').s;
  const model = { pricing: { billing_mode: 'token', input_price: 1e-6, intervals: [{ min_tokens: 100, max_tokens: null, input_multiplier: 2 }, { min_tokens: 0, max_tokens: 100, input_price: 1e-6 }] }, official_pricing: { intervals: [{ min_tokens: 200, max_tokens: null, input_price: 4e-6 }, { min_tokens: 0, max_tokens: 200, input_price: 2e-6 }] }, time_pricing: { periods: [{ start_time: '01:00', end_time: '03:00', multiplier: 1.5 }] } };
  const group = { rate_multiplier: 2, user_rate_multiplier: 0.5, long_context_pricing_enabled: false };
  const token = pricingRows(model, group); assert.equal(token.paid.length, 2); assert.equal(token.official[0].max_tokens, 200); assert.equal(token.paid[1].input_price, 2e-6); assert.equal(token.periods[1].rate, 0.75);
  model.pricing = { billing_mode: 'image', per_request_price: 0.04, intervals: [] };
  const image = pricingRows(model, { ...group, image_rate_independent: true, image_rate_multiplier: 0.25 });
  assert.equal(image.rate, 0.25); assert.equal(image.token, false); assert.equal(image.periods[1].rate, 0.25); assert.equal(image.official.length, 2);
});
test('legal language swaps built-in originals without inventing administrator translations', () => {
  const routes = execute('public/content.ts').s; const props = vue.reactive({ path: '/legal/admin-compliance' });
  const { s } = execute('public/PublicPages.vue', { defineProps: () => props, useAuthStore: authenticated, resolvePublicRoute: routes.resolvePublicRoute, adminCompliance: '原文', adminComplianceEnglish: 'Original' });
  assert.equal(s.legalContent.value, '原文'); s.language.value = 'en'; assert.equal(s.legalContent.value, 'Original');
  props.path = '/legal/terms'; s.content.value = '管理员原文'; assert.equal(s.legalContent.value, '管理员原文');
});

function findPlaywright() {
  if (process.env.PARITY_PUBLIC_PLAYWRIGHT) return require(process.env.PARITY_PUBLIC_PLAYWRIGHT);
  try { return req('playwright'); } catch {}
  try { return req('playwright-core'); } catch {}
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) {
    const target = fs.readFileSync(path.join(links, file), 'utf8').trim();
    if (fs.existsSync(target)) return require(target);
  }
  throw Error('Set PARITY_PUBLIC_PLAYWRIGHT to an installed playwright/core package. No dependencies are installed by this test.');
}
async function browserBundle() {
  const esbuild = createRequire(req.resolve('vite'))('esbuild');
  const { outputFiles } = await esbuild.build({ bundle: true, write: false, format: 'iife', platform: 'browser',
    absWorkingDir: path.join(root, 'packages/sub2-console'),
    define: { 'import.meta.env.VITE_API_BASE_URL': '"/api/v1"', 'import.meta.env.DEV': 'false', '__VUE_OPTIONS_API__': 'true', '__VUE_PROD_DEVTOOLS__': 'false', '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false' },
    stdin: { resolveDir: sourceRoot, contents: `import { createApp, reactive, h } from 'vue';
      import PublicPages from './public/PublicPages.vue'; import Announcements from './apps/user/UserAnnouncementsApp.vue';
      import { renderSafeContent } from './public/content';
      window.__auth = reactive({ token: null, user: null, isAuthenticated: false, isAdmin: false });
      window.__route = reactive({ path: '/home', app: 'public' }); window.__sanitize = renderSafeContent;
      createApp({ setup: () => () => window.__route.app === 'announcements' ? h(Announcements) : h(PublicPages, { path: window.__route.path }) }).mount('#app');` },
    plugins: [{ name: 'isolated-vue-public', setup(build) {
      build.onResolve({ filter: /^@sub2-mac\/core$/ }, () => ({ path: 'core', namespace: 'public-fixture' }));
      build.onResolve({ filter: /\.md\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'public-markdown' }));
      build.onLoad({ filter: /.*/, namespace: 'public-markdown' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
      build.onLoad({ filter: /.*/, namespace: 'public-fixture' }, () => ({ resolveDir: sourceRoot, contents: `export {default as MacButton} from '../../mac-ui-core/src/components/MacButton.vue'; export {default as MacSheet} from '../../mac-ui-core/src/components/MacSheet.vue'; export {useWindowManager} from '../../mac-ui-core/src/composables/useWindowManager';` }));
      build.onResolve({ filter: /^@\// }, args => ({ path: path.join(sourceRoot, args.path.slice(2) + (path.extname(args.path) ? '' : '.ts')) }));
      build.onLoad({ filter: /[\\/]stores[\\/]auth\.ts$/ }, () => ({ contents: 'export const useAuthStore = () => window.__auth;', loader: 'js' }));
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = compiler.parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
        const id = 'p' + Buffer.from(args.path).toString('hex').slice(-24);
        const script = compiler.compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__component' });
        let contents = script.content + `\n__component.__scopeId = 'data-v-${id}'; export default __component;`;
        for (const style of descriptor.styles) {
          const css = compiler.compileStyle({ source: style.content, filename: args.path, id: 'data-v-' + id, scoped: style.scoped }).code;
          contents += `\n{ const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); }`;
        }
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
      build.onLoad({ filter: /\.css$/ }, args => ({ contents: `{ const s=document.createElement('style'); s.textContent=${JSON.stringify(fs.readFileSync(args.path, 'utf8'))}; document.head.appendChild(s); }`, loader: 'js' }));
    } }],
  });
  return outputFiles[0].text;
}
test('isolated browser: real DOM sanitization, query, route, native sheets, unread retries and mobile', { skip: process.env.PARITY_PUBLIC_BROWSER !== '1', timeout: 90000 }, async () => {
  const bundle = await browserBundle(); const { chromium } = findPlaywright(); const browser = await chromium.launch({ headless: true, ...(process.env.PARITY_PUBLIC_BROWSER_EXECUTABLE ? { executablePath: process.env.PARITY_PUBLIC_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage(); const calls = []; const errors = []; let readFails = true;
  const settings = { site_name: 'Public fixture', home_content: '<h2>欢迎</h2><script>window.PWNED=1</script>', site_subtitle: 'fixture', model_plaza_enabled: true, model_plaza_require_auth: false, channel_monitor_enabled: true, available_channels_enabled: true,
    custom_menu_items: [{ id: 'docs', label: '帮助', visibility: 'user', page_slug: 'guide' }], login_agreement_documents: [{ id: 'terms', title: '服务条款', content_md: '# 阅读条款\n**安全内容**' }] };
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== 'http://parity.invalid') { calls.push({ forbidden: request.url() }); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{margin:0}#app{height:100vh}*{box-sizing:border-box}</style><div id="app"></div><script src="/fixture.js"></script>' });
    if (url.pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle });
    calls.push({ path: url.pathname, method: request.method(), authorization: request.headers().authorization, query: url.search });
    const json = data => route.fulfill({ json: { code: 0, data } });
    if (url.pathname === '/api/v1/settings/public') return json(settings);
    if (url.pathname === '/v1/usage') return route.fulfill({ json: { mode: 'quota_limited', status: 'active', quota: { limit: 10, used: 3, remaining: 7 }, daily_usage: [{ date: '2026-09-11', requests: 2, input_tokens: 30, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, actual_cost: 0.2 }] } });
    if (url.pathname === '/api/v1/pages/guide') return route.fulfill({ contentType: 'text/markdown', body: '# 帮助内容\n[危险](javascript:alert(1))\n## 重复标题\n段落一\n## 重复标题\n段落二\n```sh\nprintf "<script>literal</script>"\n```\n' });
    if (url.pathname === '/api/v1/model-plaza') return json({ description: '模型说明', groups: [{ id: 1, name: '对比组', platform: 'openai', rate_multiplier: 2, user_rate_multiplier: 0.5, models: [{ name: '比较模型', platform: 'openai', pricing: { billing_mode: 'token', input_price: 1e-6, output_price: 4e-6, intervals: [{ min_tokens: 0, max_tokens: 100, input_price: 1e-6 }, { min_tokens: 100, max_tokens: null, input_multiplier: 2 }] }, official_pricing: { input_price: 2e-6, output_price: 8e-6, intervals: [{ min_tokens: 0, max_tokens: 200, input_price: 2e-6, output_price: 8e-6 }, { min_tokens: 200, max_tokens: null, input_price: 4e-6, output_price: 16e-6 }] }, time_pricing: { timezone: 'Asia/Shanghai', weekdays_only: true, periods: [{ start_time: '01:00', end_time: '03:00', multiplier: 1.5 }] } }] }] });
    if (url.pathname === '/api/v1/channels/available') return json([{ name: 'Fixture channel', description: '渠道夹具', platforms: [{ platform: 'openai', groups: [{ id: 1, name: '普通组', is_exclusive: false, subscription_type: 'standard', rate_multiplier: 1 }], supported_models: [{ name: 'fixture-model', platform: 'openai', pricing: null }] }] }]);
    if (url.pathname === '/api/v1/groups/rates') return json({ 1: 0.8 });
    if (url.pathname === '/api/v1/announcements') return json([notice(1), notice(2, 'silent')]);
    if (url.pathname === '/api/v1/announcements/1/read' && request.method() === 'POST') return readFails ? route.fulfill({ status: 500, json: { code: 1 } }) : json({ message: 'ok' });
    calls.push({ forbidden: request.url() }); return route.abort();
  });
  try {
    await page.goto('http://parity.invalid'); await page.getByText('欢迎', { exact: true }).waitFor();
    const unsafe = `<script>window.PWNED=1</script><svg onload="alert(1)"><a href="javascript:alert(1)">x</a></svg><style>body{display:none}</style><iframe src="https://evil.invalid"></iframe><form action="https://evil.invalid"><input name="auth_token"></form><h2 id="__proto__" style="position:fixed" onclick="alert(1)">Title</h2><a href="javascript:alert(1)">bad</a><a href="https://u:p@evil.invalid">creds</a><a href="https://example.test/docs" target="_self">good</a><img src="https://evil.invalid/secret" onerror="alert(1)" alt="blocked"><img src="../escape.png"><img src="ok.png" alt="local">`;
    const clean = await page.evaluate(source => {
      const html = window.__sanitize(source, false, 'guide'); const template = document.createElement('template'); template.innerHTML = html;
      return { html, bad: template.content.querySelectorAll('script,svg,style,iframe,form,input,[onclick],[onerror],[style],[id]:not([id^="sub2-content-"])').length,
        links: [...template.content.querySelectorAll('a[href]')].map(a => ({ href: a.getAttribute('href'), rel: a.rel, target: a.target })),
        images: [...template.content.querySelectorAll('img')].map(i => i.getAttribute('src')), pwned: window.PWNED || false };
    }, unsafe);
    assert.equal(clean.bad, 0); assert.equal(clean.pwned, false); assert.deepEqual(clean.images, ['/api/v1/pages/guide/images/ok.png']);
    assert.deepEqual(clean.links, [{ href: 'https://example.test/docs', rel: 'noopener noreferrer', target: '_blank' }]);
    for (const attack of ['<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">', '<a href="java&#x09;script:alert(1)">x</a>', '<img src="%2e%2e/private.png">']) {
      const html = await page.evaluate(s => window.__sanitize(s, false, 'guide'), attack); assert.ok(!/onerror|javascript:|<math|<style|src=/i.test(html));
    }
    await page.evaluate(() => { localStorage.setItem('auth_token', 'account-fixture'); window.__route.path = '/key-usage'; });
    await page.getByLabel('API 密钥', { exact: true }).fill('submitted-fixture-key'); await page.getByRole('button', { name: '查询', exact: true }).click();
    await page.getByText('$7.0000', { exact: true }).waitFor();
    const usageCall = calls.find(c => c.path === '/v1/usage'); assert.equal(usageCall.authorization, 'Bearer submitted-fixture-key'); assert.ok(!usageCall.query.includes('fixture-key'));
    await page.getByRole('button', { name: '清除', exact: true }).click(); assert.equal(await page.getByLabel('API 密钥', { exact: true }).inputValue(), '');
    await page.evaluate(() => { window.__route.path = '/legal/terms'; }); await page.getByRole('heading', { name: '服务条款' }).waitFor(); await page.getByText('安全内容', { exact: true }).waitFor();
    await page.evaluate(() => { window.__route.path = '/custom/docs'; }); await page.getByText('此页面需要登录。', { exact: false }).waitFor(); assert.equal(calls.filter(c => c.path === '/api/v1/pages/guide').length, 0);
    await page.evaluate(() => { Object.assign(window.__auth, { token: 'account-fixture', user: { id: 1 }, isAuthenticated: true }); }); await page.getByRole('heading', { name: '帮助内容' }).waitFor();
    const toc = page.getByRole('navigation', { name: '文档目录' }); await toc.waitFor();
    await toc.getByRole('button', { name: '重复标题', exact: true }).nth(1).click();
    assert.equal(await page.evaluate(() => document.activeElement.nextElementSibling.textContent), '段落二');
    await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copied.push(text); } } }); });
    await page.getByRole('button', { name: '复制代码', exact: true }).click(); await page.getByRole('button', { name: '已复制', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__copied[0]), 'printf "<script>literal</script>"\n');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw Error('denied'); }; });
    await page.getByRole('button', { name: '已复制', exact: true }).click(); await page.getByRole('button', { name: '复制失败，请手动选择代码', exact: true }).waitFor();
    await page.evaluate(() => { navigator.clipboard.writeText = () => new Promise(resolve => { window.__finishCopy = resolve; }); });
    const retryCopy = page.getByRole('button', { name: '复制失败，请手动选择代码', exact: true }); await retryCopy.click(); assert.equal(await retryCopy.isDisabled(), true);
    await page.evaluate(() => { window.__route.path = undefined; history.replaceState(null, '', '/available-channels'); dispatchEvent(new PopStateEvent('popstate')); });
    await page.getByRole('heading', { name: 'Fixture channel' }).waitFor(); await page.getByText('倍率 ×0.8', { exact: true }).waitFor();
    await page.evaluate(() => { window.__finishCopy(); }); assert.equal(await page.getByRole('button', { name: '已复制', exact: true }).count(), 0);
    await page.getByRole('button', { name: /fixture-model/ }).click(); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__route.path = '/legal/admin-compliance'; }); await page.getByRole('heading', { name: 'Sub2API 部署与运营合规承诺', exact: true }).waitFor();
    await page.getByLabel('法律文档语言').selectOption('en'); await page.getByRole('heading', { name: 'Deployment and Operations Compliance Commitment', exact: true }).waitFor();
    assert.match(await page.locator('.public-rich-content').innerText(), /Sub2API/); assert.ok(!(await page.locator('.public-rich-content').innerText()).includes('主体责任'));
    await page.getByLabel('法律文档语言').selectOption('zh'); await page.getByRole('heading', { name: 'Sub2API 部署与运营合规承诺', exact: true }).waitFor();
    await page.evaluate(() => { window.__route.path = '/model-plaza'; }); await page.getByRole('heading', { name: '比较模型' }).waitFor();
    await page.getByText('$0.75', { exact: true }).waitFor(); await page.getByText('≤200 Token', { exact: true }).waitFor();
    await page.getByLabel('倍率', { exact: true }).selectOption('0.5'); await page.getByRole('heading', { name: '比较模型' }).waitFor();
    await page.getByLabel('搜索模型', { exact: true }).fill('不存在'); await page.getByText('没有符合条件的模型。', { exact: true }).waitFor();
    await page.getByRole('button', { name: '清除筛选', exact: true }).click(); await page.getByRole('heading', { name: '比较模型' }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.evaluate(() => { window.__route.app = 'announcements'; }); const dialog = page.getByRole('dialog'); await dialog.waitFor();
    await dialog.getByRole('button', { name: '标记已读' }).click(); await page.getByText('标记已读失败，公告仍保留为未读。请重试。', { exact: true }).waitFor();
    readFails = false; await dialog.getByRole('button', { name: '标记已读' }).click(); await dialog.waitFor({ state: 'hidden' });
    await page.getByText('1 条未读', { exact: true }).waitFor();
    await page.getByRole('button', { name: /Notice 2/ }).click(); await dialog.waitFor(); await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(calls.filter(c => c.method === 'POST').length, 2); // failed read + explicit retry only
    for (const dark of [false, true]) {
      await page.evaluate(value => { document.documentElement.style.cssText = value ? '--window-bg-solid:#252528;--text-primary:#eee;--text-secondary:#bbb;--border-color:#ffffff30' : ''; }, dark);
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.deepEqual(calls.filter(c => c.forbidden), []); assert.deepEqual(errors, []);
  } finally { await context.close(); await browser.close(); }
});


test('release monitor query restores official keys and refuses invalid IDs/enums/hidden ranking',()=>{
 const m=execute('public/monitorTimeline.ts').s;
 const a=m.readMonitorQuery('?range=7d&platform=openai,anthropic&platform=openai&group=1,-1,2,NaN,1.5&model=a%2Fb&health_mode=ttft&trend_view=line&group_by=platform_model&tab=users',false);
 assert.equal(a.filter.range,'7d');assert.equal(a.filter.platforms.join(','),'openai,anthropic');assert.equal(a.filter.groupIds.join(','),'1,2');assert.equal(a.filter.models[0],'a/b');assert.equal(a.tab,'models');assert.equal(a.view,'line');assert.equal(a.mode,'ttft');
 const b=m.readMonitorQuery('?range=bad&health_mode=bad&group_by=bad&tab=bad',true);assert.equal(b.filter.range,'90m');assert.equal(b.mode,'overall');assert.equal(b.groupBy,'platform_group');
 const q=m.writeMonitorQuery('?unrelated=keep&model=old',a);assert.equal(new URLSearchParams(q).get('unrelated'),'keep');assert.equal(m.readMonitorQuery(q,false).filter.models[0],'a/b');
});
test('release wheel zoom anchors pointer, clamps edges, and stops at limits',()=>{
 const {zoomMatrix}=execute('public/monitorTimeline.ts').s;
 let r=zoomMatrix(300,60,60,-1,.5);assert.equal(r.size,30);assert.equal(r.offset,75);
 r=zoomMatrix(300,r.offset,r.size,1,.5);assert.equal(r.size,60);assert.equal(r.offset,60);
 assert.equal(zoomMatrix(300,0,120,1,.5).size,120);assert.equal(zoomMatrix(10,0,60,-1,1).offset,0);assert.equal(zoomMatrix(300,270,30,1,1).offset,240);
});
test('release monitor wheel handler prevents scroll only when zoom changes',async()=>{
 const f=monitorFixture();await f.s.reload();let prevented=0;const event={deltaY:-1,clientX:100,currentTarget:{getBoundingClientRect:()=>({left:0,width:200})},preventDefault(){prevented++}};
 f.s.wheelZoom(event);assert.equal(f.s.windowSize.value,30);assert.equal(prevented,1);f.s.wheelZoom(event);assert.equal(prevented,1);
});

test('RF02 shared pricing sheet reuses exact selected plaza model and preserves independent catalogs',()=>{const model={name:'selected',platform:'openai',pricing:{billing_mode:'token',intervals:[{min_tokens:0,max_tokens:100,input_price:0},{min_tokens:100,max_tokens:null,input_multiplier:2}]},official_pricing:{intervals:[{min_tokens:0,max_tokens:200,input_price:0.000002}]}};const group={name:'real',rate_multiplier:2,user_rate_multiplier:0.5,long_context_pricing_enabled:false,models:[model,{name:'other'}]};const props=vue.reactive({model,group});const {s}=execute('apps/user/ModelPricingSheet.vue',{defineProps:()=>props,useWindowManager:()=>undefined});assert.equal(s.comparisonGroup.value.models.length,1);assert.equal(s.comparisonGroup.value.models[0].name,'selected');assert.equal(s.comparisonGroup.value.models[0].pricing.intervals.length,2);assert.equal(s.comparisonGroup.value.models[0].official_pricing.intervals[0].max_tokens,200);assert.equal(s.comparisonGroup.value.user_rate_multiplier,0.5);props.group=undefined;assert.equal(s.comparisonGroup.value,null);});
