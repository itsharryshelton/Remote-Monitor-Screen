# Adds (or with -Remove, deletes) a shortcut in your Startup folder so the dashboard server
# starts when you sign in. Per-user, no admin rights needed.
param([switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Remote Monitor Screen.lnk'

if ($Remove) {
  Remove-Item $lnk -ErrorAction SilentlyContinue
  Write-Host "Removed $lnk"
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = (Get-Command powershell.exe).Source
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\run-hidden.ps1`""
$s.WorkingDirectory = $root
$s.WindowStyle = 7
$s.Description = 'Remote Monitor Screen dashboard server'
$s.Save()
Write-Host "Created $lnk"
