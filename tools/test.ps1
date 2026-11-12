#Requires -Version 5.1
<#
.SYNOPSIS
  控制台冒烟测试：验证服务可用、静态资源可访问、核心接口返回结构正确。
.EXAMPLE
  .\test.ps1                 # 测 127.0.0.1:8791（需先启动服务）
  .\test.ps1 -Port 8791 -Start   # 自己起一个临时服务再测
#>
param(
    [int]$Port = 8791,
    [switch]$Start
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$base = "http://127.0.0.1:$Port"
$pass = 0; $fail = 0
$proc = $null

function Test-Item($name, $scriptBlock) {
    try {
        $msg = & $scriptBlock
        Write-Host ("  [PASS] {0} {1}" -f $name, $msg) -ForegroundColor Green
        $script:pass++
    } catch {
        Write-Host ("  [FAIL] {0} :: {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
        $script:fail++
    }
}

if ($Start) {
    Write-Host "启动临时服务 :$Port ..." -ForegroundColor Cyan
    $proc = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'console.ps1'), '-Port', $Port, '-NoBrowser') `
        -PassThru -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline) {
        try {
            $null = Invoke-WebRequest "$base/api/state" -UseBasicParsing -TimeoutSec 2
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
}

try {
    Write-Host "`n== 基础可用性 ==" -ForegroundColor Cyan
    Test-Item 'GET /' {
        $r = Invoke-WebRequest "$base/" -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -ne 200) { throw "状态码 $($r.StatusCode)" }
        if ($r.Content -notmatch 'pektino') { throw '页面内容不包含 pektino' }
        "200 text/html ($([math]::Round($r.RawContentLength/1KB,1))KB)"
    }
    Test-Item 'GET /static/js/main.js' {
        $r = Invoke-WebRequest "$base/static/js/main.js" -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -ne 200) { throw "状态码 $($r.StatusCode)" }
        if ($r.Content -notmatch 'import') { throw '不是 ES module' }
        "200 application/javascript"
    }
    Test-Item 'GET /static/app.css' {
        $r = Invoke-WebRequest "$base/static/app.css" -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -ne 200) { throw "状态码 $($r.StatusCode)" }
        "200 text/css"
    }
    Test-Item '静态资源路径穿越被拒' {
        try {
            $r = Invoke-WebRequest "$base/static/js/../../../windows/win.ini" -UseBasicParsing -TimeoutSec 10
            throw "未被拒绝，返回 $($r.StatusCode)"
        } catch [System.Net.WebException] {
            $code = [int]$_.Exception.Response.StatusCode
            "已拒绝 ($code)"
        }
    }

    Write-Host "`n== 核心接口 ==" -ForegroundColor Cyan
    $state = $null
    Test-Item 'GET /api/state' {
        $script:state = Invoke-RestMethod "$base/api/state" -TimeoutSec 15
        if (-not $state.stats) { throw '缺少 stats' }
        if (-not ($state.rows -is [array])) { throw 'rows 不是数组' }
        foreach ($k in 'total', 'new', 'sent', 'done', 'downloaded', 'missing') {
            if ($null -eq $state.stats.$k) { throw "stats 缺少字段 $k" }
        }
        "total=$($state.stats.total) rows=$($state.rows.Count)"
    }
    Test-Item 'GET /api/cover（无 token 不应 500）' {
        try {
            $r = Invoke-WebRequest "$base/api/cover?token=__nope__" -UseBasicParsing -TimeoutSec 10
            "200 ($($r.RawContentLength) 字节)"
        } catch [System.Net.WebException] {
            $code = [int]$_.Exception.Response.StatusCode
            if ($code -ge 500) { throw "服务器错误 $code" }
            "已拒绝 ($code)"
        }
    }
    Test-Item 'GET /api/export' {
        $r = Invoke-WebRequest "$base/api/export" -UseBasicParsing -TimeoutSec 20
        if ($r.StatusCode -ne 200) { throw "状态码 $($r.StatusCode)" }
        "200 ($([math]::Round($r.RawContentLength/1KB,1))KB)"
    }
    Test-Item 'POST /api/mark（非法参数应返回 ok=false）' {
        $r = Invoke-RestMethod "$base/api/mark" -Method Post -ContentType 'application/json' `
            -Body (@{ tokens = @(); status = 'bogus' } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'POST /api/rate 往返' {
        if (-not $state -or -not $state.rows.Count) { return '跳过（没有条目）' }
        $tk = $state.rows[0].token
        $set = Invoke-RestMethod "$base/api/rate" -Method Post -ContentType 'application/json' `
            -Body (@{ tokens = @($tk); value = 5 } | ConvertTo-Json) -TimeoutSec 10
        if (-not $set.ok) { throw "写入失败: $($set.error)" }
        $after = Invoke-RestMethod "$base/api/state" -TimeoutSec 15
        $row = $after.rows | Where-Object { $_.token -eq $tk } | Select-Object -First 1
        if ("$($row.rating)" -ne '5') { throw "读回不一致: $($row.rating)" }
        $null = Invoke-RestMethod "$base/api/rate" -Method Post -ContentType 'application/json' `
            -Body (@{ tokens = @($tk); value = 0 } | ConvertTo-Json) -TimeoutSec 10
        "写入 5 → 读回 5 → 已还原"
    }
}
finally {
    if ($proc) {
        Write-Host "`n停止临时服务..." -ForegroundColor DarkGray
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ("`n结果: {0} 通过, {1} 失败" -f $pass, $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit $(if ($fail) { 1 } else { 0 })
