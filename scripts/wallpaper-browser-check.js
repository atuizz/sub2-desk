async (page) => {
  const origin='http://127.0.0.1:5181';
  await page.unrouteAll({behavior:'wait'});
  await page.route(origin+'/api/**',r=>r.fulfill({status:503,json:{message:'Isolated wallpaper check'}}));
  await page.goto(origin+'/?noboot&unlocked&app=settings');
  await page.waitForFunction(()=>window.__macOS?.wm);
  await page.evaluate(()=>window.__macOS.wm.openApp('settings',{tab:'desktop'}));
  const results=[];
  for(const [id,name] of [['glass-dawn','暖金晨光'],['glass-midnight','午夜蓝玻璃'],['glass-lake','冰蓝湖光'],['tahoe-hd','Tahoe · 浅色 4K'],['tahoe-dark-hd','Tahoe · 深色 4K'],['tahoe-beach-hd','Tahoe · 湖畔 4K']]) {
    const button=page.getByRole('button',{name,exact:true});
    await button.click();
    await page.waitForFunction(id=>window.__macOS.systemStore.wallpaper===id,id);
    const dimensions=await page.evaluate(async id=>{const img=new Image();img.src='/assets/'+id+'.jpg';await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,saved:JSON.parse(localStorage.getItem('sub2-desktop-preferences')).wallpaper};},id);
    if(dimensions.saved!==id || (id.includes('hd') && dimensions.width!==3840)) throw Error('Wallpaper failed: '+id);
    results.push({id,...dimensions});
  }
  await page.reload();
  await page.waitForFunction(()=>window.__macOS?.systemStore.wallpaper==='tahoe-beach-hd');
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'output/wallpapers/desktop-preview.png'});
  return {passed:true,results,persistence:true};
}
