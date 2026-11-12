# Builds android\build\RemoteMonitor.apk without Gradle or Android Studio.
# Prerequisite: .\android\setup-toolchain.ps1
#   .\android\build.ps1                                     # default address = this PC's LAN IP
#   .\android\build.ps1 -ServerUrl http://<your-pc-ip>:7865  # or choose it yourself
# Without -ServerUrl, the app's default dashboard address is this PC's LAN IPv4 (physical adapters
# first, like the server's startup banner) plus the port from config.local.json (else 7865).
# It is only a default: the address can be changed in the app.
# The signing key is created once in the toolchain folder (outside the repo). Keep it: Android
# only accepts updates signed with the same key.
param(
  [string]$ServerUrl,
  [string]$Toolchain = (Join-Path $env:LOCALAPPDATA 'rms-android'),
  [string]$VersionName = '0.3.0'
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$repo = Split-Path -Parent $here
$app = Join-Path $here 'app'
$out = Join-Path $here 'build'

# This PC's LAN IPv4 addresses, mirroring lanAddresses() in server\net.mjs: adapters that are up,
# no loopback or link-local (169.254.x), virtual/VPN adapters last, then adapters with a gateway first.
function Get-LanAddresses {
  $virtual = 'vethernet|virtual|vmware|hyper-v|wsl|docker|tailscale|zerotier|vpn|tap-|wireguard'
  $found = foreach ($nic in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($nic.OperationalStatus -ne 'Up' -or $nic.NetworkInterfaceType -eq 'Loopback') { continue }
    $props = $nic.GetIPProperties()
    $gateway = [bool]@($props.GatewayAddresses | Where-Object {
      $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0' })
    foreach ($ua in $props.UnicastAddresses) {
      $ip = $ua.Address
      if ($ip.AddressFamily -ne 'InterNetwork' -or [Net.IPAddress]::IsLoopback($ip)) { continue }
      if ($ip.ToString().StartsWith('169.254.')) { continue }
      [pscustomobject]@{
        Name = $nic.Name
        Address = $ip.ToString()
        Virtual = ("$($nic.Name) $($nic.Description)" -match $virtual)
        Gateway = $gateway
      }
    }
  }
  @($found | Sort-Object @{ Expression = { $_.Virtual } }, @{ Expression = { -not $_.Gateway } })
}

if (-not $ServerUrl) {
  $port = 7865
  $cfgFile = Join-Path $repo 'config.local.json'
  if (Test-Path $cfgFile) {
    $cfgPort = (Get-Content $cfgFile -Raw | ConvertFrom-Json).port
    if ($cfgPort) { $port = [int]$cfgPort }
  }
  $lan = @(Get-LanAddresses)
  if ($lan.Count -eq 0) {
    throw "Could not detect this PC's LAN IPv4 address. Pass the dashboard address yourself: npm run apk -- -ServerUrl http://<your-pc-ip>:$port"
  }
  $ServerUrl = "http://$($lan[0].Address):$port"
  $note = if ($lan[0].Virtual) { ', a virtual adapter' } else { '' }
  Write-Host "Default server URL: $ServerUrl (auto-detected from adapter '$($lan[0].Name)'$note)"
  foreach ($a in @($lan | Select-Object -Skip 1)) { Write-Host "  also on this PC: http://$($a.Address):$port ($($a.Name))" }
  Write-Host "  Wrong address? Rebuild with: npm run apk -- -ServerUrl http://<your-pc-ip>:$port (or change it in the app)"
} else {
  Write-Host "Default server URL: $ServerUrl"
}

$jdk = (Get-ChildItem $Toolchain -Directory -Filter 'jdk-17*' | Select-Object -First 1).FullName
if (-not $jdk) { throw "No JDK in $Toolchain. Run android\setup-toolchain.ps1 first." }
$sdk = Join-Path $Toolchain 'sdk'
$bt = Join-Path $sdk 'build-tools\34.0.0'
$androidJar = Join-Path $sdk 'platforms\android-34\android.jar'
$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$bt;$env:PATH"

function Run($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "$exe failed ($LASTEXITCODE)" }
}

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$dirs = 'gen', 'classes', 'dex', 'assets', 'res-gen\values', 'flat'
foreach ($d in $dirs) { New-Item -ItemType Directory -Force (Join-Path $out $d) | Out-Null }

# Bundled offline clock, shared with the web dashboard.
foreach ($f in 'clock.html', 'clock.css', 'clock.js') { Copy-Item (Join-Path $repo "public\$f") (Join-Path $out 'assets') }

# Default dashboard address baked in as a string resource (changeable in the app).
$escaped = [Security.SecurityElement]::Escape($ServerUrl)
Set-Content (Join-Path $out 'res-gen\values\config.xml') "<?xml version=`"1.0`" encoding=`"utf-8`"?>`n<resources><string name=`"default_url`" translatable=`"false`">$escaped</string></resources>" -Encoding utf8

Write-Host 'aapt2: compiling resources...'
Run "$bt\aapt2.exe" @('compile', '--dir', (Join-Path $app 'res'), '-o', (Join-Path $out 'flat\res.zip'))
Run "$bt\aapt2.exe" @('compile', (Join-Path $out 'res-gen\values\config.xml'), '-o', (Join-Path $out 'flat'))

$versionCode = [int][math]::Floor(((Get-Date).ToUniversalTime() - [datetime]'2026-01-01').TotalMinutes)
$flats = Get-ChildItem (Join-Path $out 'flat') -File | ForEach-Object FullName
Write-Host "aapt2: linking (versionCode $versionCode)..."
Run "$bt\aapt2.exe" (@('link', '-o', (Join-Path $out 'base.apk'), '-I', $androidJar,
  '--manifest', (Join-Path $app 'AndroidManifest.xml'), '-A', (Join-Path $out 'assets'),
  '--java', (Join-Path $out 'gen'), '--min-sdk-version', '29', '--target-sdk-version', '34',
  '--version-code', "$versionCode", '--version-name', $VersionName, '--auto-add-overlay') + $flats)

Write-Host 'javac...'
$sources = @(Get-ChildItem (Join-Path $app 'src'), (Join-Path $out 'gen') -Recurse -Filter *.java | ForEach-Object FullName)
Run "$jdk\bin\javac.exe" (@('-encoding', 'UTF-8', '--release', '8', '-Xlint:-options',
  '-classpath', $androidJar, '-d', (Join-Path $out 'classes')) + $sources)

Write-Host 'd8...'
$classes = @(Get-ChildItem (Join-Path $out 'classes') -Recurse -Filter *.class | ForEach-Object FullName)
Run "$bt\d8.bat" (@('--release', '--min-api', '29', '--lib', $androidJar, '--output', (Join-Path $out 'dex')) + $classes)

# Add classes.dex without touching the other entries (resources.arsc must stay uncompressed).
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open((Join-Path $out 'base.apk'), 'Update')
try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $out 'dex\classes.dex'), 'classes.dex') | Out-Null }
finally { $zip.Dispose() }

Write-Host 'zipalign...'
Run "$bt\zipalign.exe" @('-p', '-f', '4', (Join-Path $out 'base.apk'), (Join-Path $out 'aligned.apk'))

$ks = Join-Path $Toolchain 'rms-signing.jks'
$pass = Join-Path $Toolchain 'rms-signing.pass'
if (-not (Test-Path $ks)) {
  Write-Host 'Creating signing key (one-off)...'
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  Set-Content $pass ([Convert]::ToBase64String($bytes)) -NoNewline -Encoding ascii
  $pw = Get-Content $pass -Raw
  Run "$jdk\bin\keytool.exe" @('-genkeypair', '-keystore', $ks, '-storetype', 'PKCS12', '-alias', 'rms', '-keyalg', 'RSA',
    '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Remote Monitor Screen', '-storepass', $pw, '-keypass', $pw)
}

Write-Host 'apksigner...'
$apk = Join-Path $out 'RemoteMonitor.apk'
Run "$bt\apksigner.bat" @('sign', '--ks', $ks, '--ks-key-alias', 'rms', '--ks-pass', "file:$pass", '--out', $apk, (Join-Path $out 'aligned.apk'))
Run "$bt\apksigner.bat" @('verify', $apk)

Write-Host ''
Write-Host "Built $apk ($([math]::Round((Get-Item $apk).Length / 1KB)) KB), default server $ServerUrl"
