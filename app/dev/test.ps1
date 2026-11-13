quires -Version 5.1
<#
.SYNOPSIS
  控制台冒烟测试：验证服务可用、静态资源可访问、核心接口返回结构正确。
.DESCRIPTION
  -Start 时会用一个**独立项目目录**起临时服务：默认建在系统临时目录，测完自动删除，
  不会碰你正在用的项目（数据库/媒体/日志）。想指定目录就 -Project。
.EXAMPLE
  .\test.ps1                      # 测 127.0.0.1:8791（需先启动服务）
  .\test.ps1 -Port 8791 -Start    # 自己起一个临时服务再测（临时项目，跑完删除）
  .\test.ps1 -Start -Project D:\tmp\smoke   # 用指定目录当测试项目（不会自动删）
#>
param(
    [int]$Port = 8791,
    [switch]$Start,
    [string]$Project = ''
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$base = "http://127.0.0.1:$Port"
$pass = 0; $fail = 0
$proc = $null
$tempProject = ''

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
    # 端口必须真的空着：如果已经有控制台在跑，临时服务会退到 Port+1，
    # 而测试仍然打 $base → 会打到真实项目上（扫描、改配置、重置下载都可能发生）。
    $busy = $false
    $probe = New-Object System.Net.Sockets.TcpClient
    try { $probe.Connect('127.0.0.1', $Port); $busy = $true } catch { } finally { try { $probe.Close() } catch { } }
    if ($busy) {
        Write-Host "端口 $Port 已被占用（可能正有控制台在运行）。" -ForegroundColor Red
        Write-Host "请换一个端口：.\test.ps1 -Start -Port 8899；或先停止正在运行的服务。" -ForegroundColor Yellow        exit 2
    }
    if (-not $Project) {
        # 临时项目：和真实数据完全隔离。目录名故意带空格，
        # 这样每次跑测试都顺带覆盖「路径含空格」这条最容易坏的链路。
        $Project = Join-Path ([System.IO.Path]::GetTempPath()) ('pektino smoke ' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        $tempProject = $Project
    }
    Write-Host "启动临时服务 :$Port（项目 $Project）..." -ForegroundColor Cyan
    # 连「最近项目」记录一起隔离：console 把它写在 %APPDATA%\pektino\projects.json，
    # 不隔离的话每跑一次冒烟测试就会把临时项目塞进你真实的最近项目列表
    $savedAppData = $env:APPDATA
    $env:APPDATA = Join-Path $Project '.appdata'
    try {
        $console = Join-Path (Split-Path $root -Parent) 'console.ps1'
        $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$console`" -Port $Port -NoBrowser -Project `"$Project`""
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argLine -PassThru -WindowStyle Hidden
    } finally {
        $env:APPDATA = $savedAppData
    }
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
        # 必须用 --path-as-is：Invoke-WebRequest 会在客户端就把 ..\ 规范化掉，等于没测到服务端
        $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
        if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
        $code = (& $curl -s -o NUL -w '%{http_code}' --path-as-is "$base/static/js/../../../../windows/win.ini" 2>$null)
        $code = ([string]$code).Trim()
        if ($code -ne '404') { throw "期望 404，实际 $code" }
        "已拒绝 (404)"
    }

    Write-Host "`n== 核心接口 ==" -ForegroundColor Cyan
    $state = $null
    Test-Item 'GET /api/state' {
        $script:state = Invoke-RestMethod "$base/api/state" -TimeoutSec 15
        if (-not $state.stats) { throw '缺少 stats' }
        if (-not ($state.rows -is [array])) { throw 'rows 不是数组' }
        foreach ($k in 'total', 'new', 'done', 'downloaded', 'missing') {
            if ($null -eq $state.stats.$k) { throw "stats 缺少字段 $k" }
        }
        if ($null -eq $state.api) { throw '缺少 api 版本字段（前端靠它识别旧进程）' }
        "total=$($state.stats.total) rows=$($state.rows.Count) api=$($state.api)"
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
    Test-Item '临时项目隔离（不碰真实数据）' {
        if (-not $Project) { return '跳过（未用 -Project）' }
        $st = Invoke-RestMethod "$base/api/state" -TimeoutSec 15
        $got = [System.IO.Path]::GetFullPath([string]$st.project.root).TrimEnd('\')
        $want = [System.IO.Path]::GetFullPath($Project).TrimEnd('\')
        if ($got -ne $want) { throw "项目根不符：$got ≠ $want" }
        "root=$got"
    }
    Test-Item 'POST /api/scan（结构正确）' {
        $r = Invoke-RestMethod "$base/api/scan" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 20
        if (-not $r.ok) { throw '返回 ok=false' }
        foreach ($k in 'files', 'downloaded', 'changed') { if ($null -eq $r.$k) { throw "缺少 $k" } }
        "files=$($r.files) downloaded=$($r.downloaded) changed=$($r.changed)"
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

    Write-Host "`n== 边界与拒绝路径 ==" -ForegroundColor Cyan
    Test-Item 'POST 非法 JSON → 400' {
        # 用 curl 取原始状态码：Invoke-WebRequest 在 5.1 / 7 抛的异常类型不同，跨版本不好判断
        $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
        if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
        $code = (& $curl -s -o NUL -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data '{bad' "$base/api/mark" 2>$null)
        $code = ([string]$code).Trim()
        if ($code -ne '400') { throw "期望 400，实际 $code" }
        '400 Bad Request'
    }
    Test-Item 'POST /api/play 不存在的 token → ok=false（不抛 500）' {
        $r = Invoke-RestMethod "$base/api/play" -Method Post -ContentType 'application/json' `
            -Body (@{ token = '__nope__' } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'POST /api/delete 台账外 token → ok=false' {
        $r = Invoke-RestMethod "$base/api/delete" -Method Post -ContentType 'application/json' `
            -Body (@{ tokens = @('__nope__') } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'POST /api/config 非法代理 → ok=false' {
        $r = Invoke-RestMethod "$base/api/config" -Method Post -ContentType 'application/json' `
            -Body (@{ proxy = 'not a proxy !!' } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'POST /api/config 并发越界 → ok=false' {
        $r = Invoke-RestMethod "$base/api/config" -Method Post -ContentType 'application/json' `
            -Body (@{ concurrent = 99 } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'POST /api/config 并发 16 可接受' {
        $r = Invoke-RestMethod "$base/api/config" -Method Post -ContentType 'application/json' `
            -Body (@{ concurrent = 16 } | ConvertTo-Json) -TimeoutSec 10
        if (-not $r.ok) { throw "16 应被接受: $($r.error)" }
        if ([int]$r.concurrent -ne 16) { throw "读回不一致: $($r.concurrent)" }
        "concurrent=$($r.concurrent)"
    }
    Test-Item 'POST /api/scrape 非法榜单 → ok=false（不启动任务）' {
        $r = Invoke-RestMethod "$base/api/scrape" -Method Post -ContentType 'application/json' `
            -Body (@{ rank = 'bogus' } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item 'GET /api/project（结构正确）' {
        $r = Invoke-RestMethod "$base/api/project" -TimeoutSec 10
        if (-not $r.ok) { throw 'ok!=true' }
        foreach ($k in 'root', 'media', 'videoCount', 'exists') { if ($null -eq $r.project.$k) { throw "缺少 $k" } }
        "root=$($r.project.root) videoCount=$($r.project.videoCount)"
    }
    Test-Item 'GET /api/download（含 paused 字段）' {
        $r = Invoke-RestMethod "$base/api/download" -TimeoutSec 10
        if (-not $r.ok) { throw 'ok!=true' }
        if ($null -eq $r.download.paused) { throw '缺少 paused 字段' }
        "running=$($r.download.running) paused=$($r.download.paused)"
    }
    Test-Item 'POST /api/download/pause 空闲时 → ok=false' {
        $r = Invoke-RestMethod "$base/api/download/pause" -Method Post -ContentType 'application/json' `
            -Body (@{ on = $true } | ConvertTo-Json) -TimeoutSec 10
        if ($r.ok -ne $false) { throw '没有下载任务时应当返回 ok=false' }
        "ok=false error=$($r.error)"
    }
    Test-Item '无关的 powershell 不会被误判成下载器' {
        # 命令行里只是提到 download.ps1 的进程，以前会被当成下载器 → 永远「已有任务在跑」
        $decoy = Start-Process powershell -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep 8; # download.ps1') -PassThru -WindowStyle Hidden
        try {
            Start-Sleep -Milliseconds 700
            $r = Invoke-RestMethod "$base/api/download" -TimeoutSec 10
            if ($r.download.running) { throw '把无关进程误判成了下载器' }
            "running=false（诱饵 PID=$($decoy.Id)）"
        } finally {
            Stop-Process -Id $decoy.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Test-Item 'POST /api/download/reset（空闲时幂等）' {
        $r = Invoke-RestMethod "$base/api/download/reset" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 15
        if (-not $r.ok) { throw '应当返回 ok=true' }
        "ok=true killed=$($r.killed) reverted=$($r.reverted)"
    }
    Test-Item 'GET /api/events（SSE 握手）' {
        $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
        if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
        # 长连接不会自己结束，给它 2 秒然后看已经收到的头
        $out = (& $curl -s -i --max-time 2 "$base/api/events" 2>$null) -join "`n"
        if ($out -notmatch 'text/event-stream') { throw 'Content-Type 不是 text/event-stream' }
        if ($out -notmatch 'event: hello') { throw '没有收到 hello 事件' }
        'text/event-stream + hello'
    }
    Test-Item 'rows 按需下发（rowsRev 契约）' {
        if (-not $Start) { return '跳过（未用 -Start）' }
        $s0 = Invoke-RestMethod "$base/api/state" -TimeoutSec 15
        if (-not ($s0.rows -is [array])) { throw '首次请求必须带 rows' }
        if ($null -eq $s0.rowsRev) { throw '缺少 rowsRev' }
        # 造一个媒体文件，让台账真的变一次
        $media = Join-Path $Project 'media'
        [System.IO.File]::WriteAllBytes((Join-Path $media 'revprobe.mp4'), (New-Object byte[] 8))
        $imp = Invoke-RestMethod "$base/api/project/import" -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 20
        if ($imp.added -lt 1) { throw "识别没有新增（added=$($imp.added)）" }
        $s1 = Invoke-RestMethod "$base/api/state?rowsRev=$($s0.rowsRev)" -TimeoutSec 15
        if (-not ($s1.rows -is [array])) { throw '台账变化后应重新下发 rows' }
        if ($s1.rowsRev -le $s0.rowsRev) { throw "rowsRev 没有前进：$($s0.rowsRev) → $($s1.rowsRev)" }
        $s2 = Invoke-RestMethod "$base/api/state?rowsRev=$($s1.rowsRev)" -TimeoutSec 15
        if ($null -ne $s2.rows) { throw '台账未变时不应再下发 rows' }
        "rowsRev $($s0.rowsRev) → $($s1.rowsRev)，未变时省略 rows"
    }
}
finally {
    if ($proc) {
        Write-Host "`n停止临时服务..." -ForegroundColor DarkGray
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    }
    if ($tempProject -and (Test-Path $tempProject)) {
        try {
            Remove-Item -LiteralPath $tempProject -Recurse -Force -ErrorAction Stop
            Write-Host "已删除临时项目 $tempProject" -ForegroundColor DarkGray
        } catch {
            Write-Host "临时项目未删除（可手动删）：$tempProject" -ForegroundColor DarkYellow
        }
    }
}

Write-Host ("`n结果: {0} 通过, {1} 失败" -f $pass, $fail) -ForegroundColor $(if ($fail) { 'Red' } else { 'Green' })
exit $(if ($fail) { 1 } else { 0 })
