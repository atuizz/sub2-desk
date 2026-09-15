async(page)=>{
 const origin='http://127.0.0.1:5181';let fail=true;const writes=[];
 const email={alert:{enabled:false,recipients:[],min_severity:'',rate_limit_per_hour:10,batching_window_seconds:60,include_resolved_alerts:true},report:{enabled:false,recipients:[],daily_summary_enabled:false,daily_summary_schedule:'0 8 * * *',weekly_summary_enabled:false,weekly_summary_schedule:'0 8 * * 1',error_digest_enabled:false,error_digest_schedule:'0 * * * *',error_digest_min_count:1,account_health_enabled:false,account_health_schedule:'0 8 * * *',account_health_error_rate_threshold:10}};
 await page.unrouteAll({behavior:'wait'});
 await page.route(origin+'/api/**',r=>{
  const request=r.request(),url=request.url(),ok=data=>r.fulfill({json:{code:0,data}});
  if(request.method()!=='GET') { writes.push({url,body:request.postDataJSON()});return ok(email); }
  if(url.includes('/auth/me'))return ok({id:997,role:'admin',email:'fixture@example.invalid',status:'active',balance:0});
  if(url.includes('/settings/public'))return ok({});
  if(url.includes('/email-notification/config'))return fail?r.fulfill({status:503,json:{message:'读取失败'}}):ok(email);
  return r.fulfill({status:503,json:{message:'隔离夹具未提供'}});
 });
 await page.addInitScript(()=>localStorage.setItem('auth_token','fixture-advanced'));
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked&app=ops');
 await page.waitForFunction(()=>window.__macOS?.authStore.isAdmin);
 await page.getByRole('button',{name:'告警规则',exact:true}).click();await page.getByRole('button',{name:'邮件告警配置',exact:true}).click();
 const sheet=page.getByRole('dialog',{name:'邮件告警与报告',exact:true});await sheet.waitFor();
 await sheet.getByRole('button',{name:'重试读取',exact:true}).waitFor();
 if(await sheet.getByRole('button',{name:'保存配置'}).isEnabled())throw Error('unread configuration writable');
 fail=false;await sheet.getByRole('button',{name:'重试读取',exact:true}).click();
 const recipients=sheet.getByLabel('收件人（每行一个）',{exact:true});await recipients.fill('invalid');
 await sheet.getByRole('button',{name:'保存配置'}).click();await sheet.getByRole('alert').waitFor();if(writes.length)throw Error('invalid address submitted');
 await recipients.fill('test@example.invalid');await sheet.getByRole('button',{name:'保存配置'}).click();await sheet.getByText('配置已保存',{exact:true}).waitFor();
 if(writes.length!==1 || writes[0].body.alert.recipients[0]!=='test@example.invalid')throw Error('wrong payload');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/parity-completion/alert-email-mobile.png'});
 const bounds=await sheet.boundingBox();if(bounds.x<0 || bounds.x+bounds.width>391)throw Error('sheet overflows mobile');
 await sheet.getByRole('button',{name:'关闭',exact:true}).click();await sheet.waitFor({state:'hidden'});
 return {passed:true,fixtureOnly:true,checks:['read failure blocks save','retry read','invalid address blocks write','valid payload','mobile sheet','close'],writes:writes.length};
}
