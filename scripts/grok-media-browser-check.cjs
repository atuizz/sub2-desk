// Isolated Vite dev consumer; no global build and no AccountsApp import.
// node scripts/grok-media-browser-check.cjs [path-to-playwright]
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/grok-media-final'),dir=path.join(out,'fixture');
const req=createRequire(path.join(root,'packages/sub2-console/package.json'));
const {chromium}=require(process.argv[2]||'playwright');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
async function main(){
  await fs.mkdir(dir,{recursive:true});
  await fs.writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/entry.js"></script></html>');
  await fs.writeFile(path.join(dir,'entry.js'),`import {createApp} from 'vue';import App from './Fixture.vue';import '../../../packages/sub2-console/src/style.css';createApp(App).mount('#app');`);
  await fs.writeFile(path.join(dir,'Fixture.vue'),`<script setup>
import {ref,nextTick} from 'vue';import Sheet from '../../../packages/sub2-console/src/apps/admin/accounts/GrokMediaEligibilitySheet.vue';
const account=ref({id:12,name:'Grok 媒体测试',platform:'grok',type:'oauth',credentials:{},extra:{grok_media_eligible:true,keep:'unchanged'}}),open=ref(true),events=[];
window.__grokFixture={events,read:()=>account.value,replace:(id,platform='grok',type='oauth')=>account.value={...account.value,id,platform,type},reopen:async(id=12,platform='grok',type='oauth')=>{open.value=false;await nextTick();account.value={...account.value,id,platform,type};open.value=true;}};
</script><template><main class="fixture-window mac-window window-active"><p>媒体资格 · 隔离弹层预览</p><Sheet v-if="open" :account="account" @close="open=false" @saved="events.push($event)"/></main></template><style>
html:root,html:root body,html:root #app{margin:0;width:100%;height:100%;background:var(--bg-canvas)}.fixture-window{position:relative;margin:40px auto;width:min(760px,calc(100% - 32px));height:calc(100% - 80px);background:var(--window-bg-solid);border-radius:16px;color:var(--text-primary);border:1px solid var(--border-subtle);overflow:hidden}.fixture-window>p{padding:16px;font-size:12px}@media(max-width:540px){.fixture-window{margin:0;width:100%;height:100%;border-radius:0}}
</style>`);
  const vite=await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')),'dist/node/index.js')).href);
  const vue=(await import(pathToFileURL(req.resolve('@vitejs/plugin-vue')).href)).default;
  const server=await vite.createServer({configFile:false,root:dir,publicDir:false,plugins:[vue()],resolve:{alias:{'@':path.join(root,'packages/sub2-console/src'),'@sub2-mac/core':path.join(root,'packages/mac-ui-core/src/index.ts'),vue:req.resolve('vue/dist/vue.runtime.esm-bundler.js')}},css:{postcss:{plugins:[req('tailwindcss')({content:[path.join(dir,'Fixture.vue')]}),req('autoprefixer')()]}},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}},logLevel:'error'});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  let browser;const calls=[],blocked=[],errors=[],checks=[];
  const check=(name,pass)=>{assert(pass,name);checks.push(name);};
  let nextRead,nextWrite,failRead=false,failWrite=false,wrongRead=false,remoteMode='auto';
  try{
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await context.route('**/*',async r=>{
      const request=r.request(),url=new URL(request.url());
      if(url.origin!==origin){blocked.push(url.origin+url.pathname);return r.abort();}
      if(url.pathname.startsWith('/api/')){
        const match=url.pathname.match(/^\/api\/v1\/admin\/accounts\/(\d+)\/grok-media-eligibility$/);
        if(!match){blocked.push(url.pathname);return r.fulfill({status:403,json:{message:'Unexpected API'}});}
        const id=Number(match[1]),method=request.method();calls.push({id,method,payload:method==='PUT'?request.postDataJSON():null});
        const wait=method==='GET'?nextRead:nextWrite;if(method==='GET')nextRead=undefined;else nextWrite=undefined;if(wait)await wait.promise;
        if(method==='GET'&&failRead||method==='PUT'&&failWrite)return r.fulfill({status:503,json:{code:503,message:'Isolated failure'}});
        if(method==='PUT')remoteMode=request.postDataJSON().mode;
        const mode=remoteMode,data={account_id:wrongRead&&method==='GET'?id+100:id,mode,eligible:mode==='enabled'||id===13,reason:id===13?'billing_inconclusive':mode==='auto'?'billing_unobserved':mode==='enabled'?'override_enabled':'override_disabled'};
        return r.fulfill({json:{code:0,data}});
      }
      return r.continue();
    });
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    nextRead=deferred();const initial=nextRead;await page.goto(origin);await page.getByText('正在读取媒体资格…',{exact:true}).waitFor();
    check('unknown state cannot save',await page.getByRole('button',{name:'保存设置',exact:true}).isDisabled());
    check('extra override is not treated as confirmed eligibility',await page.getByText('允许媒体请求',{exact:true}).count()===0);
    initial.resolve();await page.getByText('不允许媒体请求',{exact:true}).waitFor();
    const select=page.getByLabel('媒体请求模式',{exact:true}),save=page.getByRole('button',{name:'保存设置',exact:true}),reload=page.getByRole('button',{name:'重新读取',exact:true});
    check('three official modes present',JSON.stringify(await select.locator('option').evaluateAll(options=>options.map(o=>o.value)))===JSON.stringify(['auto','enabled','disabled']));
    check('unchanged mode disabled',await save.isDisabled());
    for(const theme of ['light','dark']){
      await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),theme==='dark');
      for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:900});await page.screenshot({path:path.join(out,`${theme}-${width}.png`)});check(theme+'/'+width+' dialog and footer fit',await page.getByRole('dialog').evaluate(el=>{const r=el.getBoundingClientRect(),footer=el.querySelector('.mac-sheet-footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&footer.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth;}));}
    }
    await page.setViewportSize({width:1440,height:900});
    await select.selectOption('enabled');nextWrite=deferred();const writing=nextWrite;await save.click();
    check('saving disables selection and close',await select.isDisabled()&&await page.getByRole('button',{name:'关闭',exact:true}).isDisabled());
    const putsBefore=calls.filter(c=>c.method==='PUT').length;await page.keyboard.press('Enter');check('Enter does not duplicate pending PUT',calls.filter(c=>c.method==='PUT').length===putsBefore);
    writing.resolve();await page.getByText('媒体资格设置已保存。',{exact:true}).waitFor();await page.getByText('允许媒体请求',{exact:true}).waitFor();
    check('saved event is validated state only',await page.evaluate(()=>window.__grokFixture.events.length===1&&window.__grokFixture.events[0].account_id===12&&!('extra'in window.__grokFixture.events[0])));
    check('account extra untouched',await page.evaluate(()=>window.__grokFixture.read().extra.keep==='unchanged'&&window.__grokFixture.read().extra.grok_media_eligible===true));
    await select.selectOption('disabled');failWrite=true;await save.click();await page.getByRole('alert').filter({hasText:'结果未确认'}).waitFor();
    check('failed save keeps draft and last confirmed eligible state',await select.inputValue()==='disabled'&&await page.getByText('允许媒体请求',{exact:true}).count()===1&&await save.isDisabled());
    failWrite=false;await reload.click();await page.waitForFunction(()=>!document.querySelector('select').disabled);check('reread preserves unsaved selection',await select.inputValue()==='disabled');await save.click();await page.getByText('媒体资格设置已保存。',{exact:true}).waitFor();await page.getByText('不允许媒体请求',{exact:true}).waitFor();
    check('recovery submits dedicated disabled mode',calls.filter(c=>c.method==='PUT').at(-1).payload.mode==='disabled');
    wrongRead=true;await reload.click();await page.getByRole('alert').filter({hasText:'读取失败'}).waitFor();check('foreign account response leaves old state and disables write',await page.getByText('不允许媒体请求',{exact:true}).count()===1&&await save.isDisabled());wrongRead=false;
    nextRead=deferred();const old=nextRead;await reload.click();await page.getByText('正在读取媒体资格…',{exact:true}).waitFor();remoteMode='auto';await page.evaluate(()=>window.__grokFixture.replace(13));await page.getByText('允许媒体请求',{exact:true}).waitFor();old.resolve();
    await page.getByText('现有计费信息不足以确定订阅情况。',{exact:true}).waitFor();check('new account authoritative eligible survives old response',await page.getByText('允许媒体请求',{exact:true}).count()===1&&await select.inputValue()==='auto');
    const count=calls.length;await page.evaluate(()=>window.__grokFixture.replace(14,'grok','apikey'));await page.getByRole('alert').filter({hasText:'仅适用于 Grok OAuth'}).waitFor();check('unsupported account neither loads nor exposes save',calls.length===count&&await save.count()===0);
    await page.evaluate(()=>window.__grokFixture.reopen(12));await page.getByText('不允许媒体请求',{exact:true}).waitFor();nextRead=deferred();const closing=nextRead;await reload.click();await page.getByRole('button',{name:'关闭',exact:true}).click();closing.resolve();await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('close during GET dismisses dialog');
    await page.evaluate(()=>window.__grokFixture.reopen(12));await page.getByText('不允许媒体请求',{exact:true}).waitFor();await select.focus();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});checks.push('Escape closes through shared modal layer');
    check('all PUT bodies contain only mode',calls.filter(c=>c.method==='PUT').every(c=>Object.keys(c.payload).join(',')==='mode'));
    check('zero unexpected API or external requests',blocked.length===0);check('zero browser errors',errors.length===0);
    await context.close();
  }finally{if(browser)await browser.close();await server.close();await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({checks,calls,blocked,errors,fixtureOnly:true,globalBuild:false},null,2)+'\n');}
  console.log(checks.length+' Grok media browser checks passed; no global build');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
