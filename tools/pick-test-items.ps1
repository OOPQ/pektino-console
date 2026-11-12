#Requires -Version 5.1
<#
.SYNOPSIS
  挑几条「最短」的待下载条目做测试，避免拿几百 MB 的长片浪费时间。
.DESCRIPTION
  从本地 /api/state 里取 status=new 的条目，按时长升序取前 N 条，输出 token / 时长 / 分辨率 / URL。
  只读，不会触发下载。
.EXAMPLE
  .\pick-test-items.ps1                 # 默认 3 条
  .\pick-test-items.ps1 -Count 5 -Port 8791
  .\pick-test-items.ps1 -MaxSeconds 120 # 只要 2 分钟以内的
#>
param(
    [int]$Count = 3,
    [int]$Port = 8791,
    [int]$MaxSeconds = 0,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'
$base = "http://127.0.0.1:$Port"

try {
    $state = Invoke-RestMethod "$base/api/state" -TimeoutSec 20
} catch {
    Write-Host "连不上 $base，先启动控制台。" -ForegroundColor Red
    exit 1
}

$rows = @($state.rows | Where-Object {
        $_.status -eq 'new' -and $_.url -and $_.seconds
    } | Sort-Object { [int]$_.seconds })

if ($MaxSeconds -gt 0) {
    $rows = @($rows | Where-Object { [int]$_.seconds -le $MaxSeconds })
}

$picked = @($rows | Select-Object -First $Count)
if (-not $picked.Count) {
    Write-Host '没有符合条件的待下载条目。' -ForegroundColor Yellow
    exit 0
}

if ($Json) {
    $picked | Select-Object token, duration, seconds, res, url | ConvertTo-Json -Depth 3
    exit 0
}

Write-Host ("最短的 {0} 条待下载：" -f $picked.Count) -ForegroundColor Cyan
foreach ($r in $picked) {
    Write-Host ("  {0}  {1,8}  {2,-10} {3}" -f $r.token, $r.duration, $r.res, $r.url)
}
Write-Host ''
Write-Host '用法示例：' -ForegroundColor DarkGray
Write-Host ('  $toks = (.\pick-test-items.ps1 -Count 3 -Json | ConvertFrom-Json).token') -ForegroundColor DarkGray
