async(page)=>{
 const origin='http://127.0.0.1:5181',writes=[];
 const job={id:'batch_fixture',object:'image.batch',task_name:'浏览器测试任务',status:'running',model:'gemini-fixture',provider:'gemini_api',item_count:1,success_count:0,fail_count:0,estimated_cost:1,hold_amount:1,actual_cost:null,created_at:1700000000,submitted_at:1700000000,settled_at:null};
 let created=false;
 await page.unrouteAll({behavior:'wait'});
 await page.route(origin+'/api/**',r=>{
  const url=r.request().url(),ok=data=>r.fulfill({json:{code:0,data}});
  if(url.includes('/auth/me'))return ok({id:997,role:'user',email:'fixture@example.invalid',status:'active',balance:0});
  if(url.includes('/keys'))return ok({items:[{id:1,name:'测试密钥',key:'fixture-key',status:'active',group:{platform:'gemini',allow_batch_image_generation:true}}],total:1,page:1,page_size:100,pages:1});
  if(url.includes('/settings/public'))return ok({});return r.fulfill({status:503,json:{message:'未配置的隔离接口'}});
 });
 await page.route(origin+'/v1/images/batches**',r=>{
  const request=r.request(),p=request.url().slice(origin.length).split('?')[0];
  if(request.method()==='POST'){writes.push({p,body:request.postDataJSON(),idempotency:request.headers()['idempotency-key']});if(p.endsWith('/cancel'))return r.fulfill({status:503,json:{message:'取消暂时失败，请重试'}});created=true;return r.fulfill({json:job});}
  if(p.endsWith('/models'))return r.fulfill({json:{object:'list',data:[{id:'gemini-fixture',object:'model',provider:'gemini_api'}]}});
  if(p.endsWith('/items'))return r.fulfill({json:{object:'list',data:[],has_more:false}});
  if(p==='/v1/images/batches')return r.fulfill({json:{object:'list',data:created?[job]:[],has_more:false}});
  return r.fulfill({json:job});
 });
 await page.addInitScript(()=>localStorage.setItem('auth_token','fixture-batch'));
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/batch-image?noboot&unlocked');
 const win=page.getByRole('region',{name:'批量生图',exact:true});await win.waitFor();await win.getByLabel('提交密钥').selectOption('1');
 await win.getByRole('button',{name:'创建任务',exact:true}).click();const sheet=page.getByRole('dialog',{name:'创建批量任务',exact:true});
 await sheet.waitFor();await sheet.getByLabel('任务名称',{exact:true}).fill('浏览器测试任务');await sheet.getByLabel('提示词',{exact:true}).fill('Fixture landscape');await sheet.getByRole('button',{name:'添加提示词',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/parity-completion/batch-create-mobile.png'});
 await sheet.getByRole('button',{name:'提交任务（将冻结费用）',exact:true}).click();await sheet.waitFor({state:'hidden'});
 if(writes.length!==1 || !writes[0].idempotency || writes[0].body.items[0].prompt!=='Fixture landscape')throw Error('bad submission');
 const detail=page.getByRole('dialog').filter({has:page.getByRole('heading',{name:'任务详情',exact:true})});await detail.waitFor();await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
 await win.getByRole('button',{name:'浏览器测试任务',exact:true}).click();await detail.waitFor();await page.keyboard.press('Escape');await detail.waitFor({state:'hidden'});
 await win.getByRole('button',{name:'取消任务',exact:true}).click();const confirm=page.getByRole('alertdialog');await confirm.waitFor();await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});if(writes.length!==1)throw Error('cancel dialog wrote data');
 await win.getByRole('button',{name:'取消任务',exact:true}).click();await confirm.waitFor();await confirm.getByRole('button',{name:'好',exact:true}).click();await confirm.getByText('取消暂时失败，请重试',{exact:true}).waitFor();if(writes.length!==2)throw Error('cancel failure duplicated request');await page.keyboard.press('Escape');await confirm.waitFor({state:'hidden'});
 return {passed:true,fixtureOnly:true,checks:['deep link','eligible key and models','compose','idempotent submit','mobile sheet','details escape','cancel confirmation escape','cancel failure stays visible','cancel failure can dismiss'],writes:writes.length};
}
