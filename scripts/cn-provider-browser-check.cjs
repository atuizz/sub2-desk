// Standalone component production build + browser fixtures. Does not import AccountsApp or call APIs.
// node scripts/cn-provider-browser-check.cjs [path-to-playwright]
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/cn-provider-final'),fixture=path.join(out,'fixture');
const req=createRequire(path.join(root,'packages/sub2-console/package.json'));
const {chromium}=require(process.argv[2]||'playwright');
async function main(){
  await fs.mkdir(fixture,{recursive:true});
  await fs.writeFile(path.join(fixture,'index.html'),'<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/entry.js"></script></html>');
  await fs.writeFile(path.join(fixture,'entry.js'),`import {createApp} from 'vue';import Fixture from './Fixture.vue';import '../../../packages/sub2-console/src/style.css';createApp(Fixture).mount('#app');`);
  await fs.writeFile(path.join(fixture,'Fixture.vue'),`<script setup>
import {ref} from 'vue';
import Fields from '../../../packages/sub2-console/src/apps/admin/accounts/CNProviderFields.vue';
import * as h from '../../../packages/sub2-console/src/apps/admin/accounts/cn-provider';
const platform=ref('minimax'),form=ref(h.cnProviderForm('minimax')),editing=ref(false),hasKey=ref(false),disabled=ref(false),errors=ref({});
let account,initial,updates=0,result;
function reset(p,a){platform.value=p;account=a;form.value=h.cnProviderForm(p,a);initial=h.cloneCNProviderForm(form.value);editing.value=!!a;hasKey.value=h.cnHasExistingApiKey(a);errors.value={};updates=0;result=undefined;}
function save(){const options=account?{current:account,initial}:{};errors.value=h.validateCNProviderForm(platform.value,form.value,options);if(!Object.keys(errors.value).length)result=h.buildCNProviderCredentials(platform.value,form.value,options);}
window.__cnFixture={reset,read:()=>({platform:platform.value,form:form.value,errors:errors.value,updates,result}),setDisabled:v=>disabled.value=v,setPlatform:p=>platform.value=p};
</script><template><main class="fixture"><header><span>隔离组件预览</span><h1>{{platform}} · API Key 账号</h1></header><form @submit.prevent="save"><Fields v-model="form" :platform="platform" :editing="editing" :has-existing-api-key="hasKey" :disabled="disabled" :errors="errors" @update:modelValue="updates++"/><footer><button type="submit">校验配置</button></footer></form></main></template><style>
html:root,html:root body,html:root #app{margin:0;min-height:100%;height:auto;overflow:auto;position:relative}html:root body{background:var(--bg-canvas);font-family:var(--font-mac,system-ui);color:var(--text-primary)}.fixture{box-sizing:border-box;max-width:700px;margin:32px auto;padding:24px;border:1px solid var(--border-subtle);border-radius:16px;background:var(--window-bg-solid);container-type:inline-size;container-name:app-window}.fixture>header{padding-bottom:20px;margin-bottom:20px;border-bottom:1px solid var(--border-subtle)}.fixture h1{font-size:18px;font-weight:600;margin-top:6px}.fixture header>span{font-size:11px;color:var(--text-secondary)}footer{display:flex;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--border-subtle)}footer button{border:0;border-radius:7px;background:var(--accent);color:white;padding:8px 16px;font-size:12px}@media(max-width:540px){.fixture{margin:10px 8px;padding:16px;border-radius:12px}}
</style>`);
  const {build}=await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')),'dist/node/index.js')).href),vue=(await import(pathToFileURL(req.resolve('@vitejs/plugin-vue')).href)).default;
  await build({configFile:false,root:fixture,publicDir:false,plugins:[vue()],resolve:{alias:{vue:req.resolve('vue/dist/vue.runtime.esm-bundler.js')}},css:{postcss:{plugins:[req('tailwindcss')({content:[path.join(fixture,'Fixture.vue')]}),req('autoprefixer')()]}},build:{outDir:path.join(out,'build'),emptyOutDir:false},logLevel:'warn'});
  const server=http.createServer(async(request,response)=>{
    const p=new URL(request.url,'http://local').pathname;
    if(p.includes('..')){response.writeHead(403).end();return;}
    try{const file=path.join(out,'build',p==='/'?'index.html':p);response.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8'})[path.extname(file)]||'application/octet-stream');response.end(await fs.readFile(file));}catch{response.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser;const checks=[],requests=[],errors=[];
  const check=(name,pass)=>{assert(pass,name);checks.push(name);};
  try{
    browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==origin||url.pathname.startsWith('/api/')){requests.push(url.origin+url.pathname);return r.abort();}return r.continue();});
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.getByLabel('计费方式',{exact:true}).waitFor();
    for(const theme of ['light','dark']){
      await page.evaluate(theme=>{document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.style.colorScheme=theme;},theme);
      for(const platform of ['minimax','kimi','deepseek','zhipu']){
        await page.setViewportSize({width:1440,height:900});await page.evaluate(p=>window.__cnFixture.reset(p),platform);
        await page.waitForFunction(p=>document.querySelector('h1').textContent.startsWith(p),platform);
        check(platform+'/'+theme+' hydration emits nothing',await page.evaluate(()=>window.__cnFixture.read().updates===0));
        check(platform+'/'+theme+' mode options',await page.getByLabel('计费方式',{exact:true}).locator('option').count()===(platform==='deepseek'?1:2));
        check(platform+'/'+theme+' native responses support',await page.getByLabel('API 协议',{exact:true}).locator('option[value="responses"]').count()===(platform==='zhipu'?0:1));
        const api=page.getByLabel('API Key',{exact:true});check(platform+'/'+theme+' key required and concealed',await api.getAttribute('type')==='password'&&await api.evaluate(el=>el.required));
        await page.getByRole('button',{name:'校验配置'}).click();check(platform+'/'+theme+' required key blocks native form',await page.evaluate(()=>window.__cnFixture.read().result===undefined));
        await api.fill('fixture-only-key');
        if(platform!=='deepseek')await page.getByLabel('计费方式',{exact:true}).selectOption('coding');
        await page.getByLabel('Anthropic 地址',{exact:true}).fill('https://relay.example.test/custom/messages');
        await page.getByLabel('API 协议',{exact:true}).selectOption('anthropic');check(platform+'/'+theme+' adaptive-to-fixed carries custom URL',await page.getByLabel('上游地址',{exact:true}).inputValue()==='https://relay.example.test/custom/messages');
        if(platform==='minimax'){
          await page.getByRole('button',{name:'MiniMax Coding Intl Anthropic',exact:true}).click();
          check(theme+' MiniMax international preset',await page.getByLabel('上游地址',{exact:true}).inputValue()==='https://api.minimax.io/anthropic');
        }
        await page.getByLabel('API 协议',{exact:true}).selectOption('adaptive');await page.getByRole('button',{name:'校验配置'}).click();
        check(platform+'/'+theme+' build uses selected account mode and adaptive protocol',await page.evaluate(p=>{const c=window.__cnFixture.read().result;return c.account_mode===(p==='deepseek'?'payg':'coding')&&c.api_protocol==='adaptive'&&c.base_url===c.api_base_urls.chat_completions;},platform));
        await page.screenshot({path:path.join(out,platform+'-'+theme+'-desktop.png'),fullPage:true});
        await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,platform+'-'+theme+'-390.png'),fullPage:true});
        check(platform+'/'+theme+' 390px no overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('input,select')].every(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})));
        await page.getByRole('button',{name:'校验配置'}).scrollIntoViewIfNeeded();
        check(platform+'/'+theme+' 390px footer reachable',await page.getByRole('button',{name:'校验配置'}).evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
        await page.evaluate(()=>scrollTo(0,0));
      }
    }
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.__cnFixture.reset('kimi',{platform:'kimi',type:'apikey',credentials:{api_protocol:'anthropic',base_url:'https://relay.example.test/original/',model_mapping:{keep:'model'},future:73},credentials_status:{has_api_key:true}}));
    const replacement=page.getByLabel('更换 API Key',{exact:true});await replacement.waitFor();
    check('edit does not expose or require old key',await replacement.inputValue()===''&&!(await replacement.evaluate(el=>el.required)));
    await page.getByRole('button',{name:'校验配置'}).click();check('edit no-op omits credentials',await page.evaluate(()=>window.__cnFixture.read().result===undefined));
    await replacement.fill('replacement-fixture');await page.getByRole('button',{name:'校验配置'}).click();
    check('key-only update preserves original URL and extra credentials',await page.evaluate(()=>{const c=window.__cnFixture.read().result;return c.base_url==='https://relay.example.test/original/'&&c.model_mapping.keep==='model'&&c.future===73&&!('account_mode'in c);}));
    await page.evaluate(()=>window.__cnFixture.setDisabled(true));check('submitting disables all controls',await page.locator('.cn-provider-fields input,.cn-provider-fields select,.cn-provider-fields button').evaluateAll(els=>els.every(el=>el.matches(':disabled'))));await page.evaluate(()=>window.__cnFixture.setDisabled(false));
    await page.getByLabel('上游地址',{exact:true}).fill('https://relay.test/path');await page.getByLabel('API 协议',{exact:true}).selectOption('adaptive');
    await page.getByLabel('Anthropic 地址',{exact:true}).fill('https://user:pass@relay.test');await page.getByRole('button',{name:'校验配置'}).click();await page.getByRole('alert').filter({hasText:'HTTP(S)'}).waitFor();checks.push('field error is visible after helper validation');
    await page.evaluate(()=>window.__cnFixture.setPlatform('minimax'));await page.getByRole('alert').filter({hasText:'重新读取配置'}).waitFor();check('stale platform draft controls hidden',await page.getByLabel('API 协议',{exact:true}).count()===0);
    await page.evaluate(()=>window.__cnFixture.reset('zhipu',{platform:'zhipu',type:'apikey',credentials:{account_mode:'coding',api_protocol:'adaptive',zhipu_organization:'org',zhipu_project:'project',future:'keep'},credentials_status:{has_api_key:true}}));
    await page.getByLabel('组织 ID',{exact:true}).fill('');await page.getByRole('button',{name:'校验配置'}).click();
    check('clearing organization removes team fields and retains unrelated values',await page.evaluate(()=>{const c=window.__cnFixture.read().result;return !('zhipu_organization'in c)&&!('zhipu_project'in c)&&c.future==='keep';}));
    check('zero API/remote requests',requests.length===0);check('zero browser errors',errors.length===0);
    await context.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({checks,requests,errors,fixtureOnly:true},null,2)+'\n');}
  console.log(checks.length+' standalone component browser checks passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
