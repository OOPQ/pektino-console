#Requires -Version 5.1
<#
.SYNOPSIS
  常用套路一键完成：日榜前 N 页 -> 一个 CSV（+Markdown+合并链接清单）-> 可选一次性丢进迅雷。

.DESCRIPTION
  默认：日榜（daily）第 1、2、3 页，共 150 条，产出到 tools\out\ 下：
    daily-<时间戳>.csv        表格（含排名/时长/分辨率/观看/点赞/直链）
    daily-<时间戳>.md         人看的 Markdown 表
    daily-<时间戳>.urls.txt   合并后的纯链接清单（一行一条）
  加 -Send 就一次性把这批链接全部投进迅雷（迅雷里生成 N 个任务）。

.EXAMPLE
  .\daily.ps1                       # 只抓，不下载
  .\daily.ps1 -Send                 # 抓完直接丢迅雷
  .\daily.ps1 -Pages 1,2 -Send
  .\daily.ps1 -Pages 1 -Send -DryRun   # 只看会投什么
  .\daily.ps1 -Rank weekly -Pages 1 -MinWidth 1920 -Send
#>
[CmdletBinding()]
param(
    [ValidateSet('daily', 'weekly', 'monthly', 'all')]
    [string]$Rank = 'daily',

    [int[]]$Pages = @(1, 2, 3),

    [int]$MinWidth = 0,

    # 抓完直接把链接投进迅雷
    [switch]$Send,

    # 配合 -Send：只打印 thunder:// 链接，不真的调起迅雷
    [switch]$DryRun,

    # 已投递过的也再投一遍
    [switch]$Force,

    # 输出目录
    [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $here 'out' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$csv = Join-Path $OutDir "$Rank-p$($Pages -join '-')-$stamp.csv"
$md = Join-Path $OutDir "$Rank-p$($Pages -join '-')-$stamp.md"
$urls = Join-Path $OutDir "$Rank-p$($Pages -join '-')-$stamp.urls.txt"

$pektino = Join-Path $here 'pektino.ps1'
$rows = & $pektino -Rank $Rank -Page $Pages -MinWidth $MinWidth -Out $csv -Markdown $md -UrlList $urls

if (-not (Test-Path $csv)) { throw "CSV 没生成: $csv" }
$count = @(Import-Csv $csv).Count
Write-Host ''
Write-Host "产出:" -ForegroundColor Cyan
Write-Host "  $csv  ($count 行)"
Write-Host "  $md"
Write-Host "  $urls"
Write-Host ''

if (-not $Send) {
    Write-Host "未投递迅雷。要下载这 $count 条，加 -Send；只想核对链接用 -Send -DryRun" -ForegroundColor Yellow
    return
}

if ($count -eq 0) { Write-Warning 'CSV 里没有条目，跳过投递'; return }

$thunder = Join-Path $here 'thunder.ps1'
Write-Host "投递 $count 条到迅雷 ..." -ForegroundColor Cyan
& $thunder -Csv $csv -DryRun:$DryRun -Force:$Force
