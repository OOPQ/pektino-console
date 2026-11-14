#Requires -Version 5.1
<#
  启动前清理：关掉正在跑的旧控制台/媒体服务，避免 cmd 窗口和进程越堆越多。
  只处理命令行里带本 app 的 console.ps1 / media.ps1，不会误杀其他 PowerShell。
#>
param(
    [string]$AppRoot = 'D:\project\agent-browser\app',
    [int]$Port = 8791,
    [int]$MediaPort = 8831
)
$ErrorActionPreference = 'SilentlyContinue'
$rootFull = [System.IO.Path]::GetFullPath($AppRoot).TrimEnd('\')
$killed = New-Object System.Collections.Generic.List[int]

function Stop-Tree([int]$ProcessId) {
    if (-not $ProcessId -or $killed.Contains($ProcessId)) { return }
    $killed.Add($ProcessId)
    & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
}

$procs = @(Get-CimInstance Win32_Process)
$targets = @()
foreach ($p in $procs) {
    $cmd = [string]$p.CommandLine
    if (-not $cmd) { continue }
    if ($cmd -notmatch '[\\/](console|media)\.ps1') { continue }
    if ($cmd -notlike "*$rootFull*") { continue }
    $targets += $p
}
# 端口监听者（兜底，防止命令行被截断）
foreach ($port in @($Port, $MediaPort)) {
    foreach ($c in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
        $p = $procs | Where-Object { $_.ProcessId -eq $c.OwningProcess } | Select-Object -First 1
        if ($p -and $p.CommandLine -and ($p.CommandLine -like "*$rootFull*")) { $targets += $p }
    }
}

foreach ($p in @($targets | Sort-Object ProcessId -Unique)) {
    $parent = $procs | Where-Object { $_.ProcessId -eq $p.ParentProcessId } | Select-Object -First 1
    # 老 start.cmd 的 cmd 窗口也一起关掉；只认命令行带 start.cmd 的父进程
    if ($parent -and $parent.Name -match 'cmd\.exe' -and $parent.CommandLine -match 'start\.cmd') {
        Stop-Tree ([int]$parent.ProcessId)
    }
    Stop-Tree ([int]$p.ProcessId)
}

for ($i = 0; $i -lt 20; $i++) {
    $busy = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    if (-not $busy.Count) { break }
    Start-Sleep -Milliseconds 250
}
if ($killed.Count -gt 0) { "已关闭旧进程: $($killed -join ', ')" }
