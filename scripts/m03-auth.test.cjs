// Run from any cwd: node --test scripts/m03-auth.test.cjs
// Executes actual component scripts with isolated API fixtures. No browser/network/business writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = localRequire('typescript');
const vue = localRequire('vue');
const { parse, compileTemplate } = localRequire('vue/compiler-sfc');
const files = {
  totp: 'apps/user/settings/TotpSecurityPanel.vue',
  lock: 'components/MacLockscreen.vue',
  settings: 'apps/user/SettingsApp.vue',
};
function descriptor(name) {
  const filename = path.join(root, 'packages/sub2-console/src', files[name]);
  const parsed = parse(fs.readFileSync(filename, 'utf8'), { filename });
  assert.deepEqual(parsed.errors, []);
  return parsed.descriptor;
}
function execute(source, overrides = {}) {
  source = source.replaceAll('import.meta.env', '({})');
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(node => ts.isVariableStatement(node)
    ? node.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text)
    : ts.isFunctionDeclaration(node) && node.name ? [node.name.text] : []);
  for (const node of [...ast.statements].reverse()) {
    if (ts.isImportDeclaration(node)) source = source.slice(0, node.pos) + source.slice(node.end);
  }
  const lifecycle = { mounted: [], unmounted: [], timersCleared: 0 };
  const context = {
    ...vue, Date, URL, URLSearchParams, console, AbortController, exports: {},
    defineProps: () => ({}), defineEmits: () => () => {},
    onMounted: fn => lifecycle.mounted.push(fn), onUnmounted: fn => lifecycle.unmounted.push(fn),
    setInterval: () => 1, clearInterval: () => { lifecycle.timersCleared++; }, setTimeout: () => 1,
    fetch: () => { throw new Error('Network forbidden in M03 fixtures'); },
    ...overrides,
  };
  vm.createContext(context);
  const js = ts.transpileModule(source + `\nglobalThis.subject = { ${names.join(',')} };`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  vm.runInContext(js, context);
  return { s: context.subject, context, lifecycle };
}
function totp() {
  const calls = []; let enabled = false;
  const setupData = { secret: 'FIXTURE', qr_code_url: 'otpauth://totp/fixture', setup_token: 'fixture-token', countdown: 120 };
  const api = {
    getStatus: async () => ({ enabled, feature_enabled: true }),
    getVerificationMethod: async () => ({ method: 'password' }),
    sendVerifyCode: async () => { calls.push(['send']); return { success: true }; },
    initiateSetup: async p => { calls.push(['setup', p]); return setupData; },
    enable: async p => { calls.push(['enable', p]); enabled = true; return { success: true }; },
    disable: async p => { calls.push(['disable', p]); enabled = false; return { success: true }; },
  };
  return { ...execute(descriptor('totp').scriptSetup.content, {
    totpAPI: api, QRCode: { toDataURL: async () => 'data:image/png;base64,fixture' },
    navigator: { clipboard: { writeText: async () => {} } },
  }), api, calls, setupData };
}
async function setupTotp(f) {
  await f.s.loadStatus(); await f.s.open(); f.s.credential.value = 'fixture-password'; await f.s.submit();
}
function lock(href = 'https://example.test/') {
  const values = new Map();
  const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  const authHelpers = execute(fs.readFileSync(path.join(root, 'packages/sub2-console/src/api/auth.ts'), 'utf8'), { localStorage: storage, sessionStorage: storage }).s;
  const calls = []; const api = {
    forgotPassword: async p => { calls.push(['forgot', p]); return { message: 'ok' }; },
    resetPassword: async p => { calls.push(['reset', p]); return { message: 'ok' }; },
    sendVerifyCode: async p => { calls.push(['send', p]); return { countdown: 60 }; },
  };
  const auth = { isLoading: false, user: null, errorMsg: null, isAuthenticated: false,
    initAuth: async () => { calls.push(['init']); },
    register: async p => { calls.push(['register', p]); return { success: true }; },
    login: async () => { calls.push(['login']); return { success: false }; },
  };
  const window = { location: { href }, history: { state: null, replaceState: (_state, _title, url) => { window.cleanedURL = url; } } };
  const fixture = execute(descriptor('lock').scriptSetup.content, {
    ...authHelpers, localStorage: storage, sessionStorage: storage,
    useSystemStore: () => ({ isLocked: true, unlock: () => {} }), useAuthStore: () => auth,
    useSystemAudio: () => ({ playError: () => {}, playClick: () => {} }), window,
    getPublicSettings: async () => ({ password_reset_enabled: true }),
    forgotPassword: p => api.forgotPassword(p), resetPassword: p => api.resetPassword(p), sendVerifyCode: p => api.sendVerifyCode(p),
    HTMLInputElement: class Input { closest() { return null; } },
  });
  fixture.s.publicSettings.value = { registration_enabled: true, email_verify_enabled: true, invitation_code_enabled: true, password_reset_enabled: true };
  return { ...fixture, auth, calls, api, window };
}
async function registration() {
  const f = lock(); f.s.setMode('register'); f.s.accountInput.value = 'fixture@example.test'; await vue.nextTick();
  f.s.passwordInput.value = '123456'; f.s.confirmPasswordInput.value = '123456'; f.s.invitationInput.value = 'INVITE';
  return f;
}
function email() {
  const all = descriptor('settings').scriptSetup.content;
  const source = all.slice(all.indexOf('const showEmailBindingForm'), all.indexOf('const displayName'));
  const calls = [], authStore = { user: { id: 1, email: 'old@example.test', email_bound: true } };
  const profileReady = vue.ref(true);
  return { ...execute(source, { ...require('./test-support/user-session.cjs')(authStore), profileReady, authStore, disposed: false, triggerToast: () => {},
    userAPI: { sendEmailBindingCode: async p => { calls.push(['send', p]); },
      bindEmailIdentity: async p => { calls.push(['bind', p]); return { id: 1, email: p.email }; } },
  }), calls, profileReady };
}

for (const name of Object.keys(files)) test(`${name}: Vue template compiles`, () => {
  const sfc = descriptor(name);
  assert.deepEqual(compileTemplate({ source: sfc.template.content, filename: files[name], id: `m03-${name}` }).errors, []);
});
test('TOTP: reads known status', async () => { const f = totp(); await f.s.loadStatus(); assert.equal(f.s.status.value.enabled, false); });
test('TOTP: password payload and credential cleanup', async () => { const f = totp(); await setupTotp(f); assert.equal(f.calls[0][1].password, 'fixture-password'); assert.equal(f.s.credential.value, ''); });
test('TOTP: rejects non-digit dynamic code', async () => { const f = totp(); await setupTotp(f); f.s.code.value = 'abcdef'; await f.s.submit(); assert.equal(f.calls.length, 1); });
test('TOTP: expired setup cannot submit', async () => { const f = totp(); await setupTotp(f); f.s.code.value = '123456'; f.s.clock.value = Date.now() + 130000; await f.s.submit(); assert.equal(f.calls.length, 1); });
test('TOTP: enable payload, refresh and secret cleanup', async () => { const f = totp(); await setupTotp(f); f.s.code.value = '123456'; await f.s.submit(); assert.equal(f.calls[1][1].setup_token, 'fixture-token'); assert.equal(f.calls[1][1].totp_code, '123456'); assert.equal(f.s.status.value.enabled, true); assert.equal(f.s.setup.value, null); });
test('TOTP: disable confirms identity and refreshes', async () => { const f = totp(); await setupTotp(f); f.s.code.value = '123456'; await f.s.submit(); await f.s.open(); f.s.credential.value = 'confirm'; await f.s.submit(); assert.equal(f.calls.at(-1)[0], 'disable'); assert.equal(f.s.status.value.enabled, false); });
test('TOTP: failed status is unknown and blocks open', async () => { const f = totp(); f.api.getStatus = async () => { throw Error('fixture failure'); }; await f.s.loadStatus(); await f.s.open(); assert.equal(f.s.status.value, null); assert.equal(f.s.show.value, false); assert.equal(f.s.statusError.value, 'fixture failure'); });
test('TOTP: unknown verification method blocks submit', async () => { const f = totp(); f.api.getVerificationMethod = async () => ({ method: 'unknown' }); await f.s.loadStatus(); await f.s.open(); assert.equal(f.s.method.value, null); assert.equal(f.s.canSubmit.value, false); });
test('TOTP: email proof and resend cooldown', async () => { const f = totp(); f.api.getVerificationMethod = async () => ({ method: 'email' }); await f.s.loadStatus(); await f.s.open(); await f.s.sendCode(); await f.s.sendCode(); f.s.credential.value = '123456'; await f.s.submit(); assert.equal(f.calls.filter(c => c[0] === 'send').length, 1); assert.equal(f.calls.at(-1)[1].email_code, '123456'); });
test('TOTP: pending submit blocks duplicate and close', async () => { const f = totp(); let resolve; f.api.initiateSetup = () => { f.calls.push(['pending']); return new Promise(r => { resolve = r; }); }; await f.s.loadStatus(); await f.s.open(); f.s.credential.value = 'password'; const first = f.s.submit(); await f.s.submit(); f.s.close(); assert.equal(f.calls.length, 1); assert.equal(f.s.show.value, true); resolve(f.setupData); await first; });
test('TOTP: unmount clears secret and timer', async () => { const f = totp(); await setupTotp(f); f.lifecycle.unmounted.forEach(fn => fn()); assert.equal(f.s.setup.value, null); assert.equal(f.lifecycle.timersCleared, 1); });

test('register: email and invitation gates supported', async () => { const f = await registration(); assert.equal(f.s.basicRegistration.value, true); });
test('register: password mismatch rejected', async () => { const f = await registration(); f.s.confirmPasswordInput.value = 'different'; await f.s.handleAction(); assert.equal(f.calls.length, 0); });
test('register: missing invitation rejected', async () => { const f = await registration(); f.s.invitationInput.value = ''; await f.s.handleAction(); assert.equal(f.calls.length, 0); });
test('register: unsent email rejected', async () => { const f = await registration(); f.s.emailCodeInput.value = '123456'; await f.s.handleAction(); assert.equal(f.calls.length, 0); });
test('register: send and cooldown prevent resend', async () => { const f = await registration(); await f.s.sendRegistrationCode(); await f.s.sendRegistrationCode(); assert.equal(f.calls.length, 1); assert(f.s.resendSeconds.value > 0); });
test('register: exact proof fields submitted', async () => { const f = await registration(); await f.s.sendRegistrationCode(); f.s.emailCodeInput.value = '123456'; await f.s.handleAction(); assert.equal(f.calls[1][1].verify_code, '123456'); assert.equal(f.calls[1][1].invitation_code, 'INVITE'); });
test('register: third-party captcha stays gated', async () => { const f = await registration(); f.s.publicSettings.value.turnstile_enabled = true; await f.s.handleAction(); assert.equal(f.calls.length, 0); await f.s.sendRegistrationCode(); assert.equal(f.calls.length, 0); });
test('login: button Enter and IME do not submit', () => { const f = lock(); f.s.handleKeydown({ key: 'Enter', target: { closest: () => ({ tagName: 'BUTTON' }) } }); f.s.handleKeydown({ key: 'Enter', target: new f.context.HTMLInputElement(), isComposing: true }); assert.equal(f.calls.length, 0); });

test('email: unsent proof blocks update', async () => { const f = email(); f.s.openEmailBinding(); f.s.emailBindingInput.value = 'new@example.test'; await vue.nextTick(); f.s.emailBindingCode.value = '123456'; await f.s.submitEmailBinding(); assert.equal(f.calls.length, 0); });
test('email: payload, success close and password cleanup', async () => { const f = email(); f.s.openEmailBinding(); f.s.emailBindingInput.value = 'new@example.test'; await vue.nextTick(); await f.s.sendEmailBindingCode(); f.s.emailBindingCode.value = '123456'; f.s.emailBindingPassword.value = 'fixture-password'; await f.s.submitEmailBinding(); assert.equal(f.calls[1][1].email, 'new@example.test'); assert.equal(f.calls[1][1].verify_code, '123456'); assert.equal(f.calls[1][1].password, 'fixture-password'); assert.equal(f.s.emailBindingPassword.value, ''); assert.equal(f.s.showEmailBindingForm.value, false); });
test('email: unknown profile cannot send or mutate', async () => { const f = email(); f.profileReady.value = false; f.s.openEmailBinding(); await f.s.sendEmailBindingCode(); await f.s.submitEmailBinding(); assert.equal(f.calls.length, 0); assert.equal(f.s.showEmailBindingForm.value, false); });

test('recovery: unknown settings, disabled feature and captcha block email', async () => { const f = lock(); f.s.setMode('forgot'); f.s.accountInput.value = 'fixture@example.test'; for (const settings of [null, { password_reset_enabled: false }, { password_reset_enabled: true, turnstile_enabled: true }]) { f.s.publicSettings.value = settings; await f.s.submitRecovery(); } assert.equal(f.calls.length, 0); });
test('recovery: invalid email blocked', async () => { const f = lock(); f.s.setMode('forgot'); f.s.accountInput.value = 'invalid'; await f.s.submitRecovery(); assert.equal(f.calls.length, 0); });
test('recovery: forgot email payload and submitted state', async () => { const f = lock(); f.s.setMode('forgot'); f.s.accountInput.value = 'fixture@example.test'; await f.s.submitRecovery(); await f.s.submitRecovery(); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][1].email, 'fixture@example.test'); assert.equal(f.s.recoveryComplete.value, true); });
test('recovery: email failure visible and retryable', async () => { const f = lock(); f.s.setMode('forgot'); f.s.accountInput.value = 'fixture@example.test'; f.api.forgotPassword = async () => { throw Error('fixture mail failure'); }; await f.s.submitRecovery(); assert.equal(f.auth.errorMsg, 'fixture mail failure'); assert.equal(f.s.recoveryBusy.value, false); assert.equal(f.s.recoveryComplete.value, false); });
test('reset: callback reads credential and scrubs URL', () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=one-use&other=1'); assert.equal(f.s.readRecoveryLink(), true); assert.equal(f.s.resetToken.value, 'one-use'); assert.equal(f.s.resetEmail.value, 'a@example.test'); assert.equal(f.window.cleanedURL, '/reset-password?other=1'); });
test('reset: incomplete link blocks mutation', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test'); f.s.readRecoveryLink(); await f.s.submitRecovery(); assert.equal(f.s.resetLinkInvalid.value, true); assert.equal(f.calls.length, 0); });
test('reset: length and confirmation validation', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=fixture'); f.s.readRecoveryLink(); f.s.passwordInput.value = 'short'; await f.s.submitRecovery(); f.s.passwordInput.value = '123456'; f.s.confirmPasswordInput.value = 'other'; await f.s.submitRecovery(); assert.equal(f.calls.length, 0); });
test('reset: exact payload, success clears credential, does not login', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=fixture'); f.s.readRecoveryLink(); f.s.passwordInput.value = f.s.confirmPasswordInput.value = '123456'; await f.s.submitRecovery(); assert.equal(f.calls[0][0], 'reset'); assert.equal(f.calls[0][1].new_password, '123456'); assert.equal(f.calls[0][1].token, 'fixture'); assert.equal(f.s.resetToken.value, ''); assert.equal(f.s.passwordInput.value, ''); assert.equal(f.s.recoveryComplete.value, true); assert.equal(f.calls.length, 1); });
test('reset: expired token is invalidated', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=fixture'); f.s.readRecoveryLink(); f.s.passwordInput.value = f.s.confirmPasswordInput.value = '123456'; f.api.resetPassword = async () => { throw { code: 'INVALID_RESET_TOKEN' }; }; await f.s.submitRecovery(); assert.equal(f.s.resetLinkInvalid.value, true); assert.equal(f.s.resetToken.value, ''); });
test('reset: pending submission prevents duplicate and mode switch', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=fixture'); f.s.readRecoveryLink(); f.s.passwordInput.value = f.s.confirmPasswordInput.value = '123456'; let resolve, count = 0; f.api.resetPassword = () => { count++; return new Promise(r => { resolve = r; }); }; const first = f.s.submitRecovery(); await f.s.submitRecovery(); f.s.setMode('switch'); assert.equal(count, 1); assert.equal(f.s.mode.value, 'reset'); resolve({ message: 'ok' }); await first; });
test('reset: callback is not auto-dismissed by saved authentication', async () => { const f = lock('https://example.test/reset-password?email=a%40example.test&token=fixture'); f.auth.isAuthenticated = true; for (const mount of f.lifecycle.mounted) await mount(); assert.equal(f.s.mode.value, 'reset'); assert.equal(f.calls.filter(c => c[0] === 'init').length, 0); });
