// Run from the repo: npx --yes --package=playwright -c "node scripts/parity-payment-browser.js"
// New headless browser profile + owned ephemeral Vite server. No production backend / SDK requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const os = require('node:os');
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub2-payment-browser-'));
const root = path.resolve(__dirname, '..');
const consoleRoot = path.join(root, 'packages/sub2-console');
const localRequire = createRequire(path.join(consoleRoot, 'package.json'));
function playwright() {
  const candidates = ['playwright', process.env.PLAYWRIGHT_MODULE, ...process.env.PATH.split(path.delimiter).map(p => path.join(p, '..', 'playwright'))].filter(Boolean);
  for (const candidate of candidates) { try { return require(candidate); } catch {} }
  throw Error('Run: npx --yes --package=playwright -c "node scripts/parity-payment-browser.js" (or set PLAYWRIGHT_MODULE).');
}
const output = path.join(root, 'output/playwright/parity-payments');
const checks = [], errors = [], forbidden = [];
let server, browser;
const fixturePlugin = {
  name: 'payment-fixtures-only', enforce: 'pre',
  resolveId(id) {
    if (id === '/__payment_fixture_entry.js') return '\0payment-entry';
    if (id === '@stripe/stripe-js/pure') return '\0payment-stripe';
    if (id === '@airwallex/components-sdk') return '\0payment-airwallex';
    if (id.endsWith('/navigation') || id.endsWith('/payments/navigation.ts')) return '\0payment-navigation';
  },
  load(id) {
    if (id === '\0payment-entry') return `import {createApp} from 'vue'; import {createPinia} from 'pinia';
      import PaymentRoute from '/src/apps/user/payments/PaymentRoute.vue'; import Wallet from '/src/apps/user/WalletApp.vue';
      import {isPaymentRoute} from '/src/apps/user/payments/flow.ts'; import {useAuthStore} from '/src/stores/auth.ts'; import '/src/style.css';
      if(!['/','/fixture/wallet'].includes(location.pathname) && !isPaymentRoute(new URL(location.href))) throw Error('Fixture path not accepted by production payment matcher');
      const app=createApp(['/','/fixture/wallet'].includes(location.pathname)?Wallet:PaymentRoute); const pinia=createPinia();app.use(pinia);
      useAuthStore(pinia).user={id:999,username:'支付夹具',email:'fixture@example.invalid',role:'user',status:'active',balance:0};app.mount('#app');`;
    if (id === '\0payment-stripe') return 'export async function loadStripe(){ window.__fixture.calls.push("stripe-load"); return window.__fixture.stripe; }';
    if (id === '\0payment-airwallex') return 'export async function init(options){window.__fixture.calls.push({airwallexInit:options});return {payments:{redirectToCheckout:async options=>{window.__fixture.calls.push({airwallexCheckout:options});if(window.__fixture.outcome==="fail")throw Error("测试 Airwallex 失败");return options.successUrl;}}};}';
    if (id === '\0payment-navigation') return 'export function navigatePaymentApp(url){window.__fixture.calls.push({appURL:url});if(window.__fixture.appBackground){window.dispatchEvent(new Event("pagehide"));}}';
  },
  transformIndexHtml(html) { return html.replace('/src/main.ts', '/__payment_fixture_entry.js'); },
  configureServer(s) {
    s.middlewares.use((req, res, next) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/v1/')) { forbidden.push('Unmocked local API '+req.url);res.statusCode=500;res.end('API must be intercepted by fixture');return; }
      next();
    });
  },
};
const makeOrder = (id, extra={}) => ({id,user_id:999,amount:12,pay_amount:12,fee_rate:0,currency:'CNY',payment_type:'wxpay',out_trade_no:'fixture-'+id,status:'PENDING',order_type:'balance',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),refund_amount:0,...extra});
async function main() {
  fs.mkdirSync(output,{recursive:true}); process.chdir(consoleRoot);
  const vite=await import(pathToFileURL(localRequire.resolve('vite')).href); const {createServer}=vite.default || vite;
  const vue=(await import(pathToFileURL(localRequire.resolve('@vitejs/plugin-vue')).href)).default;
  server=await createServer({configFile:false,cacheDir,root:consoleRoot,envFile:false,logLevel:'error',plugins:[fixturePlugin,vue()],
    define:{'import.meta.env.VITE_API_BASE_URL':JSON.stringify('/api/v1')},
    resolve:{alias:{'@':path.join(consoleRoot,'src'),'@sub2-mac/core':path.join(root,'packages/mac-ui-core/src/index.ts')}},
    optimizeDeps:{noDiscovery:true,include:['vue','pinia','axios','qrcode'],exclude:['@stripe/stripe-js/pure','@airwallex/components-sdk']},
    server:{watch:null,host:'127.0.0.1',port:0,hmr:false,fs:{allow:[root]}},
  });
  await server.listen();const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  const {chromium}=playwright();
  const chrome=process.env.PLAYWRIGHT_CHROME || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{})});
  async function fixture({mobile=false,provider='stripe',initialFailure=false}={}) {
    const state={orders:new Map([[1,makeOrder(1,{payment_type:provider})]]),writes:[],creates:0,next:2,initialFailure,createOutcome:'qr',cancelFails:false,cancelRace:false,createFails:false};
    const context=await browser.newContext({reducedMotion:'reduce',viewport:mobile?{width:390,height:844}:{width:1440,height:900},userAgent:mobile?'Mozilla/5.0 iPhone Mobile MicroMessenger':'Mozilla/5.0 FixtureDesktop'});
    await context.addInitScript(()=>{
      localStorage.setItem('auth_token','payment-fixture-not-a-real-token');sessionStorage.setItem('sub2_booted','true');
      const f=window.__fixture={calls:[],appBackground:false};
      Object.defineProperty(f,'outcome',{get:()=>sessionStorage.getItem('fixture-sdk-outcome')||'ok',set:value=>sessionStorage.setItem('fixture-sdk-outcome',value),enumerable:true});
      const answer=()=>{f.calls.push('confirm');return f.outcome==='cancel'?{error:{message:'测试支付已取消'}}:f.outcome==='fail'?{error:{message:'测试支付失败'}}:{paymentIntent:{status:'succeeded'}};};
      f.stripe={elements:()=>({create:()=>{
        const handlers={};let input;
        return {on:(name,cb)=>{handlers[name]=cb;},mount:el=>{input=document.createElement('input');input.setAttribute('aria-label','测试银行卡');el.append(input);queueMicrotask(()=>handlers.ready?.());},destroy:()=>{f.calls.push('destroy');input?.remove();}};
      }}),confirmPayment:async()=>answer(),confirmAlipayPayment:async()=>answer(),confirmWechatPayPayment:async()=>answer()};
      window.WeixinJSBridge={invoke:(method,payload,callback)=>{f.calls.push({bridge:method});queueMicrotask(()=>callback({err_msg:'get_brand_wcpay_request:'+(f.outcome==='cancel'?'cancel':f.outcome==='fail'?'fail':'ok')}));}};
    });
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.origin!==origin){forbidden.push(req.url());await route.abort();return;}
      if(!url.pathname.startsWith('/api/')){await route.continue();return;}
      const p=url.pathname.replace('/api/v1',''),body=req.method()==='POST'?req.postDataJSON():null;
      const ok=data=>route.fulfill({json:{code:0,data}});
      if(req.method()!=='GET')state.writes.push({path:p,body});
      if(p==='/payment/config')return ok({stripe_publishable_key:'pk_fixture'});
      if(p==='/settings/public')return ok({payment_enabled:true});
      if(p==='/auth/me'||p==='/user/profile')return ok({id:999,role:'user',email:'fixture@example.invalid',balance:0});
      if(p==='/payment/checkout-info')return ok({methods:{wxpay:{available:true,fee_rate:0}},plans:[],balance_disabled:false,balance_recharge_multiplier:1,stripe_publishable_key:'pk_fixture'});
      if(p==='/payment/orders/my')return ok({items:[...state.orders.values()],total:state.orders.size,page:1,page_size:25});
      if(p==='/payment/orders'&&req.method()==='POST'){
        state.creates++;
        if(state.initialFailure){state.initialFailure=false;return route.fulfill({status:400,json:{code:400,reason:'WECHAT_H5_NOT_AUTHORIZED',message:'测试：移动支付未授权'}});}
        if(state.createFails)return route.fulfill({status:503,json:{code:503,message:'测试：下单响应不确定'}});
        const id=state.next++;const isResume=!!body.wechat_resume_token;
        const o=makeOrder(id,{amount:isResume?12:body.amount,order_type:body.order_type,payment_type:body.payment_type,plan_id:body.plan_id});state.orders.set(id,o);
        return ok({...o,order_id:id,...(isResume?{result_type:'jsapi_ready',jsapi:{appId:'fixture',timeStamp:'1',nonceStr:'fixture',package:'prepay_id=fixture',signType:'RSA',paySign:'fixture'}}:{qr_code:'weixin://fixture-qr/'+id})});
      }
      const cancel=p.match(/^\/payment\/orders\/(\d+)\/cancel$/);
      if(cancel){const o=state.orders.get(Number(cancel[1]));if(state.cancelFails)return route.fulfill({status:409,json:{code:409,message:'测试：取消失败'}});o.status=state.cancelRace?'PAID':'CANCELLED';return ok({});}
      const get=p.match(/^\/payment\/orders\/(\d+)$/);
      if(get)return ok(state.orders.get(Number(get[1])));
      if(p==='/payment/public/orders/resolve')return ok(state.orders.get(1));
      if(p.endsWith('/orders/verify'))return ok([...state.orders.values()].find(o=>o.out_trade_no===body.out_trade_no)||state.orders.get(1));
      forbidden.push('Unexpected API '+req.method()+' '+p);return route.fulfill({status:500,json:{code:500,message:'Unexpected fixture API'}});
    });
    const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
    return {page,context,state,async close(){await context.close();}};
  }
  const sheet=p=>p.getByRole('dialog',{name:'完成支付',exact:true});
  const waitText=async(p,text)=>{await p.getByText(text,{exact:true}).waitFor();};
  const record=name=>{checks.push(name);console.log('PASS '+name);};
  const poll=async(f,status)=>{f.state.orders.get(1).status=status;await sheet(f.page).getByRole('button',{name:'查询支付结果',exact:true}).click();await waitText(f.page,status==='COMPLETED'?'支付已完成':status==='PENDING'?'等待支付':'已收到支付，正在入账');};
  {
    const f=await fixture();await f.page.goto(origin+'/payment/stripe?order_id=1&client_secret=fixture');await f.page.getByLabel('测试银行卡').waitFor();await server.waitForRequestsIdle();await f.page.waitForTimeout(500);
    for(const [mode,text] of [['cancel','测试支付已取消'],['fail','测试支付失败']]){
      await f.page.evaluate(mode=>window.__fixture.outcome=mode,mode);await sheet(f.page).getByRole('button',{name:'继续支付',exact:true}).click();await waitText(f.page,text);assert.equal(f.state.creates,0);assert.equal(await f.page.getByText('支付已完成',{exact:true}).count(),0);record('Stripe '+mode+' stays unpaid; no implicit order');
    }
    await f.page.evaluate(()=>window.__fixture.outcome='ok');await sheet(f.page).getByRole('button',{name:'继续支付',exact:true}).click();await waitText(f.page,'等待支付');assert.equal(await f.page.getByText('支付已完成',{exact:true}).count(),0);record('Stripe SDK success does not assert backend completion');
    await poll(f,'PAID');assert.equal(await f.page.getByLabel('测试银行卡').count(),0);await poll(f,'RECHARGING');await poll(f,'COMPLETED');
    assert.ok((await f.page.evaluate(()=>window.__fixture.calls)).includes('destroy'));await f.page.screenshot({path:path.join(output,'stripe-completed.png')});record('Stripe backend PAID / RECHARGING / COMPLETED, SDK-mounted element removed (fixture is not a real iframe)');await f.close();
  }
  async function wechat(){const f=await fixture({mobile:true,provider:'wxpay'});await f.page.goto(origin+'/auth/wechat/payment/callback#wechat_resume_token=signed-fixture');assert.equal(f.state.creates,0);await f.page.getByRole('button',{name:'继续支付',exact:true}).click();await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).waitFor();return f;}
  {
    const f=await wechat();const id=2;
    for(const [mode,text] of [['cancel','已取消本次微信支付，订单仍可查询或重试'],['fail','微信支付未完成，请重试或返回钱包选择其他支付方式']]){
      await f.page.evaluate(mode=>window.__fixture.outcome=mode,mode);await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).click();await waitText(f.page,text);assert.equal(f.state.creates,1);record('WeChat '+mode+' exposes QR fallback without creating');
    }
    await sheet(f.page).getByRole('button',{name:'改用二维码支付…',exact:true}).click();const dialog=f.page.getByRole('dialog',{name:'改用二维码支付',exact:true});await dialog.waitFor();assert.equal(f.state.creates,1);
    for(let i=0;i<6;i++)await f.page.keyboard.press('Tab');assert.ok(await dialog.evaluate(el=>el.contains(document.activeElement)));await f.page.screenshot({path:path.join(output,'wechat-fallback-confirm-mobile.png')});
    await dialog.getByRole('button',{name:'返回',exact:true}).click();assert.equal(f.state.creates,1);record('QR confirmation dismissal and focus trap never create');
    await sheet(f.page).getByRole('button',{name:'改用二维码支付…',exact:true}).click();await dialog.getByRole('button',{name:'取消原订单并新建',exact:true}).click();await sheet(f.page).getByRole('img',{name:'订单支付二维码',exact:true}).waitFor();
    assert.equal(f.state.creates,2);assert.equal(f.state.orders.get(id).status,'CANCELLED');const newRequest=f.state.writes.filter(w=>w.path==='/payment/orders').at(-1).body;
    assert.equal(newRequest.is_mobile,false);assert.equal(newRequest.payment_source,'hosted_redirect');assert.equal(newRequest.openid,undefined);assert.equal(newRequest.wechat_resume_token,undefined);assert.equal(newRequest.amount,12);record('Explicit QR replacement cancels old order and submits desktop allowlisted payload once');
    f.state.orders.get(3).status='COMPLETED';await sheet(f.page).getByRole('button',{name:'查询支付结果',exact:true}).click();await waitText(f.page,'支付已完成');assert.equal(await sheet(f.page).getByRole('img').count(),0);await f.page.screenshot({path:path.join(output,'wechat-qr-completed-mobile.png')});record('Replacement QR confirms backend completion and removes payment controls');await f.close();
  }
  {
    const f=await wechat();await f.page.evaluate(()=>window.__fixture.outcome='fail');await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).click();await sheet(f.page).getByRole('button',{name:'改用二维码支付…',exact:true}).click();
    f.state.orders.get(2).status='PAID';await f.page.getByRole('dialog',{name:'改用二维码支付',exact:true}).getByRole('button',{name:'取消原订单并新建',exact:true}).click();await waitText(f.page,'原订单已支付或正在处理，不会新建订单，请查询原订单结果');assert.equal(f.state.creates,1);assert.equal(f.state.writes.filter(w=>w.path.endsWith('/cancel')).length,0);record('Server PAID race prevents both cancellation and replacement');await f.close();
  }
  {
    const f=await wechat();await f.page.evaluate(()=>window.__fixture.outcome='fail');await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).click();await sheet(f.page).getByRole('button',{name:'改用二维码支付…',exact:true}).click();f.state.createFails=true;
    const dialog=f.page.getByRole('dialog',{name:'改用二维码支付',exact:true});await dialog.getByRole('button',{name:'取消原订单并新建',exact:true}).click();await waitText(f.page,'新订单提交结果不确定，为避免重复下单已停止重试，请返回钱包订单记录查询');assert.equal(f.state.creates,2);assert.equal(await dialog.getByRole('button',{name:'取消原订单并新建',exact:true}).isDisabled(),true);record('Ambiguous new-order failure disables blind repeat POST');await f.close();
  }
  {
    const f=await fixture({mobile:true,provider:'alipay'});await f.page.addInitScript(o=>localStorage.setItem('sub2-mac.payment.recovery.v1',JSON.stringify({owner:999,savedAt:Date.now(),order:{...o,order_id:o.id,qr_code:'https://fixture.invalid/qr',alipay_mobile_precreate_deep_link:true}})),f.state.orders.get(1));
    await f.page.goto(origin+'/payment/qrcode?order_id=1');await sheet(f.page).getByRole('button',{name:'打开支付宝 App',exact:true}).click();await waitText(f.page,'未能打开支付宝，请使用上方二维码，或在系统浏览器中打开本页。');assert.equal(f.state.creates,0);assert.ok((await f.page.evaluate(()=>window.__fixture.calls)).some(c=>c.appURL?.startsWith('alipays://')));record('Alipay controlled app launch timeout falls back to same QR, no new order');
    await f.page.evaluate(()=>window.__fixture.appBackground=true);await sheet(f.page).getByRole('button',{name:'打开支付宝 App',exact:true}).click();await waitText(f.page,'已切换支付应用，返回后将查询订单结果。');f.state.orders.get(1).status='COMPLETED';await f.page.evaluate(()=>window.dispatchEvent(new Event('pageshow')));await waitText(f.page,'支付已完成');await f.page.screenshot({path:path.join(output,'alipay-return-completed.png')});record('Alipay pagehide/pageshow return verifies backend, not app switch');await f.close();
  }
  {
    const f=await fixture({provider:'airwallex'});await f.page.addInitScript(o=>localStorage.setItem('sub2-mac.payment.recovery.v1',JSON.stringify({owner:999,savedAt:Date.now(),order:{...o,order_id:o.id,client_secret:'fixture',intent_id:'fixture',country_code:'CN',payment_env:'demo'}})),f.state.orders.get(1));
    await f.page.goto(origin+'/payment/airwallex?order_id=1');await f.page.evaluate(()=>window.__fixture.outcome='fail');await sheet(f.page).getByRole('button',{name:'继续支付',exact:true}).click();await waitText(f.page,'测试 Airwallex 失败');assert.equal(f.state.creates,0);record('Airwallex SDK failure remains retryable and unpaid');
    await f.page.evaluate(()=>window.__fixture.outcome='ok');await sheet(f.page).getByRole('button',{name:'继续支付',exact:true}).click();await f.page.waitForURL('**/payment/result?**');await waitText(f.page,'等待支付');f.state.orders.get(1).status='RECHARGING';await f.page.getByRole('button',{name:'重新查询',exact:true}).click();await waitText(f.page,'已收到支付，正在入账');f.state.orders.get(1).status='COMPLETED';await f.page.getByRole('button',{name:'重新查询',exact:true}).click();await waitText(f.page,'支付已完成');record('Airwallex controlled redirect lands in result; server controls completion');await f.close();
  }
  {
    const f=await fixture({mobile:true,provider:'wxpay',initialFailure:true});await f.page.goto(origin+'/fixture/wallet');await f.page.getByRole('button',{name:/创建订单/}).click();await f.page.getByRole('button',{name:'改用二维码支付…',exact:true}).click();assert.equal(f.state.creates,1);
    const dialog=f.page.getByRole('dialog',{name:'改用二维码支付',exact:true});await dialog.getByRole('button',{name:'新建二维码订单',exact:true}).click();await sheet(f.page).getByRole('img',{name:'订单支付二维码',exact:true}).waitFor();assert.equal(f.state.creates,2);assert.equal(f.state.writes.at(-1).body.is_mobile,false);record('Wallet known mobile gateway failure requires separate explicit QR creation');await f.close();
  }
  {
    const f=await fixture({provider:'airwallex'});await f.page.goto(origin+'/payment/airwallex?order_id=1');
    await waitText(f.page,'付款信息无法恢复，请在订单记录查看或取消后重新下单。');assert.equal(f.state.creates,0);assert.equal(await sheet(f.page).getByRole('button',{name:'继续支付',exact:true}).count(),0);
    await poll(f,'COMPLETED');record('Cross-device Airwallex without secret remains queryable; never invents credentials or launches SDK');await f.close();
  }
  {
    const f=await fixture();await f.page.addInitScript(()=>localStorage.clear());await f.page.goto(origin+'/payment/result?resume_token=signed-fixture&status=success');await waitText(f.page,'等待支付');
    f.state.orders.get(1).status='COMPLETED';await f.page.getByRole('button',{name:'重新查询',exact:true}).click();await waitText(f.page,'支付已完成');record('Cross-device signed public result works without account storage; query success flag ignored');await f.close();
  }
  {
    const f=await wechat();await f.page.evaluate(()=>window.WeixinJSBridge=undefined);await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).click();
    await sheet(f.page).getByRole('button',{name:'返回',exact:true}).click();await f.page.waitForURL(origin+'/');assert.equal(f.state.creates,1);record('Closing checkout aborts pending JSAPI without new order');await f.close();
  }
  {
    const f=await wechat();await f.page.clock.install();await f.page.evaluate(()=>window.WeixinJSBridge=undefined);await sheet(f.page).getByRole('button',{name:'打开微信支付',exact:true}).click();await f.page.clock.fastForward(61000);
    await waitText(f.page,'微信支付响应超时，请查询订单后再重试');assert.equal(f.state.creates,1);await sheet(f.page).getByRole('button',{name:'改用二维码支付…',exact:true}).waitFor();record('Real component JSAPI timeout exposes explicit fallback and does not create');await f.close();
  }
  {
    const f=await fixture({mobile:true});await f.page.goto(origin+'/payment/stripe?order_id=1&client_secret=fixture');await f.page.getByLabel('测试银行卡').waitFor();await server.waitForRequestsIdle();await f.page.waitForTimeout(500);
    await f.page.evaluate(()=>document.documentElement.classList.add('dark'));assert.ok(await sheet(f.page).evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight;}));
    await f.page.screenshot({path:path.join(output,'stripe-dark-mobile.png')});record('Dark 390px payment Sheet stays inside viewport');await f.close();
  }
  {
    const f=await fixture({provider:'airwallex'});await f.page.addInitScript(()=>localStorage.clear());await f.page.goto(origin+'/payment/airwallex?resume_token=signed-fixture');await waitText(f.page,'等待支付');
    assert.equal(await f.page.getByRole('dialog',{name:'完成支付',exact:true}).count(),0);assert.equal(f.state.creates,0);assert.equal((await f.page.evaluate(()=>window.__fixture.calls)).length,0);record('Unauthenticated provider return with resume token falls back to public result without SDK');await f.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(forbidden,[]);record('No page errors, external requests, unmocked APIs or real payment execution');
}
(async()=>{let failure;try{await main();}catch(error){failure=error;console.error(error);for(const c of browser?.contexts()||[])for(const p of c.pages()){try{await p.screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure-debug.json'),JSON.stringify({url:p.url(),body:await p.locator('body').innerText(),sdk:await p.evaluate(()=>window.__fixture)},null,2));}catch{}}}finally{await browser?.close();await server?.close();fs.rmSync(cacheDir,{recursive:true,force:true});fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:!failure,checks,pageErrors:errors,forbidden,fixtureOnly:true,failure:failure?.stack},null,2));}if(failure)process.exitCode=1;})();








