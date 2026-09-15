const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {snapshot,compare}=require('./release-snapshot.cjs');
const root=path.resolve(__dirname,'..');
test('Docker build stage contains every real snapshot input and the required snapshot module',()=>{
 const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8').split('RUN pnpm build:release')[0];
 const inputs=[...docker.matchAll(/^COPY (?!.*--from=)(.+)$/gm)].flatMap(m=>m[1].trim().split(/\s+/).slice(0,-1));
 const files=snapshot(root,'original-release-assets');
 const missing=files.filter(f=>!inputs.some(input=>f.path===input||f.path.startsWith(input+'/')));
 assert.deepEqual(missing.map(f=>f.path),[],'Snapshot files missing from Docker COPY');
 assert(inputs.includes('scripts/release-snapshot.cjs'));
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sub2-container-inputs-'));
 try{
  for(const f of files){const target=path.join(directory,f.path);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,f.path),target);}
  const isolated=require(path.join(directory,'scripts/release-snapshot.cjs'));
  assert.equal(compare(files,isolated.snapshot(directory,'original-release-assets')).matched,true);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('container context excludes local runtime/config/assets and carries distribution licenses',()=>{
 const ignore=fs.readFileSync(path.join(root,'.dockerignore'),'utf8').split(/\r?\n/);
 for(const entry of ['**/.env*','output','server','data','*.exe','packages/sub2-console/public'])assert(ignore.includes(entry),entry);
 const docker=fs.readFileSync(path.join(root,'Dockerfile'),'utf8');
 assert(docker.includes('COPY LICENSE COPYING NOTICE.md THIRD_PARTY_NOTICES.md THIRD_PARTY_LICENSES.txt ./'));
 assert(docker.includes('/usr/share/licenses/sub2-mac/'));
 assert(!docker.includes('COPY . .'),'Broad workspace COPY would expose private runtime files');
 assert(fs.statSync(path.join(root,'THIRD_PARTY_LICENSES.txt')).size>10000);
});
