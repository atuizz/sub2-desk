// Isolated execution of production TS/Vue scripts; no network, accounts or SDKs.
// Run: node --test scripts/parity-auth.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), sfc = req('vue/compiler-sfc');
function storage() { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) }; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function execute(file, overrides = {}) {
  let source = fs.readFileSync(path.join(src, file), 'utf8');
  if (file.endsWith('.vue')) source = sfc.parse(source).descriptor.scriptSetup.content;
  source = source.replaceAll('import.meta.env', '({})');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n)) source = source.slice(0, n.pos) + source.slice(n.end);
  const mounted = [], unmounted = [], timers = [];
  const scope = vue.effectScope();
  const context = {
    ...vue, console, URL, URLSearchParams, Date, AbortController, ArrayBuffer, Uint8Array, atob, btoa,
    localStorage: storage(), sessionStorage: storage(),
    onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn),
    defineProps: () => ({}), defineEmits: () => () => {}, defineExpose: () => {},
    setInterval: fn => { timers.push(fn); return timers.length; }, clearInterval: () => {},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    fetch: () => { throw new Error('NETWORK FORBIDDEN'); },
    exports: {}, ...overrides,
  };
  vm.createContext(context);
  scope.run(() => vm.runInContext(ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context));
  return { s: context.subject, context, mounted, timers, dispose() { unmounted.forEach(fn => fn()); scope.stop(); } };
}
function authAPI(overrides = {}) {
  const calls = [];
  const client = {};
  for (const method of ['post', 'get', 'patch', 'delete']) client[method] = async (...args) => { calls.push([method, ...args]); return { data: {} }; };
  Object.assign(client, overrides);
  return { ...execute('api/auth.ts', { apiClient: client }), calls, client };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const normalize = value => JSON.parse(JSON.stringify(value));
const panel = 'apps/user/settings/';

test('all owned Vue surfaces compile both script and template', () => {
  for (const file of ['components/MacLockscreen.vue', 'apps/user/SettingsApp.vue', 'components/auth/CaptchaGate.vue', ...['PasskeySecurityPanel', 'LoginAgreementPanel', 'OAuthBindingsPanel', 'OAuthCallbackPanel'].map(n => panel + n + '.vue')]) {
    const filename = path.join(src, file), parsed = sfc.parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(parsed.errors, []);
    const script = sfc.compileScript(parsed.descriptor, { id: file });
    const result = sfc.compileTemplate({ source: parsed.descriptor.template.content, filename, id: file, compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(result.errors, [], file);
  }
});
test('OAuth provider flags, legacy WeChat mode and action captcha payload match official API', async () => {
  const f = authAPI();
  assert.deepEqual(normalize(f.s.desktopOAuthProviders(null)), []);
  assert.deepEqual(normalize(f.s.desktopOAuthProviders({ github_oauth_enabled: true, wechat_oauth_enabled: true })), ['github', 'wechat']);
  assert.equal(f.s.resolveWeChatOAuthStart({ wechat_oauth_enabled: true }, 'MicroMessenger').mode, 'mp');
  assert.equal(f.s.resolveWeChatOAuthStartStrict({ wechat_oauth_enabled: true }).mode, null);
  await f.s.startOAuthLogin({ provider: 'google', params: { redirect: '/' } }, { tencent_captcha_ticket: 'ticket', tencent_captcha_randstr: 'random' });
  assert.deepEqual(normalize(f.calls[0]), ['post', '/auth/oauth/google/start', { tencent_captcha_ticket: 'ticket', tencent_captcha_randstr: 'random' }, { params: { redirect: '/' } }]);
});
test('callback parser recognizes auth-only routes, ignores payment and extracts fragment credentials', () => {
  const { s } = authAPI();
  for (const route of ['/auth/callback', '/auth/oauth/callback', '/auth/linuxdo/callback', '/auth/wechat/callback', '/auth/dingtalk/callback', '/auth/oidc/callback', '/auth/dingtalk/email-completion']) {
    const parsed = s.readDesktopOAuthCallback(`https://example.test${route}?code=code&state=state#access_token=fixture&refresh_token=refresh&expires_in=60`);
    assert.equal(parsed.cleanPath, route); assert.equal(parsed.tokens.access_token, 'fixture'); assert.equal(parsed.code, 'code');
  }
  assert.equal(s.readDesktopOAuthCallback('https://example.test/auth/wechat/payment/callback'), null);
  assert.equal(s.readDesktopOAuthCallback('https://example.test/other#access_token=token'), null);
});
test('OAuth state classifier keeps pending/adoption/TOTP/errors distinct from completed binding', () => {
  const { s } = authAPI();
  for (const [response, expected] of [
    [{}, 'complete'], [{ access_token: 'fixture' }, 'complete'], [{ auth_result: 'pending_session' }, 'adoption'],
    [{ error: 'invitation_required' }, 'registration'], [{ error: 'registration_completion_required' }, 'registration'],
    [{ step: 'email_completion' }, 'create'], [{ requires_email_completion: true }, 'create'], [{ step: 'choice' }, 'choice'],
    [{ error: 'bind_login_required' }, 'bind'], [{ requires_2fa: true, temp_token: 'fixture' }, '2fa'],
    [{ adoption_required: true, suggested_display_name: 'name' }, 'adoption'], [{ error: 'denied' }, 'error'],
  ]) assert.equal(s.desktopOAuthStep(response), expected);
});
test('OAuth pending create/bind/registration and explicit profile refusal payloads are exact', async () => {
  const f = authAPI();
  await f.s.exchangePendingOAuthCompletion({ adoptDisplayName: false, adoptAvatar: false });
  await f.s.submitPendingOAuthAction('bind-login', { email: 'a@example.test', password: 'fixture' });
  await f.s.completeDesktopOAuthRegistration('github', { password: 'fixture', invitation_code: 'invite' });
  assert.deepEqual(normalize(f.calls), [
    ['post', '/auth/oauth/pending/exchange', { adopt_display_name: false, adopt_avatar: false }],
    ['post', '/auth/oauth/pending/bind-login', { email: 'a@example.test', password: 'fixture' }],
    ['post', '/auth/oauth/github/complete-registration', { password: 'fixture', invitation_code: 'invite' }],
  ]);
});
test('password authentication replaces old refresh context, TOTP challenge never stores a token', async () => {
  const f = authAPI({ post: async () => ({ data: { access_token: 'new', user: { id: 1 } } }) });
  f.context.localStorage.setItem('refresh_token', 'old');
  await f.s.login({ email: 'a', password: 'b' });
  assert.equal(f.context.localStorage.getItem('refresh_token'), null);
  f.client.post = async () => ({ data: { requires_2fa: true, temp_token: 'temporary' } });
  f.s.clearAuthToken(); await f.s.login({ email: 'a', password: 'b' });
  assert.equal(f.s.getAuthToken(), null);
});

function passkey() {
  const calls = [], key = new class Credential {
    id = 'id'; rawId = new Uint8Array([1]).buffer; type = 'public-key'; authenticatorAttachment = 'platform';
    response = { clientDataJSON: new Uint8Array([2]).buffer, authenticatorData: new Uint8Array([3]).buffer, signature: new Uint8Array([4]).buffer, userHandle: null, attestationObject: new Uint8Array([5]).buffer, getTransports: () => ['internal'] };
    getClientExtensionResults() { return {}; }
  }();
  const credentials = { get: async opts => { calls.push(['get', opts]); return key; }, create: async opts => { calls.push(['create', opts]); return key; } };
  const client = { post: async (url, body) => { calls.push(['post', url, body]); return { data: url.endsWith('/begin') ? { session_token: 'ceremony', options: { publicKey: { challenge: 'AQ', user: { id: 'Ag' }, allowCredentials: [{ id: 'Aw', type: 'public-key' }], excludeCredentials: [{ id: 'BA', type: 'public-key' }] } } } : { access_token: 'fixture' } }; }, patch: async (...args) => calls.push(['patch', ...args]), delete: async (...args) => calls.push(['delete', ...args]), get: async () => ({ data: [] }) };
  return { ...execute('api/passkey.ts', { window: { PublicKeyCredential: key.constructor }, PublicKeyCredential: key.constructor, navigator: { credentials }, apiClient: client }), calls, client, credentials };
}
test('WebAuthn login decodes challenge/credential IDs and serializes exact assertion fields', async () => {
  const f = passkey(); await f.s.passkeyAPI.login({ turnstile_token: 'captcha' });
  assert.deepEqual(normalize(f.calls[0]), ['post', '/auth/passkey/login/begin', { turnstile_token: 'captcha' }]);
  assert.equal(new Uint8Array(f.calls[1][1].publicKey.challenge)[0], 1);
  assert.equal(new Uint8Array(f.calls[1][1].publicKey.allowCredentials[0].id)[0], 3);
  assert.equal(f.calls[2][2].session_token, 'ceremony'); assert.equal(f.calls[2][2].credential.response.userHandle, null);
  assert.equal(f.calls[2][2].credential.response.signature, 'BA');
});
test('WebAuthn registration sends password only at begin; rename/delete use official methods', async () => {
  const f = passkey(); await f.s.passkeyAPI.register('My key', 'secret');
  assert.deepEqual(normalize(f.calls[0]), ['post', '/user/passkeys/register/begin', { password: 'secret' }]);
  assert.equal(new Uint8Array(f.calls[1][1].publicKey.user.id)[0], 2);
  assert.equal(f.calls[2][2].name, 'My key'); assert.ok(!('password' in f.calls[2][2]));
  await f.s.passkeyAPI.rename(7, 'Renamed'); await f.s.passkeyAPI.remove(7, 'secret');
  assert.deepEqual(normalize(f.calls.slice(-2)), [['patch', '/user/passkeys/7', { name: 'Renamed' }], ['delete', '/user/passkeys/7', { data: { password: 'secret' } }]]);
});
test('WebAuthn cancel, unsupported browser and abort during begin never call finish', async () => {
  const f = passkey(); f.credentials.get = async () => null;
  await assert.rejects(f.s.passkeyAPI.login(), /cancelled/); assert.equal(f.calls.filter(c => c[1]?.endsWith?.('/finish')).length, 0);
  const wait = deferred(), abort = new AbortController(); f.client.post = () => wait.promise;
  const pending = f.s.passkeyAPI.register('key', 'secret', abort.signal); abort.abort();
  wait.resolve({ data: { session_token: 'fixture', options: { publicKey: {} } } });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(f.calls.some(c => c[0] === 'create'), false);
  f.context.window.PublicKeyCredential = null;
  await assert.rejects(f.s.passkeyAPI.login(), /not supported/);
});
function passkeyPanel() {
  const props = vue.reactive({ enabled: true, ready: true, sheetTarget: null }), calls = [];
  const api = { list: async () => [{ id: 1, name: 'fixture', backup: true }], isSupported: () => true, register: async (...args) => { calls.push(['register', ...args]); }, rename: async (...args) => { calls.push(['rename', ...args]); }, remove: async (...args) => { calls.push(['remove', ...args]); } };
  return { ...execute(panel + 'PasskeySecurityPanel.vue', { defineProps: () => props, passkeyAPI: api }), props, calls, api };
}
test('Passkey panel loads, validates password, creates, renames and confirms deletion', async () => {
  const f = passkeyPanel(); await vue.nextTick(); await flush(); await Promise.resolve();
  assert.equal(f.s.loaded.value, true); f.s.open('register'); f.s.name.value = 'Laptop';
  await f.s.submit(); assert.equal(f.calls.length, 0);
  f.s.password.value = 'secret'; await f.s.submit(); assert.equal(f.calls[0][0], 'register'); assert.equal(f.s.password.value, '');
  f.s.open('rename', f.s.rows.value[0]); f.s.name.value = 'New'; await f.s.submit(); assert.deepEqual(f.calls[1], ['rename', 1, 'New']);
  f.s.open('remove', f.s.rows.value[0]); f.s.password.value = 'secret'; f.s.close(); await f.s.submit(); assert.equal(f.calls.length, 2);
  f.s.open('remove', f.s.rows.value[0]); f.s.password.value = 'secret'; await f.s.submit(); assert.deepEqual(f.calls[2], ['remove', 1, 'secret']); f.dispose();
});
test('Passkey panel clears secret immediately, rejects duplicate submit and ignores cancelled late success', async () => {
  const f = passkeyPanel(); await vue.nextTick(); await flush(); const wait = deferred(); f.api.register = (...args) => { f.calls.push(args); return wait.promise; };
  f.s.open('register'); f.s.name.value = 'Key'; f.s.password.value = 'secret'; const pending = f.s.submit();
  assert.equal(f.s.password.value, ''); await f.s.submit(); assert.equal(f.calls.length, 1);
  f.s.close(); assert.equal(f.calls[0][2].aborted, true); wait.resolve(); await pending;
  assert.equal(f.s.notice.value, ''); assert.equal(f.s.show.value, false); f.dispose();
});
test('Passkey flags and failed list keep writes disabled; failed mutation clears password', async () => {
  const f = passkeyPanel(); await vue.nextTick(); await flush();
  f.api.remove = async () => { throw new Error('fixture 500'); };
  f.s.open('remove', f.s.rows.value[0]); f.s.password.value = 'secret'; await f.s.submit(); assert.equal(f.s.password.value, ''); assert.match(f.s.error.value, /500/);
  f.s.close(); f.api.list = async () => { throw new Error('unsupported 404'); }; await f.s.load(); assert.equal(f.s.loaded.value, false); f.s.open('register'); assert.equal(f.s.show.value, false);
  f.props.enabled = false; await vue.nextTick(); await flush(); assert.equal(f.s.rows.value.length, 0); f.dispose();
});
test('agreement requires readable documents and resets acceptance when content revision changes', async () => {
  const props = vue.reactive({ settings: { login_agreement_enabled: true, login_agreement_documents: [{ id: 'terms', title: '条款', content_md: 'Terms' }] }, modelValue: false });
  const events = []; const f = execute(panel + 'LoginAgreementPanel.vue', { defineProps: () => props, defineEmits: () => (...args) => events.push(args) });
  assert.equal(f.s.show.value, true); f.s.accept(); assert.deepEqual(events.at(-1), ['update:modelValue', true]);
  props.settings.login_agreement_documents[0].content_md = 'Updated'; await vue.nextTick(); await flush(); assert.deepEqual(events.at(-1), ['update:modelValue', false]);
  props.settings.login_agreement_documents = []; await vue.nextTick(); await flush(); f.s.accept(); assert.deepEqual(events.at(-1), ['update:modelValue', false]); f.dispose();
});

function lock() {
  const api = authAPI(), calls = [];
  const auth = vue.reactive({ isLoading: false, isAuthenticated: false, user: null, errorMsg: null, requires2FA: false, temp2FAToken: null, initAuth: async () => {}, login: async (...args) => { calls.push(['login', ...args]); return { success: true }; }, register: async p => { calls.push(['register', p]); return { success: true }; }, verify2FA: async p => { calls.push(['totp', p]); return { success: true }; }, acceptExternalSession: async p => { calls.push(['session', p]); } });
  const system = { isLocked: true, unlock: () => calls.push(['unlock']) };
  const location = { href: 'https://example.test/login', pathname: '/login', assign: url => calls.push(['navigate', url]) };
  const passkey = { login: async () => ({ access_token: 'passkey' }) };
  const f = execute('components/MacLockscreen.vue', {
    ...api.s, useAuthStore: () => auth, useSystemStore: () => system, useSystemAudio: () => ({ playClick() {}, playError() {} }), passkeyAPI: passkey,
    getPublicSettings: async () => ({}), window: { location, history: { state: null, replaceState: (...args) => calls.push(['history', ...args]) } },
    sendVerifyCode: async p => { calls.push(['code', p]); return { countdown: 60 }; }, forgotPassword: async p => calls.push(['forgot', p]), resetPassword: async p => calls.push(['reset', p]),
  });
  return { ...f, calls, auth, passkey };
}
test('lockscreen gates password/passkey/OAuth/registration on settings, agreement and captcha', async () => {
  const f = lock(); f.s.accountInput.value = 'a@example.test'; f.s.passwordInput.value = 'secret';
  await f.s.handleAction(); assert.equal(f.calls.length, 0);
  f.s.publicSettings.value = { login_agreement_enabled: true, passkey_enabled: true, github_oauth_enabled: true, turnstile_enabled: true };
  await f.s.signInWithPasskey(); await f.s.signInWithOAuth('github'); await f.s.handleAction(); assert.equal(f.calls.length, 0);
  f.s.agreementAccepted.value = true; f.s.captcha.value = { verify: async () => null, reset() {} };
  await f.s.signInWithPasskey(); await f.s.handleAction(); assert.equal(f.calls.length, 0);
  f.s.captcha.value = { verify: async () => ({ turnstile_token: 'captcha' }), reset() {} };
  await f.s.handleAction(); assert.deepEqual(normalize(f.calls[0]), ['login', 'a@example.test', 'secret', { turnstile_token: 'captcha' }]); assert.equal(f.s.passwordInput.value, ''); f.dispose();
});
test('lockscreen passkey cancellation never adopts late tokens, disabled flag never calls API', async () => {
  const f = lock(), wait = deferred(); f.passkey.login = () => wait.promise;
  f.s.publicSettings.value = { passkey_enabled: true }; const pending = f.s.signInWithPasskey(); await Promise.resolve();
  f.s.cancelExternal(); wait.resolve({ access_token: 'late' }); await pending; assert.equal(f.calls.length, 0);
  f.s.publicSettings.value.passkey_enabled = false; await f.s.signInWithPasskey(); assert.equal(f.calls.length, 0); f.dispose();
});
test('existing registration/email code, password recovery and TOTP remain callable with exact payloads', async () => {
  const f = lock(); f.s.publicSettings.value = { registration_enabled: true, email_verify_enabled: true, invitation_code_enabled: true, password_reset_enabled: true };
  f.s.setMode('register'); f.s.accountInput.value = 'a@example.test'; await vue.nextTick(); await flush(); await f.s.sendRegistrationCode();
  f.s.emailCodeInput.value = '123456'; f.s.passwordInput.value = 'secret'; f.s.confirmPasswordInput.value = 'secret'; f.s.invitationInput.value = 'invite'; await f.s.handleAction();
  assert.deepEqual(normalize(f.calls.find(c => c[0] === 'register')[1]), { email: 'a@example.test', password: 'secret', verify_code: '123456', invitation_code: 'invite' });
  f.s.setMode('forgot'); await f.s.submitRecovery(); assert.deepEqual(normalize(f.calls.find(c => c[0] === 'forgot')[1]), { email: 'a@example.test' });
  f.s.setMode('2fa'); f.s.totpInput.value = '123456'; await f.s.handleAction(); assert.ok(f.calls.some(c => c[0] === 'totp')); f.dispose();
});
function callback(response) {
  const api = authAPI(), events = [], calls = [];
  const props = vue.reactive({ callback: { provider: 'linuxdo', cleanPath: '/auth/linuxdo/callback', error: '', pendingToken: '', tokens: null, code: '', state: '', emailCompletion: false }, settings: { registration_enabled: true }, allowed: false });
  const auth = { isAuthenticated: true, initAuth: async () => calls.push(['me']), acceptExternalSession: async p => calls.push(['session', p]) };
  const operations = { exchangePendingOAuthCompletion: async () => response, submitPendingOAuthAction: async (...args) => { calls.push(args); return { access_token: 'fixture' }; }, completeDesktopOAuthRegistration: async (...args) => { calls.push(args); return { access_token: 'fixture' }; }, login2FA: async p => { calls.push(['2fa', p]); return { access_token: 'fixture' }; } };
  const f = execute(panel + 'OAuthCallbackPanel.vue', { ...api.s, ...operations, defineProps: () => props, defineEmits: () => (...args) => events.push(args), useAuthStore: () => auth, buildApiUrl: url => '/api/v1' + url, window: { location: { assign: url => calls.push(['navigate', url]) } } });
  return { ...f, props, calls, events, auth, operations };
}
test('OAuth pending bind-login and TOTP complete through server, passwords cleared on each step', async () => {
  const f = callback({ error: 'bind_login_required', email: 'a@example.test' }); f.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve();
  assert.equal(f.s.step.value, 'bind'); f.s.password.value = 'secret';
  f.context.submitPendingOAuthAction = async (action, payload) => { f.calls.push([action, payload]); return { requires_2fa: true, temp_token: 'temp' }; };
  await f.s.submit(); assert.equal(f.s.step.value, '2fa'); assert.equal(f.s.password.value, ''); assert.equal(f.s.tempToken.value, 'temp');
  f.s.code.value = '123456'; await f.s.submit(); assert.deepEqual(normalize(f.calls.find(c => c[0] === '2fa')[1]), { temp_token: 'temp', totp_code: '123456' });
  assert.equal(f.s.tempToken.value, ''); assert.ok(f.events.some(e => e[0] === 'complete')); f.dispose();
});
test('OAuth GitHub completion requires password and invitation; does not submit email or fake verification', async () => {
  const f = callback({ provider: 'github', error: 'invitation_required', resolved_email: 'a@example.test' }); f.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve();
  f.s.password.value = 'secret'; f.s.confirmation.value = 'secret'; await f.s.submit(); assert.equal(f.calls.length, 0);
  f.s.invitation.value = 'invite'; await f.s.submit();
  assert.deepEqual(normalize(f.calls[0]), ['github', { password: 'secret', invitation_code: 'invite' }]); f.dispose();
});
test('OAuth create-account preserves pending choices, captcha and explicit profile decision', async () => {
  const f = callback({ step: 'choice' }); f.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve();
  f.s.choose('create'); f.s.email.value = 'a@example.test'; f.s.password.value = 'secret'; f.s.confirmation.value = 'secret';
  f.s.captcha.value = { verify: async () => ({ tencent_captcha_ticket: 't', tencent_captcha_randstr: 'r' }), reset() {} };
  await f.s.submit(); assert.deepEqual(normalize(f.calls[0]), ['create-account', { email: 'a@example.test', password: 'secret', adopt_display_name: false, adopt_avatar: false, tencent_captcha_ticket: 't', tencent_captcha_randstr: 'r' }]); f.dispose();
});
test('OAuth blank successful completion restores existing binding session; unknown errors never complete', async () => {
  const f = callback({}); f.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve(); await Promise.resolve();
  assert.ok(f.calls.some(c => c[0] === 'me')); assert.ok(f.events.some(e => e[0] === 'complete')); f.dispose();
  const g = callback({ error: 'denied' }); g.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve();
  assert.equal(g.s.step.value, 'error'); assert.equal(g.events.length, 0); g.dispose();
});
test('OAuth failure and cancellation clear secrets; late exchange cannot emit completion', async () => {
  const f = callback({ step: 'bind_login_required' }); f.props.allowed = true; await vue.nextTick(); await flush(); await Promise.resolve();
  f.s.email.value = 'a@example.test'; f.s.password.value = 'secret'; f.context.submitPendingOAuthAction = async () => { throw new Error('fixture failure'); };
  await f.s.submit(); assert.equal(f.s.password.value, ''); assert.match(f.s.error.value, /fixture/);
  f.props.callback.pendingToken = 'legacy'; f.s.tempToken.value = 'totp'; f.s.cancel(); assert.equal(f.props.callback.pendingToken, ''); assert.equal(f.s.tempToken.value, ''); f.dispose();
  const wait = deferred(), g = callback({}); g.context.exchangePendingOAuthCompletion = () => wait.promise;
  g.props.allowed = true; await vue.nextTick(); await flush(); g.s.cancel(); wait.resolve({ access_token: 'late' }); await Promise.resolve(); await Promise.resolve();
  assert.equal(g.calls.length, 0); assert.equal(g.events.some(e => e[0] === 'complete'), false); g.dispose();
});
test('external session acceptance checks /auth/me and clears tokens on failure and abort', async () => {
  const api = authAPI(), wait = deferred();
  const f = execute('stores/auth.ts', { ...api.s, defineStore: (_id, setup) => setup, getCurrentUser: () => wait.promise });
  const store = f.s.useAuthStore(), abort = new AbortController();
  const pending = store.acceptExternalSession({ access_token: 'new', refresh_token: 'refresh' }, abort.signal);
  assert.equal(store.isAuthenticated.value, false); abort.abort(); wait.resolve({ data: { id: 1 } });
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(api.s.getAuthToken(), null); assert.equal(store.user.value, null);
});

function captchaFixture(settings, sdk = {}) {
  const props = vue.reactive({ settings });
  const scripts = [];
  const document = { querySelector: () => null, getElementById: () => null, createElement: () => ({ addEventListener() {}, removeEventListener() {}, remove() {} }), head: { appendChild: tag => scripts.push(tag) } };
  const f = execute('components/auth/CaptchaGate.vue', { defineProps: () => props, window: sdk, document });
  f.s.host.value = {}; f.s.trigger.value = { click() {} };
  return { ...f, props, scripts };
}
test('Turnstile proof is consumed once, expiration/reset clears it and missing key fails closed', async () => {
  let options, removed = 0;
  const f = captchaFixture({ turnstile_enabled: true, turnstile_site_key: 'site' }, { turnstile: { render: (_host, o) => { options = o; return 'widget'; }, reset() {}, remove: () => removed++ } });
  await flush(); assert.equal(f.s.ready.value, true); assert.equal(await f.s.verify(), null);
  options.callback('proof'); assert.deepEqual(normalize(await f.s.verify()), { turnstile_token: 'proof' }); assert.equal(await f.s.verify(), null);
  options.callback('second'); options['expired-callback'](); assert.equal(await f.s.verify(), null);
  options.callback('third'); f.s.reset(); assert.equal(await f.s.verify(), null); f.dispose(); assert.ok(removed >= 1);
  const g = captchaFixture({ turnstile_enabled: true, turnstile_site_key: '' }); await flush(); assert.equal(g.s.ready.value, false); assert.equal(await g.s.verify(), null); g.dispose();
});
test('Tencent CN/intl use different constructor signatures, ticket fields and cancel semantics', async () => {
  for (const intl of [false, true]) {
    let args;
    class Tencent { constructor(...values) { args = values; } show() {} destroy() {} }
    const f = captchaFixture({ tencent_captcha_enabled: true, tencent_captcha_app_id: 'app', tencent_captcha_region: intl ? 'intl' : 'cn' }, { TencentCaptcha: Tencent, TCaptchaGlobal: intl });
    await flush(); assert.equal(f.s.ready.value, true); assert.equal(args[intl ? 1 : 0], 'app');
    const callback = args[intl ? 2 : 1]; let waiting = f.s.verify(); callback({ ret: 0, ticket: 't', randstr: 'r' });
    assert.deepEqual(normalize(await waiting), { tencent_captcha_ticket: 't', tencent_captcha_randstr: 'r' });
    waiting = f.s.verify(); callback({ ret: 2 }); assert.equal(await waiting, null);
    waiting = f.s.verify(); f.s.reset(); callback({ ret: 0, ticket: 'late', randstr: 'late' }); assert.equal(await waiting, null); f.dispose();
  }
  const mismatch = captchaFixture({ tencent_captcha_enabled: true, tencent_captcha_app_id: 'app', tencent_captcha_region: 'intl' }, { TencentCaptcha() {}, TCaptchaGlobal: false });
  await flush(); assert.match(mismatch.s.error.value, /区域/); assert.equal(await mismatch.s.verify(), null); mismatch.dispose();
});

test('late Tencent callback after reset cannot satisfy a new action', async () => {
  let callback;
  class Tencent { constructor(_id, cb) { callback = cb; } show() {} destroy() {} }
  const f = captchaFixture({ tencent_captcha_enabled: true, tencent_captcha_app_id: 'app' }, { TencentCaptcha: Tencent });
  await flush(); const old = callback; const first = f.s.verify(); f.s.reset(); assert.equal(await first, null); await flush();
  const next = f.s.verify(); old({ ret: 0, ticket: 'old', randstr: 'old' }); await flush(); assert.equal(f.s.verifying.value, true);
  callback({ ret: 0, ticket: 'new', randstr: 'new' }); assert.equal((await next).tencent_captcha_ticket, 'new'); f.dispose();
});

test('lockscreen callback sanitizes address before async settings and preserves legacy token only in memory', async () => {
  const f = lock(), wait = deferred(); f.context.window.location.href = 'https://example.test/auth/oidc/callback#access_token=fixture&refresh_token=refresh';
  f.context.window.location.pathname = '/auth/oidc/callback'; f.context.getPublicSettings = () => wait.promise;
  await f.mounted[0](); assert.equal(f.calls[0][0], 'history'); assert.equal(f.calls[0].at(-1), '/auth/oidc/callback');
  assert.equal(f.s.oauthCallback.value.tokens.access_token, 'fixture'); f.dispose(); assert.equal(f.s.oauthCallback.value, null); wait.resolve({}); await flush();
});

test('Passkey submitted writes cannot be dismissed while awaiting the server', async () => {
  const f = passkeyPanel(); await flush(); const wait = deferred(); f.api.remove = () => wait.promise;
  f.s.open('remove', f.s.rows.value[0]); f.s.password.value = 'secret'; const pending = f.s.submit();
  assert.equal(f.s.submitting.value, true); f.s.close(); assert.equal(f.s.show.value, true);
  wait.resolve(); await pending; assert.equal(f.s.show.value, false); f.dispose();
});
test('Aliyun proof reuses turnstile_token; cancellation and unmount settle pending request', async () => {
  let options;
  const f = captchaFixture({ aliyun_captcha_enabled: true, aliyun_captcha_scene_id: 'scene', aliyun_captcha_prefix: 'prefix' }, {
    AliyunCaptchaConfig: { region: 'cn', prefix: 'prefix' }, initAliyunCaptcha: opts => { options = opts; },
  });
  await flush(); assert.equal(f.s.ready.value, true); let waiting = f.s.verify(); options.captchaVerifyCallback('signed-param');
  assert.deepEqual(normalize(await waiting), { turnstile_token: 'signed-param' });
  waiting = f.s.verify(); f.s.reset(); assert.equal(await waiting, null); await flush();
  waiting = f.s.verify(); f.dispose(); assert.equal(await waiting, null);
});
test('captcha script load timeout cannot yield a proof; no-captcha path returns an empty proof', async () => {
  const f = captchaFixture({ turnstile_enabled: true, turnstile_site_key: 'site' }); await flush();
  assert.equal(f.scripts.length, 1); f.timers[0](); await flush(); assert.equal(f.s.ready.value, false); assert.match(f.s.error.value, /加载失败/); assert.equal(await f.s.verify(), null); f.dispose();
  const g = captchaFixture({ turnstile_enabled: false }); await flush(); assert.deepEqual(normalize(await g.s.verify()), {}); g.dispose();
});
test('binding panel obeys server can_bind/can_unbind flags and requires confirmation before delete', async () => {
  const api = authAPI(), calls = [];
  const auth = vue.reactive({ user: { id: 1, auth_bindings: { linuxdo: { bound: true, can_unbind: false }, github: { bound: false, can_bind: false } } } });
  const props = vue.reactive({ settings: { linuxdo_oauth_enabled: true, github_oauth_enabled: true }, ready: true, sheetTarget: null });
  const f = execute(panel + 'OAuthBindingsPanel.vue', { ...api.s, defineProps: () => props, useAuthStore: () => auth, buildOAuthBindingStartURL: () => '/bind', startOAuthBinding: async (...args) => calls.push(['bind', ...args]), unbindAuthIdentity: async p => { calls.push(['remove', p]); return { id: 1 }; } });
  await f.s.bind('github'); assert.equal(calls.length, 0); f.s.selected.value = 'linuxdo'; await f.s.unbind(); assert.equal(calls.length, 0);
  auth.user.auth_bindings.linuxdo.can_unbind = true; f.s.selected.value = null; await f.s.unbind(); assert.equal(calls.length, 0);
  f.s.selected.value = 'linuxdo'; await f.s.unbind(); assert.deepEqual(calls[0], ['remove', 'linuxdo']); assert.equal(f.s.selected.value, null); assert.equal(auth.user.id, 1); f.dispose();
});
test('OAuth binding failure remains recoverable, invitation legacy token is sent only in request body', async () => {
  const f = callback({}); f.props.callback.error = 'invitation_required'; f.props.callback.pendingToken = 'legacy'; f.props.allowed = true; await vue.nextTick(); await flush();
  assert.equal(f.s.step.value, 'registration'); f.s.invitation.value = 'invite'; await f.s.submit();
  assert.deepEqual(normalize(f.calls[0]), ['linuxdo', { adopt_display_name: false, adopt_avatar: false, invitation_code: 'invite', pending_oauth_token: 'legacy' }]); assert.equal(f.props.callback.pendingToken, ''); f.dispose();
  const g = callback({ step: 'create_account' }); g.props.allowed = true; await vue.nextTick(); await flush();
  g.s.email.value = 'a@example.test'; g.s.password.value = 'secret'; g.s.confirmation.value = 'secret'; g.s.captcha.value = { verify: async () => ({}), reset() {} };
  g.context.submitPendingOAuthAction = async () => { throw { code: 'EMAIL_EXISTS', message: 'exists' }; }; await g.s.submit(); assert.equal(g.s.step.value, 'bind'); assert.equal(g.s.password.value, ''); g.dispose();
});

// 2026-09-12 independent review: production API persistence + store races.
function reviewedStore(client) {
  const api = authAPI(client);
  const f = execute('stores/auth.ts', { ...api.s, localStorage: api.context.localStorage, apiLogin: api.s.login, apiLogin2FA: api.s.login2FA, apiRegister: api.s.register, apiLogout: api.s.logout, defineStore: (_id, setup) => setup });
  return { ...api, store: f.s.useAuthStore(), dispose: f.dispose };
}
test('review: missing login credentials cannot retain previous identity or store undefined token', async () => {
  const f = reviewedStore({ post: async () => ({ data: { user: { id: 2 } } }) });
  f.store.user.value = { id: 1, role: 'admin' }; f.store.token.value = 'old'; f.s.setAuthToken('old');
  const result = await f.store.login('user','password');assert.equal(result.success,false);assert.equal(f.store.user.value,null);assert.equal(f.store.isAdmin.value,false);assert.equal(f.s.getAuthToken(),null);f.dispose();
});
test('review: missing user in login resolves new identity through auth/me, never reuses old user', async () => {
  const f = reviewedStore({ post: async () => ({ data: { access_token: 'new' } }), get: async () => ({ data: { id: 2, role: 'user' } }) });
  f.store.user.value={id:1,role:'admin'};f.store.token.value='old';assert.equal((await f.store.login('new','password')).success,true);assert.equal(f.store.user.value.id,2);assert.equal(f.store.isAdmin.value,false);f.dispose();
});
test('review: six digit TOTP accepted and non-digit input rejected in real store',async()=>{
  let posts=0;const f=reviewedStore({post:async()=>{posts++;return {data:{access_token:'new',user:{id:2}}};}});f.store.temp2FAToken.value='temporary';
  assert.equal((await f.store.verify2FA('abcdef')).success,false);assert.equal(posts,0);assert.equal((await f.store.verify2FA('123456')).success,true);assert.equal(posts,1);f.dispose();
});
test('review: logout fences pending login storage write and stale success',async()=>{
  const d=deferred();const f=reviewedStore({post:async url=>url==='/auth/login'?d.promise:{data:{}}});const p=f.store.login('a','password');await f.store.logout();
  d.resolve({data:{access_token:'late',refresh_token:'late-refresh',user:{id:1}}});assert.equal((await p).success,false);assert.equal(f.s.getAuthToken(),null);assert.equal(f.store.user.value,null);f.dispose();
});
test('review: old restore/external rejection cannot overwrite or clear newer session',async()=>{
  const d=deferred();let reads=0;const f=reviewedStore({get:async()=>++reads===1?d.promise:{data:{id:2}}});
  const p=f.store.acceptExternalSession({access_token:'old'});const rejected=assert.rejects(p);await f.store.acceptExternalSession({access_token:'new'});d.reject(new Error('old failed'));await rejected;
  assert.equal(f.s.getAuthToken(),'new');assert.equal(f.store.user.value.id,2);assert.equal(f.store.isLoading.value,false);f.dispose();
});
test('review: delayed logout revocation cannot clear a subsequent successful login',async()=>{
  const d=deferred();const f=reviewedStore({post:async url=>url==='/auth/logout'?d.promise:{data:{access_token:'new',user:{id:2}}}});
  f.s.setAuthToken('old');f.s.setRefreshToken('old-refresh');f.store.token.value='old';f.store.user.value={id:1};const p=f.store.logout();assert.equal(f.s.getAuthToken(),null);
  await f.store.login('new','password');d.resolve({data:{}});await p;assert.equal(f.s.getAuthToken(),'new');assert.equal(f.store.user.value.id,2);f.dispose();
});
test('review: callback unmount aborts account adoption and 2FA helper does not persist prematurely',async()=>{
  const f=callback({});f.props.allowed=true;await vue.nextTick();await flush();f.dispose();assert.equal(f.s.sessionController.signal.aborted,true);
  const api=authAPI({post:async()=>({data:{access_token:'late',user:{id:2}}})});await api.s.login2FA({temp_token:'t',totp_code:'123456'},false);assert.equal(api.s.getAuthToken(),null);
});
test('review: unbind response for old account cannot overwrite replacement account',async()=>{
  const d=deferred(),auth=vue.reactive({user:{id:1,auth_bindings:{linuxdo:{bound:true,can_unbind:true}}}});
  const f=execute(panel+'OAuthBindingsPanel.vue',{...authAPI().s,defineProps:()=>({settings:{linuxdo_oauth_enabled:true},ready:true,sheetTarget:null}),useAuthStore:()=>auth,unbindAuthIdentity:()=>d.promise});
  f.s.selected.value='linuxdo';const p=f.s.unbind();auth.user={id:2,auth_bindings:{}};d.resolve({id:1});await p;assert.equal(auth.user.id,2);assert.equal(f.s.selected.value,null);assert.equal(f.s.notice.value,'');f.dispose();
});
