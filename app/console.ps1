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
    [switch]$NoPrompt
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

$script:StartedAt = Get-Date
. (Join-Path $Root 'lib\ledger.ps1')
. (Join-Path $Root 'lib\project.ps1')

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



function New-ThunderLink {
    param([string]$Url)
    'thunder://' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('AA' + $Url + 'ZZ'))
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
                Send-Bytes -Stream $Stream -Bytes ([System.IO.File]::ReadAllBytes($file)) -ContentType $ct -ExtraHeaders @{ 'Cache-Control' = 'no-cache' }
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
            rev      = $State.Rev
            rowsRev  = $ledgerRev
            stats    = Get-Stats
            log      = @($State.Log | Select-Object -Last 40)
            job      = (Get-JobInfo)
            download = (Get-DownloadInfo)
            project  = (Get-ProjectSummary -Paths $WS)
            settings = [pscustomobject]@{ proxy = [string]$Config.proxy; concurrent = $(if ($Config.concurrent) { [int]$Config.concurrent } else { 3 }) }
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
        if ($tk -match '^[A-Za-z0-9_\-]+$') {
            $thumb = Join-Path $ThumbDir ($tk + '.jpg')
            $orig = Join-Path $CoverDir ($tk + '.jpg')
            $file = $null
            if (-not $full -and (Test-Path $thumb)) { $file = $thumb }
            elseif (Test-Path $orig) { $file = $orig }
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

    if ($method -eq 'GET' -and $path -eq '/api/download') {
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; download = (Get-DownloadInfo) })
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
                if (@('new', 'sent', 'failed') -notcontains $status) {
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
            '/api/download/pause' {
                $on = [bool]$body.on
                Send-Json -Stream $Stream -Object (Set-DownloadPause -On $on)
                return
            }
            '/api/scrape' {
                $rank = if ($body.rank) { [string]$body.rank } else { 'daily' }
                if (@('daily', 'weekly', 'monthly', 'all') -notcontains $rank) {
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = "不认识的榜单: $rank" }
                    return
                }
                $pages = @(1)
                if ($null -ne $body.pages) {
                    $raw = @($body.pages)
                    $pages = @()
                    foreach ($p in $raw) {
                        $n = 0
                        if ([int]::TryParse([string]$p, [ref]$n) -and $n -ge 1 -and $n -le 200) { $pages += $n }
                    }
                    if (-not $pages.Count) {
                        Send-Json -Stream $Stream -Object @{ ok = $false; error = '页数必须是 1-200 之间的整数' }
                        return
                    }
                }
                $limit = 0
                if ($body.limit) { try { $limit = [int]$body.limit } catch { $limit = 0 } }
                if ($limit -lt 0) { $limit = 0 }
                $threads = 8
                if ($body.threads) { try { $threads = [Math]::Max(2, [Math]::Min(24, [int]$body.threads)) } catch { $threads = 8 } }
                $inc = $true
                if ($null -ne $body.incremental) { $inc = [bool]$body.incremental }
                $fresh = 3
                if ($body.freshDays) { try { $fresh = [Math]::Max(0, [Math]::Min(30, [int]$body.freshDays)) } catch { $fresh = 3 } }
                Send-Json -Stream $Stream -Object (Start-Scrape -Rank $rank -Pages $pages -Limit $limit -Threads $threads -Incremental $inc -FreshDays $fresh)
                return
            }
            '/api/job/cancel' {
                Send-Json -Stream $Stream -Object (Stop-CurrentJob)
                return
            }
            '/api/send' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                $status = if ($body.status) { [string]$body.status } else { 'new' }
                $r = Invoke-Send -Tokens $tokens -Status $status -DryRun:([bool]$body.dryRun) -Force:([bool]$body.force)
                Send-Json -Stream $Stream -Object $r
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
                Send-Json -Stream $Stream -Object (Invoke-Play -Token ([string]$body.token))
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
    $pr = Repair-PartFiles
    if ($pr.renamed -gt 0 -or $pr.deleted -gt 0) { Write-FileLog "part repair: renamed=$($pr.renamed) deleted=$($pr.deleted) kept=$($pr.kept)" }
} catch { Write-FileLog "part repair failed: $($_.Exception.Message)" }

# 启动先扫一遍内容目录，把“已经下完的”标成 done
try {
    $bootScan = Invoke-Scan -Silent
    Write-FileLog "boot scan: dir=$($Config.contentDir) files=$($bootScan.files) downloaded=$($bootScan.downloaded) changed=$($bootScan.changed)"
} catch {
    Write-FileLog "boot scan failed: $($_.Exception.Message)"
}


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
        # 空闲扫盘：优先在「这一轮没有待处理请求」时跑，这样 media\ 里有几千个文件时，
        # 扫描不会拉长任何一次页面请求的响应时间。
        # 但持续轮询（前端任务期间 1.2s 一次）可能让 Poll 一直是 true、永远等不到空闲 →
        # 加一条兜底：超过 30 秒没扫就强制扫一次，避免扫描被轮询饿死。
        $lastScan = $null
        if ($State.Scan -and $State.Scan.lastScan) { try { $lastScan = [datetime]$State.Scan.lastScan } catch { } }
        $scanAge = if ($lastScan) { ((Get-Date) - $lastScan).TotalSeconds } else { [double]::MaxValue }
        if ($scanAge -ge 10 -and (-not $pending -or $scanAge -ge 30)) {
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
    foreach ($c in @($script:SseClients)) { try { $c.Stream.Close() } catch { }; try { $c.Socket.Close() } catch { } }
    $listener.Stop()
    try { Save-Ledger -Rows @($State.Ledger) -Path $LedgerPath -ForceSnapshot } catch { }
    Write-Host '控制台已停止（台账已落盘）' -ForegroundColor DarkGray
    Close-Store
}