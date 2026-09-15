// R07 isolated regressions: production Vue/Pinia, Axios interceptors and token
// refresh execute against in-memory adapters. No server, SDK or real API calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = require('node:module').createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), pinia = req('pinia'), compiler = req('vue/compiler-sfc'), axios = req('axios');
const read = file => fs.readFileSync(path.join(src, file), 'utf8');
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); await vue.nextTick(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));
function storage() { const data = new Map(); return {get length(){return data.size;},key:i=>[...data.keys()][i]??null, getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }; }
function host(href = 'https://fixture.test/') {
  const url = new URL(href), events = new EventTarget();
  return Object.assign(events, { location: { href, pathname: url.pathname, origin: url.origin, assign() { throw Error('Navigation forbidden'); } }, history: { replaceState() {} }, setTimeout, opener: null });
}
function script(file, overrides = {}, transform = s => s) {
  let source = read(file);
  if (file.endsWith('.vue')) source = compiler.parse(source).descriptor.scriptSetup.content;
  source = transform(source).replaceAll('import.meta.env', '({})');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const mounted = [], cleanup = [], events = [], scope = vue.effectScope();
  const context = { ...vue, exports: {}, Error, console, URL, URLSearchParams, AbortController, CustomEvent, Date, Intl, setTimeout, clearTimeout,
    localStorage: storage(), window: host(), navigator: { userAgent: 'fixture' },
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn), onUnmounted: fn => cleanup.push(fn),
    defineProps: () => ({}), defineEmits: () => (...args) => events.push(args),
    fetch() { throw Error('Network forbidden'); }, ...overrides };
  vm.createContext(context);
  scope.run(() => vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context));
  return { s: context.subject, context, mounted, events, dispose() { cleanup.forEach(f => f()); scope.stop(); } };
}
function networkFixture(adapter, saved = true) {
  const localStorage = storage(), sessionStorage = storage(), window = host();
  window.localStorage = localStorage;
  if (saved) { localStorage.setItem('auth_token', 'A'); localStorage.setItem('refresh_token', 'R'); localStorage.setItem('auth_user', JSON.stringify({ id: 42, role: 'admin' })); }
  const calls = [];
  const fakeAdapter = async config => {
    calls.push([config.method, config.url, config.headers.Authorization]);
    const result = await adapter(config, { localStorage, calls });
    const response = { config, data: result.data, status: result.status || 200, statusText: 'fixture', headers: {} };
    if (response.status >= 400) throw new axios.AxiosError('fixture error', 'ERR_BAD_REQUEST', config, {}, response);
    return response;
  };
  const fakeAxios = axios.create({ adapter: fakeAdapter });
  fakeAxios.create = config => axios.create({ ...config, adapter: fakeAdapter }); fakeAxios.isCancel = axios.isCancel;
  const cache = new Map();
  const mocks = { axios: fakeAxios, vue, pinia, '@/i18n': { getLocale: () => 'zh-CN' } };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const context = { exports, console, localStorage, sessionStorage, window, URL, URLSearchParams, Date, Intl,
      navigator: { locks: { request: (name, options, fn) => (fn || options)({name}) } },crypto:require('node:crypto').webcrypto,
      CustomEvent, Event, TextEncoder, AbortController, setTimeout, clearTimeout,
      require: name => {
        if (name in mocks) return mocks[name];
        const resolved = name.startsWith('@/') ? name.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(file), name));
        return load(resolved + '.ts');
      } };
    vm.runInNewContext(ts.transpileModule(read(file).replaceAll('import.meta.env', '({})'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, context);
    return exports;
  }
  const store = load('stores/auth.ts').useAuthStore(pinia.createPinia());
  return { store, localStorage, window, calls, load, dispose() { store.$dispose(); } };
}
const ok = data => ({ data: { code: 0, data } });
function refreshAdapter(config) {
  if (config.url.endsWith('/auth/refresh')) return ok({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600, token_type: 'Bearer' });
  if (config.url === '/auth/me') return config.headers.Authorization === 'Bearer A' ? { status: 401, data: { code: 'TOKEN_EXPIRED' } } : ok({ id: 42, role: 'admin' });
  throw Error(`Unexpected API: ${config.url}`);
}

test('expired first restore uses actual 401 -> refresh -> replay headers and verified user', async () => {
  const f = networkFixture(refreshAdapter); await f.store.initAuth();
  assert.equal(f.store.isAuthenticated, true); assert.equal(f.store.user.id, 42); assert.equal(f.store.token, 'A2'); assert.equal(f.store.isLoading, false);
  assert.deepEqual(f.calls.map(c => c[1]), ['/auth/me', '/api/v1/auth/refresh', '/auth/me']);
  assert.equal(f.localStorage.getItem('refresh_token'), 'R2'); f.dispose();
});

test('R08 legitimate Axios rotation preserves a captured payment operation and clears its marker on confirmed replay',async()=>{
  const f=networkFixture(config=>config.url==='/auth/me'?ok({id:42,role:'admin'}):config.url.endsWith('/auth/refresh')?ok({access_token:'A2',refresh_token:'R2',expires_in:3600,token_type:'Bearer'}):config.headers.Authorization==='Bearer A'?{status:401,data:{code:'TOKEN_EXPIRED'}}:ok({success:true}));
  await f.store.initAuth();const scope=vue.effectScope();
  const guard=scope.run(()=>f.load('utils/usePaymentWriteGuard.ts').usePaymentWriteGuard(()=>f.store.user?.id,()=>f.store.token,()=>f.store.sessionRevision));
  const captured=guard.capture();const result=await guard.journal.run(captured,'refund:42','refund',[42],()=>f.load('api/client.ts').apiClient.post('/admin/payment/orders/42/refund',{amount:1}),r=>r.data.success===true);
  assert.equal(result.kind,'confirmed');assert.equal(captured.current(),true);assert.equal(guard.available.value,true);assert.equal(guard.entries.value.length,0);
  assert.equal(f.store.token,'A');assert.equal(f.localStorage.getItem('auth_token'),'A2');
  f.localStorage.setItem('auth_token','new-login');f.localStorage.setItem('refresh_token','new-refresh');f.window.dispatchEvent(Object.assign(new Event('storage'),{key:'auth_token'}));
  assert.equal(captured.current(),false);assert.equal(guard.available.value,false);scope.stop();f.dispose();
});
test('R08 token lineage digest matches standard SHA256 and corrupt proof never grants token ancestry',()=>{
  const f=networkFixture(()=>ok({id:42})),lineage=f.load('api/authTokenLineage.ts');
  for(const text of ['', 'abc', '令牌'.repeat(70)])assert.equal(lineage.tokenDigest(text),require('node:crypto').createHash('sha256').update(text).digest('hex'));
  f.localStorage.setItem(lineage.AUTH_LINEAGE_KEY,JSON.stringify({version:1,session:'a'.repeat(64),ancestors:[]}));
  assert.equal(lineage.accessTokenMatchesSession(42,'old'),false);f.dispose();
});
test('late successful restore cannot publish after logout', async () => {
  const wait = deferred(); const f = networkFixture(config => config.url === '/auth/me' ? wait.promise : ok({}));
  const pending = f.store.initAuth(); await flush(); await f.store.logout(); wait.resolve(ok({ id: 42, role: 'admin' })); await pending;
  assert.equal(f.store.user, null); assert.equal(f.store.isAuthenticated, false); assert.equal(f.localStorage.getItem('auth_token'), null); f.dispose();
});
for (const fails of [false, true]) test(`late restore ${fails ? 'error' : 'success'} cannot overwrite replacement login`, async () => {
  const wait = deferred(); let reads = 0;
  const f = networkFixture(config => config.url === '/auth/me' && ++reads === 1 ? wait.promise : ok({ id: 77, role: 'user' }));
  const pending = f.store.initAuth(); await flush(); await f.store.acceptExternalSession({ access_token: 'B' });
  wait.resolve(fails ? { status: 503, data: {} } : ok({ id: 42, role: 'admin' })); await pending;
  assert.equal(f.store.user.id, 77); assert.equal(f.store.token, 'B'); assert.equal(f.localStorage.getItem('auth_token'), 'B'); f.dispose();
});
test('cross-tab token replacement rejects old successful /auth/me and preserves new storage', async () => {
  const wait = deferred(), f = networkFixture(() => wait.promise); const pending = f.store.initAuth(); await flush();
  f.localStorage.setItem('auth_token', 'B'); f.localStorage.setItem('auth_user', JSON.stringify({ id: 77 }));
  wait.resolve(ok({ id: 42 })); await pending;
  assert.equal(f.store.user, null); assert.equal(f.localStorage.getItem('auth_token'), 'B'); f.dispose();
});
test('public restore failure clears expired identity without navigating away from signed result', async () => {
  const f = networkFixture(() => ({ status: 401, data: {} })); f.localStorage.removeItem('refresh_token');
  const before = f.window.location.href; await f.store.initAuth({ redirectOnFailure: false });
  assert.equal(f.store.user, null); assert.equal(f.store.token, null); assert.equal(f.window.location.href, before); f.dispose();
});
test('refresh failure also honors public return redirect policy; desktop retains redirect', async () => {
  for (const redirectOnFailure of [false, true]) {
    const f = networkFixture(config => config.url.endsWith('/auth/refresh') ? { data: { code: 1 } } : { status: 401, data: {} });
    const before = f.window.location.href; await f.store.initAuth({ redirectOnFailure });
    assert.equal(f.store.isAuthenticated, false); assert.equal(f.window.location.href, redirectOnFailure ? '/login' : before); f.dispose();
  }
});

// Official v0.2.4 fixture; a clean source package need not include the optional checkout.
const status = { required: true, version: 'fixture-v1', ack_phrase_zh: '我已阅读、理解并同意 Sub2API 部署与运营合规承诺', ack_phrase_en: 'I have read, understood, and agree to the Sub2API Deployment and Operation Compliance Commitment', document_url_zh: 'https://fixture.test/zh', document_url_en: 'https://fixture.test/en' };
const officialPath = path.join(root, 'output/upstream-current-20260912/backend/internal/service/admin_compliance.go');
if (fs.existsSync(officialPath)) {
  const official = fs.readFileSync(officialPath, 'utf8');
  assert.equal(status.ack_phrase_zh, official.match(/AdminComplianceAckPhraseZH\s*=\s*"([^"]+)"/)[1]);
  assert.equal(status.ack_phrase_en, official.match(/AdminComplianceAckPhraseEN\s*=\s*"([^"]+)"/)[1]);
}
function identity(admin = false) {
  const auth = vue.reactive({ token: admin ? 'A' : null, user: admin ? { id: 42, role: 'admin' } : null, sessionRevision: 0 });
  Object.defineProperties(auth, { isAuthenticated: { get: () => !!auth.token && !!auth.user }, isAdmin: { get: () => !!auth.token && auth.user?.role === 'admin' } });
  return auth;
}
function compliance(api, auth = identity()) {
  return { ...script('App.vue', { useAuthStore: () => auth, useSystemStore: () => ({}), useCardShopStore: () => ({}), adminComplianceAPI: api }, s => s.slice(0, s.indexOf('const audio ='))), auth };
}
function sheet(api, extra = {}) {
  const props = vue.reactive({ show: true, status: { ...status }, identity: '0:42', statusLoading: false, statusError: '', ...extra });
  return { ...script('components/AdminComplianceSheet.vue', { defineProps: () => props, adminComplianceAPI: api }), props };
}
test('first verified administrator triggers full status read after initially anonymous App setup', async () => {
  let reads = 0; const f = compliance({ getStatus: async () => { reads++; return status; } }); await flush(); assert.equal(reads, 0);
  f.auth.token = 'A'; f.auth.user = { id: 42, role: 'admin' }; await flush();
  assert.equal(reads, 1); assert.equal(f.s.complianceVisible.value, true); assert.equal(f.s.complianceStatus.value.ack_phrase_zh, status.ack_phrase_zh); f.dispose();
});
test('423 metadata never supplies a guessed phrase; full read is coalesced and retryable', async () => {
  let reads = 0; const wait = deferred(); const f = compliance({ getStatus: () => { reads++; return reads === 1 ? Promise.resolve({ ...status, required: false }) : wait.promise; } }, identity(true)); await flush();
  f.s.handleComplianceRequired({ detail: { version: status.version } }); f.s.handleComplianceRequired({ detail: {} });
  assert.equal(reads, 2); assert.equal(f.s.complianceStatus.value, null); assert.equal(f.s.complianceLoading.value, true);
  wait.resolve(status); await flush(); assert.equal(f.s.complianceStatus.value.ack_phrase_zh, status.ack_phrase_zh); f.dispose();
});
test('actual 423 interceptor event reads complete status and the exact phrase is accepted through the API', async () => {
  let required = false, acceptedPayload;
  const f = networkFixture(config => {
    if (config.url === '/auth/me') return ok({ id: 42, role: 'admin' });
    if (config.url === '/admin/compliance') return ok({ ...status, required });
    if (config.url === '/admin/users') return { status: 423, data: { code: 'ADMIN_COMPLIANCE_ACK_REQUIRED', metadata: { version: status.version, document_url_zh: status.document_url_zh } } };
    if (config.url === '/admin/compliance/accept') {
      acceptedPayload = JSON.parse(config.data);
      assert.equal(acceptedPayload.phrase, status.ack_phrase_zh); required = false; return ok({ ...status, required });
    }
    throw Error(`Unexpected API: ${config.url}`);
  });
  const api = f.load('api/admin/compliance.ts').adminComplianceAPI;
  const app = compliance(api, f.store); f.window.addEventListener('admin-compliance-required', app.s.handleComplianceRequired);
  await f.store.initAuth(); await flush(); required = true;
  await assert.rejects(f.load('api/client.ts').apiClient.get('/admin/users'), e => e.code === 'ADMIN_COMPLIANCE_ACK_REQUIRED'); await flush();
  assert.equal(app.s.complianceVisible.value, true); assert.equal(app.s.complianceStatus.value.ack_phrase_zh, status.ack_phrase_zh);
  const g = sheet(api, { status: app.s.complianceStatus.value }); g.s.phrase.value = status.ack_phrase_zh; await g.s.accept();
  assert.deepEqual(acceptedPayload, { phrase: status.ack_phrase_zh, language: 'zh-CN' }); assert.ok(g.events.some(e => e[0] === 'accepted'));
  app.dispose(); g.dispose(); f.dispose();
});
test('dismissal invalidates pending compliance read instead of reopening the sheet', async () => {
  const wait = deferred(), f = compliance({ getStatus: () => wait.promise }, identity(true));
  f.s.handleComplianceRequired(); assert.equal(f.s.complianceVisible.value, true); f.s.closeAdminCompliance();
  wait.resolve(status); await flush(); assert.equal(f.s.complianceVisible.value, false); assert.equal(f.s.complianceStatus.value, null); f.dispose();
});
test('failed and incomplete status reads block acknowledgement; retry restores the exact official phrase', async () => {
  let mode = 'fail'; const f = compliance({ getStatus: async () => { if (mode === 'fail') throw Error('offline'); return mode === 'partial' ? { required: true, version: 'v' } : status; } }, identity(true)); await flush();
  assert.equal(f.s.complianceStatus.value, null); assert.ok(f.s.complianceError.value);
  mode = 'partial'; await f.s.checkAdminCompliance(); assert.equal(f.s.complianceStatus.value, null);
  let posts = 0; const g = sheet({ accept: async () => { posts++; return { required: false }; } }, { status: null, statusError: f.s.complianceError.value });
  g.s.phrase.value = '我已阅读并同意'; await g.s.accept(); assert.equal(posts, 0); assert.equal(g.s.ready.value, false);
  mode = 'ok'; await f.s.checkAdminCompliance(); g.props.status = f.s.complianceStatus.value; g.props.statusError = '';
  g.s.phrase.value = '我已阅读并同意'; await g.s.accept(); assert.equal(posts, 0);
  g.s.phrase.value = status.ack_phrase_zh; await g.s.accept(); assert.equal(posts, 1); assert.ok(g.events.some(e => e[0] === 'accepted')); f.dispose(); g.dispose();
});
test('old compliance read cannot reopen gate or replace new administrator status', async () => {
  const old = deferred(); let reads = 0; const f = compliance({ getStatus: () => ++reads === 1 ? old.promise : Promise.resolve({ ...status, required: false }) }, identity(true));
  f.auth.user = { id: 77, role: 'admin' }; await flush(); old.resolve(status); await flush();
  assert.equal(f.s.complianceStatus.value.required, false); assert.equal(f.s.complianceVisible.value, false);
  f.auth.token = null; assert.equal(f.s.complianceStatus.value, null); f.dispose();
});
for (const outcome of ['success', 'error']) test(`late compliance accept ${outcome} is fenced on identity change`, async () => {
  const wait = deferred(); let posts = 0; const f = sheet({ accept: () => { posts++; return wait.promise; } });
  f.s.phrase.value = status.ack_phrase_zh; const pending = f.s.accept(); await f.s.accept(); assert.equal(posts, 1);
  f.props.identity = '1:77'; f.props.status = { ...status }; f.s.phrase.value = 'new draft';
  if (outcome === 'success') wait.resolve({ required: false }); else wait.reject(Error('old error'));
  await pending; assert.equal(f.events.length, 0); assert.equal(f.s.error.value, ''); assert.equal(f.s.phrase.value, 'new draft'); f.dispose();
});
test('compliance success only emits accepted when the returned state is no longer required', async () => {
  const f = sheet({ accept: async () => status }); f.s.phrase.value = status.ack_phrase_zh; await f.s.accept();
  assert.equal(f.events.length, 0); assert.ok(f.s.error.value); f.dispose();
});

const flow = script('apps/user/payments/flow.ts').s;
function landing(auth, localStorage, suffix = '/payment/airwallex?order_id=42', api = {}) {
  const calls = [];
  return { ...script('apps/user/payments/PaymentRoute.vue', { ...flow, useAuthStore: () => auth, localStorage, window: host('https://fixture.test' + suffix),
    usePaymentStatus: () => ({ status: vue.ref(''), issue: vue.ref(''), busy: vue.ref(false), refresh: async () => {} }),
    paymentAPI: { getOrder: async id => { calls.push(id); return { data: { id, amount: 10, pay_amount: 10, fee_rate: 0, expires_at: new Date(Date.now() + 600000).toISOString(), payment_type: 'airwallex' } }; }, ...api } }), calls };
}
function saveOrder(localStorage, owner = 42) {
  flow.saveRecovery(localStorage, { order_id: 42, amount: 10, pay_amount: 10, fee_rate: 0, expires_at: new Date(Date.now() + 600000).toISOString(), payment_type: 'airwallex', client_secret: 'fixture-private', intent_id: 'fixture-intent' }, owner);
}
test('actual standalone main restores verified owner before PaymentRoute initializes and recovers Airwallex', async () => {
  const f = networkFixture(refreshAdapter); saveOrder(f.localStorage); const ready = deferred(); let route;
  const main = script('main.ts', { location: { pathname: '/payment/airwallex', href: 'https://fixture.test/payment/airwallex?order_id=42', search: '?order_id=42' },
    isPaymentRoute: flow.isPaymentRoute, DESKTOP_ROUTES: {}, createPinia: pinia.createPinia, useAuthStore: () => f.store,
    __import: async name => { assert.equal(name, './apps/user/payments/PaymentRoute.vue'); return { default: {} }; },
    createApp: () => ({ use() {}, mount() { try { assert.equal(f.store.user.id, 42); route = landing(f.store, f.localStorage); Promise.all(route.mounted.map(fn => fn())).then(ready.resolve, ready.reject); } catch (e) { ready.reject(e); } } })
  }, source => source.replace(/import\(/g, '__import('));
  await ready.promise;
  assert.equal(flow.paymentKind(route.s.order.value), 'airwallex'); assert.equal(route.s.order.value.client_secret, 'fixture-private'); assert.equal(route.s.error.value, '');
  f.store.token = 'A3'; assert.ok(route.s.order.value); // A normal token rotation is not an account switch.
  await f.store.logout(); assert.equal(route.s.order.value, null); assert.match(route.s.error.value, /账户已变化/);
  route.dispose(); main.dispose(); f.dispose();
});
test('recovery for another owner remains unavailable even when order lookup succeeds', async () => {
  const auth = identity(true), localStorage = storage(); saveOrder(localStorage, 77); const f = landing(auth, localStorage); await f.s.initialize();
  assert.equal(f.s.order.value.client_secret, undefined); assert.equal(flow.paymentKind(f.s.order.value), 'unsupported'); f.dispose();
});
test('anonymous and token-only return paths preserve public lookup without private order reads', async () => {
  for (const token of [null, 'unverified']) {
    const auth = identity(); auth.token = token; const localStorage = storage(); saveOrder(localStorage);
    const f = landing(auth, localStorage, '/payment/result?order_id=42&resume_token=signed'); await f.s.initialize();
    assert.equal(f.s.lookup.value.authenticated, false); assert.equal(f.s.lookup.value.token, 'signed'); assert.equal(f.calls.length, 0); assert.equal(f.s.order.value, null); f.dispose();
  }
});
test('anonymous signed WeChat continuation remains explicit and does not create an order on mount', async () => {
  let writes = 0; const f = landing(identity(), storage(), '/auth/wechat/payment/callback?wechat_resume_token=signed', { createOrder() { writes++; } }); await f.s.initialize();
  assert.equal(f.s.request.value.wechat_resume_token, 'signed'); assert.equal(writes, 0); f.dispose();
});
test('pending private order response is discarded after account replacement', async () => {
  const auth = identity(true), wait = deferred(), localStorage = storage(); saveOrder(localStorage);
  const f = landing(auth, localStorage, '/payment/airwallex?order_id=42', { getOrder: () => wait.promise }); const pending = f.s.initialize();
  auth.user = { id: 77, role: 'admin' }; wait.resolve({ data: { id: 42 } }); await pending;
  assert.equal(f.s.order.value, null); assert.match(f.s.error.value, /账户已变化/); f.dispose();
});

const content = script('public/content.ts').s;
const adminMenu = { id: 'private', label: '管理员手册', visibility: 'admin', page_slug: 'private' };
function publicPage(auth, adminRead, customRead = async () => '# Private fixture', route = '/custom/private') {
  const calls = [], props = vue.reactive({ path: route });
  return { ...script('public/PublicPages.vue', { ...content, useAuthStore: () => auth, defineProps: () => props,
    adminCompliance: '', adminComplianceEnglish: '', getPublicSettings: async () => ({ site_name: 'Fixture', custom_menu_items: [] }),
    getAdminSettings: async () => { calls.push('settings'); return adminRead(); }, getCustomPage: async (...args) => { calls.push(['markdown', ...args]); return customRead(...args); }
  }), calls, props };
}
test('verified administrator loads filtered menu from protected settings and resolves Markdown', async () => {
  const f = publicPage(identity(true), async () => ({ custom_menu_items: [adminMenu], smtp_secret_fixture: 'must-not-persist' })); await flush();
  assert.equal(f.s.missing.value, false); assert.equal(f.s.title.value, '管理员手册'); assert.equal(f.s.content.value, '# Private fixture');
  assert.deepEqual(f.calls.map(c => Array.isArray(c) ? c[0] : c), ['settings', 'markdown']);
  assert.equal(f.calls[1][3], 'A'); assert.ok(!JSON.stringify(plain(f.s.settings.value)).includes('must-not-persist')); f.dispose();
});
test('admin external menu resolves, while public home stays independent of protected settings', async () => {
  const f = publicPage(identity(true), async () => ({ custom_menu_items: [{ ...adminMenu, page_slug: '', url: 'https://docs.fixture.test/' }] })); await flush();
  assert.equal(f.s.external.value, 'https://docs.fixture.test/'); f.props.path = '/home'; await flush();
  assert.equal(f.s.menuItems.value.length, 0); assert.equal(f.s.title.value, 'Fixture'); assert.deepEqual(f.calls, ['settings']); f.dispose();
});
test('guest and verified ordinary user never fetch private settings or admin page content', async () => {
  for (const loggedIn of [false, true]) {
    const auth = identity(); if (loggedIn) { auth.token = 'U'; auth.user = { id: 77, role: 'user' }; }
    const f = publicPage(auth, () => { throw Error('Private read forbidden'); }); await flush();
    assert.equal(f.calls.length, 0); assert.equal(f.s.adminMenuItems.value.length, 0); assert.equal(f.s.content.value, ''); f.dispose();
  }
});
test('private settings failure is retryable rather than a false missing menu', async () => {
  let fail = true; const f = publicPage(identity(true), async () => { if (fail) throw Error('offline'); return { custom_menu_items: [adminMenu] }; }); await flush();
  assert.equal(f.s.missing.value, false); assert.match(f.s.error.value, /offline/); fail = false; await f.s.load();
  assert.equal(f.s.content.value, '# Private fixture'); assert.equal(f.s.error.value, ''); f.dispose();
});
test('unacknowledged administrator menu read points back to the desktop compliance gate', async () => {
  const f = publicPage(identity(true), async () => { throw { code: 'ADMIN_COMPLIANCE_ACK_REQUIRED' }; }); await flush();
  assert.match(f.s.error.value, /返回桌面.*合规确认/); assert.equal(f.s.missing.value, false); f.dispose();
});
for (const phase of ['settings', 'markdown']) test(`logout or demotion fences late private ${phase} response and clears menu immediately`, async () => {
  const auth = identity(true), wait = deferred();
  const f = publicPage(auth, () => phase === 'settings' ? wait.promise : { custom_menu_items: [adminMenu] }, () => wait.promise); await flush();
  auth.user = { id: 42, role: 'user' };
  assert.equal(f.s.adminMenuItems.value.length, 0); assert.equal(f.s.content.value, '');
  wait.resolve(phase === 'settings' ? { custom_menu_items: [adminMenu] } : '# Late private content'); await flush();
  assert.equal(f.s.content.value, ''); assert.equal(f.s.adminMenuItems.value.length, 0); assert.equal(f.s.menuItems.value.length, 0); f.dispose();
});
test('owned Vue surfaces compile scripts and templates with production bindings', () => {
  for (const file of ['App.vue', 'components/AdminComplianceSheet.vue', 'apps/user/payments/PaymentRoute.vue', 'public/PublicPages.vue']) {
    const { descriptor, errors } = compiler.parse(read(file), { filename: file }); assert.deepEqual(errors, []);
    assert.doesNotThrow(() => compiler.compileScript(descriptor, { id: file, inlineTemplate: true }), file);
  }
});
