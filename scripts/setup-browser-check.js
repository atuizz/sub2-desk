async(page)=>{
  const origin='http://127.0.0.1:5181';let installed=false,fail=true,writes=0;const payloads=[];
  await page.unrouteAll({behavior:'wait'});
  await page.route(origin+'/setup/*',async route=>{
    const req=route.request(),path=req.url().slice(origin.length).split('?')[0];
    if(path==='/setup/status')return route.fulfill({status:fail?503:200,json:fail?{message:'fixture offline'}:{code:0,data:{needs_setup:!installed,step:'database'}}});
    if(req.method()!=='POST')throw Error('Unexpected request');
    if(path==='/setup/install'){writes++;payloads.push(req.postDataJSON());installed=true;}
    return route.fulfill({json:{code:0,data:{message:'ok',restart:true}}});
  });
  await page.goto(origin+'/setup');await page.getByRole('button',{name:'重新读取',exact:true}).waitFor();
  if(await page.getByRole('button',{name:'安装',exact:true}).count())throw Error('failed status exposes install');
  fail=false;await page.getByRole('button',{name:'重新读取',exact:true}).click();
  await page.getByRole('button',{name:'测试数据库连接'}).click();await page.getByRole('button',{name:'连接已验证'}).waitFor();
  await page.getByLabel('主机',{exact:true}).fill('db-fixture');
  if(await page.getByRole('button',{name:'下一步',exact:true}).isEnabled())throw Error('Changed connection remains verified');
  await page.getByRole('button',{name:'测试数据库连接'}).click();await page.getByRole('button',{name:'连接已验证'}).waitFor();
  await page.getByRole('button',{name:'下一步',exact:true}).click();await page.getByRole('button',{name:'测试 Redis 连接'}).click();await page.getByRole('button',{name:'连接已验证'}).waitFor();
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.getByLabel('管理员邮箱').fill('setup@example.invalid');await page.getByLabel('密码（至少8位）',{exact:true}).fill('Fixture-Password-Only');await page.getByLabel('确认密码',{exact:true}).fill('Fixture-Password-Only');
  await page.getByRole('button',{name:'下一步',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('mobile overflow');
  await page.screenshot({path:'output/parity-completion/setup-mobile.png'});
  await page.getByRole('button',{name:'安装',exact:true}).click();await page.getByRole('heading',{name:'服务已就绪',exact:true}).waitFor({timeout:10000});
  if(writes!==1 || payloads[0].server.port!==8000 || payloads[0].database.host!=='db-fixture')throw Error('wrong install payload');
  await page.reload();await page.getByRole('heading',{name:'服务已完成安装'}).waitFor();
  if(await page.getByRole('button',{name:'安装',exact:true}).count())throw Error('reinstall exposed');
  return {passed:true,fixtureOnly:true,installRequests:writes,checks:['status failure blocks install','connection edits invalidate test','four steps','mobile layout','single install','restart readiness','installed gate']};
}
