// node --test scripts/desktop-accounts.test.cjs
// Actual import controller + actual Vue setup, entirely offline.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),src=path.join(root,'packages/sub2-console/src');
const req=require('node:module').createRequire(path.join(root,'packages/sub2-console/package.json'));
const ts=req('typescript'),vue=req('vue'),sfc=req('vue/compiler-sfc');
const sha=text=>Promise.resolve(require('node:crypto').createHash('sha256').update(text).digest('hex'));
const plain=v=>JSON.parse(JSON.stringify(v));
function moduleAt(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,TextEncoder,Uint8Array,crypto:require('node:crypto').webcrypto,Date,Set,Error,require:spec=>moduleAt(path.resolve(path.dirname(file),spec+'.ts'))});return exports;}
const api=moduleAt(path.join(src,'apps/admin/accounts/importData.ts'));
const account=(name='fixture')=>({name,platform:'openai',type:'apikey',credentials:{api_key:'NEVER_DISPLAY_SECRET'},concurrency:5,priority:1});
const data=(name='fixture')=>({type:'sub2api-data',version:1,exported_at:'2026-09-12T00:00:00Z',accounts:[account(name)],proxies:[]});
const file=(value=data(),name='fixture.json')=>{const text=typeof value==='string'?value:JSON.stringify(value);return{name,size:Buffer.byteLength(text),text:async()=>text};};
const result=(overrides={})=>({account_created:1,account_failed:0,proxy_created:0,proxy_reused:0,proxy_failed:0,...overrides});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject};};
function fixture(send=async()=>result()){let state;const calls=[];const controller=api.createAccountImport(async p=>{calls.push(p);return send(p);},s=>state=s,sha);return{controller,calls,get state(){return state;}};}
test('official export roundtrip keeps credentials only in request; preview contains aggregate allowlist',async()=>{
 const f=fixture();const payload=data();payload.accounts[0].extra={future:{keep:1}};await f.controller.select([file(payload)]);
 assert.equal(f.state.phase,'ready');assert.equal(f.calls.length,0);assert.equal(JSON.stringify(f.state).includes('NEVER_DISPLAY_SECRET'),false);
 assert.deepEqual(plain(f.state.summary.platforms),{openai:1});await f.controller.confirm(true);
 assert.deepEqual(plain(f.calls[0]),{data:payload,skip_default_group_bind:true});assert.equal(f.state.phase,'complete');
});
test('legacy optional header, bundle type and UTF8 BOM are supported',()=>{
 for(const head of [{type:undefined,version:undefined},{type:'',version:0},{type:'sub2api-bundle',version:1}])assert.equal(api.parseAccountExport('\uFEFF'+JSON.stringify({...data(),...head})).accounts.length,1);
});
for(const [name,value] of [['array',[]],['missing arrays',{}],['unknown type',{...data(),type:'not-export'}],['future version',{...data(),version:2}],['missing credentials',{...data(),accounts:[{...account(),credentials:null}]}],['empty',{...data(),accounts:[]}],['invalid JSON','{"secret":"NEVER_DISPLAY_SECRET",']])test('reject '+name+' before any write without leaking content',async()=>{
 const f=fixture();await f.controller.select([file(value)]);assert.equal(f.state.phase,'invalid');assert.equal(JSON.stringify(f.state).includes('NEVER_DISPLAY_SECRET'),false);await f.controller.confirm(true);assert.equal(f.calls.length,0);
});
test('directory/non-json/empty/oversize/too-many fail before file read using desktop limits',async()=>{
 const tooLarge={name:'a.json',size:21*1024*1024,text:async()=>{throw Error('must not read')}};
 for(const [files,directory] of [[[file()],true],[[file(data(),'a.txt')],false],[[{...file(),size:0}],false],[[tooLarge],false],[Array.from({length:11},()=>file()),false],[[{...file(),size:18*1024*1024},{...file(),size:18*1024*1024},{...file(),size:18*1024*1024}],false]]){
  const f=fixture();await f.controller.select(files,directory);assert.equal(f.state.phase,'invalid');assert.equal(f.calls.length,0);
 }
});
test('multiple files merge once; duplicate file never creates duplicate account writes',async()=>{
 const f=fixture(async()=>result({account_created:2}));await f.controller.select([file(data('A'),'a.json'),file(data('B'),'b.json')]);assert.equal(f.state.summary.accounts,2);await f.controller.confirm(false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].data.accounts.length,2);
 const g=fixture();await g.controller.select([file(),file(data(),'renamed.json')]);assert.equal(g.state.phase,'invalid');assert.match(g.state.message,/重复/);
});
test('bad second file invalidates whole batch, never retains previous valid preview',async()=>{
 const f=fixture();await f.controller.select([file()]);await f.controller.select([file(),file('bad','second.json')]);assert.equal(f.state.phase,'invalid');assert.equal(f.state.summary,null);await f.controller.confirm(true);assert.equal(f.calls.length,0);
});
test('proxy reference collision rejects merge instead of assigning accounts to wrong proxy',async()=>{
 const proxy={proxy_key:'p',host:'example.invalid',port:80,protocol:'http',name:'proxy',status:'active',password:'NEVER_DISPLAY_SECRET'};
 const f=fixture();await f.controller.select([file({...data('A'),proxies:[proxy]}),file({...data('B'),proxies:[proxy]},'b.json')]);assert.equal(f.state.phase,'invalid');assert.equal(f.calls.length,0);
});
test('cancel and replacement discard late file reads without resurrecting preview',async()=>{
 const f=fixture(),wait=deferred();const old=f.controller.select([{...file(),text:()=>wait.promise}]);f.controller.cancel();await f.controller.select([file(data('new'))]);wait.resolve(JSON.stringify(data('old')));await old;await f.controller.confirm(true);assert.equal(f.calls[0].data.accounts[0].name,'new');
 const g=fixture(),late=deferred();const pending=g.controller.select([{...file(),text:()=>late.promise}]);g.controller.cancel();late.resolve(JSON.stringify(data()));await pending;assert.equal(g.state.phase,'idle');await g.controller.confirm(true);assert.equal(g.calls.length,0);
});
test('double confirm and input during write cannot dispatch a second request or dismiss',async()=>{
 const wait=deferred(),f=fixture(()=>wait.promise);await f.controller.select([file()]);const pending=f.controller.confirm(true);await f.controller.confirm(true);await f.controller.select([file(data('new'))]);assert.equal(f.controller.cancel(),false);assert.equal(f.calls.length,1);wait.resolve(result());await pending;assert.equal(f.state.phase,'complete');
});
test('partial failure preserves real counts, hides error bodies and disables whole-file retry',async()=>{
 const f=fixture(async()=>result({account_created:1,account_failed:1,errors:[{kind:'account',message:'NEVER_DISPLAY_SECRET'}]}));await f.controller.select([file({...data(),accounts:[account('A'),account('B')]})]);await f.controller.confirm(true);assert.equal(f.state.phase,'partial');assert.equal(f.state.result.account_failed,1);assert.equal(JSON.stringify(f.state).includes('NEVER_DISPLAY_SECRET'),false);await f.controller.confirm(true);assert.equal(f.calls.length,1);
});
test('zero success is failed, malformed counts are unknown rather than fake success',async()=>{
 for(const [response,phase] of [[result({account_created:0,account_failed:1}),'failed'],[{},'unknown'],[result({account_created:9}),'unknown'],[result({account_created:'1'}),'unknown']]){
  const f=fixture(async()=>response);await f.controller.select([file()]);await f.controller.confirm(true);assert.equal(f.state.phase,phase);await f.controller.confirm(true);assert.equal(f.calls.length,1);
 }
});
test('network failure has unknown outcome; identical renamed file cannot replay after close',async()=>{
 const f=fixture(async()=>{throw Error('NEVER_DISPLAY_SECRET')});await f.controller.select([file()]);await f.controller.confirm(true);assert.equal(f.state.phase,'unknown');assert.equal(f.state.message.includes('NEVER_DISPLAY_SECRET'),false);f.controller.cancel();await f.controller.select([file(data(),'renamed.json')]);assert.equal(f.state.phase,'invalid');assert.match(f.state.message,/已经提交/);await f.controller.confirm(true);assert.equal(f.calls.length,1);
});
test('dispose during parse never writes, and after submitted request never publishes late result',async()=>{
 const wait=deferred(),f=fixture();const pending=f.controller.select([{...file(),text:()=>wait.promise}]);f.controller.dispose();wait.resolve(JSON.stringify(data()));await pending;await f.controller.confirm(true);assert.equal(f.calls.length,0);
 const response=deferred(),g=fixture(()=>response.promise);await g.controller.select([file()]);const write=g.controller.confirm(true);g.controller.dispose();response.resolve(result());await write;assert.equal(g.state.phase,'submitting');assert.equal(g.calls.length,1);
});
test('new platform and credential kind cannot leak arbitrary input into preview',async()=>{
 const f=fixture();await f.controller.select([file({...data(),accounts:[{...account(),platform:'NEVER_DISPLAY_SECRET',type:'NEVER_DISPLAY_SECRET'}]})]);assert.equal(f.state.phase,'ready');assert.deepEqual(plain(f.state.summary.platforms),{other:1});assert.equal(JSON.stringify(f.state).includes('NEVER_DISPLAY_SECRET'),false);
});
test('new Vue surfaces compile and PlatformMark contains distinct upstream filled marks',()=>{
 for(const file of ['AccountsApp.vue','accounts/PlatformMark.vue','accounts/AccountImportSheet.vue']){
  const filename=path.join(src,'apps/admin',file),parsed=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(parsed.errors,[]);const script=sfc.compileScript(parsed.descriptor,{id:file});assert.deepEqual(sfc.compileTemplate({source:parsed.descriptor.template.content,filename,id:file,compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
 }
});
test('platform dark-mode selectors remain component scoped, never style the global theme root',()=>{
 const filename=path.join(src,'apps/admin/accounts/PlatformMark.vue');const d=sfc.parse(fs.readFileSync(filename,'utf8')).descriptor;
 const css=sfc.compileStyle({source:d.styles[0].content,filename,id:'data-v-fixture',scoped:true}).code;
 assert.equal(/\.dark\s*\{/.test(css),false);assert.match(css,/\.dark \.platform-mark\[data-platform="openai"\]\[data-v-fixture\]/);
});
