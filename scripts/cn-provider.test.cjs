// node --test scripts/cn-provider.test.cjs — pure fixtures, no network or credentials.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.resolve(__dirname,'../packages/sub2-console/package.json'));
const ts=req('typescript'),sfc=req('vue/compiler-sfc');
const sourcePath=path.resolve(__dirname,'../packages/sub2-console/src/apps/admin/accounts/cn-provider.ts');
const source=fs.readFileSync(sourcePath,'utf8');
function load(code){const exports={};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,fetch(){throw Error('Network forbidden')},require(){throw Error('Import forbidden')}});return exports;}
const h=load(source),plain=v=>JSON.parse(JSON.stringify(v)),copy=h.cloneCNProviderForm;
const expected={
  kimi:{payg:{chat_completions:'https://api.moonshot.cn/v1',anthropic:'https://api.moonshot.cn/anthropic',responses:'https://api.moonshot.cn/v1'},coding:{chat_completions:'https://api.kimi.com/coding/v1',anthropic:'https://api.kimi.com/coding',responses:'https://api.kimi.com/coding/v1'}},
  zhipu:{payg:{chat_completions:'https://open.bigmodel.cn/api/paas/v4',anthropic:'https://open.bigmodel.cn/api/anthropic',responses:''},coding:{chat_completions:'https://open.bigmodel.cn/api/coding/paas/v4',anthropic:'https://open.bigmodel.cn/api/anthropic',responses:''}},
  deepseek:{payg:{chat_completions:'https://api.deepseek.com',anthropic:'https://api.deepseek.com/anthropic',responses:'https://api.deepseek.com'}},
  minimax:{payg:{chat_completions:'https://api.minimaxi.com/v1',anthropic:'https://api.minimaxi.com/anthropic',responses:'https://api.minimaxi.com/v1'},coding:{chat_completions:'https://api.minimaxi.com/v1',anthropic:'https://api.minimaxi.com/anthropic',responses:'https://api.minimaxi.com/v1'}}
};
const account=(platform='kimi',credentials={},status=true)=>({platform,type:'apikey',credentials,credentials_status:{has_api_key:status}});
const edit=a=>{const initial=h.cnProviderForm(a.platform,a);return {initial,form:copy(initial),options:{current:a,initial}};};
const create=p=>({...h.cnProviderForm(p),api_key:'  fixture-new-key  '});
for(const [platform,modes] of Object.entries(expected))for(const [mode,urls] of Object.entries(modes)){
  test(`${platform}/${mode} official adaptive endpoint matrix`,()=>{
    assert.deepEqual(plain(h.defaultCNAdaptiveBaseUrls(platform,mode)),urls);
    const f=h.changeCNAccountMode(create(platform),mode),c=h.buildCNProviderCredentials(platform,f);
    assert.equal(c.account_mode,mode);assert.equal(c.api_protocol,'adaptive');assert.equal(c.base_url,urls.chat_completions);
    assert.deepEqual(plain(c.api_base_urls),Object.fromEntries(Object.entries(urls).filter(([,v])=>v)));
    assert.equal(c.api_key,'fixture-new-key');
  });
  for(const [protocol,url] of Object.entries(urls).filter(([,v])=>v))test(`${platform}/${mode}/${protocol} fixed endpoint contract`,()=>{
    const f=h.changeCNProtocol(h.changeCNAccountMode(create(platform),mode),protocol);
    const c=h.buildCNProviderCredentials(platform,f);
    assert.equal(c.base_url,url);assert.equal(c.api_protocol,protocol);assert(!('api_base_urls' in c));
  });
}
test('MiniMax international presets retain exact official paths in both modes',()=>{
  const presets=h.CN_BASE_URL_PRESETS.minimax.filter(p=>p.label.includes('Intl'));
  assert.equal(presets.length,6);
  for(const p of presets){const f=h.selectCNPreset(create('minimax'),p);const c=h.buildCNProviderCredentials('minimax',f);assert.equal(c.account_mode,p.mode);assert.equal(c.base_url,p.protocol==='anthropic'?'https://api.minimax.io/anthropic':'https://api.minimax.io/v1');}
});
test('endpoint table matches current official checkout when available',t=>{
  const file=path.resolve(__dirname,'../output/upstream-current-20260912/frontend/src/components/account/credentialsBuilder.ts');
  if(!fs.existsSync(file))return t.skip('Optional upstream checkout absent; fixed contract tests still run');
  const upstream=fs.readFileSync(file,'utf8'),start=upstream.indexOf('export type CnAccountMode'),end=upstream.indexOf('// ===== 国产供应商用量单元格',start);
  assert(start>=0&&end>start);const official=load(upstream.slice(start,end));
  assert.deepEqual(plain(h.CN_BASE_URL_PRESETS),plain(official.CN_BASE_URL_PRESETS));
});
test('create uses adaptive while legacy edit uses chat and keeps custom relay',()=>{
  assert.equal(create('kimi').api_protocol,'adaptive');
  const f=edit(account('kimi',{base_url:'https://relay.example.test/custom/v1?zone=cn'}));
  assert.equal(f.form.api_protocol,'chat_completions');assert.equal(f.form.base_url,'https://relay.example.test/custom/v1?zone=cn');
  assert.equal(h.buildCNProviderCredentials('kimi',f.form,f.options),undefined);
});
test('hydration neither exposes old keys nor rewrites unsupported stored metadata',()=>{
  const a=account('zhipu',{api_key:'legacy-key',account_mode:'future_mode',api_protocol:'future_protocol',base_url:'https://relay.test/v2',future:{keep:true}});
  const f=edit(a);assert.equal(f.form.api_key,'');assert.equal(JSON.stringify(f.form).includes('legacy-key'),false);
  assert.equal(h.buildCNProviderCredentials('zhipu',f.form,f.options),undefined);
  f.form.api_key='replacement';const c=h.buildCNProviderCredentials('zhipu',f.form,f.options);
  assert.deepEqual(plain(c),{...a.credentials,api_key:'replacement'});
});
test('adaptive hydration preserves each custom URL and legacy chat fallback',()=>{
  const a=account('minimax',{api_protocol:'adaptive',base_url:'https://relay.test/chat/',api_base_urls:{chat_completions:' ',anthropic:'https://relay.test/messages',responses:'https://relay.test/responses'}});
  const f=edit(a);assert.deepEqual(plain(f.form.api_base_urls),{chat_completions:'https://relay.test/chat/',anthropic:'https://relay.test/messages',responses:'https://relay.test/responses'});
  assert.equal(h.buildCNProviderCredentials('minimax',f.form,f.options),undefined);
});
for(const protocol of ['chat_completions','anthropic','responses'])test(`fixed ${protocol} relay survives adaptive round trip`,()=>{
  const a=account('kimi',{api_protocol:protocol,base_url:'https://relay.test/custom?route=original'}),f=edit(a);
  const adaptive=h.changeCNProtocol(f.form,'adaptive');assert.equal(adaptive.api_base_urls[protocol],a.credentials.base_url);
  const fixed=h.changeCNProtocol(adaptive,protocol);assert.equal(fixed.base_url,a.credentials.base_url);
  const c=h.buildCNProviderCredentials('kimi',adaptive,f.options);assert.equal(c.api_base_urls[protocol],a.credentials.base_url);
});
test('changing adaptive mode updates only default/empty addresses and retains custom relays',()=>{
  const f=create('kimi');f.api_base_urls.anthropic='https://relay.test/messages';f.api_base_urls.responses='';
  const c=h.changeCNAccountMode(f,'coding');assert.equal(c.api_base_urls.chat_completions,expected.kimi.coding.chat_completions);assert.equal(c.api_base_urls.anthropic,f.api_base_urls.anthropic);assert.equal(c.api_base_urls.responses,expected.kimi.coding.responses);
  assert.equal(f.account_mode,'payg');
});
test('explicit fixed mode/protocol selections follow official default reset',()=>{
  const f=h.changeCNProtocol(create('kimi'),'anthropic');f.base_url='https://relay.test/messages';
  assert.equal(h.changeCNAccountMode(f,'coding').base_url,expected.kimi.coding.anthropic);
  assert.equal(h.changeCNProtocol(f,'responses').base_url,expected.kimi.payg.responses);
  assert.equal(h.changeCNProtocol(f,'anthropic').base_url,'https://relay.test/messages');
});
test('single address edit retains unknown credential and adaptive map fields',()=>{
  const a=account('kimi',{api_protocol:'adaptive',api_base_urls:{...expected.kimi.payg,future_protocol:'https://future.test/'},model_mapping:{alias:'model'},pool_mode:true,quota:{keep:9},future:{enabled:true}}),f=edit(a);
  f.form.api_base_urls.anthropic='https://relay.test/messages';
  const c=h.buildCNProviderCredentials('kimi',f.form,f.options);assert.deepEqual(plain(c.model_mapping),a.credentials.model_mapping);assert.equal(c.pool_mode,true);assert.deepEqual(plain(c.quota),{keep:9});assert.deepEqual(plain(c.future),{enabled:true});assert.equal(c.api_base_urls.future_protocol,'https://future.test/');assert.equal(c.api_base_urls.anthropic,'https://relay.test/messages');assert(!('api_key'in c));
});
test('leaving adaptive deletes old map in full credentials replacement',()=>{
  const a=account('minimax',{api_protocol:'adaptive',api_base_urls:expected.minimax.payg,future:'preserve'}),f=edit(a);f.form=h.changeCNProtocol(f.form,'responses');
  const patch=h.buildCNProviderPatch('minimax',f.form,f.options);assert.deepEqual(plain(patch.remove),['api_base_urls']);
  const c=h.buildCNProviderCredentials('minimax',f.form,f.options);assert(!('api_base_urls'in c));assert.equal(c.future,'preserve');
});
test('key replacement never resets untouched routing fields or adds defaults',()=>{
  const a=account('minimax',{base_url:'https://api.minimax.io/v1/',model_mapping:{a:'b'}}),f=edit(a);f.form.api_key=' new-key ';
  const patch=h.buildCNProviderPatch('minimax',f.form,f.options);assert.deepEqual(plain(patch),{set:{api_key:'new-key'},remove:[]});assert.deepEqual(plain(h.buildCNProviderCredentials('minimax',f.form,f.options)),{...a.credentials,api_key:'new-key'});
});
test('latest unrelated credentials survive the initial form snapshot',()=>{
  const a=account('kimi',{base_url:'https://relay.test',model_mapping:{a:'old'}}),f=edit(a);f.form.api_key='new';
  const current={...a,credentials:{...a.credentials,model_mapping:{a:'new'},future:42}};
  assert.deepEqual(plain(h.buildCNProviderCredentials('kimi',f.form,{...f.options,current})),{...current.credentials,api_key:'new'});
});
test('API key status overrides legacy fallback, and blank replacement never erases key',()=>{
  const a=account('kimi',{api_key:'old'},true),f=edit(a);assert.equal(h.buildCNProviderCredentials('kimi',f.form,f.options),undefined);
  const legacy={...a,credentials_status:undefined};assert(h.cnHasExistingApiKey(legacy));assert(!h.cnHasExistingApiKey({...a,credentials_status:{has_api_key:false}}));
  assert.throws(()=>h.buildCNProviderCredentials('kimi',f.form,{...f.options,current:{...a,credentials_status:{has_api_key:false}}}),/API Key/);
});
test('missing key prevents creation and editing an account without stored key',()=>{
  assert.throws(()=>h.buildCNProviderCredentials('kimi',h.cnProviderForm('kimi')),/API Key/);
  const f=edit(account('kimi',{},false));assert.throws(()=>h.buildCNProviderCredentials('kimi',f.form,f.options),/API Key/);
});
test('DeepSeek rejects Coding Plan and Zhipu rejects native Responses',()=>{
  assert.deepEqual(plain(h.cnAccountModes('deepseek')),['payg']);assert(!h.cnProtocols('zhipu').includes('responses'));assert(h.cnProtocols('minimax').includes('responses'));
  assert.throws(()=>h.changeCNAccountMode(create('deepseek'),'coding'));assert.throws(()=>h.changeCNProtocol(create('zhipu'),'responses'));
  assert.throws(()=>h.buildCNProviderCredentials('deepseek',{...create('deepseek'),account_mode:'coding'}));assert.throws(()=>h.buildCNProviderCredentials('zhipu',{...create('zhipu'),api_protocol:'responses'}));
});
test('blank/whitespace addresses default only at build and paths are not guessed',()=>{
  const f=h.changeCNProtocol(create('deepseek'),'responses');f.base_url=' ';assert.equal(h.buildCNProviderCredentials('deepseek',f).base_url,'https://api.deepseek.com');
  const a=create('minimax');a.api_base_urls.responses=' ';assert.equal(h.buildCNProviderCredentials('minimax',a).api_base_urls.responses,'https://api.minimaxi.com/v1');
  f.base_url='  http://localhost:8080/custom/v2/?a=1  ';assert.equal(h.buildCNProviderCredentials('deepseek',f).base_url,'http://localhost:8080/custom/v2/?a=1');
});
for(const url of ['javascript:alert(1)','//relay.test','https://user:pass@relay.test/','https://relay.test/a b','https:\\relay.test','https://relay.test/a\nb'])test('reject malformed new URL '+JSON.stringify(url),()=>{
  const f=h.changeCNProtocol(create('kimi'),'anthropic');f.base_url=url;assert.throws(()=>h.buildCNProviderCredentials('kimi',f),/HTTP/);
});
test('inactive adaptive draft fields do not produce credential updates',()=>{
  const f=edit(account('kimi',{api_protocol:'anthropic',base_url:'https://relay.test/messages'}));f.form.api_base_urls.responses='https://other.test';
  assert.equal(h.buildCNProviderCredentials('kimi',f.form,f.options),undefined);
});
test('Zhipu team creation supports organization and optional project',()=>{
  const f=h.changeCNAccountMode(create('zhipu'),'coding');f.zhipu_organization=' org ';f.zhipu_project=' project ';
  const c=h.buildCNProviderCredentials('zhipu',f);assert.equal(c.zhipu_organization,'org');assert.equal(c.zhipu_project,'project');
  f.zhipu_project='';assert(!('zhipu_project'in h.buildCNProviderCredentials('zhipu',f)));f.zhipu_organization='';assert(!('zhipu_organization'in h.buildCNProviderCredentials('zhipu',f)));
});
test('project without organization is not silently discarded on create',()=>{
  const f=h.changeCNAccountMode(create('zhipu'),'coding');f.zhipu_project='project';assert.throws(()=>h.buildCNProviderCredentials('zhipu',f),/组织/);
});
test('team clear deletes org/project; clearing only project preserves organization',()=>{
  const f=edit(account('zhipu',{account_mode:'coding',zhipu_organization:'org',zhipu_project:'project',future:1}));
  f.form.zhipu_project='';let c=h.buildCNProviderCredentials('zhipu',f.form,f.options);assert.equal(c.zhipu_organization,'org');assert(!('zhipu_project'in c));
  f.form=copy(f.initial);f.form.zhipu_organization='';c=h.buildCNProviderCredentials('zhipu',f.form,f.options);assert(!('zhipu_organization'in c));assert(!('zhipu_project'in c));assert.equal(c.future,1);
});
test('untouched historical team fields survive no-op, key-only and mode changes',()=>{
  const a=account('zhipu',{account_mode:'coding',zhipu_project:'legacy-project-only'}),f=edit(a);
  assert.equal(h.buildCNProviderCredentials('zhipu',f.form,f.options),undefined);f.form.api_key='new';assert.equal(h.buildCNProviderCredentials('zhipu',f.form,f.options).zhipu_project,'legacy-project-only');
  f.form=h.changeCNAccountMode(f.form,'payg');assert.equal(h.buildCNProviderCredentials('zhipu',f.form,f.options).zhipu_project,'legacy-project-only');
});
test('cross-platform, non-apikey and missing-baseline edits are fenced',()=>{
  assert.throws(()=>h.cnProviderForm('openai'));assert.throws(()=>h.cnProviderForm('kimi',account('minimax')));
  assert.throws(()=>h.cnProviderForm('kimi',{...account('kimi'),type:'oauth'}));assert.throws(()=>h.buildCNProviderCredentials('minimax',create('kimi')));
  const f=edit(account('kimi'));assert.throws(()=>h.buildCNProviderCredentials('kimi',f.form,{current:f.options.current}));
  assert.throws(()=>h.buildCNProviderCredentials('kimi',create('kimi'),{initial:f.initial}));
  assert.throws(()=>h.buildCNProviderCredentials('kimi',f.form,{...f.options,initial:create('minimax')}));
  assert.throws(()=>h.selectCNPreset(create('minimax'),h.CN_BASE_URL_PRESETS.kimi[0]));
});
test('helpers do not mutate frozen current credentials, draft or baseline',()=>{
  const a=account('kimi',{api_protocol:'adaptive',api_base_urls:{...expected.kimi.payg},future:{x:1}}),f=edit(a);
  const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x)}return x};freeze(a);freeze(f.initial);freeze(f.form);
  h.changeCNProtocol(f.form,'anthropic');h.changeCNAccountMode(f.form,'coding');h.selectCNPreset(f.form,h.CN_BASE_URL_PRESETS.kimi[0]);
  assert.equal(h.buildCNProviderCredentials('kimi',f.form,f.options),undefined);
});
test('component compiles and exposes controlled model; no API/store or mount watchers',()=>{
  const filename=path.resolve(path.dirname(sourcePath),'CNProviderFields.vue');const code=fs.readFileSync(filename,'utf8');const {descriptor,errors}=sfc.parse(code,{filename});assert.deepEqual(errors,[]);
  const script=sfc.compileScript(descriptor,{id:'cn-fixture',inlineTemplate:true});assert(script.content.includes('update:modelValue'));
  const style=sfc.compileStyle({source:descriptor.styles[0].content,filename,id:'cn-fixture',scoped:true});assert.deepEqual(style.errors,[]);
  assert(!/\b(fetch|watch|onMounted|localStorage|sessionStorage)\s*[.(]/.test(descriptor.scriptSetup.content));assert(!/from ['"]@\/(api|stores)/.test(code));
  assert.match(code,/必填配置/);assert.match(code,/选填设置/);assert.match(code,/type="password"/);assert(!code.includes('PlatformMark'));
});
