# Starts the dashboard server in the background with output in logs\server.log.
# Used by the Startup shortcut from install-autostart.ps1; safe to run by hand too.
$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

$cfgFile = Join-Path $root 'config.local.json'
$port = 7865
if (Test-Path $cfgFile) { $port = (Get-Content $cfgFile -Raw | ConvertFrom-Json).port }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  Write-Host "Already running on port $port."
  exit 0
}

$node = (Get-Command node -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList 'server/index.mjs' -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server.err.log')
Write-Host "Started. Run 'npm run pair' for the pairing code."
