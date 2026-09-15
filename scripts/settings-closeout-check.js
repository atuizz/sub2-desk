async (page) => {
  const origin = 'http://127.0.0.1:5181';
  const results = [], writes = [], errors = [];
  let failRead = true, failSave = false;
  const settings = { backend_mode_enabled: false, site_name: 'Fixture Site', site_subtitle: '', api_base_url: 'https://api.example.invalid', custom_endpoints: [], login_agreement_enabled: true, login_agreement_mode: 'checkbox', login_agreement_documents: [{id:'terms',title:'服务条款',content_md:'既有条款'}] };
  page.on('pageerror', error => errors.push(error.message));
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/health', r => r.fulfill({json:{status:'ok'}}));
  await page.route(origin + '/api/**', async route => {
    const req = route.request(), path = req.url().split('?')[0];
    const ok = data => route.fulfill({json:{code:0,data}});
    if(path.endsWith('/auth/me') || path.endsWith('/user/profile')) return ok({id:999,username:'设置验收',role:'admin',status:'active',email:'fixture@example.invalid',balance:0});
    if(path.includes('/admin/settings')) {
      if(req.method() !== 'GET') writes.push({path,body:req.postDataJSON()});
      if((req.method()==='GET' && failRead) || (req.method()!=='GET' && failSave && path.endsWith('/rectifier'))) return route.fulfill({status:503,json:{code:503,message:'测试失败'}});
      if(path.endsWith('/admin/settings')) { if(req.method()!=='GET') Object.assign(settings,req.postDataJSON()); return ok(settings); }
      return ok({enabled:false,cooldown_minutes:30,cooldown_seconds:60,action:'none',temp_unsched_minutes:5,threshold_count:3,threshold_window_minutes:10,thinking_signature_enabled:false,thinking_budget_enabled:false,apikey_signature_enabled:false,apikey_signature_patterns:[]});
    }
    if(req.method()!=='GET') throw new Error('Unexpected write: '+path);
    return ok({});
  });
  await page.addInitScript(() => { localStorage.setItem('auth_token','settings-fixture-token');sessionStorage.setItem('sub2_booted','true'); });
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/?noboot&unlocked&app=settings');
  const win=page.getByRole('region',{name:'系统设置',exact:true});
  await win.getByRole('button',{name:'通用设置',exact:true}).click();
  await win.getByText('配置暂时无法加载，请重试',{exact:true}).waitFor();
  if(!await win.getByRole('button',{name:'保存配置',exact:true}).isDisabled()) throw new Error('读取失败仍可保存');
  await win.getByRole('button',{name:'网关设置',exact:true}).click();
  await win.getByText('部分网关配置加载失败，对应模块暂不可保存。',{exact:true}).waitFor();
  await win.getByRole('button',{name:'保存配置',exact:true}).click();
  if(writes.length) throw new Error('读取失败仍发送写请求');
  results.push('读取失败阻止主配置和网关默认值写入');
  failRead=false;
  await win.getByRole('button',{name:'重试读取',exact:true}).click();
  await win.getByRole('button',{name:'保存整流器配置',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(() => !document.querySelector('.settings-app button[aria-busy="true"]'));
  failSave=true;
  await win.getByRole('button',{name:'保存配置',exact:true}).click();
  await win.getByText('部分网关设置未保存，请检查各模块后重试',{exact:true}).waitFor();
  if(writes.length!==4) throw new Error('独立模块保存数量异常');
  results.push('部分失败不显示全部成功');
  failSave=false;
  await win.getByRole('button',{name:'保存配置',exact:true}).click();
  await win.getByText('网关设置已全部保存',{exact:true}).waitFor();
  results.push('全部模块成功后汇总成功');
  await win.getByRole('button',{name:'通用设置',exact:true}).click();
  await win.getByRole('button',{name:'重试',exact:true}).click();
  await win.locator('.settings-content input').first().fill('New Site');
  await win.getByRole('button',{name:'保存配置',exact:true}).click();
  await win.getByText('本模块设置已保存',{exact:true}).waitFor();
  if(JSON.stringify(writes.at(-1).body)!==JSON.stringify({site_name:'New Site'})) throw new Error('保存了其他模块或未编辑字段');
  results.push('通用设置仅提交修改字段');
  await win.getByRole('button',{name:'登录条款',exact:true}).click();
  if(await win.getByRole('textbox',{name:'条款内容',exact:true}).inputValue()!=='既有条款') throw new Error('未读取原版条款数组');
  await win.getByRole('textbox',{name:'条款内容',exact:true}).fill('更新条款');
  await win.getByRole('button',{name:'保存配置',exact:true}).click();
  await page.waitForFunction(() => !document.querySelector('.settings-app button[aria-busy="true"]'));
  if(writes.at(-1).body.login_agreement_documents?.[0]?.id!=='terms') throw new Error('条款ID丢失');
  results.push('条款使用原版文档数组且保留ID');
  await page.screenshot({path:'output/playwright/release/settings-light.png',animations:'disabled'});
  await page.evaluate(() => window.__macOS.systemStore.setAppearance('dark'));
  await page.screenshot({path:'output/playwright/release/settings-dark.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/release/settings-mobile.png',animations:'disabled'});
  if(errors.length) throw new Error(errors.join(';'));
  return {passed:true,results,interceptedWrites:writes.length,fixtureOnly:true,pageErrors:errors};
}
