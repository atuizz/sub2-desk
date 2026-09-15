// Only a private Vite fixture on an OS-assigned port; every API request is intercepted.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/final-fixes/commerce-browser'), dir = path.join(out, 'fixture');
const req = createRequire(path.join(root, 'packages/sub2-console/package.json'));
function findPlaywright() {
  if (process.env.PARITY_PUBLIC_PLAYWRIGHT) return require(process.env.PARITY_PUBLIC_PLAYWRIGHT);
  for (const name of ['playwright', 'playwright-core']) { try { return req(name); } catch {} }
  const links = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/.links');
  if (fs.existsSync(links)) for (const file of fs.readdirSync(links)) {
    const target = fs.readFileSync(path.join(links, file), 'utf8').trim();
    if (fs.existsSync(target)) return require(target);
  }
  throw Error('No existing Playwright runtime found');
}
async function main() {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/entry.js"></script></html>');
  fs.writeFileSync(path.join(dir, 'entry.js'), `import {createApp} from 'vue';import {createPinia} from 'pinia';import App from './Fixture.vue';import '/@fs/${root.replaceAll('\\', '/')}/packages/sub2-console/src/style.css';createApp(App).use(createPinia()).mount('#app');`);
  fs.writeFileSync(path.join(dir, 'Fixture.vue'), `<script setup>
import Commerce from '@/apps/admin/CommerceApp.vue';import Subscriptions from '@/apps/admin/SubscriptionsApp.vue';import {useSystemStore} from '@/stores/system';import {useAuthStore} from '@/stores/auth';
const auth=useAuthStore();auth.user={id:99,role:'admin'};auth.token='r07-fixture';localStorage.setItem('auth_user',JSON.stringify(auth.user));localStorage.setItem('auth_token',auth.token);
const system=useSystemStore();window.__r07SetAppearance=system.setAppearance;
const query=new URLSearchParams(location.search),app=query.get('app'),win={customData:{tab:query.get('tab')||'orders'}};
</script><template><main class="fixture-window mac-window window-active"><Subscriptions v-if="app==='subscriptions'"/><Commerce v-else :win="win"/></main></template><style>
html:root,html:root body,html:root #app{margin:0;width:100%;height:100%;background:var(--bg-canvas)}.fixture-window{position:relative;margin:40px auto;width:min(1200px,calc(100% - 32px));height:calc(100% - 80px);background:var(--window-bg-solid);border-radius:16px;color:var(--text-primary);border:1px solid var(--border-subtle);overflow:hidden}@media(max-width:540px){.fixture-window{margin:0;width:100%;height:100%;border-radius:0}}
</style>`);
  const vite = await import(pathToFileURL(path.join(path.dirname(req.resolve('vite/package.json')), 'dist/node/index.js')).href);
  const vue = (await import(pathToFileURL(req.resolve('@vitejs/plugin-vue')).href)).default;
  const source = path.join(root, 'packages/sub2-console/src');
  // Vite treats port:0 as its default; reserve an OS-selected port explicitly.
  const probe = require('node:net').createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const fixturePort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const server = await vite.createServer({ configFile: false, root: dir, publicDir: path.join(root, 'packages/sub2-console/public'), plugins: [vue()],
    resolve: { alias: { '@': source, '@sub2-mac/core': path.join(root, 'packages/mac-ui-core/src/index.ts'), vue: req.resolve('vue/dist/vue.runtime.esm-bundler.js'), pinia: req.resolve('pinia') } },
    css: { postcss: { plugins: [req('tailwindcss')({ darkMode: 'class', content: [path.join(source, '**/*.{vue,ts}'), path.join(root, 'packages/mac-ui-core/src/**/*.vue'), path.join(dir, 'Fixture.vue')] }), req('autoprefixer')()] } },
    server: { host: '127.0.0.1', port: fixturePort, strictPort: true, fs: { allow: [root] } }, logLevel: 'error' });
  await server.listen(); const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const writes = [], errors = [], blocked = [], checks = [];
  const check = (name, pass) => { assert.ok(pass, name); checks.push(name); };
  const group = { id: 73, name: 'R07 订阅分组', subscription_type: 'subscription', platform: 'openai', status: 'active' };
  const plan = { id: 3, name: 'R07 套餐', group_id: 73, price: 10, features: '特性甲\n特性乙', validity_days: 30, validity_unit: 'days', for_sale: true };
  const orders = ['REFUND_REQUESTED', 'REFUND_FAILED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED'].map((status, i) => ({ id: i + 1, user_id: 7, status, amount: 100, pay_amount: 720, refund_amount: status === 'PARTIALLY_REFUNDED' ? 35 : 20, refund_request_reason: '测试申请', order_type: 'balance', payment_type: 'alipay', created_at: '2026-09-13T00:00:00Z' }));
  let browser;
  try {
    browser = await findPlaywright().chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), p = url.pathname;
      if (url.origin !== origin) { blocked.push(url.href); return route.abort(); }
      if (!p.startsWith('/api/')) return route.continue();
      const ok = data => route.fulfill({ json: { code: 0, data } });
      if (request.method() !== 'GET') {
        const body = request.postData() ? request.postDataJSON() : null; writes.push({ p, body });
        if (p.endsWith('/refund/query')) return ok({ success: false, warning: 'gateway refund is still pending confirmation' });
        if (p.endsWith('/refund')) return ok(body.force ? { success: true } : { success: false, require_force: true, warning: '余额不足，需要确认强制退款' });
        if (p.endsWith('/plans/3')) { assert.equal(typeof body.features, 'string'); return ok({ ...plan, ...body }); }
        if (p.endsWith('/redeem-codes/generate')) return ok([]);
        if (p.endsWith('/subscriptions/19/extend')) return ok({});
        throw Error('Unexpected fixture mutation: ' + p);
      }
      if (p.endsWith('/payment/orders')) return ok({ items: orders, total: 4 });
      if (p.endsWith('/payment/plans')) return ok([plan]);
      if (p.endsWith('/groups/all')) return ok([group]);
      if (p.endsWith('/redeem-codes')) return ok({ items: [], total: 0 });
      if (p.endsWith('/subscriptions')) return ok({ items: [{ id: 19, user_id: 7, group_id: 73, status: 'active', user: { email: 'r07@example.invalid' }, group, expires_at: new Date(Date.now() + 30 * 86400000).toISOString() }], total: 1 });
      if (p.endsWith('/users')) return ok({ items: [{ id: 7, email: 'r07@example.invalid' }], total: 1 });
      return route.fulfill({ status: 503, json: { message: 'Isolated unsupported read' } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000); page.on('pageerror', e => errors.push(e.message));
    const screenshot = name => page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' });
    await page.goto(origin + '?tab=plans'); await page.getByRole('button', { name: '编辑', exact: true }).click();
    const planSheet = page.getByRole('dialog', { name: '编辑订阅计划', exact: true });
    const features = planSheet.locator('textarea').nth(1); check('admin feature string visible in real form', await features.inputValue() === '特性甲\n特性乙');
    await features.fill('特性甲\n新增特性'); await planSheet.getByRole('button', { name: '取消', exact: true }).click();
    const discard = page.getByRole('alertdialog', { name: '放弃未保存的更改？', exact: true }); await discard.waitFor();
    await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
    await discard.waitFor({ state: 'hidden' });
    check('cancel preserves dirty plan through shared alert', await features.inputValue() === '特性甲\n新增特性');
    await screenshot('plan-light');
    const lightBackground = await planSheet.evaluate(el => getComputedStyle(el).backgroundColor);
    await page.evaluate(() => window.__r07SetAppearance('dark'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const darkBackground = await planSheet.evaluate(el => getComputedStyle(el).backgroundColor);
    if (lightBackground === darkBackground) console.log(JSON.stringify(await page.evaluate(() => ({
      ancestors: (() => { const rows=[];for(let node=document.querySelector('[role=dialog]');node;node=node.parentElement)rows.push({tag:node.tagName,class:node.className,style:node.getAttribute('style'),token:getComputedStyle(node).getPropertyValue('--window-bg-solid'),bg:getComputedStyle(node).backgroundColor});return rows; })()
    }))));
    check('theme changes real dialog background', lightBackground !== darkBackground);
    await screenshot('plan-dark');
    await planSheet.getByRole('button', { name: '保存套餐', exact: true }).click(); await planSheet.waitFor({ state: 'hidden' });
    check('plan save sends string and closes without discard prompt', writes.some(w => w.p.endsWith('/plans/3') && w.body.features === '特性甲\n新增特性'));

    await page.goto(origin); await page.getByRole('button', { name: '审核退款', exact: true }).click();
    const refund = page.getByRole('dialog', { name: '审核退款 #1', exact: true });
    await refund.getByRole('button', { name: '确认退款', exact: true }).click();
    const force = refund.getByRole('button', { name: '确认强制退款', exact: true }); await force.waitFor();
    check('force second submit disabled before explicit consent', await force.isDisabled());
    check('one normal request before consent', writes.filter(w => w.p.endsWith('/1/refund')).length === 1);
    await refund.getByLabel('我确认强制退款', { exact: false }).check();
    await page.setViewportSize({ width: 390, height: 844 }); await screenshot('refund-force-mobile');
    await refund.getByRole('button', { name: '取消', exact: true }).click(); await discard.waitFor(); await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
    check('force checkbox retained after continue editing', await refund.getByLabel('我确认强制退款', { exact: false }).isChecked());
    await force.click(); await refund.waitFor({ state: 'hidden' });
    check('forced request only after checkbox and submit', writes.filter(w => w.p.endsWith('/1/refund')).at(-1).body.force === true);
    await page.getByRole('button', { name: '查询退款', exact: true }).click();
    await page.getByText('退款仍在处理中，请稍后再次查询', { exact: true }).waitFor(); check('pending query reaches official route', writes.some(w => w.p.endsWith('/3/refund/query')));

    await page.goto(origin + '?tab=redeem'); await page.getByRole('button', { name: '生成兑换码', exact: true }).click();
    const generate = page.getByRole('dialog', { name: '批量生成兑换码', exact: true });
    await generate.getByLabel('卡券类型', { exact: true }).selectOption('subscription');
    await generate.getByLabel('订阅分组', { exact: true }).selectOption('73');
    await generate.getByLabel('兑换后订阅时长 (天)', { exact: true }).fill('14');
    await generate.getByLabel('兑换码领取期限 (天)', { exact: true }).fill('7');
    await screenshot('redeem-mobile');
    const panel = await generate.boundingBox(); check('390px generate dialog fits viewport', panel.x >= 0 && panel.x + panel.width <= 391 && panel.y + panel.height <= 845);
    await page.keyboard.press('Escape'); await discard.waitFor(); await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
    check('Escape uses shared dirty guard and retains group', await generate.getByLabel('订阅分组', { exact: true }).inputValue() === '73');
    await generate.getByRole('button', { name: '生成', exact: true }).click(); await generate.waitFor({ state: 'hidden' });
    const code = writes.filter(w => w.p.endsWith('/redeem-codes/generate')).at(-1).body;
    check('real DOM submits distinct group/duration/expiry', code.group_id === 73 && code.validity_days === 14 && code.expires_in_days === 7);

    await page.goto(origin + '?app=subscriptions'); await page.getByRole('button', { name: '调整', exact: true }).click();
    const adjust = page.getByRole('dialog', { name: '调整订阅有效期', exact: true }); await adjust.locator('input[type=number]').fill('-3');
    await adjust.getByRole('button', { name: '取消', exact: true }).click(); await discard.waitFor(); await discard.getByRole('button', { name: '继续编辑', exact: true }).click();
    await screenshot('subscription-mobile'); await adjust.getByRole('button', { name: '确认调整', exact: true }).click(); await adjust.waitFor({ state: 'hidden' });
    check('signed duration survives cancel and reaches original API', writes.some(w => w.p.endsWith('/subscriptions/19/extend') && w.body.days === -3));
    check('no unhandled browser errors', errors.length === 0); check('no external requests', blocked.length === 0);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ origin, checks, writes, errors, blocked, realBusinessWrites: 0 }, null, 2));
    console.log(JSON.stringify({ checks: checks.length, writes: writes.length, errors, realBusinessWrites: 0, output: out }));
  } finally { await browser?.close(); await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
