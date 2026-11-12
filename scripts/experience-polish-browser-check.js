// Run with Playwright CLI run-code --filename scripts/experience-polish-browser-check.js.
// All API requests are intercepted in this browser. Values are synthetic fixtures.
async (page) => {
  const origin = 'http://127.0.0.1:5312';
  const results = [], errors = [], writes = [];
  const check = (name, condition, detail) => { if (!condition) throw new Error(name + ': ' + JSON.stringify(detail)); results.push(name); };
  page.removeAllListeners('dialog');
  page.removeAllListeners('pageerror');
  page.on('dialog', dialog => dialog.accept()); // isolated fixture reloads only
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', error => errors.push(error.message));
  const groups = [
    { id: 1, name: 'Claude 工作组', description: '用于开发工具与日常编码。', platform: 'anthropic', rate_multiplier: 1.3 },
    { id: 2, name: 'ChatGPT 团队工作组', description: '供团队项目调用，独立核算费用。', platform: 'openai', rate_multiplier: 0.35 },
    { id: 3, name: 'Gemini 研究组', description: '多模态研究与长上下文任务。', platform: 'gemini', rate_multiplier: 0.5 },
    { id: 4, name: 'DeepSeek 开发组', description: '应用开发与评估。', platform: 'deepseek', rate_multiplier: 0.2 },
    { id: 5, name: 'MiniMax 内容组', description: '内容生产与模型评测。', platform: 'minimax', rate_multiplier: 0.3 },
    { id: 6, name: 'Antigravity 工作组', description: '项目专用接入。', platform: 'antigravity', rate_multiplier: 0.4 },
    { id: 7, name: '一个很长的项目专属分组名称用于验证表格内容不会挤掉编辑与操作入口', description: '完整名称可在编辑表单查看。', platform: 'openai', rate_multiplier: 0.25 },
  ].map(g => ({ ...g, status: 'active', is_exclusive: false, subscription_type: 'standard', account_count: 8, active_account_count: 7, rpm_limit: 0, created_at: '2026-11-10T00:00:00Z' }));
  const key = { id: 1, user_id: 999, key: 'sk-fixture-only-not-a-secret', name: '产品开发', group_id: 2, group: groups[1], status: 'active', ip_whitelist: [], ip_blacklist: [], quota: 0, quota_used: 0, expires_at: null, created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z', rate_limit_5h: 0, rate_limit_1d: 0, rate_limit_7d: 0 };
  const channel = { id: 1, name: '团队模型渠道', description: '开发与研究项目', status: 'active', group_ids: [2, 999], billing_model_source: 'requested', restrict_models: false, features_config: {}, model_mapping: {}, apply_pricing_to_account_stats: false, account_stats_pricing_rules: [], model_pricing: [{ platform: 'openai', models: ['gpt-fixture'], billing_mode: 'token', input_price: 0.000002, output_price: 0.000008, cache_write_price: null, cache_read_price: null, image_input_price: null, image_output_price: null, per_request_price: null, intervals: [], time_pricing: null }], created_at: '2026-11-10T00:00:00Z', updated_at: '2026-11-10T00:00:00Z' };
  const list = items => ({ items, total: items.length, page: 1, page_size: 20, pages: 1 });
  let failGroups = false, emptyGroups = false;
  await page.route(origin + '/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (!/^\/(api|setup|health)(\/|$)/.test(path)) return route.continue();
    const ok = data => route.fulfill({ json: { code: 0, data } });
    if (path === '/setup/status') return route.fulfill({ json: { needs_setup: false } });
    if (path === '/health') return route.fulfill({ json: { status: 'ok' } });
    if (path.endsWith('/api-keys-usage')) return ok({ stats: { 1: { today_actual_cost: 3.24, total_actual_cost: 28.6 } } });
    if (req.method() !== 'GET') {
      writes.push({ path, method: req.method(), data: req.postDataJSON() });
      await new Promise(resolve => setTimeout(resolve, 220));
      if (path.endsWith('/keys')) return ok({ ...key, ...req.postDataJSON() });
      if (path.endsWith('/admin/channels/1')) return ok({ ...channel, ...req.postDataJSON() });
      if (/\/admin\/groups(?:\/\d+)?$/.test(path)) return ok({ ...groups[0], ...req.postDataJSON() });
      return route.fulfill({ status: 403, json: { code: 403, message: '未声明的夹具写入被阻止' } });
    }
    if (path.endsWith('/auth/me')) return ok({ id: 999, username: '设计预览', email: 'preview@example.invalid', role: 'admin', status: 'active', balance: 128.5, concurrency: 10 });
    if (path.endsWith('/settings/public')) return ok({ mcp_enabled: true, registration_enabled: false, api_base_url: 'https://api.example.invalid' });
    if (path.includes('/compliance')) return ok({ required: false, version: 'fixture', ack_phrase_zh: 'fixture acknowledgement', ack_phrase_en: 'fixture acknowledgement' });
    if (path.endsWith('/groups/available') || path.endsWith('/admin/groups/all')) {
      if (failGroups) return route.fulfill({ status: 503, json: { code: 503, message: '夹具分组读取失败' } });
      return ok(emptyGroups ? [] : groups);
    }
    if (/\/admin\/groups\/\d+$/.test(path)) return ok(groups.find(g => g.id === Number(path.split('/').pop())));
    if (path.endsWith('/admin/groups')) return ok(list(groups));
    if (path.endsWith('/groups/rates')) return ok({});
    if (path.endsWith('/keys')) return ok(list([key]));
    if (path.endsWith('/api-keys-usage')) return ok({ stats: { 1: { today_actual_cost: 3.24, total_actual_cost: 28.6 } } });
    if (path.endsWith('/admin/channels/1')) return ok(channel);
    if (path.endsWith('/admin/channels')) return ok(list([channel]));
    if (path.endsWith('/admin/accounts')) return ok(list(groups.slice(0, 6).map((g,i) => ({ id: i+1, name: g.name, platform: g.platform, type: 'apikey', status: 'active', concurrency: 10, priority: 1, weight: 1, rate_multiplier: 1, group_ids: [g.id], groups: [g], created_at: '2026-11-10T00:00:00Z', schedulable: true, credentials: {}, extra: {} }))));
    if (path.endsWith('/dashboard/stats')) return ok({ total_users: 128, total_accounts: 24, total_api_keys: 36, active_api_keys: 28, total_requests: 24170, today_requests: 1284, total_tokens: 98234000, today_tokens: 4872000, today_actual_cost: 23.48, today_cost: 24.1, total_actual_cost: 1024.62, total_cost: 1169.7, rpm: 14, tpm: 189200, average_duration_ms: 820, today_input_tokens: 3812000, today_output_tokens: 1060000, total_input_tokens: 75120000, total_output_tokens: 23114000 });
    if (path.endsWith('/dashboard/realtime')) return ok({ active_requests: 4, requests_per_minute: 14, average_response_time: 820, error_rate: 0.2 });
    if (path.endsWith('/dashboard/trend')) return ok({ trend: Array.from({ length: 7 }, (_,i) => ({ date: '2026-11-' + (i+6), requests: 600+i*114, total_requests: 600+i*114, total_tokens: 2100000+i*320000, total_actual_cost: 11+i*1.8, total_cost: 12+i*1.9, input_tokens: 1800000+i*100000, output_tokens: 300000+i*40000 })) });
    if (path.endsWith('/dashboard/models')) return ok({ models: [{ model: 'claude-sonnet', requests: 820, total_tokens: 3110000, total_actual_cost: 14.4 }, { model: 'gpt', requests: 464, total_tokens: 1762000, total_actual_cost: 9.08 }] });
    if (path.includes('/platform-quotas')) return ok({ platform_quotas: [] });
    if (path.includes('models') || path.includes('/all') || path.includes('available')) return ok([]);
    return ok(list([]));
  });
  await page.addInitScript(() => {
    localStorage.setItem('auth_token', 'experience-fixture-only');
    localStorage.setItem('sub2-desktop-preferences', JSON.stringify({ appearance: 'light', isDark: false, brightness: 100, volume: 0, wallpaper: 'tahoe' }));
    sessionStorage.setItem('sub2_booted', 'true');
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin + '/?noboot&unlocked');
  await page.waitForFunction(() => window.__macOS?.wm?.registeredApps.value.keychain);
  await page.evaluate(() => { window.__macOS.systemStore.unlock(); window.__macOS.wm.openApp('keychain'); });
  await page.getByRole('button', { name: '创建 API 密钥', exact: true }).click();
  const sheet = page.locator('.window-active .mac-sheet-panel').last();
  await sheet.getByRole('textbox', { name: '密钥名称', exact: true }).fill('研究项目');
  await sheet.getByRole('button', { name: /使用分组/ }).click();
  await sheet.getByRole('button', { name: 'OpenAI', exact: true }).click();
  await sheet.getByRole('searchbox', { name: '搜索使用分组' }).fill('团队');
  check('平台和关键词组合筛选', await sheet.locator('.group-option').count() === 2);
  await sheet.getByRole('radio', { name: /ChatGPT 团队工作组/ }).click();
  check('选择后显示名称与倍率', (await sheet.locator('.group-picker-trigger').innerText()).includes('0.35×'));
  await sheet.getByRole('button', { name: /使用分组/ }).click();
  await sheet.getByRole('searchbox').fill('不存在');
  check('无匹配不清除选择', await sheet.getByText('没有匹配的分组，试试其他关键词或平台。').isVisible() && (await sheet.locator('.group-picker-trigger').innerText()).includes('ChatGPT'));
  await page.keyboard.press('Escape');
  check('Escape 优先关闭选择器', await sheet.isVisible() && await sheet.locator('.group-picker-options').count() === 0);
  await sheet.getByRole('button', { name: /使用分组/ }).click();
  await sheet.getByRole('button', { name: /全部/ }).click();
  await sheet.getByRole('searchbox').fill('');
  await page.screenshot({ path: 'output/playwright/p07/keys-light.png', animations: 'disabled' });
  await sheet.getByRole('searchbox').press('Enter');
  check('搜索 Enter 不提交表单', writes.length === 0);
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('dark'));
  check('深色玻璃样式不降低整页不透明度',await page.evaluate(()=>getComputedStyle(document.documentElement).opacity)==='1');
  await page.screenshot({ path: 'output/playwright/p07/keys-dark.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/p07/keys-mobile.png', animations: 'disabled' });
  const fits = async () => sheet.evaluate(el => { const r=el.getBoundingClientRect(), f=el.querySelector('.mac-sheet-footer').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && f.bottom<=innerHeight && f.top>=r.top; });
  check('窄屏弹层和提交区可达', await fits());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('light'));
  await sheet.getByRole('searchbox').press('Escape');
  await sheet.locator('summary').filter({ hasText: '使用限制与安全' }).click();
  await sheet.getByRole('checkbox', { name: /额度限制/ }).check();
  await sheet.locator('input[type=number]').first().fill('25');
  await sheet.locator('.mac-sheet-body').evaluate(el => { el.scrollTop=el.scrollHeight; });
  check('滚动到长表单底部仍能保存', await fits());
  let focusContained=true;
  for (let i=0;i<18;i++) { await page.keyboard.press('Tab'); focusContained &&= await sheet.evaluate(el=>el.contains(document.activeElement)); }
  check('连续 Tab 在弹层内循环',focusContained);
  await sheet.getByRole('button', { name: '创建密钥', exact: true }).click({ clickCount: 2, delay: 10 });
  await page.getByRole('dialog', { name: '创建新 API 密钥', exact: true }).waitFor({ state: 'hidden' });
  check('密钥提交防重且保留分组及额度', writes.length === 1 && writes[0].data.group_id === 2 && writes[0].data.quota === 25, writes);
  await page.getByRole('button',{name:'创建 API 密钥',exact:true}).click();
  await sheet.getByRole('button',{name:/使用分组/}).click();
  await sheet.getByRole('searchbox').fill('Gemini');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'创建新 API 密钥',exact:true}).waitFor({state:'hidden'});
  check('纯筛选操作不会产生放弃更改确认',await page.getByRole('alertdialog').count()===0);
  await page.getByRole('button',{name:'创建 API 密钥',exact:true}).click();
  await sheet.getByRole('button',{name:'创建密钥',exact:true}).click();
  check('固定底部提交仍执行必填校验',await sheet.getByRole('textbox',{name:'密钥名称'}).evaluate(el=>!el.validity.valid) && writes.length===1);
  await sheet.getByRole('button',{name:/使用分组/}).click();
  await sheet.getByRole('radio',{name:/继承默认分组/}).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  check('方向键选择时保留选项面板',await sheet.locator('.group-picker-options').isVisible());
  await page.keyboard.press('Enter');
  check('键盘确认选择并关闭选项',await sheet.locator('.group-picker-options').count()===0 && (await sheet.locator('.group-picker-trigger').innerText()).includes('ChatGPT'));
  await sheet.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('alertdialog',{name:'放弃未保存的更改？',exact:true}).getByRole('button',{name:'放弃更改',exact:true}).click();
  const openApp = async id => { await page.evaluate(id=>window.__macOS.wm.openApp(id),id); await page.locator('.window-active').waitFor(); };
  await openApp('channels');
  await page.locator('.window-active .admin-table').getByRole('button', { name: '编辑', exact: true }).first().click();
  await page.getByRole('dialog', { name: '渠道配置', exact: true }).waitFor();
  await sheet.getByRole('textbox', { name: '渠道名称' }).fill('团队模型渠道 · 更新');
  await sheet.getByRole('button', { name: /关联分组/ }).click();
  check('保留后台未返回的已关联分组', (await sheet.innerText()).includes('#999'));
  await sheet.getByRole('button', { name: 'Gemini', exact: true }).click();
  await sheet.getByRole('checkbox', { name: /Gemini 研究组/ }).check();
  check('多选筛选不会清掉其他平台', (await sheet.locator('.group-picker-trigger').innerText()).includes('3 个分组'));
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'output/playwright/p07/channel-pricing-light.png', animations: 'disabled' });
  await sheet.locator('.mac-sheet-body').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  check('渠道定价保存区固定', await fits());
  await sheet.getByRole('button', { name: '保存渠道', exact: true }).click({ clickCount: 2, delay: 10 });
  await page.getByRole('dialog', { name: '渠道配置', exact: true }).waitFor({ state: 'hidden' });
  const channelWrite=writes.filter(w=>w.path.endsWith('/admin/channels/1'));
  check('渠道写入防重并保留未知分组', channelWrite.length===1 && [2,3,999].every(id=>channelWrite[0].data.group_ids.includes(id)),channelWrite);
  await openApp('groups');
  await page.locator('.window-active .groups-table tbody tr').first().waitFor();
  await page.screenshot({ path: 'output/playwright/p07/groups-light.png', animations: 'disabled' });
  await page.setViewportSize({ width:390, height:844 });
  const actionInView=await page.locator('.window-active .groups-table tbody tr').first().locator('td').last().evaluate(el=>{const r=el.getBoundingClientRect();return r.right<=innerWidth+1&&r.left>=0;});
  check('窄屏列表操作列可见',actionInView);
  await page.screenshot({path:'output/playwright/p07/groups-mobile.png',animations:'disabled'});
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.window-active .groups-table').getByRole('button',{name:'编辑',exact:true}).first().click();
  await page.getByRole('dialog',{name:'编辑分组',exact:true}).waitFor();
  await sheet.getByRole('textbox',{name:'分组名称'}).fill('Claude 工作组 · 修改');
  await page.screenshot({path:'output/playwright/p07/group-form-light.png',animations:'disabled'});
  await sheet.getByRole('button',{name:'取消',exact:true}).click();
  const discard=page.getByRole('alertdialog',{name:'放弃未保存的更改？',exact:true});
  await discard.waitFor();
  await discard.getByRole('button',{name:'继续编辑',exact:true}).click();
  check('取消确认保留输入',await sheet.getByRole('textbox',{name:'分组名称'}).inputValue()==='Claude 工作组 · 修改');
  await sheet.getByRole('button',{name:'保存修改',exact:true}).click();
  await page.getByRole('dialog',{name:'编辑分组',exact:true}).waitFor({state:'hidden'});
  check('分组只提交变更字段',JSON.stringify(writes.find(w=>w.path.endsWith('/admin/groups/1')).data)==='{"name":"Claude 工作组 · 修改"}');
  await page.locator('.window-active .groups-table').getByRole('button',{name:/Claude 工作组的更多操作/}).click();
  await sheet.getByRole('button',{name:/^修改分组 RPM/}).click();
  await page.getByRole('dialog',{name:'修改分组 RPM',exact:true}).waitFor();
  check('更多操作可进入原有分组配置',await sheet.getByRole('spinbutton').isVisible());
  await sheet.getByRole('button',{name:'取消',exact:true}).click();
  for(const id of ['accounts','dashboard','settings']) {
    await openApp(id);
    const win=page.locator('.window-active');
    await page.waitForTimeout(400);
    check(id+'页面内容加载', (await win.innerText()).length>50);
    for(const theme of ['light','dark']) {
      await page.evaluate(theme=>window.__macOS.systemStore.setAppearance(theme),theme);
      await page.screenshot({path:'output/playwright/p07/'+id+'-'+theme+'.png',animations:'disabled'});
    }
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'output/playwright/p07/'+id+'-mobile.png',animations:'disabled'});
    check(id+'窄屏窗口可达',await win.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));
  }
  await page.getByRole('button',{name:'启动台',exact:true}).click();
  const launcher=page.getByRole('dialog',{name:'应用程序',exact:true});
  await launcher.waitFor();
  check('按用途展示应用分组', await launcher.getByRole('heading',{name:/资源与路由/}).isVisible());
  await page.screenshot({path:'output/playwright/p07/launchpad-light.png',animations:'disabled'});
  await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));
  await page.screenshot({path:'output/playwright/p07/launchpad-dark.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/p07/launchpad-mobile.png',animations:'disabled'});
  await launcher.getByRole('searchbox').fill('费率');
  check('可以按用途搜索应用',await launcher.getByRole('button',{name:'分组管理',exact:true}).isVisible());
  await launcher.getByRole('searchbox').press('Enter');
  await launcher.waitFor({state:'hidden'});
  check('搜索 Enter 打开对应应用',await page.locator('.window-active .groups-table').isVisible());
  await page.setViewportSize({width:1440,height:900});
  await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));
  await openApp('settings');
  const window=page.locator('.window-active');
  const before=await window.boundingBox(), title=await window.locator('.mac-window-titlebar').boundingBox();
  await page.mouse.move(title.x+title.width/2,title.y+20); await page.mouse.down(); await page.mouse.move(title.x+title.width/2-50,title.y+10,{steps:6}); await page.mouse.up();
  const dragged=await window.boundingBox();
  check('多个窗口下拖拽仍有效',Math.abs(dragged.x-before.x)>10 && await page.locator('.window').count()>1);
  const handle=await window.locator('.resize-se').boundingBox();
  await page.mouse.move(handle.x+5,handle.y+5);await page.mouse.down();await page.mouse.move(handle.x-65,handle.y-35,{steps:6});await page.mouse.up();
  const resized=await window.boundingBox();
  check('窗口缩放仍有效',resized.width<dragged.width-30);
  await window.getByTitle('全屏显示',{exact:true}).click();
  check('窗口最大化', (await window.boundingBox()).width>resized.width);
  await window.getByTitle('还原',{exact:true}).click();
  await page.waitForFunction(width=>Math.abs(document.querySelector('.window-active').getBoundingClientRect().width-width)<2,resized.width);
  check('最大化后还原尺寸',Math.abs((await window.boundingBox()).width-resized.width)<2);
  await openApp('keychain');
  failGroups=true;
  await page.getByRole('button',{name:'刷新密钥列表',exact:true}).click();
  await page.getByText(/分组暂时无法加载，密钥列表仍可使用/).waitFor();
  await page.getByRole('button',{name:'创建 API 密钥',exact:true}).click();
  check('分组读取失败时明确提示并禁用选择',await sheet.getByRole('button',{name:/使用分组/}).isDisabled() && await sheet.getByRole('alert').isVisible());
  await sheet.getByRole('button',{name:'取消',exact:true}).click();
  failGroups=false;emptyGroups=true;
  await page.getByRole('button',{name:'刷新密钥列表',exact:true}).click();
  await page.getByRole('button',{name:'刷新密钥列表',exact:true}).waitFor({state:'visible'});
  await page.waitForTimeout(100);
  await page.getByRole('button',{name:'创建 API 密钥',exact:true}).click();
  await sheet.getByRole('button',{name:/使用分组/}).click();
  check('空分组有明确状态且可继承默认',await sheet.getByText('暂无可选分组。',{exact:true}).isVisible() && await sheet.getByRole('radio',{name:/继承默认分组/}).isVisible());
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  emptyGroups=false;
  await page.getByRole('button',{name:'刷新密钥列表',exact:true}).click();await page.waitForTimeout(100);
  await page.getByRole('button',{name:'创建 API 密钥',exact:true}).click();await sheet.getByRole('button',{name:/使用分组/}).click();
  check('分组重试后恢复选项',await sheet.getByRole('radio').count()===8);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  check('没有未捕获脚本异常',errors.length===0,errors);
  return { fixtureOnly:true, passed:results.length, results, errors, mutations:writes };
}
