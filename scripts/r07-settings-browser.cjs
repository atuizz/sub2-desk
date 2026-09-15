// npx --yes --package=playwright -c "node scripts/r07-settings-browser.cjs"
// Owned ephemeral Vite + headless Chrome; every API call is intercepted. No real settings/payment/SMTP writes.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), os = require('node:os');
const { createRequire } = require('node:module'), { pathToFileURL } = require('node:url');
const pkg = path.resolve(__dirname, '../packages/sub2-console'), root = path.resolve(pkg, '../..'), local = createRequire(path.join(pkg, 'package.json'));
const output = path.join(root, 'output/final-fixes/settings-browser'), cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sub2-settings-r07-'));
let server, browser, lastPage; const checks = [], pageErrors = [], forbidden = [];
function playwright() {
  for (const candidate of ['playwright', process.env.PLAYWRIGHT_MODULE, ...process.env.PATH.split(path.delimiter).map(p => path.join(p, '..', 'playwright'))].filter(Boolean)) { try { return require(candidate); } catch {} }
  throw Error('Playwright module unavailable: run through npx --package=playwright');
}
const plugin = {
  name: 'settings-r07-fixture', enforce: 'pre',
  resolveId(id) { if (id === '/__settings_fixture.js') return '\0settings-fixture'; },
  load(id) { if (id === '\0settings-fixture') return `import {createApp,h} from 'vue'; import {createPinia} from 'pinia'; import Settings from '/src/apps/user/SettingsApp.vue'; import {useAuthStore} from '/src/stores/auth.ts'; import '/src/style.css';
    const app=createApp({render:()=>h('div',{style:'height:100vh;position:relative;overflow:hidden'},[h(Settings,{win:{customData:{tab:'admin_payment'}}})])}); const pinia=createPinia();app.use(pinia);useAuthStore(pinia).user={id:9907,role:'admin',username:'设置验收',email:'fixture@example.invalid',status:'active'};app.mount('#app');`; },
  transformIndexHtml(html) { return html.replace('/src/main.ts', '/__settings_fixture.js'); },
  configureServer(s) { s.middlewares.use((req, res, next) => { if (/^\/(api|v1|health|setup)\//.test(req.url)) { forbidden.push('unintercepted API'); res.statusCode = 500; res.end('Fixture API required'); } else next(); }); },
};
function settingsData() { return {
  backend_mode_enabled: false, site_name: '设置验收', site_subtitle: '', api_base_url: '', custom_endpoints: [], custom_menu_items: [],
  smtp_host: 'smtp.fixture.invalid', smtp_port: 587, smtp_username: 'fixture', smtp_from_email: 'fixture@example.invalid', smtp_from_name: 'Fixture', smtp_use_tls: true, smtp_password_configured: true,
  turnstile_enabled: false, turnstile_site_key: 'site-fixture', turnstile_secret_key_configured: true, linuxdo_connect_enabled: false, wechat_connect_enabled: false,
  payment_enabled: true, payment_min_amount: 1, payment_max_amount: 500, payment_daily_limit: 1000, payment_order_timeout_minutes: 30, payment_max_pending_orders: 3, payment_balance_disabled: false, payment_balance_recharge_multiplier: 1, payment_subscription_usd_to_cny_rate: 0, payment_recharge_fee_rate: 0, payment_load_balance_strategy: 'round-robin', payment_enabled_types: ['stripe', 'easypay', 'future'], payment_product_name_prefix: '', payment_product_name_suffix: '', payment_help_image_url: '', payment_help_text: '', payment_cancel_rate_limit_enabled: false, payment_cancel_rate_limit_max: 3, payment_cancel_rate_limit_window: 1, payment_cancel_rate_limit_unit: 'hour', payment_cancel_rate_limit_window_mode: 'rolling', payment_alipay_force_qrcode: false, payment_alipay_mobile_precreate_deep_link: false,
}; }
const sample = id => ({ id, provider_key: 'stripe', name: `Stripe ${id}`, config: { publishableKey: 'pk_fixture', currency: 'CNY', secretKey: 'MUST-NOT-RENDER' }, supported_types: ['card'], enabled: true, payment_mode: '', refund_enabled: false, allow_user_refund: false, limits: '', sort_order: id - 1 });
async function main() {
  fs.mkdirSync(output, { recursive: true }); process.chdir(pkg);
  const viteModule = await import(pathToFileURL(local.resolve('vite')).href), vite = viteModule.default || viteModule, vue = (await import(pathToFileURL(local.resolve('@vitejs/plugin-vue')).href)).default;
  const probe = require('node:net').createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const fixturePort = probe.address().port; await new Promise(resolve => probe.close(resolve));
  server = await vite.createServer({ configFile: false, root: pkg, cacheDir, envFile: false, logLevel: 'error', plugins: [plugin, vue()], resolve: { alias: { '@': path.join(pkg, 'src'), '@sub2-mac/core': path.join(root, 'packages/mac-ui-core/src/index.ts') } }, optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia', 'axios', '@vueuse/core', 'qrcode'] }, server: { watch: null, host: '127.0.0.1', port: fixturePort, strictPort: true, hmr: false, fs: { allow: [root] } } });
  await server.listen(); const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const chrome = process.env.PLAYWRIGHT_CHROME || (fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
  browser = await playwright().chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); lastPage = page; page.setDefaultTimeout(15000); page.on('pageerror', e => pageErrors.push(e.message));
  let state = settingsData(), rows = [sample(1), sample(2)], writes = [], failRead = false, unknownCreate = false;
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.route(origin + '/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), p = url.pathname.replace('/api/v1', ''), method = request.method();
    const ok = data => route.fulfill({ json: { code: 0, data } });
    if (method !== 'GET') {
      const body = request.postDataJSON(); writes.push({ method, path: p, body });
      if (p === '/admin/settings' && method === 'PUT') { const { smtp_password, turnstile_secret_key, ...safe } = body; state = { ...state, ...safe }; if (smtp_password) state.smtp_password_configured = true; if (turnstile_secret_key) state.turnstile_secret_key_configured = true; return ok(state); }
      if (['/admin/settings/test-smtp', '/admin/settings/send-test-email'].includes(p)) return ok({ message: 'Fixture success' });
      if (p === '/admin/settings/panel-rate-limit') return ok(body);
      if (p === '/admin/payment/providers' && method === 'POST') { if (unknownCreate) return route.abort('failed'); const id = 3; rows.push({ id, ...body }); return ok({ id, config: 'encrypted-server-data' }); }
      const match = p.match(/^\/admin\/payment\/providers\/(\d+)$/);
      if (match && method === 'PUT') { const id = Number(match[1]); rows = rows.map(r => r.id === id ? { ...r, ...body, config: { ...r.config, ...body.config } } : r); return ok({ id }); }
      if (match && method === 'DELETE') { rows = rows.filter(r => r.id !== Number(match[1])); return ok({ message: 'deleted' }); }
      forbidden.push(method + ' ' + p); return route.fulfill({ status: 400, json: { code: 400, message: 'Unexpected fixture mutation' } });
    }
    if (p === '/admin/payment/providers') return failRead ? route.fulfill({ status: 503, json: { code: 503, message: 'fixture read failure' } }) : ok(rows);
    if (p === '/admin/settings') return ok(state);
    if (p === '/settings/public') return ok({ site_name: 'Fixture', version: '0.2.4' });
    if (p === '/user/profile' || p === '/auth/me') return ok({ id: 9907, role: 'admin', username: '设置验收', email: 'fixture@example.invalid', status: 'active' });
    if (p === '/admin/settings/panel-rate-limit') return ok({ enabled: true, user_rpm: 240, heavy_rpm: 60, exempt_admin: true, public_ip_rpm: 300 });
    if (p === '/admin/settings/admin-api-key') return ok({ exists: false, masked_key: '' });
    return ok({});
  });
  await page.addInitScript(() => { localStorage.setItem('auth_token', 'settings-fixture-not-real'); sessionStorage.setItem('sub2_booted', 'true'); });
  const check = (name, pass) => { assert(pass, name); checks.push(name); };
  const tab = async name => { const button = page.getByRole('button', { name, exact: true }); if (!await button.isVisible()) await page.getByRole('button', { name: '设置分类', exact: true }).click(); await button.click(); };
  const settle = async () => { await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]')); };
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 }); await page.getByRole('button', { name: '新增收款提供方', exact: true }).waitFor(); await settle();
  await page.getByLabel('最小充值金额（CNY，0 为不限）').fill('5'); await page.getByLabel('每用户待付款订单上限').fill('6'); await page.getByLabel('收款分配策略').selectOption('least-amount');
  await page.getByRole('button', { name: '保存配置', exact: true }).click(); await settle();
  check('payment limits and strategy submit exact differential payload', JSON.stringify(writes[0].body) === JSON.stringify({ payment_min_amount: 5, payment_max_pending_orders: 6, payment_load_balance_strategy: 'least-amount' }));
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'payment-light-1440.png') });
  await page.evaluate(() => document.documentElement.classList.add('dark')); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); await page.screenshot({ animations: 'disabled', path: path.join(output, 'payment-dark-1440.png') }); await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.getByRole('button', { name: '上移 Stripe 2' }).click(); await settle(); check('provider reorder persists official sort_order only', writes.slice(-2).every(w => Object.keys(w.body).join() === 'sort_order'));
  await page.locator('.provider-row').first().getByRole('button', { name: '编辑', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '编辑收款提供方', exact: true }); await dialog.waitFor();
  check('provider secrets are blank masked inputs despite secret in fixture GET', await dialog.getByLabel('Secret Key', { exact: true }).inputValue() === '' && await dialog.getByLabel('Secret Key', { exact: true }).getAttribute('type') === 'password' && !(await page.locator('body').innerText()).includes('MUST-NOT-RENDER'));
  await dialog.getByLabel('名称', { exact: true }).fill('Stripe 修改'); await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('alertdialog', { name: '放弃未保存的更改？', exact: true }).waitFor(); await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  check('cancel invokes discard protection and preserves draft', await dialog.getByLabel('名称', { exact: true }).inputValue() === 'Stripe 修改');
  await dialog.getByRole('button', { name: '保存提供方', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); check('provider edit patch omits blank secrets and immutable provider key', JSON.stringify(writes.at(-1).body) === JSON.stringify({ name: 'Stripe 修改' }));
  await page.getByRole('button', { name: '新增收款提供方', exact: true }).click(); dialog = page.getByRole('dialog', { name: '新增收款提供方', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('名称', { exact: true }).fill('草稿提供方'); await dialog.getByRole('switch', { name: '启用此提供方', exact: true }).click();
  await dialog.getByRole('button', { name: '保存提供方', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); check('create is wired through official POST', writes.at(-1).path === '/admin/payment/providers' && writes.at(-1).body.provider_key === 'easypay');
  const created = page.locator('.provider-row').filter({ hasText: '草稿提供方' }), before = writes.length;
  await created.getByRole('button', { name: '删除', exact: true }).click(); await page.getByRole('alertdialog', { name: '删除收款提供方', exact: true }).waitFor();
  check('delete waits for confirmation', writes.length === before); await page.getByRole('alertdialog', { name: '删除收款提供方', exact: true }).getByRole('button', { name: '删除', exact: true }).click(); await settle(); check('delete confirmed issues DELETE', writes.at(-1).method === 'DELETE');
  await tab('邮件设置'); await page.getByLabel('SMTP 密码', { exact: false }).fill('fixture-new-password');
  await page.getByRole('button', { name: '测试握手', exact: true }).click(); await settle(); check('SMTP test uses entered password without first saving', writes.at(-1).body.smtp_password === 'fixture-new-password');
  await page.getByRole('button', { name: '保存配置', exact: true }).click(); await settle(); check('SMTP save clears secret and sends only nonempty credential', await page.getByLabel('SMTP 密码', { exact: false }).inputValue() === '' && JSON.stringify(writes.at(-1).body) === JSON.stringify({ smtp_password: 'fixture-new-password' }));
  await tab('安全与认证'); await page.getByLabel('Turnstile Secret Key', { exact: false }).fill('fixture-turnstile'); await page.getByRole('button', { name: '保存配置', exact: true }).click(); await settle();
  check('Turnstile secret save uses exact field and clears input', writes.some(w => w.body?.turnstile_secret_key === 'fixture-turnstile') && await page.getByLabel('Turnstile Secret Key', { exact: false }).inputValue() === '');
  await tab('支付设置'); await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('button', { name: '新增收款提供方', exact: true }).click(); dialog = page.getByRole('dialog', { name: '新增收款提供方', exact: true }); await dialog.waitFor();
  await dialog.getByLabel('名称', { exact: true }).fill('窄屏草稿'); await page.keyboard.press('Tab'); check('Tab focus stays in provider dialog', await dialog.evaluate(el => el.contains(document.activeElement)));
  const bounds = await dialog.boundingBox(), saveBounds = await dialog.getByRole('button', { name: '保存提供方', exact: true }).boundingBox();
  check('390px dialog and footer remain inside viewport', bounds.x >= 0 && bounds.x + bounds.width <= 390 && saveBounds.y >= 0 && saveBounds.y + saveBounds.height <= 844);
  await page.screenshot({ animations: 'disabled', path: path.join(output, 'provider-mobile-390.png') }); await page.keyboard.press('Escape'); await page.getByRole('alertdialog', { name: '放弃未保存的更改？', exact: true }).waitFor(); await page.getByRole('button', { name: '放弃更改', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); checks.push('Escape confirms before discarding provider draft');
  failRead = true; await page.getByRole('button', { name: '重新读取列表', exact: true }).click(); await settle(); check('provider loading error disables create', await page.getByRole('button', { name: '新增收款提供方', exact: true }).isDisabled()); failRead = false; await page.getByRole('button', { name: '重新读取列表', exact: true }).click(); await settle();
  await page.getByRole('button', { name: '新增收款提供方', exact: true }).click(); dialog = page.getByRole('dialog', { name: '新增收款提供方', exact: true });
  await dialog.getByLabel('提供方类型').selectOption('alipay'); await dialog.getByLabel('名称', { exact: true }).fill('PEM 夹具'); await dialog.getByRole('switch', { name: '启用此提供方', exact: true }).click();
  const pem = '-----BEGIN PRIVATE KEY-----\nfixture-only\n-----END PRIVATE KEY-----';
  await dialog.getByLabel('应用私钥', { exact: true }).evaluate((el, value) => { const clipboardData = new DataTransfer(); clipboardData.setData('text', value); el.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true })); }, pem);
  check('PEM remains masked in browser', await dialog.getByLabel('应用私钥', { exact: true }).getAttribute('type') === 'password');
  await dialog.getByRole('button', { name: '保存提供方', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); check('PEM request retains original line breaks', writes.at(-1).body.config.privateKey === pem);
  unknownCreate = true; await page.getByRole('button', { name: '新增收款提供方', exact: true }).click(); dialog = page.getByRole('dialog', { name: '新增收款提供方', exact: true }); await dialog.getByLabel('名称', { exact: true }).fill('结果未知'); await dialog.getByRole('switch', { name: '启用此提供方', exact: true }).click(); await dialog.getByRole('button', { name: '保存提供方', exact: true }).click(); await settle(); check('unknown create disables repeated submission', await dialog.getByRole('button', { name: '保存提供方', exact: true }).isDisabled());
  check('no script errors or unexpected writes', pageErrors.length === 0 && forbidden.length === 0);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, pageErrors, forbidden, fixtureWrites: writes.length, realWrites: 0 }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, fixtureWrites: writes.length, realWrites: 0, output })); await context.close();
}
main().catch(async e => { console.error(e); console.error(JSON.stringify({pageErrors,forbidden,checks})); if(lastPage){await lastPage.screenshot({path:path.join(output,'failure.png')});fs.writeFileSync(path.join(output,'failure.txt'),await lastPage.locator('body').innerText());} process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); if (server) await server.close(); const resolved = path.resolve(cacheDir); if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('sub2-settings-r07-')) fs.rmSync(resolved, { recursive: true, force: true }); });
