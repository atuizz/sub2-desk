// Isolated production-module/component fixtures. No network, real account or payment SDK calls.
// Run: node --test scripts/parity-payments.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const ts = req('typescript'), vue = req('vue');
const compiler = req('vue/compiler-sfc');
const base = path.join(root, 'packages/sub2-console/src/apps/user');
function source(file) { const raw = fs.readFileSync(path.join(base, file), 'utf8'); return file.endsWith('.vue') ? compiler.parse(raw).descriptor.scriptSetup.content : raw; }
function execute(file, extras = {}) {
  let code = source(file);
  const ast = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const names = ast.statements.flatMap(n => ts.isVariableStatement(n) ? n.declarationList.declarations.filter(d => ts.isIdentifier(d.name)).map(d => d.name.text) : ts.isFunctionDeclaration(n) && n.name ? [n.name.text] : []);
  for (const n of [...ast.statements].reverse()) if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) code = code.slice(0, n.pos) + code.slice(n.end);
  code = code.replace(/await import\('@stripe\/stripe-js\/pure'\)/g, 'await __stripe()').replace(/await import\('@airwallex\/components-sdk'\)/g, 'await __airwallex()');
  const events = [], mounted = [], unmounted = [], timers = new Map(); let timerId = 0;
  const context = { ...vue, console, URL, URLSearchParams, Date, Set, Error, AbortController, exports: {},
    defineProps: () => ({}), defineEmits: () => (...args) => events.push(args),
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn),
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    setInterval: fn => { timers.set(++timerId, fn); return timerId; }, clearInterval: id => timers.delete(id),
    fetch: () => { throw Error('Network forbidden'); }, ...extras };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(code + `\nglobalThis.subject = {${names.join(',')}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { s: context.subject, context, events, mounted, unmounted, timers, dispose() { unmounted.forEach(fn => fn()); } };
}
const flow = execute('payments/flow.ts').s;
function storage() { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v), removeItem: k => m.delete(k) }; }
const order = (extra = {}) => ({ order_id: 42, amount: 10, pay_amount: 10, fee_rate: 0, expires_at: new Date(Date.now() + 600000).toISOString(), payment_type: 'stripe', client_secret: 'fixture_secret', ...extra });
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
for (const file of ['WalletApp.vue', 'CheckoutSheet.vue', 'payments/ProviderPayment.vue', 'payments/PaymentRoute.vue', 'payments/QrFallbackSheet.vue']) test(`${file}: SFC template compilation`, () => {
  const filename = path.join(base,file); const p = compiler.parse(fs.readFileSync(filename,'utf8'),{filename}); assert.deepEqual(p.errors,[]);
  assert.deepEqual(compiler.compileTemplate({ source:p.descriptor.template.content, filename, id:file }).errors,[]);
});
test('dispatches all official result branches without treating Airwallex as Stripe', () => {
  assert.equal(flow.paymentKind(order()),'stripe');
  assert.equal(flow.paymentKind(order({payment_type:'airwallex',intent_id:'i'})),'airwallex');
  assert.equal(flow.paymentKind(order({payment_type:'airwallex'})),'unsupported');
  assert.equal(flow.paymentKind(order({result_type:'oauth_required'})),'oauth');
  assert.equal(flow.paymentKind(order({result_type:'jsapi_ready',jsapi:{paySign:'fixture'}})),'jsapi');
  assert.equal(flow.paymentKind(order({client_secret:undefined,qr_code:'wx://fixture'})),'qr');
});
test('payload preserves API provider key, WeChat source, subscription, force QR and precreate flag', () => {
  const input={amount:8,payment_type:'wxpay_direct',order_type:'subscription',plan_id:3};
  const wx=flow.createPayload(input,'https://site.test','MicroMessenger iPhone');
  assert.equal(wx.payment_type,'wxpay_direct'); assert.equal(wx.payment_source,'wechat_in_app_resume'); assert.equal(wx.plan_id,3);
  assert.equal(wx.return_url,'https://site.test/payment/result');
  assert.equal(flow.createPayload({...input,payment_type:'alipay'},'https://site.test','iPhone',{alipay_force_qrcode:true}).is_mobile,false);
  assert.equal(flow.createPayload({...input,payment_type:'alipay'},'https://site.test','iPhone',{alipay_force_qrcode:true,alipay_mobile_precreate_deep_link:true}).is_mobile,true);
});
test('recovery rejects foreign owner/order/token, invalid JSON, age and future timestamps; no JSAPI signatures', () => {
  const st=storage(); const o=order({resume_token:'signed',jsapi:{paySign:'private'},oauth:{authorize_url:'private'}}); flow.saveRecovery(st,o,7);
  const raw=st.getItem(flow.RECOVERY_KEY); assert.ok(!raw.includes('paySign')); assert.ok(!raw.includes('authorize_url'));
  assert.equal(flow.readRecovery(raw,{owner:7}).order_id,42);
  for(const c of [{owner:8},{orderId:9},{token:'wrong'},{}]) assert.equal(flow.readRecovery(raw,c),null);
  assert.equal(flow.readRecovery(raw,{owner:7},Date.now()+86400001),null);
  assert.equal(flow.readRecovery('bad',{owner:7}),null);
  flow.clearRecovery(st,99); assert.ok(st.getItem(flow.RECOVERY_KEY)); flow.clearRecovery(st,42); assert.equal(st.getItem(flow.RECOVERY_KEY),null);
});
test('URLs reject scripts, credentials and cross-origin callback redirect context', () => {
  for (const raw of ['javascript:alert(1)','data:text/html,a','https://user:pass@a.test/']) assert.equal(flow.safeURL(raw),'');
  const target=new URL(flow.oauthURL(order({oauth:{authorize_url:'/api/v1/auth/wechat/payment?redirect=//evil.test'}}),{payment_type:'wxpay',order_type:'subscription',plan_id:3,amount:8},'https://site.test'));
  assert.match(target.searchParams.get('redirect'),/^\/purchase\?/);
  assert.throws(()=>flow.parseWechatReturn(new URL('https://site.test/auth/wechat/payment/callback#openid=x&redirect=https://evil.test/?amount=9')));
});
test('WeChat fragment token takes priority; token amount remains zero; old openid retains purchase context', () => {
  const p=flow.parseWechatReturn(new URL('https://site.test/purchase?openid=old&amount=99#wechat_resume_token=signed'));
  assert.equal(p.amount,0);assert.equal(p.wechat_resume_token,'signed'); assert.equal(p.openid,undefined);
  const legacy=flow.parseWechatReturn(new URL('https://site.test/auth/wechat/payment/callback#openid=x&redirect=%2Fpurchase%3Famount%3D12%26plan_id%3D3'));
  assert.equal(legacy.amount,12);assert.equal(legacy.plan_id,3);assert.equal(legacy.order_type,'subscription');
  assert.throws(()=>flow.parseWechatReturn(new URL('https://site.test/purchase#error=denied&error_description=Cancelled')),/Cancelled/);
});
test('only exact payment landing paths and WeChat purchase resumes match', () => {
  for(const p of ['/payment/result?status=success','/payment/stripe','/payment/stripe-popup','/payment/airwallex','/payment/qrcode','/auth/wechat/payment/callback','/purchase?wechat_resume_token=x']) assert.equal(flow.isPaymentRoute(new URL(p,'https://site.test')),true,p);
  for(const p of ['/purchase','/auth/wechat/callback','/payment/stripe/evil']) assert.equal(flow.isPaymentRoute(new URL(p,'https://site.test')),false,p);
});
function statusFixture(api) { return execute('payments/usePaymentStatus.ts',{paymentAPI:api,PENDING:flow.PENDING}); }
test('result resolution signed token -> authorized order -> legacy authenticated/public verification', async () => {
  const calls=[]; const fail=async name=>{calls.push(name);throw Error('unsupported');};
  const api={resolveOrderPublicByResumeToken:()=>fail('token'),getOrder:()=>fail('order'),verifyOrder:()=>fail('verify'),verifyOrderPublic:async()=>{calls.push('public');return {data:{status:'PAID'}};}};
  const f=statusFixture(api); const result=await f.s.resolvePaymentStatus({token:'x',orderId:42,trade:'trade'},api);
  assert.deepEqual(calls,['token','order','verify','public']); assert.equal(result.data.status,'PAID');
});
test('aborted token resolution cannot cascade to fallback endpoints',async()=>{
  const abort=new AbortController();let calls=0;const api={resolveOrderPublicByResumeToken:async()=>{abort.abort();throw Error('aborted');},getOrder:async()=>{calls++;}};
  await assert.rejects(statusFixture(api).s.resolvePaymentStatus({token:'x',orderId:42},api,abort.signal));assert.equal(calls,0);
});
test('PAID and RECHARGING poll, COMPLETED emits exactly once, no concurrent requests',async()=>{
  let stage='PAID',calls=0,done=0;const first=defer();const api={getOrder:async()=>{calls++;return calls===1?first.promise:{data:{status:stage}};}};
  const f=statusFixture(api);const s=f.s.usePaymentStatus(()=>({orderId:42}),()=>done++);
  await s.refresh();assert.equal(calls,1);first.resolve({data:{status:'PAID'}});await flush();assert.equal(done,0);assert.equal(s.status.value,'PAID');
  stage='RECHARGING';await s.refresh();assert.equal(done,0);stage='COMPLETED';await s.refresh();await s.refresh();assert.equal(done,1);assert.equal(f.timers.size,0);f.dispose();
});
test('old order completion and old failure cannot overwrite switched order; unmount aborts',async()=>{
  const first=defer();let done=0;const context=vue.ref({orderId:1});const api={getOrder:async id=>id===1?first.promise:{data:{status:'PENDING'}}};
  const f=statusFixture(api);const s=f.s.usePaymentStatus(()=>context.value,()=>done++);context.value={orderId:2};await vue.nextTick();await flush();first.resolve({data:{status:'COMPLETED'}});await flush();assert.equal(s.status.value,'PENDING');assert.equal(done,0);f.dispose();assert.equal(f.timers.size,0);
});
test('failed lookup is unknown and retryable; forged callback status is never read',async()=>{
  let fail=true;const f=statusFixture({getOrder:async()=>{if(fail)throw Error('offline');return {data:{status:'PENDING'}};}});const s=f.s.usePaymentStatus(()=>({orderId:42,status:'success'}),()=>assert.fail('not completed'));
  await flush();assert.equal(s.status.value,'');assert.equal(s.issue.value,'offline');fail=false;await s.refresh();assert.equal(s.status.value,'PENDING');f.dispose();
});
function bridgeFixture(bridge) {
  const doc=new EventTarget();const timers=new Map();let id=0;const host={WeixinJSBridge:bridge,setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  return {doc,host,timers,invoke:execute('payments/wechat.ts').s.invokeWechat};
}
test('JSAPI ready listeners invoke once, cancel is not success, cleanup after result',async()=>{
  let calls=0,callback;const f=bridgeFixture();const signal=new AbortController();const promise=f.invoke({paySign:'fixture'},signal.signal,f.host,f.doc);
  f.host.WeixinJSBridge={invoke:(name,p,cb)=>{assert.equal(name,'getBrandWCPayRequest');calls++;callback=cb;}};
  f.doc.dispatchEvent(new Event('WeixinJSBridgeReady'));f.doc.dispatchEvent(new Event('onWeixinJSBridgeReady'));assert.equal(calls,1);
  callback({err_msg:'get_brand_wcpay_request:cancel'});assert.equal(await promise,'cancel');assert.equal(f.timers.size,0);f.doc.dispatchEvent(new Event('WeixinJSBridgeReady'));assert.equal(calls,1);
});
test('JSAPI abort removes listeners, empty callback is failure, timeout settles',async()=>{
  const f=bridgeFixture();const c=new AbortController();const promise=f.invoke({},c.signal,f.host,f.doc);c.abort();await assert.rejects(promise,/关闭/);assert.equal(f.timers.size,0);
  const g=bridgeFixture({invoke:(n,p,cb)=>cb({})});await assert.rejects(g.invoke({},new AbortController().signal,g.host,g.doc),/未完成/);
  const h=bridgeFixture();const timed=h.invoke({},new AbortController().signal,h.host,h.doc);[...h.timers.values()][0]();await assert.rejects(timed,/超时/);assert.equal(h.timers.size,0);
});
function provider(extra={}) {
  const host=new EventTarget();Object.assign(host,{location:{origin:'https://site.test',assign:()=>{}},open:()=>null});
  let destroyed=0;const handlers={};const element={on:(n,cb)=>handlers[n]=cb,mount:()=>{},destroy:()=>destroyed++};
  const sdk={elements:()=>({create:()=>element}),confirmPayment:async()=>({paymentIntent:{status:'succeeded'}}),confirmAlipayPayment:async()=>({}),confirmWechatPayPayment:async()=>({paymentIntent:{status:'succeeded'}})};
  const props=vue.reactive({order:order(),publishableKey:'pk_fixture'});
  const f=execute('payments/ProviderPayment.vue',{...flow,invokeWechat:async()=> 'ok',defineProps:()=>props,paymentAPI:{getConfig:async()=>({data:{stripe_publishable_key:'pk_fixture'}})},window:host,document:{documentElement:{classList:{contains:()=>false}}},navigator:{userAgent:'fixture'},__stripe:async()=>({loadStripe:async()=>sdk}),...extra});
  f.s.mountPoint.value={};return {...f,props,sdk,host,handlers,destroyed:()=>destroyed};
}
test('Stripe mounts lazily, destroys elements; SDK succeeded only requests backend refresh',async()=>{
  const f=provider();await flush();f.handlers.ready();await f.s.pay();assert.deepEqual(f.events,[['submitted']]);assert.equal(f.s.busy.value,false);f.dispose();assert.equal(f.destroyed(),1);
});
test('Stripe confirmation prevents duplicate submissions and ignores late result after close',async()=>{
  const pending=defer();const f=provider();await flush();f.handlers.ready();let calls=0;f.sdk.confirmPayment=()=>{calls++;return pending.promise;};const p=f.s.pay();await f.s.pay();assert.equal(calls,1);f.dispose();pending.resolve({});await p;assert.equal(f.events.length,0);
});
test('popup handshake rejects wrong origin/window; sends secret only to expected popup',async()=>{
  const f=provider();await flush();f.props.order=order({payment_type:'alipay'});await vue.nextTick();await flush();
  const sent=[];const child={postMessage:(...args)=>sent.push(args)};f.host.open=()=>child;f.s.openPopup();
  const dispatch=(origin,source)=>f.host.dispatchEvent(Object.assign(new Event('message'),{origin,source,data:{type:'STRIPE_POPUP_READY'}}));
  dispatch('https://evil.test',child);dispatch('https://site.test',{});await flush();assert.equal(sent.length,0);
  dispatch('https://site.test',child);await flush();assert.equal(sent.length,1);assert.equal(sent[0][1],'https://site.test');f.dispose();assert.equal(f.timers.size,0);
});
test('blocked popup exposes current-page recovery without claiming paid',async()=>{
  const f=provider();await flush();f.s.openPopup();assert.match(f.s.issue.value,/当前页面继续/);assert.equal(f.events.length,0);f.dispose();
});
test('Airwallex uses exact init and redirect fields and checks liveness after loading',async()=>{
  const calls=[];const f=provider({defineProps:()=>({order:order({payment_type:'airwallex',intent_id:'intent',currency:'NZD',country_code:'NZ',payment_env:'prod'})}),__airwallex:async()=>({init:async p=>{calls.push(p);return {payments:{redirectToCheckout:async p=>{calls.push(p);return '';}}};}})});
  await flush();await f.s.pay();assert.equal(calls[0].env,'prod');assert.equal(calls[1].intent_id,'intent');assert.equal(calls[1].currency,'NZD');assert.match(calls[1].successUrl,/payment\/result\?order_id=42/);assert.deepEqual(f.events,[['submitted']]);f.dispose();
});

function checkout(props = vue.reactive({order:order({client_secret:undefined,qr_code:'fixture'})}), extra={}) {
  const state={status:vue.ref('PENDING'),issue:vue.ref(''),busy:vue.ref(false),refresh:async()=>{}};let paid;
  const f=execute('CheckoutSheet.vue',{...flow,defineProps:()=>props,QRCode:{toDataURL:async data=>'data:'+data},navigator:{userAgent:'fixture'},localStorage:storage(),usePaymentStatus:(context,cb)=>{paid=cb;return state;},paymentAPI:{cancelOrder:async()=>{}},...extra});
  return {...f,props,state,paid:()=>paid()};
}
test('checkout hides payment for unknown/paid/terminal/expired states but retains final lookup',async()=>{
  const f=checkout();await flush();assert.equal(f.s.canPay.value,true);
  for(const status of ['', 'PAID','RECHARGING','COMPLETED','CANCELLED','EXPIRED','FAILED','REFUNDED']) {f.state.status.value=status;assert.equal(f.s.canPay.value,false,status);}
  f.state.status.value='PENDING';f.props.order=order({expires_at:new Date(Date.now()-1000).toISOString()});await vue.nextTick();assert.equal(f.s.canPay.value,false);assert.ok(f.s.lookup.value);f.dispose();assert.equal(f.timers.size,0);
});
test('checkout QR response after switching order is discarded; cancellation cannot double submit',async()=>{
  const qr=defer(),cancel=defer();let calls=0;const f=checkout(undefined,{QRCode:{toDataURL:async code=>code==='fixture'?qr.promise:'new-image'},paymentAPI:{cancelOrder:()=>{calls++;return cancel.promise;}}});
  f.props.order=order({order_id:43,client_secret:undefined,qr_code:'new'});await vue.nextTick();await flush();qr.resolve('old-image');await flush();assert.equal(f.s.qr.value,'new-image');
  const p=f.s.cancel();await f.s.cancel();assert.equal(calls,1);cancel.resolve();await p;f.dispose();
});
test('Alipay app deep link is encoded and gated by backend flag, provider and mobile surface',()=>{
  const o=order({payment_type:'alipay',qr_code:'https://qr.test/?a=1&b=2',alipay_mobile_precreate_deep_link:true});
  assert.equal(flow.alipayDeepLink(o),'alipays://platformapi/startapp?saId=10000007&qrcode=https%3A%2F%2Fqr.test%2F%3Fa%3D1%26b%3D2');
  assert.equal(flow.alipayDeepLink({...o,alipay_mobile_precreate_deep_link:false}),'');assert.equal(flow.alipayDeepLink({...o,payment_type:'wxpay'}),'');
});
function landing(href, extra={}) {
  const host=new EventTarget();Object.assign(host,{location:{href,origin:'https://site.test',assign:()=>{}},history:{replaceState:()=>{}},opener:null});
  const state={status:vue.ref(''),issue:vue.ref(''),busy:vue.ref(false),refresh:async()=>{}};
  const f=execute('payments/PaymentRoute.vue',{...flow,window:host,navigator:{userAgent:'fixture'},localStorage:storage(),useAuthStore:()=>({user:{id:7},token:'fixture'}),usePaymentStatus:()=>state,paymentAPI:{getOrder:async id=>({data:{id,amount:10,pay_amount:10,fee_rate:0,status:'PENDING',expires_at:order().expires_at,payment_type:'stripe',out_trade_no:'trade'}})},...extra});
  return {...f,host,state};
}
test('result route never creates order or believes status=success/error query parameters',async()=>{
  let calls=0;const f=landing('https://site.test/payment/result?order_id=42&status=success&error=forged',{paymentAPI:{createOrder:async()=>{calls++;}}});await f.s.initialize();assert.equal(f.s.lookup.value.orderId,42);assert.equal(f.state.status.value,'');assert.equal(f.s.error.value,'');assert.equal(calls,0);assert.equal(f.events.length,0);f.dispose();
});
test('WeChat return creates only after click, signed token payload preserved, repeat click fenced',async()=>{
  let calls=0,payload;const pending=defer();const f=landing('https://site.test/auth/wechat/payment/callback#wechat_resume_token=signed',{paymentAPI:{createOrder:p=>{calls++;payload=p;return pending.promise;}}});
  await f.s.initialize();assert.equal(calls,0);const p=f.s.resume();await f.s.resume();assert.equal(calls,1);assert.equal(payload.amount,0);assert.equal(payload.wechat_resume_token,'signed');pending.resolve({data:order({payment_type:'wxpay'})});await p;await f.s.resume();assert.equal(calls,1);assert.equal(f.s.resumed.value,true);f.dispose();
});
test('popup landing INIT validates opener and same origin, never displays unverified SDK success',async()=>{
  const ready=[];const f=landing('https://site.test/payment/stripe-popup?order_id=42&method=alipay');const opener={postMessage:(...args)=>ready.push(args)};f.host.opener=opener;await f.s.initialize();assert.equal(ready[0][0].type,'STRIPE_POPUP_READY');
  const dispatch=(origin,source)=>f.host.dispatchEvent(Object.assign(new Event('message'),{origin,source,data:{type:'STRIPE_POPUP_INIT',clientSecret:'fixture',publishableKey:'pk'}}));
  dispatch('https://evil.test',opener);dispatch('https://site.test',{});assert.equal(f.s.order.value,null);dispatch('https://site.test',opener);assert.equal(f.s.order.value.client_secret,'fixture');assert.equal(f.events.length,0);f.dispose();assert.equal(f.timers.size,0);
});
test('route does not accept late order response after unmount; OAuth denied cannot create',async()=>{
  const pending=defer();const f=landing('https://site.test/payment/qrcode?order_id=42&qr=x',{paymentAPI:{getOrder:()=>pending.promise}});const p=f.s.initialize();f.dispose();pending.resolve({data:{id:42}});await p;assert.equal(f.s.order.value,null);
  const denied=landing('https://site.test/auth/wechat/payment/callback#error=access_denied');await denied.s.initialize();assert.match(denied.s.error.value,/access_denied/);assert.equal(denied.s.request.value,undefined);denied.dispose();
});
test('payment API keeps official endpoints and sends abort signal outside JSON payload',async()=>{
  const calls=[];const f=execute('../../api/payment.ts',{buildApiUrl:p=>p,axios:{post:async(...args)=>{calls.push(['POST',...args]);return {data:{code:0,data:{status:'PENDING'}}};}},apiClient:{get:async(...args)=>calls.push(['GET',...args]),post:async(...args)=>calls.push(['POST',...args])}});const signal=new AbortController().signal;
  await f.s.paymentAPI.getOrder(42,signal);await f.s.paymentAPI.verifyOrder('trade',signal);await f.s.paymentAPI.verifyOrderPublic('trade',signal);await f.s.paymentAPI.resolveOrderPublicByResumeToken('signed',signal);
  assert.equal(calls[0][1],'/payment/orders/42');assert.equal(calls[1][1],'/payment/orders/verify');assert.equal(calls[2][1],'/payment/public/orders/verify');assert.equal(calls[3][1],'/payment/public/orders/resolve');assert.equal(calls[3][2].resume_token,'signed');assert.equal(calls[3][2].signal,undefined);assert.equal(calls[3][3].signal,signal);
});


test('unauthenticated legacy returns skip account endpoints and public errors never clear auth',async()=>{
  const calls=[];const api={getOrder:async()=>assert.fail('auth GET forbidden'),verifyOrder:async()=>assert.fail('auth POST forbidden'),verifyOrderPublic:async()=>{calls.push('public');return {data:{status:'PENDING'}};}};
  const f=statusFixture(api);await f.s.resolvePaymentStatus({authenticated:false,orderId:42,trade:'legacy'},api);assert.deepEqual(calls,['public']);
  let captured;const apiModule=execute('../../api/payment.ts',{buildApiUrl:p=>'https://fixture.test/api/v1'+p,apiClient:{post:()=>assert.fail('public must not use auth client')},axios:{post:async(...args)=>{captured=args;return {data:{code:401,message:'signature expired'}};}}});
  await assert.rejects(apiModule.s.paymentAPI.resolveOrderPublicByResumeToken('expired'),/signature expired/);assert.equal(captured[2].withCredentials,false);assert.equal(captured[2].headers,undefined);
});
test('recovery rejects malformed optional strings and non-finite money',()=>{
  const st=storage();flow.saveRecovery(st,order(),7);const saved=JSON.parse(st.getItem(flow.RECOVERY_KEY));saved.order.pay_url={bad:true};assert.equal(flow.readRecovery(JSON.stringify(saved),{owner:7}),null);
  saved.order.pay_url='https://valid.test';saved.order.pay_amount=null;assert.equal(flow.readRecovery(JSON.stringify(saved),{owner:7}),null);
});
test('late failed status lookup does not overwrite new order state',async()=>{
  const pending=defer();const context=vue.ref({orderId:1});const f=statusFixture({getOrder:id=>id===1?pending.promise:Promise.resolve({data:{status:'PENDING'}})});const s=f.s.usePaymentStatus(()=>context.value,()=>assert.fail());
  context.value={orderId:2};await vue.nextTick();await flush();pending.reject(Error('old failure'));await flush();assert.equal(s.status.value,'PENDING');assert.equal(s.issue.value,'');assert.equal(s.busy.value,false);f.dispose();
});
function wallet(api, extra={}) {
  const auth=vue.reactive({user:{id:7}});
  const f=execute('WalletApp.vue',{...flow,...require('./test-support/user-session.cjs')(auth),defineProps:()=>({}),useAuthStore:()=>auth,useSystemAudio:()=>({}),paymentAPI:api,userAPI:{getProfile:async()=>({id:7})},window:{location:{origin:'https://site.test'}},navigator:{userAgent:'MicroMessenger iPhone'},localStorage:storage(),...extra});
  return {...f,auth};
}
test('wallet creates exactly one typed request, remembers order and passes SDK context',async()=>{
  const pending=defer();let calls=0,payload;const f=wallet({createOrder:p=>{calls++;payload=p;return pending.promise;}});
  f.s.selectedMethod.value='wxpay';const p=f.s.handleCreateRechargeOrder();await f.s.handleCreateRechargeOrder();assert.equal(calls,1);assert.equal(payload.payment_source,'wechat_in_app_resume');assert.equal(payload.return_url,'https://site.test/payment/result');
  pending.resolve({data:order({payment_type:undefined})});await p;assert.equal(f.s.paymentResult.value.payment_type,'wxpay');assert.equal(f.s.recoverableOrder.value.order_id,42);f.dispose();assert.equal(f.timers.size,0);
});
test('wallet discards order creation and profile refresh after account switch',async()=>{
  const pending=defer(),profile=defer();const f=wallet({createOrder:()=>pending.promise},{userAPI:{getProfile:()=>profile.promise}});
  f.s.selectedMethod.value='stripe';const creation=f.s.handleCreateRechargeOrder();const refresh=f.s.paymentCompleted();f.auth.user={id:8};await vue.nextTick();pending.resolve({data:order()});profile.resolve({id:7});await creation;await refresh;assert.equal(f.s.paymentResult.value,null);assert.equal(f.auth.user.id,8);f.dispose();
});

test('JSAPI exact ok resolves but a recovery without signatures cannot launch JSAPI',async()=>{
  const f=bridgeFixture({invoke:(name,payload,cb)=>cb({err_msg:'get_brand_wcpay_request:ok'})});assert.equal(await f.invoke({paySign:'fixture'},new AbortController().signal,f.host,f.doc),'ok');assert.equal(f.timers.size,0);
  assert.equal(flow.paymentKind(order({result_type:'jsapi_ready'})),'unsupported');
});
test('Stripe WeChat exposes SDK QR image and still only asks backend to verify',async()=>{
  const f=provider({defineProps:()=>({order:order({payment_type:'wxpay'}),publishableKey:'pk_fixture'})});await flush();f.sdk.confirmWechatPayPayment=async()=>({paymentIntent:{status:'requires_action',next_action:{wechat_pay_display_qr_code:{image_data_url:'data:image/png;base64,fixture'}}}});
  await f.s.pay();assert.equal(f.s.qr.value,'data:image/png;base64,fixture');assert.deepEqual(f.events,[['submitted']]);f.dispose();
});
test('purchase/payment aliases also route hash OAuth recovery and preserve ordinary desktop purchase',()=>{
  for(const url of ['https://site.test/purchase#wechat_resume_token=signed','https://site.test/payment#openid=legacy&amount=1','https://site.test/purchase/?wechat_resume=1','https://site.test/payment/stripe/']) assert.equal(flow.isPaymentRoute(new URL(url)),true,url);
  for(const url of ['https://site.test/purchase','https://site.test/payment','https://site.test/purchase#ordinary=1']) assert.equal(flow.isPaymentRoute(new URL(url)),false,url);
});
const fallbackLogic=execute('payments/qrFallback.ts').s;
function fallbackSheet(api, props=vue.reactive({show:true,orderId:42,paymentType:'wxpay'})) {
  return {...execute('payments/QrFallbackSheet.vue',{...flow,...fallbackLogic,defineProps:()=>props,paymentAPI:api,window:{location:{origin:'https://site.test'}}}),props};
}
test('QR replacement requires explicit call, canonical context, confirmed cancellation; no token replay',async()=>{
  let calls=[],status='PENDING';const original={id:42,amount:9,order_type:'subscription',plan_id:3};
  const f=fallbackSheet({getOrder:async()=>{calls.push('get');return {data:{...original,status}};},cancelOrder:async()=>{calls.push('cancel');status='CANCELLED';},createOrder:async payload=>{calls.push(payload);return {data:order({qr_code:'wx://new'})};}});
  assert.equal(calls.length,0);await f.s.create();assert.deepEqual(calls.slice(0,3),['get','cancel','get']);const payload=calls[3];assert.equal(payload.amount,9);assert.equal(payload.plan_id,3);assert.equal(payload.is_mobile,false);assert.equal(payload.payment_source,'hosted_redirect');assert.equal(payload.openid,undefined);await f.s.create();assert.equal(calls.length,4);f.dispose();
});
test('QR replacement forbids server PAID race and unknown cancellation result',async()=>{
  let creates=0,cancels=0;let status='PAID';const api={getOrder:async()=>({data:{id:42,amount:9,order_type:'balance',status}}),cancelOrder:async()=>{cancels++;status='PAID';},createOrder:async()=>{creates++;}};
  const f=fallbackSheet(api);await f.s.create();assert.equal(creates,0);assert.equal(cancels,0);assert.match(f.s.issue.value,/已支付/);status='PENDING';await f.s.create();assert.equal(creates,0);assert.equal(cancels,1);assert.match(f.s.issue.value,/尚未确认取消/);f.dispose();
});
test('QR replacement POST failure remains fenced across dismissal/reopen',async()=>{
  let creates=0;const f=fallbackSheet({getOrder:async()=>({data:{id:42,amount:9,order_type:'balance',status:'CANCELLED'}}),createOrder:async()=>{creates++;throw Error('lost response');}});
  await f.s.create();assert.match(f.s.issue.value,/不确定/);f.props.show=false;await vue.nextTick();f.props.show=true;await vue.nextTick();await f.s.create();assert.equal(creates,1);f.dispose();
});
test('Alipay launcher timeout, background return and disposal remove actual listeners',()=>{
  const f=execute('payments/alipayLauncher.ts');const doc=new EventTarget(),host=new EventTarget();doc.hidden=false;const states=[];let returns=0;
  const launcher=f.s.createAlipayLauncher({url:'alipays://fixture',userAgent:'MicroMessenger',doc,host,navigate:()=>{},update:s=>states.push(s),returned:()=>returns++});launcher.launch();assert.equal(states.at(-1),'launching');[...f.timers.values()][0]();assert.equal(states.at(-1),'fallback');
  launcher.launch();host.dispatchEvent(new Event('pagehide'));assert.equal(states.at(-1),'backgrounded');host.dispatchEvent(new Event('pageshow'));assert.equal(returns,1);launcher.dispose();host.dispatchEvent(new Event('pageshow'));assert.equal(returns,1);
});

test('QR cancellation failure and unmount before cancellation response never create a replacement',async()=>{
  let creates=0;const pending=defer();const api={getOrder:async()=>({data:{id:42,amount:9,order_type:'balance',status:'PENDING'}}),cancelOrder:async()=>{throw Error('cancel denied');},createOrder:async()=>{creates++;}};
  const f=fallbackSheet(api);await f.s.create();assert.equal(creates,0);assert.match(f.s.issue.value,/cancel denied/);f.dispose();
  const g=fallbackSheet({...api,cancelOrder:()=>pending.promise});const attempt=g.s.create();await flush();g.dispose();pending.resolve({});await attempt;assert.equal(creates,0);assert.equal(g.events.length,0);
});
test('cross-device non-result page with no auth uses public lookup and does not ask for SDK credentials',async()=>{
  let calls=0;const f=landing('https://site.test/payment/airwallex?resume_token=signed',{useAuthStore:()=>({user:null,token:null}),paymentAPI:{getOrder:async()=>{calls++;}}});
  await f.s.initialize();assert.equal(calls,0);assert.equal(f.s.lookup.value.token,'signed');assert.equal(f.s.lookup.value.authenticated,false);assert.equal(f.s.order.value,null);f.dispose();
});
test('Stripe SDK load failure exposes controlled fallback without confirming or creating',async()=>{
  const f=provider({__stripe:async()=>{throw Error('load unavailable');}});await flush();assert.equal(f.s.ready.value,false);assert.match(f.s.issue.value,/load unavailable/);assert.deepEqual(f.events,[['unavailable']]);f.dispose();
});

test('review: WeChat ambiguous create failure is fenced, explicit 422 rejection is retryable',async()=>{
  for(const status of [503,undefined,422]) {
    let calls=0;const f=landing('https://site.test/auth/wechat/payment/callback#wechat_resume_token=signed',{paymentAPI:{createOrder:async()=>{calls++;throw {status};}}});await f.s.initialize();await f.s.resume();await f.s.resume();assert.equal(calls,status===422?2:1);assert.equal(f.s.creationStarted.value,status!==422);f.dispose();
  }
});
test('review: payment restoration refuses another account recovery client secret',async()=>{
  const st=storage();flow.saveRecovery(st,order({out_trade_no:'trade'}),8);
  const f=landing('https://site.test/payment/stripe?order_id=42',{localStorage:st});await f.s.initialize();assert.equal(f.s.order.value.client_secret,undefined);f.dispose();
});
test('review: account switch clears checkout and fences late callback order creation',async()=>{
  const d=defer(),auth=vue.reactive({user:{id:7},token:'old'});const st=storage();
  const f=landing('https://site.test/auth/wechat/payment/callback#wechat_resume_token=signed',{localStorage:st,useAuthStore:()=>auth,paymentAPI:{createOrder:()=>d.promise}});await f.s.initialize();const p=f.s.resume();auth.user={id:8};auth.token='new';d.resolve({data:order()});await p;assert.equal(f.s.order.value,null);assert.equal(f.s.request.value,undefined);assert.equal(st.getItem(flow.RECOVERY_KEY),null);f.dispose();
});
test('review: account switch fences late landing getOrder even if transport ignores abort',async()=>{
  const d=defer(),auth=vue.reactive({user:{id:7},token:'old'});const f=landing('https://site.test/payment/stripe?order_id=42',{useAuthStore:()=>auth,paymentAPI:{getOrder:()=>d.promise}});const p=f.s.initialize();auth.user={id:8};d.resolve({data:{id:42,amount:1,pay_amount:1}});await p;assert.equal(f.s.order.value,null);f.dispose();
});
