const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
test('release artwork matches the approved local desktop manifest',()=>{
 const root=path.resolve(__dirname,'..'),m=require('../docs/frontend/DESKTOP_ASSET_MANIFEST.json');
 const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 assert(m.files.length>100);assert(!m.files.some(f=>f.path.includes('user-ref')));
 for(const f of m.files){assert.equal(sha(path.join(root,'packages/sub2-console/public-release',f.path)),f.sha256,f.path);const local=path.join(root,'packages/sub2-console/public',f.path);if(fs.existsSync(local))assert.equal(sha(local),f.sha256,'Local visual drift: '+f.path);}
});
