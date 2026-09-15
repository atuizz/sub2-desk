const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare, assessVerification, snapshot, buildSnapshotPlugin } = require('./release-snapshot.cjs');
const path = require('node:path');
const a = { path: 'packages/sub2-console/src/App.vue', sha256: 'a'.repeat(64) };
const b = { path: 'packages/sub2-console/src/added.ts', sha256: 'b'.repeat(64) };
test('acceptance requires a complete matching snapshot, including newly added files', () => {
  assert.equal(assessVerification({ coreBackendAccepted:true, sourceFiles:[a] }, [a]).coreBackendAccepted, true);
  for (const current of [[a,b], [], [{...a,sha256:'c'.repeat(64)}]]) {
    assert.equal(assessVerification({ coreBackendAccepted:true, sourceFiles:[a] }, current).coreBackendAccepted, false);
  }
  assert.equal(assessVerification(null,[a]).coreBackendAccepted,false);
  assert.equal(assessVerification({sourceFiles:[a]},[a]).coreBackendAccepted,false);
});
test('portable paths match but corrupt or duplicate records do not', () => {
  assert.equal(compare([{...a,path:a.path.replaceAll('/','\\')}],[a]).matched,true);
  for (const expected of [[],[a,a],[{...a,sha256:'bad'}]]) assert.equal(compare(expected,[a]).matched,false);
});
test('build captures source and matching asset profile without secret files', () => {
  const root=path.resolve(__dirname,'..');
  const files=snapshot(root,'original-release-assets');
  assert(files.some(x=>x.path.endsWith('MacMenubarGlass.vue')));
  assert(files.some(x=>x.path==='packages/sub2-console/index.html'));
  assert(files.some(x=>x.path.startsWith('packages/sub2-console/public-release/')));
  assert(!files.some(x=>/(^|\/)\.env(?:$|\.(?!example$))/.test(x.path) || x.path.startsWith('packages/sub2-console/public/')));
  const emitted=[];
  const plugin=buildSnapshotPlugin(root,'original-release-assets');
  plugin.buildStart();
  plugin.generateBundle.call({emitFile:f=>emitted.push(f),error:m=>{throw Error(m)}});
  assert.equal(emitted[0].fileName,'build-snapshot.json');
  assert.equal(compare(JSON.parse(emitted[0].source).sourceFiles,files).matched,true);
});
