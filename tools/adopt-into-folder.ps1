#Requires -Version 5.1
<#
.SYNOPSIS
  把数据（库/封面/缩略图/日志）搬进指定文件夹，让「一个文件夹装下所有东西」。
.DESCRIPTION
  典型场景：把 tools\H 这种下载目录直接变成工作区 —— 里面既有 mp4，也有 data.db、covers、thumbs。
  搬完之后整个文件夹拷到移动硬盘 / 换盘符，改一次路径即可继续用。

  注意：必须在控制台停止时运行（数据库不能在被占用时搬）。
.EXAMPLE
  .\adopt-into-folder.ps1 -Target 'D:\tools\tools\H'
  .\adopt-into-folder.ps1 -Target D:\pektino -DryRun
#>
param(
    [Parameter(Mandatory = $true)][string]$Target,
    [string]$Source = '',
    [switch]$DryRun,
    [int]$Port = 8791
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$projectRoot = Split-Path $root -Parent

# 1. 服务必须停着
$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening -and -not $DryRun) {
    Write-Host "控制台还在 $Port 上运行，先停掉再搬（否则数据库文件被占用）。" -ForegroundColor Red
    exit 1
}

if (-not $Source) { $Source = Join-Path $root 'out' }
$Target = [System.IO.Path]::GetFullPath($Target)
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Path $Target -Force | Out-Null }

Write-Host "源目录: $Source" -ForegroundColor DarkGray
Write-Host "目标目录: $Target" -ForegroundColor DarkGray

# 2. 逐项复制（大的目录用 robocopy 更稳，但没有就退回 Copy-Item）
function Copy-ItemSmart {
    param([string]$From, [string]$To)
    if (-not (Test-Path $From)) { return 'skip' }
    if (Test-Path $To) {
        # 目标已有同名文件/目录：先备份，避免旧文件混进来
        if (-not $DryRun) {
            $bak = "$To.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss')
            Move-Item -Path $To -Destination $bak -Force
        } else { return 'exists→将备份' }
    }
    if ($DryRun) { return 'dry-run' }
    if ((Get-Item $From).PSIsContainer) {
        $robo = (Get-Command robocopy.exe -ErrorAction SilentlyContinue).Source
        if ($robo) {
            & $robo $From $To /E /NFL /NDL /NJH /NJS /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy 失败 ($LASTEXITCODE): $From" }
        } else {
            Copy-Item -Path $From -Destination $To -Recurse -Force
        }
    } else {
        Copy-Item -Path $From -Destination $To -Force
    }
    return 'copied'
}

$items = @(
    @{ name = 'data.db'; from = (Join-Path $Source 'data.db'); to = (Join-Path $Target 'data.db') },
    @{ name = 'ledger.csv'; from = (Join-Path $Source 'ledger.csv'); to = (Join-Path $Target 'ledger.csv') },
    @{ name = 'covers'; from = (Join-Path $Source 'covers'); to = (Join-Path $Target 'covers') },
    @{ name = 'thumbs'; from = (Join-Path $Source 'thumbs'); to = (Join-Path $Target 'thumbs') },
    @{ name = 'logs'; from = (Join-Path $Source 'logs'); to = (Join-Path $Target 'logs') }
)

$report = foreach ($it in $items) {
    $r = Copy-ItemSmart -From $it.from -To $it.to
    [pscustomobject]@{ 项目 = $it.name; 结果 = $r }
}
$report | Format-Table -AutoSize | Out-String | Write-Host

# 3. 更新 workspace.json：数据目录 = 目标，下载目录 = 该目录本身
$wsFile = Join-Path $projectRoot 'workspace.json'
$dataDir = $Target
$absRoot = [System.IO.Path]::GetFullPath($projectRoot).TrimEnd('\')
if ($Target.StartsWith($absRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    $dataDir = $Target.Substring($absRoot.Length).TrimStart('\')
}

$cfg = [ordered]@{
    version     = 1
    name        = 'pektino'
    dataDir     = $dataDir
    downloadDir = 'videos'
    coversDir   = 'covers'
    thumbsDir   = 'thumbs'
    logsDir     = 'logs'
    exportsDir  = 'exports'
    createdAt   = (Get-Date).ToString('s')
}
if ($DryRun) {
    Write-Host "`n[dry-run] 将写入 $wsFile :" -ForegroundColor Yellow
    ($cfg | ConvertTo-Json -Depth 4) | Write-Host
    exit 0
}

($cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $wsFile -Encoding UTF8 -Force
Write-Host "已更新工作区配置: $wsFile" -ForegroundColor Green
Write-Host "  数据目录 = $Target" -ForegroundColor Green
Write-Host "  下载目录 = <workspace>\videos（mp4 放子目录，避免和库/封面混在一起）" -ForegroundColor Green
Write-Host ''
Write-Host '下一步：重新启动控制台，确认台账条数与封面正常。旧数据没有删除，确认无误后可手动清理。' -ForegroundColor Cyan
