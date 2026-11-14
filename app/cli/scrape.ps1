#Requires -Version 5.1
<#
.SYNOPSIS
  通用抓取入口：按源适配器抓取，输出统一 CSV。
  适配器契约见 lib\sources.ps1 与 sources\<key>.ps1。
#>
[CmdletBinding()]
param(
    [string]$Source = 'pektino',
    [string]$Rank = '',
    [int[]]$Page = @(1),
    [int]$Limit = 0,
    [int]$Threads = 8,
    [string]$Out = '',
    [string]$ProgressFile = '',
    [string]$CoverDir = '',
    [string]$ThumbDir = '',
    [string]$KnownFile = '',
    [string]$Proxy = '',
    [int]$PageSize = 50,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $Root 'lib\sources.ps1')
foreach ($f in @(Get-SourceAdapterFiles -Root $Root)) { . $f }
$null = Initialize-Sources -Root $Root

$started = Get-Date
$options = @{
    rank       = $Rank
    pages      = @($Page)
    limit      = $Limit
    threads    = $Threads
    pageSize   = $PageSize
    progressFile = $ProgressFile
    started    = $started
}
if ($KnownFile -and (Test-Path -LiteralPath $KnownFile)) {
    $known = @()
    foreach ($line in (Get-Content -LiteralPath $KnownFile -Encoding UTF8)) {
        $t = $line.Trim()
        if (-not $t) { continue }
        $sp = Split-ItemToken $t
        if ($sp.source -eq (Resolve-SourceKey $Source)) { $known += $sp.id }
    }
    $options.knownTokens = @($known)
}

$ctx = New-SourceContext -Config ([pscustomobject]@{ proxy = $Proxy }) -Root $Root
$rows = @(Invoke-SourceScrape -Key $Source -Context $ctx -Options $options)

# 规范化：补 source/token/标题兜底
$items = New-Object System.Collections.ArrayList
foreach ($r in $rows) {
    $r | Add-Member -NotePropertyName source -NotePropertyValue (Resolve-SourceKey $Source) -Force
    $r | Add-Member -NotePropertyName token -NotePropertyValue (New-ItemToken -Source $Source -Id $r.source_id) -Force
    if (-not $r.title) { $r.title = [string]$r.source_id }
    if ($r.download_headers -is [hashtable]) {
        $r.download_headers = ($r.download_headers | ConvertTo-Json -Compress)
    }
    [void]$items.Add($r)
}

# 封面缓存（适配器只给 URL，下载逻辑统一）
if ($CoverDir -and $items.Count -gt 0) {
    if (-not (Test-Path -LiteralPath $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }
    $need = @($items | Where-Object { $_.cover_url })
    $doneCover = 0
    if ($need.Count -gt 0) {
        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
        if ($Proxy) { $handler.Proxy = New-Object System.Net.WebProxy($Proxy); $handler.UseProxy = $true }
        $client = New-Object System.Net.Http.HttpClient($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(25)
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')
        try {
            for ($i = 0; $i -lt $need.Count; $i += $Threads) {
                $end = [Math]::Min($i + $Threads - 1, $need.Count - 1)
                $tasks = @{}
                foreach ($r in $need[$i..$end]) {
                    $dest = Join-Path $CoverDir ($r.token + '.jpg')
                    if ((Test-Path -LiteralPath $dest) -and ((Get-Item -LiteralPath $dest).Length -gt 1024)) { $doneCover++; continue }
                    try { $tasks[$r.token] = @{ task = $client.GetByteArrayAsync($r.cover_url); dest = $dest } } catch { $doneCover++ }
                }
                foreach ($k in @($tasks.Keys)) {
                    try {
                        $bytes = $tasks[$k].task.GetAwaiter().GetResult()
                        if ($bytes -and $bytes.Length -gt 512) { [System.IO.File]::WriteAllBytes($tasks[$k].dest, $bytes) }
                    } catch { }
                    $doneCover++
                }
                Write-SourceProgress -Path $ProgressFile -Phase 'covers' -Done $doneCover -Total $need.Count -Started $started
            }
        } finally { try { $client.Dispose() } catch { } }
    }
    if ($ThumbDir) {
        . (Join-Path $Root 'lib\thumbs.ps1')
        if (-not (Test-Path -LiteralPath $ThumbDir)) { New-Item -ItemType Directory -Path $ThumbDir -Force | Out-Null }
        foreach ($r in $items) {
            $src = Join-Path $CoverDir ($r.token + '.jpg')
            $dst = Join-Path $ThumbDir ($r.token + '.jpg')
            if ((Test-Path -LiteralPath $src) -and ((-not (Test-Path -LiteralPath $dst)) -or ((Get-Item -LiteralPath $dst).LastWriteTime -lt (Get-Item -LiteralPath $src).LastWriteTime))) {
                try { [void](New-Thumb -Source $src -Dest $dst) } catch { }
            }
        }
    }
}

$columns = 'source', 'source_id', 'token', 'title', 'rank', 'page', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'url', 'page_url', 'cover_url', 'download_kind', 'download_headers'
if ($Out) {
    $items | Select-Object $columns | Export-Csv -LiteralPath $Out -NoTypeInformation -Encoding UTF8
}
Write-SourceProgress -Path $ProgressFile -Phase 'done' -Done $items.Count -Total $items.Count -Started $started
if ($Json) { $items | Select-Object $columns | ConvertTo-Json -Depth 4 }
