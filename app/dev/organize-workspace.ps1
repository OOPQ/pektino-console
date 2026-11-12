#Requires -Version 5.1
<#
.SYNOPSIS
  整理项目：把散落在项目根/项目里的 mp4 收进 media\。
.DESCRIPTION
  项目结构固定为：
    <project>\
      data\  media\  cache\covers\  cache\thumbs\
  这个脚本只做一件事：把项目根下遗漏的 mp4 / .mp4.part 移进 media\。
.EXAMPLE
  .\organize-workspace.ps1 -Project D:\data\pektino-project -DryRun
#>
param(
    [string]$Project = '',
    [switch]$DryRun,
    [int]$Port = 8791
)

$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $appRoot 'lib\project.ps1')

$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listening -and -not $DryRun) {
    Write-Host "控制台还在 $Port 上运行，先停掉再整理。" -ForegroundColor Red
    exit 1
}

if (-not $Project) { $Project = Get-LastProject }
if (-not $Project -or -not (Test-Path $Project)) {
    Write-Host '没有可用的项目，请用 -Project 指定。' -ForegroundColor Red
    exit 1
}

$paths = Get-ProjectPaths -Root $Project
Write-Host "项目: $($paths.ProjectRoot)" -ForegroundColor DarkGray
Write-Host "媒体: $($paths.Content)" -ForegroundColor DarkGray

$mp4 = @(Get-ChildItem -Path $paths.ProjectRoot -Filter '*.mp4' -File -ErrorAction SilentlyContinue)
$part = @(Get-ChildItem -Path $paths.ProjectRoot -Filter '*.mp4.part' -File -ErrorAction SilentlyContinue)
Write-Host ("项目根待整理：mp4 {0} 个，.part {1} 个" -f $mp4.Count, $part.Count)

if ($DryRun) {
    $mp4 | Select-Object -First 10 | ForEach-Object { Write-Host ("  [dry-run] {0}" -f $_.Name) }
    exit 0
}

if (-not (Test-Path $paths.Content)) { New-Item -ItemType Directory -Path $paths.Content -Force | Out-Null }
$moved = 0
foreach ($f in ($mp4 + $part)) {
    $dest = Join-Path $paths.Content $f.Name
    if (Test-Path -LiteralPath $dest) {
        $base = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        $ext = [System.IO.Path]::GetExtension($f.Name)
        $i = 1
        do { $dest = Join-Path $paths.Content ("{0} ({1}){2}" -f $base, $i, $ext); $i++ } while (Test-Path -LiteralPath $dest)
    }
    Move-Item -LiteralPath $f.FullName -Destination $dest
    $moved++
}
Write-Host "已移动 $moved 个文件到 media\" -ForegroundColor Green