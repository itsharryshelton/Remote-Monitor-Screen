# Installs (or updates) the kiosk app on an Android TV / Google TV over the network with adb.
# Prerequisites: npm run apk:setup, npm run apk, and network debugging enabled on the TV (see README).
#   .\scripts\install-tv.ps1 -Tv 192.168.1.50                      # older TVs: "USB debugging" + port 5555
#   .\scripts\install-tv.ps1 -Tv 192.168.1.50:41235 -Pair 192.168.1.50:37099   # Android 11+ "Wireless debugging"
param(
  [Parameter(Mandatory)][string]$Tv,
  [string]$Pair,
  [string]$Toolchain = (Join-Path $env:LOCALAPPDATA 'rms-android')
)

$ErrorActionPreference = 'Stop'
$adb = Join-Path $Toolchain 'sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw "adb not found at $adb. Run: npm run apk:setup" }
$apk = Join-Path (Split-Path -Parent $PSScriptRoot) 'android\build\RemoteMonitor.apk'
if (-not (Test-Path $apk)) { throw "No APK at $apk. Run: npm run apk" }
if ($Tv -notmatch ':\d+$') { $Tv = "${Tv}:5555" }

if ($Pair) {
  # Prompts for the six-digit code the TV shows under "Pair device with pairing code".
  & $adb pair $Pair
  if ($LASTEXITCODE -ne 0) { throw 'adb pair failed' }
}

Write-Host "Connecting to $Tv (accept the 'Allow debugging?' prompt on the TV the first time)..."
$out = & $adb connect $Tv 2>&1 | Out-String
Write-Host $out.Trim()
if ($out -notmatch 'connected to') { throw "Could not connect to $Tv. Is network debugging on, and is the TV on the same network?" }

# The first connection can sit at 'unauthorized' until the prompt on the TV is accepted.
for ($i = 0; $i -lt 30; $i++) {
  $state = (& $adb -s $Tv get-state 2>$null | Out-String).Trim()
  if ($state -eq 'device') { break }
  Start-Sleep -Seconds 1
}
if ($state -ne 'device') { throw "TV did not authorise this PC (state: '$state'). Accept the prompt on the TV and run again." }

Write-Host 'Installing...'
& $adb -s $Tv install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'Install failed. If it says INSTALL_FAILED_UPDATE_INCOMPATIBLE, uninstall the old app on the TV first.' }

& $adb -s $Tv shell am start -n dev.rms.monitor/.MainActivity | Out-Null
Write-Host ''
Write-Host 'Installed and started. On the TV: press Back for settings, set the dashboard address, then pair with the code from the PC.'
