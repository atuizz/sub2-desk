const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.resolve('packages/sub2-console/package.json')),ts=req('typescript');
function fixture(refresh) {
 const data=new Map([['auth_token','A'],['auth_user','user-A']]);const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 let request,errorHandler,refreshes=0,retries=0;
 const lineage={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('packages/sub2-console/src/api/authTokenLineage.ts','utf8'),{compilerOptions:{target:9,module:1}}).outputText,{exports:lineage,localStorage:storage,TextEncoder});
 const client=async config=>{retries++;return request(config)};
 client.interceptors={request:{use:f=>request=f},response:{use:(ok,error)=>errorHandler=error}};
 const context={exports:{},require:name=>name==='./authTokenLineage'?lineage:name==='axios'?{create:()=>client,isCancel:()=>false}:name==='./tokenRefresh'?{refreshAuthTokens:async()=>{refreshes++;const old=storage.getItem('auth_token'),rt=storage.getItem('refresh_token');const result=refresh?await refresh(storage):await Promise.reject(Error('expired'));if(storage.getItem('auth_user')==='user-A'){lineage.publishTokenRotation(null,old,rt,result.access_token,rt);}return result;}}:name==='./url'?{getAPIBaseURL:()=>'/api/v1'}:name==='@/i18n'?{getLocale:()=> 'zh-CN'}:{shouldMarkAdminUIRequest:()=>false,shouldMarkUserUIRequest:()=>false},localStorage:storage,sessionStorage:storage,window:{location:{pathname:'/dashboard',href:''},dispatchEvent(){}},Intl,CustomEvent:class{}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('packages/sub2-console/src/api/client.ts','utf8'),{compilerOptions:{target:9,module:1,esModuleInterop:true}}).outputText,context);
 return {storage,data,context,request:c=>request({method:'get',url:'/usage',headers:{},...c}),reject:c=>errorHandler({config:c,response:{status:401,data:{message:'expired'}}}),counts:()=>({refreshes,retries})};
}
test('late 401 without refresh token cannot clear replacement login',async()=>{
 const f=fixture(),request=await f.request();f.storage.setItem('auth_token','B');f.storage.setItem('auth_user','user-B');
 await assert.rejects(f.reject(request),e=>e.code==='AUTH_SESSION_CHANGED');assert.equal(f.storage.getItem('auth_token'),'B');assert.equal(f.context.window.location.href,'');assert.equal(f.counts().retries,0);
});
test('old request cannot refresh or replay using a different account token',async()=>{
 const f=fixture(),request=await f.request({method:'post',url:'/admin/users'});f.storage.setItem('auth_token','B');f.storage.setItem('auth_user','user-B');f.storage.setItem('refresh_token','refresh-B');
 await assert.rejects(f.reject(request),e=>e.code==='AUTH_SESSION_CHANGED');assert.equal(f.counts().refreshes,0);assert.equal(f.counts().retries,0);
});
test('unauthenticated login rejection cannot destroy a newer login',async()=>{
 const f=fixture();f.data.clear();const request=await f.request({url:'/auth/login'});f.storage.setItem('auth_token','B');f.storage.setItem('auth_user','user-B');
 await assert.rejects(f.reject(request),e=>e.code==='AUTH_SESSION_CHANGED');assert.equal(f.storage.getItem('auth_token'),'B');
});
test('identity change during refresh rejects before replay',async()=>{
 const f=fixture(async s=>{s.setItem('auth_user','user-B');s.setItem('auth_token','B');return{access_token:'B'};});f.storage.setItem('refresh_token','refresh-A');const request=await f.request();
 await assert.rejects(f.reject(request),e=>e.code==='AUTH_SESSION_CHANGED');assert.equal(f.counts().retries,0);assert.equal(f.storage.getItem('auth_token'),'B');
});
test('same session refresh retries once with refreshed access token',async()=>{
 const f=fixture(async s=>{s.setItem('auth_token','A2');return{access_token:'A2'};});f.storage.setItem('refresh_token','refresh-A');const request=await f.request();
 const retried=await f.reject(request);assert.equal(retried.headers.Authorization,'Bearer A2');assert.equal(f.counts().retries,1);
});
test('current expired session is cleared; missing request config does not throw TypeError',async()=>{
 const f=fixture();await assert.rejects(f.reject(await f.request()));assert.equal(f.storage.getItem('auth_token'),null);assert.equal(f.storage.getItem('auth_expired'),'1');await assert.rejects(f.reject(undefined),e=>e.status===401);
});
