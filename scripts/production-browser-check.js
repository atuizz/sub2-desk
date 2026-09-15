async (page) => {
  const origin = 'http://127.0.0.1:5182', checks = [], errors = [];
  const user = { id: 7, email: 'production-fixture@example.invalid', username: '成品验收', role: 'admin', status: 'active', balance: 0 };
  let loginCount = 0;
  const check = (name, pass) => { if (!pass) throw new Error(name); checks.push(name); };
  await page.unrouteAll({ behavior: 'wait' });
  page.on('pageerror', e => errors.push(e.message));
  await page.route(origin + '/api/**', r => {
    const req=r.request(), path=req.url().split('?')[0];
    const ok=data=>r.fulfill({json:{code:0,data}});
    if(path.endsWith('/auth/login')) { loginCount++; return ok({access_token:'production-fixture-token',expires_in:3600,user}); }
    if(req.method()!=='GET') return r.fulfill({status:403,json:{code:403,message:'Fixture only'}});
    if(path.endsWith('/auth/me') || path.endsWith('/user/profile')) return ok(user);
    if(path.endsWith('/settings/public')) return ok({registration_enabled:false});
    if(path.endsWith('/admin/compliance')) return ok({required:false,version:'fixture',ack_phrase_zh:'fixture',ack_phrase_en:'fixture'});
    if(path.endsWith('/admin/accounts')) return ok({items:[],total:0,pages:1,page_size:20});
    if(path.endsWith('/groups/all')) return ok([]);
    return ok({});
  });
  await page.route(origin + '/health', r=>r.fulfill({status:503,json:{status:'unavailable'}}));
  // Each run starts with an unauthenticated fixture, including reused CLI sessions.
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(origin + '/?noboot&unlocked&app=accounts');
  const lock = page.locator('.mac-lockscreen'); await lock.waitFor();
  check('生产 unlocked 参数不能越过登录', await page.getByRole('region',{name:'账号管理',exact:true}).count()===0);
  check('生产包不暴露开发操作句柄', await page.evaluate(()=>!window.__macOS && !window.__wm));
  await lock.getByText('后端连接中断',{exact:true}).waitFor();
  check('锁屏不伪造在线状态', !(await lock.innerText()).includes('网关在线'));
  check('后端关闭注册时没有注册入口', await lock.getByRole('button',{name:'注册新用户',exact:true}).count()===0);
  await lock.locator('input').first().fill(user.email);
  await lock.locator('input[type="password"]').fill('fixture-only-password');
  await page.keyboard.press('Enter');
  await page.getByRole('region',{name:'账号管理',exact:true}).waitFor();
  check('登录后恢复指定应用，无固定延时丢窗', loginCount===1);
  await page.screenshot({path:'output/playwright/release/production-accounts.png',animations:'disabled'});
  await page.goto(origin+'/?ui-lab&noboot');
  check('生产不加载组件夹具消费者', await page.getByRole('region',{name:'工作空间',exact:true}).count()===0);
  check('生产页面无异常', errors.length===0);
  return {passed:true,checks,fixtureOnly:true,loginCount,pageErrors:errors};
}
