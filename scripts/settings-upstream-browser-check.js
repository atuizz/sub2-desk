async (existingPage) => {
  const origin = 'http://127.0.0.1:5197';
  const output = 'D:/sub2-mac/output/upstream-current-20260912/audit/';
  const context = await existingPage.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(9000);
  const checks = [], writes = [], gets = [], pageErrors = [], unexpected = [];
  const check = (name, pass) => { if (!pass) throw Error(name); checks.push(name); };
  let failBetaRead = false, failBetaSave = false, malformedFastSave = false, failLogging = false;
  let settings = {
    backend_mode_enabled: false, site_name: '设置验收夹具', site_subtitle: '', api_base_url: '', custom_endpoints: [], custom_menu_items: [],
    registration_enabled: false, email_verify_enabled: false, promo_code_enabled: false, model_plaza_enabled: false,
    channel_monitor_hide_user_ranking: true, default_balance: 0, default_concurrency: 1, default_user_rpm_limit: 0,
    account_scheduling_thresholds: {openai:90,anthropic:90,grok:85,kimi:85,zhipu:80,minimax:75},
    openai_fast_policy_settings: {rules:[{service_tier:'ultrafast',action:'filter',scope:'oauth',user_ids:[7],future:{keep:true}}]}
  };
  let beta = {rules:[{beta_token:'context-1m-2025-08-07',action:'pass',scope:'all',model_whitelist:['claude-*'],fallback_action:'filter',future:{keep:true}}]};
  let logging = {level:'info',persist_access_logs:true,enable_sampling:true,sampling_initial:100,sampling_thereafter:100,caller:false,stacktrace_level:'error',retention_days:30,source:'server'};
  page.on('pageerror', e => pageErrors.push(e.message));
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.route(origin + '/api/**', async route => {
    const req=route.request(), path=req.url().slice(origin.length).split('?')[0];
    const ok=data=>route.fulfill({json:{code:0,data}});
    const failure=()=>route.fulfill({status:503,json:{code:503,message:'夹具：暂时不可用'}});
    if(req.method()!=='GET') {
      const body=req.postDataJSON(); writes.push({method:req.method(),path,body:JSON.parse(JSON.stringify(body))});
      if(req.method()==='PUT' && path==='/api/v1/admin/settings/beta-policy'){if(failBetaSave)return failure();beta=body;return ok(beta);}
      if(req.method()==='PUT' && path==='/api/v1/admin/settings') {
        settings={...settings,...body};
        if(malformedFastSave && body.openai_fast_policy_settings)return ok({});
        return ok(settings);
      }
      if(req.method()==='PUT' && path==='/api/v1/admin/ops/runtime/logging'){if(failLogging)return failure();logging=body;return ok(logging);}
      if(req.method()==='POST' && path==='/api/v1/admin/groups')return ok({id:9901,...body});
      unexpected.push({method:req.method(),path});return route.fulfill({status:403,json:{code:403,message:'Unexpected fixture mutation'}});
    }
    gets.push(req.url());
    if(path.endsWith('/auth/me') || path.endsWith('/user/profile'))return ok({id:9901,username:'设置验收',email:'settings@example.invalid',role:'admin',status:'active',balance:0});
    if(path==='/api/v1/admin/settings/beta-policy')return failBetaRead?failure():ok(beta);
    if(path==='/api/v1/admin/settings')return ok(settings);
    if(path==='/api/v1/settings/public')return ok({...settings,version:'0.2.4',run_mode:'standard'});
    if(path.includes('/admin/compliance'))return ok({required:false});
    if(path==='/api/v1/admin/ops/runtime/logging')return ok(logging);
    if(path.endsWith('/system-logs/health'))return ok({queue_depth:0});
    if(path.endsWith('/admin/groups'))return ok({items:[],total:0});
    if(path.endsWith('/admin/groups/all'))return ok([]);
    if(path.endsWith('/advanced-settings'))return ok({auto_refresh_enabled:false,display_alert_events:false});
    if(path.endsWith('/system-logs'))return ok({items:[],total:0});
    return ok({});
  });
  await page.route(origin + '/health', r=>r.fulfill({json:{status:'ok'}}));
  await page.addInitScript(()=>{
    localStorage.setItem('auth_token','settings-audit-fixture-only');
    localStorage.setItem('sub2-desktop-preferences',JSON.stringify({appearance:'light',isDark:false,volume:0}));
    sessionStorage.setItem('sub2_booted','true');
  });
  const go=async app=>{await page.goto(origin+'/?noboot&unlocked&app='+app);await page.waitForLoadState('networkidle');};
  const settingsWin=()=>page.getByRole('region',{name:'系统设置',exact:true});
  const tab=async name=>{
    const button=settingsWin().getByRole('button',{name,exact:true});
    if(!await button.isVisible())await settingsWin().getByRole('button',{name:'设置分类',exact:true}).click();
    await button.click();
  };
  const waitWrite=async count=>{
    await page.waitForFunction(()=>!document.querySelector('button[aria-busy="true"]'));
    check('夹具写入计数 '+count,writes.length===count);
  };
  try {
    await go('settings');
    await tab('功能开关');
    const ranking=settingsWin().getByRole('switch',{name:'隐藏用户排行'});
    check('隐藏用户排行回显 true',await ranking.getAttribute('aria-checked')==='true');
    await ranking.click();await settingsWin().getByRole('button',{name:'保存配置',exact:true}).click();
    await settingsWin().getByText('本模块设置已保存',{exact:true}).waitFor();
    check('隐藏用户排行差异保存 false',JSON.stringify(writes.at(-1).body)==='{"channel_monitor_hide_user_ranking":false}');

    await tab('用户默认值');
    const minimax=settingsWin().getByRole('spinbutton',{name:'MiniMax 暂停阈值',exact:true});
    check('MiniMax 原值回显',await minimax.inputValue()==='75');
    await minimax.fill('65');await settingsWin().getByRole('button',{name:'保存配置',exact:true}).click();
    await waitWrite(2);
    check('阈值保存保留其余五个平台',writes.at(-1).body.account_scheduling_thresholds.openai===90 && writes.at(-1).body.account_scheduling_thresholds.minimax===65 && Object.keys(writes.at(-1).body.account_scheduling_thresholds).length===6);
    await page.screenshot({path:output+'gap-thresholds-light.png',animations:'disabled'});

    await tab('请求策略');
    const betaPanel=page.getByRole('region',{name:'Anthropic Beta 规则',exact:true});
    const fastPanel=page.getByRole('region',{name:'OpenAI Fast / Flex 规则',exact:true});
    await betaPanel.getByLabel('Beta 功能标记').waitFor();
    await fastPanel.getByLabel('服务档位').waitFor();
    check('Fast ultrafast 正确回显',await fastPanel.getByLabel('服务档位').inputValue()==='ultrafast');
    check('请求策略不显示混合保存按钮',await settingsWin().getByRole('button',{name:'保存配置',exact:true}).count()===0);
    await betaPanel.getByLabel('处理方式',{exact:true}).selectOption('block');
    await betaPanel.getByLabel('拒绝提示',{exact:true}).fill('Beta 暂不可用');
    failBetaSave=true;await betaPanel.getByRole('button',{name:'保存规则',exact:true}).click();
    await betaPanel.getByRole('alert').waitFor();
    check('Beta 失败保留草稿',await betaPanel.getByLabel('拒绝提示',{exact:true}).inputValue()==='Beta 暂不可用');
    failBetaSave=false;await betaPanel.getByRole('button',{name:'保存规则',exact:true}).click();
    await betaPanel.getByText('规则已保存',{exact:true}).waitFor();
    check('Beta 保存保留扩展和模型范围',writes.at(-1).path.endsWith('/beta-policy') && writes.at(-1).body.rules[0].future.keep && writes.at(-1).body.rules[0].model_whitelist[0]==='claude-*');
    await fastPanel.getByLabel('处理方式',{exact:true}).selectOption('force_priority');
    await fastPanel.getByLabel('用户 ID（留空为全部）').fill('7, 19');
    await fastPanel.getByRole('button',{name:'保存规则',exact:true}).click();
    await fastPanel.getByText('规则已保存',{exact:true}).waitFor();
    check('Fast 仅保存独立规则字段',Object.keys(writes.at(-1).body).join()==='openai_fast_policy_settings' && writes.at(-1).body.openai_fast_policy_settings.rules[0].user_ids.join()==='7,19');
    await page.screenshot({path:output+'gap-policies-light.png',animations:'disabled'});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));
    await page.screenshot({path:output+'gap-policies-dark.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await betaPanel.scrollIntoViewIfNeeded();
    check('390px 策略无横向溢出',await betaPanel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await settingsWin().locator('.settings-content').evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:output+'gap-policies-mobile.png',animations:'disabled'});
    await betaPanel.getByRole('button',{name:'添加规则',exact:true}).click();
    await betaPanel.getByLabel('Beta 功能标记').last().fill('mobile-beta');
    await betaPanel.getByRole('button',{name:'撤销未保存修改',exact:true}).click();
    check('390px 可添加并撤销规则',await betaPanel.getByLabel('Beta 功能标记').count()===1);
    await page.setViewportSize({width:1440,height:900});
    malformedFastSave=true;await fastPanel.getByLabel('处理方式',{exact:true}).selectOption('pass');
    await fastPanel.getByRole('button',{name:'保存规则',exact:true}).click();await fastPanel.getByRole('alert').waitFor();
    check('返回缺字段禁用再次保存',await fastPanel.getByRole('button',{name:'保存规则',exact:true}).isDisabled());
    malformedFastSave=false;await fastPanel.getByRole('button',{name:'重新读取规则',exact:true}).click();await fastPanel.getByLabel('服务档位').waitFor();
    failBetaRead=true;await betaPanel.getByRole('button',{name:'重新读取规则',exact:true}).click();await betaPanel.getByRole('alert').waitFor();
    check('Beta 读取失败禁止添加或保存',await betaPanel.getByRole('button',{name:'添加规则',exact:true}).isDisabled() && await betaPanel.getByRole('button',{name:'保存规则',exact:true}).isDisabled());
    failBetaRead=false;

    delete settings.channel_monitor_hide_user_ranking;settings.account_scheduling_thresholds=null;
    await go('settings');await tab('功能开关');
    check('旧后端隐藏排行未知不可操作',await settingsWin().getByRole('switch',{name:'隐藏用户排行'}).getAttribute('aria-disabled')==='true');
    await tab('用户默认值');
    check('阈值整项为空时不崩溃且不显示虚构默认值',await settingsWin().getByRole('spinbutton',{name:'MiniMax 暂停阈值'}).isDisabled() && await settingsWin().getByRole('spinbutton',{name:'MiniMax 暂停阈值'}).inputValue()==='');

    await go('groups');
    const groups=page.getByRole('region',{name:'分组管理',exact:true});
    const groupFilter=page.waitForResponse(response=>response.url().includes('/admin/groups?') && /[?&]platform=minimax(?:&|$)/.test(response.url()));
    await groups.getByLabel('分组平台',{exact:true}).selectOption('minimax');
    await groupFilter;
    check('分组筛选发送 minimax',gets.some(url=>url.includes('/admin/groups?') && /[?&]platform=minimax(?:&|$)/.test(url)));
    await groups.getByRole('button',{name:'创建分组',exact:true}).first().click();
    const groupDialog=page.getByRole('dialog',{name:'添加分组',exact:true});
    await groupDialog.getByPlaceholder('请输入分组名称').fill('MiniMax 分组夹具');
    await groupDialog.locator('select').first().selectOption('minimax');
    await groupDialog.getByRole('button',{name:'创建',exact:true}).click();await groupDialog.waitFor({state:'hidden'});
    check('分组创建发送 minimax',writes.at(-1).path==='/api/v1/admin/groups' && writes.at(-1).body.platform==='minimax');

    await go('ops');
    const ops=page.getByRole('region',{name:'运维监控',exact:true});
    await ops.getByRole('button',{name:'系统日志',exact:true}).click();
    await ops.getByRole('button',{name:'运行配置与清理',exact:true}).click();
    const log=page.getByRole('dialog',{name:'系统日志维护',exact:true});
    const persist=log.getByRole('checkbox',{name:'持久化访问日志',exact:true});
    await persist.waitFor();check('日志持久化回显开启',await persist.isChecked());
    await log.getByLabel('日志级别',{exact:true}).selectOption('warn');await log.getByRole('button',{name:'保存配置',exact:true}).click();
    await log.getByText('日志运行配置已保存',{exact:true}).waitFor();
    check('修改日志级别保留 persist_access_logs=true',writes.at(-1).body.level==='warn' && writes.at(-1).body.persist_access_logs===true);
    await persist.uncheck();failLogging=true;await log.getByRole('button',{name:'保存配置',exact:true}).click();await log.getByRole('alert').waitFor();
    check('日志保存失败保留关闭草稿',!await persist.isChecked());failLogging=false;
    await log.getByRole('button',{name:'保存配置',exact:true}).click();await log.getByText('日志运行配置已保存',{exact:true}).waitFor();
    check('日志明确关闭发送 false',writes.at(-1).body.persist_access_logs===false && !('source' in writes.at(-1).body));
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));
    await page.screenshot({path:output+'gap-logging-light.png',animations:'disabled'});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));
    await page.screenshot({path:output+'gap-logging-dark.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await log.evaluate(el=>{for(const child of el.querySelectorAll('*')){if(child.scrollHeight>child.clientHeight)child.scrollTop=0;}});
    await page.screenshot({path:output+'gap-logging-mobile.png',animations:'disabled'});
    check('390px 日志弹层无横向溢出',await log.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    delete logging.persist_access_logs;
    await log.getByRole('button',{name:'重新读取配置与健康状态',exact:true}).click();
    await log.getByText('未能读取访问日志持久化状态，请重新读取配置后再保存。',{exact:true}).waitFor();
    check('日志未知持久化状态禁写',await persist.isDisabled() && await log.getByRole('button',{name:'保存配置',exact:true}).isDisabled());
    await page.keyboard.press('Escape');await log.waitFor({state:'hidden'});
    check('日志弹层 Escape 可关闭',!await log.isVisible());
    check('无脚本异常',pageErrors.length===0);
    check('无越界业务写入',unexpected.length===0);
    return {passed:true,checks,writes,fixtureOnly:true,pageErrors,unexpected};
  } catch(error) {
    await page.screenshot({path:output+'gap-browser-failure.png',animations:'disabled'});
    return {passed:false,error:String(error),checks,writes,pageErrors,unexpected,gets,fixtureOnly:true};
  } finally { await context.close(); }
}
