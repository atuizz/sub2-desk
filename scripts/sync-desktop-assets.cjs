// Explicitly synchronize the user-approved desktop artwork, never runtime data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'packages/sub2-console/public');
const target=path.join(root,'packages/sub2-console/public-release');
function list(dir,prefix=''){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{if(e.isSymbolicLink())throw Error('Symlink not allowed');const p=prefix+e.name;return e.isDirectory()?list(path.join(dir,e.name),p+'/'):[p]})}
const files=list(source).filter(p=>p!=='assets/user-ref.jpg');
for(const p of files)if(!/\.(svg|png|jpe?g|ico)$/.test(p))throw Error('Unexpected artwork input: '+p);
fs.mkdirSync(target,{recursive:true});
for(const p of list(target))if(!files.includes(p)){const full=path.resolve(target,p);if(!full.startsWith(target+path.sep))throw Error('Unsafe target');fs.unlinkSync(full)}
for(const p of files){const full=path.join(target,p);fs.mkdirSync(path.dirname(full),{recursive:true});fs.copyFileSync(path.join(source,p),full)}
const manifest={description:'Exact user-approved local desktop artwork; user-ref.jpg excluded because it is not used by the UI.',files:files.sort().map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,p))).digest('hex')}))};
fs.writeFileSync(path.join(root,'docs/frontend/DESKTOP_ASSET_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log('Synced '+files.length+' desktop assets without modifying local public/');
