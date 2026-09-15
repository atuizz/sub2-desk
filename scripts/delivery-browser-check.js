async (page) => {
  const origin = 'http://127.0.0.1:5181';
  const checks = [], writes = [], errors = [];
  const check = (name, passed) => { if (!passed) throw new Error(name); checks.push(name); };
  let orderStatus = 'PENDING';
  const user = { id: 998, username: '交付验收', email: 'fixture@example.invalid', role: 'admin', status: 'active', balance: 20, concurrency: 5 };
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route(origin + '/health', r => r.fulfill({ json: { status: 'ok' } }));
  await page.route(origin + '/api/**', async r => {
    const req = r.request(), path = req.url().split('?')[0];
    const ok = data => r.fulfill({ json: { code: 0, data } });
    if (req.method() !== 'GET') {
      writes.push({ path, body: req.postDataJSON() });
      if (path.endsWith('/payment/orders')) return ok({ order_id: 101, amount: 10, pay_amount: 10, currency: 'CNY', qr_code: 'https://pay.example.invalid/101', pay_url: 'https://pay.example.invalid/101', expires_at: '2099-01-01' });
      return r.fulfill({ status: 403, json: { code: 403, message: 'Fixture write blocked' } });
    }
    if (path.endsWith('/auth/me') || path.endsWith('/user/profile')) return ok(user);
    if (path.endsWith('/payment/checkout-info')) return ok({ methods: { alipay: { display_name: '支付宝', available: true, fee_rate: 0, single_min: 1, single_max: 1000 } }, plans: [{ id: 1, name: '测试订阅', price: 10, for_sale: true, features: [], validity_days: 30, group_name: '测试分组' }], balance_recharge_multiplier: 1 });
    if (path.endsWith('/payment/orders/101')) return ok({ id: 101, status: orderStatus });
    if (path.endsWith('/groups/all')) return ok([]);
    if (path.endsWith('/admin/users') || path.endsWith('/admin/groups') || path.endsWith('/admin/channels') || path.endsWith('/admin/channel-monitors') || path.endsWith('/payment/orders/my')) return ok({ items: [], total: 0, pages: 1 });
    return ok({});
  });
  await page.addInitScript(() => { localStorage.setItem('auth_token', 'delivery-fixture-token'); sessionStorage.setItem('sub2_booted', 'true'); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?noboot&unlocked');
  await page.waitForFunction(() => window.__macOS?.authStore?.isAdmin);
  async function open(id, name) {
    await page.evaluate(id => { const w = window.__macOS.wm; for (const win of [...w.windows.value]) w.closeWindow(win.id); w.openApp(id); }, id);
    const win = page.getByRole('region', { name, exact: true });
    await win.waitFor(); return win;
  }
  for (const [id, title, action] of [['users', '用户管理', '创建用户'], ['groups', '分组管理', '创建分组'], ['channels', '渠道管理', '+ 创建渠道']]) {
    const win = await open(id, title);
    await win.getByRole('button', { name: action, exact: true }).first().click();
    const sheet = win.getByRole('dialog'); await sheet.waitFor();
    for (let i=0;i<14;i++) await page.keyboard.press('Tab');
    check(title + ' Tab 留在弹窗', await sheet.evaluate(el => el.contains(document.activeElement)));
    await page.setViewportSize({ width: 390, height: 844 });
    check(title + ' 窄屏弹窗可达', await sheet.evaluate(el => {const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight;}));
    await page.screenshot({ path: 'output/playwright/release/' + id + '-sheet-mobile.png', animations: 'disabled' });
    await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
    check(title + ' 取消不发送写请求', writes.length === 0);
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const wallet = await open('wallet', '购买与充值');
  await wallet.getByRole('button', { name: '订阅', exact: true }).click();
  await wallet.getByRole('button', { name: '立即订阅', exact: true }).click();
  const plan = wallet.getByRole('dialog', { name: '订阅套餐', exact: true });
  await plan.waitFor();
  check('订阅先选择支付方式', writes.length === 0);
  await plan.getByRole('button', { name: '创建订单', exact: true }).click();
  const payment = wallet.getByRole('dialog', { name: '完成支付', exact: true });
  await payment.getByRole('img', { name: '订单支付二维码' }).waitFor();
  check('订阅订单 payload 正确', writes[0].body.order_type === 'subscription' && writes[0].body.plan_id === 1);
  check('支付链接可见', await payment.getByRole('link', { name: '打开支付页面 ↗' }).getAttribute('href') === 'https://pay.example.invalid/101');
  await payment.getByRole('button', { name: '查询支付结果', exact: true }).click();
  await payment.getByText('尚未收到支付结果，请稍后重试', { exact: true }).waitFor();
  check('待支付不当作已入账', true);
  orderStatus = 'COMPLETED';
  await payment.getByRole('button', { name: '查询支付结果', exact: true }).click();
  await payment.getByText('支付已完成', { exact: true }).waitFor();
  await page.screenshot({ path: 'output/playwright/release/payment-sheet.png', animations: 'disabled' });
  check('支付完成回读且不自动重启/跳转', writes.length === 1);
  check('页面无异常', errors.length === 0);
  return { passed: true, checks, fixtureOnly: true, interceptedWrites: writes.length, pageErrors: errors };
}
