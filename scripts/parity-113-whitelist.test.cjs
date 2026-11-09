// node --test scripts/parity-113-whitelist.test.cjs
// 1.1.3 缺口 5/6：模型白名单模块 + OpenAI 自动用卡运行态。
// 覆盖：白名单候选接口路径/方法/返回解析/空态、useModelWhitelist 纯函数、
// 分组白名单状态机、候选请求守卫、autoResetCredit 运行态解析。
// 被测模块均为本地源码；HTTP 全部由夹具替换，禁止真实网络。
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
const plain = v => JSON.parse(JSON.stringify(v));
// 跨 vm realm 的返回值原型与宿主不同，deepEqual 前先过 plain()（与既有 parity 测试同一做法）。
const eq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

function modules(handler, stubs = {}) {
  const calls = [];
  const cache = new Map();
  // 与 parity-113-accounts.test.cjs 的夹具相同：记录每一次请求，禁止真实网络。
  const apiClient = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, async (url, payload, options) => {
    calls.push({ method, url, payload: plain(payload ?? null), options: plain(options ?? null) });
    return { data: await handler(method, url, payload, options) };
  }]));
  function load(file) {
    file = path.resolve(src, file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const sandbox = {
      module, exports: module.exports, URL, Error, Date, AbortController, console,
      require(spec) {
        if (spec === '../client') return { apiClient };
        if (Object.prototype.hasOwnProperty.call(stubs, spec)) return stubs[spec];
        if (spec.startsWith('@/')) return load(spec.slice(2) + '.ts');
        if (spec.startsWith('.')) return load(path.resolve(path.dirname(file), spec) + '.ts');
        throw new Error(`Forbidden import: ${spec}`);
      },
      fetch() { throw new Error('Live network forbidden'); },
    };
    vm.runInNewContext(js, sandbox, { filename: file });
    return module.exports;
  }
  return { calls, load };
}

// useModelWhitelist 的两个运行时依赖全部 stub，不读真实平台目录与后端。
const KNOWN_PLATFORMS = new Set(['openai', 'anthropic', 'claude', 'gemini', 'antigravity', 'zhipu', 'qwen', 'deepseek', 'mistral', 'meta', 'xai', 'grok', 'cohere', 'yi', 'moonshot', 'kimi', 'doubao', 'minimax', 'baidu', 'spark', 'hunyuan', 'perplexity', 'bedrock', 'opencode_go', 'typesafe', 'some-aggregator']);
const platformCatalogStub = { getProviderProfile: platform => (KNOWN_PLATFORMS.has(platform) ? { id: platform } : undefined) };
function whitelistModules(antigravityMapping, antigravityFails = false) {
  let mappingCalls = 0;
  const accountsStub = {
    getAntigravityDefaultModelMapping: async () => {
      mappingCalls += 1;
      if (antigravityFails) throw new Error('upstream down');
      return antigravityMapping;
    },
  };
  const { load } = modules(async () => { throw new Error('no HTTP expected'); }, {
    '@/constants/platformCatalog': platformCatalogStub,
    '@/api/admin/accounts': accountsStub,
  });
  return { api: load('composables/useModelWhitelist.ts'), mappingCalls: () => mappingCalls };
}

test('gap5: getModelAllowlistCandidates 调 GET /admin/groups/{id}/model-allowlist-candidates 并解析 models', async () => {
  const { calls, load } = modules(async (method, url, payload, options) => {
    assert.equal(method, 'get');
    if (url === '/admin/groups/12/model-allowlist-candidates') return { models: ['claude-opus-5-5', 'gpt-6.1-terra'] };
    if (url === '/admin/groups/0/model-allowlist-candidates') return { models: ['gpt-5.2'] };
    if (url === '/admin/groups/7/model-allowlist-candidates') return {};
    throw new Error(`unexpected url ${url}`);
  });
  const groups = load('api/admin/groups.ts');

  const models = await groups.getModelAllowlistCandidates(12, 'openai');
  eq(models, ['claude-opus-5-5', 'gpt-6.1-terra']);
  assert.equal(calls[0].url, '/admin/groups/12/model-allowlist-candidates');
  eq(calls[0].payload.params, { platform: 'openai' });

  // 新建分组走 id=0；不传 platform 时不带 query。
  const created = await groups.getModelAllowlistCandidates(0, 'openai');
  eq(created, ['gpt-5.2']);
  assert.equal(calls[1].url, '/admin/groups/0/model-allowlist-candidates');
  await groups.getModelAllowlistCandidates(7);
  eq(calls[2].payload, {}, '不传 platform 时 config 里没有 params');

  // 空态：后端未返回 models 时返回 []，不抛错。
  const empty = await groups.getModelAllowlistCandidates(7, 'gemini');
  eq(empty, []);

  // 旧别名与新函数同一实现。
  assert.equal(groups.getModelsListCandidates, groups.getModelAllowlistCandidates);
});

test('gap5: useModelWhitelist 按平台取模型列表，未知平台回落 Claude，有 profile 但无内置列表返回空', () => {
  const { api } = whitelistModules({});
  assert.ok(api.getModelsByPlatform('openai').includes('gpt-6.1-terra'));
  assert.ok(api.getModelsByPlatform('openai').includes('gpt-5.2'));
  assert.ok(api.getModelsByPlatform('anthropic').includes('claude-opus-5-5'));
  assert.ok(api.getModelsByPlatform('gemini').includes('gemini-4-argon'));
  assert.ok(api.getModelsByPlatform('antigravity').includes('claude-opus-5-5-high'));
  // 未知平台（无 profile）：默认不预填白名单会误伤新账号以外的场景，回落 Claude 列表。
  eq(api.getModelsByPlatform('acme-xyz'), api.claudeModels);
  // 已知聚合平台但无内置列表：返回 []，不预填。
  eq(api.getModelsByPlatform('some-aggregator'), []);
  assert.ok(api.allModels.some(m => m.value === 'gpt-6.1-terra' && m.label === 'gpt-6.1-terra'));
  assert.equal(api.getPresetMappingsByPlatform('openai')[0].label, 'GPT-4o');
  assert.equal(api.getPresetMappingsByPlatform('gemini')[0].label, 'Flash 2.0');
  assert.equal(api.getPresetMappingsByPlatform('unknown')[0].label, 'Fable 5.1');
});

test('gap5: split/buildModelMappingObject 与通配符校验（与上游同语义）', () => {
  const { api } = whitelistModules({});
  const split = api.splitModelMappingObject({ 'claude-opus-5-5': 'claude-opus-5-5', 'claude-opus-4-6': 'claude-sonnet-4-5-20250929', junk: 42, '  ': 'x' });
  eq(split.allowedModels, ['claude-opus-5-5']);
  eq(split.modelMappings, [{ from: 'claude-opus-4-6', to: 'claude-sonnet-4-5-20250929' }]);
  eq(api.splitModelMappingObject(null), { allowedModels: [], modelMappings: [] });
  eq(api.splitModelMappingObject(undefined), { allowedModels: [], modelMappings: [] });

  // whitelist 模式跳过通配符条目（否则会把真实模型映射成 "claude-*" 导致转发失败）。
  eq(
    api.buildModelMappingObject('whitelist', ['gpt-6.1-terra', 'claude-*', '  '], []),
    { 'gpt-6.1-terra': 'gpt-6.1-terra' },
  );
  // mapping 模式：from 的 * 只能在末尾且只能一个，to 不能含 *。
  eq(
    api.buildModelMappingObject('mapping', [], [
      { from: 'claude-*', to: 'claude-sonnet-5-5-high' },
      { from: 'claude-*-x', to: 'gpt-5.4' },
      { from: 'gpt-5.4', to: 'gpt-*' },
    ]),
    { 'claude-*': 'claude-sonnet-5-5-high' },
  );
  eq(
    api.buildModelMappingObject('combined', ['gpt-6.1-terra'], [{ from: 'claude-opus-4-6', to: 'claude-sonnet-4-5-20250929' }]),
    { 'gpt-6.1-terra': 'gpt-6.1-terra', 'claude-opus-4-6': 'claude-sonnet-4-5-20250929' },
  );
  assert.equal(api.buildModelMappingObject('whitelist', [], []), null);
  assert.equal(api.isValidWildcardPattern('claude-*'), true);
  assert.equal(api.isValidWildcardPattern('claude-*-x'), false);
  assert.equal(api.isValidWildcardPattern('a*b*c'), false);
  assert.equal(api.isValidWildcardPattern('gpt-6.1-terra'), true);
});

test('gap5: fetchAntigravityDefaultMappings 成功缓存一次、失败返回空数组', async () => {
  const ok = whitelistModules({ 'gemini-4-argon': 'gemini-4-argon-high', 'claude-opus-5-5': 'claude-opus-5-5-high' });
  eq(await ok.api.fetchAntigravityDefaultMappings(), [
    { from: 'gemini-4-argon', to: 'gemini-4-argon-high' },
    { from: 'claude-opus-5-5', to: 'claude-opus-5-5-high' },
  ]);
  await ok.api.fetchAntigravityDefaultMappings();
  assert.equal(ok.mappingCalls(), 1, '第二次调用应命中缓存，不再请求后端');

  const failed = whitelistModules({}, true);
  eq(await failed.api.fetchAntigravityDefaultMappings(), []);
});

test('gap5: 分组白名单状态机——已有保存时只选已保存，空保存时默认全选候选', () => {
  const { api } = whitelistModules({});
  const saved = api.hydrateModelAllowlistState({ enabled: true, models: ['gpt-6.1-terra'] }, ['gpt-6.1-terra', 'gpt-5.2', 'gpt-5.2']);
  assert.equal(saved.enabled, true);
  eq(saved.savedModels, ['gpt-6.1-terra']);
  eq(saved.items, [
    { id: 'gpt-6.1-terra', selected: true },
    { id: 'gpt-5.2', selected: false },
  ]);
  assert.equal(api.selectedModelAllowlistCount(saved), 1);

  // 候选去重、去空白；切换/全选/反选/移动。
  api.toggleModelAllowlistItem(saved, 'gpt-5.2');
  assert.equal(api.selectedModelAllowlistCount(saved), 2);
  api.invertModelAllowlistSelection(saved);
  assert.equal(api.selectedModelAllowlistCount(saved), 0);
  api.selectAllModelAllowlistItems(saved);
  assert.equal(api.selectedModelAllowlistCount(saved), 2);
  api.moveModelAllowlistItem(saved, 0, 1);
  eq(saved.items.map(i => i.id), ['gpt-5.2', 'gpt-6.1-terra']);
  api.moveModelAllowlistItem(saved, 0, 99);
  eq(saved.items.map(i => i.id), ['gpt-5.2', 'gpt-6.1-terra'], '越界移动不改顺序');

  // 空保存 + 候选：默认全选。
  const fresh = api.hydrateModelAllowlistState({ enabled: false, models: [] }, ['a', 'b']);
  eq(fresh.items, [{ id: 'a', selected: true }, { id: 'b', selected: true }]);
  // 空态：无保存无候选。
  const empty = api.hydrateModelAllowlistState(null, []);
  eq(empty, { enabled: false, savedModels: [], items: [] });
  eq(api.buildModelAllowlistConfig(empty), { enabled: false, models: [] });
  eq(api.buildModelAllowlistConfig(saved), { enabled: true, models: ['gpt-5.2', 'gpt-6.1-terra'] });
});

test('gap5: addCustomModelAllowlistItem 空值/重复报错，成功追加并选中', () => {
  const { api } = whitelistModules({});
  const state = api.hydrateModelAllowlistState({ enabled: true, models: ['gpt-6.1-terra'] }, ['gpt-6.1-terra']);
  assert.equal(api.addCustomModelAllowlistItem(state, '   '), 'empty');
  assert.equal(api.addCustomModelAllowlistItem(state, 'GPT-6.1-TERRA'), 'duplicate');
  assert.equal(api.addCustomModelAllowlistItem(state, 'claude-*'), null);
  eq(state.items.at(-1), { id: 'claude-*', selected: true });
  eq(api.buildModelAllowlistConfig(state).models, ['gpt-6.1-terra', 'claude-*']);
});

test('gap5: 候选请求守卫丢弃过期响应，create/edit 互不干扰', () => {
  const { api } = whitelistModules({});
  const tracker = api.createModelAllowlistCandidatesTracker();
  const first = tracker.next({ mode: 'edit', groupID: 1, platform: 'openai' });
  const second = tracker.next({ mode: 'edit', groupID: 2, platform: 'openai' });
  assert.equal(tracker.isCurrent(first, { mode: 'edit', groupID: 1, platform: 'openai' }), false, '同 mode 下旧请求过期');
  assert.equal(tracker.isCurrent(second, { mode: 'edit', groupID: 2, platform: 'openai' }), true);
  assert.equal(tracker.isCurrent(second, { mode: 'edit', groupID: 2, platform: 'gemini' }), false, '平台变化后旧请求过期');
  const create = tracker.next({ mode: 'create', groupID: 0, platform: 'openai' });
  assert.equal(tracker.isCurrent(create, { mode: 'create', groupID: 0, platform: 'openai' }), true);
  assert.equal(tracker.isCurrent(second, { mode: 'edit', groupID: 2, platform: 'openai' }), true, 'create 请求不影响 edit 的最新请求');
});

test('gap6: resolveAutoResetCreditState 仅开关开启且 status 合法时展示', () => {
  const { load } = modules(async () => { throw new Error('no HTTP expected'); });
  const mod = load('apps/admin/accounts/autoResetCreditState.ts');

  const base = extra => ({ extra });
  assert.equal(mod.resolveAutoResetCreditState(base({})), null);
  assert.equal(mod.resolveAutoResetCreditState(base({ auto_reset_credit_enabled: false, codex_auto_reset_credit_state: { status: 'success' } })), null);
  assert.equal(mod.resolveAutoResetCreditState(base({ auto_reset_credit_enabled: true })), null, '开关开但无运行态不展示');
  assert.equal(mod.resolveAutoResetCreditState(base({ auto_reset_credit_enabled: true, codex_auto_reset_credit_state: { status: 'bogus' } })), null, '非法 status 不展示');
  assert.equal(mod.resolveAutoResetCreditState(base({ auto_reset_credit_enabled: true, codex_auto_reset_credit_state: 'x' })), null);
  const state = mod.resolveAutoResetCreditState(base({
    auto_reset_credit_enabled: true,
    codex_auto_reset_credit_state: { status: 'success', trigger_window: '5h', checked_at: '2026-11-09T10:00:00Z', error_code: '' },
  }));
  eq(state, { status: 'success', trigger_window: '5h', checked_at: '2026-11-09T10:00:00Z', error_code: '' });

  assert.equal(mod.AUTO_RESET_CREDIT_STATUS_LABELS.success, '自动重置成功');
  assert.equal(mod.AUTO_RESET_CREDIT_STATUS_LABELS.no_credit, '无卡');
  assert.equal(mod.AUTO_RESET_CREDIT_STATUS_LABELS.checking, '检测中');
  assert.ok(mod.autoResetCreditStateClass('success').includes('emerald'));
  assert.ok(mod.autoResetCreditStateClass('failed').includes('red'));
  assert.ok(mod.autoResetCreditStateClass('no_credit').includes('red'));
  assert.ok(mod.autoResetCreditStateClass('checking').includes('gray'));
  assert.equal(mod.formatResetCreditExpiry('not-a-date', 'short'), 'not-a-date');
  assert.match(mod.formatResetCreditExpiry('2026-11-09T10:00:00Z', 'short'), /11\/09|09.*10:00|10:00/);
});

test('gap7: 旧版兼容区源码标记——AdminAccessKeysPanel 标旧版全权，SettingsApp 不再提供旧版新建入口', () => {
  const panel = fs.readFileSync(path.join(src, 'apps/user/settings/AdminAccessKeysPanel.vue'), 'utf8');
  assert.ok(panel.includes('全权访问（兼容旧版管理员 Key）'), '受限密钥列表应标明全权即兼容旧版');
  const settings = fs.readFileSync(path.join(src, 'apps/user/SettingsApp.vue'), 'utf8');
  assert.ok(settings.includes('旧版全权密钥兼容区'), '旧版区应有与上游 adminAccessKeys.legacy 一致的标题');
  assert.ok(settings.includes('旧版密钥已停止新建'), '不存在旧版密钥时应说明已停止新建，而非提供新建按钮');
  assert.ok(!settings.includes("'生成密钥'"), '不存在旧版密钥时不应再出现“生成密钥”按钮文案（后端轮换接口会 403）');
  assert.ok(settings.includes("v-if=\"adminApiKeyStatus.exists\""), '重新生成/删除只在旧版密钥存在时出现');
});
