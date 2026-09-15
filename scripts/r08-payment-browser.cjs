// Real DOM, persistent browser storage and Web Locks; all API traffic is a local fixture.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/r08-closeout', process.env.PAYMENT_NO_WEBLOCKS ? 'payment-indexeddb-browser' : 'payment-browser'), dir = path.join(out, 'fixture');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function playwright() {
  if (process.env.PARITY_PUBLIC_PLAYWRIGHT) return require(process.env.PARITY_PUBLIC_PLAYWRIGHT);
  for (const name of ['playwright', 'playwright-core']) try { return req(name); } catch {}
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) { const target = fs.readFileSync(path.join(links, file), 'utf8').trim(); if (fs.existsSync(target)) return require(target); }
  throw Error('Existing Playwright runtime not found');
}
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/entry.js"></script></html>');
  fs.writeFileSync(path.join(dir, 'entry.js'), `import {createApp} from 'vue';import {createPinia} from 'pinia';import Fixture from './Fixture.vue';import '/@fs/${root.replaceAll('\\', '/')}/packages/sub2-console/src/style.css';createApp(Fixture).use(createPinia()).mount('#app');`);
  fs.writeFileSync(path.join(dir, 'Fixture.vue'), `<script setup>
import {ref} from 'vue';import Commerce from '@/apps/admin/CommerceApp.vue';import Providers from '@/apps/user/settings/PaymentProvidersPanel.vue';import {useAuthStore} from '@/stores/auth';import {useSystemStore} from '@/stores/system';
const auth=useAuthStore(), system=useSystemStore(), showing=ref(true), kind=new URLSearchParams(location.search).get('app')||'providers';
function identify(id){const user={id,role:'admin',email:'fixture@example.invalid'};const token='r08-fixture-'+id;localStorage.setItem('auth_user',JSON.stringify(user));localStorage.setItem('auth_token',token);auth.user=user;auth.token=token;auth.sessionRevision++;}
identify(JSON.parse(localStorage.getItem('auth_user')||'null')?.id||99);
window.__r08Identify=identify;window.__r08Theme=system.setAppearance;
</script><template><header class="fixture-controls"><button @click="showing=!showing">{{showing?'关闭业务窗口':'重开业务窗口'}}</button><span>R08 隔离夹具 · 身份 {{auth.user?.id}}</span></header><main v-if="showing" class="fixture-window window window-active"><Commerce v-if="kind==='refund'"/><Providers v-else/></main></template><style>
html:root,body,#app{margin:0;width:100%;height:100%;background:var(--bg-canvas)}.fixture-controls{height:40px;display:flex;align-items:center;gap:16px;padding:8px;font-size:12px}.fixture-controls button{border:1px solid var(--border-color);padding:4px 8px;border-radius:5px}.fixture-window{position:relative;margin:16px auto;width:min(1200px,calc(100% - 32px));height:calc(100% - 72px);background:var(--window-bg-solid);border-radius:14px;color:var(--text-primary);border:1px solid var(--border-subtle);overflow:auto}@media(max-width:540px){.fixture-window{margin:0;width:100%;height:calc(100% - 40px);border-radius:0}.fixture-controls{gap:6px}}
</style>`);
  const vite = await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')), 'dist/node/index.js')).href);
  const vue = (await import(pathToFileURL(req.resolve('@vitejs/plugin-vue')).href)).default;
  const probe = require('node:net').createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const server = await vite.createServer({ configFile: false, root: dir, publicDir: path.join(root, 'packages/sub2-console/public'), plugins: [vue()],
    resolve: { alias: { '@': path.join(root, 'packages/sub2-console/src'), '@sub2-mac/core': path.join(root, 'packages/mac-ui-core/src/index.ts'), vue: req.resolve('vue/dist/vue.runtime.esm-bundler.js'), pinia: req.resolve('pinia') } },
    css: { postcss: { plugins: [req('tailwindcss')({ darkMode: 'class', content: [path.join(root, 'packages/sub2-console/src/**/*.{vue,ts}'), path.join(root, 'packages/mac-ui-core/src/**/*.vue'), path.join(dir, 'Fixture.vue')] }), req('autoprefixer')()] } },
    server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } }, logLevel: 'error' });
  await server.listen(); const origin = 'http://127.0.0.1:' + port;
  const checks = [], writes = [], errors = [], external = [], gates = [];
  const check = (name, pass) => { assert.ok(pass, name); checks.push(name); };
  let providerMode = 'unknown', refundMode = 'unknown', queryMode = 'pending', providerHold, refundStatus = 'COMPLETED', providerName = 'R08 收款提供方';
  let browser, page;
  try {
    browser = await playwright().chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    if(process.env.PAYMENT_NO_WEBLOCKS)await context.addInitScript(()=>{Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});});
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname, method = request.method();
      if (url.origin !== origin) { external.push(url.origin); return route.abort(); }
      if (!p.startsWith('/api/')) return route.continue();
      const ok = data => route.fulfill({ json: { code: 0, data } });
      if (method !== 'GET') {
        const body = request.postData() ? request.postDataJSON() : {};
        writes.push({ p, method, force: body.force, keys: Object.keys(body) });
        if (/\/providers(?:\/\d+)?$/.test(p)) {
          if (providerMode === 'hold') { providerHold = deferred(); gates.push(providerHold); await providerHold.promise; }
          if (providerMode === 'unknown') return route.fulfill({ status: 503, json: { code: 503, message: 'Fixture unknown result' } });
          if (providerMode === 'reject') return route.fulfill({ status: 400, json: { code: 400, message: 'Fixture refusal' } });
          providerName = body.name || providerName; return ok({ id: 7, config: 'fixture-encrypted-response' });
        }
        if (p.endsWith('/refund/query')) return ok(queryMode === 'success' ? { success: true } : { success: false, warning: 'gateway refund pending confirmation' });
        if (p.endsWith('/refund')) {
          if (refundMode === 'unknown') return route.fulfill({ status: 408, json: { code: 408, message: 'Fixture timeout' } });
          if (refundMode === 'pending') { refundStatus = 'REFUND_PENDING'; return ok({ success: false, warning: 'gateway refund pending confirmation' }); }
          return ok(body.force ? { success: true } : { success: false, require_force: true, warning: '余额不足，请确认强制退款' });
        }
        throw Error('Unexpected fixture mutation: ' + p);
      }
      if (p.endsWith('/providers')) return ok([{ id: 7, name: providerName, provider_key: 'stripe', config: { publishableKey: 'pk_fixture', currency: 'CNY' }, enabled: true, supported_types: ['card'], refund_enabled: false, allow_user_refund: false, sort_order: 0, limits: '', payment_mode: '' }]);
      if (p.endsWith('/payment/orders')) return ok({ items: [{ id: 42, status: refundStatus, amount: 100, pay_amount: 720, refund_amount: 0, order_type: 'balance', user_id: 7, payment_type: 'alipay' }], total: 1 });
      return route.fulfill({ status: 503, json: { message: 'Unsupported fixture read' } });
    });
    page = await context.newPage(); page.setDefaultTimeout(9000); page.on('pageerror', e => errors.push(e.message));
    const markers = p => p.evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('sub2-payment-write-v1:')).map(([,value]) => JSON.parse(value)));
    const providerWrites = () => writes.filter(w => w.p.includes('/providers')).length;
    const refundWrites = () => writes.filter(w => w.p.endsWith('/refund')).length;
    const shot = name => page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
    const reviewProvider = async p => {
      await p.getByRole('button', { name: '核对操作结果', exact: true }).click();
      await p.getByRole('alertdialog', { name: '确认已核对操作结果', exact: true }).getByRole('button', { name: '已核对，解除保护', exact: true }).click();
    };
    await page.goto(origin); await page.getByRole('button', { name: '编辑', exact: true }).click();
    let edit = page.getByRole('dialog', { name: '编辑收款提供方', exact: true });
    await edit.getByLabel('名称', { exact: true }).fill('Private fixture name');
    await edit.locator('input[type=password]').first().fill('SECRET-FIXTURE-NOT-STORED');
    await edit.getByRole('button', { name: '保存提供方', exact: true }).click(); await edit.getByText(/保存结果尚未确认/).waitFor();
    check('unknown provider writes once', providerWrites() === 1);
    let saved = await markers(page); check('provider marker stores metadata only', saved.length === 1 && !JSON.stringify(saved).includes('SECRET') && !JSON.stringify(saved).includes('Private fixture name') && !JSON.stringify(saved).includes('config'));
    await page.getByRole('button', { name: '关闭业务窗口', exact: true }).click(); await page.getByRole('button', { name: '重开业务窗口', exact: true }).click();
    await page.getByRole('button', { name: '核对操作结果', exact: true }).waitFor(); check('window reopen keeps provider blocked', await page.getByRole('button', { name: '新增收款提供方', exact: true }).isDisabled());
    await page.getByRole('button', { name: '重新读取列表', exact: true }).click(); check('list reread does not unlock', (await markers(page)).length === 1);
    await page.reload(); await page.getByRole('button', { name: '核对操作结果', exact: true }).waitFor(); check('browser refresh keeps provider blocked', await page.getByRole('button', { name: '新增收款提供方', exact: true }).isDisabled());
    const second = await context.newPage(); second.setDefaultTimeout(9000); await second.goto(origin); await second.getByRole('button', { name: '核对操作结果', exact: true }).waitFor();
    check('second tab restores pending provider operation', await second.getByRole('button', { name: '新增收款提供方', exact: true }).isDisabled());
    await page.setViewportSize({ width: 390, height: 844 }); await shot('provider-unknown-mobile');
    await reviewProvider(page); await second.getByRole('button', { name: '核对操作结果', exact: true }).waitFor({ state: 'hidden' });
    check('manual review synchronizes unlock without POST', providerWrites() === 1 && (await markers(second)).length === 0);

    providerMode = 'success'; await page.getByRole('button', { name: '编辑', exact: true }).click(); await edit.getByLabel('名称', { exact: true }).fill('Known update');
    await edit.getByRole('button', { name: '保存提供方', exact: true }).click(); await edit.waitFor({ state: 'hidden' }); check('known provider success clears marker', (await markers(page)).length === 0);
    providerMode = 'reject'; await page.getByRole('button', { name: '编辑', exact: true }).click(); await edit.getByLabel('名称', { exact: true }).fill('Rejected update');
    await edit.getByRole('button', { name: '保存提供方', exact: true }).click(); await edit.getByText(/保存被拒绝/).waitFor(); check('provider 400 clears marker but preserves draft', (await markers(page)).length === 0 && await edit.getByLabel('名称', { exact: true }).inputValue() === 'Rejected update');
    await page.getByRole('button', { name: '关闭业务窗口', exact: true }).click(); await page.getByRole('button', { name: '重开业务窗口', exact: true }).click();

    providerMode = 'hold'; await page.getByRole('button', { name: '编辑', exact: true }).click(); await edit.getByLabel('名称', { exact: true }).fill('Held update'); await edit.getByRole('button', { name: '保存提供方', exact: true }).click();
    await second.getByRole('button', { name: '核对操作结果', exact: true }).waitFor(); check('storage event blocks other tab during POST', await second.getByRole('button', { name: '编辑', exact: true }).isDisabled());
    await reviewProvider(second); await second.getByText('操作仍在另一窗口执行，不能解除保护。', { exact: true }).waitFor(); check('Web Lock prevents in-flight manual unlock', (await markers(page)).length === 1);
    await page.evaluate(() => window.__r08Identify(100)); providerMode = 'success'; providerHold.resolve();
    await page.getByRole('button', { name: '编辑', exact: true }).waitFor();
    check('identity switch hides old marker and late success is fenced', await page.getByRole('button', { name: '核对操作结果', exact: true }).count() === 0 && (await markers(page)).some(m => m.owner === 99));
    await page.evaluate(() => window.__r08Identify(99)); await page.getByRole('button', { name: '核对操作结果', exact: true }).waitFor();
    await reviewProvider(page); await page.getByRole('button', { name: '核对操作结果', exact: true }).waitFor({ state: 'hidden' });
    await second.close();

    await page.goto(origin + '?app=refund'); await page.getByRole('button', { name: '退款', exact: true }).click();
    let refund = page.getByRole('dialog', { name: '退款 #42', exact: true }); await refund.getByRole('button', { name: '确认退款', exact: true }).click(); await refund.getByText(/退款结果尚未确认/).waitFor();
    check('refund timeout persists before any replay', refundWrites() === 1 && (await markers(page)).length === 1);
    await page.reload(); await page.getByRole('button', { name: '核对退款结果', exact: true }).waitFor(); await page.getByRole('button', { name: '退款', exact: true }).click();
    check('refund cannot be resubmitted after refresh', await refund.getByRole('button', { name: '确认退款', exact: true }).isDisabled());
    await refund.getByRole('button', { name: '核对退款结果', exact: true }).click();
    await page.getByRole('alertdialog', { name: '核对订单 #42 的退款结果', exact: true }).getByRole('button', { name: '已核对，解除保护', exact: true }).click();
    await refund.waitFor({ state: 'hidden' }); check('refund review does not submit a second refund', refundWrites() === 1 && (await markers(page)).length === 0);
    refundMode = 'force'; await page.getByRole('button', { name: '退款', exact: true }).click(); await refund.getByRole('button', { name: '确认退款', exact: true }).click();
    await refund.getByRole('button', { name: '确认强制退款', exact: true }).waitFor(); check('force still requires checkbox after persistence integration', await refund.getByRole('button', { name: '确认强制退款', exact: true }).isDisabled() && (await markers(page)).length === 0);
    await refund.getByLabel('我确认强制退款', { exact: false }).check(); await refund.getByRole('button', { name: '确认强制退款', exact: true }).click(); await refund.waitFor({ state: 'hidden' });
    check('explicit force success clears fresh lock', refundWrites() === 3 && (await markers(page)).length === 0);
    refundMode = 'pending'; await page.getByRole('button', { name: '退款', exact: true }).click(); await refund.getByRole('button', { name: '确认退款', exact: true }).click();
    await refund.waitFor({ state: 'hidden' }); await page.getByRole('button', { name: '查询退款', exact: true }).click();
    await page.getByText('退款仍在处理中，请稍后再次查询', { exact: true }).waitFor(); check('pending query preserves original refund lock', (await markers(page)).length === 1);
    await shot('refund-pending-mobile'); queryMode = 'success'; await page.getByRole('button', { name: '查询退款', exact: true }).click();
    await page.getByRole('button', { name: '核对退款结果', exact: true }).waitFor({ state: 'hidden' }); check('query definitive success unlocks without new refund', (await markers(page)).length === 0 && refundWrites() === 4);

    refundStatus = 'COMPLETED'; await page.reload(); await page.getByRole('button', { name: '退款', exact: true }).click();
    await page.evaluate(() => { const original = Storage.prototype.setItem; window.__r08RestoreStorage = () => Storage.prototype.setItem = original; Storage.prototype.setItem = function(key, value) { if (key.startsWith('sub2-payment-write-v1:')) throw new DOMException('quota fixture', 'QuotaExceededError'); return original.call(this, key, value); }; });
    await refund.getByRole('button', { name: '确认退款', exact: true }).click(); await refund.getByText(/无法安全保存或读取操作保护记录/).waitFor();
    check('storage write failure blocks real DOM refund POST', refundWrites() === 4); await page.evaluate(() => window.__r08RestoreStorage());
    await page.setViewportSize({ width: 1440, height: 900 }); await page.evaluate(() => window.__r08Theme('dark')); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await shot('storage-failure-dark');
    check('browser script errors absent', errors.length === 0); check('external traffic absent', external.length === 0);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ origin, checks, writes, errors, external, realBusinessWrites: 0 }, null, 2));
    console.log(JSON.stringify({ checks: checks.length, writes: writes.length, errors, realBusinessWrites: 0, origin }));
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'failure.json'), JSON.stringify({ message: error.message, checks, writes, errors }, null, 2)); }
    throw error;
  } finally { gates.forEach(g => g.resolve()); await browser?.close(); await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
