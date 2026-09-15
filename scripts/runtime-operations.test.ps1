$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-operations.ps1')
. (Join-Path $PSScriptRoot 'upgrade-transaction.ps1')
$script:checks=0
function Assert($condition,[string]$message){if(!$condition){throw $message};$script:checks++}
function Test-Scenario([string]$failAt=''){
  $events=[Collections.Generic.List[string]]::new()
  $steps=@{}
  foreach($name in @('Validate','Stop','BackupCurrent','RestoreDatabase','InstallPrevious','StartPrevious','Verify','RecoverCurrent')){
    $label=$name
    $steps[$name]={ $events.Add($label); if($failAt -eq $label){throw "Injected $label"} }.GetNewClosure()
  }
  $steps.Record={param($phase) $events.Add("state:$phase")}.GetNewClosure()
  $failed=$false;try{Invoke-Sub2Rollback $steps}catch{$failed=$true}
  return @{events=$events;failed=$failed}
}
$success=Test-Scenario
Assert (!$success.failed) 'Success path failed'
Assert (($success.events|Where-Object {$_ -notlike 'state:*'}) -join ',' -eq 'Validate,Stop,BackupCurrent,RestoreDatabase,InstallPrevious,StartPrevious,Verify') 'Rollback sequence is unsafe'
Assert ($success.events[-1] -eq 'state:completed') 'Completion not audited'
foreach($failure in @('Validate','Stop','BackupCurrent','RestoreDatabase','InstallPrevious','StartPrevious','Verify')){
  $result=Test-Scenario $failure
  Assert $result.failed "Failure escaped: $failure"
  if($failure -eq 'BackupCurrent'){
    Assert ($result.events.Contains('RecoverCurrent') -and !$result.events.Contains('RestoreDatabase')) 'Pre-restore recovery incorrect'
  }else{
    Assert (!$result.events.Contains('RecoverCurrent')) "Unsafe old/current auto-start after $failure"
  }
  if($failure -in @('RestoreDatabase','InstallPrevious')){Assert (!$result.events.Contains('StartPrevious')) "Started previous binary with unverified state after $failure"}
}
$temp=Join-Path ([IO.Path]::GetTempPath()) ('sub2-runtime-check-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp|Out-Null
try{
  $exe=Join-Path $temp 'sub2api.exe';$config=Join-Path $temp 'config.yaml'
  [IO.File]::WriteAllText($exe,'fixture binary, never executed')
  [IO.File]::WriteAllText($config,"server:`n  port: 58019`ndatabase:`n  host: 127.0.0.1`n  port: 55432`n  password: do-not-expose`nredis:`n  host: 127.0.0.1`n  port: 6379`n")
  $runtime=Get-Sub2Runtime $temp
  Assert ($runtime.Binary -eq $exe -and $runtime.Port -eq 58019) 'Configured runtime target not used'
  Assert (($runtime|ConvertTo-Json) -notmatch 'do-not-expose') 'Runtime summary exposes database password'
  $before=[IO.File]::ReadAllText($exe);$blocked=$false
  try{Assert-Sub2FreshArchive @($exe)}catch{$blocked=$true}
  Assert ($blocked -and [IO.File]::ReadAllText($exe) -eq $before) 'Existing archive overwritten'
  Assert-Sub2FreshArchive @((Join-Path $temp 'absent.dump'))
  function Get-NetTCPConnection { [PSCustomObject]@{OwningProcess=777} }
  function Get-CimInstance { [PSCustomObject]@{ProcessId=777;ExecutablePath='C:\unrelated.exe'} }
  $blocked=$false;try{Get-OwnedSub2Listener 58019 $exe|Out-Null}catch{$blocked=$true}
  Assert $blocked 'Foreign listener accepted'
  function Get-CimInstance { [PSCustomObject]@{ProcessId=777;ExecutablePath=$exe} }
  Assert ((Get-OwnedSub2Listener 58019 $exe).ProcessId -eq 777) 'Owned listener rejected'
  $script:launches=[Collections.Generic.List[object]]::new()
  function Get-NetTCPConnection { return }
  function Start-Process {param($FilePath,$WorkingDirectory,$WindowStyle,[switch]$PassThru,$RedirectStandardOutput,$RedirectStandardError)
    $script:launches.Add(@{binary=$FilePath;directory=$WorkingDirectory;hidden=$WindowStyle;data=$env:DATA_DIR});[PSCustomObject]@{Id=888}
  }
  $prior=$env:DATA_DIR
  $started=Start-Sub2Runtime $runtime (Join-Path $temp 'fixture-log')
  Assert ($started.ProcessId -eq 888 -and $script:launches[0].binary -eq $exe -and $script:launches[0].directory -eq $temp -and $script:launches[0].hidden -eq 'Hidden' -and $script:launches[0].data -eq $temp) 'Launcher used wrong runtime/environment'
  Assert ($env:DATA_DIR -eq $prior) 'Environment was not restored'
}finally{
  # Only these two known test files exist; no recursive deletion or executable was launched.
  Remove-Item -LiteralPath (Join-Path $temp 'sub2api.exe'),(Join-Path $temp 'config.yaml') -Force
  Remove-Item -LiteralPath $temp
}
Write-Output "$script:checks runtime operation assertions passed; no real process or database mutations"
