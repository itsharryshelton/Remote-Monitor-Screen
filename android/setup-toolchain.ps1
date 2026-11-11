# Downloads a private, portable Android build toolchain (no admin, no Android Studio):
#   Microsoft OpenJDK 17 + Android SDK command-line tools, platform 34, build-tools 34, platform-tools (adb).
# Everything goes in %LOCALAPPDATA%\rms-android. Delete that folder to remove it.
# Running this accepts the Android SDK licence (https://developer.android.com/studio/terms).
param([string]$Dir = (Join-Path $env:LOCALAPPDATA 'rms-android'))

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $Dir | Out-Null

# --- JDK ---
$jdk = Get-ChildItem $Dir -Directory -Filter 'jdk-17*' | Select-Object -First 1
if (-not $jdk) {
  Write-Host 'Downloading Microsoft OpenJDK 17...'
  $zip = Join-Path $Dir 'jdk.zip'
  Invoke-WebRequest 'https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip' -OutFile $zip
  Expand-Archive $zip $Dir -Force
  Remove-Item $zip
  $jdk = Get-ChildItem $Dir -Directory -Filter 'jdk-17*' | Select-Object -First 1
}
$env:JAVA_HOME = $jdk.FullName
Write-Host "JDK: $($jdk.FullName)"

# --- SDK command-line tools ---
$sdk = Join-Path $Dir 'sdk'
$latest = Join-Path $sdk 'cmdline-tools\latest'
$sdkmanager = Join-Path $latest 'bin\sdkmanager.bat'
if (-not (Test-Path $sdkmanager)) {
  Write-Host 'Finding latest Android command-line tools...'
  $xml = (Invoke-WebRequest 'https://dl.google.com/android/repository/repository2-3.xml' -UseBasicParsing).Content
  $build = ([regex]::Matches($xml, 'commandlinetools-win-(\d+)_latest\.zip') | ForEach-Object { [int64]$_.Groups[1].Value } | Measure-Object -Maximum).Maximum
  if (-not $build) { throw 'Could not find command-line tools in the Android repository index.' }
  Write-Host "Downloading command-line tools build $build..."
  $zip = Join-Path $Dir 'cmdline-tools.zip'
  Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-$($build)_latest.zip" -OutFile $zip
  $tmp = Join-Path $sdk 'cmdline-tools\_tmp'
  Expand-Archive $zip $tmp -Force
  Remove-Item $zip
  Move-Item (Join-Path $tmp 'cmdline-tools') $latest
  Remove-Item $tmp -Recurse -Force
}

# --- SDK packages ---
Write-Host 'Accepting SDK licences and installing packages (platform 34, build-tools 34.0.0, platform-tools)...'
$yes = (1..40 | ForEach-Object { 'y' }) -join "`n"
$yes | & $sdkmanager "--sdk_root=$sdk" --licenses | Out-Null
# Package ids contain ';', which cmd.exe (sdkmanager is a .bat) treats as a separator, so use a package file.
$pkgFile = Join-Path $Dir 'packages.txt'
Set-Content $pkgFile "platforms;android-34`nbuild-tools;34.0.0`nplatform-tools" -Encoding ascii
& $sdkmanager "--sdk_root=$sdk" "--package_file=$pkgFile" | Where-Object { $_ -notmatch '\[[.#=]*\]' }
if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed ($LASTEXITCODE)" }

Write-Host ''
Write-Host "Toolchain ready in $Dir"
