const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const resolve = name => require.resolve(name, { paths: [path.join(root, 'packages/sub2-console')] });
const ts = require(resolve('typescript'));
const vue = require(resolve('vue'));
const sfc = require(resolve('vue/compiler-sfc'));
const filename = path.join(root, 'packages/sub2-console/src/apps/user/settings/SoftwareUpdatePanel.vue');
const { descriptor, errors } = sfc.parse(fs.readFileSync(filename, 'utf8'), { filename });
assert.deepEqual(errors, []);
const compiled = ts.transpileModule(descriptor.scriptSetup.content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
function panel(api = {}) {
  let unmount;
  let mutations = 0;
  const defaults = {
    getVersion: async () => ({ version: '0.2.1' }),
    checkUpdates: async () => ({ current_version: '0.2.1', latest_version: '0.2.4', has_update: true, cached: false, build_type: 'release' }),
    performUpdate: async () => { mutations++; return { message: 'done', need_restart: true }; },
    ...api
  };
  const result = new Function('require', 'exports', 'window', compiled + '\nreturn { check, info, currentVersion, versionError, statusText, canInstall, confirmation, confirmOperation, pendingRestart };')(
    name => name === 'vue' ? { ...vue, onMounted() {}, onUnmounted(fn) { unmount = fn; } }
      : name === '@/api/admin/system' ? defaults
        : name.endsWith('package.json') ? { version: '1.0.0' } : {}, {}, { removeEventListener() {} }
  );
  return { ...result, unmount: () => unmount(), mutations: () => mutations };
}
test('SFC template compiles with the existing shared components', () => {
  const result = sfc.compileTemplate({ source: descriptor.template.content, filename, id: 'm04' });
  assert.deepEqual(result.errors, []);
});
test('installed version remains available when update source fails', async () => {
  const p = panel({ checkUpdates: async () => { throw new Error('upstream timeout'); } });
  await p.check();
  assert.equal(p.currentVersion.value, '0.2.1');
  assert.equal(p.statusText.value, '未能确认最新版本');
  assert.equal(p.canInstall.value, false);
});
test('warning response cannot enable installation or claim latest', async () => {
  const p = panel({ checkUpdates: async () => ({ current_version: '0.2.1', latest_version: '0.2.4', has_update: true, build_type: 'release', warning: 'GitHub unavailable' }) });
  await p.check(); p.confirmation.value = 'update'; await p.confirmOperation();
  assert.equal(p.canInstall.value, false); assert.equal(p.mutations(), 0);
  assert.equal(p.statusText.value, '未能确认最新版本');
});
for (const build_type of ['source', '', undefined]) test(`${build_type || 'unknown'} build cannot install release binary`, async () => {
  const p = panel({ checkUpdates: async () => ({ latest_version: '0.2.4', has_update: true, build_type }) });
  await p.check(); p.confirmation.value = 'update'; await p.confirmOperation();
  assert.equal(p.canInstall.value, false); assert.equal(p.mutations(), 0);
});
test('release response enables confirmed install and waits for restart', async () => {
  const p = panel(); await p.check(); assert.equal(p.canInstall.value, true);
  p.confirmation.value = 'update'; await p.confirmOperation();
  assert.equal(p.mutations(), 1); assert.equal(p.pendingRestart.value, true); assert.equal(p.canInstall.value, false);
});
test('cached no-update response is explicitly historical', async () => {
  const p = panel({ checkUpdates: async () => ({ latest_version: '0.2.1', has_update: false, cached: true, build_type: 'release' }) });
  await p.check(); assert.match(p.statusText.value, /缓存记录/); assert.doesNotMatch(p.statusText.value, /当前已是最新/);
});
test('malformed latest version is unknown rather than latest', async () => {
  const p = panel({ checkUpdates: async () => ({ has_update: false, latest_version: '' }) });
  await p.check(); assert.equal(p.statusText.value, '未能确认最新版本');
});
test('late installed-version result after unmount is ignored', async () => {
  let complete;
  const p = panel({ getVersion: () => new Promise(resolve => { complete = resolve; }) });
  await p.check(); p.unmount(); complete({ version: 'stale' }); await Promise.resolve();
  assert.equal(p.currentVersion.value, '0.2.1');
});
test('version read error is separate from successful update check', async () => {
  const p = panel({ getVersion: async () => { throw new Error('version forbidden'); } });
  await p.check(); assert.equal(p.versionError.value, 'version forbidden'); assert.match(p.statusText.value, /发现新版本/);
});
