param(
  [string]$Backend = 'http://127.0.0.1:8000',
  [ValidateRange(1024,65535)][int]$Port = 5173
)
$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$backendUri = [Uri]$Backend
if ($backendUri.Scheme -notin @('http','https') -or $backendUri.UserInfo) { throw 'Backend must be an HTTP(S) origin without credentials.' }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 and pnpm 10.28.2 first. See README.md.' }
$previousTarget = $env:SUB2API_DEV_TARGET
try {
  $env:SUB2API_DEV_TARGET = $Backend.TrimEnd('/')
  Push-Location $desktopRoot
  Write-Host "Desktop: http://127.0.0.1:$Port/"
  Write-Host 'Uses your existing Sub2API service; does not install, restart or update it.'
  pnpm --filter @sub2-mac/console dev --host 127.0.0.1 --port $Port --strictPort
} finally {
  Pop-Location
  $env:SUB2API_DEV_TARGET = $previousTarget
}
