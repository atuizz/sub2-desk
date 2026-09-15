const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{spawnSync}=require('node:child_process');
test('Windows startup target, immutable backups and rollback failure stages',{skip:process.platform!=='win32'},()=>{
  const run=spawnSync('pwsh',['-NoProfile','-File',path.join(__dirname,'runtime-operations.test.ps1')],{encoding:'utf8',timeout:30000});
  assert.equal(run.status,0,(run.stdout||'')+(run.stderr||'')+(run.error?.message||''));
  assert.match(run.stdout,/assertions passed/);
});
