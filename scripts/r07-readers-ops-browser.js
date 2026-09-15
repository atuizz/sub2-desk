async(page)=>{
 const origin='http://127.0.0.1:5173',calls=[],checks=[],errors=[];
 const check=(name,value)=>{if(!value)throw Error(name);checks.push(name)};
 await page.unrouteAll({behavior:'wait'});await page.routeWebSocket('**', ws=>ws.close());page.on('pageerror',e=>errors.push(e.message));
 await page.route(origin+'/health',r=>r.fulfill({json:{status:'ok'}}));
 await page.route(origin+'/api/**',r=>{
  const req=r.request(),url=req.url(),p=url.slice(origin.length).split('?')[0],ok=data=>r.fulfill({json:{code:0,data}});calls.push({p,url,method:req.method()});
  if(req.method()!=='GET'){if(p==='/api/v1/admin/risk-control/config')return ok(req.postDataJSON());return r.fulfill({status:403,json:{message:'Fixture blocked'}});}
  if(p.endsWith('/auth/me'))return ok({id:987,email:'fixture@example.invalid',role:'admin',balance:0,status:'active'});
  if(p.endsWith('/admin/compliance'))return ok({required:false,version:'fixture',ack_phrase_zh:'fixture',ack_phrase_en:'fixture'});
  if(p.endsWith('/settings/public'))return ok({custom_menu_items:[{id:'docs',label:'使用文档',visibility:'user',page_slug:'guide'}]});
  if(p==='/api/v1/pages/guide')return r.fulfill({contentType:'text/markdown',body:'# 使用文档\n\n[跳到安装](#安装说明) · [第二次安装](#安装说明-1) · [首页](/home)\n\n'+('正文段落。\n\n'.repeat(35))+'## 安装说明\n第一次安装。\n\n## 安装说明\n第二次安装。\n\n<script>window.PWNED=true</script><a href="javascript:alert(1)">危险链接</a><iframe src="https://evil.invalid"></iframe>'});
  if(p==='/api/v1/admin/risk-control/config')return ok({enabled:true,mode:'observe',base_url:'https://moderation.invalid',model:'fixture',worker_count:4,queue_size:20,timeout_ms:1000});
  if(p==='/api/v1/admin/ops/dashboard/overview')return ok({health_score:100,request_count_total:0});
  if(p.endsWith('/advanced-settings'))return ok({auto_refresh_enabled:false,display_alert_events:false});
  if(p.endsWith('/requests')||p.endsWith('/request-errors'))return ok({items:[],total:0});
  return r.fulfill({status:503,json:{message:'Deliberate fixture failure'}});
 });
 await page.setViewportSize({width:1440,height:900});await page.goto(origin+'/?noboot&unlocked&app=security');
 const sec=page.getByRole('region',{name:'风控中心',exact:true});await sec.getByRole('button',{name:'内容审核',exact:false}).click();
 await sec.getByRole('button',{name:'内容审计设置',exact:true}).click();const sheet=page.getByRole('dialog',{name:'内容审计设置',exact:true});await sheet.waitFor();
 const save=sheet.getByRole('button',{name:'保存配置',exact:true});await save.waitFor();check('risk config save available with failed status and logs',await save.isEnabled());await save.click();await sheet.waitFor({state:'hidden'});
 check('risk config writes despite unrelated read errors',calls.some(c=>c.p==='/api/v1/admin/risk-control/config'&&c.method==='PUT'));
 await page.evaluate(()=>{const w=window.__macOS.wm;[...w.windows.value].forEach(x=>w.closeWindow(x.id));w.openApp('ops')});
 const ops=page.getByRole('region',{name:'运维监控',exact:true});await ops.getByLabel('概览平台').selectOption('grok');await ops.getByLabel('概览分组编号').fill('31');await ops.getByLabel('概览分组编号').press('Tab');
 await page.waitForTimeout(300);check('overview filter group and grok sent',calls.some(c=>c.p.endsWith('/dashboard/overview')&&c.url.includes('group_id=31')&&c.url.includes('platform=grok')));
 await ops.getByRole('button',{name:'请求',exact:true}).click();await ops.getByLabel('筛选平台',{exact:true}).selectOption('minimax');await ops.getByLabel('分组编号',{exact:true}).fill('42');await ops.getByRole('button',{name:'查询 / 刷新',exact:true}).click();
 await page.waitForTimeout(250);check('request filter group and minimax sent',calls.some(c=>c.p.endsWith('/requests')&&c.url.includes('group_id=42')&&c.url.includes('platform=minimax')));
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/final-fixes/ops-filter-mobile.png',animations:'disabled'});check('operations mobile root fits',await ops.evaluate(el=>el.getBoundingClientRect().right<=innerWidth+1));
 await page.goto(origin+'/custom/docs');const rich=page.locator('.public-rich-content');await rich.getByRole('link',{name:'跳到安装',exact:true}).waitFor();
 check('safe local link retains href',await rich.getByRole('link',{name:'首页',exact:true}).getAttribute('href')==='/home');
 await rich.getByRole('link',{name:'跳到安装',exact:true}).click();check('first anchor focuses correct heading',await page.evaluate(()=>document.activeElement?.nextElementSibling?.textContent==='第一次安装。'));
 await rich.getByRole('link',{name:'第二次安装',exact:true}).click();check('duplicate heading anchor maps correctly',await page.evaluate(()=>document.activeElement?.nextElementSibling?.textContent==='第二次安装。'));
 check('unsafe markup stays inert',await page.evaluate(()=>!window.PWNED&&!document.querySelector('.public-rich-content iframe,.public-rich-content script,.public-rich-content a[href^="javascript:"]')));
 await page.screenshot({path:'output/final-fixes/reader-anchor-mobile.png',animations:'disabled'});check('no runtime errors',errors.length===0);
 return {passed:true,checks,fixtureOnly:true,writes:calls.filter(c=>c.method!=='GET'),errors};
}
