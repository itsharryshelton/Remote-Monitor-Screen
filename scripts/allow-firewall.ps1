# Adds a Windows Firewall rule so devices on your local network can reach the dashboard.
# Scope: inbound TCP on the dashboard port, Private network profile only, from the local subnet
# plus any extra ranges you pass (e.g. when the phone/TV is on a different subnet or VLAN):
#   .\scripts\allow-firewall.ps1 -RemoteAddress LocalSubnet,192.168.20.0/24
# The port defaults to the one in config.local.json (else 7865); override with -Port.
# Needs an elevated (Administrator) PowerShell. Remove with:  .\scripts\allow-firewall.ps1 -Remove
param(
  [int]$Port = 0,
  [string[]]$RemoteAddress = @('LocalSubnet'),
  [switch]$Remove
)

# Accept "a,b" as one argument too (that is how the elevated relaunch passes it).
$RemoteAddress = @($RemoteAddress | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

if (-not $Port) {
  $Port = 7865
  $cfgFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'config.local.json'
  if (Test-Path $cfgFile) {
    $cfgPort = (Get-Content $cfgFile -Raw | ConvertFrom-Json).port
    if ($cfgPort) { $Port = [int]$cfgPort }
  }
}

$name = 'Remote Monitor Screen (TCP {0})' -f $Port
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Re-launching elevated (accept the UAC prompt)...'
  $argsList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Port', $Port)
  if ($Remove) { $argsList += '-Remove' } else { $argsList += @('-RemoteAddress', ($RemoteAddress -join ',')) }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $argsList -Wait
  exit
}

Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if ($Remove) {
  Write-Host "Removed firewall rule '$name'."
} else {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port `
    -Profile Private -RemoteAddress $RemoteAddress -Description 'LAN dashboard for Remote Monitor Screen' | Out-Null
  Write-Host "Added firewall rule '$name' (Private profile, from: $($RemoteAddress -join ', '))."
}
Start-Sleep -Seconds 2
