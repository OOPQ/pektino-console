# ---------------- 封面修复 ----------------

try { Add-Type -AssemblyName System.Net.Http -ErrorAction Stop } catch { }

function Get-CoverMissingList {
    <#  返回缺封面 / 封面损坏的 token 列表（跳过已标记 .missing 的）  #>
    param([int]$Limit = 0)
    $out = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        $tk = [string]$r.token
        if (-not $tk) { continue }
        # 非 token 命名的本地文件（例如中文片名）不参与封面抓取
        if ($tk -notmatch '^[A-Za-z0-9_\-]+$') { continue }
        # 没有 url 的条目（本地导入/无来源）没有详情页可抓，跳过
        if (-not $r.url) { continue }
        if (Test-Path (Join-Path $CoverDir ($tk + '.missing'))) { continue }
        $f = Join-Path $CoverDir ($tk + '.jpg')
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 1024)) { continue }
        [void]$out.Add($r)
        if ($Limit -gt 0 -and $out.Count -ge $Limit) { break }
    }
    return $out
}

function Get-CoverMissingCount {
    return (Get-CoverMissingList).Count
}

function Repair-Covers {
    <#
      补齐缺失/损坏的封面：重新取详情页的 JSON-LD thumbnailUrl，再下载图片。
      - 并发 8，限流 Limit 条，默认 40
      - 拿不到封面地址或图片 404 时写 <token>.missing 标记，避免反复重试
      - 修完顺带补缩略图
    #>
    param([int]$Limit = 40)

    $candidates = Get-CoverMissingList -Limit $Limit
    if (-not $candidates.Count) {
        return [pscustomobject]@{ ok = $true; fixed = 0; failed = 0; missing = 0; scanned = 0 }
    }

    if (-not (Test-Path $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }

    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 8
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Config.proxy) {
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Config.proxy)
        $handler.UseProxy = $true
    }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(25)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')

    $fixed = 0; $failed = 0; $dead = 0
    $Threads = 8

    try {
        for ($i = 0; $i -lt $candidates.Count; $i += $Threads) {
            $end = [Math]::Min($i + $Threads - 1, $candidates.Count - 1)
            $batch = @($candidates[$i..$end])
            $tasks = @{}
            foreach ($r in $batch) {
                $tk = [string]$r.token
                $url = if ($r.page_url) { [string]$r.page_url } else { "https://pektino.com/zh-CN/movie/$tk" }
                try {
                    $tasks[$tk] = @{ page = $client.GetStringAsync($url); token = $tk; dest = (Join-Path $CoverDir ($tk + '.jpg')) }
                } catch { $failed++ }
            }
            foreach ($tk in @($tasks.Keys)) {
                $t = $tasks[$tk]
                try {
                    $html = $t.page.GetAwaiter().GetResult()
                    $coverUrl = ''
                    foreach ($m in [regex]::Matches($html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
                        try {
                            $ld = $m.Groups[1].Value | ConvertFrom-Json
                            if ($ld.'@type' -eq 'VideoObject' -and $ld.thumbnailUrl) { $coverUrl = [string]$ld.thumbnailUrl; break }
                        } catch { }
                    }
                    if (-not $coverUrl) {
                        # 详情页里没有封面信息 —— 标记为无封面，别再重试
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                        continue
                    }
                    $bytes = $client.GetByteArrayAsync($coverUrl).GetAwaiter().GetResult()
                    if ($bytes.Length -gt 1024) {
                        [System.IO.File]::WriteAllBytes($t.dest, $bytes)
                        $fixed++
                    } else {
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                    }
                } catch {
                    $is404 = $false
                    try { $is404 = ($_.Exception.Message -match '404') } catch { }
                    if ($is404) {
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                    } else {
                        $failed++
                    }
                }
            }
        }
    } finally {
        $client.Dispose()
    }

    if ($fixed -gt 0) {
        try { [void](Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir) } catch { }
    }
    Touch-State
    $left = (Get-CoverMissingList).Count
    Write-Log 'cover' "封面修复：补 $fixed 张，失败 $failed，确认无封面 $dead，仍缺 $left"
    return [pscustomobject]@{ ok = $true; fixed = $fixed; failed = $failed; missing = $left; scanned = $candidates.Count }
}

function Step-Covers {
    <#  主循环里低频调用：空闲且缺封面时自动补一批（10 分钟最多一次）  #>
    if ($State.Job -and $State.Job.State -eq 'Running') { return }
    if ($State.Download) { return }
    if (-not $State.Scan) { return }
    $missing = [int]$State.Scan.coverMissing
    if ($missing -le 0) { return }
    if ($State.CoverRepairAt -and ((Get-Date) - [datetime]$State.CoverRepairAt).TotalMinutes -lt 10) { return }
    $State.CoverRepairAt = (Get-Date).ToString('s')
    try { [void](Repair-Covers -Limit 15) } catch { }
}
