// Offline: compiles the real SFC setup functions and injects in-memory API transports.
// No browser, account, server, payment or configuration access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'packages/sub2-console/src');
const resolve = name => require.resolve(name, { paths: [path.join(root, 'packages/sub2-console')] });
const ts = require(resolve('typescript'));
const vue = require(resolve('vue'));
const sfc = require(resolve('vue/compiler-sfc'));
function evaluate(source, requireFn) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(requireFn, module, module.exports);
  return module.exports;
}
const contract = evaluate(fs.readFileSync(path.join(src,'apps/admin/policies/policy-contract.ts'),'utf8'), () => { throw Error('Unexpected runtime dependency'); });
function setup(file, props = {}, dependencies = {}) {
  if (file === 'UsersApp.vue') {
    // Policy/key tests do not exercise balance writes. Supply the required ready controller;
    // r10-incremental-writes.test.cjs covers the real controller and unknown-result lifecycle.
    const readyGuard = { blocked: vue.ref(false), pending: vue.ref(false), error: vue.ref(''), busy: vue.ref(false),
      snapshot: vue.ref(''), canAcknowledge: vue.ref(false), reset() {}, dispose() {}, capture: () => ({ current: () => true }),
      inspect: async () => { throw Error('Unexpected balance inspection'); }, acknowledge: async () => { throw Error('Unexpected balance acknowledgement'); } };
    dependencies = { ...dependencies, '../../api/admin/users': {
      createBalanceWriteGuard: async () => readyGuard, ...dependencies['../../api/admin/users']
    } };
  }
  const full = path.join(src,'apps/admin',file);
  const { descriptor } = sfc.parse(fs.readFileSync(full,'utf8'), { filename: full });
  const script = sfc.compileScript(descriptor, { id: file });
  const mounted = [], unmounted = [], events = [];
  const load = name => {
    if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn) };
    if (name.endsWith('policy-contract')) return contract;
    if (dependencies[name]) return dependencies[name];
    if (name.endsWith('/apiKeys')) return evaluate(fs.readFileSync(path.join(src,'api/admin/apiKeys.ts'),'utf8'), () => ({apiClient:{put:()=>{throw Error('Unexpected API-key write');}}}));
    if (name === '@/assets/appIcons') return { getAppIcon: () => '/fixture-icon.svg' };
    if (name.endsWith('admin-feedback')) return dependencies[name] || { adminError: (e,f) => e?.message || f, collectAdminPages: async () => [] };
    if (name.endsWith('.vue') || name === '@sub2-mac/core') return {};
    throw Error(`Unmocked dependency ${name}`);
  };
  const component = evaluate(script.content, load).default;
  let exposed;
  const state = component.setup(props, { expose: v => { exposed = v; }, emit: (...v) => events.push(v) });
  return { state, exposed, mounted, unmounted, events };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };

test('R07 key group supports bind/unbind, returns auto-grant notice and rejects late response',async()=>{
  const writes=[], key={id:3,name:'fixture',group_id:4}, late=deferred();let delayed=false;
  const c=setup('UsersApp.vue',{}, {'../../api/admin/users':{getUserApiKeys:async()=>({items:[key],total:1})},'../../api/admin/groups':{getAll:async()=>[{id:4,name:'old'},{id:5,name:'new'}]},'../../api/admin/apiKeys':{apiKeysAPI:{updateApiKeyGroup:async(id,group)=>{writes.push([id,group]);return delayed?late.promise:{api_key:{...key,group_id:group},auto_granted_group_access:group===5,granted_group_name:'new'};}}}});
  await c.state.openApiKeys({id:7});await flush();c.state.keyGroupDrafts.value[3]=5;await c.state.saveKeyGroup(key);assert.deepEqual(writes,[[3,5]]);assert.match(c.state.keysNotice.value,/授予/);
  c.state.keyGroupDrafts.value[3]=0;await c.state.saveKeyGroup(c.state.userApiKeys.value[0]);assert.deepEqual(writes[1],[3,0]);assert.equal(c.state.userApiKeys.value[0].group_id,0);
  delayed=true;c.state.keyGroupDrafts.value[3]=5;const p=c.state.saveKeyGroup(c.state.userApiKeys.value[0]);await c.state.saveKeyGroup(key);assert.equal(writes.length,3);
  c.unmounted.forEach(fn=>fn());late.resolve({api_key:{...key,group_id:5},auto_granted_group_access:false});await p;assert.equal(c.state.userApiKeys.value.length,0);
});

test('MiniMax 分组选择、筛选与创建保持官方平台值', async () => {
  const calls=[];
  const c=setup('GroupsApp.vue', {}, {'../../api/admin/groups': {
    list: async (...args) => { calls.push(['list', ...args]); return {items:[],total:0}; },
    create: async value => { calls.push(['create', value]); return {id:12,...value}; }
  }});
  assert.equal(c.state.platforms.find(item=>item.value==='minimax').label,'MiniMax');
  c.state.selectedPlatform.value='minimax';await c.state.loadGroups();assert.equal(calls[0][3].platform,'minimax');
  c.state.openCreate();c.state.form.value.name='MiniMax fixture';c.state.form.value.platform='minimax';await c.state.submitCreate();
  assert.equal(calls.find(row=>row[0]==='create')[1].platform,'minimax');
});

test('价格单位换算保留空、零、精度，拒绝 NaN 与负值', () => {
  assert.equal(contract.nullableNumber('', 1e6), null);
  assert.equal(contract.nullableNumber('0', 1e6), 0);
  assert.equal(contract.nullableNumber('1.25', 1e6), 0.00000125);
  assert.throws(() => contract.nullableNumber('NaN'));
  assert.throws(() => contract.nullableNumber('-1'));
});
test('部分更新保留未知嵌套字段，不提交未编辑字段', () => {
  const original = { name:'A', unknown: { nested: [1,2] }, price: null, zero: 0 };
  const draft = contract.copy(original); draft.name='B';
  assert.deepEqual(contract.changedFields(original,draft), { name:'B' });
  draft.unknown.nested.push(3); assert.deepEqual(original.unknown.nested,[1,2]);
});
test('路由 ID 保持数字类型且拒绝空行、重复模型、污染键', () => {
  assert.deepEqual(contract.routing([{ model:'gpt-*', accounts:'2, 19' }]), { 'gpt-*':[2,19] });
  for (const accounts of ['', '2,2', 'a', '1.5', '-1']) assert.throws(() => contract.routing([{ model:'m', accounts }]));
  assert.throws(() => contract.routing([{ model:'__proto__', accounts:'1' }]));
  assert.throws(() => contract.routing([{ model:'m', accounts:'1' }, { model:'m', accounts:'2' }]));
});
test('白名单仅接受末尾通配符，空启用和重复条目拒绝保存', () => {
  contract.validateGroup({ model_allowlist:{ enabled:true, models:['gpt-*'] } });
  for (const models of [[], ['a','a'], ['g*t'], ['**']]) assert.throws(() => contract.validateGroup({ model_allowlist:{ enabled:true,models } }));
});
test('分组组件不回写未编辑的可选项和 null；修改嵌套白名单保留扩展字段', () => {
  const source = { daily_limit_usd:null, model_routing:null, model_allowlist:{ enabled:true, models:['old'], future:'keep' }, future:{keep:1} };
  const c = setup('policies/GroupPolicyEditor.vue',{source});
  assert.deepEqual(c.exposed.patch(),{});
  c.state.draft.value.daily_limit_usd=0;
  c.state.allowlistText.value='new'; c.state.allowlistTouched.value=true;
  assert.deepEqual(c.exposed.patch(), { daily_limit_usd:0, model_allowlist:{ enabled:true,models:['new'],future:'keep' } });
  assert.deepEqual(source.model_allowlist.models,['old']);
});
test('缺少白名单能力时拒绝构造请求，编辑后恢复原值不回写', () => {
  const unavailable=setup('policies/GroupPolicyEditor.vue',{source:{}});
  unavailable.state.allowlistTouched.value=true;assert.throws(()=>unavailable.exposed.patch(),/能力/);
  const c=setup('policies/GroupPolicyEditor.vue',{source:{model_allowlist:{enabled:true,models:['a','b']}}});
  c.state.allowlistText.value='a\nb';c.state.allowlistTouched.value=true;assert.deepEqual(c.exposed.patch(),{});
});
test('同平台模型通配符冲突被阻止，不混淆不同平台', () => {
  const a={...contract.newPricing(),models:['gpt-*']}, b={...contract.newPricing(),models:['gpt-5']};
  assert.throws(()=>contract.validatePricing([a,b]),/重叠/);
  b.platform='anthropic';contract.validatePricing([a,b]);
});
test('渠道 Token 阶梯按区间校验，图片档位允许相同区间', () => {
  const p=contract.newPricing(); p.models=['m']; p.intervals=[contract.newInterval(),contract.newInterval()];
  assert.throws(() => contract.validatePricing([p]), /重叠/);
  p.billing_mode='image'; contract.validatePricing([p]);
  p.billing_mode='token'; p.intervals[0].max_tokens=100; p.intervals[1].min_tokens=100;
  contract.validatePricing([p]);
  p.intervals[1].min_tokens=99; assert.throws(() => contract.validatePricing([p]), /重叠/);
});
test('阶梯一小时缓存价格、倍率均被校验', () => {
  const p=contract.newPricing(); p.models=['m']; p.intervals=[contract.newInterval()];
  p.intervals[0].cache_write_1h_price=-1; assert.throws(() => contract.validatePricing([p]));
  p.intervals[0].cache_write_1h_price=0; p.intervals[0].input_multiplier=Infinity; assert.throws(() => contract.validatePricing([p]));
});
test('时段接受日末，拒绝重叠、倒序、非法时区和三位小数倍率', () => {
  const p=contract.newPricing(); p.models=['m'];
  p.time_pricing={ timezone:'Asia/Shanghai',periods:[{start_time:'18:00:00',end_time:'00:00:00',multiplier:1.25}] };
  contract.validatePricing([p]);
  p.time_pricing.periods.push({start_time:'20:00:00',end_time:'23:00:00',multiplier:1});
  assert.throws(() => contract.validatePricing([p]), /重叠/);
  p.time_pricing.periods.pop();p.time_pricing.periods[0].end_time='17:00:00'; assert.throws(() => contract.validatePricing([p]));
  p.time_pricing.periods[0].end_time='00:00:00';p.time_pricing.periods[0].multiplier=1.234;assert.throws(() => contract.validatePricing([p]));
  p.time_pricing.periods[0].multiplier=1;p.time_pricing.timezone='Bad/Zone';assert.throws(() => contract.validatePricing([p]));
});
test('平台全量替换包含所有已读取平台，不泄漏 usage 字段，保留零与空', () => {
  const rows=[{platform:'openai',daily_limit_usd:0,weekly_limit_usd:null,monthly_limit_usd:30,daily_usage_usd:9}];
  assert.deepEqual(contract.quotaPayload(rows),[{platform:'openai',daily_limit_usd:0,weekly_limit_usd:null,monthly_limit_usd:30}]);
  assert.throws(() => contract.quotaPayload([...rows,...rows]));
});
test('用户模块读取失败禁写，另一模块可独立工作，重试恢复', async () => {
  let fail=true; const writes=[];
  const api={ getPlatformQuotas:async()=>{if(fail) throw Error('404');return{platform_quotas:[]}}, listAttributeDefinitions:async()=>[], getAttributeValues:async()=>[], updatePlatformQuotas:async(...a)=>writes.push(a), updateAttributeValues:async(...a)=>writes.push(a) };
  const c=setup('policies/UserPolicyEditor.vue',{userId:8},{'../../../api/admin/users':api});
  c.mounted.forEach(fn=>fn()); await flush();
  assert.equal(c.state.quotaReady.value,false);assert.equal(c.state.attrReady.value,true);
  c.state.quotas.value=[{platform:'openai',daily_limit_usd:1,weekly_limit_usd:null,monthly_limit_usd:null}];
  await c.state.saveQuotas();assert.equal(writes.length,0);
  fail=false;await c.state.loadQuotas();assert.equal(c.state.quotaReady.value,true);
});
test('用户保存防重复，失败保留草稿，成功只更新该模块基线', async () => {
  const pending=deferred(); let count=0;
  const api={updatePlatformQuotas:()=>{count++;return pending.promise}};
  const c=setup('policies/UserPolicyEditor.vue',{userId:3},{'../../../api/admin/users':api});
  c.state.quotaReady.value=true;c.state.quotas.value=[{platform:'openai',daily_limit_usd:4,weekly_limit_usd:null,monthly_limit_usd:null}];
  const saving=c.state.saveQuotas(); await c.state.saveQuotas(); assert.equal(count,1);
  pending.reject(Error('fixture failed'));await saving;
  assert.equal(c.state.quotas.value[0].daily_limit_usd,4);assert.equal(c.state.quotaDirty.value,true);
  api.updatePlatformQuotas=async()=>{};await c.state.saveQuotas();assert.equal(c.state.quotaDirty.value,false);
});
test('属性按控件数据生成字符串 payload；未改字段不提交', async () => {
  let payload;
  const c=setup('policies/UserPolicyEditor.vue',{userId:3},{'../../../api/admin/users':{updateAttributeValues:async(id,v)=>{payload=v}}});
  c.state.attrReady.value=true;c.state.attrBase.value={1:'untouched',2:'["a"]',99:'opaque'};c.state.values.value=contract.copy(c.state.attrBase.value);
  c.state.toggle(2,'b',true);await c.state.saveAttributes();assert.deepEqual(payload,{2:'["a","b"]'});
  assert.equal(c.state.values.value[99],'opaque');
});
test('关闭用户组件后迟到响应不写入新状态', async () => {
  const request=deferred();const c=setup('policies/UserPolicyEditor.vue',{userId:1},{'../../../api/admin/users':{getPlatformQuotas:()=>request.promise}});
  const loading=c.state.loadQuotas();c.unmounted.forEach(fn=>fn());request.resolve({platform_quotas:[]});await loading;assert.equal(c.state.quotaReady.value,false);
});
test('用户属性必填与数值限制生效', () => {
  const defs=[{id:1,name:'等级',type:'number',required:true,validation:{min:1,max:5}}];
  assert.throws(()=>contract.validateAttributes(defs,{1:''}));assert.throws(()=>contract.validateAttributes(defs,{1:'9'}));contract.validateAttributes(defs,{1:'2'});
});
test('GroupsApp 从详情初始化，只把实际变更提交给 update', async () => {
  let sent;
  const detail={id:4,name:'Original',description:null,platform:'openai',rate_multiplier:1,is_exclusive:false,subscription_type:'standard',rpm_limit:0,model_routing:{m:[2]},future:'keep'};
  const api={getById:async()=>detail,update:async(id,payload)=>{sent={id,payload}},list:async()=>({items:[],total:0})};
  const c=setup('GroupsApp.vue',{}, {'../../api/admin/groups':api});
  await c.state.openEdit({id:4,name:'stale list'});
  assert.equal(c.state.form.value.name,'Original');
  c.state.form.value.name='Changed';c.state.policyEditor.value={patch:()=>({daily_limit_usd:0})};
  await c.state.submitEdit();assert.deepEqual(sent,{id:4,payload:{name:'Changed',daily_limit_usd:0}});
  assert.equal(detail.description,null);assert.deepEqual(detail.model_routing,{m:[2]});
});
test('GroupsApp 详情失败不打开可保存表单；校验失败不发送更新', async () => {
  let writes=0;
  const api={getById:async()=>{throw Error('fixture 503')},update:async()=>{writes++}};
  const c=setup('GroupsApp.vue',{}, {'../../api/admin/groups':api});
  await c.state.openEdit({id:4});assert.equal(c.state.showEditModal.value,false);
  c.state.editingGroup.value={id:4};c.state.form.value={name:'X'};c.state.policyEditor.value={patch:()=>{throw Error('invalid route')}};
  await c.state.submitEdit();assert.equal(writes,0);assert.match(c.state.actionError.value,/invalid route/);
});
test('ChannelsApp 只改名称不回写价格、映射或账号统计规则', async () => {
  let sent;
  const detail={id:4,name:'A',description:'',status:'active',billing_model_source:'upstream',restrict_models:false,group_ids:[8],model_pricing:[{...contract.newPricing(),models:['m'],future:42}],model_mapping:{openai:{m:'n'},gemini:{}},apply_pricing_to_account_stats:false,account_stats_pricing_rules:[],features_config:{unknown:[1]},created_at:'',updated_at:''};
  const api={getById:async()=>detail,update:async(id,payload)=>{sent=payload},list:async()=>({items:[],total:0})};
  const c=setup('ChannelsApp.vue',{}, {'../../api/admin/channels':api,'../../api/admin/groups':{groupsAPI:{}},'../../api/admin/channelMonitor':{channelMonitorAPI:{}}});
  await c.state.openEdit({id:4});c.state.selectedChannel.value.name='B';await c.state.saveChannel();
  assert.deepEqual(sent,{name:'B'});assert.equal(detail.model_pricing[0].future,42);
  c.unmounted.forEach(fn=>fn());
});
test('UsersApp 基础保存保留高级草稿，空密码不发送', async () => {
  let sent;
  const api={update:async(id,payload)=>{sent=payload},list:async()=>({items:[],total:0})};
  const c=setup('UsersApp.vue',{}, {'../../api/admin/users':api,'../../api/admin/groups':{}});
  c.state.openEdit({id:9,email:'fixture@example.invalid',username:'before',role:'user',status:'active',concurrency:5,rpm_limit:0,notes:''});
  c.state.editForm.value.username='after';await c.state.submitEdit();
  assert.deepEqual(sent,{username:'after'});assert.equal(c.state.showEditModal.value,true);
});
test('专用用户 API 请求严格使用官方路径和包裹结构', async () => {
  const calls=[];
  const client={get:async(...a)=>{calls.push(['GET',...a]);return{data:[]}},put:async(...a)=>{calls.push(['PUT',...a]);return{data:{}}}};
  const api=evaluate(fs.readFileSync(path.join(src,'api/admin/users.ts'),'utf8'),name=>{assert.equal(name,'../client');return{apiClient:client}});
  await api.listAttributeDefinitions();await api.getAttributeValues(7);await api.updateAttributeValues(7,{2:'x'});await api.updatePlatformQuotas(7,[]);
  assert.deepEqual(calls,[['GET','/admin/user-attributes',{params:{enabled:true}}],['GET','/admin/users/7/attributes'],['PUT','/admin/users/7/attributes',{values:{2:'x'}}],['PUT','/admin/users/7/platform-quotas',{quotas:[]}]]);
});
test('复合路由 CRUD、启停、预览调用真实组件方法，删除须先选择确认目标', async () => {
  const calls=[];
  let row={id:2,group_id:9,public_model:'a',match_type:'exact',target_platform:'openai',upstream_model:'b',endpoint:'responses',priority:0,enabled:true,notes:''};
  const api={listCompositeRoutes:async()=>[row],createCompositeRoute:async(id,p)=>{calls.push(['create',id,p]);return{...p,id:3,group_id:id}},updateCompositeRoute:async(id,r,p)=>{calls.push(['update',id,r,p]);return{...p,id:r,group_id:id}},deleteCompositeRoute:async(...args)=>{calls.push(['delete',...args])},previewCompositeRoute:async(...args)=>{calls.push(['preview',...args]);return{matched:true,source:'route',target_platform:'openai',upstream_model:'b'}}};
  const c=setup('policies/CompositeRoutesEditor.vue',{groupId:9},{'../../../api/admin/groups':api});
  await c.state.load();c.state.edit(row);assert.equal(c.state.form.value.priority,0);
  c.state.form.value.enabled=false;await c.state.save();assert.equal(calls[0][3].enabled,false);
  c.state.form.value.public_model='new';await c.state.save();assert.equal(calls[1][0],'create');assert.equal(c.state.rows.value.length,2);
  c.state.previewModel.value='a';c.state.previewEndpoint.value='responses';await c.state.preview();assert.deepEqual(calls[2],['preview',9,{model:'a',endpoint:'responses'}]);assert.equal(c.state.decision.value.matched,true);
  await c.state.remove();assert.equal(calls.length,3);
  c.state.pendingDelete.value=row;await c.state.remove();assert.deepEqual(calls[3],['delete',9,2]);assert.equal(c.state.rows.value.length,1);
});
test('复合路由读失败禁写，保存失败保留草稿且防重复', async () => {
  const pending=deferred();let writes=0;
  const api={listCompositeRoutes:async()=>{throw Error('404')},createCompositeRoute:()=>{writes++;return pending.promise}};
  const c=setup('policies/CompositeRoutesEditor.vue',{groupId:9},{'../../../api/admin/groups':api});
  await c.state.load();c.state.form.value.public_model='draft';await c.state.save();assert.equal(writes,0);
  c.state.ready.value=true;const saving=c.state.save();await c.state.save();assert.equal(writes,1);pending.reject(Error('503'));await saving;assert.equal(c.state.form.value.public_model,'draft');assert.match(c.state.error.value,/503/);
});
test('Messages 精确映射不破坏未编辑模型和扩展配置', () => {
  const source={messages_dispatch_model_config:{opus_mapped_model:'old',sonnet_mapped_model:'keep',exact_model_mappings:{a:'b'},future:{keep:1}}};
  const c=setup('policies/GroupDispatchEditor.vue',{source,platform:'openai'});
  assert.deepEqual(c.exposed.patch(),{});
  c.state.config.value.opus_mapped_model='new';c.state.configTouched.value=true;
  assert.deepEqual(c.exposed.patch(),{messages_dispatch_model_config:{...source.messages_dispatch_model_config,opus_mapped_model:'new'}});
  c.state.exact.value.push({from:'a',to:'c'});c.state.exactTouched.value=true;assert.throws(()=>c.exposed.patch(),/重复/);
});
test('推理编辑器经过 GroupPolicyEditor 与 GroupsApp 提交准确差异', async () => {
  let sent;
  const detail={id:1,name:'G',platform:'openai',description:'',rate_multiplier:1,is_exclusive:false,subscription_type:'standard',rpm_limit:0,max_reasoning_effort:'medium',model_routing:{m:[9]}};
  const app=setup('GroupsApp.vue',{}, {'../../api/admin/groups':{getById:async()=>detail,update:async(id,p)=>{sent=p},list:async()=>({items:[],total:0})}});
  await app.state.openEdit(detail);
  const group=setup('policies/GroupPolicyEditor.vue',{source:detail,platform:'openai'}),dispatch=setup('policies/GroupDispatchEditor.vue',{source:detail,platform:'openai'});
  dispatch.state.draft.value.max_reasoning_effort='high';group.state.dispatchEditor.value=dispatch.exposed;app.state.policyEditor.value=group.exposed;
  await app.state.submitEdit();assert.deepEqual(sent,{max_reasoning_effort:'high'});
});
test('推理映射按模型作用域校验，保留未知旧规则，新增全局规则不带空模型', () => {
  const original={from:'future',to:'future-target',model:'legacy',extra:123};
  const c=setup('policies/GroupDispatchEditor.vue',{source:{reasoning_effort_mappings:[original],max_reasoning_effort:'high',max_reasoning_effort_over_limit:'downgrade'},platform:'openai'});
  c.state.draft.value.reasoning_effort_mappings.push({from:'high',to:'deny',model:'',match_type:'exact'});
  assert.deepEqual(c.exposed.patch().reasoning_effort_mappings,[original,{from:'high',to:'deny'}]);
  c.state.draft.value.reasoning_effort_mappings.push({from:'high',to:'medium'});assert.throws(()=>c.exposed.patch(),/重复/);
  c.state.draft.value.reasoning_effort_mappings.pop();c.state.draft.value.max_reasoning_effort_over_limit='deny';assert.equal(c.exposed.patch().max_reasoning_effort_over_limit,'deny');
  const absent=setup('policies/GroupDispatchEditor.vue',{source:{},platform:'openai'});absent.state.draft.value.max_reasoning_effort='high';assert.throws(()=>absent.exposed.patch(),/能力/);
});
test('属性定义加载包含停用项，编辑仅更新变化字段，排序失败不变更顺序', async () => {
  const row={id:1,key:'level',name:'Level',description:'',type:'number',options:[],required:false,enabled:false,placeholder:'',display_order:0,validation:{min:-5,extra:'keep'}};
  const row2={...row,id:2,key:'other',display_order:1};let sent;let fail=true;let serverRows=[row,row2];
  const api={listAttributeDefinitions:async enabled=>{assert.equal(enabled,false);return serverRows},updateAttributeDefinition:async(id,p)=>{sent=p;return{...row,...p}},reorderAttributeDefinitions:async ids=>{if(fail)throw Error('503');serverRows=ids.map((id,i)=>({...serverRows.find(r=>r.id===id),display_order:i+10}))}};
  const c=setup('policies/AttributeDefinitionsEditor.vue',{}, {'../../../api/admin/users':api});await c.state.load();assert.equal(c.state.rows.value.length,2);
  c.state.edit(row);c.state.form.value.name='New';await c.state.save();assert.deepEqual(sent,{name:'New'});
  await c.state.move(0,1);assert.deepEqual(c.state.rows.value.map(r=>r.id),[1,2]);fail=false;await c.state.move(0,1);assert.deepEqual(c.state.rows.value.map(r=>r.id),[2,1]);
});
test('属性定义创建、选项验证、删除确认与失败草稿', async () => {
  const writes=[];const api={createAttributeDefinition:async p=>{writes.push(['create',p]);return{...p,id:7}},deleteAttributeDefinition:async id=>writes.push(['delete',id])};
  const c=setup('policies/AttributeDefinitionsEditor.vue',{}, {'../../../api/admin/users':api});c.state.ready.value=true;
  Object.assign(c.state.form.value,{key:'tier',name:'Tier',type:'select',options:[{value:'a',label:'A'},{value:'a',label:'B'}]});
  await c.state.save();assert.equal(writes.length,0);assert.equal(c.state.form.value.name,'Tier');
  c.state.form.value.options.pop();await c.state.save();assert.equal(writes[0][0],'create');assert.equal(c.state.rows.value[0].id,7);
  await c.state.remove();assert.equal(writes.length,1);c.state.pendingDelete.value=c.state.rows.value[0];await c.state.remove();assert.deepEqual(writes[1],['delete',7]);
});
test('属性排序已保存但回读失败时禁写，避免伪造排序编号', async () => {
  const c=setup('policies/AttributeDefinitionsEditor.vue',{}, {'../../../api/admin/users':{reorderAttributeDefinitions:async()=>{},listAttributeDefinitions:async()=>{throw Error('503')}}});
  c.state.ready.value=true;c.state.rows.value=[{id:1,display_order:50},{id:2,display_order:70}];await c.state.move(0,1);
  assert.equal(c.state.ready.value,false);assert.match(c.state.error.value,/排序已保存/);assert.equal(c.state.rows.value[0].display_order,70);
});
test('额度重置仅调用目标平台/周期，保留未保存限额，防重复', async () => {
  const pending=deferred(),calls=[];
  const c=setup('policies/UserPolicyEditor.vue',{userId:4},{'../../../api/admin/users':{resetPlatformQuotaWindow:(...a)=>{calls.push(a);return pending.promise}}});
  c.state.quotaReady.value=true;c.state.quotas.value=[{platform:'openai',daily_limit_usd:55,weekly_limit_usd:null,monthly_limit_usd:null}];
  await c.state.resetUsage();assert.equal(calls.length,0);
  c.state.pendingReset.value={platform:'openai',window:'daily'};const resetting=c.state.resetUsage();await c.state.resetUsage();assert.equal(calls.length,1);
  pending.resolve({platform_quotas:[{platform:'openai',daily_usage_usd:0,weekly_usage_usd:12,monthly_usage_usd:30}]});await resetting;
  assert.deepEqual(calls[0],[4,'openai','daily']);assert.equal(c.state.quotas.value[0].daily_limit_usd,55);assert.equal(c.state.usageFor('openai','weekly'),12);assert.equal(c.state.quotaDirty.value,true);
});
test('模型同步过滤已配置/通配符模型，只在选择后加入草稿', async () => {
  const pricing=[{...contract.newPricing(),models:['gpt-*'],future:'keep'}];
  const c=setup('policies/ModelCatalogEditor.vue',{modelValue:pricing},{'../../../api/admin/channels':{syncPricingModels:async p=>{assert.equal(p,'openai');return{models:['gpt-5','o3','o3','o4']}}}});
  await c.state.sync();assert.deepEqual(c.state.candidates.value,['o3','o4']);assert.equal(c.events.length,0);
  c.state.selected.value=['o3'];c.state.addSelected();assert.equal(c.events[0][0],'update:modelValue');assert.deepEqual(c.events[0][1][1].models,['o3']);assert.equal(c.events[0][1][0].future,'keep');assert.equal(pricing.length,1);
});
test('模型目录失败不会生成候选或伪造成功；关闭后忽略迟到结果', async () => {
  const request=deferred();const c=setup('policies/ModelCatalogEditor.vue',{modelValue:[]},{'../../../api/admin/channels':{syncPricingModels:()=>request.promise}});
  const loading=c.state.sync();c.unmounted.forEach(fn=>fn());request.resolve({models:['new']});await loading;assert.deepEqual(c.state.candidates.value,[]);
  const failed=setup('policies/ModelCatalogEditor.vue',{modelValue:[]},{'../../../api/admin/channels':{syncPricingModels:async()=>{throw Error('404')}}});await failed.state.sync();assert.equal(failed.state.loadedPlatform.value,'');assert.match(failed.state.error.value,/404/);
});
test('默认价保持每 Token 单位，仅填空白不覆盖零或已有价格', async () => {
  const pricing={...contract.newPricing(),models:['m'],input_price:0,output_price:0.00002};
  const c=setup('policies/ModelDefaultPrices.vue',{pricing},{'../../../api/admin/channels':{getModelDefaultPricing:async()=>({found:true,input_price:0.000003,output_price:0.000004,cache_write_price:0.000006})}});
  await c.state.fetchPrices();assert.equal(pricing.cache_write_price,null);c.state.apply();assert.equal(pricing.cache_write_price,0.000006);assert.equal(pricing.input_price,0);assert.equal(pricing.output_price,0.00002);
});
test('默认价查询过程中切换定价对象，迟到响应不能写入新条目', async () => {
  const request=deferred(),props={pricing:{...contract.newPricing(),models:['m']}};
  const c=setup('policies/ModelDefaultPrices.vue',props,{'../../../api/admin/channels':{getModelDefaultPricing:()=>request.promise}});
  const loading=c.state.fetchPrices();props.pricing={...contract.newPricing(),models:['m']};request.resolve({found:true,input_price:0.1});await loading;c.state.apply();assert.equal(props.pricing.input_price,null);assert.equal(c.state.result.value,null);
});
test('新增五项 API 的路径、HTTP 方法与请求包裹匹配官方', async () => {
  const calls=[];const client=Object.fromEntries(['get','post','put','delete'].map(method=>[method,async(...args)=>{calls.push([method,...args]);return{data:{models:[]}}}]));
  const loadApi=file=>evaluate(fs.readFileSync(path.join(src,'api/admin',file),'utf8'),name=>{assert.equal(name,'../client');return{apiClient:client}});
  const users=loadApi('users.ts'),groups=loadApi('groups.ts'),channels=loadApi('channels.ts');
  await users.createAttributeDefinition({key:'k'});await users.updateAttributeDefinition(2,{name:'N'});await users.deleteAttributeDefinition(2);await users.reorderAttributeDefinitions([3,1]);await users.resetPlatformQuotaWindow(8,'openai','weekly');
  await groups.listCompositeRoutes(4);await groups.createCompositeRoute(4,{public_model:'m'});await groups.updateCompositeRoute(4,5,{public_model:'n'});await groups.deleteCompositeRoute(4,5);await groups.previewCompositeRoute(4,{model:'m',endpoint:'any'});
  await channels.syncPricingModels('openai');await channels.getModelDefaultPricing('m');
  assert.deepEqual(calls,[['post','/admin/user-attributes',{key:'k'}],['put','/admin/user-attributes/2',{name:'N'}],['delete','/admin/user-attributes/2'],['put','/admin/user-attributes/reorder',{ids:[3,1]}],['post','/admin/users/8/platform-quotas/reset',{platform:'openai',window:'weekly'}],['get','/admin/groups/4/composite-routes'],['post','/admin/groups/4/composite-routes',{public_model:'m'}],['put','/admin/groups/4/composite-routes/5',{public_model:'n'}],['delete','/admin/groups/4/composite-routes/5'],['post','/admin/groups/4/composite-routes/preview',{model:'m',endpoint:'any'}],['get','/admin/channels/pricing/sync-models',{params:{platform:'openai'}}],['get','/admin/channels/model-pricing',{params:{model:'m'}}]]);
});
test('全部独占 Vue 文件模板与脚本可编译，结构化编辑接线存在', () => {
  const files=['GroupsApp.vue','ChannelsApp.vue','UsersApp.vue',...fs.readdirSync(path.join(src,'apps/admin/policies')).filter(f=>f.endsWith('.vue')).map(f=>'policies/'+f)];
  for (const file of files) {
    const filename=path.join(src,'apps/admin',file),source=fs.readFileSync(filename,'utf8');
    const {descriptor,errors}=sfc.parse(source,{filename});assert.deepEqual(errors,[],file);
    sfc.compileScript(descriptor,{id:file});
    const compiled=sfc.compileTemplate({id:file,filename,source:descriptor.template.content,compilerOptions:{expressionPlugins:['typescript']}});
    assert.deepEqual(compiled.errors,[],file);
  }
  assert.match(fs.readFileSync(path.join(src,'apps/admin/ChannelsApp.vue'),'utf8'),/<PricingPolicyEditor v-model="selectedChannel.model_pricing"/);
});
test('渠道三项功能正确回显与关闭，保留未知配置和其他平台',()=>{
  const original={web_search_emulation:{anthropic:true,future:true},bedrock_cc_compat:true,codex_image_generation_bridge:{openai:false},extension:{secret:'opaque'}};
  const c=setup('policies/ChannelFeaturesEditor.vue',{modelValue:original});
  assert.equal(c.state.enabled('bedrock_cc_compat','anthropic'),true);
  c.state.set('web_search_emulation','anthropic',false);
  assert.deepEqual(c.events[0][1],{...original,web_search_emulation:{anthropic:false,future:true}});
  c.state.set('bedrock_cc_compat','anthropic',false);assert.equal(c.events[1][1].bedrock_cc_compat,false);
  c.state.set('codex_image_generation_bridge','openai',true);assert.deepEqual(c.events[2][1].codex_image_generation_bridge,{openai:true});
  assert.equal(original.web_search_emulation.anthropic,true);
});
test('渠道窗口复用时响应 customData.tab，非法 tab 不破坏当前页',async()=>{
  let monitorCalls=0,channelCalls=0;
  const props=vue.reactive({win:{customData:{tab:'pricing'}}});
  const c=setup('ChannelsApp.vue',props,{'./admin-feedback':{adminError:e=>e.message,collectAdminPages:async fn=>fn(1,20)},'../../api/admin/channels':{list:async()=>{channelCalls++;return{items:[],total:0}}},'../../api/admin/groups':{groupsAPI:{}},'../../api/admin/channelMonitor':{channelMonitorAPI:{list:async()=>{monitorCalls++;return []}}}});
  props.win.customData.tab='monitor';await vue.nextTick();await flush();assert.equal(c.state.activeSubTab.value,'monitor');assert.equal(monitorCalls,1);
  props.win.customData={tab:'pricing'};await vue.nextTick();assert.equal(c.state.activeSubTab.value,'pricing');assert.equal(channelCalls,1);
  props.win.customData.tab='unknown';await vue.nextTick();assert.equal(c.state.activeSubTab.value,'pricing');
});
test('创建用户属性失败重试不重复创建用户，先校验属性再 POST',async()=>{
  let creates=0,attributes=0,fail=true;
  const api={create:async()=>{creates++;return{id:7}},updateAttributeValues:async(id,p)=>{assert.equal(id,7);assert.deepEqual(p,{1:'A'});attributes++;if(fail)throw Error('503')},list:async()=>({items:[],total:0})};
  const c=setup('UsersApp.vue',{}, {'../../api/admin/users':api,'../../api/admin/groups':{}});c.state.openCreate();c.state.createForm.value.email='fixture@example.invalid';c.state.createForm.value.password='fixture';
  c.state.createAttributes.value={payload:()=>{throw Error('required')}};await c.state.submitCreate();assert.equal(creates,0);
  c.state.createAttributes.value={payload:()=>({1:'A'})};await c.state.submitCreate();assert.equal(creates,1);assert.equal(c.state.createdUserId.value,7);assert.equal(c.state.showCreateModal.value,true);
  fail=false;await c.state.submitCreate();assert.equal(creates,1);assert.equal(attributes,2);assert.equal(c.state.showCreateModal.value,false);
});
test('属性筛选进入 Users API，数值零作为字符串不丢失',async()=>{
  let filters;const c=setup('UsersApp.vue',{}, {'../../api/admin/users':{list:async(p,s,f)=>{filters=f;return{items:[],total:0}}},'../../api/admin/groups':{}});
  c.state.page.value=3;c.state.applyAttributes({2:'0'});await flush();assert.deepEqual(filters.attributes,{2:'0'});assert.equal(c.state.page.value,1);
});
test('批量属性逐用户写入，报告部分失败，仅重试失败 ID',async()=>{
  const calls=[];let fail=true;const c=setup('policies/BulkUserPolicies.vue',{userIds:[1,2]},{'../../../api/admin/users':{updateAttributeValues:async(id,v)=>{calls.push([id,v]);if(id===2&&fail)throw Error('503')}}});
  c.state.mode.value='attributes';c.state.ready.value=true;c.state.definitions.value=[{id:3,name:'Tier',required:false,type:'text'}];c.state.enabledIds.value=[3];c.state.values.value={3:'gold',9:'do not send'};
  c.state.prepare();await c.state.submit();assert.deepEqual(calls,[[1,{3:'gold'}],[2,{3:'gold'}]]);assert.deepEqual(c.state.failedIds.value,[2]);
  fail=false;c.state.prepare(true);await c.state.submit();assert.deepEqual(calls[2],[2,{3:'gold'}]);assert.deepEqual(c.state.failedIds.value,[]);
});
test('批量限制只提交勾选字段与明确 ID，永不 all:true',async()=>{
  let sent;const c=setup('policies/BulkUserPolicies.vue',{userIds:[1,2]},{'../../../api/admin/users':{batchUpdateLimits:async p=>{sent=p;return{affected:2}}}});
  c.state.enableRpm.value=true;c.state.rpm.value=0;c.state.prepare();await c.state.submit();assert.deepEqual(sent,{user_ids:[1,2],all:false,rpm_limit:0});
});
test('分组多媒体价格保持美元/张、美元/秒与音频单位，未编辑字段不发送',()=>{
  const source={image_price_1k:0.2,video_price_720p:0.07,audio_realtime_price_per_min:null,video_model_prices:{future:{'8k':0.99}},model_pricing:[]};
  const c=setup('policies/GroupMediaEditor.vue',{source,platform:'grok'});assert.deepEqual(c.exposed.patch(),{});
  c.state.draft.value.image_price_1k=0;c.state.draft.value.audio_realtime_price_per_min=0.25;
  c.state.videoRows.value.push({model:'grok-imagine-video',resolution:'720p',price:0.1});c.state.videoTouched.value=true;
  assert.deepEqual(c.exposed.patch(),{image_price_1k:0,audio_realtime_price_per_min:0.25,video_model_prices:{future:{'8k':0.99},'grok-imagine-video':{'720p':0.1}}});
  c.state.videoRows.value.push({model:'grok-imagine-video',resolution:'720p',price:0.2});assert.throws(()=>c.exposed.patch(),/重复/);
});
test('分组多媒体拒绝负价、空倍率、高峰非法时间，保留未知模型族',()=>{
  const c=setup('policies/GroupMediaEditor.vue',{source:{image_rate_multiplier:1,peak_rate_enabled:false,peak_start:'',peak_end:''},platform:'openai'});
  c.state.draft.value.image_rate_multiplier=null;assert.throws(()=>c.exposed.patch(),/倍率/);
  c.state.draft.value.image_rate_multiplier=-1;assert.throws(()=>c.exposed.patch(),/非负/);
  c.state.draft.value.image_rate_multiplier=1;c.state.draft.value.peak_rate_enabled=true;assert.throws(()=>c.exposed.patch(),/HH:mm/);
});
test('Codex manifest 读取组选账号，保留顺序和扩展值，空启用拒绝',async()=>{
  const source={codex_models_manifest_config:{enabled:false,account_ids:[99],fallback_to_scheduler:false,future:42}};
  let query;const c=setup('policies/CodexManifestEditor.vue',{source,groupId:4,platform:'openai'},{'../../../api/admin/groups':{searchManifestAccounts:async(...args)=>{query=args;return{items:[{id:8,name:'fixture'}],total:21}}}});
  assert.deepEqual(c.exposed.patch(),{});c.state.search.value='fixture';await c.state.find(2);assert.deepEqual(query,[4,'fixture',2]);c.state.add({id:8,name:'fixture'});c.state.draft.value.enabled=true;
  assert.deepEqual(c.exposed.patch(),{codex_models_manifest_config:{enabled:true,account_ids:[99,8],fallback_to_scheduler:false,future:42}});
  c.state.draft.value.account_ids=[];assert.throws(()=>c.exposed.patch(),/至少/);
});
test('Manifest 搜索精确使用官方分页、平台和 group 参数，不返回凭据',async()=>{
  let call;const api=evaluate(fs.readFileSync(path.join(src,'api/admin/groups.ts'),'utf8'),()=>({apiClient:{get:async(...args)=>{call=args;return{data:{items:[{id:5,name:'A',credentials:'never expose'}],total:1}}}}}));
  assert.deepEqual(await api.searchManifestAccounts(2,'a',3),{items:[{id:5,name:'A'}],total:1});
  assert.deepEqual(call,['/admin/accounts',{params:{page:3,page_size:20,search:'a',platform:'openai',group:'2'}}]);
});
test('创建成功响应缺少 ID 时阻止重复 POST，提示核对结果',async()=>{
  let calls=0;const c=setup('UsersApp.vue',{}, {'../../api/admin/users':{create:async()=>{calls++;return{};}},'../../api/admin/groups':{}});
  c.state.openCreate();c.state.createForm.value.email='a@example.invalid';c.state.createForm.value.password='fixture';c.state.createAttributes.value={payload:()=>({})};await c.state.submitCreate();await c.state.submitCreate();assert.equal(calls,1);assert.equal(c.state.creationNeedsReview.value,true);
});
test('批量属性提交前校验邮箱、网址及多选必填',()=>{
  for(const [type,value] of [['email','bad'],['url','bad'],['multi_select','[]']])assert.throws(()=>contract.validateAttributes([{id:1,name:'field',type,required:true}],{1:value}));
});

test('review: user API key response after unmount cannot repopulate private state',async()=>{
 const late=deferred();const c=setup('UsersApp.vue',{}, {'../../api/admin/users':{getUserApiKeys:()=>late.promise},'../../api/admin/groups':{}});
 const pending=c.state.openApiKeys({id:9});c.unmounted.forEach(fn=>fn());late.resolve({items:[{id:1,key:'private-key'}],total:1});await pending;
 assert.equal(c.state.userApiKeys.value.length,0);
});
for(const module of ['GroupsApp.vue','ChannelsApp.vue'])test('review: '+module+' refuses mismatched detail identity',async()=>{
 const deps=module==='GroupsApp.vue'?{'../../api/admin/groups':{getById:async()=>({id:99})}}:{'../../api/admin/channels':{getById:async()=>({id:99})},'../../api/admin/groups':{groupsAPI:{}},'../../api/admin/channelMonitor':{channelMonitorAPI:{}}};
 const c=setup(module,{},deps);await c.state.openEdit({id:1});
 assert.equal((module==='GroupsApp.vue'?c.state.showEditModal:c.state.showEditSheet).value,false);
});

test('review: bulk retry freezes original values even when live form and selection change',async()=>{
 const calls=[];let fail=true;const props=vue.reactive({userIds:[1,2]});
 const c=setup('policies/BulkUserPolicies.vue',props,{'../../../api/admin/users':{updateAttributeValues:async(id,value)=>{calls.push([id,{...value}]);if(id===2&&fail)throw Error('503')}}});
 c.state.mode.value='attributes';c.state.ready.value=true;c.state.definitions.value=[{id:3,name:'Tier',required:false,type:'text'}];c.state.enabledIds.value=[3];c.state.values.value={3:'gold'};
 c.state.prepare();await c.state.submit();c.state.values.value={3:'silver'};props.userIds=[99];fail=false;
 c.state.prepare(true);assert.deepEqual(c.state.pending.value.ids,[2]);await c.state.submit();assert.deepEqual(calls[2],[2,{3:'gold'}]);
});
