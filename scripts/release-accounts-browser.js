async page => {
 page.setDefaultTimeout(12000);
 const origin='http://127.0.0.1:5208',writes=[],checks=[];
 let enabled=false;
 const rows=[{id:1,name:'Fixture Claude',platform:'anthropic',type:'oauth',status:'active',concurrency:10,priority:0,group_ids:[1],groups:[{id:1,name:'Fixture group'}],credentials:{access_token:'fixture'},extra:{future:'keep'},schedulable:true}];
 await page.route('**/*',r=>{
  const q=r.request();if(!q.url().startsWith(origin+'/'))return r.abort();const u={pathname:q.url().slice(origin.length).split('?')[0]};
  if(!u.pathname.startsWith('/api/')&&u.pathname!=='/health')return r.continue();
  const p=u.pathname,ok=data=>r.fulfill({json:{code:0,data}});
  if(q.method()!=='GET'){
   const payload=q.postDataJSON();writes.push({p,payload});
   if(p.endsWith('check-mixed-channel'))return ok({has_risk:true,details:{group_name:'Fixture group'}});
   if(p.endsWith('auth-url')||p.endsWith('generate-auth-url'))return ok({auth_url:'https://provider.invalid/?state=fixture',state:'fixture',session_id:'fixture'});
   if(p.endsWith('exchange-code'))return ok({access_token:'fixture',refresh_token:'fixture',oauth_type:'ai_studio'});
   if(p.endsWith('/accounts')||p.endsWith('/accounts/1'))return ok({...rows[0],id:99,...payload});
   return r.fulfill({status:403,json:{message:'Unexpected fixture write'}});
  }
  if(p.endsWith('/auth/me'))return ok({id:987,email:'fixture@example.invalid',role:'admin',status:'active',balance:0});
  if(p.endsWith('/settings/public'))return ok({custom_menu_items:[]});
  if(p.endsWith('/admin/accounts'))return ok({items:rows,total:1,page:1,page_size:20,pages:1});
  if(p.endsWith('/accounts/1'))return ok(rows[0]);
  if(p.endsWith('/groups/all'))return ok([{id:1,name:'Fixture group',platform:'anthropic',status:'active'}]);
  if(p.endsWith('/proxies/all'))return ok([]);
  if(p.endsWith('/tls-fingerprint-profiles'))return ok([{id:7,name:'Fixture TLS'}]);
  if(p.endsWith('/capabilities'))return ok({ai_studio_oauth_enabled:enabled,required_redirect_uris:['https://fixture.invalid/callback']});
  if(p.endsWith('/admin/settings'))return ok({account_quota_notify_enabled:false});
  return ok({});
 });
 await page.addInitScript(()=>localStorage.setItem('auth_token','fixture-only'));
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked&app=accounts');
 const win=page.getByRole('region',{name:'账号管理',exact:true});await win.getByText('Fixture Claude',{exact:true}).waitFor();
 await win.getByRole('button',{name:'编辑账号 Fixture Claude',exact:true}).click();
 let sheet=page.getByRole('dialog',{name:'编辑账号',exact:true});await sheet.waitFor();await sheet.getByText('平台与连接控制',{exact:true}).click();
 await sheet.getByLabel('启用 TLS 指纹',{exact:true}).check();await sheet.getByLabel('TLS 指纹配置',{exact:true}).selectOption('7');await sheet.getByLabel('掩蔽 Session ID',{exact:true}).check();await sheet.getByLabel('覆写缓存 TTL',{exact:true}).check();await sheet.getByLabel('缓存 TTL',{exact:true}).selectOption('1h');
 await page.screenshot({path:'output/release-accounts/controls-light.png',animations:'disabled'});
 await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));await page.screenshot({path:'output/release-accounts/controls-dark.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/release-accounts/controls-mobile.png',animations:'disabled'});
 const box=await sheet.boundingBox();if(box.x<0||box.x+box.width>391)throw Error('mobile overflow');
 await sheet.getByRole('button',{name:'保存更改',exact:true}).click();
 const risk=page.getByRole('alertdialog');await risk.waitFor();if(writes.some(x=>x.p.endsWith('/accounts/1')))throw Error('wrote before consent');
 await risk.getByRole('button',{name:'返回修改',exact:true}).click();await sheet.getByRole('button',{name:'保存更改',exact:true}).click();await risk.getByRole('button',{name:'了解风险，继续保存',exact:true}).click();await sheet.waitFor({state:'hidden'});
 const saved=writes.find(x=>x.p.endsWith('/accounts/1'))?.payload;if(saved?.extra?.tls_fingerprint_profile_id!==7||saved.extra.cache_ttl_override_target!=='1h'||saved.extra.session_id_masking_enabled!==true||saved.extra.future!=='keep'||!saved.confirm_mixed_channel_risk)throw Error('wrong settings payload');checks.push('TLS/TTL/masking actual edit, cancel, confirm, preserved unknown fields, 390px');
 await page.setViewportSize({width:1440,height:900});await win.getByRole('button',{name:/添加账号/}).first().click();sheet=page.getByRole('dialog',{name:'添加账号',exact:true});await sheet.getByRole('button',{name:'Google · Gemini',exact:true}).click();await sheet.getByRole('button',{name:'下一步',exact:true}).click();await sheet.getByRole('button',{name:/OAuth 授权/}).click();await sheet.getByLabel('账号名称',{exact:true}).fill('Fixture AI Studio');await sheet.getByLabel('授权类型').selectOption('ai_studio');
 await sheet.getByText('服务器尚未启用 AI Studio',{exact:false}).waitFor();if(await sheet.getByRole('button',{name:'生成授权链接',exact:true}).isEnabled())throw Error('capability not gated');enabled=true;await sheet.getByRole('button',{name:'重新检查配置',exact:true}).click();await sheet.getByRole('button',{name:'生成授权链接',exact:true}).click();
 await sheet.getByPlaceholder('完成浏览器授权后，粘贴授权码或完整回调网址').fill('fixture-code');await sheet.getByRole('button',{name:'完成授权',exact:true}).click();await sheet.getByText('授权已完成，保存账号后生效。',{exact:true}).waitFor();await sheet.getByRole('button',{name:'下一步',exact:true}).click();await sheet.getByRole('button',{name:'创建账号',exact:true}).click();await sheet.waitFor({state:'hidden'});
 const gemini=writes.find(x=>x.p.endsWith('/accounts')&&x.payload.platform==='gemini');if(gemini?.payload.credentials.oauth_type!=='ai_studio')throw Error('AI Studio credentials missing');checks.push('AI Studio disabled capability → retry → URL → exchange → three-screen create');
 return {checks,fixtureWrites:writes.length,realWrites:0};
}
