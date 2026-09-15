const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require(require.resolve('typescript', { paths: [path.resolve('packages/sub2-console')] }));
const source = fs.readFileSync('packages/sub2-console/src/apps/user/settings/settingsForm.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('exports', 'module', compiled)(mod.exports, mod);
const { copySettings, settingsPatch } = mod.exports;
const base = { backend_mode_enabled: false, site_name: 'Site', site_subtitle: '', api_base_url: '', custom_endpoints: [], smtp_password_configured: true };
test('站点改名不会提交其他模块、未知字段或密码', () => {
  const saved = copySettings(base), draft = { ...saved, site_name: 'New', payment_enabled: true, smtp_password: '' };
  assert.deepEqual(settingsPatch('admin_general', draft, saved), { site_name: 'New' });
});
test('未改动时不生成请求字段', () => assert.deepEqual(settingsPatch('admin_general', copySettings(base), copySettings(base)), {}));
test('后端未读取的模块无法把默认值写回', () => assert.throws(() => settingsPatch('admin_payment', { payment_enabled: true }, {}), /未返回完整模块/));
test('嵌套列表草稿不污染基线', () => {
  const raw = { ...base, custom_endpoints: [{ name: 'A', endpoint: 'https://example.invalid', description: '保留' }] };
  const saved = copySettings(raw), draft = copySettings(raw);
  draft.custom_endpoints[0].name = 'B';
  assert.equal(saved.custom_endpoints[0].name, 'A');
  assert.deepEqual(settingsPatch('admin_general', draft, saved), { custom_endpoints: draft.custom_endpoints });
});
test('空字符串和关闭开关可提交', () => {
  const saved = copySettings({ ...base, site_name: 'X', backend_mode_enabled: true });
  assert.deepEqual(settingsPatch('admin_general', { ...saved, site_name: '', backend_mode_enabled: false }, saved), { backend_mode_enabled: false, site_name: '' });
});

test('隐藏用户排行只提交明确修改的布尔值，旧后端缺字段不能保存', () => {
  const saved = copySettings({ channel_monitor_hide_user_ranking: true });
  assert.deepEqual(settingsPatch('admin_features', { ...saved, channel_monitor_hide_user_ranking: false }, saved), { channel_monitor_hide_user_ranking: false });
  assert.deepEqual(settingsPatch('admin_features', saved, saved), {});
  assert.throws(() => settingsPatch('admin_features', { channel_monitor_hide_user_ranking: false }, {}), /未返回完整模块/);
  assert.throws(() => settingsPatch('admin_features', { channel_monitor_hide_user_ranking: false }, {channel_monitor_hide_user_ranking: 'true'}), /重新读取/);
});

test('MiniMax 阈值差异保存保留其他平台和未来平台原值', () => {
  const saved = copySettings({ account_scheduling_thresholds: { openai: 90, minimax: 75, future: 88 } });
  const draft = copySettings(saved); draft.account_scheduling_thresholds.minimax = 65;
  assert.deepEqual(settingsPatch('admin_defaults', draft, saved), { account_scheduling_thresholds: {openai:90,minimax:65,future:88} });
  assert.equal(saved.account_scheduling_thresholds.minimax, 75);
});

test('阈值拒绝未知平台新增、移除原值以及越界或非整数', () => {
  const saved = copySettings({ account_scheduling_thresholds: { openai: 90, minimax: 75 } });
  for (const value of [0, 101, NaN, 33.3, undefined]) {
    const draft = copySettings(saved); draft.account_scheduling_thresholds.minimax = value;
    assert.throws(() => settingsPatch('admin_defaults', draft, saved), /整数/);
  }
  const old = copySettings({account_scheduling_thresholds:{openai:90}});
  assert.throws(() => settingsPatch('admin_defaults', {...old,account_scheduling_thresholds:{openai:90,minimax:60}}, old), /尚未返回/);
});
