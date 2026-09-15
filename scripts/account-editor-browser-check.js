async(page)=>{
 const origin='http://127.0.0.1:5181', checks=[], writes=[];
 const rows=['openai','anthropic','grok'].map((platform,i)=>({id:i+1,name:['Codex · 产品研发','Claude · 写作工作室','Grok · 研究'][i],platform,type:'oauth',status:i===2?'error':'active',current_concurrency:i,concurrency:10,priority:i,rate_multiplier:1,groups:[{id:1,name:'默认分组'}],group_ids:[1],credentials:{},extra:{},schedulable:true,quota_daily_limit:100,quota_daily_used:i*27,last_used_at:'2026-09-12T08:00:00Z'}));
 await page.route(origin+'/api/**',r=>{
  const request=r.request(),p=request.url().slice(origin.length).split('?')[0],ok=data=>r.fulfill({json:{code:0,data}});
  if(request.method()!=='GET'){
   writes.push(p);
   if(p.endsWith('/generate-auth-url'))return ok({auth_url:'https://auth.example.invalid/authorize?state=fixture',session_id:'fixture',state:'fixture'});
   return r.fulfill({status:403,json:{message:'Fixture rejects business writes'}});
  }
  if(p.endsWith('/auth/me'))return ok({id:987,email:'editor@example.invalid',role:'admin',status:'active',balance:0});
  if(p.endsWith('/settings/public'))return ok({custom_menu_items:[]});
  if(p.endsWith('/admin/accounts'))return ok({items:rows,total:3,page:1,page_size:20,pages:1});
  if(p.endsWith('/groups/all'))return ok([{id:1,name:'默认分组',platform:'openai',status:'active'}]);
  if(p.endsWith('/proxies/all'))return ok([]);
  return r.fulfill({status:503,json:{message:'Unconfigured fixture'}});
 });
 await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
 await page.addInitScript(()=>{localStorage.setItem('auth_token','fixture-editor');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copiedAuthorization=text}}});});
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked&app=accounts');
 const win=page.getByRole('region',{name:'账号管理',exact:true});await win.getByText('Codex · 产品研发',{exact:true}).waitFor();
 await page.screenshot({path:'output/account-editor-final/list-light.png'});
 await win.getByRole('button',{name:/添加账号/}).first().click();const sheet=page.getByRole('dialog',{name:'添加账号',exact:true});await sheet.waitFor();
 if(await sheet.getByLabel('账号名称',{exact:true}).isVisible())throw Error('first screen includes credentials');
 await page.screenshot({path:'output/account-editor-final/wizard-platform.png',animations:'disabled'});
 await sheet.getByRole('button',{name:'ChatGPT · Codex',exact:true}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();
 if(await sheet.getByRole('button',{name:'下一步',exact:true}).isEnabled())throw Error('missing required fields enabled');checks.push('required fields gate');
 await sheet.getByRole('button',{name:/OAuth 授权/}).click();await sheet.getByLabel('账号名称',{exact:true}).fill('Codex 工作账号');
 await sheet.getByRole('button',{name:'生成授权链接',exact:true}).click();await sheet.getByLabel('本次授权链接',{exact:true}).waitFor();
 await sheet.getByRole('button',{name:'复制链接',exact:true}).click();await sheet.getByText('授权链接已复制',{exact:true}).waitFor();
 if(await page.evaluate(()=>window.__copiedAuthorization)!=='https://auth.example.invalid/authorize?state=fixture')throw Error('wrong clipboard');checks.push('platform cards and visible OAuth copy');
 await page.screenshot({path:'output/account-editor-final/editor-light.png'});
 await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));await page.screenshot({path:'output/account-editor-final/editor-dark.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/account-editor-final/editor-mobile.png'});
 const rect=await sheet.boundingBox();if(rect.x<0||rect.x+rect.width>391)throw Error('mobile overflow');
 if(!(await sheet.getByRole('button',{name:'下一步',exact:true}).isVisible()))throw Error('step footer missing');checks.push('mobile footer accessible');
 await sheet.getByRole('button',{name:'上一步',exact:true}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();if(await sheet.getByLabel('账号名称',{exact:true}).inputValue()!=='Codex 工作账号')throw Error('back lost draft');if(await sheet.getByLabel('本次授权链接',{exact:true}).inputValue()!=='https://auth.example.invalid/authorize?state=fixture')throw Error('back lost OAuth');checks.push('back preserves draft and OAuth');
 await sheet.getByRole('button',{name:/API 密钥/}).click();await sheet.getByLabel('API Key',{exact:true}).fill('fixture-only');await sheet.getByRole('button',{name:'下一步',exact:true}).click();await sheet.getByRole('heading',{name:'确认并添加账号',exact:true}).waitFor();if(!(await sheet.getByRole('button',{name:'创建账号',exact:true}).isEnabled()))throw Error('ready final disabled');checks.push('final confirmation and advanced settings');await page.screenshot({path:'output/account-editor-final/wizard-confirm-mobile.png',animations:'disabled'});
 await page.keyboard.press('Escape');await sheet.waitFor({state:'hidden'});await page.screenshot({path:'output/account-editor-final/list-mobile.png'});
 if(writes.length!==1||!writes[0].endsWith('/generate-auth-url'))throw Error('unexpected write');
 return {passed:true,checks,fixtureOnly:true,writes};
}
