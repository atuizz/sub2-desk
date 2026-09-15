async(page)=>{
 const origin='http://127.0.0.1:5181',checks=[],writes=[];
 const unrelated={id:'docs-link',label:'已有菜单',url:'https://docs.example.test',visibility:'user',sort_order:0,icon_svg:'',future:'preserve'};
 let menu=[unrelated];
 const accounts=['openai','anthropic','grok'].map((platform,i)=>({id:i+1,name:['产品团队','文档助手','研究账号'][i],platform,type:'apikey',status:'active',concurrency:5,priority:10,group_ids:[],credentials:{},extra:{},schedulable:true,created_at:'2026-09-12T00:00:00Z'}));
 await page.unrouteAll({behavior:'wait'});
 await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
 await page.route('https://catfk.com/**',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<html lang="zh"><head><meta charset="utf-8"></head><body><h1>隔离小铺</h1><p>请选择商品，购买后兑换</p></body></html>'}));
 await page.route(origin+'/api/**',r=>{
  const req=r.request(),p=req.url().slice(origin.length).split('?')[0],ok=data=>r.fulfill({json:{code:0,data}});
  if(req.method()!=='GET') {
   writes.push({p,body:req.postDataJSON()});
   if(p==='/api/v1/admin/settings'){menu=req.postDataJSON().custom_menu_items;return ok({custom_menu_items:menu});}
   if(p==='/api/v1/admin/accounts/data')return ok({account_created:3,account_failed:0,proxy_created:0,proxy_reused:0,proxy_failed:0});
   return r.fulfill({status:403,json:{message:'Unexpected fixture write'}});
  }
  if(p.endsWith('/auth/me'))return ok({id:987,email:'desktop@example.invalid',role:'admin',status:'active',balance:0});
  if(p.endsWith('/settings/public')||p.endsWith('/admin/settings'))return ok({custom_menu_items:menu});
  if(p.endsWith('/admin/accounts'))return ok({items:accounts,total:3,page:1,page_size:20,pages:1});
  if(p.endsWith('/admin/groups/all'))return ok([]);
  return r.fulfill({status:503,json:{message:'Isolated fixture'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('auth_token','desktop-fixture');sessionStorage.setItem('sub2_booted','true');});
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked');
 await page.waitForFunction(()=>window.__macOS?.authStore.isAdmin);
 if(await page.evaluate(()=>!!window.__macOS.wm.registeredApps.value.card_shop))throw Error('unconfigured app visible');checks.push('unconfigured shop hidden');
 await page.evaluate(()=>window.__macOS.wm.openApp('settings',{tab:'admin_cardshop'}));
 const settings=page.getByRole('region',{name:'系统设置',exact:true});await settings.getByRole('button',{name:'添加店铺',exact:true}).click();
 await settings.getByLabel('店铺 1 名称',{exact:true}).fill('测试卡网');await settings.getByLabel('店铺地址',{exact:true}).fill('https://catfk.com/shop/fixture');
 await settings.getByRole('button',{name:'保存店铺',exact:true}).click();await settings.getByText('小铺配置已保存',{exact:true}).waitFor();
 await page.waitForFunction(()=>!!window.__macOS.wm.registeredApps.value.card_shop);
 if(menu.find(i=>i.id==='docs-link')?.future!=='preserve')throw Error('unrelated settings lost');checks.push('settings persisted and app appears');
 await page.evaluate(()=>window.__macOS.wm.openApp('card_shop'));const shop=page.getByRole('region',{name:'小铺',exact:true});await shop.waitFor();
 await shop.frameLocator('iframe').getByRole('heading',{name:'隔离小铺'}).waitFor();
 if(await shop.getByRole('link',{name:'外部打开 ↗'}).getAttribute('href')!=='https://catfk.com/shop/fixture')throw Error('wrong external target');
 await shop.getByRole('button',{name:'重新读取店铺'}).click();await shop.frameLocator('iframe').getByRole('heading',{name:'隔离小铺'}).waitFor();checks.push('embedded shop external fallback and refresh');
 await page.screenshot({path:'output/desktop-experience/shop-light.png'});
 await shop.getByRole('button',{name:'兑换购买的卡密'}).click();await page.getByRole('region',{name:'卡券兑换',exact:true}).waitFor();checks.push('redeem handoff');
 await page.evaluate(()=>{const w=window.__macOS.wm;for(const v of [...w.windows.value])w.closeWindow(v.id);});
 const exported={type:'sub2api-data',version:1,accounts:accounts.map(a=>({...a,credentials:{api_key:'fixture-secret-never-in-preview'}})),proxies:[]};
 await page.evaluate(data=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(data)],'accounts.json',{type:'application/json'}));document.body.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:dt}));document.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},exported);
 const importSheet=page.getByRole('dialog',{name:'导入账号',exact:true});await importSheet.getByRole('button',{name:'确认导入',exact:true}).waitFor();
 if(writes.some(w=>w.p.endsWith('/accounts/data')))throw Error('drop uploaded without confirmation');
 if((await importSheet.innerText()).includes('fixture-secret-never-in-preview'))throw Error('secret visible in preview');
 await page.screenshot({path:'output/desktop-experience/import-light.png'});checks.push('desktop drop previews without upload');
 await importSheet.getByRole('button',{name:'取消',exact:true}).click();await importSheet.waitFor({state:'hidden'});
 const win=page.getByRole('region',{name:'账号管理',exact:true});
 if(await win.locator('.accounts-platform-nav .platform-mark svg').count()<3)throw Error('missing platform symbols');
 await page.screenshot({path:'output/desktop-experience/accounts-light.png'});await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));await page.screenshot({path:'output/desktop-experience/accounts-dark.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/desktop-experience/accounts-mobile.png'});
 const bounds=await win.boundingBox();if(bounds.x<0||bounds.x+bounds.width>391)throw Error('account window overflow');checks.push('platform marks and responsive views');
 await win.evaluate((el,data)=>{const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(data)],'accounts.json',{type:'application/json'}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},exported);
 await importSheet.getByRole('button',{name:'确认导入',exact:true}).click();await importSheet.getByText(/导入完成/).waitFor();
 if(writes.filter(w=>w.p.endsWith('/accounts/data')).length!==1)throw Error('not exactly one import');checks.push('window drop and confirmed import');
 await importSheet.getByRole('button',{name:'关闭',exact:true}).click();
 await page.evaluate(()=>{const dt=new DataTransfer();dt.items.add(new File(['not json'],'readme.txt'));document.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));});
 await page.getByRole('status').filter({hasText:'目前支持账号 JSON 文件'}).waitFor();checks.push('unsupported file stays on desktop');
 await page.evaluate(data=>{window.__macOS.authStore.user={...window.__macOS.authStore.user,role:'user'};const dt=new DataTransfer();dt.items.add(new File([JSON.stringify(data)],'accounts.json',{type:'application/json'}));document.body.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));},exported);
 await page.getByRole('status').filter({hasText:'请先以管理员身份登录'}).waitFor();if(writes.filter(w=>w.p.endsWith('/accounts/data')).length!==1)throw Error('non-admin import');checks.push('non-admin drop rejected');
 return {passed:true,checks,writes:writes.map(w=>w.p),fixtureOnly:true};
}
