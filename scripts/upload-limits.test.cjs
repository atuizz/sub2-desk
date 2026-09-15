const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const req = require('node:module').createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript');
function load(relative, overrides = {}) {
  const file = path.join(root, 'packages/sub2-console/src', relative);
  const out = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out)(spec => overrides[spec] || (spec === 'vue' ? req('vue') : spec.startsWith('.') ? load(path.relative(path.join(root, 'packages/sub2-console/src'), path.resolve(path.dirname(file), spec + '.ts'))) : {}), mod, mod.exports);
  return mod.exports;
}
const helper = load('desktop-file-drop.ts');
const batch = load('apps/user/batch-image/useBatchImages.ts');
test('wire bytes include UTF-8, escaping and numeric serialization expansion', () => {
  const payload = { text: '中文🙂\n"', n: 1e20 };
  assert.equal(helper.validateJsonRequestBody(payload), Buffer.byteLength(JSON.stringify(payload)));
  assert.ok(JSON.stringify(JSON.parse('{"n":1e20}')).length > '{"n":1e20}'.length);
});
test('account file budgets retain 20/50 MiB without confusing file and wire size', () => {
  const file = size => ({ name: 'test.json', size });
  assert.equal(helper.validateDesktopFiles([file(20 * 1048576), file(20 * 1048576), file(10 * 1048576)]), '');
  assert.match(helper.validateDesktopFiles([file(20 * 1048576 + 1)]), /20/);
  assert.match(helper.validateDesktopFiles([file(20 * 1048576), file(20 * 1048576), file(10 * 1048576 + 1)]), /50/);
});
test('account import checks final wrapper before ready and never submits oversized payload', async () => {
  let checked, writes = 0, state;
  const api = load('apps/admin/accounts/importData.ts', { '../../../desktop-file-drop': { ...helper, validateJsonRequestBody(payload) { checked = payload; throw Error('请求内容超过256 MiB'); } } });
  const controller = api.createAccountImport(async () => { writes++; }, next => { state = next; });
  const text = JSON.stringify({ accounts: [{ name: 'fixture', platform: 'openai', type: 'apikey', credentials: {}, concurrency: 1, priority: 1 }], proxies: [] });
  await controller.select([{ name: 'fixture.json', size: Buffer.byteLength(text), text: async () => text }]);
  assert.equal(checked.skip_default_group_bind, false);
  assert.equal(checked.data.accounts.length, 1);
  assert.equal(state.phase, 'invalid');
  await controller.confirm(false); assert.equal(writes, 0);
});
test('actual JSON serialization accepts exactly 256 MiB and rejects +1 byte', () => {
  const payload = { content: '' }, overhead = Buffer.byteLength(JSON.stringify(payload));
  payload.content = 'x'.repeat(helper.MAX_REQUEST_BODY_BYTES - overhead);
  assert.equal(helper.validateJsonRequestBody(payload), 268435456);
  payload.content += 'x';
  assert.throws(() => helper.validateJsonRequestBody(payload), /256 MiB/);
});
test('batch final JSON budget includes unbounded metadata, not only decoded image bytes', () => {
  const payload = { model: 'gemini-3-image', items: [{ custom_id: 'one', prompt: '中文' }], metadata: { note: '' } };
  const overhead = Buffer.byteLength(JSON.stringify(payload));
  payload.metadata.note = 'x'.repeat(268435456 - overhead);
  assert.equal(batch.validatePayload(payload), 1);
  payload.metadata.note += 'x';
  assert.throws(() => batch.validatePayload(payload), /256 MiB/);
});
test('base64 expansion formula includes per-image padding and JSON wrapper', () => {
  const decoded = Buffer.alloc(128 * 1048576);
  const data = decoded.toString('base64');
  assert.equal(data.length, 4 * Math.ceil(decoded.length / 3));
  const payload = { data, mime_type: 'image/png', prompt: '中文' };
  const wire = helper.validateJsonRequestBody(payload);
  assert.ok(wire > data.length && wire < helper.MAX_REQUEST_BODY_BYTES);
});
test('nginx and both browser guards agree on exact byte constant', () => {
  const template = fs.readFileSync(path.join(root, 'deploy/nginx.conf.template'), 'utf8');
  assert.match(template, /client_max_body_size 268435456;/);
  assert.equal(helper.MAX_REQUEST_BODY_BYTES, 268435456);
});
