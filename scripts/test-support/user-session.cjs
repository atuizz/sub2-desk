// Load production profile/lineage guards with an isolated authenticated storage.
const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'../..'),src=path.join(root,'packages/sub2-console/src');
const ts=require('node:module').createRequire(path.join(root,'packages/sub2-console/package.json'))('typescript');
module.exports=function userSessionFixture(auth){
 auth.token??='fixture-token';auth.sessionRevision??=0;
 const values=new Map([['auth_token',auth.token],['auth_user',JSON.stringify(auth.user)]]);
 const localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},cache=new Map();
 function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(src,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,localStorage,TextEncoder,require:n=>load(n.replace('@/', '')+'.ts')});return exports;}
 return load('stores/userSession.ts');
};
