async (page) => {
  const origin='http://127.0.0.1:5181', checks=[], writes=[], errors=[];
  const check=(name,value)=>{if(!value)throw new Error(name);checks.push(name);};
  const key={id:1,key:'fixture-batch-only',name:'批量测试密钥',status:'active',group:{platform:'gemini',allow_batch_image_generation:true}};
  const model='gemini-2.5-flash-image';
  const job=(id,status)=>({id,status,task_name:id==='running'?'进行中夹具':'已完成夹具',model,success_count:status==='running'?0:1,fail_count:0,hold_amount:1,actual_cost:status==='running'?null:1,created_at:1});
  let jobs=[job('running','running'),job('done','completed')], releaseCancel;
  await page.unrouteAll({behavior:'wait'});
  await page.route('**/*',async route=>{
    const req=route.request(),p=req.url().replace(origin,'').split('?')[0],m=req.method();
    if(!req.url().startsWith(origin+'/'))return route.abort();
    const ok=data=>route.fulfill({json:{code:0,data}});
    if(p==='/setup/status')return ok({needs_setup:false,step:'complete'});
    if(p==='/health')return route.fulfill({json:{status:'ok'}});
    if(p.startsWith('/api/')){
      if(m!=='GET')return route.fulfill({status:403,json:{code:403,message:'fixture forbids auth writes'}});
      if(p.endsWith('/auth/me'))return ok({id:99,username:'批量夹具',email:'batch@example.invalid',role:'user',status:'active',balance:50,concurrency:1});
      if(p.endsWith('/settings/public'))return ok({registration_enabled:false,site_name:'Batch Fixture'});
      if(p.endsWith('/keys'))return ok({items:[key],total:1,page:1,page_size:100});
      return ok({items:[],total:0,required:false});
    }
    if(p.startsWith('/v1/')){
      if(m!=='GET')writes.push({method:m,path:p,payload:req.postDataJSON(),idempotency:req.headers()['idempotency-key']});
      if(p.endsWith('/models'))return route.fulfill({json:{data:[{id:model}]}});
      if(p==='/v1/images/batches' && m==='GET')return route.fulfill({json:{data:jobs,has_more:false}});
      if(p==='/v1/images/batches' && m==='POST'){const data=req.postDataJSON();const j={...job('new','queued'),task_name:data.task_name};jobs=[j,...jobs];return route.fulfill({json:j});}
      if(p.endsWith('/cancel')){await new Promise(resolve=>{releaseCancel=resolve;});jobs=jobs.map(j=>j.id==='running'?{...j,status:'cancelled'}:j);return route.fulfill({json:jobs.find(j=>j.id==='running')});}
      if(p.endsWith('/items'))return route.fulfill({json:{data:[{custom_id:'img_1',status:'pending',prompt_preview:'详情完整提示词',image_count:0}],has_more:false}});
      if(m==='GET')return route.fulfill({json:jobs.find(j=>p.endsWith('/'+j.id))});
      return route.fulfill({status:403,json:{error:{message:'unexpected fixture mutation'}}});
    }
    if(m!=='GET')return route.abort();
    return route.continue();
  });
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('auth_token','fixture-only-token');sessionStorage.setItem('sub2_booted','true');});
  await page.setViewportSize({width:1440,height:900});
  await page.goto(origin+'/batch-image?noboot&unlocked');
  await page.waitForFunction(()=>window.__macOS?.wm);
  await page.evaluate(async()=>{await window.__macOS.authStore.initAuth();window.__macOS.systemStore.unlock();window.__macOS.wm.openApp('batch_image');});
  const win=page.getByRole('region',{name:'批量生图',exact:true});
  await win.getByText('进行中夹具',{exact:true}).waitFor();
  check('only one accessible batch region',await win.count()===1);
  await win.getByLabel('提交密钥',{exact:true}).selectOption('1');
  await win.getByRole('button',{name:'创建任务',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='创建任务')?.disabled);
  await win.getByRole('button',{name:'创建任务',exact:true}).click();
  const create=page.getByRole('dialog',{name:'创建批量任务',exact:true});await create.waitFor();
  check('empty create submit disabled',await create.getByRole('button',{name:'提交任务（将冻结费用）'}).isDisabled());
  await create.getByRole('button',{name:'添加提示词',exact:true}).click();
  check('blank prompt rejected without POST',(await create.getByRole('alert').innerText()).includes('不能为空') && writes.length===0);
  await create.getByLabel('提示词',{exact:true}).fill('第一行\n第二行');
  await create.getByLabel('唯一编号（可选）',{exact:true}).fill('fixture_1');
  await create.getByRole('button',{name:'添加提示词',exact:true}).click();
  check('valid draft enables submit',await create.getByRole('button',{name:'提交任务（将冻结费用）'}).isEnabled());
  await create.getByRole('button',{name:'返回',exact:true}).click();
  check('closing create draft sends no POST',writes.length===0);
  await win.getByRole('button',{name:'创建任务',exact:true}).click();await create.waitFor();
  await create.getByLabel('提示词',{exact:true}).fill('隔离生成测试');
  await create.getByLabel('唯一编号（可选）',{exact:true}).fill('fixture_submit');
  await create.getByRole('button',{name:'添加提示词',exact:true}).click();
  await create.getByRole('button',{name:'提交任务（将冻结费用）'}).click();
  await create.waitFor({state:'hidden'});
  const detail=page.getByRole('dialog',{name:'任务详情',exact:true});await detail.getByText('详情完整提示词',{exact:true}).waitFor();
  check('fixture creation opens detail with exact API contract',writes.length===1 && writes[0].payload.image_size==='1K' && writes[0].payload.items[0].custom_id==='fixture_submit' && !!writes[0].idempotency);
  await detail.getByRole('button',{name:'关闭对话框',exact:true}).click();await detail.waitFor({state:'hidden'});
  await win.getByRole('button',{name:'已完成夹具',exact:true}).click();await detail.waitFor();
  await detail.getByText('详情完整提示词',{exact:true}).waitFor();
  check('existing detail loads without generation',writes.length===1);
  await detail.getByRole('button',{name:'关闭对话框',exact:true}).click();
  const running=win.getByRole('row').filter({hasText:'进行中夹具'});
  check('running job cannot delete or download',await running.getByRole('button',{name:'删除记录',exact:true}).count()===0 && await running.getByRole('button',{name:'ZIP',exact:true}).isDisabled());
  await running.getByRole('button',{name:'取消任务',exact:true}).click();
  const alert=page.getByRole('alertdialog');await alert.waitFor();
  check('cancel opens confirmation without request',writes.length===1 && (await alert.innerText()).includes('结算'));
  await alert.getByRole('button',{name:'取消',exact:true}).click();await alert.waitFor({state:'hidden'});
  check('dismiss cancel leaves remote state untouched',writes.length===1);
  await running.getByRole('button',{name:'取消任务',exact:true}).click();await alert.waitFor();
  await alert.getByRole('button',{name:'确认',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role="alertdialog"] [aria-busy="true"]')!==null).catch(()=>{});
  check('cancel request sent once and busy prevents repeat',writes.filter(w=>w.path.endsWith('/cancel')).length===1 && await alert.getByRole('button',{name:'确认',exact:true}).isDisabled());
  releaseCancel();await alert.waitFor({state:'hidden'});
  await running.getByText('已取消',{exact:true}).waitFor();
  check('cancel completion refreshes state',writes.length===2);
  await page.setViewportSize({width:390,height:844});
  check('mobile window stays within viewport',await win.evaluate(el=>{const r=el.getBoundingClientRect();return r.x>=0 && r.right<=innerWidth+1;}));
  await page.screenshot({path:'output/playwright/batch-image-review/mobile.png'});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'output/playwright/batch-image-review/desktop.png'});
  check('no page errors',errors.length===0);
  return {checks,passed:checks.length,fixtureWrites:writes.map(w=>({method:w.method,path:w.path})),realBusinessWrites:0,errors};
}
