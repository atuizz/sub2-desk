// Dedicated Playwright CLI session ONLY. Every API and external request is intercepted.
// playwright-cli -s=desktop-accounts-20260912 run-code --filename scripts/desktop-accounts-browser.js
async (page) => {
  const origin = 'http://127.0.0.1:5197';
  const results = [], errors = [], writes = [], queries = [];
  let outcome = 'partial';
  const chooseFile = (input, name, text) => input.evaluate((el, data) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([data.text], data.name, { type: 'application/json' }));
    el.files = transfer.files; el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { name, text });
  await page.unrouteAll({ behavior: 'wait' });

  const check = (name, condition) => { if (!condition) throw Error(name); results.push(name); };
  const payload = suffix => ({ type: 'sub2api-data', version: 1, exported_at: '2026-09-12T00:00:00Z', proxies: [], accounts: [
    { name: 'Fixture ' + suffix, platform: 'openai', type: 'apikey', concurrency: 5, priority: 1, credentials: { api_key: 'NEVER_DISPLAY_SECRET' } },
    { name: 'Fixture Claude ' + suffix, platform: 'anthropic', type: 'oauth', concurrency: 5, priority: 1, credentials: { access_token: 'NEVER_DISPLAY_SECRET' } },
  ] });
  const accounts = ['anthropic','openai','gemini','grok','kimi','zhipu','deepseek','antigravity'].map((platform, i) => ({
    id: i + 1, name: ['生产主账号 · Claude', '开发工作区 · OpenAI', 'Gemini 长上下文', 'Grok 备用账号'][i] || platform + ' 工作账号', platform, type: i % 2 ? 'apikey' : 'oauth', status: i === 2 ? 'error' : i === 3 ? 'inactive' : 'active', concurrency: 10, priority: 1, rate_multiplier: 1, groups: [{ id: 1, name: '开发者分组' }], group_ids: [1], credentials: {}, created_at: '2026-09-12T00:00:00Z', schedulable: i !== 4,
  }));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), requestURL = request.url();
    const local = requestURL.startsWith(origin + '/');
    const rest = local ? requestURL.slice(origin.length) : requestURL;
    const pathname = rest.split('?')[0];
    const platformFilter = decodeURIComponent((rest.match(/[?&]platform=([^&]+)/) || [])[1] || '');
    const url = { pathname, origin: local ? origin : '', searchParams: { get: key => key === 'platform' ? platformFilter : '' } };
    const fulfill = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: status === 200 ? 0 : status, data, message: status === 200 ? '' : 'fixture failure' }) });
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname.startsWith('/v1/')) {
      if (request.method() !== 'GET') {
        writes.push(url.pathname);
        if (url.pathname === '/api/v1/admin/accounts/data') {
          if (outcome === 'unknown') return route.abort();
          return fulfill({ account_created: 1, account_failed: 1, proxy_created: 0, proxy_reused: 0, proxy_failed: 0, errors: [{ kind: 'account', message: 'NEVER_DISPLAY_SECRET' }] });
        }
        return fulfill({}, 403);
      }
      if (url.pathname === '/api/v1/admin/accounts') {
        queries.push(url.searchParams.get('platform') || '');
        const items = accounts.filter(a => !url.searchParams.get('platform') || a.platform === url.searchParams.get('platform'));
        return fulfill({ items, total: items.length, page: 1, page_size: 20 });
      }
      if (url.pathname.includes('/admin/groups')) return fulfill([{ id: 1, name: '开发者分组', status: 'active' }]);
      if (url.pathname.includes('/settings/public')) return fulfill({ registration_enabled: false, site_name: '隔离测试' });
      if (url.pathname === '/api/v1/auth/me') return fulfill({}, 401);
      return fulfill([]);
    }
    if (request.method() !== 'GET') return route.abort();
    return route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?unlocked&noboot');
  await page.waitForFunction(() => !!window.__macOS?.wm);
  await page.evaluate(() => { window.__macOS.systemStore.setAppearance('light'); window.__macOS.wm.openApp('accounts'); });
  const app = page.locator('.accounts-app');
  await app.getByRole('button', { name: '生产主账号 · Claude', exact: true }).waitFor();
  check('distinct sourced platform paths rendered', await app.locator('.accounts-platform-nav svg').count() >= 5);
  check('initial table has eight accounts', await app.locator('tbody tr').count() === 8);
  await app.getByRole('navigation', { name: '账号平台' }).getByRole('button', { name: 'OpenAI', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.accounts-table tbody tr').length === 1);
  check('platform navigation sends actual API filter', queries.at(-1) === 'openai');
  await app.getByRole('navigation', { name: '账号平台' }).getByRole('button', { name: '全部平台', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.accounts-table tbody tr').length === 8);
  await app.screenshot({ animations: 'disabled', path: 'output/playwright/desktop-accounts/light.png' });
  const lightMarkColor = await app.locator('.accounts-platform-nav .platform-mark[data-platform=openai]').evaluate(el => getComputedStyle(el).color);
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('dark'));
  check('platform mark adapts for dark contrast', await app.locator('.accounts-platform-nav .platform-mark[data-platform=openai]').evaluate(el => getComputedStyle(el).color) !== lightMarkColor);
  await app.screenshot({ animations: 'disabled', path: 'output/playwright/desktop-accounts/dark.png' });
  await app.getByRole('button', { name: '导入 JSON', exact: true }).click();
  let sheet = app.getByRole('dialog', { name: '导入账号', exact: true });
  await chooseFile(sheet.locator('input[type=file]'), 'accounts.json', JSON.stringify(payload('one')));
  await sheet.getByText('检查完成，尚未上传。', { exact: true }).waitFor();
  check('file picker only previews before confirmation', writes.length === 0);
  check('preview contains no credentials', !(await sheet.innerText()).includes('NEVER_DISPLAY_SECRET'));
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  check('cancel before confirm has zero mutations', writes.length === 0);
  // Main desktop hands files to an already-open account window.
  await page.evaluate(content => window.__macOS.wm.openApp('accounts', { importFiles: [new File([content], 'handoff.json', { type: 'application/json' })] }), JSON.stringify(payload('handoff')));
  await sheet.getByText('检查完成，尚未上传。', { exact: true }).waitFor();
  check('desktop File references consumed', await page.evaluate(() => !window.__macOS.wm.windows.value.find(w => w.appId === 'accounts').customData.importFiles));
  await sheet.getByRole('button', { name: '确认导入', exact: true }).click();
  await sheet.getByText('导入存在失败项。已完成部分不会回滚，请勿重新提交整个文件。', { exact: true }).waitFor();
  check('partial result is not success and cannot resubmit', writes.length === 1 && await sheet.getByRole('button', { name: '确认导入', exact: true }).isDisabled());
  check('server errors do not echo credential', !(await sheet.innerText()).includes('NEVER_DISPLAY_SECRET'));
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(content => window.__macOS.wm.openApp('accounts', { importFiles: [new File([content], 'renamed.json', { type: 'application/json' })] }), JSON.stringify(payload('handoff')));
  await sheet.getByText('本窗口已经提交过此文件，请先核对账号列表，避免重复导入。', { exact: true }).waitFor();
  check('reopen same window refuses same submitted file', writes.length === 1);
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  // Window drop prevents duplicate desktop propagation and emits reset event.
  await page.evaluate(content => {
    window.__consumedCount = 0; window.addEventListener('sub2-files-consumed', () => window.__consumedCount++);
    const transfer = new DataTransfer(); transfer.items.add(new File([content], 'window-drop.json', { type: 'application/json' }));
    document.querySelector('.accounts-app').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, JSON.stringify(payload('window')));
  await sheet.getByText('检查完成，尚未上传。', { exact: true }).waitFor();
  check('window drop emits consumed signal and does not auto-submit', await page.evaluate(() => window.__consumedCount === 1) && writes.length === 1);
  await chooseFile(sheet.locator('input[type=file]'), 'broken.json', '{NEVER_DISPLAY_SECRET');
  await sheet.getByText('第 1 个文件：JSON 格式错误，请重新导出文件。', { exact: true }).waitFor();
  check('invalid replacement clears ready state and hides parser source', await sheet.getByRole('button', { name: '确认导入', exact: true }).isDisabled() && !(await sheet.innerText()).includes('NEVER_DISPLAY_SECRET'));
  await chooseFile(sheet.locator('input[type=file]'), 'unknown.json', JSON.stringify(payload('unknown')));
  await sheet.getByText('检查完成，尚未上传。', { exact: true }).waitFor();
  outcome = 'unknown'; await sheet.getByRole('button', { name: '确认导入', exact: true }).click();
  await sheet.getByText('导入结果无法确认。请求可能已经写入，请先刷新账号与代理列表核对；本窗口禁止重发同一文件。', { exact: true }).waitFor();
  check('network failure stays unknown and cannot retry automatically', writes.length === 2 && await sheet.getByRole('button', { name: '确认导入', exact: true }).isDisabled());
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('light'));
  await app.locator('.accounts-mobile-details summary').first().click();
  check('mobile actions accessible without horizontal scrolling', await app.locator('.accounts-mobile-actions').first().getByRole('button', { name: '编辑', exact: true }).isVisible());
  check('mobile table fits account window', await app.locator('.accounts-table-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  await app.screenshot({ animations: 'disabled', path: 'output/playwright/desktop-accounts/mobile.png' });
  await app.getByRole('button', { name: '导入 JSON', exact: true }).click();
  await chooseFile(sheet.locator('input[type=file]'), 'mobile.json', JSON.stringify(payload('mobile')));
  await sheet.getByText('检查完成，尚未上传。', { exact: true }).waitFor();
  check('mobile import confirmation inside viewport', await sheet.getByRole('button', { name: '确认导入', exact: true }).evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
  await app.screenshot({ animations: 'disabled', path: 'output/playwright/desktop-accounts/mobile-import.png' });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('dark'));
  await app.screenshot({ animations: 'disabled', path: 'output/playwright/desktop-accounts/mobile-import-dark.png' });
  await sheet.getByRole('button', { name: '取消', exact: true }).click();
  check('no real writes: only intercepted import endpoint called', writes.every(p => p === '/api/v1/admin/accounts/data'));
  check('no page runtime errors', errors.length === 0);
  return { passed: results.length, results, interceptedWrites: writes.length, runtimeErrors: errors };
}
