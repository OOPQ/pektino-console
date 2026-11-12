#Requires -Version 5.1
<#
.SYNOPSIS
  内置下载器：按队列把 mp4 拉到本地目录（断点续传 / 并发 / 可单条取消 / 进度文件）。
.DESCRIPTION
  由 console.ps1 以独立进程启动，读队列 JSON，写进度 JSON。
  - 优先 curl.exe（Win10+ 自带）：-C - 续传、重定向、代理
  - 有 aria2c.exe 时优先用它（-x8 -s8，多连接）
  - 先写 <token>.mp4.part，确认完整（大小 == 远端 Content-Length）才改名
  - 取消：向取消文件写 token，本进程检测到后 kill 对应 curl，保留 .part 供续传
.NOTES
  退出码：0 = 跑完；2 = 队列缺失/为空
#>
param(
    [Parameter(Mandatory = $true)][string]$QueueFile,
    [Parameter(Mandatory = $true)][string]$Dir,
    [string]$Proxy = '',
    [int]$Concurrent = 3,
    [Parameter(Mandatory = $true)][string]$ProgressFile,
    [string]$CancelFile = '',
    [int]$Retries = 3
)

$ErrorActionPreference = 'Stop'
$startAt = (Get-Date).ToString('s')
$PollMs = 600

$curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
$aria = (Get-Command aria2c.exe -ErrorAction SilentlyContinue).Source
$workDir = Split-Path $ProgressFile -Parent

function Write-ProgressFile($obj) {
    $tmp = "$ProgressFile.tmp"
    try {
        ($obj | ConvertTo-Json -Depth 5 -Compress) | Set-Content -Path $tmp -Encoding UTF8 -Force
        Move-Item -Path $tmp -Destination $ProgressFile -Force
    } catch { }
}

function Get-ProxyArg {
    param([string]$p)
    if ($p) { return $p }
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

# ---------------- 读队列 ----------------
if (-not (Test-Path $QueueFile)) { Write-Error "队列文件不存在: $QueueFile"; exit 2 }
$queue = @()
try {
    $parsed = ConvertFrom-Json -InputObject (Get-Content $QueueFile -Raw -Encoding UTF8)
    foreach ($x in @($parsed)) {
        if ($x -is [array]) { foreach ($y in $x) { $queue += $y } } else { $queue += $x }
    }
} catch { }
if (-not $queue.Count) { Write-Error '队列为空'; exit 2 }
if (-not (Test-Path $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }

$proxyArg = Get-ProxyArg -p $Proxy

# ---------------- 状态表 ----------------
$states = @{}   # token -> @{ state; bytes; expected; error }
$queueMap = @{}
foreach ($it in $queue) {
    $states[[string]$it.token] = @{ state = 'queued'; bytes = 0; expected = 0; error = '' }
    # 重试时要用到原 item（url/file），之前没填导致重试 curl 没 URL 可用
    $queueMap[[string]$it.token] = $it
}

try { Add-Type -AssemblyName System.Net.Http -ErrorAction Stop } catch { }
$http = $null
function New-HeadClient {
    $h = New-Object System.Net.Http.HttpClientHandler
    $h.MaxConnectionsPerServer = 16
    $h.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($script:proxyArg) {
        $h.Proxy = New-Object System.Net.WebProxy($script:proxyArg)
        $h.UseProxy = $true
    }
    $c = New-Object System.Net.Http.HttpClient($h)
    $c.Timeout = [TimeSpan]::FromSeconds(20)
    $c.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    return $c
}

function Get-RemoteSizesParallel {
    <#  并行取一批 URL 的 Content-Length（拿不到给 0），避免逐条 HEAD 拖慢并发启动  #>
    param([object[]]$items)
    $map = @{}
    if (-not $items -or -not $items.Count) { return $map }
    if (-not $script:http) { $script:http = New-HeadClient }
    $reqs = @{}
    foreach ($it in $items) {
        try {
            $m = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Head, [string]$it.url)
            $reqs[[string]$it.token] = $script:http.SendAsync($m)
        } catch {
            $map[[string]$it.token] = [int64]0
        }
    }
    foreach ($tk in @($reqs.Keys)) {
        try {
            $resp = $reqs[$tk].GetAwaiter().GetResult()
            $len = $resp.Content.Headers.ContentLength
            $map[$tk] = @{ size = $(if ($len) { [int64]$len } else { [int64]0 }); status = [int]$resp.StatusCode }
            $resp.Dispose()
        } catch {
            $map[$tk] = [int64]0
        }
    }
    return $map
}

function Get-RemoteSize([string]$url) {
    try {
        $a = @('-sS', '-I', '-L', '--max-time', '20')
        if ($proxyArg) { $a += @('-x', $proxyArg) }
        $a += $url
        foreach ($line in (& $curl @a 2>$null)) {
            if ($line -match '(?i)^content-length:\s*(\d+)') { return [int64]$Matches[1] }
        }
    } catch { }
    return [int64]0
}

function Build-Args($item, $outFile) {
    if ($aria) {
        $a = @('-c', '--auto-file-renaming=false', '--allow-overwrite=true', '-x', '8', '-s', '8',
            '-d', (Split-Path $outFile -Parent), '-o', (Split-Path $outFile -Leaf))
        if ($proxyArg) { $a += @('--all-proxy', $proxyArg) }
        $a += $item.url
        return @{ exe = $aria; args = $a }
    }
    $a = @('-sS', '-L', '-C', '-', '--fail', '--retry', "$Retries", '--retry-delay', '2',
        '--connect-timeout', '20', '-o', $outFile)
    if ($proxyArg) { $a += @('-x', $proxyArg) }
    $a += $item.url
    return @{ exe = $curl; args = $a }
}

function Start-Curl($item, $part, $log) {
    $spec = Build-Args -item $item -outFile $part
    return Start-Process -FilePath $spec.exe -ArgumentList $spec.args -NoNewWindow -PassThru `
        -RedirectStandardError $log -RedirectStandardOutput ($log + '.out') -ErrorAction Stop
}

function Complete-Item($tk) {
    $s = $states[$tk]
    $part = Join-Path $Dir ($tk + '.mp4.part')
    $final = Join-Path $Dir ($tk + '.mp4')
    if (-not (Test-Path $part)) { $s.state = 'failed'; $s.error = '缺少 .part'; return }
    try {
        if (Test-Path $final) { Remove-Item $final -Force }
        Move-Item -Path $part -Destination $final -Force
        $s.state = 'done'
        $s.bytes = (Get-Item $final).Length
    } catch {
        $s.state = 'failed'
        $s.error = "改名失败: $($_.Exception.Message)"
    }
}

function Test-DeadUrl {
    <#  HEAD 返回 403/404 时再用 1 字节 Range GET 复核：
        很多 CDN 会拦截 HEAD 或短时间大量请求，只有 GET 也失败才认为是真的失效 #>
    param([string]$url, [int]$code)
    try {
        $a = @('-sS', '-o', 'NUL', '-w', '%{http_code}', '-r', '0-0', '--max-time', '15', '-L')
        if ($script:proxyArg) { $a += @('-x', $script:proxyArg) }
        $a += $url
        $got = (& $curl @a 2>$null)
        return ([string]$got).Trim() -eq [string]$code
    } catch { return $false }
}

# ---------------- 主循环 ----------------
$jobs = @{}          # token -> @{ proc; part; final; log; expected; lastBytes; lastTime; speed; retries }
$pending = New-Object System.Collections.Queue
foreach ($it in $queue) { $pending.Enqueue($it) }

function Read-CancelTokens {
    if (-not $CancelFile -or -not (Test-Path $CancelFile)) { return @() }
    try {
        $raw = Get-Content $CancelFile -Raw -Encoding UTF8
        if (-not $raw) { return @() }
        $list = @($raw | ConvertFrom-Json)
        Remove-Item $CancelFile -Force -ErrorAction SilentlyContinue
        return @($list | ForEach-Object { [string]$_ })
    } catch { return @() }
}

try {
    while ($pending.Count -gt 0 -or $jobs.Count -gt 0) {
        # 取消请求
        foreach ($tk in (Read-CancelTokens)) {
            if ($jobs.ContainsKey($tk)) {
                $j = $jobs[$tk]
                try { & taskkill.exe /PID $j.proc.Id /T /F 2>&1 | Out-Null } catch { }
                try { $j.proc.Kill() } catch { }
                $states[$tk].state = 'cancelled'
                $jobs.Remove($tk)
            } elseif ($states.ContainsKey($tk) -and $states[$tk].state -eq 'queued') {
                $states[$tk].state = 'cancelled'
                # 从待跑队列里剔除
                $keep = @()
                while ($pending.Count -gt 0) { $x = $pending.Dequeue(); if ([string]$x.token -ne $tk) { $keep += $x } }
                foreach ($x in $keep) { $pending.Enqueue($x) }
            }
        }

        # 补满并发：先把这一批的远端大小并行问出来，再一起启动，避免逐条 HEAD 拖慢
        $slots = $Concurrent - $jobs.Count
        if ($slots -gt 0 -and $pending.Count -gt 0) {
            $batch = @()
            while ($batch.Count -lt $slots -and $pending.Count -gt 0) {
                $it = $pending.Dequeue()
                if ($states[[string]$it.token].state -eq 'cancelled') { continue }
                $batch += $it
            }
            $sizes = @{}
            if ($batch.Count -gt 0) { $sizes = Get-RemoteSizesParallel -items $batch }

        foreach ($item in $batch) {
            $tk = [string]$item.token

            $final = Join-Path $Dir ($tk + '.mp4')
            $part = Join-Path $Dir ($tk + '.mp4.part')
            if (Test-Path $final) {
                $states[$tk].state = 'done'
                $states[$tk].bytes = (Get-Item $final).Length
                continue
            }

            $expected = 0; $code = 0
            if ($sizes.ContainsKey($tk)) { $expected = [int64]$sizes[$tk].size; $code = [int]$sizes[$tk].status }
            $states[$tk].expected = $expected
            if ($code -eq 403 -or $code -eq 404 -or $code -eq 410) {
                # HEAD 可能是被 CDN 限流/拦了，用 1 字节 Range GET 复核一次再判死
                if ((Test-DeadUrl -url $item.url -code $code) -and -not (Test-Path $part)) {
                    $states[$tk].state = 'dead'
                    $states[$tk].error = "http:$code"
                    continue
                }
            }
            # 上次其实已经下满（curl 退出码异常/进程被杀）→ 直接收尾
            if ($expected -gt 0 -and (Test-Path $part) -and (Get-Item $part).Length -eq $expected) {
                Complete-Item $tk
                continue
            }
            $log = Join-Path $workDir ('.dl-' + $tk + '.log')
            try {
                $proc = Start-Curl -item $item -part $part -log $log
                $states[$tk].state = 'downloading'
                $jobs[$tk] = @{
                    proc = $proc; part = $part; final = $final; log = $log; expected = $expected
                    lastBytes = 0; lastTime = Get-Date; speed = 0; retries = 0
                }
            } catch {
                $states[$tk].state = 'failed'
                $states[$tk].error = $_.Exception.Message
            }
        }
        }

        Start-Sleep -Milliseconds $PollMs
        $now = Get-Date

        # 轮询
        foreach ($tk in @($jobs.Keys)) {
            $j = $jobs[$tk]
            $size = if (Test-Path $j.part) { (Get-Item $j.part).Length } else { [int64]0 }
            $states[$tk].bytes = $size
            $dt = ($now - $j.lastTime).TotalSeconds
            if ($dt -ge 1) {
                $j.speed = [math]::Round(($size - $j.lastBytes) / 1MB / $dt, 2)
                $j.lastBytes = $size; $j.lastTime = $now
            }

            if ($j.proc.HasExited) {
                # 成功判定：退出码 0 或 大小正好等于远端 Content-Length
                $complete = ($j.proc.ExitCode -eq 0) -or ($j.expected -gt 0 -and $size -eq $j.expected)
                if ($complete -and $size -gt 0) {
                    Complete-Item $tk
                } else {
                    $j.retries++
                    $errText = ''
                    if (Test-Path $j.log) { $errText = (Get-Content $j.log -Tail 2 -ErrorAction SilentlyContinue) -join ' ' }

                    # curl 在 GET 上拿到 403/404/410 —— 源文件确实没了，别重试
                    if ($errText -match 'error:\s*(403|404|410)') {
                        $states[$tk].state = 'dead'
                        $states[$tk].error = "http:$($Matches[1])"
                        $jobs.Remove($tk)
                        continue
                    }

                    if ($j.expected -gt 0 -and $size -gt $j.expected) {
                        Remove-Item $j.part -Force -ErrorAction SilentlyContinue
                        $size = 0
                    }
                    if ($j.retries -le $Retries) {
                        Start-Sleep -Seconds 2
                        try {
                            $j.proc = Start-Curl -item $queueMap[$tk] -part $j.part -log $j.log
                            $j.lastTime = Get-Date; $j.lastBytes = $size
                            continue
                        } catch { }
                    }
                    $states[$tk].state = 'failed'
                    $states[$tk].error = ($errText -replace '\s+', ' ').Trim()
                }
                $jobs.Remove($tk)
            }
        }

        # 汇总进度
        $bytes = 0; $speed = 0; $doneCount = 0; $failCount = 0; $active = @()
        foreach ($tk in $states.Keys) {
            $st = $states[$tk]
            $bytes += [int64]$st.bytes
            switch ($st.state) {
                'done' { $doneCount++ }
                'failed' { $failCount++ }
                'downloading' { $active += $tk }
            }
        }
        foreach ($tk in $jobs.Keys) { $speed += $jobs[$tk].speed }

        Write-ProgressFile @{
            running   = $true
            phase     = 'download'
            total     = $queue.Count
            done      = $doneCount
            failed    = $failCount
            bytes     = $bytes
            speed     = [math]::Round($speed, 2)
            active    = @($active)
            items     = @($states.Keys | ForEach-Object {
                    $sp = 0
                    if ($jobs.ContainsKey($_)) { $sp = $jobs[$_].speed }
                    [pscustomobject]@{ token = $_; state = $states[$_].state; bytes = $states[$_].bytes; expected = $states[$_].expected; speed = $sp; error = $states[$_].error }
                })
            startedAt = $startAt
            updatedAt = (Get-Date).ToString('s')
        }
    }

    $doneCount = 0; $failCount = 0; $bytes = 0; $errs = @()
    foreach ($tk in $states.Keys) {
        if ($states[$tk].state -eq 'done') { $doneCount++; $bytes += [int64]$states[$tk].bytes }
        elseif ($states[$tk].state -eq 'failed') { $failCount++; $errs += @{ token = $tk; error = $states[$tk].error } }
    }
    Write-ProgressFile @{
        running = $false; phase = 'done'; total = $queue.Count; done = $doneCount; failed = $failCount;
        bytes = $bytes; speed = 0; errors = @($errs | Select-Object -Last 20); startedAt = $startAt;
        items = @($states.Keys | ForEach-Object { [pscustomobject]@{ token = $_; state = $states[$_].state; bytes = $states[$_].bytes; error = $states[$_].error } });
        finishedAt = (Get-Date).ToString('s')
    }
    exit 0
}
catch {
    Write-ProgressFile @{ running = $false; phase = 'error'; total = $queue.Count; startedAt = $startAt; errors = @(@{ token = '-'; error = $_.Exception.Message }) }
    exit 1
}