// Own Vite instance + browser only. Every API request is intercepted; no global build.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/r08-closeout/drafts-browser');
const dir = path.join(out, 'fixture'), req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
function playwright() {
  for (const name of [process.env.PARITY_PUBLIC_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean)) try { return req(name); } catch {}
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const name of fs.readdirSync(links)) {
    const target = fs.readFileSync(path.join(links, name), 'utf8').trim(); if (fs.existsSync(target)) return require(target);
  }
  throw Error('Existing Playwright runtime unavailable');
}
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/entry.js"></script></html>');
  fs.writeFileSync(path.join(dir, 'entry.js'), `import {createApp} from 'vue';import {createPinia} from 'pinia';import Fixture from './Fixture.vue';import App from '@/App.vue';import '@/style.css';createApp(new URLSearchParams(location.search).has('desktop')?App:Fixture).use(createPinia()).mount('#app');`);
  fs.writeFileSync(path.join(dir, 'Fixture.vue'), `<script setup>
import {reactive} from 'vue';import {MacWindow,MacSheet,MacButton,MacDraftGuard,MacToggle,createWindowManager,provideWindowManager} from '@sub2-mac/core';import Policy from '@/apps/user/settings/PolicyRulesPanel.vue';
const wm=createWindowManager();provideWindowManager(wm);wm.registerApps(['one','two','policy'].map(id=>({id,name:id,title:id,icon:'',category:'system',defaultW:690,defaultH:620})));
const state=reactive({one:{text:'',busy:false,sheet:false,value:'',toggle:false},two:{text:'',busy:false,sheet:false,value:'',toggle:false},category:true});
wm.openApp('one');window.draftFixture={wm,state};
</script><template><div class="fixture-desktop"><nav><button @click="wm.openApp('one')">one</button><button @click="wm.openApp('two')">two</button><button @click="wm.openApp('policy')">policy</button><button @click="wm.closeAllWindows('退出登录')">退出</button></nav>
<MacWindow v-for="win in wm.windows.value" :key="win.id" :win="win" @focus="wm.focusWindow(win.id)" @close="wm.closeWindow(win.id)" @minimize="wm.minimizeWindow(win.id)" @maximize="wm.toggleMaximizeWindow(win.id)">
<template v-if="win.appId==='policy'"><div v-show="state.category"><Policy kind="beta"/></div></template>
<template v-else><div v-show="state.category" class="fixture-form"><MacDraftGuard :dirty="state[win.appId].text!==''" :busy="state[win.appId].busy"/><label>主表单<input aria-label="主表单" v-model="state[win.appId].text"/></label><MacButton @click="state[win.appId].sheet=true">编辑弹层</MacButton></div>
<MacSheet :show="state[win.appId].sheet" protect-changes title="编辑草稿" :loading="state[win.appId].busy" @close="state[win.appId].sheet=false"><label>草稿<input aria-label="草稿" v-model="state[win.appId].value"/></label><MacToggle v-model="state[win.appId].toggle"/><template #footer="{close}"><MacButton @click="close">取消</MacButton></template></MacSheet></template>
</MacWindow></div></template><style>html,body,#app,.fixture-desktop{height:100%;margin:0;background:var(--bg-canvas);color:var(--text-primary)}nav{height:32px;display:flex;gap:20px;position:relative;z-index:4000}input{padding:8px;border:1px solid var(--border-color);background:var(--window-bg-solid)}.fixture-form{padding:20px}</style>`);
  const vite = await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')), 'dist/node/index.js')).href);
  const vue = (await import(pathToFileURL(req.resolve('@vitejs/plugin-vue')).href)).default;
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
  const fixturePort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const server = await vite.createServer({ configFile: false, root: dir, publicDir: path.join(root, 'packages/sub2-console/public'), plugins: [vue()],
    define: { 'import.meta.env.VITE_DESKTOP_WALLPAPERS': 'false', 'import.meta.env.VITE_OFFICIAL_CONSOLE_URL': '""' },
    resolve: { alias: { '@': path.join(root, 'packages/sub2-console/src'), '@sub2-mac/core': path.join(root, 'packages/mac-ui-core/src/index.ts'), vue: req.resolve('vue/dist/vue.runtime.esm-bundler.js'), pinia: req.resolve('pinia') } },
    css: { postcss: { plugins: [req('tailwindcss')({ darkMode: 'class', content: [path.join(root, 'packages/sub2-console/src/**/*.{vue,ts}'), path.join(root, 'packages/mac-ui-core/src/**/*.vue'), path.join(dir, '*.vue')] }), req('autoprefixer')()] } },
    server: { host: '127.0.0.1', port: fixturePort, strictPort:true, fs: { allow: [root] } }, logLevel: 'error' });
  await server.listen(); const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const checks = [], errors = [], writes = [], external = []; let browser, policyReads = 0, failPolicy = false;
  const check = (name, pass) => { assert.ok(pass, name); checks.push(name); console.log('PASS ' + name); };
  try {
    browser = await playwright().chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (!p.startsWith('/api/') && !p.startsWith('/health') && !p.startsWith('/setup/')) return route.continue();
      const ok = data => route.fulfill({ json: { code: 0, data } });
      if (request.method() !== 'GET') { writes.push(p); return route.fulfill({ status: 503, json: { message: 'Fixture rejected write' } }); }
      if (p.endsWith('/auth/me')) return ok({ id: 987, role: 'admin', email: 'fixture@example.invalid', balance: 0, status: 'active' });
      if (p.endsWith('/admin/compliance')) return ok({ required: false, version: 'fixture', ack_phrase_zh: 'fixture', ack_phrase_en: 'fixture' });
      if (p.endsWith('/settings/public')) return ok({ custom_menu_items: [] });
      if (p.includes('beta-policy')) { policyReads++; return failPolicy ? route.fulfill({ status: 503, json: { message: 'Read failed fixture' } }) : ok({ rules: [{ beta_token: 'initial', action: 'pass', scope: 'all' }] }); }
      if (p.endsWith('/admin/proxies')) return ok({ items: [], total: 0 });
      if (p === '/health') return route.fulfill({ json: { status: 'ok' } });
      return ok({ items: [], total: 0 });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { localStorage.setItem('auth_token', 'draft-fixture'); localStorage.setItem('sub2-desktop-preferences', JSON.stringify({ appearance: 'light', volume: 0, brightness: 100 })); });
    const region = name => page.getByRole('region', { name, exact: true });
    const alert = () => page.getByRole('alertdialog').filter({ visible: true });
    const refreshBlocked = () => page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    await page.goto(origin);
    await region('one').waitFor(); check('clean beforeunload is silent', !await refreshBlocked());
    await region('one').getByRole('button', { name: '编辑弹层' }).click();
    await page.getByRole('dialog', { name: '编辑草稿' }).getByLabel('草稿').fill('保留草稿');
    check('Sheet edits protect native reload', await refreshBlocked());
    // A real browser beforeunload dialog, with a user interaction already recorded.
    const actualDialog = page.waitForEvent('dialog'); const reload = page.reload({ timeout: 5000 }).catch(() => {});
    const native = await actualDialog; check('actual reload shows native beforeunload', native.type() === 'beforeunload'); await native.dismiss(); await reload;
    check('cancel native reload retains the typed draft', await page.getByRole('textbox', {name:'草稿',exact:true}).inputValue() === '保留草稿');
    await page.evaluate(() => { window.draftFixture.wm.closeWindow(window.draftFixture.wm.activeWindow.value.id); });
    await alert().waitFor(); await page.keyboard.press('Enter'); await alert().waitFor({ state: 'hidden' });
    check('Enter chooses continue editing and preserves underlying Sheet', await page.getByRole('textbox', {name:'草稿',exact:true}).inputValue() === '保留草稿');
    await page.evaluate(() => { const f=window.draftFixture; f.state.one.busy=true; f.wm.closeWindow(f.wm.activeWindow.value.id); });
    await page.getByRole('alertdialog', { name: '正在提交，请稍候' }).waitFor();
    check('busy window discard button disabled', await alert().locator('[data-alert-confirm]').isDisabled());
    await page.keyboard.press('Escape'); check('busy close cancellation preserves window', await region('one').count() === 1);
    await page.evaluate(() => window.draftFixture.state.one.busy=false);
    await page.getByRole('dialog', { name: '编辑草稿' }).getByRole('button', { name: '取消', exact: true }).click();
    await alert().getByRole('button', { name: '放弃更改', exact: true }).click();
    await page.getByRole('dialog', { name: '编辑草稿' }).waitFor({ state: 'hidden' });
    check('explicit sheet discard releases unload guard', !await refreshBlocked());
    await region('one').getByRole('button', { name: '编辑弹层' }).click(); await page.getByRole('switch').click();
    check('custom MacToggle counts as an edit', await refreshBlocked());
    await page.evaluate(() => {window.draftFixture.wm.forceCloseAllWindows();});
    await region('one').waitFor({state:'hidden'});
    await page.evaluate(() => {window.draftFixture.state.one.sheet=false;window.draftFixture.wm.openApp('one');}); await region('one').waitFor();
    await region('one').getByLabel('主表单').fill('隐藏分类草稿');
    check('main form protects before hiding', await refreshBlocked());
    await page.evaluate(() => { const f=window.draftFixture; f.state.one.sheet=false; f.state.category=false; f.wm.minimizeWindow(f.wm.activeWindow.value.id); });
    check('hidden category and minimized main form still protect reload', await refreshBlocked());
    await page.locator('nav').getByRole('button', { name: '退出', exact: true }).click();
    await alert().waitFor(); check('global close restores minimized owner and visible prompt', await region('one').isVisible());
    await alert().getByRole('button', { name: '继续编辑' }).click();
    await alert().waitFor({state:'hidden'});
    await page.evaluate(() => { const f=window.draftFixture;f.state.category=true;f.wm.openApp('two'); });
    await region('two').waitFor();
    await page.evaluate(() => { const f=window.draftFixture; f.wm.closeWindow(f.wm.activeWindow.value.id); });
    check('clean sibling closes without touching dirty owner', await page.evaluate(() => window.draftFixture.wm.windows.value.map(w=>w.appId).join(',') === 'one'));
    await region('two').waitFor({state:'hidden'});
    await page.evaluate(() => {window.draftFixture.wm.openApp('two');});
    await region('two').getByRole('textbox',{name:'主表单',exact:true}).fill('第二份');
    await page.evaluate(() => {const f=window.draftFixture;f.wm.closeWindow(f.wm.activeWindow.value.id);});
    await alert().waitFor();
    await page.evaluate(() => {const f=window.draftFixture;f.wm.focusWindow(f.wm.windows.value.find(w=>w.appId==='one').id);});
    await region('one').getByRole('textbox',{name:'主表单',exact:true}).click();
    // Background modal must not consume an active owner's key.
    await page.keyboard.press('Escape'); check('switching window and Escape never discard either draft', await page.evaluate(() => window.draftFixture.wm.windows.value.length===2&&window.draftFixture.state.two.text==='第二份'));
    await page.evaluate(() => { const f=window.draftFixture; if(f.wm.drafts.prompt.value)f.wm.focusWindow(f.wm.drafts.prompt.value.windowId); });
    await page.keyboard.press('Escape'); await alert().waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.draftFixture.wm.closeAllWindows('退出登录'); }); await alert().waitFor();
    for (const [theme,width,height] of [['light',1440,900],['dark',1440,900],['dark',390,844]]) {
      await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.setViewportSize({width,height});
      await page.screenshot({ path:path.join(out,`guard-${theme}-${width}.png`),animations:'disabled' });
      check(`confirmation usable ${theme} ${width}`, await alert().evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}));
    }
    await alert().locator('[data-alert-confirm]').click();
    check('global explicit discard closes all windows and releases beforeunload', await page.evaluate(()=>window.draftFixture.wm.windows.value.length===0) && !await refreshBlocked());
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>{const f=window.draftFixture; f.state.category=true; f.wm.openApp('policy')});
    const policy=page.getByRole('region',{name:'Anthropic Beta 规则',exact:true});await policy.getByPlaceholder('例如 context-1m-2025-08-07').waitFor();
    await policy.getByPlaceholder('例如 context-1m-2025-08-07').fill('changed');
    const reads=policyReads;await policy.getByRole('button',{name:'重新读取规则'}).click();await alert().waitFor();await page.keyboard.press('Escape');
    check('Policy reload cancel performs no read and retains draft',policyReads===reads&&await policy.getByPlaceholder('例如 context-1m-2025-08-07').inputValue()==='changed');
    failPolicy=true;await policy.getByRole('button',{name:'重新读取规则'}).click();await alert().getByRole('button',{name:'放弃并重新读取'}).click();await policy.getByRole('alert').waitFor();
    await page.getByRole('alertdialog',{name:'放弃未保存的规则？',exact:true}).waitFor({state:'hidden'});
    check('Policy read failure preserves dirty draft',await policy.getByPlaceholder('例如 context-1m-2025-08-07').inputValue()==='changed'&&await refreshBlocked());
    await page.evaluate(()=>{const f=window.draftFixture;f.state.category=false;f.wm.minimizeWindow(f.wm.activeWindow.value.id)});
    await page.evaluate(()=>{window.draftFixture.wm.closeAllWindows()});await alert().waitFor();
    check('actual hidden PolicyRulesPanel blocks global close',await region('policy').isVisible());await alert().locator('[data-alert-confirm]').click();
    // Real desktop entry: App.vue menu + keyboard + auth revocation using real ProxiesApp.
    await page.goto(origin+'/?desktop&noboot&unlocked&app=proxies');
    const proxy=page.getByRole('region',{name:'IP管理',exact:true});await proxy.waitFor();
    await proxy.getByRole('button',{name:/添加代理/}).first().click();await page.getByRole('dialog',{name:'添加代理'}).waitFor();
    await page.getByRole('dialog',{name:'添加代理'}).locator('input').first().fill('真实组件草稿');
    await page.keyboard.press('Control+w');await alert().waitFor();check('real App Ctrl+W protected',await proxy.count()===1);
    await page.keyboard.press('Escape');
    await alert().waitFor({state:'hidden'});
    await proxy.locator('[data-test="traffic-close"]').click();await alert().waitFor();
    check('real red traffic light protected',await proxy.count()===1);await page.keyboard.press('Escape');
    await alert().waitFor({state:'hidden'});
    await page.evaluate(()=>{window.__macOS.wm.closeAllWindows('退出登录')});await alert().waitFor();await page.keyboard.press('Escape');
    check('cancel desktop exit retains auth and form',await page.evaluate(()=>!!localStorage.getItem('auth_token'))&&await page.getByRole('dialog',{name:'添加代理'}).locator('input').first().inputValue()==='真实组件草稿');
    await page.evaluate(()=>{const wm=window.__macOS.wm;wm.closeAllWindows();wm.forceCloseAllWindows()});
    await alert().waitFor({state:'hidden'});check('forced cleanup dismisses pending UI and releases reload',!await refreshBlocked());
    check('no unhandled browser errors',errors.length===0);check('no external requests',external.length===0);check('no business writes',writes.length===0);
    fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({origin,checks,errors,external,writes},null,2));
  } catch(error) { fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(error),checks,errors,external,writes},null,2));throw error; }
  finally { await browser?.close();await server.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
