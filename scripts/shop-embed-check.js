async(page)=>{
 const urls=['https://catfk.com/shop/jianshang','https://www.16688.com.cn/shop/S790246','https://wzyp.cn/shop/woai'];
 const results=[];
 for(let index=0;index<urls.length;index++){
  const url=urls[index],failures=[],errors=[];
  const failed=r=>failures.push({url:r.url(),error:r.failure()?.errorText});
  const response=async r=>{if(r.status()>=400)failures.push({url:r.url(),status:r.status()});};
  const consoleLog=m=>{if(m.type()==='error')errors.push(m.text());};
  page.on('requestfailed',failed);page.on('response',response);page.on('console',consoleLog);
  let navigation='';try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});}catch(e){navigation=String(e).slice(0,220);}
  await page.waitForTimeout(5000);
  const direct={url:page.url(),text:(await page.locator('body').innerText().catch(()=>'' )).slice(0,2500),navigation,failures:[...failures],errors:[...errors]};
  await page.screenshot({path:`output/shop-embed-test/${index}-direct.png`});
  failures.length=0;errors.length=0;
  await page.route('http://127.0.0.1:5173/embed-probe',r=>r.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><body style="margin:0"><iframe title="Shop probe" style="width:100vw;height:100vh;border:0" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="'+url+'"></iframe></body></html>'}));
  await page.goto('http://127.0.0.1:5173/embed-probe',{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
  await page.waitForTimeout(7000);
  const frames=[];for(const f of page.frames().slice(1))frames.push({url:f.url(),text:(await f.locator('body').innerText().catch(()=>'' )).slice(0,2500)});
  const embedded={frames,failures:[...failures],errors:[...errors]};
  await page.screenshot({path:`output/shop-embed-test/${index}-embedded.png`});
  results.push({url,direct,embedded});
  await page.unroute('http://127.0.0.1:5173/embed-probe');
  page.off('requestfailed',failed);page.off('response',response);page.off('console',consoleLog);
 }
 return results;
}
