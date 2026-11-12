#Requires -Version 5.1
<#
.SYNOPSIS
  内置下载器：按队列把 mp4 拉到本地目录（支持断点续传、并发、进度文件）。
.DESCRIPTION
  由 console.ps1 以独立进程方式启动，读队列 JSON，写进度 JSON。
  - 优先用 curl.exe（Windows 10+ 自带）：支持 -C - 续传、重定向、代理
  - 若 PATH 上有 aria2c.exe，则用它（-x8 -s8 -c，多连接更快）
  - 单个文件先写 .part，完成后改名为 .mp4，避免把半个文件当成品
.NOTES
  退出码：0 = 队列跑完（允许个别失败）；2 = 队列文件缺失/为空
#>
param(
    [Parameter(Mandatory = $true)][string]$QueueFile,
    [Parameter(Mandatory = $true)][string]$Dir,
    [string]$Proxy = '',
    [int]$Concurrent = 3,
    [Parameter(Mandatory = $true)][string]$ProgressFile,
    [int]$Retries = 3
)

$ErrorActionPreference = 'Stop'
$startAt = (Get-Date).ToString('s')
$ProgressIntervalMs = 700

$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
$aria = (Get-Command aria2c.exe -ErrorAction SilentlyContinue).Source

function Write-ProgressFile($obj) {
    $tmp = "$ProgressFile.tmp"
    try {
        ($obj | ConvertTo-Json -Depth 5 -Compress) | Set-Content -Path $tmp -Encoding UTF8 -Force
        Move-Item -Path $tmp -Destination $ProgressFile -Force
    } catch { }
}

if (-not (Test-Path $QueueFile)) { Write-Error "队列文件不存在: $QueueFile"; exit 2 }
$queue = @()
try {
    $parsed = ConvertFrom-Json -InputObject (Get-Content $QueueFile -Raw -Encoding UTF8)
    $queue = @()
    foreach ($x in @($parsed)) {
        if ($x -is [array]) { foreach ($y in $x) { $queue += $y } } else { $queue += $x }
    }
} catch { }
if (-not $queue.Count) { Write-Error '队列为空'; exit 2 }
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

$jobs = @{}          # token -> @{ proc; part; total; started; lastBytes; lastTime; speed }
$done = 0; $failed = 0; $errors = @()
$totalBytes = 0; $doneBytes = 0
$queueTotal = $queue.Count

function Get-ProxyArg {
    param([string]$p)
    if ($p) { return $p }
    # 没显式配置时读系统代理（Clash/V2Ray 等一般会写这里）
    try {
        $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
        if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
            $s = [string]$reg.ProxyServer
            if ($s -notmatch '^[a-z]+://') { $s = 'http://' + $s }
            return $s
        }
    } catch { }
    return ''
}

$proxyArg = Get-ProxyArg -p $Proxy

function Build-Args($item, $outFile) {
    if ($aria) {
        $a = @('-c', '--auto-file-renaming=false', '--allow-overwrite=true', '-x', '8', '-s', '8',
            '-d', (Split-Path $outFile -Parent), '-o', (Split-Path $outFile -Leaf))
        if ($proxyArg) { $a += @('--all-proxy', $proxyArg) }
        $a += $item.url
        return @{ exe = $aria; args = $a }
    }
    $a = @('-sS', '-L', '-C', '-', '--retry', "$Retries", '--retry-delay', '2',
        '--connect-timeout', '20', '-o', $outFile)
    if ($proxyArg) { $a += @('-x', $proxyArg) }
    $a += $item.url
    return @{ exe = $curl; args = $a }
}

function Get-RemoteSize {
    <#  用 HEAD 拿 Content-Length；拿不到返回 0  #>
    param([string]$url)
    try {
        $a = @('-sS', '-I', '-L', '--max-time', '20')
        if ($proxyArg) { $a += @('-x', $proxyArg) }
        $a += $url
        $out = & $curl @a 2>$null
        foreach ($line in $out) {
            if ($line -match '(?i)^content-length:\s*(\d+)') { return [int64]$Matches[1] }
        }
    } catch { }
    return [int64]0
}

function Start-One($item) {
    $tk = $item.token
    $final = Join-Path $Dir ($tk + '.mp4')
    $part = Join-Path $Dir ($tk + '.mp4.part')
    if (Test-Path $final) {
        $script:done++
        $script:doneBytes += (Get-Item $final).Length
        return
    }
    $expected = Get-RemoteSize -url $item.url
    # 已经下满（上次 curl 退出码异常但文件其实完整）→ 直接收尾
    if ($expected -gt 0 -and (Test-Path $part) -and (Get-Item $part).Length -eq $expected) {
        Move-Item -Path $part -Destination $final -Force
        $script:done++
        $script:doneBytes += (Get-Item $final).Length
        return
    }
    $spec = Build-Args -item $item -outFile $part
    $log = Join-Path (Split-Path $ProgressFile -Parent) ('.dl-' + $tk + '.log')
    $proc = Start-Process -FilePath $spec.exe -ArgumentList $spec.args -NoNewWindow -PassThru `
        -RedirectStandardError $log -RedirectStandardOutput ($log + '.out') -ErrorAction Stop
    $script:jobs[$tk] = @{
        proc = $proc; part = $part; final = $final; log = $log; expected = $expected
        bytes = 0; lastBytes = 0; lastTime = Get-Date; speed = 0; retries = 0
    }
}

function Total-Bytes {
    $sum = 0
    foreach ($k in $script:jobs.Keys) {
        $j = $script:jobs[$k]
        if (Test-Path $j.part) { $sum += (Get-Item $j.part).Length }
    }
    return $sum
}

try {
    Write-ProgressFile @{ running = $true; phase = 'start'; total = $queueTotal; done = 0; failed = 0; bytes = 0; speed = 0; items = @(); startedAt = (Get-Date).ToString('s') }
    $pending = New-Object System.Collections.Queue
    foreach ($it in $queue) { $pending.Enqueue($it) }

    while ($pending.Count -gt 0 -or $jobs.Count -gt 0) {
        # 补满并发
        while ($jobs.Count -lt $Concurrent -and $pending.Count -gt 0) {
            $item = $pending.Dequeue()
            try { Start-One $item } catch {
                $failed++
                $errors += @{ token = $item.token; error = $_.Exception.Message }
            }
        }

        Start-Sleep -Milliseconds $ProgressIntervalMs

        # 轮询进度
        $now = Get-Date
        foreach ($tk in @($jobs.Keys)) {
            $j = $jobs[$tk]
            if (Test-Path $j.part) { $j.bytes = (Get-Item $j.part).Length }
            $dt = ($now - $j.lastTime).TotalSeconds
            if ($dt -ge 1) {
                $j.speed = [math]::Round(($j.bytes - $j.lastBytes) / 1MB / $dt, 2)
                $j.lastBytes = $j.bytes; $j.lastTime = $now
            }

            if ($j.proc.HasExited) {
                $size = if (Test-Path $j.part) { (Get-Item $j.part).Length } else { [int64]0 }
                # 判定成功：退出码 0，或者文件大小正好等于远端 Content-Length
                # （curl 在连接末尾被重置时会给非 0 退出码，但数据其实是完整的）
                $complete = ($j.proc.ExitCode -eq 0) -or ($j.expected -gt 0 -and $size -eq $j.expected)
                if ($complete -and $size -gt 0) {
                    try {
                        if (Test-Path $j.final) { Remove-Item $j.final -Force }
                        Move-Item -Path $j.part -Destination $j.final -Force
                        $done++
                        $doneBytes += (Get-Item $j.final).Length
                    } catch {
                        $failed++
                        $errors += @{ token = $tk; error = "改名失败: $($_.Exception.Message)" }
                    }
                } else {
                    $j.retries++
                    $errText = ''
                    if (Test-Path $j.log) { $errText = (Get-Content $j.log -Tail 2 -ErrorAction SilentlyContinue) -join ' ' }
                    if ($size -gt $j.expected -and $j.expected -gt 0) {
                        # 比远端还大：文件坏了，删掉重下
                        Remove-Item $j.part -Force -ErrorAction SilentlyContinue
                    }
                    if ($j.retries -le $Retries) {
                        # 保留 .part 续传，稍后重试
                        Start-Sleep -Seconds 2
                        try {
                            $item = $queue | Where-Object { $_.token -eq $tk } | Select-Object -First 1
                            $spec = Build-Args -item $item -outFile $j.part
                            $j.proc = Start-Process -FilePath $spec.exe -ArgumentList $spec.args -NoNewWindow -PassThru `
                                -RedirectStandardError $j.log -RedirectStandardOutput ($j.log + '.out') -ErrorAction Stop
                            $j.lastTime = Get-Date; $j.lastBytes = $j.bytes
                            $j.bytes = $size
                            continue
                        } catch { }
                    }
                    $failed++
                    $errors += @{ token = $tk; error = ($errText -replace '\s+', ' ').Trim() }
                }
                $jobs.Remove($tk)
            }
        }

        $bytes = $doneBytes + (Total-Bytes)
        $speedSum = 0
        foreach ($k in $jobs.Keys) { $speedSum += $jobs[$k].speed }
        Write-ProgressFile @{
            running    = $true
            phase      = 'download'
            total      = $queueTotal
            done       = $done
            failed     = $failed
            bytes      = $bytes
            speed      = [math]::Round($speedSum, 2)
            active     = @($jobs.Keys)
            errors     = @($errors | Select-Object -Last 10)
            startedAt  = $startAt
            updatedAt  = (Get-Date).ToString('s')
        }
    }

    Write-ProgressFile @{
        running = $false; phase = 'done'; total = $queueTotal; done = $done; failed = $failed;
        bytes = $doneBytes; speed = 0; errors = @($errors | Select-Object -Last 20);
        finishedAt = (Get-Date).ToString('s')
    }
    exit 0
}
catch {
    Write-ProgressFile @{
        running = $false; phase = 'error'; total = $queueTotal; done = $done; failed = $failed;
        bytes = $doneBytes; speed = 0; errors = @(@{ token = '-'; error = $_.Exception.Message })
    }
    exit 1
}
