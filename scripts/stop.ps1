# Stops a background dashboard server started by run-hidden.ps1.
$root = Split-Path -Parent $PSScriptRoot
$cfgFile = Join-Path $root 'config.local.json'
$port = 7865
if (Test-Path $cfgFile) { $port = (Get-Content $cfgFile -Raw | ConvertFrom-Json).port }
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Host 'Not running.'; exit 0 }
foreach ($c in $conns) {
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  if ($p -and $p.ProcessName -eq 'node') { Stop-Process -Id $p.Id; Write-Host "Stopped node (pid $($p.Id))." }
  else { Write-Host "Port $port is held by $($p.ProcessName) (pid $($c.OwningProcess)), not stopping it." }
}
