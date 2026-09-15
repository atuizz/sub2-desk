# Dependency-injected sequencing used by the one-time local cutover tool and offline tests.
function Invoke-Sub2Rollback {
  param([hashtable]$Steps)
  foreach($name in @('Validate','Record','Stop','BackupCurrent','RestoreDatabase','InstallPrevious','StartPrevious','Verify','RecoverCurrent')){
    if($Steps[$name] -isnot [scriptblock]){throw "Missing rollback step $name"}
  }
  $phase='validated';$stopped=$false;$restoreAttempted=$false
  & $Steps.Validate
  try {
    & $Steps.Record 'stopping'
    & $Steps.Stop;$stopped=$true
    $phase='backup-current'; & $Steps.Record $phase
    & $Steps.BackupCurrent
    # Mark BEFORE restore starts. Even a partial/failed restore must never fall through to an old binary.
    $phase='restore-database'; & $Steps.Record $phase
    $restoreAttempted=$true
    & $Steps.RestoreDatabase
    $phase='install-previous'; & $Steps.Record $phase
    & $Steps.InstallPrevious
    $phase='start-previous'; & $Steps.Record $phase
    & $Steps.StartPrevious
    $phase='verify-previous'; & $Steps.Record $phase
    & $Steps.Verify
    & $Steps.Record 'completed'
  } catch {
    $cause=$_
    # The database is untouched only before RestoreDatabase. All later failures require explicit recovery.
    if($stopped -and !$restoreAttempted){
      try { & $Steps.RecoverCurrent; & $Steps.Record 'failed-before-restore-current-recovered' } catch { & $Steps.Record 'failed-current-recovery' }
    } else { try{& $Steps.Record "failed-$phase-requires-recovery"}catch{} }
    throw $cause
  }
}
function Assert-Sub2FreshArchive([string[]]$Paths){
  foreach($file in $Paths){if(Test-Path -LiteralPath $file){throw "Archive already exists; refusing to overwrite: $file"}}
}
