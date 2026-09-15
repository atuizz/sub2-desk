async (page) => {
  const origin = 'http://127.0.0.1:5181';
  const checks = [], writes = [], requests = [], errors = [];
  let scenario = 'warning';
  page.on('pageerror', error => errors.push(error.message));
  const check = (name, pass) => { if (!pass) throw new Error(name); checks.push(name); };
  await page.unrouteAll({ behavior: 'wait' });
  await page.route('**/health', route => route.fulfill({ json: { status: 'ok' } }));
  await page.route(origin + '/api/**', async route => {
    const request = route.request(), url = request.url(), path = url.split('?')[0];
    if (request.method() !== 'GET') {
      writes.push(path);
      if (path.endsWith('/system/update')) return route.fulfill({ json: { code: 0, data: { message: 'Updated', need_restart: true } } });
      return route.fulfill({ status: 403, json: { code: 403, message: 'Unexpected fixture write' } });
    }
    let data = {};
    if (path.endsWith('/auth/me') || path.endsWith('/user/profile')) data = { id: 9001, username: '版本验收', email: 'fixture@example.invalid', role: 'admin', status: 'active', balance: 0 };
    if (path.endsWith('/admin/compliance/status')) data = { required: false };
    if (path.endsWith('/check-updates')) {
      requests.push(url);
      if (scenario === 'failure') return route.fulfill({ status: 503, json: { code: 503, message: '更新源暂不可用' } });
      data = scenario === 'malformed' ? {} : { current_version: '1.0.0', latest_version: scenario === 'latest' ? '1.0.0' : '1.1.0', has_update: scenario === 'update', cached: scenario === 'cached', build_type: 'release' };
      if (scenario === 'warning' || scenario === 'cached') { data.warning = 'GitHub API rate limit exceeded'; data.has_update = scenario === 'cached'; }
    }
    if (path.endsWith('/rollback-versions')) data = { versions: [] };
    await route.fulfill({ json: { code: 0, data } });
  });
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'version-fixture-token');
    localStorage.setItem('sub2-desktop-preferences', JSON.stringify({ appearance: 'light', isDark: false, volume: 0 }));
    sessionStorage.setItem('sub2_booted', 'true');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?noboot&unlocked&app=settings');
  const win = page.getByRole('region', { name: '系统设置', exact: true });
  await win.getByRole('button', { name: '软件更新', exact: true }).click();
  const panel = win.getByRole('region', { name: '软件更新', exact: true });
  await panel.getByText('未能确认最新版本', { exact: true }).waitFor();
  check('原版 warning 不显示已是最新', !(await panel.innerText()).includes('当前已是最新版本'));
  const beforeAccepted = requests.length;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('admin-compliance-accepted')));
  await page.waitForFunction(() => !document.querySelector('.software-update button[aria-busy="true"]'));
  check('合规确认后只重试一次，没有同名事件递归', requests.length === beforeAccepted + 1);
  check('管理员身份使用标准 Axios 响应恢复', await win.getByText('平台管理员', { exact: true }).count() > 0);
  check('更新页没有无关保存按钮或假前端检查', await win.getByRole('button', { name: '保存配置', exact: true }).count() === 0 && await panel.getByRole('button', { name: '检查前端更新' }).count() === 0);
  const retry = panel.getByRole('button', { name: '检查后端更新', exact: true });
  for (const mode of ['cached', 'failure', 'malformed', 'latest', 'update']) {
    scenario = mode;
    await retry.click();
    await page.waitForFunction(() => !document.querySelector('.software-update button[aria-busy="true"]'));
    if (['cached', 'failure', 'malformed'].includes(mode)) {
      await panel.getByText('未能确认最新版本', { exact: true }).waitFor();
      check(mode + ' 失败/缓存不误报最新', !(await panel.innerText()).includes('当前已是最新版本'));
      if (mode === 'cached') check('缓存发行信息禁止直接安装', await panel.getByRole('button', { name: '安装更新', exact: true }).isDisabled());
    } else if (mode === 'latest') await panel.getByText('当前已是最新版本 1.0.0', { exact: true }).waitFor();
    else await panel.getByText('发现新版本 1.1.0', { exact: true }).waitFor();
  }
  check('手动检查携带 force=true', requests.slice(1).every(url => /[?&]force=true(?:&|$)/.test(url)));
  await panel.getByRole('button', { name: '安装更新', exact: true }).click();
  await win.getByRole('alertdialog').waitFor();
  check('安装先确认', writes.length === 0);
  await page.keyboard.press('Escape');
  check('取消安装不写入', writes.length === 0);
  await page.screenshot({ path: 'output/playwright/release/version-light.png', animations: 'disabled' });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('dark'));
  await page.screenshot({ path: 'output/playwright/release/version-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/release/version-mobile.png', animations: 'disabled' });
  check('390px 更新页无横向溢出', await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await panel.getByRole('button', { name: '安装更新', exact: true }).click();
  await win.getByRole('alertdialog').getByRole('button', { name: '确认执行', exact: true }).click();
  await panel.getByText('版本替换成功，请重启后端服务后再检查版本。', { exact: true }).waitFor();
  check('安装结果保留且不会自动重启', writes.length === 1 && writes[0].endsWith('/system/update'));
  check('无页面异常', errors.length === 0);
  return { passed: true, checks, writes, fixtureOnly: true, pageErrors: errors };
}
