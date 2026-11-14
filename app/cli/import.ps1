#Requires -Version 5.1
<#
.SYNOPSIS
  本地文件反向入库：按文件名解析来源，再调用对应源适配器查详情。

.DESCRIPTION
  文件名 = token（默认源是裸 id，其他源是 <source>@<id>）。
  逐个 token 调 Get-SourceDetail，拿得到 url 才入库；封面统一缓存为 <token>.jpg。
  适配器契约见 lib\sources.ps1。
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [string]$Out = '',
    [string[]]$Tokens,
    [string]$CoverDir = '',
    [string]$ThumbDir = '',
    [int]$Threads = 8,
    [string]$ProgressFile = '',
    [string]$Proxy = '',
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
. (Join-Path $Root 'lib\sources.ps1')
foreach ($f in @(Get-SourceAdapterFiles -Root $Root)) { . $f }
$null = Initialize-Sources -Root $Root

$started = Get-Date
if ($Tokens) {
    $targets = @($Tokens | Select-Object -Unique)
} else {
    if (-not (Test-Path -LiteralPath $Dir)) { throw "目录不存在: $Dir" }
    $targets = @(
        Get-ChildItem -Path $Dir -Filter *.mp4 -File -Recurse -Depth 4 -ErrorAction SilentlyContinue |
        ForEach-Object { ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -replace '\s*\(\d+\)\s*$', '' } |
        Where-Object { $_ } | Select-Object -Unique
    )
}
if (-not $targets.Count) { Write-Host '没有需要入库的文件'; return }

$ctx = New-SourceContext -Config ([pscustomobject]@{ proxy = $Proxy }) -Root $Root
$rows = New-Object System.Collections.ArrayList
$done = 0
foreach ($tk in $targets) {
    $sp = Split-ItemToken $tk
    $info = $null
    try { $info = Get-SourceDetail -Key $sp.source -Context $ctx -Id $sp.id } catch { }
    if ($info -and -not $info.error -and $info.url) {
        $info | Add-Member -NotePropertyName source -NotePropertyValue $sp.source -Force
        $info | Add-Member -NotePropertyName token -NotePropertyValue (New-ItemToken -Source $sp.source -Id $sp.id) -Force
        if (-not $info.title) { $info.title = [string]$sp.id }
        if ($info.download_headers -is [hashtable]) { $info.download_headers = ($info.download_headers | ConvertTo-Json -Compress) }
        [void]$rows.Add($info)
    }
    $done++
    Write-SourceProgress -Path $ProgressFile -Phase 'resolve' -Done $done -Total $targets.Count -Started $started
    Write-Host ("      核对 {0}/{1}" -f $done, $targets.Count)
}

Write-Host "可入库 $($rows.Count)/$($targets.Count) 个" -ForegroundColor Cyan

if ($CoverDir -and $rows.Count -gt 0) {
    if (-not (Test-Path -LiteralPath $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }
    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Proxy) { $handler.Proxy = New-Object System.Net.WebProxy($Proxy); $handler.UseProxy = $true }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(25)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')
    try {
        $n = 0
        foreach ($r in $rows) {
            $n++
            $dest = Join-Path $CoverDir ($r.token + '.jpg')
            if ($r.cover_url -and -not ((Test-Path -LiteralPath $dest) -and ((Get-Item -LiteralPath $dest).Length -gt 1024))) {
                try {
                    $bytes = $client.GetByteArrayAsync($r.cover_url).GetAwaiter().GetResult()
                    if ($bytes -and $bytes.Length -gt 512) { [System.IO.File]::WriteAllBytes($dest, $bytes) }
                } catch { }
            }
            Write-SourceProgress -Path $ProgressFile -Phase 'covers' -Done $n -Total $rows.Count -Started $started
        }
    } finally { try { $client.Dispose() } catch { } }
}

if ($ThumbDir) {
    . (Join-Path $Root 'lib\thumbs.ps1')
    if (-not (Test-Path -LiteralPath $ThumbDir)) { New-Item -ItemType Directory -Path $ThumbDir -Force | Out-Null }
    foreach ($r in $rows) {
        $src = Join-Path $CoverDir ($r.token + '.jpg')
        $dst = Join-Path $ThumbDir ($r.token + '.jpg')
        if ((Test-Path -LiteralPath $src) -and ((-not (Test-Path -LiteralPath $dst)) -or ((Get-Item -LiteralPath $dst).LastWriteTime -lt (Get-Item -LiteralPath $src).LastWriteTime))) {
            try { [void](New-Thumb -Source $src -Dest $dst) } catch { }
        }
    }
}

$columns = 'source', 'source_id', 'token', 'title', 'rank', 'page', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'url', 'page_url', 'cover_url', 'download_kind', 'download_headers'
if ($Out) {
    $rows | Select-Object $columns | Export-Csv -LiteralPath $Out -NoTypeInformation -Encoding UTF8
}
Write-SourceProgress -Path $ProgressFile -Phase 'done' -Done $rows.Count -Total $rows.Count -Started $started
if ($Json) { $rows | Select-Object $columns | ConvertTo-Json -Depth 4 }
