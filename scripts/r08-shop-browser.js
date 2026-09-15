async(page)=>{
 const origin='http://127.0.0.1:5173',checks=[],errors=[],writes=[];
 const check=(name,value)=>{if(!value)throw Error(name);checks.push(name);};
 const original={id:'unrelated',label:'帮助',url:'https://example.invalid/help',visibility:'user',custom_flag:'keep'};
 let items=[original,{id:'sub2mac-shop-woai',label:'WOAI 小铺',url:'https://wzyp.cn/shop/woai',visibility:'user',sort_order:0}];
 await page.unrouteAll({behavior:'wait'});await page.routeWebSocket('**',ws=>ws.close());page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
 await page.route(origin+'/api/**',async r=>{
  const req=r.request(),path=req.url().slice(origin.length).split('?')[0],ok=data=>r.fulfill({json:{code:0,data}});
  if(req.method()!=='GET'){if(req.method()==='PUT'&&path==='/api/v1/admin/settings'){const data=req.postDataJSON();writes.push(data);items=data.custom_menu_items;return ok({custom_menu_items:items})}throw Error('Unexpected write '+path);}
  if(path.endsWith('/auth/me')||path.endsWith('/user/profile'))return ok({id:881,email:'admin@example.invalid',username:'管理员',role:'admin',status:'active',balance:0});
  if(path.endsWith('/admin/compliance'))return ok({required:false,version:'fixture',ack_phrase_zh:'fixture',ack_phrase_en:'fixture'});
  if(path.endsWith('/settings/public'))return ok({custom_menu_items:items});
  if(path.endsWith('/admin/settings'))return ok({custom_menu_items:items,site_name:'Sub2-Mac',smtp_password_configured:true,turnstile_secret_key_configured:true});
  if(path.includes('/payment/providers'))return ok([]);
  return r.fulfill({status:503,json:{message:'Unconfigured fixture'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('auth_token','r08-local-fixture');localStorage.setItem('sub2-desktop-preferences',JSON.stringify({appearance:'light',wallpaper:'tahoe',brightness:100,volume:0}));});
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked');await page.waitForFunction(()=>!!window.__macOS?.wm);
 await page.evaluate(()=>{const w=window.__macOS.wm.openApp('settings',{tab:'admin_cardshop'});w.rect={x:100,y:60,w:1240,h:740};});
 const win=page.getByRole('region',{name:'系统设置',exact:true}),panel=win.getByRole('region',{name:'小铺与兑换设置',exact:true});
 const name=panel.getByLabel('店铺 1 名称',{exact:true}),address=panel.getByLabel('店铺 1 地址',{exact:true});await name.waitFor();
 check('saved shop URL preserved',await address.inputValue()==='https://wzyp.cn/shop/woai');
 check('unadapted shop mode visible',await panel.getByText('外部浏览器',{exact:true}).isVisible());
 const bounds=await Promise.all([name.boundingBox(),address.boundingBox()]);check('name and URL inputs aligned',Math.abs(bounds[0].y-bounds[1].y)<2&&bounds[0].height===bounds[1].height);
 await page.screenshot({path:'output/r08-closeout/shop-light.png',animations:'disabled'});
 await name.fill('WOAI 精品小铺');await win.getByText('外观与主题',{exact:true}).click();await win.getByText('小铺与兑换',{exact:true}).click();check('switching settings category preserves draft',await name.inputValue()==='WOAI 精品小铺');
  await panel.getByRole('button',{name:'重新读取',exact:true}).click();const confirm=page.getByRole('alertdialog',{name:'放弃未保存的店铺修改？',exact:true});await confirm.waitFor();await confirm.getByRole('button',{name:'继续编辑',exact:true}).click();check('cancel reload preserves draft',await name.inputValue()==='WOAI 精品小铺');
 await confirm.waitFor({state:'hidden'});
 await win.locator('[data-test="traffic-close"]').click();
 const windowPrompt=page.getByRole('alertdialog',{name:'放弃未保存的更改？',exact:true});await windowPrompt.waitFor();await windowPrompt.getByRole('button',{name:'继续编辑',exact:true}).click();await windowPrompt.waitFor({state:'hidden'});
 check('settings red close cancellation preserves shop draft',await name.inputValue()==='WOAI 精品小铺');
 check('shop draft registers native refresh guard',await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}));
 await panel.getByRole('button',{name:'添加店铺',exact:true}).click();await panel.getByLabel('店铺 2 名称').fill('云猫寄售');await panel.getByLabel('店铺 2 地址').fill('https://catfk.com/shop/jianshang');check('adapted shop mode visible',await panel.getByText('应用内浏览',{exact:true}).isVisible());
 await page.evaluate(()=>window.__macOS.systemStore.setAppearance('dark'));await page.screenshot({path:'output/r08-closeout/shop-dark.png',animations:'disabled'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/r08-closeout/shop-mobile.png',animations:'disabled'});
 check('390px shop fields fit content',await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 await panel.getByRole('button',{name:'保存店铺',exact:true}).click();await panel.getByText('小铺配置已保存',{exact:true}).waitFor();
 check('only settings menu field submitted',writes.length===1&&Object.keys(writes[0]).join(',')==='custom_menu_items');check('other menus retained',writes[0].custom_menu_items.some(x=>x.id==='unrelated'&&x.custom_flag==='keep'));
 await panel.getByRole('button',{name:/移除店铺 2/}).click();check('remove only changes draft',writes.length===1);
 await panel.getByRole('button',{name:'重新读取',exact:true}).click();await confirm.getByRole('button',{name:'放弃并重新读取',exact:true}).click();await panel.getByLabel('店铺 2 名称').waitFor();check('explicit reload restores saved shops',writes.length===1);
 check('no page errors',errors.length===0);return {passed:true,checks,fixtureOnly:true,writes:writes.length,errors};
}
