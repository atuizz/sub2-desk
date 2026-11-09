// node --test scripts/parity-113-mcp-gaps.test.cjs
// 1.1.3 MCP 缺口补齐：通用 TOTP step-up、启动台按 mcp_enabled 条件注册、
// /oauth/mcp/authorize 深链接线。只用隔离夹具验证，不调真实生产后端，不用生产 key。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'packages/sub2-console/src');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
const vue = req('vue');
const compiler = req('vue/compiler-sfc');
const read = (file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8');
const flush = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// ---- useStepUp.ts：剥离 import 后在 vm 里执行，ref 用最小 mock ----
function loadStepUp() {
  let source = read('composables/useStepUp.ts');
  source = source.replace(/^import[^\n]*\n/gm, '');
  const context = {
    ref: (v) => ({ value: v }),
    console,
    setTimeout,
    clearTimeout,
    Error,
    exports: {},
    module: { exports: {} },
  };
  vm.createContext(context);
  const out = ts.transpileModule(
    `${source}\nglobalThis.subject = { useStepUp, isStepUpCancelled, isStepUpBlocked, isStepUpRequired, stepUpBlockReason, StepUpCancelledError };`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  vm.runInContext(out, context);
  return context.subject;
}

test('useStepUp: first success passes through without prompting', async () => {
  const { useStepUp } = loadStepUp();
  const stepUp = useStepUp();
  let calls = 0;
  const result = await stepUp.run(async () => { calls++; return 'ok'; });
  assert.equal(result, 'ok');
  assert.equal(calls, 1);
  assert.equal(stepUp.visible.value, false);
});

test('useStepUp: STEP_UP_REQUIRED prompts, verifies, retries once', async () => {
  const { useStepUp } = loadStepUp();
  const stepUp = useStepUp();
  let calls = 0;
  const action = async () => {
    calls++;
    if (calls === 1) throw { status: 403, code: 'STEP_UP_REQUIRED', message: 'needs verification' };
    return 'done';
  };
  const pending = stepUp.run(action);
  await flush();
  assert.equal(stepUp.visible.value, true);
  assert.equal(calls, 1);
  stepUp.onVerified();
  assert.equal(await pending, 'done');
  assert.equal(calls, 2);
  assert.equal(stepUp.visible.value, false);
});

test('useStepUp: STEP_UP_REQUIRED via reason shape also prompts', async () => {
  const { useStepUp } = loadStepUp();
  const stepUp = useStepUp();
  let calls = 0;
  const pending = stepUp.run(async () => {
    calls++;
    if (calls === 1) throw { status: 403, reason: 'STEP_UP_REQUIRED' };
    return 'ok';
  });
  await flush();
  assert.equal(stepUp.visible.value, true);
  stepUp.onVerified();
  assert.equal(await pending, 'ok');
  assert.equal(calls, 2);
});

test('useStepUp: cancel throws StepUpCancelledError, does not retry', async () => {
  const { useStepUp, isStepUpCancelled } = loadStepUp();
  const stepUp = useStepUp();
  let calls = 0;
  const pending = stepUp.run(async () => {
    calls++;
    throw { status: 403, code: 'STEP_UP_REQUIRED' };
  });
  await flush();
  assert.equal(stepUp.visible.value, true);
  stepUp.onCancel();
  await assert.rejects(pending, (err) => isStepUpCancelled(err));
  assert.equal(calls, 1);
  assert.equal(stepUp.visible.value, false);
});

test('useStepUp: blocked codes throw without prompting', async () => {
  const { useStepUp, isStepUpBlocked, stepUpBlockReason } = loadStepUp();
  for (const marker of ['STEP_UP_TOTP_NOT_ENABLED', 'STEP_UP_ADMIN_API_KEY_FORBIDDEN', 'STEP_UP_MCP_OAUTH_FORBIDDEN']) {
    const stepUp = useStepUp();
    await assert.rejects(
      stepUp.run(async () => { throw { status: 403, code: marker }; }),
      (err) => isStepUpBlocked(err) && stepUpBlockReason(err) === marker,
    );
    assert.equal(stepUp.visible.value, false);
    assert.equal(stepUp.blockedReason.value, marker);
  }
});

test('useStepUp: unrelated errors rethrow without prompting', async () => {
  const { useStepUp } = loadStepUp();
  const stepUp = useStepUp();
  await assert.rejects(stepUp.run(async () => { throw { status: 500, code: 'INTERNAL_ERROR' }; }), (err) => err.code === 'INTERNAL_ERROR');
  assert.equal(stepUp.visible.value, false);
});

// ---- SFC 编译：新 sheet 与改动过的 MCPApp / App.vue ----
for (const file of ['components/auth/TotpStepUpSheet.vue', 'apps/user/MCPApp.vue', 'App.vue']) {
  test(`${file}: SFC script and template compile`, () => {
    const { descriptor, errors } = compiler.parse(read(file), { filename: file });
    assert.deepEqual(errors, []);
    assert.doesNotThrow(() => compiler.compileScript(descriptor, { id: 'parity-113-mcp', inlineTemplate: true }));
    assert.deepEqual(compiler.compileTemplate({ source: descriptor.template.content, filename: file, id: 'parity-113-mcp' }).errors, []);
  });
}

// ---- TotpStepUpSheet 行为：验证成功调 onVerified，失败留框并报错 ----
function executeSheet(totpStepUp) {
  let verified = 0;
  let cancelled = 0;
  const controller = {
    visible: { value: true },
    onVerified: () => { verified++; },
    onCancel: () => { cancelled++; },
  };
  const source = compiler.parse(read('components/auth/TotpStepUpSheet.vue')).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const names = ast.statements.flatMap((n) => (ts.isVariableStatement(n)
    ? n.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => d.name.text)
    : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []));
  let stripped = source;
  for (const n of [...ast.statements].reverse()) {
    if (ts.isImportDeclaration(n)) stripped = stripped.slice(0, n.pos) + stripped.slice(n.end);
  }
  const context = {
    ...vue,
    exports: {},
    URL,
    console,
    setTimeout,
    clearTimeout,
    watch: () => {},
    onMounted: () => {},
    onUnmounted: () => {},
    defineProps: () => ({ controller }),
    totpAPI: { stepUp: totpStepUp },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(`${stripped}\nglobalThis.subject = { ${names.join(',')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { s: context.subject, controller, get verified() { return verified; }, get cancelled() { return cancelled; } };
}

test('TotpStepUpSheet: valid code verifies and calls onVerified', async () => {
  let seen = '';
  const sheet = executeSheet(async (code) => { seen = code; return { verified: true, expires_in: 300 }; });
  sheet.s.code.value = '123456';
  await sheet.s.submit();
  assert.equal(seen, '123456');
  assert.equal(sheet.verified, 1);
  assert.equal(sheet.s.code.value, '');
});

test('TotpStepUpSheet: short code is rejected locally without calling stepUp', async () => {
  let calls = 0;
  const sheet = executeSheet(async () => { calls++; return { verified: true, expires_in: 300 }; });
  sheet.s.code.value = '123';
  await sheet.s.submit();
  assert.equal(calls, 0);
  assert.match(sheet.s.error.value, /6 位/);
  assert.equal(sheet.verified, 0);
});

test('TotpStepUpSheet: failed verification keeps dialog open with error', async () => {
  const sheet = executeSheet(async () => { throw { message: '验证码错误' }; });
  sheet.s.code.value = '999999';
  await sheet.s.submit();
  assert.equal(sheet.verified, 0);
  assert.equal(sheet.s.error.value, '验证码错误');
  assert.equal(sheet.s.verifying.value, false);
  sheet.s.handleCancel();
  assert.equal(sheet.cancelled, 1);
});

// ---- MCPApp 接线：admin 批准走 step-up，旧禁用逻辑已移除 ----
test('MCPApp: admin approval goes through stepUp.run; old block removed', () => {
  const source = read('apps/user/MCPApp.vue');
  assert.match(source, /stepUp\.run\(action\)/);
  assert.match(source, /isStepUpCancelled\(err\)/);
  assert.match(source, /isStepUpBlocked\(err\)/);
  assert.match(source, /TotpStepUpSheet/);
  assert.doesNotMatch(source, /adminScopeBlocked/);
  assert.doesNotMatch(source, /暂未提供通用验证流程/);
});

// ---- App.vue：启动台按 mcp_enabled 条件注册 ----
test('App.vue: MCP registered only when mcp_enabled, unregistered otherwise', () => {
  const source = read('App.vue');
  assert.match(source, /ALL_APPS\.filter\(app => app\.id !== 'card_shop' && app\.id !== 'mcp'\)/);
  assert.match(source, /syncMcpRegistration/);
  assert.match(source, /getPublicSettings/);
  assert.match(source, /if \(pub\.mcp_enabled === true\) \{\s*\n?\s*wm\.registerApp\(mcpAppDef\)/);
  assert.match(source, /delete wm\.registeredApps\.value\.mcp/);
});

// ---- 深链路由 ----
function loadRoutes() {
  const source = fs.readFileSync(path.join(sourceRoot, 'desktop-routes.ts'), 'utf8');
  const exportsObject = {};
  vm.runInNewContext(req('typescript').transpileModule(source, { compilerOptions: { module: 1, target: 9 } }).outputText, { exports: exportsObject, URL });
  return exportsObject;
}
const resolve = (p) => loadRoutes().desktopTarget(new URL(p, 'https://console.example'));

test('desktop routes: /oauth/mcp/authorize opens MCP app with full query passthrough', () => {
  const target = resolve('/oauth/mcp/authorize?response_type=code&client_id=claude-code&redirect_uri=https%3A%2F%2Fclient.example%2Fcb&scope=mcp&state=xyz&code_challenge=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&code_challenge_method=S256&resource=https%3A%2F%2Fapi.example%2Fapi%2Fv1%2Fmcp');
  assert.equal(target.app, 'mcp');
  // 跨 vm 上下文的对象原型不同，deepStrictEqual 会误判，改按序列化值比较。
  assert.equal(JSON.stringify(target.data.mcp_authorize), JSON.stringify({
    response_type: 'code',
    client_id: 'claude-code',
    redirect_uri: 'https://client.example/cb',
    scope: 'mcp',
    state: 'xyz',
    code_challenge: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    code_challenge_method: 'S256',
    resource: 'https://api.example/api/v1/mcp',
  }));
});

test('desktop routes: MCP authorize drops non-whitelisted query keys', () => {
  const target = resolve('/oauth/mcp/authorize?client_id=x&evil=1&redirect_uri=https%3A%2F%2Fa.example%2F');
  assert.equal(target.data.mcp_authorize.client_id, 'x');
  assert.equal(target.data.mcp_authorize.evil, undefined);
  assert.equal(Object.keys(target.data.mcp_authorize).length, 2);
});

test('desktop routes: login redirect to MCP authorize keeps the query', () => {
  const target = resolve('/login?redirect=%2Foauth%2Fmcp%2Fauthorize%3Fresponse_type%3Dcode%26client_id%3Dabc%26redirect_uri%3Dhttps%253A%252F%252Fa.example%252F');
  assert.equal(target.app, 'mcp');
  assert.equal(target.data.mcp_authorize.response_type, 'code');
  assert.equal(target.data.mcp_authorize.client_id, 'abc');
});

test('desktop routes: MCP authorize trailing slash still resolves; other routes unaffected', () => {
  assert.equal(resolve('/oauth/mcp/authorize/').app, 'mcp');
  assert.equal(resolve('/admin/usage').app, 'admin_usage');
  assert.equal(resolve('/not-an-official-page'), undefined);
});
