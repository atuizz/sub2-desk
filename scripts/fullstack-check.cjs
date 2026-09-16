// Real disposable CI installation only; never print credentials or session tokens.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const dir=process.env.SUB2_DESK_INSTALL_DIR;if(!dir)throw Error('Explicit isolated install directory required');
const config=Object.fromEntries(fs.readFileSync(path.join(dir,'.env'),'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)]}));
const origin=`http://127.0.0.1:${config.SUB2_DESK_PORT}`;
(async()=>{
 const health=await fetch(origin+'/health');assert.equal(health.status,200);
 const html=await fetch(origin+'/login').then(r=>r.text());assert.match(html,/<title>Sub2 Desk/);
 for(const asset of require('../docs/frontend/DESKTOP_ASSET_MANIFEST.json').files){const response=await fetch(origin+'/'+asset.path);assert.equal(response.status,200,'Missing desktop asset: '+asset.path);const hash=crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');assert.equal(hash,asset.sha256,'Deployed artwork differs: '+asset.path);}
 console.log('PASS: all 130 deployed desktop assets match the local-approved SHA256 manifest');
 const login=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:config.ADMIN_EMAIL,password:config.ADMIN_PASSWORD})});
 assert.equal(login.status,200,'Real admin login failed');const result=await login.json();const data=result.data;assert(data.access_token,'No access token');
 const me=await fetch(origin+'/api/v1/auth/me',{headers:{Authorization:`Bearer ${data.access_token}`}});assert.equal(me.status,200);const user=(await me.json()).data;assert.equal(user.email,config.ADMIN_EMAIL);assert.equal(user.role,'admin');
 const marker=path.join(dir,'verified-admin.json');if(fs.existsSync(marker))assert.equal(JSON.parse(fs.readFileSync(marker)).id,user.id,'Admin changed across reinstall');else fs.writeFileSync(marker,JSON.stringify({id:user.id}));
 console.log('PASS: real backend health, frontend login page, admin authentication and persisted admin identity');
})().catch(e=>{console.error(e.message);process.exitCode=1});
