// node --test scripts/parity-113-accounts.test.cjs
// 1.1.3 账号页：Claude 原生重置额度、Grok 模型目录诊断、OpenCode GO 单账号用量。
// Actual TypeScript adapters and Vue setup scripts; all HTTP is replaced by fixtures.
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
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function modules(handler) {
  const calls = [];
  const cache = new Map();
  // 与 parity-accounts.test.cjs 的夹具相同，但同时记录第三个参数（headers/options），
  // 以便断言幂等键等请求头；仍禁止一切真实网络。
  const apiClient = Object.fromEntries(['get','post','put','delete'].map(method => [method, async (url, payload, options) => {
    calls.push({method,url,payload:plain(payload ?? null),options:plain(options ?? null)});
    return {data:await handler(method,url,payload,options)};
  }]));
  function load(file) {
    file = path.resolve(src,file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = {exports:{}}; cache.set(file,module);
    const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
    const sandbox = {module,exports:module.exports,URL,Error,Date,AbortController,console,
      require(spec) {
        if (spec === '../client') return {apiClient};
        if (spec.startsWith('@/')) return load(spec.slice(2)+'.ts');
        if (spec.startsWith('.')) return load(path.resolve(path.dirname(file),spec)+'.ts');
        throw new Error(`Forbidden import: ${spec}`);
      },fetch(){throw new Error('Live network forbidden');}};
    vm.runInNewContext(js,sandbox,{filename:file});
    return module.exports;
  }
  return {load,calls};
}
function component(file, overrides={}, props={}) {
  const filename=path.join(src,file);
  const {descriptor,errors}=parse(fs.readFileSync(filename,'utf8'),{filename});
  assert.deepEqual(errors,[]);
  const compiled=compileTemplate({source:descriptor.template.content,filename,id:'fixture',compilerOptions:{expressionPlugins:['typescript']}});
  assert.deepEqual(compiled.errors,[]);
  let source=descriptor.scriptSetup.content;
  const ast=ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
  for(const n of [...ast.statements].reverse()) if(ts.isImportDeclaration(n)) source=source.slice(0,n.pos)+source.slice(n.end);
  const events=[],mounted=[],unmounted=[];
  const scope=vue.effectScope();
  const auth=vue.reactive({user:{id:8,role:'admin'},token:'fixture-token',sessionRevision:0});
  const storage=()=>{const values=new Map();return {
    getItem:key=>values.get(String(key))??null,
    setItem:(key,value)=>{values.set(String(key),String(value));},
    removeItem:key=>{values.delete(String(key));}
  };};
  const context={...vue,...modules(async()=>[]).load('apps/admin/accounts/cn-provider.ts'),Error,URL,Date,AbortController,console,
    useAuthStore:()=>auth,localStorage:storage(),sessionStorage:storage(),
    defineProps:()=>props,defineEmits:()=> (...args)=>events.push(args),
    onMounted:fn=>mounted.push(fn),onUnmounted:fn=>unmounted.push(fn),onBeforeUnmount:fn=>unmounted.push(fn),
    setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    document:{hidden:false,removeEventListener(){}},
    fetch(){throw new Error('Live network forbidden');},...overrides};
  const js=ts.transpileModule(source+`\nglobalThis.subject={${names.join(',')}};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  scope.run(()=>vm.runInNewContext(js,context,{filename}));
  return {s:context.subject,events,mounted,dispose(){unmounted.forEach(fn=>fn());scope.stop();}};
}
const prefix='apps/admin/accounts/';
const claudeCreditsFixture = () => ({
  eligible: true, available_count: 1, fetched_at: '2026-11-09T10:00:00Z',
  credits: [
    { label: '重置卡 A', resets_left: 2, starts_at: '2026-11-09T00:00:00Z', expires_at: '2026-11-16T00:00:00Z',
      clears: ['five_hour', 'seven_day'], percent_used: { five_hour: 90, seven_day: 40 },
      blocking: [], use_requires_limit: false, redeemable: true },
    { label: '重置卡 B', resets_left: 1, expires_at: '2026-11-23T00:00:00Z',
      clears: ['seven_day_overage_included'], percent_used: {}, blocking: ['limit_not_reached'],
      use_requires_limit: true, redeemable: false }
  ]
});

test('claude reset API routes and idempotency header are exact', async () => {
  const f = modules(async () => ({ ok: true }));
  const api = f.load('api/admin/claudeResetCredits.ts');
  await api.getClaudeResetCredits(9);
  await api.redeemClaudeResetCredit(9, 'claude-reset-9-fixture-key');
  assert.deepEqual(f.calls.map(c => [c.method, c.url]), [
    ['get', '/admin/accounts/9/claude/reset-credits'],
    ['post', '/admin/accounts/9/claude/reset-credits/redeem']
  ]);
  assert.equal(f.calls[1].payload, null);
  assert.equal(f.calls[1].options.headers['Idempotency-Key'], 'claude-reset-9-fixture-key');
});

test('opencode-go single-account API routes keep false booleans', async () => {
  const f = modules(async () => ({ account_id: 9, eligible: true, auto_refresh_enabled: false }));
  const api = f.load('api/admin/accounts.ts');
  await api.getOpenCodeGoUsage(9);
  await api.setOpenCodeGoUsageAutoRefresh(9, false);
  await api.refreshOpenCodeGoUsage(9);
  assert.deepEqual(f.calls.map(c => [c.method, c.url]), [
    ['get', '/admin/accounts/9/opencode-go-usage'],
    ['put', '/admin/accounts/9/opencode-go-usage/auto-refresh'],
    ['post', '/admin/accounts/9/opencode-go-usage/refresh']
  ]);
  assert.deepEqual(f.calls[1].payload, { enabled: false });
});

test('claude cell: only anthropic oauth rows show it; count sums all cards', async () => {
  const calls = [];
  const api = {
    getClaudeResetCredits: async id => { calls.push(['get', id]); return claudeCreditsFixture(); },
    redeemClaudeResetCredit: async () => ({ outcome: 'reset', cleared: ['five_hour'], replayed: false })
  };
  const f = component(prefix + 'ClaudeResetCreditsCell.vue',
    { ...api, MacAlertSheet: {} },
    { account: { id: 9, platform: 'anthropic', type: 'oauth' } });
  assert.equal(f.s.visible.value, true);
  await f.s.refresh();
  assert.equal(calls.length, 1);
  assert.equal(f.s.totalResets.value, 3);
  assert.equal(f.s.canRedeem.value, true);
  assert.equal(f.s.primaryCredit.value.label, '重置卡 A');
  assert.equal(f.s.percentUsedText(f.s.status.value.credits[0]), '5h 90%、7d 40%');
  f.dispose();
  const other = component(prefix + 'ClaudeResetCreditsCell.vue',
    { ...api, MacAlertSheet: {} },
    { account: { id: 10, platform: 'openai', type: 'oauth' } });
  assert.equal(other.s.visible.value, false);
  other.dispose();
});

test('claude redeem: one confirmation reuses its key on unknown failure, new key after a definite answer', async () => {
  const keys = [];
  let attempts = 0;
  const api = {
    getClaudeResetCredits: async () => claudeCreditsFixture(),
    redeemClaudeResetCredit: async (id, key) => {
      keys.push(key); attempts++;
      if (attempts === 1) throw { message: 'network down' };
      if (attempts === 2) return { outcome: 'reset', cleared: ['five_hour'], replayed: false };
      return { outcome: 'reset', cleared: ['five_hour'], replayed: true };
    }
  };
  const f = component(prefix + 'ClaudeResetCreditsCell.vue',
    { ...api, MacAlertSheet: {} },
    { account: { id: 9, platform: 'anthropic', type: 'oauth' } });
  await f.s.refresh();
  assert.equal(keys.length, 0);
  f.s.openRedeemConfirm();
  await f.s.confirmRedeem();
  assert.equal(keys.length, 1);
  assert.match(keys[0], /^claude-reset-9-/);
  assert.equal(f.s.redeemFeedback.value.text, 'network down');
  // 同一次确认内重试：沿用同一幂等键，不会消耗第二张卡。
  f.s.openRedeemConfirm();
  await f.s.confirmRedeem();
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  assert.match(f.s.redeemFeedback.value.text, /重置成功，已清除：5h/);
  assert.ok(f.events.some(e => e[0] === 'redeemed' && e[1].outcome === 'reset'));
  // 已拿到服务端确定回答：下一次确认生成新 key。
  await f.s.refresh();
  f.s.openRedeemConfirm();
  await f.s.confirmRedeem();
  assert.equal(keys.length, 3);
  assert.notEqual(keys[2], keys[0]);
  f.dispose();
});

test('claude redeem: pre-claim refusals drop the key; six outcomes map to distinct feedback', async () => {
  let behavior = 'busy';
  const api = {
    getClaudeResetCredits: async () => claudeCreditsFixture(),
    redeemClaudeResetCredit: async (id, key) => {
      if (behavior === 'busy') throw { reason: 'CLAUDE_RESET_BUSY' };
      return { outcome: behavior, replayed: false, cooldown_until: '2026-11-09T12:00:00Z' };
    }
  };
  const keys = [];
  const orig = api.redeemClaudeResetCredit;
  api.redeemClaudeResetCredit = async (id, key) => { keys.push(key); return orig(id, key); };
  const f = component(prefix + 'ClaudeResetCreditsCell.vue',
    { ...api, MacAlertSheet: {} },
    { account: { id: 9, platform: 'anthropic', type: 'oauth' } });
  await f.s.refresh();
  f.s.openRedeemConfirm();
  await f.s.confirmRedeem();
  assert.match(f.s.redeemFeedback.value.text, /另一个重置正在进行中/);
  const busyKey = keys[0];
  f.s.openRedeemConfirm();
  await f.s.confirmRedeem();
  // 兑换前拒绝不保留 key：第二次确认是新 key。
  assert.notEqual(keys[1], busyKey);
  assert.match(f.s.redeemFeedback.value.text, /另一个重置正在进行中/);
  for (const [outcome, pattern] of [
    ['reset', /重置成功/], ['already_used', /已被使用/], ['cooldown', /冷却至/],
    ['not_limited', /无需重置/], ['ineligible', /不可使用重置/], ['unknown', /结果未确认/]
  ]) {
    behavior = outcome;
    assert.match(f.s.outcomeFeedback({ outcome, cooldown_until: '2026-11-09T12:00:00Z' }).text, pattern);
  }
  assert.match(f.s.outcomeFeedback({ outcome: 'unknown', reason: 'upstream_unavailable' }).text, /暂时不可用/);
  assert.equal(f.s.errorText({ reason: 'IDEMPOTENCY_IN_PROGRESS' }), '该重置请求仍在处理中，请稍后查询结果');
  f.dispose();
});

test('claude cell: account switch resets local state', async () => {
  const api = {
    getClaudeResetCredits: async () => claudeCreditsFixture(),
    redeemClaudeResetCredit: async () => ({ outcome: 'reset', replayed: false })
  };
  const props = vue.reactive({ account: { id: 9, platform: 'anthropic', type: 'oauth' } });
  const f = component(prefix + 'ClaudeResetCreditsCell.vue', { ...api, MacAlertSheet: {} }, props);
  await f.s.refresh();
  assert.equal(f.s.status.value !== null, true);
  props.account = { id: 10, platform: 'anthropic', type: 'oauth' };
  await vue.nextTick();
  assert.equal(f.s.status.value, null);
  assert.equal(f.s.redeemFeedback.value, null);
  f.dispose();
});

test('opencode-go cell: refresh emits updated state; auto-refresh toggle reverts on failure', async () => {
  const refreshed = { account_id: 9, eligible: true, auto_refresh_enabled: false,
    snapshot: { status: 'ok', data: { rolling: { percent: 80, resets_at: '2026-11-09T15:00:00Z' } }, fetched_at: '2026-11-09T10:00:00Z' } };
  const calls = [];
  const api = {
    getOpenCodeGoUsage: async id => { calls.push(['get', id]); return refreshed; },
    refreshOpenCodeGoUsage: async id => { calls.push(['refresh', id]); return refreshed; },
    setOpenCodeGoUsageAutoRefresh: async (id, enabled) => {
      calls.push(['auto', id, enabled]);
      if (!enabled) throw { message: 'denied' };
      return { ...refreshed, auto_refresh_enabled: true };
    }
  };
  const props = { account: { id: 9, platform: 'opencode_go',
    opencode_go_usage: { account_id: 9, eligible: true, auto_refresh_enabled: false } } };
  const f = component(prefix + 'OpenCodeGoUsageCell.vue', api, props);
  assert.equal(f.s.statusLabel.value, '正常');
  await f.s.refreshUsage();
  assert.deepEqual(calls[0], ['refresh', 9]);
  assert.equal(f.s.state.value.snapshot.data.rolling.percent, 80);
  assert.ok(f.events.some(e => e[0] === 'updated' && e[1].snapshot.status === 'ok'));
  assert.equal(f.s.windows.value[0].label, '5h');
  await f.s.toggleAutoRefresh(true);
  assert.deepEqual(calls[1], ['auto', 9, true]);
  assert.equal(f.s.state.value.auto_refresh_enabled, true);
  await f.s.toggleAutoRefresh(false);
  assert.equal(f.s.state.value.auto_refresh_enabled, true);
  assert.match(f.s.errorText.value, /更新自动刷新设置失败/);
  f.dispose();
});

test('opencode-go cell: missing state uses read-only GET; rate limit maps to retry hint', async () => {
  const calls = [];
  const api = {
    getOpenCodeGoUsage: async () => { calls.push('get'); return { account_id: 9, eligible: false, auto_refresh_enabled: false }; },
    refreshOpenCodeGoUsage: async () => { throw { response: { data: { code: 'OPENCODE_GO_USAGE_REFRESH_RATE_LIMITED', retry_after_seconds: 45 } } }; },
    setOpenCodeGoUsageAutoRefresh: async () => ({})
  };
  const f = component(prefix + 'OpenCodeGoUsageCell.vue', api,
    { account: { id: 9, platform: 'opencode_go' } });
  assert.equal(f.s.state.value, undefined);
  await f.s.loadInitial();
  assert.deepEqual(calls, ['get']);
  assert.equal(f.s.state.value.eligible, false);
  const g = component(prefix + 'OpenCodeGoUsageCell.vue', api,
    { account: { id: 9, platform: 'opencode_go',
      opencode_go_usage: { account_id: 9, eligible: true, auto_refresh_enabled: false } } });
  await g.s.refreshUsage();
  assert.match(g.s.errorText.value, /45 秒后重试/);
  assert.equal(g.s.readRefreshError({ response: { status: 403 } }).match(/403/)?.[0], '403');
  f.dispose(); g.dispose();
});

function grokFixture(overrides = {}) {
  const now = Date.now();
  return {
    state: 'fresh',
    endpoint: 'https://api.x.ai/v1/models',
    fetched_at: new Date(now - 5 * 60000).toISOString(),
    expires_at: new Date(now + 3600 * 1000).toISOString(),
    models: ['grok-4', 'grok-4-fast'],
    last_attempt: { started_at: new Date(now - 5 * 60000).toISOString(),
      finished_at: new Date(now - 5 * 60000).toISOString(), status: 'success' },
    mappings: [
      { requested: 'grok-4', upstream: 'grok-4', status: 'listed' },
      { requested: 'grok-old', upstream: 'grok-old', status: 'not_listed' }
    ],
    ...overrides
  };
}

test('grok diagnostics: fresh/stale/unknown states, missing mappings, sync emit', () => {
  const f = component(prefix + 'GrokModelDiagnosticsPanel.vue',
    { formatDateTime: v => `DT:${v}` },
    { diagnostics: grokFixture(), canSync: true });
  assert.equal(f.s.effectiveState.value, 'fresh');
  assert.equal(f.s.headline.value, '当前有效');
  assert.equal(f.s.modelCountLabel.value, '2 个模型');
  assert.equal(f.s.catalogHost.value, 'api.x.ai');
  assert.equal(f.s.missingMappings.value.length, 1);
  assert.equal(f.s.missingMappings.value[0].requested, 'grok-old');
  assert.equal(f.s.mappingStatus({ requested: 'x', status: 'not_listed' }), '未在该账号此端点的当前目录中发现');
  assert.equal(f.s.mappingStatus({ requested: 'x', status: 'out_of_scope' }), '不在此文本目录范围内');
  f.s.requestSync();
  assert.ok(f.events.some(e => e[0] === 'sync'));
  f.dispose();

  const stale = component(prefix + 'GrokModelDiagnosticsPanel.vue',
    { formatDateTime: v => `DT:${v}` },
    { diagnostics: grokFixture({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
  assert.equal(stale.s.effectiveState.value, 'stale');
  assert.equal(stale.s.headline.value, '历史目录');
  stale.dispose();

  const unknown = component(prefix + 'GrokModelDiagnosticsPanel.vue',
    { formatDateTime: v => `DT:${v}` },
    { diagnostics: null });
  assert.equal(unknown.s.effectiveState.value, 'unknown');
  assert.equal(unknown.s.headline.value, '未知');
  assert.equal(unknown.s.missingMappings.value.length, 0);
  assert.equal(unknown.s.observedTime(undefined), '未知');
  unknown.dispose();
});

test('grok diagnostics: bad timestamps never produce a trusted state', () => {
  const f = component(prefix + 'GrokModelDiagnosticsPanel.vue',
    { formatDateTime: v => `DT:${v}` },
    { diagnostics: grokFixture({ fetched_at: 'not-a-date', expires_at: 'also-bad' }) });
  assert.equal(f.s.effectiveState.value, 'unknown');
  assert.equal(f.s.lastSuccessRelative.value, '未知');
  f.dispose();
});

test('accounts page keeps the 13-platform list and mounts the three 1.1.3 cells', () => {
  const file = fs.readFileSync(path.join(src, 'apps/admin/AccountsApp.vue'), 'utf8');
  for (const id of ['anthropic', 'openai', 'gemini', 'antigravity', 'deepseek', 'grok', 'kimi', 'zhipu',
    'minimax', 'opencode_go', 'typesafe', 'command_code', 'cline']) {
    assert.ok(file.includes(`id: '${id}'`), `platform list lost ${id}`);
  }
  assert.ok(file.includes('ClaudeResetCreditsCell'));
  assert.ok(file.includes('OpenCodeGoUsageCell'));
  assert.ok(file.includes('GrokModelDiagnosticsPanel'));
  assert.ok(file.includes('syncUpstreamModels'));
  assert.ok(file.includes('grok_model_diagnostics'));
  const claude = fs.readFileSync(path.join(src, prefix, 'ClaudeResetCreditsCell.vue'), 'utf8');
  assert.ok(claude.includes('不可逆'), 'redeem confirm must warn the operation is irreversible');
  assert.ok(claude.includes('claude-reset-'));
});

test('all owned 1.1.3 account templates compile using the real SFC compiler', () => {
  for (const name of ['ClaudeResetCreditsCell.vue', 'OpenCodeGoUsageCell.vue', 'GrokModelDiagnosticsPanel.vue']) {
    const filename = path.join(src, prefix, name);
    const { descriptor, errors } = parse(fs.readFileSync(filename, 'utf8'), { filename });
    assert.deepEqual(errors, []);
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: name, compilerOptions: { expressionPlugins: ['typescript'] } }).errors, []);
  }
  const app = path.join(src, 'apps/admin/AccountsApp.vue');
  const { descriptor, errors } = parse(fs.readFileSync(app, 'utf8'), { filename: app });
  assert.deepEqual(errors, []);
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: app, id: 'AccountsApp', compilerOptions: { expressionPlugins: ['typescript'] } }).errors, []);
});
