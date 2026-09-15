async (page) => {
  const origin='http://127.0.0.1:5181', checks=[], errors=[], writes=[];
  const check=(name,ok)=>{if(!ok)throw new Error(name);checks.push(name);};
  const user={id:999,username:'集成验收',email:'fixture@example.invalid',role:'admin',status:'active',balance:0};
  let enabled=false;
  await page.unrouteAll({behavior:'wait'});
  page.on('pageerror',e=>errors.push(e.message));
  await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
  await page.route(origin+'/api/**',r=>{
    const req=r.request(),p=req.url().split('?')[0],ok=data=>r.fulfill({json:{code:0,data}});
    if(req.method()!=='GET') {
      writes.push(p);
      if(p.endsWith('/totp/setup'))return ok({secret:'JBSWY3DPEHPK3PXP',setup_token:'fixture-setup',qr_code_url:'otpauth://totp/Fixture?secret=JBSWY3DPEHPK3PXP',countdown:300});
      if(p.endsWith('/totp/enable')){enabled=true;return ok({success:true});}
      return r.fulfill({status:403,json:{code:403,message:'非夹具写入被拒绝'}});
    }
    if(p.endsWith('/auth/me')||p.endsWith('/user/profile'))return ok(user);
    if(p.endsWith('/settings/public'))return ok({registration_enabled:false,password_reset_enabled:true});
    if(p.endsWith('/totp/status'))return ok({enabled,feature_enabled:true});
    if(p.endsWith('/totp/verification-method'))return ok({method:'password'});
    if(p.endsWith('/subscriptions'))return ok([
      {id:1,group_id:1,status:'active',starts_at:'2020-01-01',expires_at:'2099-01-01',group:{name:'有效订阅',platform:'openai',daily_limit_usd:10},daily_usage_usd:2},
      {id:2,group_id:2,status:'suspended',starts_at:'2020-01-01',expires_at:'2099-01-01',group:{name:'暂停订阅',platform:'anthropic'}}]);
    if(p.endsWith('/model-plaza'))return ok({groups:[{id:1,name:'测试分组',platform:'openai',rate_multiplier:2,models:[{name:'fixture-model',platform:'openai',pricing:{billing_mode:'token',input_price:0.000001,output_price:0.000003}}]}]});
    if(p.endsWith('/checkout-info'))return ok({methods:{},plans:[]});
    return ok({});
  });
  await page.addInitScript(()=>{localStorage.setItem('auth_token','p0-fixture');sessionStorage.setItem('sub2_booted','true');});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/?noboot&unlocked');
  await page.waitForFunction(()=>window.__macOS?.authStore.isAdmin);
  async function open(id,title){await page.evaluate(id=>{const wm=window.__macOS.wm;for(const w of [...wm.windows.value])wm.closeWindow(w.id);wm.openApp(id);},id);const win=page.getByRole('region',{name:title,exact:true});await win.waitFor();return win;}
  const models=await open('appstore','模型广场');
  await models.getByRole('button',{name:'查看 fixture-model 定价',exact:true}).click();
  const pricing=models.getByRole('dialog',{name:'模型定价',exact:true});await pricing.waitFor();
  check('模型定价应用分组倍率',await pricing.getByText('$2.00',{exact:true}).count()===1);
  for(let i=0;i<8;i++)await page.keyboard.press('Tab');
  check('定价Sheet焦点约束',await pricing.evaluate(el=>el.contains(document.activeElement)));
  await page.screenshot({path:'output/p0-final/model-pricing.png',animations:'disabled'});
  await page.keyboard.press('Escape');await pricing.waitFor({state:'detached'});
  const subs=await open('subscriptions','我的订阅');
  await subs.getByRole('navigation',{name:'订阅列表'}).waitFor();
  await subs.getByRole('button',{name:'其他',exact:true}).click();
  check('订阅过滤准确显示暂停状态',await subs.getByRole('navigation',{name:'订阅列表'}).getByRole('button').count()===1 && (await subs.innerText()).includes('已暂停'));
  await page.setViewportSize({width:390,height:844});
  check('订阅窄屏无根容器溢出',await subs.locator('.subscriptions-app').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await page.screenshot({path:'output/p0-final/subscriptions-mobile.png',animations:'disabled'});
  await subs.getByRole('button',{name:'购买订阅',exact:true}).click();
  await page.getByRole('region',{name:'购买与充值',exact:true}).getByText('暂无可购买的订阅计划',{exact:true}).waitFor();
  check('订阅购买打开钱包套餐页',true);
  await page.setViewportSize({width:1440,height:900});
  const settings=await open('settings','系统设置');
  await settings.getByRole('button',{name:'个人设置',exact:true}).click();
  await settings.getByRole('button',{name:'启用…',exact:true}).click();
  const totp=settings.getByRole('dialog',{name:'启用双因素认证',exact:true});
  await totp.getByLabel('当前密码').fill('fixture-password');
  await totp.getByRole('button',{name:'下一步',exact:true}).click();
  await totp.getByRole('img',{name:'身份验证器设置二维码'}).waitFor();
  check('TOTP设置显示二维码且尚未启用',!enabled && writes.length===1);
  await page.setViewportSize({width:390,height:844});
  check('TOTP窄屏弹层在视口内',await totp.evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight;}));
  await page.screenshot({path:'output/p0-final/totp-mobile.png',animations:'disabled'});
  await totp.getByLabel('动态验证码').fill('123456');
  await totp.getByRole('button',{name:'验证并启用',exact:true}).click();
  await settings.getByText('已启用双因素认证',{exact:true}).waitFor();
  check('TOTP启用后回读真实响应状态',enabled&&writes.length===2);
  check('没有页面异常',errors.length===0);
  return {passed:true,checks,fixtureOnly:true,interceptedWrites:writes.length,pageErrors:errors};
}
