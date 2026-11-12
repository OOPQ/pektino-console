#Requires -Version 5.1
<#
.SYNOPSIS
  把下载目录里已有的 mp4 反向录取进台账：按 token 去站点查详情，能查到的就入库。

.DESCRIPTION
  只认文件名 `<token>.mp4`。对每个 token 请求 https://pektino.com/zh-CN/movie/<token>：
    - 200 且有 VideoObject  -> 视为“网站上的视频”，输出一行（含时长/分辨率/观看/点赞/直链/封面）
    - 404 / 无 VideoObject  -> 跳过（不是这个站点的视频）
  封面顺带缓存在 -CoverDir。

.EXAMPLE
  .\import.ps1 -Dir 'D:\Downloads' -Out out\import.csv -CoverDir out\covers
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [string]$Out = '',
    # 只处理这些 token（不给就扫全目录）
    [string[]]$Tokens,
    [string]$CoverDir = '',
    [string]$ThumbDir = '',
    [int]$Threads = 8,
    [string]$ProgressFile = '',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
$Base = 'https://pektino.com'
$script:Started = Get-Date

function Write-ProgressFile {
    param([string]$Phase, [int]$Done, [int]$Total)
    if (-not $ProgressFile) { return }
    try {
        $elapsed = ((Get-Date) - $script:Started).TotalSeconds
        $speed = if ($elapsed -gt 0) { [math]::Round($Done / $elapsed, 2) } else { 0 }
        $eta = if ($speed -gt 0 -and $Total -gt $Done) { [math]::Round(($Total - $Done) / $speed, 1) } else { 0 }
        [pscustomobject]@{ phase = $Phase; done = $Done; total = $Total; elapsed = [math]::Round($elapsed, 1); speed = $speed; eta = $eta; at = (Get-Date -Format 'HH:mm:ss') } |
            ConvertTo-Json -Compress | Set-Content -Path $ProgressFile -Encoding UTF8
    } catch { }
}

function Get-LdJson {
    param([string]$Html)
    $out = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($Html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
        try { [void]$out.Add(($m.Groups[1].Value | ConvertFrom-Json)) } catch { }
    }
    $out
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

# ---------- 1. 确定要处理的 token ----------
if ($Tokens) {
    $targets = @($Tokens | Select-Object -Unique)
} else {
    if (-not (Test-Path $Dir)) { throw "目录不存在: $Dir" }
    $targets = @(
        Get-ChildItem -Path $Dir -Filter *.mp4 -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        ForEach-Object { ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -replace '\s*\(\d+\)\s*$', '' } |
        Where-Object { $_ } |
        Select-Object -Unique
    )
}
if (-not $targets -or $targets.Count -eq 0) { Write-Host '没有需要入库的文件'; return }

$total = $targets.Count
Write-Host "待核对 $total 个文件名 ..." -ForegroundColor Cyan
Write-ProgressFile 'scan' 0 $total

# ---------- 2. 并发查详情 ----------
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.MaxConnectionsPerServer = 16
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(40)
$client.DefaultRequestHeaders.UserAgent.ParseAdd($UA)

$htmls = @{}
$done = 0
$sw = [Diagnostics.Stopwatch]::StartNew()
for ($i = 0; $i -lt $total; $i += $Threads) {
    $end = [Math]::Min($i + $Threads - 1, $total - 1)
    $batch = @($targets[$i..$end])
    $tasks = @{}
    foreach ($t in $batch) {
        if ($t -notmatch '^[A-Za-z0-9_\-]+$') { $done++; continue }
        try { $tasks[$t] = $client.GetStringAsync("$Base/zh-CN/movie/$t") } catch { $done++ }
    }
    foreach ($k in @($tasks.Keys)) {
        try { $htmls[$k] = $tasks[$k].GetAwaiter().GetResult() } catch { $htmls[$k] = $null }
        $done++
    }
    $rate = if ($sw.Elapsed.TotalSeconds -gt 0) { [math]::Round($done / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
    Write-Host ("      核对 {0}/{1}  {2} 个/秒" -f $done, $total, $rate)
    Write-ProgressFile 'resolve' $done $total
}

# ---------- 3. 解析 + 组行 ----------
$rows = New-Object System.Collections.ArrayList
foreach ($t in $targets) {
    $html = $htmls[$t]
    if (-not $html) { continue }
    $vd = (Get-LdJson $html) | Where-Object { $_.'@type' -eq 'VideoObject' } | Select-Object -First 1
    if (-not $vd) { continue }
    $row = [pscustomobject]@{
        idx = ($rows.Count + 1); page = ''; rank = ''; token = $t
        duration = (Format-IsoDuration $vd.duration); seconds = (Get-DurationSeconds $vd.duration)
        res = ''; views = ''; likes = ''; uploaded = $vd.uploadDate
        cover = $vd.thumbnailUrl; url = $vd.contentUrl; page_url = "$Base/zh-CN/movie/$t"
    }
    if ($row.url -match '/vid/[^/]+/(\d+)x(\d+)/') { $row.res = "$($Matches[1])x$($Matches[2])" }
    foreach ($st in @($vd.interactionStatistic)) {
        if ($st.interactionType.'@type' -eq 'WatchAction') { $row.views = $st.userInteractionCount }
    }
    if ($html -match 'alt="お気に入り"[^>]*/>\s*<span[^>]*>(\d+)<') { $row.likes = $Matches[1] }
    [void]$rows.Add($row)
}

Write-Host "可入库 $($rows.Count)/$total 个（其余不是本站视频或已下线）" -ForegroundColor Cyan

# ---------- 4. 封面 ----------
if ($CoverDir -and $rows.Count -gt 0) {
    if (-not (Test-Path $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }
    $need = @($rows | Where-Object {
            $_.cover -and -not ((Test-Path (Join-Path $CoverDir ($_.token + '.jpg'))) -and ((Get-Item (Join-Path $CoverDir ($_.token + '.jpg'))).Length -gt 1024))
        })
    $totalCover = $need.Count
    $doneCover = 0
    if ($totalCover -gt 0) { Write-Host "      补齐封面 $totalCover 张 ..." -ForegroundColor Cyan }
    for ($i = 0; $i -lt $totalCover; $i += $Threads) {
        $end = [Math]::Min($i + $Threads - 1, $totalCover - 1)
        $batch = @($need[$i..$end])
        $tasks = @{}
        foreach ($r in $batch) {
            $dest = Join-Path $CoverDir ($r.token + '.jpg')
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
}

# ---------- 4.5 缩略图 ----------
if ($ThumbDir) {
    . (Join-Path $PSScriptRoot 'thumbs.ps1')
    if (-not (Test-Path $ThumbDir)) { New-Item -ItemType Directory -Path $ThumbDir -Force | Out-Null }
    $madeThumb = 0
    foreach ($r in $rows) {
        $src = Join-Path $CoverDir ($r.token + '.jpg')
        $dst = Join-Path $ThumbDir ($r.token + '.jpg')
        if (Test-Path $src) {
            if ((-not (Test-Path $dst)) -or ((Get-Item $dst).LastWriteTime -lt (Get-Item $src).LastWriteTime)) {
                if (New-Thumb -Source $src -Dest $dst) { $madeThumb++ }
            }
        }
    }
    if ($madeThumb -gt 0) { Write-Host "      生成缩略图 $madeThumb 张" -ForegroundColor DarkGray }
}

# ---------- 5. 输出 ----------
$columns = 'idx', 'page', 'rank', 'token', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'cover', 'url', 'page_url'
if ($Out) {
    $rows | Select-Object $columns | Export-Csv -Path $Out -NoTypeInformation -Encoding UTF8
    Write-Host "CSV -> $Out ($($rows.Count) 行)" -ForegroundColor Green
}
Write-ProgressFile 'done' $rows.Count $rows.Count
if ($Json) { $rows | ConvertTo-Json -Depth 4 }
