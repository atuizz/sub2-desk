const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),req=require('node:module').createRequire(path.join(root,'packages/sub2-console/package.json'));
const ts=req('typescript'),vue=req('vue'),sfc=req('vue/compiler-sfc');
const folder=path.join(root,'packages/sub2-console/src/apps/user');
const compile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(api={}){
 const form={exports:{}};vm.runInNewContext(compile(fs.readFileSync(path.join(folder,'settings/settingsForm.ts'),'utf8')),{module:form,exports:form.exports});
 let source=sfc.parse(fs.readFileSync(path.join(folder,'SettingsApp.vue'),'utf8')).descriptor.scriptSetup.content;
 const ast=ts.createSourceFile('fixture.ts',source,ts.ScriptTarget.Latest,true),names=ast.statements.flatMap(n=>ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>ts.isIdentifier(d.name)).map(d=>d.name.text):ts.isFunctionDeclaration(n)&&n.name?[n.name.text]:[]);
 for(const n of [...ast.statements].reverse())if(ts.isImportDeclaration(n))source=source.slice(0,n.pos)+source.slice(n.end);
 const scope=vue.effectScope(),auth=vue.reactive({user:{id:8,role:'admin',username:'original'},token:'fixture',isAdmin:true});
 const context={...vue,...form.exports,useAuthStore:()=>auth,useSystemStore:()=>({}),defineProps:()=>({}),onMounted(){},onUnmounted(){},settingsAPI:api,
  normalizeAccountSchedulingThresholdsMap:()=>({}),extraWallpapers:[],console,URL,setTimeout(){},clearTimeout(){},fetch(){throw Error('Live network forbidden')}};
 scope.run(()=>vm.runInNewContext(compile(source+'\nglobalThis.subject={'+names.join(',')+'};'),context));
 return {s:context.subject,auth,close:()=>scope.stop()};
}
const tick=()=>new Promise(setImmediate);
test('settings compares loaded values, secrets and profile drafts; successful save clears only submitted changes',async()=>{
 const f=fixture({getSettings:async()=>({site_name:'original',site_subtitle:'',backend_mode_enabled:false,api_base_url:'',custom_endpoints:[],smtp_password_configured:true}),updateSettings:async p=>({...p,smtp_password_configured:true})});
 await f.s.loadAdminSettings();assert.equal(f.s.settingsDirty.value,false);
 f.s.adminSettings.value.site_name='changed';assert.equal(f.s.settingsDirty.value,true);
 f.s.settingsSecrets.value.smtp_password='private draft';f.s.activeTab.value='admin_general';await tick();await f.s.saveAdminSettings();
 assert.equal(f.s.savedSettings.value.site_name,'changed',f.s.saveToast.value);assert.equal(f.s.settingsDirty.value,true);f.s.settingsSecrets.value.smtp_password='';assert.equal(f.s.settingsDirty.value,false);
 f.s.passwordForm.value.old_password='private';assert.equal(f.s.settingsDirty.value,true);f.close();
});
test('gateway category switch retains unsaved values and successful module save resets its baseline',async()=>{
 let reads=0;const data={enabled:true,cooldown_minutes:30};
 const f=fixture({getOverloadCooldownSettings:async()=>{reads++;return {...data}},getRateLimit429CooldownSettings:async()=>({enabled:true,cooldown_seconds:60}),getStreamTimeoutSettings:async()=>({enabled:true}),getRectifierSettings:async()=>({enabled:true,apikey_signature_patterns:[]}),updateOverloadCooldownSettings:async p=>p});
 await f.s.loadGatewaySettings();assert.equal(f.s.settingsDirty.value,false);
 f.s.overloadCooldownForm.value.cooldown_minutes=70;f.s.activeTab.value='admin_gateway';await tick();assert.equal(reads,1);assert.equal(f.s.overloadCooldownForm.value.cooldown_minutes,70);assert.equal(f.s.settingsDirty.value,true);
 await f.s.saveOverloadCooldown();assert.equal(f.s.settingsDirty.value,false);f.close();
});
test('lazy shop and policy views remain mounted after category switch, and busy state covers writes',async()=>{
 const f=fixture();assert.equal(f.s.shopVisited.value,false);f.s.activeTab.value='admin_cardshop';await tick();f.s.activeTab.value='appearance';await tick();assert.equal(f.s.shopVisited.value,true);
 f.s.activeTab.value='admin_policies';await tick();f.s.activeTab.value='appearance';await tick();assert.equal(f.s.policiesVisited.value,true);
 f.s.s3Saving.value=true;assert.equal(f.s.settingsBusy.value,true);f.s.s3Saving.value=false;f.s.isSaving.value=true;assert.equal(f.s.settingsBusy.value,true);f.close();
});
