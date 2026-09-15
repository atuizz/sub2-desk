const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve('packages/sub2-console/package.json'));
const ts=req('typescript'),vue=req('vue'),compiler=req('vue/compiler-sfc');
const filename='packages/sub2-console/src/setup/SetupWizard.vue';
function fixture(overrides={}) {
  let source=compiler.parse(fs.readFileSync(filename,'utf8')).descriptor.scriptSetup.content;
  const ast=ts.createSourceFile('setup.ts',source,99,true);
  const names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
  for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))source=source.slice(0,n.pos)+source.slice(n.end);
  let cleanup;const calls=[];
  const context={...vue,AbortController,Error,console,setTimeout:()=>1,clearTimeout(){},onMounted(){},onUnmounted:f=>cleanup=f,getSetupStatus:async()=>({needs_setup:true}),testDatabase:async()=>calls.push('db'),testRedis:async()=>calls.push('redis'),install:async p=>{calls.push(JSON.parse(JSON.stringify(p)));return {restart:true};},...overrides};
  vm.runInNewContext(ts.transpileModule(source+'\nglobalThis.subject={'+names.join(',')+'}',{compilerOptions:{target:9,module:0}}).outputText,context);
  return {s:context.subject,calls,dispose:()=>cleanup()};
}
test('setup Vue script and template compile',()=>{
  const {descriptor}=compiler.parse(fs.readFileSync(filename,'utf8'));
  assert.doesNotThrow(()=>compiler.compileScript(descriptor,{id:'setup',inlineTemplate:true}));
});
test('installed or unreadable service cannot test connections or submit install',async()=>{
  for(const getSetupStatus of [async()=>({needs_setup:false}),async()=>{throw Error('offline');}]){
    const f=fixture({getSetupStatus});await f.s.checkStatus();await f.s.test('database');await f.s.submit();assert.equal(f.calls.length,0);assert.notEqual(f.s.status.value,'needed');f.dispose();
  }
});
test('changing connection parameters invalidates test, including late response',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r);const f=fixture({testDatabase:()=>pending});await f.s.checkStatus();
  const request=f.s.test('database');f.s.form.database.host='changed';resolve();await request;assert.equal(f.s.dbReady.value,false);
  f.s.dbTest.value=JSON.stringify(f.s.form.database);assert.equal(f.s.dbReady.value,true);f.s.form.database.port=999;assert.equal(f.s.dbReady.value,false);f.dispose();
});
test('valid install is single-shot, uses backend port and clears passwords',async()=>{
  const f=fixture();await f.s.checkStatus();await f.s.test('database');await f.s.test('redis');
  f.s.form.admin.email='test@example.invalid';f.s.form.admin.password='fixture-password';f.s.confirmPassword.value='fixture-password';
  await f.s.submit();await f.s.submit();
  assert.equal(f.calls.filter(x=>typeof x==='object').length,1);assert.equal(f.calls[2].server.port,8000);assert.equal(f.s.form.admin.password,'');assert.equal(f.s.submitted.value,true);assert.equal(f.s.accepted.value,true);f.dispose();
});
test('uncertain install response cannot be retried as a second installation',async()=>{
  let writes=0;const f=fixture({install:async()=>{writes++;throw Error('connection reset');}});await f.s.checkStatus();await f.s.test('database');await f.s.test('redis');
  f.s.form.admin.email='test@example.invalid';f.s.form.admin.password='fixture-password';f.s.confirmPassword.value='fixture-password';await f.s.submit();await f.s.submit();assert.equal(writes,1);assert.equal(f.s.accepted.value,false);assert.equal(f.s.submitted.value,true);f.dispose();
});
test('status must be confirmed again immediately before installation',async()=>{
  let reads=0;const f=fixture({getSetupStatus:async()=>({needs_setup:++reads===1})});await f.s.checkStatus();await f.s.test('database');await f.s.test('redis');f.s.form.admin.email='test@example.invalid';f.s.form.admin.password='fixture-password';f.s.confirmPassword.value='fixture-password';await f.s.submit();assert.equal(f.s.status.value,'installed');assert.equal(f.calls.length,2);f.dispose();
});
test('setup API has dedicated paths, validates envelopes and omits credentials',async()=>{
  let source=fs.readFileSync('packages/sub2-console/src/api/setup.ts','utf8').replace(/^import .*;\r?\n/m,'');const exports={};const calls=[];
  const context={exports,AbortController,setTimeout,clearTimeout,buildGatewayUrl:p=>'https://setup.invalid'+p,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({code:0,data:{needs_setup:false,restart:true}})};}};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:9,module:1}}).outputText,context);
  await exports.getSetupStatus();await exports.testRedis({db:0,enable_tls:false});await exports.install({admin:{email:'fixture'}});
  assert.deepEqual(calls.map(x=>x.url),['https://setup.invalid/setup/status','https://setup.invalid/setup/test-redis','https://setup.invalid/setup/install']);assert.equal(calls[1].options.credentials,'omit');assert.equal(JSON.parse(calls[1].options.body).enable_tls,false);
  context.fetch=async()=>({ok:true,json:async()=>({data:{}})});await assert.rejects(exports.getSetupStatus());
});
