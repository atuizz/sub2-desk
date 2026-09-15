async (page) => {
  const origin='http://127.0.0.1:5181';
  await page.unrouteAll({behavior:'wait'});
  const errors=[];page.on('pageerror', e=>errors.push(e.message));
  const user={id:999,username:'设计工作空间',email:'preview@example.invalid',role:'admin',status:'active',balance:128.5,concurrency:10};
  let failure=true;const apiRequests=[];let writes=0;
  await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
  await page.route(origin+'/api/**',r=>{
    const req=r.request();const path=req.url().replace(origin,'').split('?')[0];apiRequests.push(path);
    const ok=data=>r.fulfill({json:{code:0,data}});
    if(req.method()!=='GET'){writes++;return r.fulfill({status:403,json:{code:403,message:'本地视觉检查禁止写操作'}});}
    if(path.endsWith('/auth/me'))return ok(user);
    if(path.includes('/settings/public'))return ok({registration_enabled:false});
    if(path.endsWith('/admin/compliance'))return ok({required:false,version:'fixture',ack_phrase_zh:'fixture acknowledgement',ack_phrase_en:'fixture acknowledgement'});
    if(failure)return r.fulfill({status:503,json:{code:503,message:'暂时无法连接后端，请稍后重试'}});
    if(path.endsWith('/admin/accounts'))return ok({items:Array.from({length:12},(_,i)=>({id:i+1,name:['Claude · 工作空间','OpenAI · 产品团队','Gemini · 研究项目'][i%3]+' '+(i+1),platform:['anthropic','openai','gemini'][i%3],type:'apikey',status:i%5?'active':'inactive',concurrency:10,priority:i%3,weight:1,rate_multiplier:1,group_ids:[1],groups:[{id:1,name:'默认分组'}],created_at:'2026-09-08T00:00:00Z',schedulable:true,credentials:{},extra:{}})),total:12,page:1,page_size:20,pages:1});
    if(path.endsWith('/admin/groups/all'))return ok([{id:1,name:'默认分组',platform:'anthropic',status:'active'}]);
    if(path.endsWith('/dashboard/stats'))return ok({total_users:128,total_accounts:24,total_api_keys:36,active_api_keys:28,total_requests:24170,today_requests:1284,total_tokens:98234000,today_tokens:4872000,today_actual_cost:23.48,today_cost:24.1,total_actual_cost:1024.62,total_cost:1169.7,rpm:14,tpm:189200,average_duration_ms:820,today_input_tokens:3812000,today_output_tokens:1060000,total_input_tokens:75120000,total_output_tokens:23114000});
    if(path.endsWith('/dashboard/realtime'))return ok({active_requests:4,requests_per_minute:14,average_response_time:820,error_rate:0.2});
    if(path.endsWith('/dashboard/trend'))return ok({trend:Array.from({length:7},(_,i)=>({date:'2026-09-0'+(i+2),requests:600+i*114,total_requests:600+i*114,total_tokens:2100000+i*320000,total_actual_cost:11+i*1.8,total_cost:12+i*1.9,input_tokens:1800000+i*100000,output_tokens:300000+i*40000}))});
    if(path.endsWith('/dashboard/models'))return ok({models:[{model:'claude-sonnet',requests:820,total_tokens:3110000,total_actual_cost:14.4},{model:'gpt',requests:464,total_tokens:1762000,total_actual_cost:9.08}]});
    if(path.includes('/platform-quotas'))return ok({platform_quotas:[]});
    if(path.endsWith('/usage'))return ok({items:[],total:0,page:1,page_size:20,pages:1});
    if(path.endsWith('/admin/settings'))return ok({site_name:'Sub2-Mac',registration_enabled:false});
    return r.fulfill({status:503,json:{code:503,message:'此检查未配置该接口夹具'}});
  });
  await page.addInitScript(()=>{localStorage.setItem('auth_token','ui-review-local-only');localStorage.setItem('sub2-desktop-preferences',JSON.stringify({appearance:'light',isDark:false,brightness:100,volume:0,wallpaper:'tahoe'}));sessionStorage.setItem('sub2_booted','true');});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/?noboot&unlocked');
  await page.waitForFunction(()=>window.__macOS?.wm);
  await page.evaluate(async()=>{await window.__macOS.authStore.initAuth();window.__macOS.systemStore.unlock();});
  const apps=await page.evaluate(()=>Object.values(window.__macOS.wm.registeredApps.value).filter(a=>a.component).map(a=>({id:a.id,title:a.title})));
  const checks=[];
  for(const app of apps){
    await page.evaluate(id=>{const w=window.__macOS.wm;[...w.windows.value].forEach(a=>w.closeWindow(a.id));w.openApp(id);},app.id);
    const win=page.getByRole('region',{name:app.title,exact:true});await win.waitFor();
    await win.locator('.mac-window-body > *').first().waitFor();
    await page.waitForTimeout(280);
    await win.locator('.app-loading-state').waitFor({state:'hidden',timeout:20000});
    const text=await win.innerText();
    const broken=await win.locator('img').evaluateAll(imgs=>imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.getAttribute('src')));
    checks.push({id:app.id,title:app.title,rendered:text.length>10,brokenImages:broken,errorState:/失败|无法|重试|暂未|暂无|未加载/.test(text)});
    await page.screenshot({path:'output/playwright/release/all-apps/apps/'+app.id+'-light.png',animations:'disabled'});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));
    await page.screenshot({path:'output/playwright/release/all-apps/apps/'+app.id+'-dark.png',animations:'disabled'});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'output/playwright/release/all-apps/apps/'+app.id+'-mobile.png',animations:'disabled'});
    const overflow = await win.evaluate(el=>{const body=el.querySelector('.mac-window-body'); const app=body?.firstElementChild;return {window:el.getBoundingClientRect().right>innerWidth+1, app:app?app.scrollWidth>app.clientWidth+1:false};});
    checks[checks.length-1].mobileOverflow=overflow;
    await page.setViewportSize({width:1440,height:900});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));

  }
  failure=false;
  for(const id of ['dashboard','accounts','finder','settings']){
    await page.evaluate(id=>{const w=window.__macOS.wm;[...w.windows.value].forEach(a=>w.closeWindow(a.id));w.openApp(id);},id);
    await page.waitForTimeout(700);
    await page.screenshot({path:'output/playwright/release/all-apps/'+id+'-light.png',animations:'disabled'});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));
    await page.screenshot({path:'output/playwright/release/all-apps/'+id+'-dark.png',animations:'disabled'});
    await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));
  }
  await page.evaluate(()=>{const w=window.__macOS.wm;[...w.windows.value].forEach(a=>w.closeWindow(a.id));});
  await page.screenshot({path:'output/playwright/release/all-apps/desktop-light.png',animations:'disabled'});
  await page.getByRole('navigation').filter({has:page.getByRole('button',{name:'启动台',exact:true})}).getByRole('button',{name:'启动台',exact:true}).click();
  await page.getByRole('dialog',{name:'应用程序',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/release/all-apps/launcher-light.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'控制中心',exact:true}).click();
  await page.getByRole('region',{name:'控制中心',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/release/all-apps/control-center-light.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
  for(const id of ['settings','finder','dashboard','accounts']){
    await page.evaluate(id=>{const w=window.__macOS.wm;[...w.windows.value].forEach(a=>w.closeWindow(a.id));w.openApp(id);},id);
    await page.waitForTimeout(300);
    await page.screenshot({path:'output/playwright/release/all-apps/'+id+'-mobile.png',animations:'disabled'});
  }
  if (checks.length !== 26 || errors.length || writes || checks.some(c=>!c.rendered || c.brokenImages.length || c.mobileOverflow.window || c.mobileOverflow.app)) throw new Error('全应用检查未通过: '+JSON.stringify({count:checks.length,errors,writes,failed:checks.filter(c=>!c.rendered || c.brokenImages.length || c.mobileOverflow.window || c.mobileOverflow.app)}));
  return {passed:true,apps:checks,appCount:checks.length,pageErrors:errors,writes,fixtureOnly:true,apiPaths:[...new Set(apiRequests)]};
}
