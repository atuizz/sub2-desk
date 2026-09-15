param(
  [string]$RuntimeDirectory=(Join-Path (Split-Path -Parent $PSScriptRoot) 'output/backend-runtime'),
  [switch]$CheckOnly,
  [switch]$BackendOnly
)
$ErrorActionPreference='Stop'
$workspace=Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'runtime-operations.ps1')
$runtime=Get-Sub2Runtime $RuntimeDirectory
$node=(Get-Command node -ErrorAction Stop).Source
$vite=Join-Path $workspace 'packages/sub2-console/node_modules/vite/bin/vite.js'
if(!$BackendOnly -and !(Test-Path -LiteralPath $vite)){throw 'Frontend dependencies missing. Run pnpm install --frozen-lockfile first.'}
$backend=Get-OwnedSub2Listener -Port $runtime.Port -Executable $runtime.Binary
$frontend=$null
if(!$BackendOnly){
  $listener=Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue|Select-Object -First 1
  if($listener){
    $frontend=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if(!$frontend -or $frontend.ExecutablePath -ne $node -or $frontend.CommandLine -notmatch 'vite' -or $frontend.CommandLine.Replace('\','/') -notlike ('*'+$workspace.Replace('\','/')+'/*')){throw 'Port 5173 belongs to a different or unverifiable process; nothing was stopped.'}
  }
}
if(!(Test-Sub2Tcp $runtime.DatabaseHost $runtime.DatabasePort)){throw 'Configured PostgreSQL is unavailable. Start the existing database first.'}
$cacheReady=Test-Sub2Tcp $runtime.RedisHost $runtime.RedisPort
if($CheckOnly){
  $version=if($backend){Get-Sub2HealthVersion $runtime.Port}else{$null}
  [PSCustomObject]@{runtime=$runtime.Directory;backendRunning=!!$backend;version=$version;cacheReady=$cacheReady;frontendRunning=!!$frontend;checkOnly=$true}|ConvertTo-Json
  return
}
if(!$cacheReady){
  $cacheBinary=Join-Path $workspace 'sub2-redis.exe'
  if($runtime.RedisHost -notin @('127.0.0.1','localhost') -or $runtime.RedisPort -ne 6379 -or !(Test-Path -LiteralPath $cacheBinary)){throw 'Configured cache is unavailable. Only the existing local cache on port 6379 can be started automatically.'}
  $cacheLog=Join-Path $runtime.Directory ('launcher-cache-'+[guid]::NewGuid().ToString('N'))
  $cacheProcess=Start-Process -FilePath $cacheBinary -WorkingDirectory $workspace -WindowStyle Hidden -PassThru -RedirectStandardOutput "$cacheLog.stdout.log" -RedirectStandardError "$cacheLog.stderr.log"
  for($i=0;$i -lt 30 -and !(Test-Sub2Tcp $runtime.RedisHost $runtime.RedisPort);$i++){Start-Sleep -Milliseconds 250}
  if(!(Test-Sub2Tcp $runtime.RedisHost $runtime.RedisPort)){throw "Cache did not become ready; inspect $cacheLog.stderr.log"}
}
if(!$backend){$backend=Start-Sub2Runtime $runtime}
$version=Wait-Sub2Ready -Port $runtime.Port
if(!$BackendOnly -and !$frontend){
  $savedTarget=$env:SUB2API_DEV_TARGET
  $log=Join-Path $runtime.Directory ('launcher-frontend-'+[guid]::NewGuid().ToString('N'))
  try{
    $env:SUB2API_DEV_TARGET="http://127.0.0.1:$($runtime.Port)"
    $frontend=Start-Process -FilePath $node -ArgumentList @(('"'+$vite+'"'),'--host','127.0.0.1','--port','5173','--strictPort') -WorkingDirectory (Join-Path $workspace 'packages/sub2-console') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$log.stdout.log" -RedirectStandardError "$log.stderr.log"
  }finally{$env:SUB2API_DEV_TARGET=$savedTarget}
  $ready=$false
  for($i=0;$i -lt 40;$i++){try{$page=Invoke-WebRequest 'http://127.0.0.1:5173/' -TimeoutSec 2;if($page.StatusCode -eq 200){$ready=$true;break}}catch{} Start-Sleep -Milliseconds 250}
  if(!$ready){throw "Frontend did not become ready; inspect $log.stderr.log"}
}
[PSCustomObject]@{runtime=$runtime.Directory;backendPid=$backend.ProcessId;version=$version;frontend='http://127.0.0.1:5173/';existingInstancesPreserved=$true}|ConvertTo-Json
