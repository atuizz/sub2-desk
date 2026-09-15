# Import-only helpers: no side effects until a function is called.
function Get-Sub2Runtime([string]$Directory) {
  $dir=(Resolve-Path -LiteralPath $Directory -ErrorAction Stop).Path
  $binary=Join-Path $dir 'sub2api.exe';$config=Join-Path $dir 'config.yaml'
  if(!(Test-Path -LiteralPath $binary -PathType Leaf) -or !(Test-Path -LiteralPath $config -PathType Leaf)){throw 'Runtime requires sub2api.exe and config.yaml; legacy prototype paths are not used.'}
  $text=[IO.File]::ReadAllText($config)
  function Field([string]$section,[string]$name){
    $block=[regex]::Match($text,"(?ms)^${section}:\s*\r?\n(.*?)(?=^\S|\z)").Groups[1].Value
    $value=[regex]::Match($block,"(?m)^\s+${name}:\s*(.*?)\s*$").Groups[1].Value.Trim('"',"'")
    if(!$value){throw "Missing runtime field $section.$name"};return $value
  }
  $port=[int](Field 'server' 'port');$dbPort=[int](Field 'database' 'port');$redisPort=[int](Field 'redis' 'port')
  foreach($p in @($port,$dbPort,$redisPort)){if($p -lt 1 -or $p -gt 65535){throw 'Invalid configured port'}}
  [PSCustomObject]@{Directory=$dir;Binary=$binary;Config=$config;Port=$port;DatabaseHost=(Field 'database' 'host');DatabasePort=$dbPort;RedisHost=(Field 'redis' 'host');RedisPort=$redisPort}
}
function Test-Sub2Tcp([string]$Computer,[int]$Port){
  $client=[Net.Sockets.TcpClient]::new()
  try{$task=$client.ConnectAsync($Computer,$Port);return $task.Wait(1000) -and $client.Connected}catch{return $false}finally{$client.Dispose()}
}
function Get-OwnedSub2Listener([int]$Port,[string]$Executable){
  $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if(!$listeners.Count){return $null}
  $owners=@($listeners.OwningProcess|Select-Object -Unique)
  if($owners.Count -ne 1){throw "Multiple owners on port $Port"}
  $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($owners[0])"
  if(!$p -or $p.ExecutablePath -ne $Executable){throw "Port $Port belongs to a different executable; nothing was stopped"}
  return $p
}
function Get-Sub2HealthVersion([int]$Port){
  $origin="http://127.0.0.1:$Port"
  if((Invoke-RestMethod "$origin/health" -TimeoutSec 3).status -ne 'ok'){throw 'Backend health check failed'}
  $r=Invoke-RestMethod "$origin/api/v1/settings/public" -TimeoutSec 3
  if(!$r.data.version){throw 'Backend did not report a version'};return [string]$r.data.version
}
function Wait-Sub2Ready([int]$Port,[string]$Expected=''){
  for($i=0;$i -lt 30;$i++){
    try{$v=Get-Sub2HealthVersion $Port;if(!$Expected -or $v -eq $Expected){return $v}}catch{}
    Start-Sleep -Milliseconds 250
  }
  throw "Backend readiness/version validation failed on $Port"
}
function Start-Sub2Runtime($Runtime,[string]$LogPrefix=''){
  if(Get-OwnedSub2Listener $Runtime.Port $Runtime.Binary){throw 'Backend already running'}
  if(!$LogPrefix){$LogPrefix=Join-Path $Runtime.Directory ('launcher-'+[guid]::NewGuid().ToString('N'))}
  $saved=@{}
  try{
    foreach($key in @('DATA_DIR','ZONEINFO','TZ')){$saved[$key]=[Environment]::GetEnvironmentVariable($key)}
    $env:DATA_DIR=$Runtime.Directory;$env:TZ='UTC'
    $zone='C:/Program Files/Go/lib/time/zoneinfo.zip';if(Test-Path -LiteralPath $zone){$env:ZONEINFO=$zone}
    $p=Start-Process -FilePath $Runtime.Binary -WorkingDirectory $Runtime.Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput "$LogPrefix.stdout.log" -RedirectStandardError "$LogPrefix.stderr.log"
    return [PSCustomObject]@{ProcessId=$p.Id;ExecutablePath=$Runtime.Binary}
  }finally{foreach($key in $saved.Keys){if($null -eq $saved[$key]){Remove-Item -LiteralPath "Env:$key" -ErrorAction SilentlyContinue}else{[Environment]::SetEnvironmentVariable($key,$saved[$key])}}}
}
function Stop-OwnedSub2Runtime($Runtime){
  $p=Get-OwnedSub2Listener $Runtime.Port $Runtime.Binary;if(!$p){return}
  Stop-Process -Id $p.ProcessId -ErrorAction Stop
  for($i=0;$i -lt 40;$i++){
    if(!(Get-NetTCPConnection -State Listen -LocalPort $Runtime.Port -ErrorAction SilentlyContinue)){return}
    Start-Sleep -Milliseconds 250
  }
  throw 'Backend port did not release; aborting further changes'
}
