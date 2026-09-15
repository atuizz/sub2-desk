async(page)=>{
 const result=[];
 for(const url of ['https://catfk.com/shop/jianshang','https://www.16688.com.cn/shop/S790246']){
 await page.route('http://127.0.0.1:5173/embed-probe',r=>r.fulfill({contentType:'text/html',body:`<iframe style="width:100%;height:95vh" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer" src="${url}"></iframe>`}));
 await page.goto('http://127.0.0.1:5173/embed-probe');const f=page.frameLocator('iframe').first();
 if(url.includes('catfk'))await f.getByText('10刀',{exact:true}).click();
 else await f.getByText('我知道了',{exact:true}).click();
 await page.waitForTimeout(1500);
 result.push({url,text:(await f.locator('body').innerText()).slice(-2600)});
 await page.screenshot({path:`output/shop-embed-test/${url.includes('catfk')?'catfk':'16688'}-form.png`});
 await page.unroute('http://127.0.0.1:5173/embed-probe');
 }return result;
}
