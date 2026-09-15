const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),sourceRoot=path.join(root,'packages/sub2-console/src'),req=createRequire(path.join(root,'packages/sub2-console/package.json')),compiler=req('vue/compiler-sfc');
function findPlaywright() {
  if (process.env.PARITY_PUBLIC_PLAYWRIGHT) return require(process.env.PARITY_PUBLIC_PLAYWRIGHT);
  try { return req('playwright'); } catch {}
  try { return req('playwright-core'); } catch {}
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) {
    const target = fs.readFileSync(path.join(links, file), 'utf8').trim();
    if (fs.existsSync(target)) return require(target);
  }
  throw Error('Set PARITY_PUBLIC_PLAYWRIGHT to an installed playwright/core package. No dependencies are installed by this test.');
}
async function browserBundle() {
  const esbuild = createRequire(req.resolve('vite'))('esbuild');
  const { outputFiles } = await esbuild.build({ bundle: true, write: false, format: 'iife', platform: 'browser',
    absWorkingDir: path.join(root, 'packages/sub2-console'),
    define: { 'import.meta.env.VITE_API_BASE_URL': '"/api/v1"', 'import.meta.env.DEV': 'false', 'import.meta.env.VITE_WS_BASE_URL': 'undefined', '__VUE_OPTIONS_API__': 'true', '__VUE_PROD_DEVTOOLS__': 'false', '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false' },
    stdin: { resolveDir: sourceRoot, contents: `import {createApp,reactive,h} from 'vue';
      import Users from './apps/admin/UsersApp.vue'; import SafeContent from './public/SafeContent.vue'; import ModelPricingSheet from './apps/user/ModelPricingSheet.vue'; import Monitor from './public/MonitorV2.vue'; import Usage from './apps/admin/AdminUsageApp.vue'; import './public/public.css'; import './style.css';
      window.__auth=reactive({token:'fixture',user:{id:1},isAuthenticated:true,isAdmin:true});
      window.__pricing=reactive({model:{name:'复用对比模型',platform:'openai',pricing:{billing_mode:'token',input_price:0.000001,output_price:0.000002,intervals:[]},official_pricing:{input_price:0.000004,output_price:0.000008}},group:{id:1,name:'复用夹具组',rate_multiplier:2,user_rate_multiplier:0.5,subscription_type:'standard',models:[],is_exclusive:false,peak_rate_enabled:false,image_rate_independent:false,image_rate_multiplier:1}});
      window.__doc=reactive({content:['# 文档标题',('第一段文字。'.repeat(100)),'## 重复标题',('第二段文字。'.repeat(100)),'## 重复标题',('第三段文字。'.repeat(100))].join(String.fromCharCode(10)),tools:true});
      window.__screen=reactive({name:location.pathname==='/monitor'?'monitor':'usage'});
      localStorage.setItem('auth_token','fixture');
      createApp({setup:()=>()=>window.__screen.name==='users'?h(Users):window.__screen.name==='pricing'?h(ModelPricingSheet,{...window.__pricing,onClose:()=>window.__screen.name='usage'}):window.__screen.name==='docs'?h('div',{class:'public-surface',style:'height:100%;overflow:auto'},h(SafeContent,window.__doc)):window.__screen.name==='monitor'?h('div',{class:'public-surface'},h('div',{class:'public-body'},h(Monitor,{settings:{channel_monitor_enabled:true,channel_monitor_mode:'v2'}}))):h(Usage)}).mount('#app');` },
    plugins: [{ name: 'isolated-vue-public', setup(build) {
      build.onResolve({ filter: /^@sub2-mac\/core$/ }, () => ({ path: 'core', namespace: 'public-fixture' }));
      build.onResolve({ filter: /\.md\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'public-markdown' }));
      build.onLoad({ filter: /.*/, namespace: 'public-markdown' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
      build.onLoad({ filter: /.*/, namespace: 'public-fixture' }, () => ({ resolveDir: sourceRoot, contents: `export {default as MacToggle} from '../../mac-ui-core/src/components/MacToggle.vue'; export {default as MacAlertSheet} from '../../mac-ui-core/src/components/MacAlertSheet.vue'; export {default as MacButton} from '../../mac-ui-core/src/components/MacButton.vue'; export {default as MacSheet} from '../../mac-ui-core/src/components/MacSheet.vue'; export {useWindowManager} from '../../mac-ui-core/src/composables/useWindowManager';` }));
      build.onResolve({ filter: /^@\// }, args => ({ path: path.join(sourceRoot, args.path.slice(2) + (path.extname(args.path) ? '' : '.ts')) }));
      build.onLoad({ filter: /[\\/]stores[\\/]auth\.ts$/ }, () => ({ contents: 'export const useAuthStore = () => window.__auth;', loader: 'js' }));
      build.onLoad({ filter: /\.vue$/ }, args => {
        const { descriptor } = compiler.parse(fs.readFileSync(args.path, 'utf8'), { filename: args.path });
        const id = 'p' + Buffer.from(args.path).toString('hex').slice(-24);
        const script = compiler.compileScript(descriptor, { id, inlineTemplate: true, genDefaultAs: '__component' });
        let contents = script.content + `\n__component.__scopeId = 'data-v-${id}'; export default __component;`;
        for (const style of descriptor.styles) {
          const css = compiler.compileStyle({ source: style.src ? fs.readFileSync(path.resolve(path.dirname(args.path),style.src),'utf8') : style.content, filename: args.path, id: 'data-v-' + id, scoped: style.scoped }).code;
          contents += `\n{ const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); }`;
        }
        return { contents, loader: 'ts', resolveDir: path.dirname(args.path) };
      });
      build.onLoad({ filter: /\.css$/ }, args => ({ contents: `{ const s=document.createElement('style'); s.textContent=${JSON.stringify(fs.readFileSync(args.path, 'utf8'))}; document.head.appendChild(s); }`, loader: 'js' }));
    } }],
  });
  return outputFiles[0].text;
}
const monitorMetric = () => ({ request_count: 10, error_rate: 0.1, cache_rate: 0.2, rpm: 1, tpm: 60, ttft: { sample_count: 5, p50_ms: 100, p90_ms: 200, p95_ms: 240, avg_ms: 110 } });
const monitorHealth = () => ({ overall: 'healthy', error_rate: 'warning', ttft: 'healthy', cache: 'warning', score: 90, error_rate_score: 80, ttft_score: 95, cache_score: 70, minimum_sample: 5 });
const monitorCoverage = () => ({ requested_start: '2026-09-11T00:00:00Z', requested_end: '2026-09-11T03:00:00Z', data_through: '2026-09-11T00:02:00Z', bucket_seconds: 60, coverage_complete: false, aggregation_lag_seconds: 2 });
const monitorSnapshot = () => ({ config: { refresh_interval_seconds: 60 }, coverage: monitorCoverage(), metrics: monitorMetric(), health: monitorHealth(), trend: [{ bucket_start: '2026-09-11T00:00:00Z', metrics: monitorMetric(), health: monitorHealth() }] });
const monitorMatrix = () => ({ coverage: monitorCoverage(), group_by: 'platform_group', items: [{ platform: 'openai', group_id: 1, group_name: '监控夹具组', metrics: monitorMetric(), health: monitorHealth(), buckets: [{ bucket_start: '2026-09-11T00:00:00Z', metrics: monitorMetric(), health: monitorHealth() }] }] });

(async()=>{
 const out=path.join(root,'output/release-features');fs.mkdirSync(out,{recursive:true});
 const bundle=await browserBundle(),{chromium}=findPlaywright(),browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),calls=[],errors=[],checks=[];
 let balanceFail=false;
 page.on('pageerror',e=>errors.push(e.message));
 const metric={requests:10,total_tokens:42,cost:2,actual_cost:0};
 await page.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());
  if(u.origin!=='http://features.invalid')throw Error('Unexpected origin '+u.origin);
  if(['/monitor','/usage'].includes(u.pathname))return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:13px system-ui;background:#f5f5f7;color:#242428;--bg-surface:#fff;--window-bg-solid:#f5f5f7;--text-primary:#242428;--text-secondary:#666;--border-subtle:#8883;--accent:#007aff}body.dark{background:#222;color:#eee;--bg-surface:#292929;--window-bg-solid:#222;--text-primary:#eee;--text-secondary:#bbb}#app{position:relative;height:100vh;container-type:inline-size;container-name:app-window}.flex{display:flex}.flex-col{flex-direction:column}.h-full{height:100%}.gap-2{gap:8px}.gap-3{gap:12px}.px-4{padding-inline:16px}.py-2{padding-block:8px}h1,h2,h3,p{margin:0}ul{list-style:none;padding:0}</style><div id="app"></div><script src="/fixture.js"></script>`});
  if(u.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:bundle});
  if(u.pathname.startsWith('/assets/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"/>'});
  calls.push({path:u.pathname,query:u.search,method:r.method()});if(r.method()!=='GET')throw Error('Writes forbidden');
  const json=data=>route.fulfill({json:{code:0,data}});
  if(u.pathname.includes('channel-monitor-v2')){const name=u.pathname.split('/').at(-1);return json(name==='dimensions'?{platforms:[{value:'openai',label:'OpenAI'}],groups:[{id:1,name:'监控夹具组',platform:'openai'}],models:[]}:name==='snapshot'?monitorSnapshot():name==='matrix'?monitorMatrix():{items:[]});}
  if(/^\/api\/v1\/admin\/users\/\d+$/.test(u.pathname))return json({id:Number(u.pathname.split('/').at(-1)),email:'overview@example.test',username:'概况用户',balance:12.5,created_at:'2026-09-01T00:00:00Z',notes:'用户概况备注'});
  if(u.pathname.endsWith('/balance-history')){if(balanceFail)return route.fulfill({status:403,json:{code:403,message:'管理员权限不足'}});return json({items:[{id:1,type:u.searchParams.get('type')||'admin_balance',value:-2,created_at:'2026-09-13T00:00:00Z',notes:'夹具调整',validity_days:30}],total:31,total_recharged:20});}
  if(u.pathname==='/api/v1/admin/users')return json({items:[{id:8,email:'zero-usage@example.test',username:'zero',role:'user',balance:12.5,concurrency:1,status:'active',created_at:'2026-09-01T00:00:00Z'}],total:1});
  if(['/api/v1/admin/groups/all','/api/v1/admin/user-attributes'].includes(u.pathname))return json([]);
  if(u.pathname==='/api/v1/admin/usage')return json({items:[{id:1,user_id:8,model:'fixture',created_at:'2026-09-13T00:00:00Z',input_tokens:10,output_tokens:20,actual_cost:0}],total:1});
  if(u.pathname.endsWith('/usage/stats'))return json({total_requests:10,total_tokens:42,total_actual_cost:0,total_account_cost:1,endpoints:[{endpoint:'/inbound',...metric}],upstream_endpoints:[{endpoint:'/upstream',...metric}],endpoint_paths:[{endpoint:'/path',...metric}]});
  if(u.pathname.endsWith('/dashboard/groups'))return json({groups:[{group_id:7,group_name:'分组夹具',...metric}]});
  if(u.pathname.endsWith('/snapshot-v2'))return json({trend:[]});
  if(u.pathname.endsWith('/dashboard/models'))return json({models:[{model:'模型下钻夹具',...metric}]});
  if(u.pathname.endsWith('/user-breakdown'))return json({users:[]});
  throw Error('Unexpected request '+u.pathname);
 });
 try{
  await page.goto('http://features.invalid/monitor?range=7d&platform=openai&group=1&health_mode=ttft&group_by=platform_group&tab=errors');
  await page.locator('.monitor-pulse').waitFor();assert.equal(await page.getByLabel('时间范围',{exact:true}).inputValue(),'7d');assert.equal(await page.getByLabel('健康维度').inputValue(),'ttft');checks.push('official query initial restore');
  await page.getByLabel('健康维度').selectOption('cache');await page.waitForURL(/health_mode=cache/);await page.reload();assert.equal(await page.getByLabel('健康维度').inputValue(),'cache');checks.push('URL write and reload');
  await page.locator('.monitor-pulse').hover();await page.mouse.wheel(0,-120);await page.waitForFunction(()=>document.querySelector('.monitor-pulse').children.length===30);checks.push('real wheel zoom 60 to 30');
  await page.evaluate(()=>{history.pushState(null,'','?range=24h&health_mode=success&tab=models');dispatchEvent(new PopStateEvent('popstate'));});await page.waitForFunction(()=>document.querySelector('.public-form select').value==='24h');checks.push('popstate restore');
  await page.screenshot({path:path.join(out,'monitor-light.png')});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'monitor-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('monitor mobile width');
  await page.setViewportSize({width:1440,height:900});await page.goto('http://features.invalid/usage');await page.getByText('分组夹具',{exact:true}).waitFor();await page.getByText('/inbound',{exact:true}).waitFor();
  await page.getByLabel('端点来源').selectOption('upstream_endpoints');await page.getByText('/upstream',{exact:true}).waitFor();await page.getByLabel('端点来源').selectOption('endpoint_paths');await page.getByText('/path',{exact:true}).waitFor();checks.push('group and three endpoint distributions');await page.getByRole('button',{name:'模型下钻夹具',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('暂无用户记录',{exact:true}).waitFor();assert(calls.some(c=>c.path.endsWith('user-breakdown')&&c.query.includes('model_source=requested')));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('model user breakdown');
  await page.getByRole('button',{name:'/path',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByText('暂无用户记录',{exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('endpoint user breakdown');await page.screenshot({path:path.join(out,'usage-light.png')});
  await page.getByRole('button',{name:'查看用户 8 余额历史'}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByText('-$2.000000',{exact:true}).waitFor();await dialog.getByText('用户概况备注',{exact:true}).waitFor();await dialog.getByText('$12.500000',{exact:true}).waitFor();assert.equal(await dialog.getByRole('link',{name:'打开操作审计'}).getAttribute('href'),'/admin/audit-logs');checks.push('profile real fields and audit link');await dialog.getByRole('button',{name:'下一页'}).click();await page.waitForFunction(()=>document.querySelector('[role=dialog]').textContent.includes('2 / 3'));checks.push('balance open and page 2');
  await dialog.getByLabel('记录类型').selectOption('subscription');await dialog.getByText('30 天',{exact:true}).waitFor();assert(calls.some(c=>c.path.endsWith('balance-history')&&c.query.includes('type=subscription')&&c.query.includes('page=1')));checks.push('type filter resets page and units');
  balanceFail=true;await dialog.getByRole('button',{name:'刷新历史'}).click();await dialog.getByRole('alert').waitFor();balanceFail=false;await dialog.getByRole('button',{name:'刷新历史'}).click();await dialog.getByText('30 天',{exact:true}).waitFor();checks.push('403 visible and retry');
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('[role=dialog]')));await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});checks.push('Tab inside sheet and Escape close');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'收起图表'}).click();await page.getByRole('button',{name:'查看用户 8 余额历史'}).click();await dialog.waitFor();await page.waitForFunction(()=>!document.querySelector('.mac-sheet-enter-active'));await page.screenshot({path:path.join(out,'balance-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await dialog.getByRole('button',{name:'关闭',exact:true}).isVisible());checks.push('balance mobile footer reachable');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'usage-mobile.png')});
  await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'展开图表'}).click();await page.evaluate(()=>document.body.classList.add('dark'));await page.getByText('分组夹具',{exact:true}).waitFor();await page.waitForTimeout(300);await page.screenshot({path:path.join(out,'usage-dark.png')});
  await page.evaluate(()=>{document.body.classList.remove('dark');window.__screen.name='users'});await page.getByRole('button',{name:'查看用户 8 余额历史'}).click();await page.getByRole('dialog').waitFor();await page.getByText('用户概况备注',{exact:true}).waitFor();checks.push('UsersApp zero-usage user history entry');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>window.__screen.name='pricing');await page.getByRole('region',{name:'复用夹具组定价对比'}).waitFor();await page.getByText('官方参考 · 美元 / 100 万 Token（不乘倍率）',{exact:true}).waitFor();await page.getByText('$0.50',{exact:true}).waitFor();await page.getByText('$4.00',{exact:true}).waitFor();checks.push('desktop sheet reuses paid and official plaza comparison');await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>!document.querySelector('.mac-sheet-enter-active'));await page.screenshot({path:path.join(out,'pricing-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>window.__screen.name='docs');const toc=page.getByRole('navigation',{name:'文档目录'});await toc.waitFor();await page.waitForFunction(()=>document.querySelector('.public-toc [aria-current="location"]'));
  await toc.getByRole('button',{name:'重复标题',exact:true}).nth(1).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.public-toc button')).findIndex(b=>b.getAttribute('aria-current')==='location')===2);checks.push('Markdown duplicate heading click selects exact section');
  await page.evaluate(()=>{const scroller=document.querySelector('.public-surface');scroller.scrollTop=0;});await page.waitForFunction(()=>Array.from(document.querySelectorAll('.public-toc button')).findIndex(b=>b.getAttribute('aria-current')==='location')===0);checks.push('Markdown scroll restores active section');
  await page.evaluate(()=>window.__doc.content='# 新文档\n更新内容');await page.waitForFunction(()=>document.querySelectorAll('.public-toc button').length===1&&document.querySelector('.public-toc [aria-current="location"]')?.textContent==='新文档');checks.push('Markdown replacement clears obsolete headings');await page.evaluate(()=>window.__doc.tools=false);await toc.waitFor({state:'hidden'});await page.evaluate(()=>window.__screen.name='usage');
  assert.deepEqual(errors,[]);assert(calls.every(c=>c.method==='GET'));fs.writeFileSync(path.join(out,'browser.json'),JSON.stringify({checks,calls,errors,realRequests:0},null,2));console.log(JSON.stringify({passed:checks.length,errors,calls:calls.length}));
 }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
