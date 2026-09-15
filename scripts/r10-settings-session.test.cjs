const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..'),src=path.join(root,'packages/sub2-console/src');
const req=require('node:module').createRequire(path.join(root,'packages/sub2-console/package.json'));
const ts=req('typescript'),vue=req('vue'),sfc=req('vue/compiler-sfc');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const tick=()=>new Promise(setImmediate);
function fixture(extra={}) {
 const values=new Map([['auth_token','A'],['refresh_token','R'],['auth_user',JSON.stringify({id:8,role:'admin'})]]);
 const localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
 const cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(compile(fs.readFileSync(path.join(src,file),'utf8')),{exports,localStorage,TextEncoder,require:n=>load(n.replace('@/', '')+'.ts')});return exports;}
 const form=load('apps/user/settings/settingsForm.ts'),session=load('stores/userSession.ts'),lineage=load('api/authTokenLineage.ts');
 let source=sfc.parse(fs.readFileSync(path.join(src,'apps/user/SettingsApp.vue'),'utf8')).descriptor.scriptSetup.content;
 const ast=ts.createSourceFile('test.ts',source,ts.ScriptTarget.Latest,true),names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
 for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))source=source.slice(0,n.pos)+source.slice(n.end);
 const auth=vue.reactive({user:{id:8,role:'admin',username:'original'},token:'A',sessionRevision:0,isAdmin:true}),scope=vue.effectScope(),unmount=[];
 const context={...vue,...form,...session,useAuthStore:()=>auth,useSystemStore:()=>({}),defineProps:()=>({}),onMounted(){},onUnmounted(fn){unmount.push(fn)},settingsAPI:{getSettings:async()=>({site_name:'saved',payment_enabled_types:null})},normalizeAccountSchedulingThresholdsMap:()=>({}),extraWallpapers:[],console:{error(){}},URL,setTimeout(){},clearTimeout(){},...extra};
 scope.run(()=>vm.runInNewContext(compile(source+'\nglobalThis.subject={'+names.join(',')+'};'),context));
 return {s:context.subject,auth,form,session,lineage,localStorage,close(){unmount.forEach(f=>f());scope.stop()}};
}
test('payment null becomes editable empty list without creating a patch; missing fields remain missing',()=>{
 const f=fixture(),saved=f.form.copySettings({payment_enabled_types:null});assert.equal(Array.isArray(saved.payment_enabled_types),true);assert.equal(saved.payment_enabled_types.length,0);
 assert.equal(JSON.stringify(f.form.settingsPatch('admin_payment',saved,saved)),'{}');assert.equal(f.form.copySettings({}).payment_enabled_types,undefined);
 const patch=f.form.settingsPatch('admin_payment',{...saved,payment_enabled_types:['alipay']},saved);assert.equal(JSON.stringify(patch),'{"payment_enabled_types":["alipay"]}');f.close();
});
test('normal token rotation keeps admin fields and secret drafts',async()=>{
 const f=fixture();await f.s.loadAdminSettings();f.s.adminSettings.value.site_name='unsaved';f.s.settingsSecrets.value.smtp_password='draft';
 f.lineage.publishTokenRotation(8,'A','R','B','R2');f.localStorage.setItem('auth_token','B');f.localStorage.setItem('refresh_token','R2');f.auth.token='B';await tick();
 assert.equal(f.s.adminSettings.value.site_name,'unsaved');assert.equal(f.s.settingsSecrets.value.smtp_password,'draft');assert.equal(f.s.settingsDirty.value,true);f.close();
});
test('same-user new login revision clears old admin drafts',async()=>{
 const f=fixture();await f.s.loadAdminSettings();f.s.settingsSecrets.value.smtp_password='draft';f.auth.sessionRevision++;await tick();assert.equal(f.s.settingsSecrets.value.smtp_password,'');f.close();
});
test('profile retry asks before replacing drafts after public settings failed',async()=>{
 let reads=0;const f=fixture({userAPI:{getProfile:async()=>({id:8,role:'admin',username:'original',balance_notify_threshold:10})},getPublicSettings:async()=>{if(++reads===1)throw Error('offline');return {};}});
 await f.s.loadUserProfileData();assert.equal(f.s.profileReady.value,true);assert.ok(f.s.profileError.value);
 f.s.usernameDraft.value='unsaved';f.s.balanceNotifyThreshold.value=99;f.s.requestProfileReload();await tick();
 assert.equal(f.s.usernameDraft.value,'unsaved');assert.equal(f.s.balanceNotifyThreshold.value,99);assert.equal(typeof f.s.pendingSettingsReload.value,'function');
 f.s.confirmSettingsReload();await tick();assert.equal(f.s.usernameDraft.value,'original');assert.equal(f.s.balanceNotifyThreshold.value,10);f.close();
});
test('editing during a profile read preserves edits made after the request',async()=>{
 let resolve;const f=fixture({userAPI:{getProfile:()=>new Promise(r=>resolve=r)},getPublicSettings:async()=>({})});
 const pending=f.s.loadUserProfileData();f.s.usernameDraft.value='typed while loading';resolve({id:8,role:'admin',username:'server'});await pending;assert.equal(f.s.usernameDraft.value,'typed while loading');f.close();
});
for(const operation of ['updateUsername','saveAvatar','deleteAvatar','saveBalanceNotifyThreshold','handleToggleBalanceNotify'])test(operation+' ignores old-owner success after unmount',async()=>{
 let resolve;const f=fixture({userAPI:{updateProfile:()=>new Promise(r=>resolve=r)}});f.s.profileReady.value=true;f.s.usernameDraft.value='A edited';f.s.avatarDraft.value='data:image/png;base64,fixture';
 const pending=f.s[operation]();assert.equal(typeof resolve,'function');f.close();f.auth.user={id:9,role:'user',username:'B'};f.auth.token='B';f.auth.sessionRevision++;
 resolve({id:8,role:'admin',username:'A edited'});await pending;assert.equal(f.auth.user.id,9);assert.equal(f.auth.user.username,'B');
});
test('session publishing accepts proven rotations but rejects storage-only replacement and mismatched profile IDs',()=>{
 const f=fixture(),session=f.session.captureUserSession(f.auth);assert.ok(session);
 f.lineage.publishTokenRotation(8,'A','R','A2','R2');f.localStorage.setItem('auth_token','A2');f.localStorage.setItem('refresh_token','R2');
 assert.equal(f.session.publishUserProfile(f.auth,session,{id:8,role:'admin',username:'renewed'}),true);
 assert.equal(f.session.publishUserProfile(f.auth,session,{id:9,role:'admin'}),false);
 f.localStorage.setItem('auth_token','new-login');assert.equal(f.session.publishUserProfile(f.auth,session,{id:8,role:'admin',username:'stale'}),false);assert.equal(f.auth.user.username,'renewed');f.close();
});
test('real Axios late success cannot publish into replacement stored session',async()=>{
 const original=fs.readFileSync(path.join(__dirname,'parity-r07-auth-services.test.cjs'),'utf8');
 const context={require,__dirname,console,URL,URLSearchParams,EventTarget,Event,CustomEvent,TextEncoder,AbortController,setTimeout,clearTimeout,Headers};
 vm.runInNewContext(original.slice(0,original.indexOf("test('expired first restore"))+'\nglobalThis.makeNetwork=networkFixture;',context);
 let resolve;const f=context.makeNetwork(config=>new Promise(r=>resolve=r));
 f.store.user={id:42,role:'admin'};const helper=f.load('stores/userSession.ts'),session=helper.captureUserSession(f.store);
 const pending=f.load('api/user.ts').updateProfile({username:'old'});await tick();f.localStorage.setItem('auth_token','replacement');
 resolve({data:{code:0,data:{id:42,role:'admin',username:'old'}}});const profile=await pending;
 assert.equal(helper.publishUserProfile(f.store,session,profile),false);assert.notEqual(f.store.user.username,'old');f.dispose();
});
test('wallet transfer stops before reading or publishing a replacement user profile',async()=>{
 let resolve,reads=0;const f=fixture();
 const source=sfc.parse(fs.readFileSync(path.join(src,'apps/user/WalletApp.vue'),'utf8')).descriptor.scriptSetup.content;
 const ast=ts.createSourceFile('wallet.ts',source,ts.ScriptTarget.Latest,true),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='handleTransferQuota').getText(ast);
 const context={...f.session,authStore:f.auth,paymentGeneration:0,affDetail:vue.ref({aff_quota:10}),isAffTransferring:vue.ref(false),userAPI:{transferAffiliateQuota:()=>new Promise(r=>resolve=r),getProfile:async()=>{reads++;return {id:8,role:'admin'}}},loadAffiliateDetail:async()=>{reads++},audio:{playCoin(){}},showToast(){}};
 vm.runInNewContext(compile(fn+'\nglobalThis.run=handleTransferQuota'),context);const pending=context.run();f.localStorage.setItem('auth_token','replacement');resolve({transferred_quota:10});await pending;assert.equal(reads,0);f.close();
});
