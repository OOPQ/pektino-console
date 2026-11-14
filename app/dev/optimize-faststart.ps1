#Requires -Version 5.1
<#
  把 mp4 的 moov 从文件尾移到文件头（faststart），解决浏览器播放/拖动要先下完整个文件的问题。
  用法：
    powershell -ExecutionPolicy Bypass -File app\dev\optimize-faststart.ps1
    powershell -ExecutionPolicy Bypass -File app\dev\optimize-faststart.ps1 -MediaDir "D:\project\pektino-project\media" -WhatIf
#>
param(
    [string]$MediaDir = '',
    [string]$Ffmpeg = '',
    [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
$project = $env:PEKTINO_PROJECT
if (-not $project) {
    if (Test-Path -LiteralPath 'D:\project\pektino-project') { $project = 'D:\project\pektino-project' }
    else { $project = Split-Path -Parent $app }
}
if (-not $MediaDir) { $MediaDir = Join-Path $project 'media' }
if (-not (Test-Path -LiteralPath $MediaDir)) { throw "媒体目录不存在: $MediaDir" }
if (-not $Ffmpeg) {
    $cfgPath = Join-Path $project 'data\config.json'
    if (Test-Path -LiteralPath $cfgPath) {
        try { $Ffmpeg = [string](Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8 | ConvertFrom-Json).ffmpegPath } catch { }
    }
    if (-not $Ffmpeg) { $Ffmpeg = 'D:\software\oopz\ffmpeg.exe' }
}
if (-not (Test-Path -LiteralPath $Ffmpeg)) { throw "ffmpeg 不存在: $Ffmpeg" }

function Test-MoovFront([string]$Path) {
    $fs = [IO.File]::OpenRead($Path)
    try {
        $len = [int][Math]::Min([int64]2097152, $fs.Length)
        $buf = New-Object byte[] $len
        [void]$fs.Read($buf, 0, $len)
        return ([Text.Encoding]::ASCII.GetString($buf)).IndexOf('moov') -ge 0
    } finally { $fs.Dispose() }
}

$files = @(Get-ChildItem -LiteralPath $MediaDir -Filter '*.mp4' -File -Recurse -ErrorAction SilentlyContinue)
$todo = @($files | Where-Object { -not (Test-MoovFront $_.FullName) })
"扫描 $($files.Count) 个 mp4，moov 在尾部 $($todo.Count) 个"
if (-not $todo.Count) { return }
if ($WhatIf) { $todo | ForEach-Object { "将优化: $($_.FullName)" }; return }

foreach ($f in $todo) {
    $tmp = $f.FullName + '.fs.tmp.mp4'
    "处理 $($f.Name) ($([math]::Round($f.Length / 1MB, 1)) MB)"
    & $Ffmpeg -y -hide_banner -loglevel error -i $f.FullName -map 0 -c copy -movflags +faststart $tmp
    if (-not (Test-Path -LiteralPath $tmp)) { "  失败: ffmpeg 没有输出"; continue }
    if ((Get-Item -LiteralPath $tmp).Length -lt ($f.Length * 0.9)) { "  失败: 输出明显变小"; Remove-Item -LiteralPath $tmp -Force; continue }
    Move-Item -LiteralPath $tmp -Destination $f.FullName -Force
    "  完成 moovFront=$(Test-MoovFront $f.FullName)"
}
