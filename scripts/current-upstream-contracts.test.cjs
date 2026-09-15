const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const ts = require(require.resolve('typescript', { paths: [path.join(root, 'packages/sub2-console')] }));

// Exercise the real API adapters with an in-memory transport. No backend calls.
function adapter(name, apiClient = {}) {
  const filename = path.join(root, 'packages/sub2-console/src/api/admin', name + '.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(specifier => {
    assert.equal(specifier, '../client');
    return { apiClient };
  }, exports);
  return exports;
}

test('settings normalization preserves a configured MiniMax threshold', () => {
  const api = adapter('settings');
  const source = { openai: 90, anthropic: 85, grok: 80, kimi: 75, zhipu: 70, minimax: 65 };
  assert.deepEqual(api.normalizeAccountSchedulingThresholdsMap(source), source);
  assert.deepEqual(api.sanitizeAccountSchedulingThresholdsMap(source), source);
  assert.equal(api.normalizeAccountSchedulingThresholdsMap({ minimax: 65.9 }).minimax, 65);
  assert.equal(api.normalizeAccountSchedulingThresholdsMap({ minimax: 101 }).minimax, 100);
  assert.equal(api.normalizeAccountSchedulingThresholdsMap({ minimax: 0 }).minimax, 1);
  assert.equal(api.normalizeAccountSchedulingThresholdsMap().minimax, 100);
});

test('partial settings updates preserve the caller payload, including new fields', async () => {
  const payload = { channel_monitor_hide_user_ranking: true, account_scheduling_thresholds: { minimax: 65 } };
  const calls = [];
  const api = adapter('settings', { put: async (...args) => { calls.push(args); return { data: payload }; } });
  assert.deepEqual(await api.updateSettings(payload), payload);
  assert.deepEqual(calls, [['/admin/settings', payload]]);
});

test('group create-flow candidates use the official endpoint with id zero and platform', async () => {
  const calls = [];
  const api = adapter('groups', { get: async (...args) => { calls.push(args); return { data: { models: ['gpt-5.4'] } }; } });
  assert.deepEqual(await api.getModelAllowlistCandidates(0, 'openai'), ['gpt-5.4']);
  assert.deepEqual(calls, [['/admin/groups/0/model-allowlist-candidates', { params: { platform: 'openai' } }]]);
});

test('existing candidate API name resolves the same official endpoint', async () => {
  const calls = [];
  const api = adapter('groups', { get: async (...args) => { calls.push(args); return { data: { models: [] } }; } });
  assert.deepEqual(await api.getModelsListCandidates(17), []);
  assert.deepEqual(calls, [['/admin/groups/17/model-allowlist-candidates', { params: undefined }]]);
  assert.equal(api.groupsAPI.getModelAllowlistCandidates, api.getModelsListCandidates);
});

test('candidate lookup propagates unsupported or forbidden responses without retrying another route', async () => {
  const failure = new Error('unsupported capability');
  let requests = 0;
  const api = adapter('groups', { get: async () => { requests++; throw failure; } });
  await assert.rejects(api.getModelAllowlistCandidates(17), error => error === failure);
  assert.equal(requests, 1);
});

test('update adapter preserves an already-current result without inventing a restart', async () => {
  const result = { message: 'Already up to date', already_up_to_date: true, current_version: '0.2.4', latest_version: '0.2.4', operation_id: 'fixture-only' };
  const calls = [];
  const api = adapter('system', { post: async (...args) => { calls.push(args); return { data: result }; } });
  const actual = await api.performUpdate();
  assert.deepEqual(actual, result);
  assert.equal(actual.need_restart, undefined);
  assert.deepEqual(calls, [['/admin/system/update', undefined, { timeout: 900000 }]]);
});
