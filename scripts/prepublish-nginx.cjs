// Real nginx against isolated echo upstream and read-only requests to the existing backend.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process'),{once}=require('node:events');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/prepublish-audit/nginx');
const exe=process.env.NGINX_TEST_EXECUTABLE||path.join(root,'output/release-validation/deploy/2026-09-12T20-41-46-026Z/nginx-1.28.0/nginx.exe');
const posix=p=>p.split(path.sep).join('/');
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function main(){
 fs.mkdirSync(path.join(out,'logs'),{recursive:true});fs.mkdirSync(path.join(out,'temp'),{recursive:true});
 const echo=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({path:req.url,host:req.headers.host,authorization:!!req.headers.authorization,requestHost:req.headers['x-real-ip']}));});
 echo.listen(0,'127.0.0.1');await once(echo,'listening');
 const echoPort=echo.address().port,port=await freePort(),realPort=await freePort(),checks=[];
 const template=fs.readFileSync(path.join(root,'deploy/nginx.conf.template'),'utf8');
 const render=(listen,upstream,withMap)=>{
  const source=withMap?template:template.slice(template.indexOf('server {'));
  return source.replace('listen 80;',`listen 127.0.0.1:${listen};`).replace('root /usr/share/nginx/html;',`root "${posix(path.join(root,'packages/sub2-console/dist'))}";`).replaceAll('${SUB2API_UPSTREAM}',upstream);
 };
 const config=`worker_processes 1;\npid logs/nginx.pid;\nerror_log logs/error.log;\nevents {worker_connections 128;}\nhttp {include "${posix(path.join(path.dirname(exe),'conf/mime.types'))}";access_log logs/access.log;client_body_temp_path temp;\n${render(port,'http://127.0.0.1:'+echoPort,true)}\n${render(realPort,'http://127.0.0.1:8000',false)}\n}`;
 const cfg=path.join(out,'nginx.conf');fs.writeFileSync(cfg,config);
 const prefix=posix(out)+'/';let child;
 const command=args=>{const r=spawnSync(exe,['-p',prefix,'-c',posix(cfg),...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error(r.stderr||r.stdout);};
 const check=(name,result)=>{assert(result,name);checks.push(name);};
 try{
  command(['-t']);child=spawn(exe,['-p',prefix,'-c',posix(cfg)],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:'+port+'/',{signal:AbortSignal.timeout(500)})).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  const origin='http://127.0.0.1:'+port;
  for(const route of ['/','/login','/shop','/custom/docs','/payment/result']){const r=await fetch(origin+route);check('SPA '+route,r.status===200&&(await r.text()).includes('<div id="app">'));check('HTML headers '+route,r.headers.get('cache-control')==='no-cache'&&r.headers.get('x-content-type-options')==='nosniff'&&r.headers.get('referrer-policy')==='no-referrer');}
  const missing=await fetch(origin+'/assets/absent-release.js');check('missing JS is 404 rather than SPA',missing.status===404);
  const index=fs.readFileSync(path.join(root,'packages/sub2-console/dist/index.html'),'utf8'),asset=index.match(/src="(\/assets\/[^" ]+\.js)"/)[1];
  const js=await fetch(origin+asset);check('JS cache and MIME protection',js.status===200&&js.headers.get('cache-control')==='public, max-age=3600'&&js.headers.get('x-content-type-options')==='nosniff');
  for(const route of ['/api/v1/test?x=1','/v1/models','/health','/setup/status','/setup/test-db','/setup/test-redis','/setup/install']){const response=await fetch(origin+route,{headers:{Authorization:'Bearer local-test-only'}});const b=await response.json();check('proxy '+route,b.path===route&&b.authorization===true&&b.host==='127.0.0.1:'+echoPort);}
  const large=await new Promise((resolve,reject)=>{const r=http.request(origin+'/api/v1/upload',{method:'POST',headers:{'Content-Length':268435457}},s=>{s.resume();s.on('end',()=>resolve(s.statusCode));});r.on('error',reject);r.flushHeaders();});
  check('upload larger than limit rejected without forwarding body',large===413);
  const backend=await fetch('http://127.0.0.1:'+realPort+'/api/v1/settings/public').then(r=>r.json());check('real backend through production nginx is 0.2.4',backend.data.version==='0.2.4');
  check('no server version banner',(await fetch(origin+'/')).headers.get('server')==='nginx');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checkedAt:new Date().toISOString(),checks,port,realPort,realBackend:'0.2.4',realWrites:0,dockerEngineTested:false,tlsAtDeploymentTargetTested:false},null,2));
  console.log(JSON.stringify({passed:true,checks:checks.length,realBackend:'0.2.4',realWrites:0}));
 }finally{try{command(['-s','quit']);}catch{}await new Promise(r=>echo.close(r));if(child)await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,1500))]);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
