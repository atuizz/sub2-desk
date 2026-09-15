const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('packages/sub2-console/index.html','utf8');
const code=html.match(/<script>([\s\S]*?)<\/script>/)[1];
function boot(saved,systemDark=false){const root={style:{},classList:{toggle:(name,value)=>root.dark=value}};vm.runInNewContext(code,{localStorage:{getItem:()=>saved},document:{documentElement:root},matchMedia:()=>({matches:systemDark})});return root;}
test('first paint respects saved theme before app modules',()=>{
 assert.equal(boot(JSON.stringify({appearance:'light',isDark:true}),true).dark,false);
 assert.equal(boot(JSON.stringify({appearance:'dark'})).dark,true);
 assert.equal(boot(JSON.stringify({appearance:'system'}),true).dark,true);
 assert.equal(boot(JSON.stringify({appearance:'system'}),false).dark,false);
 assert.equal(boot('{}').style.colorScheme,'light');
 assert.doesNotThrow(()=>boot('{invalid'));
 assert(!html.includes('bg-[#20181b]'));
});
