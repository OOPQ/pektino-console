#Requires -Version 5.1
<#
.SYNOPSIS
  兼容入口：调用通用抓取 cli\scrape.ps1 -Source pektino。
  保留旧的 CSV / Markdown / URL 列表 / JSON / MinWidth 参数，逻辑不再重复实现。
#>
[CmdletBinding()]
param(
    [ValidateSet('daily', 'weekly', 'monthly', 'all')][string]$Rank = 'daily',
    [int[]]$Page = @(1),
    [int]$Limit = 0,
    [int]$MinWidth = 0,
    [string]$Out = '',
    [string]$Markdown = '',
    [string]$UrlList = '',
    [string]$CoverDir = '',
    [string]$ThumbDir = '',
    [string]$KnownFile = '',
    [int]$Threads = 8,
    [string]$ProgressFile = '',
    [switch]$Json,
    [int]$DelayMs = 0,
    [int]$PageSize = 50
)

$ErrorActionPreference = 'Stop'
$scrape = Join-Path $PSScriptRoot 'scrape.ps1'

# 没有 -Out 且需要 Markdown/URL/JSON 时，先落一个临时 CSV
$needCsv = $Out -or $Markdown -or $UrlList -or $Json -or ($MinWidth -gt 0)
$csv = if ($Out) { $Out } else { Join-Path ([System.IO.Path]::GetTempPath()) ('pektino-' + [guid]::NewGuid().ToString('N') + '.csv') }
$splat = @{
    Source = 'pektino'; Rank = $Rank; Page = $Page; Out = $csv
    Threads = $Threads; PageSize = $PageSize
}
if ($Limit -gt 0) { $splat['Limit'] = $Limit }
if ($CoverDir) { $splat['CoverDir'] = $CoverDir }
if ($ThumbDir) { $splat['ThumbDir'] = $ThumbDir }
if ($KnownFile) { $splat['KnownFile'] = $KnownFile }
if ($ProgressFile) { $splat['ProgressFile'] = $ProgressFile }

& $scrape @splat
if (-not (Test-Path -LiteralPath $csv)) { throw '抓取没有产出 CSV' }

$rows = @(Import-Csv -LiteralPath $csv -Encoding UTF8)
if ($MinWidth -gt 0) {
    $rows = @($rows | Where-Object {
            $w = 0
            if ($_.res -match '^(\d+)x(\d+)$') { $w = [int]$Matches[1] }
            $w -ge $MinWidth
        })
    $rows | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8
}

if ($Markdown) {
    $md = @("# pektino $Rank 榜", "", "抓取时间: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  |  页: $($Page -join ',')  |  条目: $($rows.Count)", "",
        '| # | 页 | 排名 | 时长 | 分辨率 | 观看 | 点赞 | token | mp4 |', '|---|---|---|---|---|---|---|---|---|')
    $i = 0
    foreach ($r in $rows) {
        $i++
        $md += "| $i | $($r.page) | $($r.rank) | $($r.duration) | $($r.res) | $($r.views) | $($r.likes) | ``$($r.token)`` | $($r.url) |"
    }
    $md | Set-Content -Path $Markdown -Encoding UTF8
}
if ($UrlList) {
    ($rows | Where-Object { $_.url } | ForEach-Object { $_.url }) | Set-Content -Path $UrlList -Encoding UTF8
}
if ($Json) { $rows | ConvertTo-Json -Depth 4 }
if (-not $Out -and $csv -and (Test-Path -LiteralPath $csv)) { Remove-Item -LiteralPath $csv -Force -ErrorAction SilentlyContinue }
