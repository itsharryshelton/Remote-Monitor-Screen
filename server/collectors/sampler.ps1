# Windows performance counter sampler.
# Emits one compact JSON object per line on stdout, roughly once per second.
# Runs without admin rights. Spawned and supervised by winperf.mjs.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Static adapter info (name + real VRAM size; Win32_VideoController caps at 4 GB).
$adapters = @()
$classKey = 'HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}'
Get-ChildItem $classKey | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath
  if ($p.DriverDesc) {
    $mem = $p.'HardwareInformation.qwMemorySize'
    if (-not $mem) { $mem = $p.'HardwareInformation.MemorySize' }
    if ($mem -is [byte[]]) { $mem = [BitConverter]::ToUInt32($mem, 0) }
    $adapters += @{ name = $p.DriverDesc; vram = [double]$mem }
  }
}
[Console]::Out.WriteLine((@{ type = 'adapters'; adapters = $adapters } | ConvertTo-Json -Compress -Depth 4))
[Console]::Out.Flush()

$counters = @(
  '\Processor Information(_Total)\% Processor Utility',
  '\Processor Information(_Total)\% Processor Performance',
  '\Processor Information(_Total)\Processor Frequency',
  '\GPU Engine(*)\Utilization Percentage',
  '\GPU Adapter Memory(*)\Dedicated Usage',
  '\GPU Adapter Memory(*)\Shared Usage',
  '\PhysicalDisk(_Total)\Disk Read Bytes/sec',
  '\PhysicalDisk(_Total)\Disk Write Bytes/sec',
  '\PhysicalDisk(_Total)\% Idle Time',
  '\Network Interface(*)\Bytes Received/sec',
  '\Network Interface(*)\Bytes Sent/sec',
  '\System\Processes'
)

function Convert-Sample($set) {
  $out = @{ type = 'sample'; t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
  $engines = @{}   # "luid|engIdx" -> @{ sum; kind }
  $gpuMem = @{}    # luid -> @{ dedicated; shared }
  $net = @{}       # iface -> @{ rx; tx }

  foreach ($s in $set.CounterSamples) {
    $path = $s.Path
    $inst = $s.InstanceName
    $v = [double]$s.CookedValue

    if ($path -match '\\gpu engine\(') {
      if ($inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+_eng_(\d+)_engtype_(.*)$') {
        $key = "$($Matches[1])|$($Matches[2])"
        if (-not $engines.ContainsKey($key)) { $engines[$key] = @{ sum = 0.0; kind = ($Matches[3] -replace '\s*\d+$', '') } }
        $engines[$key].sum += $v
      }
    }
    elseif ($path -match '\\gpu adapter memory\(') {
      if ($inst -match 'luid_(0x[0-9a-f]+_0x[0-9a-f]+)') {
        $l = $Matches[1]
        if (-not $gpuMem.ContainsKey($l)) { $gpuMem[$l] = @{ dedicated = 0.0; shared = 0.0 } }
        if ($path -match 'dedicated usage$') { $gpuMem[$l].dedicated = $v } else { $gpuMem[$l].shared = $v }
      }
    }
    elseif ($path -match '\\network interface\(') {
      if (-not $net.ContainsKey($inst)) { $net[$inst] = @{ rx = 0.0; tx = 0.0 } }
      if ($path -match 'received/sec$') { $net[$inst].rx = $v } else { $net[$inst].tx = $v }
    }
    elseif ($path -match '% processor utility$') { $out.cpuUtility = $v }
    elseif ($path -match '% processor performance$') { $out.cpuPerf = $v }
    elseif ($path -match 'processor frequency$') { $out.cpuBaseMhz = $v }
    elseif ($path -match 'disk read bytes/sec$') { $out.diskRead = $v }
    elseif ($path -match 'disk write bytes/sec$') { $out.diskWrite = $v }
    elseif ($path -match '% idle time$') { $out.diskBusy = [math]::Max(0, 100 - $v) }
    elseif ($path -match '\\system\\processes$') { $out.processes = $v }
  }

  # Task Manager style: per engine sum over processes, then max over engines per adapter.
  $gpus = @{}
  foreach ($k in $engines.Keys) {
    $luid = $k.Split('|')[0]
    $e = $engines[$k]
    if (-not $gpus.ContainsKey($luid)) { $gpus[$luid] = @{ luid = $luid; util = 0.0; kinds = @{} } }
    $g = $gpus[$luid]
    $u = [math]::Min(100, $e.sum)
    if ($u -gt $g.util) { $g.util = $u }
    if (-not $g.kinds.ContainsKey($e.kind) -or $g.kinds[$e.kind] -lt $u) { $g.kinds[$e.kind] = $u }
  }
  foreach ($l in $gpuMem.Keys) {
    if (-not $gpus.ContainsKey($l)) { $gpus[$l] = @{ luid = $l; util = 0.0; kinds = @{} } }
    $gpus[$l].dedicated = $gpuMem[$l].dedicated
    $gpus[$l].shared = $gpuMem[$l].shared
  }
  $out.gpus = @($gpus.Values)
  $out.net = @($net.GetEnumerator() | ForEach-Object { @{ name = $_.Key; rx = $_.Value.rx; tx = $_.Value.tx } })
  return $out
}

while ($true) {
  # Re-run every 30 samples so wildcard instances (new GPU processes, adapters) are re-expanded.
  Get-Counter -Counter $counters -SampleInterval 1 -MaxSamples 30 | ForEach-Object {
    [Console]::Out.WriteLine(((Convert-Sample $_) | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
  }
}
