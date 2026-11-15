param([switch]$NoGpu, [int]$Interval = 100)

$ErrorActionPreference = 'SilentlyContinue'
if ($Interval -lt 100) { $Interval = 100 }

function New-Counter([string]$Category, [string]$Counter, [string]$Instance) {
  try {
    $c = New-Object System.Diagnostics.PerformanceCounter($Category, $Counter, $Instance, $true)
    $null = $c.NextValue()
    return $c
  } catch {
    return $null
  }
}

# ---------------------------------------------------------------------------
# GPU usage (3D engines) and dedicated VRAM
# ---------------------------------------------------------------------------

$gpuCategory = $null
$gpuCounters = @{}
$gpuNames = @()
$gpuActive = @{}
$gpuScanIndex = 0
$gpuLastScan = 0

$memCategory = $null
$memCounters = @{}
$memLastScan = 0
$vramValue = $null
$vramLastSample = 0

if (-not $NoGpu) {
  try { $gpuCategory = New-Object System.Diagnostics.PerformanceCounterCategory('GPU Engine') } catch { $gpuCategory = $null }
  try { $memCategory = New-Object System.Diagnostics.PerformanceCounterCategory('GPU Adapter Memory') } catch { $memCategory = $null }
}

function Update-GpuList {
  if (-not $gpuCategory) { return }
  try { $names = @($gpuCategory.GetInstanceNames()) } catch { return }
  $list = @()
  $known = @{}
  foreach ($name in $names) {
    if ($name -notmatch 'engtype_3d$') { continue }
    $list += $name
    $known[$name] = $true
  }
  $script:gpuNames = $list
  if ($script:gpuScanIndex -ge $list.Count) { $script:gpuScanIndex = 0 }
  foreach ($name in @($script:gpuCounters.Keys)) {
    if (-not $known.ContainsKey($name)) {
      try { $script:gpuCounters[$name].Dispose() } catch { }
      $script:gpuCounters.Remove($name)
      $script:gpuActive.Remove($name)
    }
  }
}

function Read-GpuCounter([string]$Name) {
  $counter = $script:gpuCounters[$Name]
  if (-not $counter) {
    $counter = New-Counter 'GPU Engine' 'Utilization Percentage' $Name
    if (-not $counter) { return $null }
    $script:gpuCounters[$Name] = $counter
  }
  try {
    return [double]$counter.NextValue()
  } catch {
    return $null
  }
}

function Read-Gpu {
  if ($NoGpu -or -not $gpuCategory) { return $null }
  $now = [Environment]::TickCount
  if ((($now - $script:gpuLastScan) -ge 5000) -or ($script:gpuNames.Count -eq 0)) {
    Update-GpuList
    $script:gpuLastScan = $now
  }

  $max = 0.0
  $stillActive = @{}

  # Always poll engines that were busy on a previous tick.
  foreach ($name in @($script:gpuActive.Keys)) {
    $value = Read-GpuCounter $name
    if ($value -eq $null) { continue }
    if ($value -gt 0) {
      $stillActive[$name] = $true
      if ($value -gt $max) { $max = $value }
    }
  }

  # Walk a slice of the full engine list each tick so newly busy engines are
  # discovered without a single long stall. The slice scales with the refresh
  # interval so a full sweep takes roughly 2 seconds at fast rates and about
  # 10 seconds at the slowest rate.
  $count = $script:gpuNames.Count
  if ($count -gt 0) {
    $sweepTarget = [Math]::Max(8000, $Interval * 4)
    $batch = [int][Math]::Ceiling($count * $Interval / $sweepTarget)
    if ($batch -lt 1) { $batch = 1 }
    if ($batch -gt $count) { $batch = $count }
    for ($i = 0; $i -lt $batch; $i++) {
      $name = $script:gpuNames[($script:gpuScanIndex + $i) % $count]
      if ($stillActive.ContainsKey($name)) { continue }
      $value = Read-GpuCounter $name
      if ($value -eq $null) { continue }
      if ($value -gt 0) {
        $stillActive[$name] = $true
        if ($value -gt $max) { $max = $value }
      }
    }
    $script:gpuScanIndex = ($script:gpuScanIndex + $batch) % $count
  }

  $script:gpuActive = $stillActive

  if ($max -gt 100) { $max = 100 }
  if ($max -lt 0) { $max = 0 }
  return [math]::Round($max, 0)
}

function Read-Vram {
  if ($NoGpu -or -not $memCategory) { return $null }
  $now = [Environment]::TickCount
  if ((($now - $script:memLastScan) -ge 5000) -or ($script:memCounters.Count -eq 0)) {
    try { $names = @($memCategory.GetInstanceNames()) } catch { $names = @() }
    $seen = @{}
    foreach ($name in $names) {
      $seen[$name] = $true
      if (-not $script:memCounters.ContainsKey($name)) {
        $counter = New-Counter 'GPU Adapter Memory' 'Dedicated Usage' $name
        if ($counter) { $script:memCounters[$name] = $counter }
      }
    }
    foreach ($name in @($script:memCounters.Keys)) {
      if (-not $seen.ContainsKey($name)) {
        try { $script:memCounters[$name].Dispose() } catch { }
        $script:memCounters.Remove($name)
      }
    }
    $script:memLastScan = $now
  }

  $byAdapter = @{}
  foreach ($name in @($script:memCounters.Keys)) {
    $parts = $name -split '_phys_'
    $luid = $parts[0]
    if (-not $byAdapter.ContainsKey($luid)) { $byAdapter[$luid] = 0.0 }
    try { $byAdapter[$luid] += [double]$script:memCounters[$name].NextValue() } catch { }
  }

  $maxMem = 0.0
  foreach ($value in $byAdapter.Values) {
    if ($value -gt $maxMem) { $maxMem = $value }
  }
  if ($maxMem -gt 0) { return [int64]$maxMem }
  return $null
}

# ---------------------------------------------------------------------------
# Network throughput (cumulative byte counters sampled in-process)
# ---------------------------------------------------------------------------

$netNics = @()
$netPrev = @{}
$netLastScan = 0
$netLastTime = 0

function Update-NetList {
  try {
    $script:netNics = @(
      [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object {
          $_.OperationalStatus -eq 'Up' -and
          $_.NetworkInterfaceType -ne [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback
        }
    )
  } catch {
    $script:netNics = @()
  }
}

function Read-Net {
  $now = [Environment]::TickCount
  if ((($now - $script:netLastScan) -ge 5000) -or ($script:netNics.Count -eq 0)) {
    Update-NetList
    $script:netLastScan = $now
  }

  $elapsed = $now - $script:netLastTime
  if ($elapsed -lt 1) { $elapsed = 1 }
  $script:netLastTime = $now

  $down = [int64]0
  $up = [int64]0
  $busiest = ''
  $busiestName = ''
  $busiestSpeed = [int64]0
  $busiestType = ''
  $busiestRate = [int64]-1
  $readings = @{}

  foreach ($nic in $script:netNics) {
    try {
      $v4 = $nic.GetIPv4Statistics()
      $rx = [int64]$v4.BytesReceived
      $tx = [int64]$v4.BytesSent
    } catch {
      continue
    }
    try {
      $v6 = $nic.GetIPv6Statistics()
      $rx += [int64]$v6.BytesReceived
      $tx += [int64]$v6.BytesSent
    } catch {
      # IPv6 stats are not available on every adapter
    }

    $readings[$nic.Id] = @{ rx = $rx; tx = $tx }
    $prev = $script:netPrev[$nic.Id]
    if (-not $prev) { continue }

    $rxDelta = $rx - [int64]$prev.rx
    $txDelta = $tx - [int64]$prev.tx
    if ($rxDelta -lt 0) { $rxDelta = 0 }
    if ($txDelta -lt 0) { $txDelta = 0 }

    $rxRate = [int64](($rxDelta * 1000) / $elapsed)
    $txRate = [int64](($txDelta * 1000) / $elapsed)
    $down += $rxRate
    $up += $txRate

    $rate = $rxRate + $txRate
    if ($rate -gt $busiestRate) {
      $busiestRate = $rate
      $busiest = $nic.Description
      $busiestName = $nic.Name
      $busiestType = [string]$nic.NetworkInterfaceType
      try { $busiestSpeed = [int64]$nic.Speed } catch { $busiestSpeed = [int64]0 }
    }
  }

  $script:netPrev = $readings

  return @{
    down = $down
    up = $up
    iface = $busiest
    name = $busiestName
    type = $busiestType
    speed = $busiestSpeed
  }
}

# ---------------------------------------------------------------------------
# Output loop
# ---------------------------------------------------------------------------

$timer = [System.Diagnostics.Stopwatch]::StartNew()
$next = 0

while ($true) {
  $gpuValue = $null
  if (-not $NoGpu) { $gpuValue = Read-Gpu }

  $now = [Environment]::TickCount
  if ((($now - $vramLastSample) -ge 4000)) {
    $vramValue = Read-Vram
    $vramLastSample = $now
  }

  $net = Read-Net

  $payload = [ordered]@{
    gpu = $gpuValue
    vram = $vramValue
    down = $net.down
    up = $net.up
    iface = $net.iface
    name = $net.name
    type = $net.type
    speed = $net.speed
  }
  [Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))
  [Console]::Out.Flush()

  $next += $Interval
  $delay = $next - $timer.ElapsedMilliseconds
  if ($delay -gt 0) {
    Start-Sleep -Milliseconds $delay
  } else {
    $next = $timer.ElapsedMilliseconds
  }
}
