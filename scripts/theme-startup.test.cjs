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

test('menubar scoped dark styles never dim the html theme root', () => {
 const path=require('node:path');
 const compiler=require(require.resolve('vue/compiler-sfc',{paths:[path.resolve('packages/sub2-console')]}));
 const file='packages/mac-ui-core/src/components/MacMenubarGlass.vue';
 const {descriptor}=compiler.parse(fs.readFileSync(file,'utf8'),{filename:file});
 const output=compiler.compileStyle({source:descriptor.styles[0].content,filename:file,id:'data-v-theme-regression',scoped:true});
 assert.deepEqual(output.errors,[]);
 // Use actual compiled selectors: the original :global(.dark) child selector
 // compiled to a bare .dark rule, applying 0.68 opacity to the whole document.
 const rules=[];output.rawResult.root.walkRules(rule=>rules.push(rule));
 const leaking=rules.filter(rule=>rule.selectors.some(selector=>['.dark','html.dark',':root'].includes(selector.trim())));
 assert.equal(leaking.length,0,'glass styles must target glass elements, including fallback media rules');
 assert(rules.some(rule=>rule.selector.includes('.glass-light')&&rule.nodes.some(node=>node.prop==='opacity')));
});
