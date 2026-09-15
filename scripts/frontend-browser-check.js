async (page) => {
  const origin = 'http://127.0.0.1:5181';
  await page.unrouteAll({ behavior: 'wait' });
  const results = [];
  const check = (name, condition, details = {}) => {
    if (!condition) throw new Error(name + ': ' + JSON.stringify(details));
    results.push({ name, passed: true, ...details });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?ui-lab');
  const workspace = page.getByRole('region', { name: '工作空间', exact: true });
  await workspace.waitFor();
  await workspace.getByRole('button', { name: '新建项目', exact: true }).click();
  const sheet = workspace.getByRole('dialog', { name: '新建项目' });
  await sheet.waitFor();
  await sheet.getByRole('textbox').fill('浏览器验收示例');
  await page.keyboard.press('Enter');
  await workspace.getByText('浏览器验收示例', { exact: true }).waitFor();
  await sheet.waitFor({ state: 'detached' });
  check('Sheet Enter submits and returns to content', await sheet.count() === 0);

  await workspace.getByRole('button', { name: '移除项目', exact: true }).click();
  await workspace.getByRole('alertdialog').waitFor();
  await page.getByRole('button', { name: '打开第二个窗口', exact: true }).click();
  const library = page.getByRole('region', { name: '资源库', exact: true });
  await library.waitFor();
  await library.getByRole('button', { name: '移除项目', exact: true }).click();
  await library.getByRole('alertdialog').waitFor();
  // Safe default: Enter cancels only the focused dialog, never both windows.
  await page.keyboard.press('Enter');
  await library.getByRole('alertdialog').waitFor({ state: 'detached' });
  check('Two windows: Enter only dismisses foreground alert', await workspace.getByRole('alertdialog').count() === 1);
  await page.getByRole('navigation').getByRole('button', { name: '工作空间', exact: true }).click();
  await page.keyboard.press('Escape');
  await workspace.getByRole('alertdialog').waitFor({ state: 'detached' });
  check('Escape restores the focused window', await workspace.getByRole('alertdialog').count() === 0);
  await workspace.getByRole('button', { name: '新建项目', exact: true }).click();
  await sheet.waitFor();
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    check('Tab remains inside sheet ' + i, await sheet.evaluate(el => el.contains(document.activeElement)));
  }
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/frontend-core-sheet.png' });
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '深色外观', exact: true }).click();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/frontend-core-dark.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.window')).filter(el => el.getClientRects().length).every(el => el.getBoundingClientRect().right <= innerWidth + 1));
  const compact = await page.evaluate(() => ({
    width: innerWidth,
    windows: Array.from(document.querySelectorAll('.window')).filter(el => el.getClientRects().length).map(el => ({ x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right })),
    dockRight: document.querySelector('nav')?.getBoundingClientRect().right,
  }));
  check('Compact windows and Dock fit viewport', compact.windows.length > 0 && compact.windows.every(w => w.x >= 0 && w.right <= compact.width + 1) && compact.dockRight <= compact.width + 1, compact);
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/frontend-core-mobile.png' });

  // All business calls below are intercepted fixtures, never a real backend.
  const accounts = Array.from({ length: 41 }, (_, i) => ({
    id: i + 1, name: ['Claude · 主力账号', 'OpenAI · 团队账号', 'Gemini · 备用账号'][i % 3] + ' ' + (i + 1),
    platform: ['anthropic', 'openai', 'gemini'][i % 3], type: 'apikey', status: i % 8 === 0 ? 'inactive' : 'active',
    concurrency: 10, priority: i % 3, weight: 1, rate_multiplier: 1, group_ids: [1], groups: [{ id: 1, name: '默认分组' }],
    created_at: '2026-09-08T00:00:00Z', schedulable: true, credentials: {}, extra: {}
  }));
  let failAccounts = false;
  let deletes = 0;
  const accountRequests = [];
  await page.route('**/health', route => route.fulfill({ json: { status: 'ok' } }));
  await page.route(origin + '/api/**', async route => {
    const requestUrl = route.request().url();
    const pathname = requestUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (pathname === '/api/v1/admin/accounts') {
      if (failAccounts) return route.fulfill({ status: 503, json: { code: 503, message: '测试环境暂时无法连接' } });
      const currentPage = Number(requestUrl.match(/[?&]page=(\d+)/)?.[1] || 1);
      const size = Number(requestUrl.match(/[?&]page_size=(\d+)/)?.[1] || 20);
      accountRequests.push(currentPage);
      return route.fulfill({ json: { code: 0, data: { items: accounts.slice((currentPage - 1) * size, currentPage * size), total: accounts.length, page: currentPage, page_size: size, pages: Math.ceil(accounts.length / size) } } });
    }
    if (route.request().method() === 'DELETE') { deletes++; return route.fulfill({ json: { code: 0, data: {} } }); }
    if (pathname === '/api/v1/auth/me') return route.fulfill({ json: { code: 0, data: { id: 999, username: '前端验收', email: 'preview@example.invalid', role: 'admin', status: 'active', balance: 0, concurrency: 5 } } });
    if (pathname.includes('/groups')) return route.fulfill({ json: { code: 0, data: [{ id: 1, name: '默认分组', platform: 'anthropic', status: 'active' }] } });
    return route.fulfill({ json: { code: 0, data: {} } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?noboot&unlocked&app=accounts');
  const accountWindow = page.getByRole('region', { name: '账号管理', exact: true });
  await accountWindow.getByRole('button', { name: '编辑账号 Claude · 主力账号 1', exact: true }).waitFor();
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/frontend-accounts-light.png' });
  await accountWindow.getByRole('button', { name: '下一页', exact: true }).click();
  await accountWindow.getByRole('button', { name: '编辑账号 Gemini · 备用账号 21', exact: true }).waitFor();
  check('Accounts uses server pagination', accountRequests.includes(2), { requestedPages: accountRequests });
  await accountWindow.getByRole('button', { name: '删除账号 Gemini · 备用账号 21', exact: true }).click();
  await accountWindow.getByRole('alertdialog').waitFor();
  check('Delete waits for explicit confirmation', deletes === 0);
  await page.keyboard.press('Escape');
  check('Cancel sends no delete request', deletes === 0);
  failAccounts = true;
  await accountWindow.getByRole('button', { name: '刷新账号列表', exact: true }).click();
  await accountWindow.getByText('测试环境暂时无法连接', { exact: false }).waitFor();
  check('Failed refresh shows error and keeps existing rows', await accountWindow.getByText('Gemini · 备用账号 21', { exact: true }).count() > 0);
  await page.screenshot({ animations: 'disabled', path: 'output/playwright/frontend-accounts-error.png' });
  return { passed: true, results, realBackendRequests: 0, note: 'Business fixtures intercepted in this browser session only. This is not real backend acceptance.' };
}
