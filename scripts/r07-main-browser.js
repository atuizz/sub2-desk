async (page) => {
  const origin='http://127.0.0.1:5173', checks=[], writes=[], errors=[];
  const check=(name,pass)=>{if(!pass)throw Error(name);checks.push(name);};
  const phrase='我已阅读、理解并同意 Sub2API 部署与运营合规承诺';
  let complianceRequired=true, pendingCreate=false;
  const rows=['openai','anthropic','grok','gemini','minimax','kimi'].map((platform,i)=>({id:i+1,name:platform+' fixture',platform,type:'apikey',status:'active',concurrency:10,priority:0,rate_multiplier:1,groups:[{id:3,name:'开发分组'}],group_ids:[3],credentials:{},extra:{},schedulable:true}));
  const user={id:987,email:'review@example.invalid',username:'本地验收',role:'admin',status:'active',balance:128.5};
  let key={id:17,user_id:21,name:'客户端密钥',key:'sk-fixture',group_id:3,status:'active'};
  await page.unrouteAll({behavior:'wait'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
  await page.route(origin+'/api/**',async r=>{
    const req=r.request(), p=req.url().slice(origin.length).split('?')[0];
    const ok=data=>r.fulfill({json:{code:0,data}});
    if(req.method()!=='GET'){
      const data=req.postDataJSON();writes.push({p,data,headers: {'idempotency-key':req.headers()['idempotency-key']}});
      if(p==='/api/v1/admin/compliance/accept'){check('exact compliance phrase sent',data.phrase===phrase);complianceRequired=false;return ok({required:false});}
      if(p==='/api/v1/admin/accounts'){pendingCreate=true;return r.abort('failed');}
      if(p==='/api/v1/admin/api-keys/17'){key={...key,group_id:data.group_id};return ok({api_key:key,auto_granted_group_access:data.group_id===4,granted_group_name:'生产分组'});}
      if(p.includes('content-moderation')&&p.endsWith('/config'))return ok(data);
      return r.fulfill({status:403,json:{message:'Unexpected fixture write'}});
    }
    if(p.endsWith('/auth/me'))return ok(user);
    if(p.endsWith('/admin/compliance'))return ok({required:complianceRequired,version:'fixture-v1',ack_phrase_zh:phrase,ack_phrase_en:'fixture acknowledgement'});
    if(p.endsWith('/settings/public'))return ok({custom_menu_items:[{id:'docs',label:'使用文档',visibility:'user',page_slug:'guide'}]});
    if(p==='/api/v1/pages/guide')return ok({content:'# 使用文档\n\n[跳到安装](#安装说明) · [首页](/home)\n\n'+('段落。\n\n'.repeat(25))+'## 安装说明\n完成安装。',format:'markdown'});
    if(p.endsWith('/admin/accounts'))return ok({items:rows,total:rows.length,page:1,page_size:20,pages:1});
    if(p.endsWith('/admin/accounts/41'))return ok({id:41,name:'上次创建的账号',platform:'openai',type:'apikey',credentials:{api_key:'do-not-show'}});
    if(p.endsWith('/groups/all'))return ok([{id:3,name:'开发分组',platform:'openai',status:'active'},{id:4,name:'生产分组',platform:'openai',status:'active'}]);
    if(p.endsWith('/proxies/all'))return ok([]);
    if(p.endsWith('/admin/users/21/api-keys'))return ok({items:[key],total:1});
    if(p.endsWith('/admin/users'))return ok({items:[{...user,id:21,role:'user',email:'member@example.invalid',allowed_groups:[3]}],total:1});
    if(p.endsWith('/admin/ops/dashboard/overview')||p.endsWith('/admin/ops/dashboard'))return ok({health_score:100,request_count_total:0});
    if(p.includes('/ops/') && p.endsWith('/advanced-settings'))return ok({auto_refresh_enabled:false,display_alert_events:false});
    if(p.includes('content-moderation')&&p.endsWith('/config'))return ok({enabled:true,mode:'observe',base_url:'https://moderation.invalid',model:'fixture',worker_count:4,queue_size:20,timeout_ms:1000});
    if(p.includes('content-moderation')&&p.endsWith('/status'))return ok({});
    return r.fulfill({status:503,json:{message:'Unconfigured read fixture'}});
  });
  await page.addInitScript(()=>{localStorage.setItem('auth_token','r07-browser-fixture');sessionStorage.removeItem('sub2api:admin:account-create-pending');localStorage.setItem('sub2-desktop-preferences',JSON.stringify({appearance:'light',brightness:100,volume:0,wallpaper:'tahoe'}));});
  await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked&app=accounts');
  const compliance=page.getByRole('dialog',{name:'管理员合规确认',exact:true});await compliance.waitFor();
  await compliance.getByPlaceholder(phrase,{exact:true}).fill(phrase);
  await compliance.getByRole('button',{name:'确认并继续',exact:true}).click();await compliance.waitFor({state:'hidden'});
  const win=page.getByRole('region',{name:'账号管理',exact:true});await win.getByText('openai fixture',{exact:true}).waitFor();
  await win.getByRole('button',{name:/添加账号/}).first().click();const sheet=page.getByRole('dialog',{name:'添加账号',exact:true});await sheet.waitFor();
  await sheet.getByRole('button',{name:'ChatGPT · Codex',exact:true}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();
  await sheet.getByRole('button',{name:/OAuth 授权/}).click();await sheet.getByLabel('账号名称',{exact:true}).fill('导入工作账号');
  await sheet.getByRole('button',{name:/批量导入授权/}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();
  await sheet.getByLabel('开发分组',{exact:true}).check();await sheet.getByLabel('并发限制',{exact:true}).fill('6');await sheet.getByLabel('优先级',{exact:true}).fill('2');
  await page.screenshot({path:'output/final-fixes/accounts-batch-light.png',animations:'disabled'});
  await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));await page.screenshot({path:'output/final-fixes/accounts-batch-dark.png',animations:'disabled'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/final-fixes/accounts-batch-mobile.png',animations:'disabled'});
  check('390px final action visible',await sheet.getByRole('button',{name:'继续导入授权材料',exact:true}).isVisible());
  await sheet.getByRole('button',{name:'继续导入授权材料',exact:true}).click();const batch=page.getByRole('dialog',{name:'批量授权 · 导入工作账号',exact:true});await batch.waitFor();
  check('batch settings reached without OAuth exchange',writes.length===1);
  await batch.getByRole('button',{name:'关闭',exact:true}).click();
  await page.keyboard.press('Escape');const discard=page.getByRole('alertdialog',{name:'放弃未保存的更改？',exact:true});await discard.waitFor();
  await discard.getByRole('button',{name:'继续编辑',exact:true}).click();check('draft preserved after cancelled dismissal',await sheet.getByLabel('并发限制',{exact:true}).inputValue()==='6');
  await page.keyboard.press('Escape');await discard.getByRole('button',{name:'放弃更改',exact:true}).click();await sheet.waitFor({state:'hidden'});
  await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>window.__macOS.systemStore.setAppearance('light'));
  await win.getByRole('button',{name:/添加账号/}).first().click();await sheet.getByRole('button',{name:'ChatGPT · Codex',exact:true}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();
  await sheet.getByLabel('账号名称',{exact:true}).fill('未知结果测试');await sheet.getByLabel('API Key',{exact:true}).fill('fake-fixture-secret');await sheet.getByRole('button',{name:'下一步',exact:true}).click();
  await sheet.getByRole('button',{name:'创建账号',exact:true}).click();await sheet.getByRole('button',{name:'核对创建结果',exact:true}).waitFor();
  check('unknown creation disables resubmit',pendingCreate&&await sheet.getByRole('button',{name:'创建账号',exact:true}).isDisabled());
  await sheet.getByRole('button',{name:'核对创建结果',exact:true}).click();const review=page.getByRole('dialog',{name:'核对上次创建结果',exact:true});await review.waitFor();
  await review.getByLabel('已创建的账号编号',{exact:true}).fill('41');await review.getByRole('button',{name:'读取账号核对',exact:true}).click();await review.getByText('上次创建的账号 · OpenAI · #41',{exact:true}).waitFor();
  check('review excludes credentials',!(await review.innerText()).includes('do-not-show'));
  await review.getByRole('checkbox',{name:'我已确认这是上次创建的账号',exact:true}).check();await review.getByRole('button',{name:'确认完成并关闭草稿',exact:true}).click();await review.waitFor({state:'hidden'});
  check('only one account POST',writes.filter(w=>w.p==='/api/v1/admin/accounts').length===1);
  await page.screenshot({path:'output/final-fixes/accounts-list.png',animations:'disabled'});
  await page.evaluate(()=>{const wm=window.__macOS.wm;[...wm.windows.value].forEach(w=>wm.closeWindow(w.id));});
  for(const name of ['后端连接，查看可用渠道','查看后端连接','账户余额 128.50 美元，打开钱包','搜索应用']){
    const button=page.getByRole('button',{name,exact:true});await button.focus();await page.keyboard.press('Enter');
    check('keyboard action '+name,await page.evaluate(()=>window.__macOS.wm.windows.value.length>0||!!document.querySelector('[role="dialog"]')));
    await page.keyboard.press('Escape');await page.evaluate(()=>{const wm=window.__macOS.wm;[...wm.windows.value].forEach(w=>wm.closeWindow(w.id));});
  }
  await page.evaluate(()=>window.__macOS.wm.openApp('users'));const users=page.getByRole('region',{name:'用户管理',exact:true});await users.getByText('member@example.invalid',{exact:true}).waitFor();await users.getByTitle('API Keys',{exact:true}).click();
  const keys=page.getByRole('dialog',{name:'用户 API 密钥',exact:true});await keys.getByLabel('客户端密钥的分组').selectOption('4');await keys.getByRole('button',{name:'保存分组',exact:true}).click();await keys.getByText(/并已授予/).waitFor();
  await keys.getByLabel('客户端密钥的分组').selectOption('0');await keys.getByRole('button',{name:'保存分组',exact:true}).click();await keys.getByText('密钥分组绑定已解除。',{exact:true}).waitFor();
  check('key group bind and unbind payload',writes.filter(w=>w.p.endsWith('/api-keys/17')).map(w=>w.data.group_id).join(',')==='4,0');
  await page.screenshot({path:'output/final-fixes/user-key-groups.png',animations:'disabled'});
  check('browser runtime errors absent',errors.length===0);
  return {passed:true,checks,writes,errors,fixtureOnly:true};
}
