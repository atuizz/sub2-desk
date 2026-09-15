const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const pkg = path.join(root, 'packages/sub2-console');
const resolve = name => require.resolve(name, { paths: [pkg] });
const ts = require(resolve('typescript')), vue = require(resolve('vue')), sfc = require(resolve('vue/compiler-sfc'));
const dir = path.join(pkg, 'src/apps/user/settings');
function evaluate(source, requireFn) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports','require',compiled)(exports, requireFn);
  return exports;
}
const rules = evaluate(fs.readFileSync(path.join(dir,'policyRules.ts'),'utf8'), () => { throw Error('No network'); });
function panel(kind, api) {
  const filename=path.join(dir,'PolicyRulesPanel.vue');
  const {descriptor}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});
  const script=sfc.compileScript(descriptor,{id:'policies'});
  const unmounted=[];
  const component=evaluate(script.content,name=>{
    if(name==='vue')return {...vue,onMounted(){},onUnmounted(fn){unmounted.push(fn);}};
    if(name==='./policyRules')return rules;
    if(name.endsWith('/api/admin/settings'))return {settingsAPI:api};
    if(name==='@sub2-mac/core')return {};
    throw Error('Unmocked dependency: '+name);
  }).default;
  return {s:component.setup({kind},{expose(){},emit(){}}),close(){unmounted.forEach(fn=>fn());}};
}
const plain = value=>JSON.parse(JSON.stringify(value));
const beta = () => ({rules:[{beta_token:'context-1m-2025-08-07',action:'pass',scope:'all',model_whitelist:['claude-*'],fallback_action:'filter',future:{keep:true}}]});
const fast = () => ({rules:[{service_tier:'ultrafast',action:'filter',scope:'oauth',user_ids:[7],future:{keep:true}}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('请求策略模板及六种阈值与类型接线可编译',()=>{
  for(const filename of [path.join(dir,'PolicyRulesPanel.vue'),path.join(dir,'../SettingsApp.vue')]){
    const {descriptor,errors}=sfc.parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(errors,[]);
    const script=sfc.compileScript(descriptor,{id:filename});
    assert.deepEqual(sfc.compileTemplate({source:descriptor.template.content,filename,id:filename,compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
  }
});

test('Beta 单独保存保留未知字段和未编辑模型范围',async()=>{
  const calls=[];const {s}=panel('beta',{getBetaPolicySettings:async()=>beta(),updateBetaPolicySettings:async p=>{calls.push(plain(p));return p;}});
  await s.load();await s.save();assert.equal(calls.length,0);
  s.rows.value[0].rule.action='block';s.rows.value[0].rule.error_message='Beta unavailable';await s.save();
  assert.deepEqual(calls[0].rules[0].future,{keep:true});assert.deepEqual(calls[0].rules[0].model_whitelist,['claude-*']);assert.equal(calls[0].rules[0].action,'block');assert.equal(s.dirty.value,false);
});

test('Fast 使用主设置独立字段，ultrafast/用户范围/回退规则不丢失',async()=>{
  const calls=[];const {s}=panel('fast',{getSettings:async()=>({site_name:'Unchanged',openai_fast_policy_settings:fast()}),updateSettings:async p=>{calls.push(plain(p));return p;}});
  await s.load();s.rows.value[0].rule.action='force_priority';s.updateList(s.rows.value[0],'user_ids','7, 19');s.updateList(s.rows.value[0],'model_whitelist','gpt-*\ngpt-5.4');s.rows.value[0].rule.fallback_action='block';await s.save();
  assert.deepEqual(Object.keys(calls[0]),['openai_fast_policy_settings']);const rule=calls[0].openai_fast_policy_settings.rules[0];
  assert.equal(rule.service_tier,'ultrafast');assert.equal(rule.action,'force_priority');assert.deepEqual(rule.user_ids,[7,19]);assert.deepEqual(rule.model_whitelist,['gpt-*','gpt-5.4']);assert.deepEqual(rule.future,{keep:true});assert.equal(rule.fallback_action,'block');
});

test('新 Beta 规则先校验，移除与清空均等待显式保存',async()=>{
  const calls=[];const {s}=panel('beta',{getBetaPolicySettings:async()=>beta(),updateBetaPolicySettings:async p=>{calls.push(plain(p));return p;}});
  await s.load();s.add();await s.save();assert.equal(calls.length,0);assert.match(s.error.value,/Beta/);
  s.rows.value[1].rule.beta_token='new-beta';await s.save();assert.equal(calls[0].rules.length,2);
  s.rows.value.slice().forEach(row=>s.remove(row.id));assert.equal(calls.length,1);await s.save();assert.deepEqual(calls[1],{rules:[]});
});

test('删除相邻规则仍完整保留未来版本的未知规则',()=>{
  const known=beta().rules[0], future={beta_token:'future',action:'future-action',scope:'future-scope',future_value:[1,2]};
  const baseline={future_version:2,rules:[known,future]};
  assert.deepEqual(rules.policyPayload(baseline,[{id:2,rule:future,original:JSON.stringify(future)}],'beta'),{future_version:2,rules:[future]});
});

for(const ids of ['a','1.5','-1','7,7'])test(`Fast 用户范围 ${ids} 无效时零写入`,async()=>{
  let writes=0;const {s}=panel('fast',{getSettings:async()=>({openai_fast_policy_settings:fast()}),updateSettings:async()=>writes++});
  await s.load();s.updateList(s.rows.value[0],'user_ids',ids);await s.save();assert.equal(writes,0);assert.match(s.error.value,/正整数/);
});

for(const kind of ['beta','fast'])test(`${kind} 读取失败禁写，重试成功后恢复`,async()=>{
  let writes=0,fail=true;const api={getBetaPolicySettings:async()=>{if(fail)throw Error('read failed');return beta();},getSettings:async()=>{if(fail)throw Error('read failed');return {openai_fast_policy_settings:fast()};},updateSettings:async()=>writes++,updateBetaPolicySettings:async()=>writes++};
  const {s}=panel(kind,api);await s.load();s.add();await s.save();assert.equal(s.rows.value.length,0);assert.equal(writes,0);assert.equal(s.ready.value,false);
  fail=false;await s.load();assert.equal(s.ready.value,true);
});

test('旧后端未返回 Fast 能力时不生成空配置覆盖',async()=>{
  let writes=0;const {s}=panel('fast',{getSettings:async()=>({site_name:'old'}),updateSettings:async()=>writes++});
  await s.load();s.add();await s.save();assert.equal(writes,0);assert.equal(s.ready.value,false);assert.match(s.error.value,/完整规则/);
});

test('保存失败保留草稿，重复点击只发一次请求',async()=>{
  let writes=0;const pending=deferred();const {s}=panel('beta',{getBetaPolicySettings:async()=>beta(),updateBetaPolicySettings:async()=>{writes++;await pending.promise;throw Error('save failed');}});
  await s.load();s.rows.value[0].rule.action='block';const run=s.save();await s.save();assert.equal(writes,1);pending.resolve();await run;
  assert.equal(s.rows.value[0].rule.action,'block');assert.equal(s.dirty.value,true);assert.equal(s.notice.value,'');assert.match(s.error.value,/save failed/);
});

test('保存后返回缺字段时要求重新读取，不能盲目重试',async()=>{
  let writes=0;const {s}=panel('fast',{getSettings:async()=>({openai_fast_policy_settings:fast()}),updateSettings:async()=>{writes++;return {};}});
  await s.load();s.rows.value[0].rule.action='pass';await s.save();assert.equal(s.ready.value,false);assert.match(s.error.value,/已提交/);await s.save();assert.equal(writes,1);
});

test('关闭面板隔离迟到读取与保存',async()=>{
  const pending=deferred();const a=panel('beta',{getBetaPolicySettings:()=>pending.promise});const run=a.s.load();a.close();pending.resolve(beta());await run;assert.equal(a.s.baseline.value,null);
  const saved=deferred();const b=panel('beta',{getBetaPolicySettings:async()=>beta(),updateBetaPolicySettings:()=>saved.promise});await b.s.load();b.s.rows.value[0].rule.action='block';const saving=b.s.save();b.close();saved.resolve({rules:[]});await saving;assert.equal(b.s.rows.value[0].rule.action,'block');assert.equal(b.s.notice.value,'');
});

test('撤销草稿不请求后端，回到完整已读配置',async()=>{
  const {s}=panel('fast',{getSettings:async()=>({openai_fast_policy_settings:fast()})});await s.load();s.rows.value[0].rule.action='block';s.add();s.restore();assert.deepEqual(plain(s.rows.value.map(row=>row.rule)),fast().rules);assert.equal(s.dirty.value,false);
});

test('可选列表为 null、回退为空时保留官方默认语义',()=>{
  const baseline=rules.readPolicy({rules:[{...fast().rules[0],user_ids:null,model_whitelist:null,fallback_action:''}]},'fast');
  const rule={...baseline.rules[0],action:'block'};
  const payload=rules.policyPayload(baseline,[{id:1,rule,original:JSON.stringify(baseline.rules[0])}],'fast');
  assert.equal(payload.rules[0].fallback_action,'');assert.equal(payload.rules[0].user_ids,null);assert.equal(payload.rules[0].model_whitelist,null);
});

test('损坏的模型/用户数组在渲染前拒绝，不能触发 join 异常',()=>{
  for(const field of ['model_whitelist','user_ids'])assert.throws(()=>rules.readPolicy({rules:[{...fast().rules[0],[field]:'invalid'}]},'fast'),/格式无效/);
});
