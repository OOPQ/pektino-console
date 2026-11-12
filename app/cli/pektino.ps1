#Requires -Version 5.1
<#
.SYNOPSIS
  抓 pektino.com 榜单，并发解析 mp4 直链 + 封面，支持多线程、进度文件、封面缓存。

.DESCRIPTION
  数据来源：
    榜单页  —— /zh-CN/movie/<token> 的 DOM 顺序即排名（JSON-LD ItemList 只覆盖前 10 名）
    详情页  —— JSON-LD VideoObject: contentUrl(mp4) / duration / thumbnailUrl / uploadDate / 观看数
    详情页  —— 点赞数从 alt="お気に入り" 后的 <span> 抠
  并发：System.Net.Http.HttpClient 批量并发（-Threads），不用 runspace，单进程内真并发 I/O。

.EXAMPLE
  .\pektino.ps1 -Limit 5

.EXAMPLE
  .\pektino.ps1 -Page 1,2,3 -Out daily.csv -CoverDir .\out\covers -Threads 8
#>
[CmdletBinding()]
param(
    [ValidateSet('daily', 'weekly', 'monthly', 'all')]
    [string]$Rank = 'daily',

    [int[]]$Page = @(1),

    [int]$Limit = 0,

    [int]$MinWidth = 0,

    [string]$Out = '',

    [string]$Markdown = '',

    [string]$UrlList = '',

    # 封面缓存目录（给了才下载，文件名 <token>.jpg）
    [string]$CoverDir = '',

    # 缩略图目录（给了就顺手生成 120px 小图）
    [string]$ThumbDir = '',

    # 增量：这里列出的 token 不重新抓详情页（一行一个）
    [string]$KnownFile = '',

    # 并发数
    [int]$Threads = 8,

    # 进度 JSON 文件（给控制台轮询）
    [string]$ProgressFile = '',

    [switch]$Json,

    # 兼容旧参数，已无用
    [int]$DelayMs = 0,

    [int]$PageSize = 50
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
$Base = 'https://pektino.com'
$RankPath = @{ daily = '/zh-CN'; weekly = '/zh-CN/weekly'; monthly = '/zh-CN/monthly'; all = '/zh-CN/all' }
$script:Started = Get-Date

function Write-ProgressFile {
    param([string]$Phase, [int]$Done, [int]$Total)
    if (-not $ProgressFile) { return }
    try {
        $elapsed = ((Get-Date) - $script:Started).TotalSeconds
        $speed = if ($elapsed -gt 0) { [math]::Round($Done / $elapsed, 2) } else { 0 }
        $eta = if ($speed -gt 0 -and $Total -gt $Done) { [math]::Round(($Total - $Done) / $speed, 1) } else { 0 }
        $obj = [pscustomobject]@{
            phase   = $Phase
            done    = $Done
            total   = $Total
            elapsed = [math]::Round($elapsed, 1)
            speed   = $speed
            eta     = $eta
            at      = (Get-Date -Format 'HH:mm:ss')
        }
        $dir = Split-Path $ProgressFile -Parent
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $obj | ConvertTo-Json -Compress | Set-Content -Path $ProgressFile -Encoding UTF8
    } catch { }
}

# ---------------- HTTP 客户端 ----------------
function New-HttpClient {
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 16
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    $c = New-Object System.Net.Http.HttpClient($handler)
    $c.Timeout = [TimeSpan]::FromSeconds(40)
    $c.DefaultRequestHeaders.UserAgent.ParseAdd($UA)
    return $c
}

function Get-HtmlSync {
    param($Client, [string]$Url)
    return $Client.GetStringAsync($Url).GetAwaiter().GetResult()
}

function Get-LdJson {
    param([string]$Html)
    $out = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($Html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
        try { [void]$out.Add(($m.Groups[1].Value | ConvertFrom-Json)) } catch { }
    }
    $out
}

function Get-Tokens {
    param([string]$Html)
    $seen = @{}
    $tokens = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($Html, '/zh-CN/movie/([A-Za-z0-9_\-]+)')) {
        $t = $m.Groups[1].Value
        if (-not $seen.ContainsKey($t)) { $seen[$t] = $true; [void]$tokens.Add($t) }
    }
    $tokens
}

function Format-IsoDuration {
    param([string]$Iso)
    if ($Iso -notmatch '^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$') { return $Iso }
    $h = [int]$Matches[1]; $m = [int]$Matches[2]; $s = [int]$Matches[3]
    if ($h -gt 0) { return ('{0}:{1:00}:{2:00}' -f $h, $m, $s) }
    return ('{0}:{1:00}' -f $m, $s)
}

function Get-DurationSeconds {
    param([string]$Iso)
    if ($Iso -match '^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$') {
        return ([int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3])
    }
    return 0
}

$client = New-HttpClient

# ---------------- 1. 榜单页 ----------------
$pages = @($Page | Sort-Object -Unique)
$targets = New-Object System.Collections.ArrayList
$globalSeen = @{}
Write-ProgressFile 'list' 0 $pages.Count
$pi = 0
foreach ($p in $pages) {
    $pi++
    if ($p -lt 1) { continue }
    $pageUrl = $Base + $RankPath[$Rank]
    if ($p -gt 1) { $pageUrl += "?page=$p" }
    Write-Host "[1/2] 榜单页 p$p : $pageUrl" -ForegroundColor Cyan
    try { $html = Get-HtmlSync -Client $client -Url $pageUrl } catch {
        Write-Warning "榜单页 p$p 抓取失败: $($_.Exception.Message)"
        continue
    }
    $tokens = @(Get-Tokens $html)
    Write-Host "      本页 token 数: $($tokens.Count)" -ForegroundColor DarkGray
    $i = 0
    foreach ($t in $tokens) {
        if ($i -ge $PageSize) { break }
        $i++
        if ($globalSeen.ContainsKey($t)) { continue }
        $globalSeen[$t] = $true
        [void]$targets.Add([pscustomobject]@{ page = $p; rank = (($p - 1) * $PageSize + $i); token = $t; url = "$Base/zh-CN/movie/$t" })
    }
    Write-ProgressFile 'list' $pi $pages.Count
}

if ($targets.Count -eq 0) { throw '没能从榜单页抽到任何 token，站点结构可能变了' }
if ($Limit -gt 0) { $targets = @($targets | Select-Object -First $Limit) }
Write-Host "      合计待解析: $($targets.Count) 条（$($pages.Count) 页，并发 $Threads）" -ForegroundColor DarkGray

# ---------------- 2. 详情页（并发，跳过已知 token） ----------------
$known = @{}
if ($KnownFile -and (Test-Path $KnownFile)) {
    Get-Content -Path $KnownFile -Encoding UTF8 | ForEach-Object {
        $t = $_.Trim()
        if ($t) { $known[$t] = $true }
    }
}
$skipCount = @($targets | Where-Object { $known.ContainsKey($_.token) }).Count
if ($skipCount -gt 0) { Write-Host "      增量模式：跳过 $skipCount 条已知 token" -ForegroundColor DarkGray }

$details = @{}   # token -> html（known 的为 $null）
$total = $targets.Count
$done = 0
$sw = [Diagnostics.Stopwatch]::StartNew()

for ($i = 0; $i -lt $total; $i += $Threads) {
    $end = [Math]::Min($i + $Threads - 1, $total - 1)
    $batch = @($targets[$i..$end])
    $tasks = @{}
    foreach ($t in $batch) {
        if ($known.ContainsKey($t.token)) { $details[$t.token] = $null; $done++; continue }
        try { $tasks[$t.token] = $client.GetStringAsync($t.url) } catch { }
    }
    foreach ($k in @($tasks.Keys)) {
        try { $details[$k] = $tasks[$k].GetAwaiter().GetResult() } catch { $details[$k] = $null }
        $done++
    }
    $elapsed = $sw.Elapsed.TotalSeconds
    $rate = if ($elapsed -gt 0) { $done / $elapsed } else { 0 }
    $eta = if ($rate -gt 0 -and $done -lt $total) { ($total - $done) / $rate } else { 0 }
    $pct = [math]::Round(100.0 * $done / $total)
    Write-Host ("      进度 {0,4}/{1} ({2,3}%)  {3,5:N1} 条/秒  剩余 {4,4:N0}s" -f $done, $total, $pct, $rate, $eta)
    Write-ProgressFile 'details' $done $total
}

# ---------------- 3. 解析 ----------------
$rows = New-Object System.Collections.ArrayList
foreach ($t in $targets) {
    $html = $details[$t.token]
    $row = [pscustomobject]@{
        idx = ($rows.Count + 1); page = $t.page; rank = $t.rank; token = $t.token
        duration = ''; seconds = 0; res = ''; width = 0; views = ''; likes = ''
        uploaded = ''; cover = ''; url = ''; page_url = $t.url
    }
    if ($html) {
        $vd = (Get-LdJson $html) | Where-Object { $_.'@type' -eq 'VideoObject' } | Select-Object -First 1
        if ($vd) {
            $row.duration = Format-IsoDuration $vd.duration
            $row.seconds = Get-DurationSeconds $vd.duration
            $row.uploaded = $vd.uploadDate
            $row.cover = $vd.thumbnailUrl
            $row.url = $vd.contentUrl
            foreach ($st in @($vd.interactionStatistic)) {
                if ($st.interactionType.'@type' -eq 'WatchAction') { $row.views = $st.userInteractionCount }
            }
        }
        if (-not $row.url) {
            $pat = 'https://video\.twimg\.com/[^"' + "'" + '\\ ]*?/' + [regex]::Escape($t.token) + '\.mp4[^"' + "'" + '\\ ]*'
            $mm = [regex]::Match($html, $pat)
            if ($mm.Success) { $row.url = $mm.Value }
        }
        if ($row.url -and $row.url -match '/vid/[^/]+/(\d+)x(\d+)/') {
            $row.res = "$($Matches[1])x$($Matches[2])"
            $row.width = [int]$Matches[1]
        }
        if (-not $row.likes -and $html -match 'alt="お気に入り"[^>]*/>\s*<span[^>]*>(\d+)<') {
            $row.likes = $Matches[1]
        }
    }
    [void]$rows.Add($row)
}

# ---------------- 4. 封面（并发下载并缓存） ----------------
if ($CoverDir) {
    if (-not (Test-Path $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }
    $covers = @($rows | Where-Object { $_.cover })
    $totalCover = $covers.Count
    $doneCover = 0
    Write-Host "      下载封面 $totalCover 张 ..." -ForegroundColor Cyan
    for ($i = 0; $i -lt $totalCover; $i += $Threads) {
        $end = [Math]::Min($i + $Threads - 1, $totalCover - 1)
        $batch = @($covers[$i..$end])
        $tasks = @{}
        foreach ($r in $batch) {
            $dest = Join-Path $CoverDir ($r.token + '.jpg')
            if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1024)) { $doneCover++; continue }
            try { $tasks[$r.token] = @{ task = $client.GetByteArrayAsync($r.cover); dest = $dest } } catch { $doneCover++ }
        }
        foreach ($k in @($tasks.Keys)) {
            try {
                $bytes = $tasks[$k].task.GetAwaiter().GetResult()
                if ($bytes -and $bytes.Length -gt 512) { [System.IO.File]::WriteAllBytes($tasks[$k].dest, $bytes) }
            } catch { }
            $doneCover++
        }
        Write-ProgressFile 'covers' $doneCover $totalCover
    }
    foreach ($r in $rows) {
        if ($r.token -and (Test-Path (Join-Path $CoverDir ($r.token + '.jpg')))) { $r | Add-Member covered $true -Force } else { $r | Add-Member covered $false -Force }
    }

    # 缩略图
    if ($ThumbDir) {
        . (Join-Path (Split-Path $PSScriptRoot -Parent) 'lib\thumbs.ps1')
        if (-not (Test-Path $ThumbDir)) { New-Item -ItemType Directory -Path $ThumbDir -Force | Out-Null }
        $madeThumb = 0
        foreach ($r in $rows) {
            $src = Join-Path $CoverDir ($r.token + '.jpg')
            $dst = Join-Path $ThumbDir ($r.token + '.jpg')
            if ((Test-Path $src) -and ((-not (Test-Path $dst)) -or ((Get-Item $dst).LastWriteTime -lt (Get-Item $src).LastWriteTime))) {
                if (New-Thumb -Source $src -Dest $dst) { $madeThumb++ }
            }
        }
        if ($madeThumb -gt 0) { Write-Host "      生成缩略图 $madeThumb 张" -ForegroundColor DarkGray }
    }
}

# ---------------- 5. 输出 ----------------
if ($MinWidth -gt 0) {
    $rows = @($rows | Where-Object { $_.width -ge $MinWidth })
    Write-Host "      过滤 width >= $MinWidth 后剩 $($rows.Count) 条" -ForegroundColor DarkGray
}

$columns = 'idx', 'page', 'rank', 'token', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'cover', 'url', 'page_url'

if ($Out) {
    $rows | Select-Object $columns | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
    Write-Host "CSV  -> $Out ($($rows.Count) 行)" -ForegroundColor Green
}
if ($Markdown) {
    $md = @("# pektino $Rank 榜", "", "抓取时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  |  页: $($pages -join ',')  |  条目: $($rows.Count)", "",
        '| # | 页 | 排名 | 时长 | 分辨率 | 观看 | 点赞 | token | mp4 |', '|---|---|---|---|---|---|---|---|---|')
    foreach ($r in $rows) {
        $md += "| $($r.idx) | $($r.page) | $($r.rank) | $($r.duration) | $($r.res) | $($r.views) | $($r.likes) | ``$($r.token)`` | $($r.url) |"
    }
    $md | Set-Content -Path $Markdown -Encoding UTF8
    Write-Host "MD   -> $Markdown" -ForegroundColor Green
}
if ($UrlList) {
    ($rows | Where-Object { $_.url } | ForEach-Object { $_.url }) | Set-Content -Path $UrlList -Encoding UTF8
    Write-Host "URLs -> $UrlList" -ForegroundColor Green
}

$ok = @($rows | Where-Object { $_.url }).Count
$totalSec = ($rows | Measure-Object -Property seconds -Sum).Sum
Write-ProgressFile 'done' $rows.Count $rows.Count
Write-Host ("完成: $ok/$($rows.Count) 命中 mp4，合计 {0:N2} 小时，用时 {1:N1}s" -f ($totalSec / 3600), $sw.Elapsed.TotalSeconds) -ForegroundColor Cyan

if ($Json) { $rows | ConvertTo-Json -Depth 4 } else { $rows | Select-Object idx, page, rank, duration, res, views, likes, token, url }
