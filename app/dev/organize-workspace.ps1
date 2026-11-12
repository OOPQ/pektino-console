#Requires -Version 5.1
<#
.SYNOPSIS
  整理工作区：把根目录下的 mp4 收进 content\ 子目录，库/封面/日志保持在外层。
.DESCRIPTION
  目标结构：
    <workspace>\
      data.db  ledger.csv
      covers\  thumbs\  logs\  exports\
      content\            ← 所有 mp4 放这里（内容目录指向它）
      其他自定义文件夹    ← 不动

  好处：文件名不和工作区里的配置/库混在一起，加新类型（音乐、字幕）也好扩展。
.EXAMPLE
  .\organize-workspace.ps1 -DryRun
  .\organize-workspace.ps1
#>
param(
    [string]$Workspace = '',
    [switch]$DryRun,
    [int]$Port = 8791
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$projectRoot = Split-Path $root -Parent

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening -and -not $DryRun) {
    Write-Host "控制台还在 $Port 上运行，先停掉再整理。" -ForegroundColor Red
    exit 1
}

# 定位工作区
$wsFile = Join-Path $projectRoot 'workspace.json'
if (-not $Workspace) {
    if (Test-Path $wsFile) {
        $cfg = Get-Content $wsFile -Raw -Encoding UTF8 | ConvertFrom-Json
        $d = [string]$cfg.dataDir
        $Workspace = if ([System.IO.Path]::IsPathRooted($d)) { $d } else { Join-Path $projectRoot $d }
    } else {
        $Workspace = Join-Path $projectRoot 'out'
    }
}
$Workspace = [System.IO.Path]::GetFullPath($Workspace)
$contentDirPath = Join-Path $Workspace 'content'

Write-Host "工作区: $Workspace" -ForegroundColor DarkGray
Write-Host "视频目录: $contentDirPath" -ForegroundColor DarkGray

$mp4 = @(Get-ChildItem -Path $Workspace -Filter '*.mp4' -File -ErrorAction SilentlyContinue)
$part = @(Get-ChildItem -Path $Workspace -Filter '*.mp4.part' -File -ErrorAction SilentlyContinue)
Write-Host ("根目录待整理：mp4 {0} 个，.part {1} 个" -f $mp4.Count, $part.Count)

if ($DryRun) {
    $mp4 | Select-Object -First 10 | ForEach-Object { Write-Host ("  [dry-run] {0}" -f $_.Name) }
    if ($mp4.Count -gt 10) { Write-Host ("  ... 还有 {0} 个" -f ($mp4.Count - 10)) }
    Write-Host ''
    Write-Host '[dry-run] 将把 workspace.json 的 contentDir 设为 videos' -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path $contentDirPath)) { New-Item -ItemType Directory -Path $contentDirPath -Force | Out-Null }

$moved = 0; $skipped = 0
foreach ($f in ($mp4 + $part)) {
    $dest = Join-Path $contentDirPath $f.Name
    if (Test-Path -LiteralPath $dest) {
        # 目标已有同名文件：保留两个，加序号
        $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        $ext = [System.IO.Path]::GetExtension($f.Name)
        $i = 1
        do {
            $dest = Join-Path $contentDirPath ("{0} ({1}){2}" -f $base, $i, $ext)
            $i++
        } while (Test-Path -LiteralPath $dest)
    }
    Move-Item -LiteralPath $f.FullName -Destination $dest
    $moved++
}
Write-Host "已移动 $moved 个文件到 content\" -ForegroundColor Green

# 更新 workspace.json + config.json
$cfg = $null
if (Test-Path $wsFile) { $cfg = Get-Content $wsFile -Raw -Encoding UTF8 | ConvertFrom-Json }
if (-not $cfg) { $cfg = [pscustomobject]@{ version = 1; name = 'pektino'; dataDir = $Workspace } }
$cfg | Add-Member -NotePropertyName contentDir -NotePropertyValue 'content' -Force
$cfg | Add-Member -NotePropertyName dataDir -NotePropertyValue ([string]$cfg.dataDir) -Force
($cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $wsFile -Encoding UTF8 -Force

$cfgFile = Join-Path $Workspace 'config.json'
$appCfg = [ordered]@{}
if (Test-Path $cfgFile) {
    try {
        $old = Get-Content $cfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($p in $old.PSObject.Properties) { $appCfg[$p.Name] = $p.Value }
    } catch { }
}
$appCfg['contentDir'] = 'content'     # 相对工作区，跟着目录走
($appCfg | ConvertTo-Json -Depth 4) | Set-Content -Path $cfgFile -Encoding UTF8 -Force

Write-Host ''
Write-Host "已更新配置：contentDir = videos（相对工作区）" -ForegroundColor Green
Write-Host '重新启动控制台即可。' -ForegroundColor Cyan
