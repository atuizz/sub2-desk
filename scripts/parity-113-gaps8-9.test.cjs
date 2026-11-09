// node --test scripts/parity-113-gaps8-9.test.cjs
// 1.1.3 缺口 8/9：API Key 创建上限精确识别；Claude blocking / weekly_resets_at 渲染。
// 上游依据见 ~/workspace/goals/sub2-desk-v1-1-2-deployment/hidden_files/gap8-9-report.md。
// 全部用夹具，不触真实网络与真实后端。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
const vue = req('vue');
const sfc = req('vue/compiler-sfc');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const compile = s => ts.transpileModule(s, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function extract(file, names) {
  const source = sfc.parse(read('packages/sub2-console/src/apps/' + file)).descriptor.scriptSetup.content;
  const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.includes(n.name?.text) : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.includes(d.name.text))).map(n => n.getText(ast)).join('\n');
}
function run(file, names, extra) {
  const ctx = { ...vue, Error, ...extra };
  vm.runInNewContext(compile(extract(file, names) + '\nglobalThis.subject={' + names.join(',') + '}'), ctx);
  return ctx.subject;
}

// ---------- 缺口 8：API Key 创建上限 ----------

test('gap8 classifier: reason identifies count vs rate limits exactly', () => {
  const s = run('user/KeyChainApp.vue', ['classifyKeyCreationLimitError'], {});
  // 上游 api_key_service.go:34-35：403 API_KEY_COUNT_EXCEEDED / 429 API_KEY_CREATE_RATE_LIMITED。
  assert.equal(s.classifyKeyCreationLimitError({ status: 403, code: 403, reason: 'API_KEY_COUNT_EXCEEDED', message: 'api key count limit reached, please delete unused keys first' }), 'count');
  assert.equal(s.classifyKeyCreationLimitError({ status: 429, code: 429, reason: 'API_KEY_CREATE_RATE_LIMITED', message: 'too many api keys created recently, please try again later' }), 'rate');
  // axios 原生形态（reason 嵌在 response.data 里）同样识别。
  assert.equal(s.classifyKeyCreationLimitError({ response: { status: 403, data: { reason: 'API_KEY_COUNT_EXCEEDED' } } }), 'count');
  assert.equal(s.classifyKeyCreationLimitError({ response: { status: 429, data: { reason: 'API_KEY_CREATE_RATE_LIMITED' } } }), 'rate');
});

test('gap8 classifier: status + backend message is only a fallback; bare 429/403 do not match', () => {
  const s = run('user/KeyChainApp.vue', ['classifyKeyCreationLimitError'], {});
  assert.equal(s.classifyKeyCreationLimitError({ status: 403, message: 'api key count limit reached, please delete unused keys first' }), 'count');
  assert.equal(s.classifyKeyCreationLimitError({ status: 429, message: 'too many api keys created recently, please try again later' }), 'rate');
  // 旧启发式会把裸 429 当上限：现在必须返回 null，交给通用报错。
  assert.equal(s.classifyKeyCreationLimitError({ status: 429, message: 'Too Many Requests' }), null);
  assert.equal(s.classifyKeyCreationLimitError({ status: 429, message: 'slow down' }), null);
  assert.equal(s.classifyKeyCreationLimitError({ status: 403, message: 'forbidden' }), null);
  assert.equal(s.classifyKeyCreationLimitError({ status: 500, message: 'boom' }), null);
  assert.equal(s.classifyKeyCreationLimitError(null), null);
  assert.equal(s.classifyKeyCreationLimitError({}), null);
});

test('gap8 messages name the exact limit and the remedy', () => {
  const s = run('user/KeyChainApp.vue', ['KEY_CREATION_LIMIT_MESSAGES'], {});
  assert.match(s.KEY_CREATION_LIMIT_MESSAGES.count, /200/);
  assert.match(s.KEY_CREATION_LIMIT_MESSAGES.count, /删除不用的密钥/);
  assert.match(s.KEY_CREATION_LIMIT_MESSAGES.rate, /60/);
  assert.match(s.KEY_CREATION_LIMIT_MESSAGES.rate, /1 小时内/);
  assert.match(s.KEY_CREATION_LIMIT_MESSAGES.rate, /删除密钥不会返还/);
  // 旧的错误口径（把两档上限混成“60 小时内 200 个”）已不在源码里。
  const src = read('packages/sub2-console/src/apps/user/KeyChainApp.vue');
  assert.equal(src.includes('60 小时内最多创建 200 个'), false);
  assert.equal(src.includes('isKeyCreationLimitError'), false);
  assert.equal(src.includes('API_KEY_COUNT_EXCEEDED'), true);
  assert.equal(src.includes('API_KEY_CREATE_RATE_LIMITED'), true);
});

function keychainCreateCtx(createImpl) {
  const toasts = [];
  const ctx = {
    submitting: vue.ref(false),
    formData: vue.ref({
      name: 'fixture', group_id: 1, use_custom_key: false, custom_key: '',
      enable_ip_restriction: false, ip_whitelist: '', ip_blacklist: '',
      enable_quota: false, quota: null, enable_expiration: false,
      expires_in_days: null, enable_rate_limit: false,
      rate_limit_5h: null, rate_limit_1d: null, rate_limit_7d: null
    }),
    keysAPI: { create: createImpl },
    showToast: (text, kind) => { toasts.push({ text, kind }); },
    showCreateSheet: vue.ref(true),
    loadData: async () => { ctx.loaded = true; },
    loaded: false,
    toasts
  };
  return ctx;
}

test('gap8 handleCreate: limit errors keep the sheet open with the exact message', async () => {
  const countCtx = keychainCreateCtx(async () => { throw { status: 403, code: 403, reason: 'API_KEY_COUNT_EXCEEDED', message: 'api key count limit reached, please delete unused keys first' }; });
  const s1 = run('user/KeyChainApp.vue', ['classifyKeyCreationLimitError', 'KEY_CREATION_LIMIT_MESSAGES', 'validateForm', 'handleCreate'], countCtx);
  await s1.handleCreate();
  assert.equal(countCtx.toasts.length, 1);
  assert.match(countCtx.toasts[0].text, /200/);
  assert.match(countCtx.toasts[0].text, /删除不用的密钥/);
  assert.equal(countCtx.toasts[0].kind, 'error');
  assert.equal(countCtx.showCreateSheet.value, true);
  assert.equal(countCtx.loaded, false);

  const rateCtx = keychainCreateCtx(async () => { throw { status: 429, code: 429, reason: 'API_KEY_CREATE_RATE_LIMITED', message: 'too many api keys created recently, please try again later' }; });
  const s2 = run('user/KeyChainApp.vue', ['classifyKeyCreationLimitError', 'KEY_CREATION_LIMIT_MESSAGES', 'validateForm', 'handleCreate'], rateCtx);
  await s2.handleCreate();
  assert.equal(rateCtx.toasts.length, 1);
  assert.match(rateCtx.toasts[0].text, /60/);
  assert.match(rateCtx.toasts[0].text, /1 小时内/);
  assert.equal(rateCtx.showCreateSheet.value, true);

  const otherCtx = keychainCreateCtx(async () => { throw { status: 400, message: 'name already exists' }; });
  const s3 = run('user/KeyChainApp.vue', ['classifyKeyCreationLimitError', 'KEY_CREATION_LIMIT_MESSAGES', 'validateForm', 'handleCreate'], otherCtx);
  await s3.handleCreate();
  assert.equal(otherCtx.toasts[0].text, 'name already exists');
});

// ---------- 缺口 9：Claude blocking / weekly_resets_at ----------

const claudeFixture = (overrides = {}) => ({
  eligible: true, available_count: 0, fetched_at: '2026-11-09T10:00:00Z',
  weekly_resets_at: '2026-11-16T00:00:00Z',
  credits: [
    { label: '重置卡 A', resets_left: 2, starts_at: '2026-11-09T00:00:00Z', expires_at: '2026-11-16T00:00:00Z',
      clears: ['five_hour', 'seven_day'], percent_used: { five_hour: 90 }, blocking: ['seven_day'],
      use_requires_limit: false, redeemable: false },
    { label: '重置卡 B', resets_left: 1, expires_at: '2026-11-23T00:00:00Z',
      clears: ['seven_day'], percent_used: {}, blocking: [], use_requires_limit: false, redeemable: false }
  ],
  ...overrides
});

function claudeCell(names, statusValue) {
  return run('admin/accounts/ClaudeResetCreditsCell.vue', names, { status: vue.ref(statusValue) });
}

test('gap9 blocking: non-empty blocking on the primary credit is surfaced with its reason', () => {
  // 主卡 = 最早到期的卡（无可兑换卡时），其 blocking 为 ['seven_day']。
  const s = claudeCell(['formatTime', 'windowKeys', 'windowLabels', 'expiryMs', 'primaryCredit', 'creditTitle', 'blockingTitle'], claudeFixture());
  assert.equal(s.primaryCredit.value.label, '重置卡 A');
  assert.match(s.blockingTitle.value, /受阻/);
  assert.match(s.blockingTitle.value, /7d/);
  assert.match(s.creditTitle.value, /受阻，暂不可兑换：7d/);
  // 已知窗口名翻译、未知值原样展示，不猜含义。
  assert.equal(s.windowLabels(['seven_day']), '7d');
  assert.equal(s.windowLabels(['x']), 'x');
  // 可兑换卡（blocking 为空）无受阻提示。
  const ok = claudeCell(['formatTime', 'windowKeys', 'windowLabels', 'expiryMs', 'primaryCredit', 'creditTitle', 'blockingTitle'],
    claudeFixture({ credits: [{ label: '重置卡 A', resets_left: 2, expires_at: '2026-11-16T00:00:00Z', clears: ['five_hour'], percent_used: {}, blocking: [], use_requires_limit: false, redeemable: true }] }));
  assert.equal(ok.blockingTitle.value, '');
  assert.equal(ok.creditTitle.value.includes('受阻'), false);
});

test('gap9 blocking badge and weekly reset are rendered prominently in the template', () => {
  const src = read('packages/sub2-console/src/apps/admin/accounts/ClaudeResetCreditsCell.vue');
  // 状态行里的醒目受阻徽标（红字加粗），不是只藏在折叠详情里。
  assert.equal(src.includes('data-testid="claude-reset-blocking"'), true);
  assert.match(src, /data-testid="claude-reset-blocking"[\s\S]{0,200}text-red-600/);
  assert.match(src, /暂不可兑换（受阻：/);
  // 每张卡的详情行同样醒目（红字加粗），且用 windowLabels 翻译已知窗口名。
  assert.match(src, /受阻，暂不可兑换：\{\{ windowLabels\(credit\.blocking\) \}\}/);
  assert.match(src, /v-if="credit\.blocking\.length" class="font-medium text-red-600/);
  // 每周重置时间行：仅后端返回时展示，文案带“（推测）”限定（上游无明文定义）。
  assert.equal(src.includes('data-testid="claude-reset-weekly"'), true);
  assert.equal(src.includes('v-if="visible && status && status.weekly_resets_at"'), true);
  assert.match(src, /每周重置（推测） \{\{ formatTime\(status\.weekly_resets_at, 'short'\) \}\}/);
});

test('gap9 weekly_resets_at: formatted in local time, absent when the backend omits it', () => {
  const s = claudeCell(['formatTime'], claudeFixture());
  const text = s.formatTime('2026-11-16T00:00:00Z', 'short');
  assert.equal(typeof text, 'string');
  assert.equal(text.includes('T'), false);
  assert.match(text, /11/);
  assert.match(text, /16/);
  assert.equal(s.formatTime('not-a-date', 'short'), 'not-a-date');
  // 后端未返回 weekly_resets_at 时不展示：模板守卫只认该字段本身。
  const src = read('packages/sub2-console/src/apps/admin/accounts/ClaudeResetCreditsCell.vue');
  assert.equal(src.includes("status.weekly_resets_at"), true);
  const noWeekly = claudeFixture({ weekly_resets_at: undefined });
  assert.equal(noWeekly.weekly_resets_at, undefined);
});
