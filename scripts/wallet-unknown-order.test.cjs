// Executes real Wallet setup and payment helpers; every API call is an isolated fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.resolve(__dirname, '../packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue'), compiler = req('vue/compiler-sfc');
const base = path.resolve(__dirname, '../packages/sub2-console/src/apps/user');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function storage() { const m = new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}; }
function execute(file, extra={}) {
  let source=fs.readFileSync(path.join(base,file),'utf8');
  if(file.endsWith('.vue'))source=compiler.parse(source).descriptor.scriptSetup.content;
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
  for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))source=source.slice(0,n.pos)+source.slice(n.end);
  const cleanup=[],scope=vue.effectScope();
  const context={...vue,URL,Date,Error,console,exports:{},defineProps:()=>({}),onMounted(){},onBeforeUnmount:fn=>cleanup.push(fn),setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},...extra};
  scope.run(()=>vm.runInNewContext(ts.transpileModule(source+`\nglobalThis.subject={${names.join(',')}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context));
  return {s:context.subject,dispose(){cleanup.forEach(fn=>fn());scope.stop();}};
}
const flow=execute('payments/flow.ts').s, qr=execute('payments/qrFallback.ts').s;
const order={order_id:42,amount:50,pay_amount:50,fee_rate:0,expires_at:'2099-01-01',payment_type:'wxpay',qr_code:'fixture'};
function fixture(createOrder, session=storage()) {
  const auth=vue.reactive({user:{id:7}}),calls=[];
  const api={createOrder:async p=>{calls.push(p);return createOrder(p);},getMyOrders:async()=>({data:{items:[],total:0}})};
  const f=execute('WalletApp.vue',{...flow,...qr,paymentAPI:api,useAuthStore:()=>auth,useSystemAudio:()=>({}),getAppIcon:()=>'',userAPI:{},window:{location:{origin:'https://fixture.test'}},navigator:{userAgent:'MicroMessenger iPhone'},localStorage:storage(),sessionStorage:session});
  f.s.selectedMethod.value='wxpay';f.s.selectedPlan.value={id:1,price:50,name:'fixture'};
  return {...f,api,auth,calls,session};
}
test('Wallet real SFC script/template compile',()=>{
  const filename=path.join(base,'WalletApp.vue'),p=compiler.parse(fs.readFileSync(filename,'utf8'),{filename});assert.deepEqual(p.errors,[]);
  const script=compiler.compileScript(p.descriptor,{id:'wallet'});
  assert.deepEqual(compiler.compileTemplate({filename,source:p.descriptor.template.content,id:'wallet',compilerOptions:{bindingMetadata:script.bindings}}).errors,[]);
});
for(const mode of ['recharge','subscription'])for(const failure of [{status:503},{code:'ECONNABORTED'},{message:'Network Error'}])test(`${mode}: unknown failure blocks same and alternate purchase paths`,async()=>{
  const f=fixture(async()=>{throw failure;});const run=mode==='recharge'?f.s.handleCreateRechargeOrder:f.s.createSubscription;
  await run();await run();await f.s.handleCreateRechargeOrder();await f.s.createSubscription();assert.equal(f.calls.length,1);assert.equal(f.s.unknownOrder.value,true);assert.equal(f.s.initialFallbackRequest.value,undefined);assert.equal(f.s.paymentResult.value,null);f.dispose();
});
test('definitive HTTP rejection remains retryable including mobile QR fallback',async()=>{
  for(const status of [400,401,403,404,405,422,429]){
    const f=fixture(async()=>{throw {response:{status},reason:'WECHAT_H5_NOT_AUTHORIZED'};});await f.s.handleCreateRechargeOrder();assert.equal(f.s.unknownOrder.value,false);assert.ok(f.s.initialFallbackRequest.value);await f.s.handleCreateRechargeOrder();assert.equal(f.calls.length,2);f.dispose();
  }
});
test('5xx provider QR failure cannot bypass fence through alternate payment',async()=>{
  const f=fixture(async()=>{throw {status:502,reason:'PAYMENT_GATEWAY_ERROR'};});await f.s.handleCreateRechargeOrder();assert.equal(f.s.initialFallbackRequest.value,undefined);f.s.selectedMethod.value='alipay';await f.s.handleCreateRechargeOrder();assert.equal(f.calls.length,1);f.dispose();
});
test('success clears fence and retains order; malformed success remains unknown',async()=>{
  for(const data of [null,{}, {order_id:0}]){const f=fixture(async()=>({data}));await f.s.handleCreateRechargeOrder();assert.equal(f.s.unknownOrder.value,true);await f.s.handleCreateRechargeOrder();assert.equal(f.calls.length,1);f.dispose();}
  const f=fixture(async()=>({data:order}));await f.s.handleCreateRechargeOrder();assert.equal(f.s.unknownOrder.value,false);assert.equal(f.s.paymentResult.value.order_id,42);f.dispose();
});
test('OAuth required is a valid non-order response and keeps authorization flow',async()=>{
  const f=fixture(async()=>({data:{result_type:'oauth_required',oauth:{authorize_url:'https://fixture.test/oauth'}}}));await f.s.handleCreateRechargeOrder();assert.equal(f.s.unknownOrder.value,false);assert.equal(f.s.paymentResult.value.result_type,'oauth_required');f.dispose();
});
test('concurrent direct submissions cannot issue a second POST',async()=>{
  const d=deferred(),f=fixture(()=>d.promise);const p=f.s.submitPayment({amount:50,order_type:'balance',payment_type:'wxpay'});
  await assert.rejects(f.s.submitPayment({amount:50,order_type:'balance',payment_type:'wxpay'}));assert.equal(f.calls.length,1);d.resolve({data:order});await p;f.dispose();
});
test('unknown fence survives wallet close/reopen and is scoped to owner',async()=>{
  const session=storage();const first=fixture(async()=>{throw {status:503};},session);await first.s.handleCreateRechargeOrder();first.dispose();
  const f=fixture(async()=>({data:order}),session);assert.equal(f.s.unknownOrder.value,true);await f.s.handleCreateRechargeOrder();assert.equal(f.calls.length,0);
  f.auth.user={id:8};assert.equal(f.s.unknownOrder.value,false);f.auth.user={id:7};assert.equal(f.s.unknownOrder.value,true);assert.equal(session.getItem('sub2-mac.payment.unknown.v1:7'),'1');f.dispose();
});
test('order list failure or filtered list never unlocks; successful read still requires confirmation',async()=>{
  const f=fixture(async()=>{throw {status:503};});await f.s.handleCreateRechargeOrder();f.s.confirmNewOrder.value=true;f.s.allowNewOrder();assert.equal(f.s.unknownOrder.value,true);
  f.api.getMyOrders=async()=>{throw Error('offline');};await f.s.loadOrders(1);f.s.allowNewOrder();assert.equal(f.s.unknownOrder.value,true);
  f.api.getMyOrders=async()=>({data:{items:[],total:0}});f.s.currentStatusFilter.value='COMPLETED';await f.s.loadOrders(1);f.s.allowNewOrder();assert.equal(f.s.unknownOrder.value,true);
  f.s.currentStatusFilter.value='';f.s.confirmNewOrder.value=false;await f.s.loadOrders(1);f.s.allowNewOrder();assert.equal(f.s.unknownOrder.value,true);
  f.s.confirmNewOrder.value=true;f.s.allowNewOrder();assert.equal(f.s.unknownOrder.value,false);assert.equal(f.session.getItem('sub2-mac.payment.unknown.v1:7'),null);f.dispose();
});
test('account switch fences late failure/finally and does not unlock another pending request',async()=>{
  const a=deferred(),b=deferred();let n=0;const f=fixture(()=>++n===1?a.promise:b.promise);const first=f.s.handleCreateRechargeOrder();f.auth.user={id:8};const second=f.s.handleCreateRechargeOrder();
  a.reject({status:422});await first;assert.equal(f.s.submitting.value,true);assert.equal(f.s.unknownOrder.value,true);assert.equal(f.s.toastMsg.value,null);b.resolve({data:order});await second;assert.equal(f.s.unknownOrder.value,false);f.auth.user={id:7};assert.equal(f.s.unknownOrder.value,true);f.dispose();
});
test('late order list from prior owner cannot authorize fence release',async()=>{
  const d=deferred(),f=fixture(async()=>{throw {status:503};});await f.s.handleCreateRechargeOrder();f.api.getMyOrders=()=>d.promise;const p=f.s.loadOrders(1);f.auth.user={id:8};d.resolve({data:{items:[{id:42}],total:1}});await p;assert.equal(f.s.orders.value.length,0);assert.equal(f.s.unknownOrderReviewed.value,false);f.dispose();
});
