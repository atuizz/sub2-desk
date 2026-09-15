const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),seen=new Set(),rows=[],texts=new Map(),missing=[];
function locate(name,from){
 for(let dir=from;;dir=path.dirname(dir)){
  for(const candidate of [path.join(dir,'node_modules',name,'package.json'),...(path.basename(dir)==='node_modules'?[path.join(dir,name,'package.json')]:[])]) if(fs.existsSync(candidate))return fs.realpathSync(candidate);
  if(path.dirname(dir)===dir)throw Error('Missing production dependency '+name+' from '+from);
 }
}
function walk(file,include=true){
 file=fs.realpathSync(file);if(seen.has(file))return;seen.add(file);
 const pkg=JSON.parse(fs.readFileSync(file,'utf8'));
 if(include&&!pkg.name.startsWith('@sub2-mac/')){
  rows.push([pkg.name,pkg.version,typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license||pkg.licenses||'UNDECLARED')]);
  const dir=path.dirname(file),licenses=fs.readdirSync(dir).filter(name=>/^(licen[cs]e|copying|notice)([._-]|$)/i.test(name)&&fs.statSync(path.join(dir,name)).isFile()).sort();
  const key=pkg.name+'@'+pkg.version;
  let contents=licenses.map(name=>`--- ${name} ---\n${fs.readFileSync(path.join(dir,name),'utf8')}`).join('\n\n');
  if(!contents && fs.existsSync(path.join(dir,'README.md'))){
    const readme=fs.readFileSync(path.join(dir,'README.md'),'utf8');
    const marker=readme.search(/(?:^|\n)(?:#+\s*)?License\s*\n/i);
    if(marker>=0&&readme.slice(marker).includes('Permission is hereby granted'))contents='--- License section in upstream README.md ---\n'+readme.slice(marker).trim();
  }
  if(!contents){missing.push(key);contents=`The npm package declares ${pkg.license || 'UNDECLARED'} but omits a standalone license/copyright text. No copyright notice is invented here.\nPackage: https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}\n`;}
  texts.set(key,contents);
 }
 for(const name of Object.keys(pkg.dependencies||{}))walk(locate(name,path.dirname(file)));
}
for(const pkg of ['mac-ui-core','sub2-console'])walk(path.join(root,'packages',pkg,'package.json'),false);
rows.sort((a,b)=>a[0].localeCompare(b[0])||a[1].localeCompare(b[1]));
const unique=rows.filter((r,i)=>!i||r.join()!==rows[i-1].join());
fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'# 第三方依赖许可清单\n\n从当前安装的生产依赖递归读取 package.json；不依赖 pnpm store 索引。版本锁定见 pnpm-lock.yaml。下表记录包声明，各包随附的完整许可和NOTICE文本见 THIRD_PARTY_LICENSES.txt，源码和静态包均附带。\n\n| 依赖 | 版本 | 许可 |\n| --- | --- | --- |\n'+unique.map(r=>'| '+r.map(v=>v.replaceAll('|','\\|')).join(' | ')+' |').join('\n')+'\n');
fs.writeFileSync(path.join(root,'THIRD_PARTY_LICENSES.txt'),unique.map(r=>`===== ${r[0]}@${r[1]} (${r[2]}) =====\n\n${texts.get(r[0]+'@'+r[1])}`).join('\n\n')+'\n');
if(missing.length)fs.appendFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'\n上游 npm 包未随附完整许可/版权文本：'+[...new Set(missing)].join('、')+'。已保留其包声明和版本链接，未补造版权归属。\n');
console.log('Production dependency entries: '+unique.length);
