#Requires -Version 5.1
<#
.SYNOPSIS
  把 URL 批量投递给迅雷（走 thunder:// 协议，等价于右键“使用迅雷下载”）。
  不下载、不等待，只负责入队。

.EXAMPLE
  # 单个
  .\thunder.ps1 -Url 'https://video.twimg.com/x.mp4'

.EXAMPLE
  # 从 pektino.ps1 产出的 CSV 里挑第 1、3、9 条
  .\thunder.ps1 -Csv .\daily.csv -Pick 1,3,9

.EXAMPLE
  # 先看会投递什么，不真发
  .\thunder.ps1 -Csv .\daily.csv -Pick 1,3 -DryRun

.EXAMPLE
  # 管道
  (.\pektino.ps1 -Limit 5 -Json | ConvertFrom-Json).url | .\thunder.ps1
#>
[CmdletBinding()]
param(
    [Parameter(ValueFromPipeline = $true, Position = 0)]
    [string[]]$Url,

    # pektino.ps1 产出的 CSV；配合 -Pick 使用
    [string]$Csv = '',

    # CSV 里的 idx 编号，例如 1,3,9-12
    [string]$Pick = '',

    # 只打印 thunder 链接，不调起迅雷
    [switch]$DryRun,

    # 已经投递过的 URL 也再投一次
    [switch]$Force,

    # 迅雷主程序（默认自动探测）
    [string]$ThunderExe = ''
)

begin {
    $sent = New-Object System.Collections.ArrayList
    $stateFile = Join-Path $PSScriptRoot '.sent-thunder.txt'
    $seen = @{}
    if ((Test-Path $stateFile) -and -not $Force) {
        Get-Content $stateFile -ErrorAction SilentlyContinue | ForEach-Object { if ($_ -ne '') { $seen[$_] = $true } }
    }

    function Resolve-Pick {
        param([string]$Spec)
        $idx = New-Object System.Collections.ArrayList
        foreach ($part in ($Spec -split ',')) {
            $p = $part.Trim()
            if ($p -match '^(\d+)\s*-\s*(\d+)$') {
                $a = [int]$Matches[1]; $b = [int]$Matches[2]
                if ($a -gt $b) { $t = $a; $a = $b; $b = $t }
                for ($k = $a; $k -le $b; $k++) { [void]$idx.Add($k) }
            } elseif ($p -match '^\d+$') {
                [void]$idx.Add([int]$p)
            }
        }
        $idx
    }
}

process {
    if ($Csv) {
        if (-not (Test-Path $Csv)) { throw "CSV 不存在: $Csv" }
        $rows = Import-Csv $Csv
        if ($Pick) {
            $want = Resolve-Pick $Pick
        } else {
            $want = @($rows | ForEach-Object { [int]$_.idx })
        }
        $picked = $rows | Where-Object { $want -contains [int]$_.idx }
        if (-not $picked) { throw "CSV 里没有匹配 -Pick 的条目" }
        foreach ($r in $picked) { [void]$sent.Add($r.url) }
    }

    if ($Url) {
        foreach ($u in $Url) {
            if ($u -and $u.Trim() -ne '') { [void]$sent.Add($u.Trim()) }
        }
    }
}

end {
    if ($sent.Count -eq 0) { Write-Warning '没有要投递的 URL'; return }

    if (-not $ThunderExe) {
        $cand = @(
            (Get-ItemProperty 'HKCU:\Software\Classes\thunder\shell\open\command' -ErrorAction SilentlyContinue).'(default)',
            'D:\software\Thunder\Program\Thunder.exe',
            'C:\Program Files (x86)\Thunder Network\Thunder\Program\Thunder.exe',
            'C:\Program Files\Thunder Network\Thunder\Program\Thunder.exe'
        ) | Where-Object { $_ }
        foreach ($c in $cand) {
            if ($c -match '^"?([^"]+\.exe)"?') { $p = $Matches[1] }
            if ($p -and (Test-Path $p)) { $ThunderExe = $p; break }
        }
    }

    $n = 0; $skip = 0
    $log = New-Object System.Collections.ArrayList
    foreach ($u in $sent) {
        if ($u -notmatch '^https?://') { Write-Warning "跳过非 http(s) URL: $u"; continue }
        if ($seen.ContainsKey($u)) {
            $skip++
            Write-Host "skip (已投递过) $u" -ForegroundColor DarkGray
            continue
        }
        $link = 'thunder://' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('AA' + $u + 'ZZ'))
        if ($DryRun) {
            Write-Host $link
        } else {
            Start-Process $link
        }
        [void]$log.Add($u)
        $n++
        $name = ($u -split '\?')[0]
        $name = $name.Substring($name.LastIndexOf('/') + 1)
        Write-Host ("[{0}] {1}" -f $(if ($DryRun) { 'dry' } else { 'sent' }), $name) -ForegroundColor Green
    }

    if (-not $DryRun -and $log.Count -gt 0) {
        Add-Content -Path $stateFile -Value ($log -join [Environment]::NewLine) -Encoding UTF8
    }

    Write-Host ("完成: 投递 {0} 条, 跳过 {1} 条" -f $n, $skip) -ForegroundColor Cyan
    if ($ThunderExe) {
        $running = @(Get-Process thunder -ErrorAction SilentlyContinue).Count
        Write-Host "迅雷进程数: $running ($ThunderExe)" -ForegroundColor DarkGray
    }
}
