#Requires -Version 5.1
<#
  抓取冒烟测试：每个榜单都实际抓一次，默认必须拿到 10 条有效数据。
  用法：
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File app\tests\scrape-smoke.ps1
    ... -Limit 10 -Ranks daily,weekly,monthly,all
  测试只写临时目录，不修改台账、不写正式数据。
#>
[CmdletBinding()]
param(
    [string]$Source = 'pektino',
    [string[]]$Ranks = @('daily', 'weekly', 'monthly', 'all'),
    [int]$Limit = 10,
    [int]$Threads = 4
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$scrape = Join-Path $root 'cli\scrape.ps1'
if (-not (Test-Path -LiteralPath $scrape)) { throw "找不到抓取脚本: $scrape" }

$results = New-Object System.Collections.ArrayList
$failed = 0
$baseTmp = Join-Path $env:TEMP ('pektino-scrape-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $baseTmp -Force | Out-Null

try {
    foreach ($rank in $Ranks) {
        $dir = Join-Path $baseTmp $rank
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        $out = Join-Path $dir 'out.csv'
        $progress = Join-Path $dir 'progress.json'
        $covers = Join-Path $dir 'covers'
        $thumbs = Join-Path $dir 'thumbs'
        $log = Join-Path $dir 'scrape.log'
        New-Item -ItemType Directory -Path $covers, $thumbs -Force | Out-Null

        $sw = [Diagnostics.Stopwatch]::StartNew()
        $err = ''
        try {
            & $scrape -Source $Source -Rank $rank -Page 1 -Limit $Limit -Threads $Threads `
                -Out $out -ProgressFile $progress -CoverDir $covers -ThumbDir $thumbs *> $log
        } catch {
            $err = $_.Exception.Message
        }
        $sw.Stop()

        $rows = @()
        if (Test-Path -LiteralPath $out) { $rows = @(Import-Csv -LiteralPath $out) }
        $tokens = @($rows | ForEach-Object { [string]$_.token } | Where-Object { $_ })
        $withUrl = @($rows | Where-Object { $_.url }).Count
        $unique = @($tokens | Sort-Object -Unique).Count
        $problem = ''
        if ($err) { $problem = "抓取异常: $err" }
        elseif ($rows.Count -ne $Limit) { $problem = "数量不是 $Limit（实际 $($rows.Count)）" }
        elseif ($unique -ne $Limit) { $problem = "token 不唯一（$unique/$Limit）" }
        elseif ($withUrl -ne $Limit) { $problem = "有 $($Limit - $withUrl) 条没有播放地址" }

        if ($problem) { $failed++ }
        [void]$results.Add([pscustomobject]@{
                rank     = $rank
                count    = $rows.Count
                unique   = $unique
                withUrl  = $withUrl
                seconds  = [math]::Round($sw.Elapsed.TotalSeconds, 1)
                ok       = (-not $problem)
                problem  = $problem
            })
        $status = if ($problem) { "FAIL: $problem" } else { 'OK' }
        Write-Host ("[{0}] {1}: {2} 条，{3}s，URL {4} 条 -> {5}" -f $Source, $rank, $rows.Count, [math]::Round($sw.Elapsed.TotalSeconds, 1), $withUrl, $status)
    }

    Write-Host ''
    $results | Format-Table rank, count, unique, withUrl, seconds, ok -AutoSize
    if ($failed -gt 0) {
        Write-Host "抓取冒烟测试失败：$failed 个榜单" -ForegroundColor Red
        exit 1
    }
    Write-Host "抓取冒烟测试通过：$($Ranks.Count) 个榜单均为 $Limit 条有效数据" -ForegroundColor Green
    exit 0
} finally {
    Remove-Item -LiteralPath $baseTmp -Recurse -Force -ErrorAction SilentlyContinue
}
