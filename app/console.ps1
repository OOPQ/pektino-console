#Requires -Version 5.1
<#
.SYNOPSIS
  本地面板：一个极简 HTTP 服务（TcpListener，仅回环），把 HTML 控制台和抓取/投递/台账串起来。

.DESCRIPTION
  打开 http://127.0.0.1:8791/ 就是控制台。
  服务端只做四件事：读台账、抓榜单入库、把选中的条目投进迅雷、改条目状态。
  台账 out\ledger.csv 以 token 去重，已投/已完成的不会被重复下载。

.EXAMPLE
  .\console.ps1                 # 默认 8791，自动开浏览器
  .\console.ps1 -Port 9000 -NoBrowser
#>
[CmdletBinding()]
param(
    [int]$Port = 8791,
    [string]$Root = '',
    [switch]$NoBrowser,
    # 出错/结束时停住窗口，方便双击启动时看到原因
    [switch]$PauseOnError,
    # 项目目录（数据单元）；留空则用最近项目/交互选择
    [string]$Project = '',
    # 强制显示项目选择器（像 IDE 的欢迎页）
    [switch]$Pick,
    # 无人值守/自动化时跳过首次目录询问
    [switch]$NoPrompt,
    # 重启：先结束端口上的旧控制台进程，再正常启动（改完代码不用手动关窗口）
    [switch]$Restart
)

# $PSScriptRoot 在 param 默认值里可能还是空的（powershell -File 启动时），这里显式兜底
if (-not $Root) {
    if ($PSScriptRoot) { $Root = $PSScriptRoot }
    elseif ($MyInvocation.MyCommand.Path) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
    else { $Root = (Get-Location).Path }
}
if (-not (Test-Path (Join-Path $Root 'lib\ledger.ps1'))) {
    Write-Host "找不到 ledger.ps1，Root=$Root" -ForegroundColor Red
    if ($PauseOnError) { Read-Host '按回车关闭' | Out-Null }
    exit 1
}

$ErrorActionPreference = 'Stop'

# ---------- 运行环境守卫 ----------
# System.Data.SQLite 是 .NET Framework 的混合模式程序集，PowerShell 7（.NET Core）加载不了；
# 而且只带了 x64 的 SQLite.Interop.dll，32 位 PowerShell 也跑不起来。
# 与其等到 Initialize-Store 抛一个看不懂的异常，不如在这里说清楚。
if ($PSVersionTable.PSEdition -eq 'Core') {
    Write-Host ''
    Write-Host '  请用 Windows PowerShell 启动（powershell.exe），不要用 PowerShell 7 / pwsh。' -ForegroundColor Red
    Write-Host '  双击 start.cmd 即可，或在 Windows PowerShell 里运行 .\app\console.ps1' -ForegroundColor DarkGray
    Write-Host ''
    if ($PauseOnError) { Read-Host '按回车关闭' | Out-Null }
    exit 1
}
if (-not [Environment]::Is64BitProcess) {
    Write-Host ''
    Write-Host '  请用 64 位 Windows PowerShell 启动：本程序只带了 x64 的 SQLite 组件。' -ForegroundColor Red
    Write-Host ''
    if ($PauseOnError) { Read-Host '按回车关闭' | Out-Null }
    exit 1
}

# ---------- 重启：结束端口上的旧实例 ----------
# 改完 app 代码后，旧进程不会自动加载新路由；start.cmd -Restart 可以直接换掉它。
if ($Restart) {
    try {
        $old = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($old) {
            $op = Get-CimInstance Win32_Process -Filter "ProcessId=$($old.OwningProcess)" -ErrorAction SilentlyContinue
            if ($op -and $op.CommandLine -and ($op.CommandLine -match 'console\.ps1')) {
                Write-Host "  结束旧控制台 PID=$($op.ProcessId)…" -ForegroundColor DarkGray
                & taskkill.exe /PID $op.ProcessId /T /F 2>&1 | Out-Null
                Start-Sleep -Milliseconds 900
            }
        }
    } catch { }
}

$script:StartedAt = Get-Date
. (Join-Path $Root 'lib\ledger.ps1')
. (Join-Path $Root 'lib\project.ps1')
. (Join-Path $Root 'lib\sources.ps1')
foreach ($srcFile in @(Get-SourceAdapterFiles -Root $Root)) { . $srcFile }
$null = Initialize-Sources -Root $Root

function Test-ConsoleAlive {
    <#  判断端口上跑的是不是「我们」：只回 {"ok":true} 的别的服务不能算，
        否则会误以为已有实例、直接退出，而真正该启动的新实例起不来  #>
    param([int]$P)
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$P/api/state" -TimeoutSec 2
        return ([bool]$r.ok -and $null -ne $r.stats -and $null -ne $r.project)
    } catch { return $false }
}

# ---------- 项目：程序只读，数据在项目文件夹里（IDE 模型） ----------
$WS = Resolve-ProjectRoot -Path $Project -Pick:$Pick -NoPrompt:$NoPrompt
$script:WS = $WS

# 已经有实例在跑：直接开浏览器退出，别碰数据库/文件（重复启动会争抢 SQLite 和 .part）
if (Test-ConsoleAlive $Port) {
    $liveUrl = "http://127.0.0.1:$Port/"
    Write-Host "控制台已经在运行：$liveUrl" -ForegroundColor Green
    Write-Host '（如需重启，先关掉已有的那个窗口/进程）' -ForegroundColor DarkGray
    if (-not $NoBrowser) { Start-Process $liveUrl }
    if ($PauseOnError) { Start-Sleep -Seconds 1 }
    return
}
Write-Host "  项目: $($WS.ProjectRoot)" -ForegroundColor DarkGray

# SQLite 存储（事实来源）；首次启动自动从 ledger.csv 迁移
[void](Initialize-Store -Root $Root -DataDir $WS.DataDir)
$migrated = Import-CsvIntoStore -CsvPath $WS.LedgerCsv
# 每日库备份 + WAL 合并
try { Invoke-DbMaintenance -Backup -Checkpoint } catch { }

$Pektino = Join-Path $Root 'cli\pektino.ps1'
$ScrapeScript = Join-Path $Root 'cli\scrape.ps1'
$LedgerPath = $WS.LedgerCsv
$WebDir = Join-Path $Root 'web'
$HtmlPath = Join-Path $WebDir 'index.html'
$TmpCsv = Join-Path $WS.DataDir '.scrape.csv'
$CoverDir = $WS.Covers
$ThumbDir = $WS.Thumbs
$ProgressFile = Join-Path $WS.DataDir 'progress.json'
$KnownFile = Join-Path $WS.DataDir '.known.txt'
$ClientLog = Join-Path $WS.Logs 'client.log'
$DlScript = Join-Path $Root 'cli\download.ps1'
$DlQueue = Join-Path $WS.DataDir '.queue.json'
$DlProgress = Join-Path $WS.DataDir 'download.json'
$DlCancel = Join-Path $WS.DataDir '.dl-cancel.json'
$DlPause = Join-Path $WS.DataDir '.dl-pause'
$DlPauseItems = Join-Path $WS.DataDir '.dl-pause-items.json'
$DlAdd = Join-Path $WS.DataDir '.dl-add.json'

# ---------- 内存态 ----------
# 配置只管代理/并发；内容目录固定在项目里（$WS.Content），不再可配置
$Config = Read-Config -Root $Root -DataDir $WS.DataDir -DefaultContentDir $WS.Content
$Config | Add-Member -NotePropertyName contentDir -NotePropertyValue $WS.Content -Force
$State = @{
    Ledger = @(Read-Ledger -Path $LedgerPath)
    Log    = New-Object System.Collections.ArrayList
    Busy   = $false
    Files  = @{ Files = @{}; Partial = @(); Dir = $Config.contentDir; Exists = $false }
    Scan   = $null
    Job    = $null
    Rev    = 0
    Download = $null
    Metrics = @{
        total        = 0
        sumMs        = 0.0
        maxMs        = 0
        maxPath      = ''
        slow         = New-Object System.Collections.ArrayList
        clientErrors = New-Object System.Collections.ArrayList
        clientWarns  = 0
    }
}
# 老数据里时长解析失败（seconds=0）的，用 duration 回算（必须放在 $State 初始化之后）
try { $fixedSec = Repair-Durations -LedgerPath $LedgerPath; if ($fixedSec -gt 0) { Write-Host "  修正时长 $fixedSec 条" -ForegroundColor DarkGray } } catch { Write-Host "  （时长修正跳过：$($_.Exception.Message)）" -ForegroundColor DarkYellow }
# 旧状态（sent 已投递 / downloading 下载中）合并回 new / done
try { $moved = Repair-Statuses; if ($moved -gt 0) { Write-Host "  状态迁移 $moved 条（已投递/下载中 → 待下载）" -ForegroundColor DarkGray } } catch { Write-Host "  （状态迁移跳过：$($_.Exception.Message)）" -ForegroundColor DarkYellow }
try { $sf = Repair-SourceFields; if ($sf -gt 0) { Write-Host "  来源字段补齐 $sf 条（→ pektino）" -ForegroundColor DarkGray } } catch { Write-Host "  （来源字段补齐跳过：$($_.Exception.Message)）" -ForegroundColor DarkYellow }
$script:SseClients = New-Object System.Collections.ArrayList

# ---------- 分层加载 ----------
# transport: Send-Bytes / Send-Json / Read-Request / Push-Sse
# actions  : Get-Stats / Invoke-Scan / 任务与抓取 / 收藏·评分·观看 / 播放 / 删除 / 投递
. (Join-Path $Root 'server\transport.ps1')
. (Join-Path $Root 'server\actions.ps1')
. (Join-Path $Root 'server\covers.ps1')

function Touch-State { $State.Rev++ }

function Write-Log {
    param([string]$Kind, [string]$Message)
    [void]$State.Log.Add([pscustomobject]@{
            time    = (Get-Date -Format 'HH:mm:ss')
            kind    = $Kind
            message = $Message
        })
    while ($State.Log.Count -gt 200) { $State.Log.RemoveAt(0) }
}

function Write-ClientLog {
    <#
      前端上报：写 client.log（JSON Lines），超过 1MB 轮转一次。
    #>
    param([string]$Level, [string]$Message, [string]$Url = '', $Ms = $null, [string]$Stack = '')
    $rec = [pscustomobject]@{
        t     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff')
        level = $Level
        msg   = $Message
        url   = $Url
        ms    = $Ms
        stack = $Stack
    }
    try {
        if ((Test-Path $ClientLog) -and ((Get-Item $ClientLog).Length -gt 1MB)) {
            Move-Item $ClientLog "$ClientLog.1" -Force
        }
        Add-Content -Path $ClientLog -Value ($rec | ConvertTo-Json -Compress -Depth 3) -Encoding UTF8
    } catch { }
    return $rec
}























function Handle-Request {
    param($Stream, $Req, $Client)

    $path = $Req.Path
    $method = $Req.Method

    # ---- SSE：状态变更推送（连上后由 Push-Sse 周期写） ----
    if ($method -eq 'GET' -and $path -eq '/api/events') {
        $hdr = "HTTP/1.1 200 OK`r`nContent-Type: text/event-stream; charset=utf-8`r`nCache-Control: no-cache`r`nConnection: keep-alive`r`nX-Accel-Buffering: no`r`n`r`n"
        $hb = [Text.Encoding]::ASCII.GetBytes($hdr)
        $Stream.Write($hb, 0, $hb.Length)
        $hello = [Text.Encoding]::UTF8.GetBytes("retry: 2000`n`nevent: hello`ndata: {`"rev`":$($State.Rev)}`n`n")
        $Stream.Write($hello, 0, $hello.Length)
        $Stream.Flush()
        [void]$script:SseClients.Add([pscustomobject]@{
                Stream = $Stream
                Socket = $Client
                Rev    = $State.Rev
                Beat   = (Get-Date)
            })
        Write-Log 'sse' "客户端接入（当前 $($script:SseClients.Count) 个）"
        return $true
    }

    if ($method -eq 'GET' -and ($path -eq '/' -or $path -eq '/index.html')) {
        if (-not (Test-Path $HtmlPath)) { Send-Bytes -Stream $Stream -Bytes ([Text.Encoding]::UTF8.GetBytes('web/index.html missing')) -ContentType 'text/plain'; return }
        $html = Get-Content $HtmlPath -Raw -Encoding UTF8
        Send-Bytes -Stream $Stream -Bytes ([Text.Encoding]::UTF8.GetBytes($html)) -ContentType 'text/html; charset=utf-8'
        return
    }

    # 静态资源：/static/app.css、/static/app.js
    if ($method -eq 'GET' -and $path.StartsWith('/static/')) {
        $rel = $path.Substring(8).Replace('/', '\')
        if ($rel -match '^[A-Za-z0-9_\-\.\\]+$' -and $rel -notmatch '\.\.') {
            $file = Join-Path $WebDir $rel
            if (Test-Path $file) {
                $ext = [System.IO.Path]::GetExtension($file).TrimStart('.').ToLower()
                $ct = switch ($ext) {
                    'css' { 'text/css; charset=utf-8' }
                    'js' { 'application/javascript; charset=utf-8' }
                    'png' { 'image/png' }
                    'svg' { 'image/svg+xml' }
                    default { 'application/octet-stream' }
                }
                Send-Bytes -Stream $Stream -Bytes ([System.IO.File]::ReadAllBytes($file)) -ContentType $ct -ExtraHeaders @{ 'Cache-Control' = 'no-store' }
                return
            }
        }
        Send-Bytes -Stream $Stream -Bytes ([byte[]]@()) -ContentType 'text/plain' -Status '404 Not Found'
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/state') {
        if ($State.Job) { try { Update-Job } catch { } }
        # 扫盘与 CSV 快照都不在这里做：它们在主循环的空闲轮次里跑（见文件末尾），
        # 请求路径上只读内存态，目录/台账再大也不拉长本次轮询。

        # 行数据按需下发：前端带 rowsRev（它手里的行版本），只有台账真的变了才回 rows。
        # 下载进度那种每 2 秒一次的 rev 变化不会再重传几千行 JSON。
        $ledgerRev = Get-LedgerRev
        $knownRows = -1
        $hasRowsRev = $Req.Query.ContainsKey('rowsRev')
        if ($hasRowsRev) { try { $knownRows = [int]$Req.Query['rowsRev'] } catch { $knownRows = -1 } }

        $payload = [ordered]@{
            ok       = $true
            # 接口版本：前端用它判断服务端是不是旧进程（旧版没有这个字段）
            api      = 4
            rev      = $State.Rev
            rowsRev  = $ledgerRev
            stats    = Get-Stats
            log      = @($State.Log | Select-Object -Last 40)
            job      = (Get-JobInfo)
            download = (Get-DownloadInfo)
            project  = (Get-ProjectSummary -Paths $WS)
            settings = [pscustomobject]@{ proxy = [string]$Config.proxy; concurrent = $(if ($Config.concurrent) { [int]$Config.concurrent } else { 3 }); ffmpegPath = [string]$Config.ffmpegPath }
            sources  = @(Get-Sources | ForEach-Object {
                    [pscustomobject]@{
                        key = $_.key; name = $_.name; capabilities = @($_.capabilities)
                        siteUrl = $_.siteUrl; pageSize = $_.pageSize
                        supportsPages = [bool]$_.supportsPages; incremental = [bool]$_.incremental
                        ranks = @($_.ranks | ForEach-Object { [pscustomobject]@{ key = $_.key; label = $_.label } })
                    }
                })
            # 浏览器内播放用的媒体服务地址（前端拼成 <base>/<token>.mp4?k=<key>）
            media    = $(if ($State.Media) { [pscustomobject]@{ base = [string]$State.Media.Base; key = [string]$State.Media.Key } } else { $null })
            # 上次退出时没下完的条目（重启后前端提示「继续下载」）
            resume   = $(if ($State.Resume) { [pscustomobject]@{ count = [int]$State.Resume.count; tokens = @($State.Resume.tokens) } } else { $null })
            metrics  = [pscustomobject]@{
                total        = $State.Metrics.total
                avgMs        = if ($State.Metrics.total -gt 0) { [math]::Round($State.Metrics.sumMs / $State.Metrics.total, 1) } else { 0 }
                maxMs        = $State.Metrics.maxMs
                maxPath      = $State.Metrics.maxPath
                slow         = @($State.Metrics.slow)
                clientErrors = @($State.Metrics.clientErrors)
                clientWarns  = $State.Metrics.clientWarns
                uptime       = [math]::Round(((Get-Date) - $script:StartedAt).TotalMinutes, 1)
            }
        }
        if (-not $hasRowsRev -or $knownRows -ne $ledgerRev) { $payload['rows'] = @($State.Ledger) }
        Send-Json -Stream $Stream -Object $payload
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/cover') {
        $tk = [string]$Req.Query['token']
        $full = ($Req.Query['full'] -eq '1')
        if (Test-SafeTokenName $tk) {
            $thumb = Join-Path $ThumbDir ($tk + '.jpg')
            $orig = Join-Path $CoverDir ($tk + '.jpg')
            $file = $null
            if (-not $full -and (Test-Path -LiteralPath $thumb)) { $file = $thumb }
            elseif (Test-Path -LiteralPath $orig) { $file = $orig }
            if ($file) {
                Send-Bytes -Stream $Stream -Bytes ([System.IO.File]::ReadAllBytes($file)) -ContentType 'image/jpeg' -ExtraHeaders @{ 'Cache-Control' = 'public, max-age=604800' }
                return
            }
        }
        Send-Bytes -Stream $Stream -Bytes ([byte[]]@()) -ContentType 'image/jpeg' -Status '404 Not Found'
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/project') {
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; project = (Get-ProjectSummary -Paths $WS) })
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/collections') {
        $ctk = [string]$Req.Query['token']
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; items = @(Get-Collections -Token $ctk) })
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/collections/items') {
        $cid = 0
        try { $cid = [int]$Req.Query['id'] } catch { }
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; id = $cid; tokens = @(Get-CollectionTokens -Id $cid) })
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/download') {
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; download = (Get-DownloadInfo) })
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/download/preview') {
        Send-Json -Stream $Stream -Object (Get-DownloadPreview)
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/export') {
        $tmp = Join-Path (Split-Path $LedgerPath -Parent) '.export.csv'
        Write-CsvSnapshot -Rows @($State.Ledger) -Path $tmp -Force
        # 空台账时文件是空的，Get-Content -Raw 返回 $null，
        # 直接丢给 UTF8.GetBytes 会抛异常 → 导出接口 500
        $txt = Get-Content $tmp -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($null -eq $txt) { $txt = '' }
        $bytes = [Text.Encoding]::UTF8.GetBytes([string]$txt)
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Send-Bytes -Stream $Stream -Bytes $bytes -ContentType 'text/csv; charset=utf-8' -ExtraHeaders @{ 'Content-Disposition' = 'attachment; filename=ledger.csv' }
        return
    }

    if ($method -eq 'POST') {
        $body = @{}
        $bodyBad = $false
        if ($Req.Body) {
            try {
                $parsed = $Req.Body | ConvertFrom-Json
                foreach ($p in $parsed.PSObject.Properties) { $body[$p.Name] = $p.Value }
            } catch { $bodyBad = $true }
        }
        if ($bodyBad) {
            Send-Json -Stream $Stream -Object @{ ok = $false; error = '请求体不是合法 JSON' } -Status '400 Bad Request'
            return
        }
        switch ($path) {
            '/api/download' {
                $forceRetry = [bool]$body.force
                $hasTokensKey = $body.ContainsKey('tokens')
                $tokens = @()
                if ($hasTokensKey) { $tokens = @($body.tokens | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
                if ($hasTokensKey -and $tokens.Count -eq 0) {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = '没选条目' }
                    return
                }
                $status = if ($body.status) { [string]$body.status } else { 'new' }
                if (@('new', 'failed') -notcontains $status) {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = "不认识的状态: $status" }
                    return
                }
                $limit = 0
                if ($body.limit) { try { $limit = [int]$body.limit } catch { $limit = 0 } }
                if ($limit -lt 0) { $limit = 0 }
                if ($limit -gt 5000) { $limit = 5000 }
                $r = Start-Download -Tokens $tokens -Status $status -Limit $limit -Force:$forceRetry
                Send-Json -Stream $Stream -Object ([pscustomobject]$r)
                return
            }
            '/api/check-url' {
                $tk = [string]$body.token
                $row = $State.Ledger | Where-Object { $_.token -eq $tk } | Select-Object -First 1
                if (-not $row) { Send-Json -Stream $Stream -Object @{ ok = $false; error = '没有这个 token' }; return }
                $code = Get-UrlStatusCode -Url $row.url
                Send-Json -Stream $Stream -Object @{ ok = $true; code = $code; url = $row.url }
                return
            }
            '/api/refresh-url' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                # 每条都要同步抓详情页（单条超时 25 秒），一次最多刷新 20 条，避免把主循环按死
                $requested = $tokens.Count
                if ($requested -gt 20) {
                    $tokens = @($tokens | Select-Object -First 20)
                    Write-Log 'refresh' "一次最多刷新 20 条（本次请求 $requested 条，只处理前 20 条）"
                }
                Send-Json -Stream $Stream -Object ([pscustomobject](Refresh-ItemUrls -Tokens $tokens))
                return
            }
            '/api/project/open' {
                try { Start-Process -FilePath explorer.exe -ArgumentList (ConvertTo-QuotedArg $WS.ProjectRoot); Send-Json -Stream $Stream -Object @{ ok = $true; path = $WS.ProjectRoot } }
                catch { Send-Json -Stream $Stream -Object @{ ok = $false; error = $_.Exception.Message } }
                return
            }
            '/api/project/import' {
                $r = Import-ProjectFiles -Paths $WS -Rows $State.Ledger -SavePath $LedgerPath
                if ($r.added -gt 0) { $State.Ledger = @($r.rows) }
                Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; added = $r.added; skipped = $r.skipped })
                return
            }
            '/api/covers/repair' {
                # 只解析一次；上限 200（每条都要抓详情页 + 封面，主循环是单线程）
                $limit = 40
                if ($null -ne $body.limit) {
                    $n = 0
                    if ([int]::TryParse([string]$body.limit, [ref]$n) -and $n -gt 0 -and $n -le 200) { $limit = $n }
                }
                $r = Repair-Covers -Limit $limit
                Send-Json -Stream $Stream -Object ([pscustomobject]$r)
                return
            }
            '/api/download/cancel' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                if ($tokens.Count) { Send-Json -Stream $Stream -Object ([pscustomobject](Cancel-DownloadItems -Tokens $tokens)) }
                else { Send-Json -Stream $Stream -Object ([pscustomobject](Stop-Download)) }
                return
            }
            '/api/download/repair' {
                Send-Json -Stream $Stream -Object ([pscustomobject](Repair-PartFiles))
                return
            }
            '/api/download/clear-done' {
                Send-Json -Stream $Stream -Object (Clear-DownloadDone)
                return
            }
            '/api/download/pause' {
                $on = [bool]$body.on
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
                Send-Json -Stream $Stream -Object (Set-DownloadPause -On $on -Tokens $tokens)
                return
            }
            '/api/download/reset' {
                Send-Json -Stream $Stream -Object (Reset-DownloadState)
                return
            }
            '/api/scrape' {
                $srcKey = if ($body.source) { [string]$body.source } else { 'pektino' }
                $srcInfo = Get-SourceInfo $srcKey
                if (-not $srcInfo) {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = "未知源: $srcKey" }
                    return
                }
                if ($srcInfo.capabilities -notcontains 'scrape') {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = "源 $($srcInfo.name) 不支持抓取" }
                    return
                }
                $allowedRanks = @($srcInfo.ranks | ForEach-Object { $_.key })
                if (-not $allowedRanks.Count) { $allowedRanks = @('default') }
                $rank = if ($body.rank) { [string]$body.rank } else { $allowedRanks[0] }
                if ($allowedRanks -notcontains $rank) {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = "源 $($srcInfo.name) 没有榜单: $rank" }
                    return
                }
                $limit = 0
                if ($body.limit) { try { $limit = [int]$body.limit } catch { $limit = 0 } }
                if ($limit -lt 1) { $limit = 50 }
                if ($limit -gt 2000) { $limit = 2000 }
                # 只按数量抓：根据源每页条数自动换算需要翻几页
                $pageSize = if ($srcInfo.pageSize -gt 0) { [int]$srcInfo.pageSize } else { 50 }
                $pageCount = [Math]::Max(1, [Math]::Ceiling([double]$limit / $pageSize))
                if ($pageCount -gt 50) { $pageCount = 50 }
                $pages = @(1..$pageCount)
                $threads = 8
                if ($body.threads) { try { $threads = [Math]::Max(2, [Math]::Min(24, [int]$body.threads)) } catch { $threads = 8 } }
                $inc = $true
                if ($null -ne $body.incremental) { $inc = [bool]$body.incremental }
                if ($srcInfo.incremental -eq $false) { $inc = $false }
                $fresh = 3
                if ($body.freshDays) { try { $fresh = [Math]::Max(0, [Math]::Min(30, [int]$body.freshDays)) } catch { $fresh = 3 } }
                Send-Json -Stream $Stream -Object (Start-Scrape -Source $srcKey -Rank $rank -Pages $pages -Limit $limit -Threads $threads -Incremental $inc -FreshDays $fresh)
                return
            }
            '/api/job/cancel' {
                Send-Json -Stream $Stream -Object (Stop-CurrentJob)
                return
            }
            '/api/mark' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
                if (-not $tokens.Count) { Send-Json -Stream $Stream -Object @{ ok = $false; error = '没选条目' }; return }
                $status = if ($body.status) { [string]$body.status } else { 'done' }
                Send-Json -Stream $Stream -Object (Invoke-Mark -Tokens $tokens -Status $status)
                return
            }
            '/api/collections' {
                $action = [string]$body.action
                $cid = 0
                try { $cid = [int]$body.id } catch { }
                $ctokens = @()
                if ($body.tokens) { $ctokens = @($body.tokens | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
                $cr = switch ($action) {
                    'create' { New-Collection -Name ([string]$body.name) }
                    'rename' { Rename-Collection -Id $cid -Name ([string]$body.name) }
                    'delete' { Remove-Collection -Id $cid }
                    'add' { Add-CollectionItems -Id $cid -Tokens $ctokens }
                    'remove' { Remove-CollectionItems -Id $cid -Tokens $ctokens }
                    default { @{ ok = $false; error = "未知操作: $action" } }
                }
                Send-Json -Stream $Stream -Object $cr
                return
            }
            '/api/fav' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                Send-Json -Stream $Stream -Object (Invoke-Fav -Tokens $tokens -On ([bool]$body.on))
                return
            }
            '/api/watched' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                Send-Json -Stream $Stream -Object (Invoke-Watched -Tokens $tokens -On ([bool]$body.on))
                return
            }
            '/api/rate' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | Where-Object { $_ } | ForEach-Object { [string]$_ }) }
                if (-not $tokens.Count) { Send-Json -Stream $Stream -Object @{ ok = $false; error = '没选条目' }; return }
                $val = 0
                if ($null -ne $body.value) {
                    $n = 0
                    if (-not [int]::TryParse([string]$body.value, [ref]$n) -or $n -lt 0 -or $n -gt 5) {
                        Send-Json -Stream $Stream -Object @{ ok = $false; error = '评分必须是 0-5' }
                        return
                    }
                    $val = $n
                }
                Send-Json -Stream $Stream -Object (Invoke-Rate -Tokens $tokens -Value $val)
                return
            }
            '/api/delete' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                Send-Json -Stream $Stream -Object (Invoke-DeleteFiles -Tokens $tokens -Purge:([bool]$body.purge) -Permanent:([bool]$body.permanent))
                return
            }
            '/api/import' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                $threads = 8
                if ($body.threads) { try { $threads = [Math]::Max(2, [Math]::Min(24, [int]$body.threads)) } catch { } }
                Send-Json -Stream $Stream -Object (Start-Import -Tokens $tokens -Threads $threads)
                return
            }
            '/api/play' {
                # 注意：$body 是 hashtable，$body.count 会拿到「键的数量」而不是 count 字段
                $countOnly = $false
                if ($body.ContainsKey('count')) { $countOnly = [bool]$body['count'] }
                Send-Json -Stream $Stream -Object (Invoke-Play -Token ([string]$body['token']) -CountOnly:$countOnly)
                return
            }
            '/api/reveal' {
                Send-Json -Stream $Stream -Object (Invoke-Play -Token ([string]$body.token) -Reveal)
                return
            }
            '/api/log' {
                $level = if ($body.level) { [string]$body.level } else { 'info' }
                $msg = [string]$body.msg
                if (-not $msg) { Send-Json -Stream $Stream -Object @{ ok = $false; error = '缺少 msg' }; return }
                $url = if ($body.url) { [string]$body.url } else { '' }
                $ms = $body.ms
                $stack = if ($body.stack) { [string]$body.stack } else { '' }

                [void](Write-ClientLog -Level $level -Message $msg -Url $url -Ms $ms -Stack $stack)

                switch ($level) {
                    'error' {
                        $State.Metrics.clientErrors.Insert(0, [pscustomobject]@{ t = (Get-Date -Format 'HH:mm:ss'); msg = $msg; url = $url; stack = $stack })
                        while ($State.Metrics.clientErrors.Count -gt 20) { $State.Metrics.clientErrors.RemoveAt(20) }
                        Write-Log 'client-err' $msg
                    }
                    'warn' { $State.Metrics.clientWarns++; Write-Log 'client-warn' $msg }
                    default { Write-Log 'client' $msg }
                }
                Send-Json -Stream $Stream -Object @{ ok = $true }
                return
            }
            '/api/scan' {
                $r = Invoke-Scan
                Send-Json -Stream $Stream -Object ([pscustomobject]@{
                        ok         = $true
                        downloaded = $r.downloaded
                        missing    = $r.missing
                        changed    = $r.changed
                        files      = $r.files
                        partial    = $r.partial
                        dir        = $r.dir
                        exists     = $r.exists
                        orphans    = @($r.orphans | Select-Object -First 50)
                    })
                return
            }
            '/api/config' {
                if ($body.proxy -ne $null) {
                    $px = ([string]$body.proxy).Trim()
                    if ($px -and $px -notmatch '^(https?://)?[A-Za-z0-9\.\-]+(:\d{1,5})?$') {
                        Send-Json -Stream $Stream -Object @{ ok = $false; error = "代理格式不对：$px（例：http://127.0.0.1:7890）" }
                        return
                    }
                    $Config | Add-Member -NotePropertyName proxy -NotePropertyValue $px -Force
                }
                if ($body.concurrent -ne $null) {
                    $cc = 0
                    if (-not [int]::TryParse([string]$body.concurrent, [ref]$cc) -or $cc -lt 1 -or $cc -gt 16) {
                        Send-Json -Stream $Stream -Object @{ ok = $false; error = '并发数必须是 1-16 的整数' }
                        return
                    }
                    $Config | Add-Member -NotePropertyName concurrent -NotePropertyValue $cc -Force
                }
                if ($body.ffmpegPath -ne $null) {
                    $fp = ([string]$body.ffmpegPath).Trim()
                    if ($fp -and -not (Test-Path -LiteralPath $fp -PathType Leaf)) {
                        Send-Json -Stream $Stream -Object @{ ok = $false; error = "FFmpeg 路径不存在：$fp" }
                        return
                    }
                    $Config | Add-Member -NotePropertyName ffmpegPath -NotePropertyValue $fp -Force
                }
                Save-Config -Config $Config -Root $Root -DataDir $WS.DataDir
                Write-Log 'config' "代理=$([string]$Config.proxy) 并发=$($Config.concurrent)"
                Send-Json -Stream $Stream -Object @{ ok = $true; proxy = [string]$Config.proxy; concurrent = $Config.concurrent }
                return
            }
            '/api/content/open' {
                try { Start-Process -FilePath explorer.exe -ArgumentList (ConvertTo-QuotedArg $WS.Content); Send-Json -Stream $Stream -Object @{ ok = $true; path = $WS.Content } }
                catch { Send-Json -Stream $Stream -Object @{ ok = $false; error = $_.Exception.Message } }
                return
            }
        }
    }

    Send-Bytes -Stream $Stream -Bytes ([Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"not found"}')) -Status '404 Not Found'
}

# ---------- 启动 ----------
$LogFile = Join-Path $WS.Logs 'console.log'

function Write-FileLog {
    param([string]$Message)
    try {
        $dir = Split-Path $LogFile -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
    } catch { }
}


function Stop-WithMessage {
    param([string]$Message, [string]$Color = 'Red')
    Write-Host ''
    Write-Host $Message -ForegroundColor $Color
    Write-FileLog "FATAL: $Message"
    Write-Host ''
    if ($PauseOnError) { Read-Host '按回车关闭窗口' | Out-Null }
    exit 1
}

Write-FileLog "---- start -Version $($PSVersionTable.PSVersion) -Port $Port ----"

if ($migrated -gt 0) {
    Write-Host "已把 $migrated 条台账从 CSV 迁移进 SQLite" -ForegroundColor Green
    Write-Log 'store' "CSV -> SQLite 迁移 $migrated 条"
    Write-FileLog "migrated $migrated rows from CSV"
}

# 缩略图补齐（只在缺失时跑，通常瞬间完成）
try {
    . (Join-Path $Root 'lib\thumbs.ps1')
    $tr = Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir
    if ($tr.made -gt 0) { Write-Log 'thumbs' "补齐缩略图 $($tr.made) 张（跳过 $($tr.skip)）"; Write-FileLog "thumbs: made=$($tr.made) skip=$($tr.skip) fail=$($tr.fail)" }
} catch {
    Write-FileLog "thumb backfill failed: $($_.Exception.Message)"
}

# 首次使用（台账为空）：把项目 media\ 里已有的视频识别进来
try {
    if (@($State.Ledger).Count -eq 0) {
        $imp = Import-ProjectFiles -Paths $WS -Rows $State.Ledger -SavePath $LedgerPath
        if ($imp.added -gt 0) {
            $State.Ledger = @($imp.rows)
            Write-Host "  识别到已有文件 $($imp.added) 条" -ForegroundColor Green
        }
    }
} catch { Write-FileLog "project import failed: $($_.Exception.Message)" }

# 启动先扫一遍内容目录，把“已经下完的”标成 done
# 顺手整理上次中断留下的 .part（已下完的改名，写坏的删掉）
try {
    $pr = Repair-PartFiles -Quick
    if ($pr.renamed -gt 0 -or $pr.deleted -gt 0) { Write-FileLog "part repair: renamed=$($pr.renamed) deleted=$($pr.deleted) kept=$($pr.kept)" }
} catch { Write-FileLog "part repair failed: $($_.Exception.Message)" }

# 启动先扫一遍内容目录，把“已经下完的”标成 done
try {
    $bootScan = Invoke-Scan -Silent
    Write-FileLog "boot scan: dir=$($Config.contentDir) files=$($bootScan.files) downloaded=$($bootScan.downloaded) changed=$($bootScan.changed)"
} catch {
    Write-FileLog "boot scan failed: $($_.Exception.Message)"
}

# 服务重启后 State 是空的：清掉上一轮可能残留的下载器/curl，
# 这样 Start-Download 可以走「只查跟踪状态」的快速路径，不必每次枚举进程
try {
    # 重启前没下完的条目：先记下来，等前端提示「继续下载」（Clean-StaleProgress 会清掉进度里的排队记录）
    try {
        if (Test-Path $DlProgress) {
            $pjResume = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
            $resumeTokens = @($pjResume.items | Where-Object { $_.state -in @('queued', 'downloading', 'paused') } |
                    ForEach-Object { [string]$_.token } | Where-Object { $_ } | Select-Object -Unique)
            if ($resumeTokens.Count -gt 0) {
                $State.Resume = @{ count = $resumeTokens.Count; tokens = $resumeTokens; at = (Get-Date).ToString('s') }
                Write-FileLog "boot resume: $($resumeTokens.Count) unfinished items"
            }
        }
    } catch { }
    $killedBoot = Stop-AllDownloadProcesses
    if ($killedBoot -gt 0) { Write-FileLog "boot cleanup: 清掉 $killedBoot 个残留下载进程" }
    # 进程都清掉了：进度文件里还挂着的 queued/downloading 都是假的，收尾成只剩已完成
    Clean-StaleProgress
} catch { }

# 历史本地条目补时长/分辨率（Shell 属性）
try {
    $mmFixed = Repair-MediaMeta
    if ($mmFixed -gt 0) { Write-FileLog "media meta repaired: $mmFixed" }
} catch { }


# ---------- 文件系统监听：media 目录有变动才扫盘 ----------
# 之前每 10 秒递归枚举整个 media 目录，几千个文件时会持续吃磁盘 IO。
# 现在用 FileSystemWatcher 收集事件，主循环按需扫描；另外每 10 分钟兜底扫一次。
$script:FsWatcher = $null
$script:FsDirty = $false
$script:FsPollAt = $null

function Start-FsWatcher {
    param([string]$Dir)
    if (-not $Dir -or -not (Test-Path -LiteralPath $Dir)) { return }
    try {
        $w = New-Object System.IO.FileSystemWatcher
        $w.Path = $Dir
        $w.IncludeSubdirectories = $true
        $w.Filter = '*.mp4'
        $w.NotifyFilter = [System.IO.NotifyFilters]::FileName -bor [System.IO.NotifyFilters]::LastWrite -bor [System.IO.NotifyFilters]::Size
        $w.InternalBufferSize = 65536
        foreach ($ev in @('Created', 'Changed', 'Deleted', 'Renamed', 'Error')) {
            Register-ObjectEvent -InputObject $w -EventName $ev -SourceIdentifier "pektino.fs.$ev" | Out-Null
        }
        $w.EnableRaisingEvents = $true
        $script:FsWatcher = $w
        Write-FileLog "fs watcher started: $Dir"
    } catch { Write-FileLog "fs watcher failed: $($_.Exception.Message)" }
}

function Read-FsDirty {
    <#  把排队的文件事件读掉，有事件就返回 $true  #>
    $dirty = $false
    foreach ($ev in @('Created', 'Changed', 'Deleted', 'Renamed', 'Error')) {
        $e = Get-Event -SourceIdentifier "pektino.fs.$ev" -ErrorAction SilentlyContinue
        if ($e) { $dirty = $true; Remove-Event -SourceIdentifier "pektino.fs.$ev" -ErrorAction SilentlyContinue }
    }
    return $dirty
}

Start-FsWatcher -Dir $Config.contentDir

# 端口被别的程序占用：往后找一个空闲端口
$bindPort = $Port
$listener = $null
for ($tryPort = $Port; $tryPort -lt ($Port + 20); $tryPort++) {
    $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $tryPort)
    try {
        $candidate.Start()
        $listener = $candidate
        $bindPort = $tryPort
        break
    } catch {
        try { $candidate.Stop() } catch { }
        Write-Host "端口 $tryPort 不可用，尝试下一个…" -ForegroundColor DarkYellow
        Write-FileLog "port $tryPort busy: $($_.Exception.Message)"
    }
}

if (-not $listener) {
    Stop-WithMessage "8791-8809 全部端口都被占用，无法启动。请先关掉占用方，或用 .\console.ps1 -Port 9000 换端口。"
}

# ---- 浏览器内播放：独立媒体服务 ----
# 主循环是单线程的，视频流不能走这里（一次几百 MB 会把 SSE 和所有接口堵死）。
# 另起一个进程专门做 Range 流式传输，只服务媒体目录，父进程退出后自动结束。
function Start-MediaServer {
    $cfg = Read-Config -Root $Root -DataDir $WS.DataDir -DefaultContentDir $WS.Content
    $dir = if ($cfg.contentDir) { [string]$cfg.contentDir } else { $WS.Content }
    if (-not [System.IO.Path]::IsPathRooted($dir)) {
        $dir = [System.IO.Path]::GetFullPath((Join-Path $WS.ProjectRoot $dir))
    }
    if (-not (Test-Path $dir)) { return $null }

    $key = if ($State.Media -and $State.Media.Key) { [string]$State.Media.Key } else { [guid]::NewGuid().ToString('N') }
    $from = if ($State.Media -and $State.Media.Port) { [int]$State.Media.Port } else { $bindPort + 40 }
    $port = 0
    for ($i = 0; $i -lt 30; $i++) {
        $p = $from + $i
        try {
            $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
            $probe.Start(); $probe.Stop()
            $port = $p
            break
        } catch { }
    }
    if (-not $port) { Write-FileLog 'media server: no free port'; return $null }

    $mediaScript = Join-Path $Root 'server\media.ps1'
    $mediaLog = Join-Path (Split-Path -Parent $LogFile) 'media.log'
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-QuotedArg $mediaScript),
        '-MediaDir', (ConvertTo-QuotedArg $dir), '-Port', "$port", '-Key', $key,
        '-ParentPid', "$PID", '-LogFile', (ConvertTo-QuotedArg $mediaLog))
    try {
        $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
    } catch {
        Write-FileLog "media server start failed: $($_.Exception.Message)"
        return $null
    }
    $State.Media = @{ Base = "http://127.0.0.1:$port"; Key = $key; Port = $port; Pid = $proc.Id; Dir = $dir }
    Write-FileLog "media server pid=$($proc.Id) port=$port dir=$dir"
    return $State.Media
}
$null = Start-MediaServer

$url = "http://127.0.0.1:$bindPort/"
Write-Host ''
Write-Host "  控制台已启动: $url" -ForegroundColor Green
Write-Host "  台账: $LedgerPath （$(@($State.Ledger).Count) 条）" -ForegroundColor DarkGray
Write-Host "  日志: $LogFile" -ForegroundColor DarkGray
Write-Host '  Ctrl+C 停止' -ForegroundColor DarkGray
Write-Host ''
Write-Log 'boot' "服务启动 $url"
Write-FileLog "listening on $url"
if (-not $NoBrowser) { Start-Process $url }

try {
    while ($true) {
        $pending = $false
        try { $pending = $listener.Server.Poll(250000, [System.Net.Sockets.SelectMode]::SelectRead) } catch { Start-Sleep -Milliseconds 120 }
        if ($pending) {
            $client = $listener.AcceptTcpClient()
            $streaming = $false
            $reqStart = Get-Date
            $reqPath = ''
            try {
                $client.ReceiveTimeout = 10000
                # SSE / 慢客户端写不进去时别把单线程主循环永久卡住
                try { $client.Client.SendTimeout = 8000 } catch { }
                $stream = $client.GetStream()
                $req = Read-Request -Stream $stream
                if ($req) {
                    $reqPath = "$($req.Method) $($req.Path)"
                    try {
                        $streaming = [bool](Handle-Request -Stream $stream -Req $req -Client $client)
                    } catch {
                        Write-Host "[error] $($_.Exception.Message)" -ForegroundColor Red
                        try {
                            Send-Bytes -Stream $stream -Bytes ([Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"internal"}')) -Status '500 Internal Server Error'
                        } catch { }
                    }
                }
            } catch {
                Write-Host "[warn] $($_.Exception.Message)" -ForegroundColor DarkYellow
            } finally {
                if (-not $streaming) { try { $client.Close() } catch { } }
                if ($reqPath -and -not $streaming) {
                    $ms = [math]::Round(((Get-Date) - $reqStart).TotalMilliseconds)
                    $m = $State.Metrics
                    $m.total++
                    $m.sumMs += $ms
                    if ($ms -gt $m.maxMs) { $m.maxMs = $ms; $m.maxPath = $reqPath }
                    if ($ms -ge 800) {
                        $m.slow.Insert(0, [pscustomobject]@{ t = (Get-Date -Format 'HH:mm:ss'); path = $reqPath; ms = $ms })
                        while ($m.slow.Count -gt 20) { $m.slow.RemoveAt(20) }
                        Write-Log 'slow' "$reqPath 耗时 ${ms}ms"
                    }
                }
            }
        }
        # 主循环尾巴绝不能把服务带崩：任何异常只记录，下一轮继续
        try {
        Push-Sse
        } catch { try { Write-FileLog "loop tail error: $($_.Exception.Message)" } catch { } }
        try {
        # 任务收尾不能只依赖前端轮询 /api/state：没人看页面时也要把 Job 释放掉
        if (Get-Command Update-Job -ErrorAction SilentlyContinue) { try { Update-Job } catch { } }
        if (Get-Command Step-Download -ErrorAction SilentlyContinue) { try { Step-Download } catch { } }
        if (Get-Command Step-Covers -ErrorAction SilentlyContinue) { try { Step-Covers } catch { } }
        if (Get-Command Step-DownloadGuard -ErrorAction SilentlyContinue) {
            if (-not $script:GuardAt -or ((Get-Date) - [datetime]$script:GuardAt).TotalSeconds -ge 30) {
                $script:GuardAt = (Get-Date).ToString('s')
                try { Step-DownloadGuard } catch { }
            }
        }
        # 媒体服务掉了就拉起来（被任务管理器结束、异常退出等），30 秒检查一次
        if (-not $script:MediaRetryAt -or ((Get-Date) - [datetime]$script:MediaRetryAt).TotalSeconds -ge 30) {
            $script:MediaRetryAt = (Get-Date).ToString('s')
            $mediaAlive = $false
            if ($State.Media -and $State.Media.Pid) {
                $mediaAlive = [bool](Get-Process -Id $State.Media.Pid -ErrorAction SilentlyContinue)
            }
            if (-not $mediaAlive) { $null = Start-MediaServer }
        }
        # 扫盘：文件系统监听报有变动才扫；另外每 10 分钟兜底扫一次
        $lastScan = $null
        if ($State.Scan -and $State.Scan.lastScan) { try { $lastScan = [datetime]$State.Scan.lastScan } catch { } }
        $scanAge = if ($lastScan) { ((Get-Date) - $lastScan).TotalSeconds } else { [double]::MaxValue }
        if ($script:FsWatcher -and (-not $script:FsPollAt -or ((Get-Date) - [datetime]$script:FsPollAt).TotalSeconds -ge 1)) {
            $script:FsPollAt = (Get-Date).ToString('s')
            if (Read-FsDirty) { $script:FsDirty = $true }
        }
        # 有请求在处理时先不扫（避免拉长页面响应），但最多拖 30 秒
        $canScan = (-not $pending) -or ($scanAge -ge 30)
        if ($script:FsDirty -and $scanAge -ge 5 -and $canScan) {
            $script:FsDirty = $false
            try { [void](Invoke-Scan -Silent) } catch { try { Write-FileLog "fs scan failed: $($_.Exception.Message)" } catch { } }
        } elseif ($scanAge -ge 600 -and $canScan) {
            try { [void](Invoke-Scan -Silent) } catch { try { Write-FileLog "idle scan failed: $($_.Exception.Message)" } catch { } }
        }
        # CSV 快照（内部 30 秒节流）也放空闲轮次：几千行时 Export-Csv 要一两百毫秒。
        # DB 才是事实来源，CSV 只是导出快照，晚一点写没有影响（导出接口会强制生成）。
        if (-not $pending) {
            try { Write-CsvSnapshot -Rows @($State.Ledger) -Path $LedgerPath } catch { }
        }
        } catch { try { Write-FileLog "loop step error: $($_.Exception.Message)" } catch { }; Start-Sleep -Milliseconds 200 }
    }
} catch {
    try { Write-FileLog "main loop crashed: $($_.Exception.Message) / $($_.ScriptStackTrace)" } catch { }
} finally {
    if ($script:FsWatcher) {
        try { $script:FsWatcher.EnableRaisingEvents = $false; $script:FsWatcher.Dispose() } catch { }
    }
    foreach ($ev in @('Created', 'Changed', 'Deleted', 'Renamed', 'Error')) {
        try { Unregister-Event -SourceIdentifier "pektino.fs.$ev" -ErrorAction SilentlyContinue } catch { }
    }
    if ($State.Media -and $State.Media.Pid) {
        try { & taskkill.exe /PID $State.Media.Pid /T /F 2>&1 | Out-Null } catch { }
    }
    foreach ($c in @($script:SseClients)) { try { $c.Stream.Close() } catch { }; try { $c.Socket.Close() } catch { } }
    $listener.Stop()
    try { Save-Ledger -Rows @($State.Ledger) -Path $LedgerPath -ForceSnapshot } catch { }
    Write-Host '控制台已停止（台账已落盘）' -ForegroundColor DarkGray
    Close-Store
}