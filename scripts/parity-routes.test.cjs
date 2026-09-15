const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const path=require('node:path');
const req=createRequire(path.resolve('packages/sub2-console/package.json'));
const source=fs.readFileSync('packages/sub2-console/src/desktop-routes.ts','utf8');
const exportsObject={};
vm.runInNewContext(req('typescript').transpileModule(source,{compilerOptions:{module:1,target:9}}).outputText,{exports:exportsObject,URL});
const resolve=p=>exportsObject.desktopTarget(new URL(p,'https://console.example'));
test('official deep links select correct app and nested tab',()=>{
  assert.equal(resolve('/admin/usage').app,'admin_usage');
  assert.equal(resolve('/docs/batch-image').app,'batch_image');
  assert.equal(resolve('/admin/affiliates/rebates').data.subtab,'rebates');
  assert.equal(resolve('/purchase').data.tab,'subscription');
  assert.equal(resolve('/orders/').data.tab,'orders');
  assert.equal(resolve('/admin/risk-control').data.tab,'risk');
});
test('login retains local destination and rejects cross-origin redirects',()=>{
  assert.equal(resolve('/login?redirect=%2Fadmin%2Fusage').app,'admin_usage');
  for(const r of ['https://evil.example/admin/usage','//evil.example/admin/usage','/\\evil.example/admin/usage']) assert.equal(resolve('/login?redirect='+encodeURIComponent(r)),undefined);
  assert.equal(resolve('/not-an-official-page'),undefined);
});
