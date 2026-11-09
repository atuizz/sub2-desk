// Offline: 0.2.20 新增 API 的路径、HTTP 方法与请求包裹匹配官方；平台清单回归。
// No browser, account, server, payment or configuration access.
// 期望值逐字取自上游 v0.2.20 frontend/src/api/：
//   mcp.ts L45-62、admin/adminAccessKeys.ts L32-38、admin/claudeResetCredits.ts L24-45、
//   admin/settings.ts L1079-1097（get/updateSettings）与 L678-680 / L1002-1004（赠金字段）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const resolve = name => require.resolve(name, { paths: [path.join(root, 'packages/sub2-console')] });
const ts = require(resolve('typescript'));
function evaluate(source, requireFn) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(requireFn, module, module.exports);
  return module.exports;
}
// 与上游 builtin 平台清单一致的 13 个平台（见 constants/platformCatalog.builtin.json）。
const PLATFORM_IDS = ['anthropic','openai','gemini','antigravity','grok','kimi','zhipu','deepseek','minimax','opencode_go','typesafe','command_code','cline'];
function stubClient(calls) {
  return Object.fromEntries(['get','post','put','delete'].map(method => [method, async (...args) => { calls.push([method, ...args]); return { data: { marker: 'fixture' } }; }]));
}
function loadApi(rel, client) {
  return evaluate(fs.readFileSync(path.join(src, rel), 'utf8'), name => {
    if (name === '@/constants/platformCatalog') return { listPlatformIds: () => PLATFORM_IDS };
    if (name === './client' || name === '../client') return { apiClient: client };
    throw new Error(`Unmocked dependency ${name}`);
  });
}

test('MCP 五项调用的路径、HTTP 方法与请求包裹匹配官方', async () => {
  const calls = [];
  const mcp = loadApi('api/mcp.ts', stubClient(calls));
  const authorization = { response_type: 'code', client_id: 'client-1', redirect_uri: 'https://app.invalid/cb', scope: 'mcp', state: 's1', code_challenge: 'ch', code_challenge_method: 'S256', resource: 'https://mcp.invalid' };
  const decision = { authorization, approved: true, scope: 'admin', read_only: false };
  assert.deepEqual(await mcp.mcpAPI.getConnectionConfig(), { marker: 'fixture' });
  assert.deepEqual(await mcp.mcpAPI.listGrants(), { marker: 'fixture' });
  await mcp.mcpAPI.revokeGrant('grant/a b');
  assert.deepEqual(await mcp.mcpAPI.previewAuthorization(authorization), { marker: 'fixture' });
  assert.deepEqual(await mcp.mcpAPI.authorize(decision), { marker: 'fixture' });
  assert.deepEqual(calls, [
    ['get', '/user/mcp/config'],
    ['get', '/user/mcp/grants'],
    ['delete', '/user/mcp/grants/grant%2Fa%20b'],
    ['get', '/user/mcp/authorize', { params: authorization }],
    ['post', '/user/mcp/authorize', decision]
  ]);
});

test('Admin Access Keys 六项调用的路径、HTTP 方法与请求包裹匹配官方', async () => {
  const calls = [];
  const keys = loadApi('api/admin/adminAccessKeys.ts', stubClient(calls));
  const input = { name: 'fixture', description: '', enabled: true, expires_at: null, allowed_ips: [], policy: { rules: [], global_permissions: [] } };
  await keys.list();
  await keys.create(input);
  await keys.update('key/a b', input);
  await keys.rotate('key-1');
  await keys.revoke('key-1');
  await keys.deleteRecord('key-1');
  assert.deepEqual(calls, [
    ['get', '/admin/settings/admin-api-keys'],
    ['post', '/admin/settings/admin-api-keys', input],
    ['put', '/admin/settings/admin-api-keys/key%2Fa%20b', input],
    ['post', '/admin/settings/admin-api-keys/key-1/rotate'],
    ['delete', '/admin/settings/admin-api-keys/key-1'],
    ['delete', '/admin/settings/admin-api-keys/key-1/record']
  ]);
  // 对象导出与裸函数导出是同一批实现（上游只有裸函数；desk 另附对象导出供页面引用）。
  assert.equal(keys.adminAccessKeysAPI.list, keys.list);
  assert.equal(keys.adminAccessKeysAPI.deleteRecord, keys.deleteRecord);
});

test('Claude Reset Credits 查询与兑换匹配官方，兑换带 Idempotency-Key', async () => {
  const calls = [];
  const credits = loadApi('api/admin/claudeResetCredits.ts', stubClient(calls));
  assert.deepEqual(await credits.getClaudeResetCredits(7), { marker: 'fixture' });
  assert.deepEqual(await credits.redeemClaudeResetCredit(7, 'op-123'), { marker: 'fixture' });
  assert.deepEqual(calls, [
    ['get', '/admin/accounts/7/claude/reset-credits'],
    ['post', '/admin/accounts/7/claude/reset-credits/redeem', undefined, { headers: { 'Idempotency-Key': 'op-123' } }]
  ]);
  // 幂等键只走请求头，不进 body：同一确认重试可安全重放，body 保持 undefined。
  assert.equal(calls[1][2], undefined);
  assert.equal(calls[1][3].headers['Idempotency-Key'], 'op-123');
});

test('CONCRETE_PLATFORM_OPTIONS 含 13 个平台且包含 0.2.20 新增五平台', () => {
  const builtin = JSON.parse(fs.readFileSync(path.join(src, 'constants/platformCatalog.builtin.json'), 'utf8'));
  const catalog = evaluate(fs.readFileSync(path.join(src, 'constants/platformCatalog.ts'), 'utf8'), name => {
    // 转译后 JSON 默认导入取 require(...).default，故桩须包一层 default。
    if (name === './platformCatalog.builtin.json') return { default: builtin };
    throw new Error(`Unmocked dependency ${name}`);
  });
  const platforms = evaluate(fs.readFileSync(path.join(src, 'constants/platforms.ts'), 'utf8'), name => {
    if (name === './platformCatalog') return catalog;
    throw new Error(`Unmocked dependency ${name}`);
  });
  const ids = platforms.CONCRETE_PLATFORM_OPTIONS.map(option => option.value);
  assert.deepEqual(ids, PLATFORM_IDS);
  assert.equal(ids.length, 13);
  for (const id of ['minimax', 'opencode_go', 'typesafe', 'command_code', 'cline']) assert.ok(ids.includes(id), `platform list lost ${id}`);
  for (const option of platforms.CONCRETE_PLATFORM_OPTIONS) assert.equal(typeof option.label, 'string');
  assert.ok(platforms.CONCRETE_PLATFORM_OPTIONS.every(option => option.label.length > 0));
});

test('设置读写原样透传充值赠金档位字段，无专属端点', async () => {
  const calls = [];
  const settings = loadApi('api/admin/settings.ts', stubClient(calls));
  // 上游无赠金专属端点：三个字段随通用 SystemSettings 走 GET/PUT /admin/settings
  //（上游 settings.ts L678-680 SystemSettings、L1002-1004 UpdateSettingsRequest）。
  const source = fs.readFileSync(path.join(src, 'api/admin/settings.ts'), 'utf8');
  for (const field of ['payment_recharge_bonus_tiers', 'payment_recharge_bonus_mode', 'payment_recharge_bonus_notice']) {
    assert.ok(source.split(field).length - 1 >= 2, `settings source lost ${field} in request/response types`);
  }
  assert.deepEqual(await settings.getSettings(), { marker: 'fixture' });
  const payload = {
    payment_recharge_bonus_tiers: [{ min_amount: 100, bonus_percent: 10 }],
    payment_recharge_bonus_mode: 'percent',
    payment_recharge_bonus_notice: 'fixture notice'
  };
  assert.deepEqual(await settings.updateSettings(payload), { marker: 'fixture' });
  assert.deepEqual(calls, [
    ['get', '/admin/settings'],
    ['put', '/admin/settings', payload]
  ]);
});
