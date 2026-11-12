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
    [switch]$PauseOnError
)

# $PSScriptRoot 在 param 默认值里可能还是空的（powershell -File 启动时），这里显式兜底
if (-not $Root) {
    if ($PSScriptRoot) { $Root = $PSScriptRoot }
    elseif ($MyInvocation.MyCommand.Path) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Path }
    else { $Root = (Get-Location).Path }
}
if (-not (Test-Path (Join-Path $Root 'ledger.ps1'))) {
    Write-Host "找不到 ledger.ps1，Root=$Root" -ForegroundColor Red
    if ($PauseOnError) { Read-Host '按回车关闭' | Out-Null }
    exit 1
}

$ErrorActionPreference = 'Stop'
$script:StartedAt = Get-Date
. (Join-Path $Root 'ledger.ps1')

# SQLite 存储（事实来源）；首次启动自动从 ledger.csv 迁移
[void](Initialize-Store -Root $Root)
$migrated = Import-CsvIntoStore -CsvPath (Get-LedgerPath -Root $Root)
# 每日库备份 + WAL 合并
try { Invoke-DbMaintenance -Backup -Checkpoint } catch { }

$Pektino = Join-Path $Root 'pektino.ps1'
$LedgerPath = Get-LedgerPath -Root $Root
$WebDir = Join-Path $Root 'web'
$HtmlPath = Join-Path $WebDir 'index.html'
$TmpCsv = Join-Path $Root 'out\.scrape.csv'
$CoverDir = Join-Path $Root 'out\covers'
$ThumbDir = Join-Path $Root 'out\thumbs'
$ProgressFile = Join-Path $Root 'out\progress.json'
$KnownFile = Join-Path $Root 'out\.known.txt'
$ClientLog = Join-Path $Root 'out\client.log'
$DlScript = Join-Path $Root 'download.ps1'
$DlQueue = Join-Path $Root 'out\.queue.json'
$DlProgress = Join-Path $Root 'out\download.json'
$DlCancel = Join-Path $Root 'out\.dl-cancel.json'

# ---------- 内存态 ----------
$Config = Read-Config -Root $Root
$State = @{
    Ledger = @(Read-Ledger -Path $LedgerPath)
    Log    = New-Object System.Collections.ArrayList
    Busy   = $false
    Files  = @{ Files = @{}; Partial = @(); Dir = $Config.downloadDir; Exists = $false }
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
$script:SseClients = New-Object System.Collections.ArrayList

# ---------- 分层加载 ----------
# transport: Send-Bytes / Send-Json / Read-Request / Push-Sse
# actions  : Get-Stats / Invoke-Scan / 任务与抓取 / 收藏·评分·观看 / 播放 / 删除 / 投递
. (Join-Path $WebDir 'transport.ps1')
. (Join-Path $WebDir 'actions.ps1')
. (Join-Path $WebDir 'covers.ps1')

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
        # 10 秒内的扫描结果直接复用，避免每次轮询都读盘
        $stale = $true
        if ($State.Scan -and $State.Scan.lastScan) {
            try { $stale = ((Get-Date) - [datetime]$State.Scan.lastScan).TotalSeconds -gt 10 } catch { $stale = $true }
        }
        if ($stale) { try { [void](Invoke-Scan -Silent) } catch { } }
        # CSV 快照节流刷新（30s 一次），DB 是事实来源
        try { Write-CsvSnapshot -Rows @($State.Ledger) -Path $LedgerPath } catch { }
        Send-Json -Stream $Stream -Object ([pscustomobject]@{
                ok      = $true
                stats   = Get-Stats
                rows    = @($State.Ledger)
                log     = @($State.Log | Select-Object -Last 40)
                job     = (Get-JobInfo)
                download = (Get-DownloadInfo)
                settings = [pscustomobject]@{ proxy = [string]$Config.proxy; concurrent = $(if ($Config.concurrent) { [int]$Config.concurrent } else { 3 }) }
                metrics = [pscustomobject]@{
                    total        = $State.Metrics.total
                    avgMs        = if ($State.Metrics.total -gt 0) { [math]::Round($State.Metrics.sumMs / $State.Metrics.total, 1) } else { 0 }
                    maxMs        = $State.Metrics.maxMs
                    maxPath      = $State.Metrics.maxPath
                    slow         = @($State.Metrics.slow)
                    clientErrors = @($State.Metrics.clientErrors)
                    clientWarns  = $State.Metrics.clientWarns
                    uptime       = [math]::Round(((Get-Date) - $script:StartedAt).TotalMinutes, 1)
                }
            })
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

    if ($method -eq 'GET' -and $path -eq '/api/download') {
        Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; download = (Get-DownloadInfo) })
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/export') {
        $tmp = Join-Path (Split-Path $LedgerPath -Parent) '.export.csv'
        Write-CsvSnapshot -Rows @($State.Ledger) -Path $tmp -Force
        $bytes = [Text.Encoding]::UTF8.GetBytes((Get-Content $tmp -Raw -Encoding UTF8))
        Remove-Item $tmp -Force -ErrorAction SilentlyContinue
        Send-Bytes -Stream $Stream -Bytes $bytes -ContentType 'text/csv; charset=utf-8' -ExtraHeaders @{ 'Content-Disposition' = 'attachment; filename=ledger.csv' }
        return
    }

    if ($method -eq 'POST') {
        $body = @{}
        if ($Req.Body) {
            try { $parsed = $Req.Body | ConvertFrom-Json; foreach ($p in $parsed.PSObject.Properties) { $body[$p.Name] = $p.Value } } catch { }
        }
        switch ($path) {
            '/api/download' {
                $tokens = @()
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                $status = if ($body.status) { [string]$body.status } else { 'new' }
                $limit = 0
                if ($body.limit) { $limit = [int]$body.limit }
                $r = Start-Download -Tokens $tokens -Status $status -Limit $limit
                Send-Json -Stream $Stream -Object ([pscustomobject]$r)
                return
            }
            '/api/covers/repair' {
                $limit = 40
                if ($body.limit) { $limit = [int]$body.limit }
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
            '/api/scrape' {
                $rank = if ($body.rank) { [string]$body.rank } else { 'daily' }
                $pages = @(1, 2, 3)
                if ($body.pages) { $pages = @($body.pages | ForEach-Object { [int]$_ }) }
                $limit = 0
                if ($body.limit) { $limit = [int]$body.limit }
                $threads = 8
                if ($body.threads) { $threads = [Math]::Max(2, [Math]::Min(24, [int]$body.threads)) }
                $inc = $true
                if ($null -ne $body.incremental) { $inc = [bool]$body.incremental }
                $fresh = 3
                if ($body.freshDays) { $fresh = [Math]::Max(0, [int]$body.freshDays) }
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
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
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
                if ($body.tokens) { $tokens = @($body.tokens | ForEach-Object { [string]$_ }) }
                $val = 0
                if ($null -ne $body.value) { $val = [int]$body.value }
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
                if ($body.threads) { $threads = [Math]::Max(2, [Math]::Min(24, [int]$body.threads)) }
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
                if ($body.proxy -ne $null) { $Config | Add-Member -NotePropertyName proxy -NotePropertyValue ([string]$body.proxy) -Force }
                if ($body.concurrent -ne $null) { $Config | Add-Member -NotePropertyName concurrent -NotePropertyValue ([int]$body.concurrent) -Force }
                $dir = [string]$body.downloadDir
                if (-not $dir) {
                    if ($body.proxy -ne $null -or $body.concurrent -ne $null) { Save-Config -Config $Config -Root $Root; Send-Json -Stream $Stream -Object @{ ok = $true; proxy = $Config.proxy; concurrent = $Config.concurrent }; return }
                    Send-Json -Stream $Stream -Object @{ ok = $false; error = '缺少 downloadDir' }; return
                }
                $dir = $dir.Trim().Trim('"')
                if (-not (Test-Path $dir)) {
                    try { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                    catch { Send-Json -Stream $Stream -Object @{ ok = $false; error = "目录不存在且无法创建: $dir" }; return }
                }
                $Config.downloadDir = $dir
                Save-Config -Config $Config -Root $Root
                Write-Log 'config' "下载目录改为 $dir"
                # 换目录只重扫，不因为“新目录里找不到文件”把已有状态打回待下载
                $r = Invoke-Scan -KeepStatus
                Send-Json -Stream $Stream -Object ([pscustomobject]@{ ok = $true; dir = $dir; downloaded = $r.downloaded; files = $r.files })
                return
            }
        }
    }

    Send-Bytes -Stream $Stream -Bytes ([Text.Encoding]::UTF8.GetBytes('{"ok":false,"error":"not found"}')) -Status '404 Not Found'
}

# ---------- 启动 ----------
$LogFile = Join-Path (Split-Path $LedgerPath -Parent) 'console.log'

function Write-FileLog {
    param([string]$Message)
    try {
        $dir = Split-Path $LogFile -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
    } catch { }
}

function Test-ConsoleAlive {
    param([int]$P)
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$P/api/state" -TimeoutSec 2
        return [bool]$r.ok
    } catch { return $false }
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
    . (Join-Path $Root 'thumbs.ps1')
    $tr = Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir
    if ($tr.made -gt 0) { Write-Log 'thumbs' "补齐缩略图 $($tr.made) 张（跳过 $($tr.skip)）"; Write-FileLog "thumbs: made=$($tr.made) skip=$($tr.skip) fail=$($tr.fail)" }
} catch {
    Write-FileLog "thumb backfill failed: $($_.Exception.Message)"
}

# 启动先扫一遍下载目录，把“已经下完的”标成 done
# 顺手整理上次中断留下的 .part（已下完的改名，写坏的删掉）
try {
    $pr = Repair-PartFiles
    if ($pr.renamed -gt 0 -or $pr.deleted -gt 0) { Write-FileLog "part repair: renamed=$($pr.renamed) deleted=$($pr.deleted) kept=$($pr.kept)" }
} catch { Write-FileLog "part repair failed: $($_.Exception.Message)" }

# 启动先扫一遍下载目录，把“已经下完的”标成 done
try {
    $bootScan = Invoke-Scan -Silent
    Write-FileLog "boot scan: dir=$($Config.downloadDir) files=$($bootScan.files) downloaded=$($bootScan.downloaded) changed=$($bootScan.changed)"
} catch {
    Write-FileLog "boot scan failed: $($_.Exception.Message)"
}

# 已经有实例在跑：直接打开浏览器，不重复绑定端口
if (Test-ConsoleAlive $Port) {
    $liveUrl = "http://127.0.0.1:$Port/"
    Write-Host "控制台已经在运行：$liveUrl" -ForegroundColor Green
    Write-Host '（如需重启，先关掉已有的那个窗口/进程）' -ForegroundColor DarkGray
    Write-FileLog "already running at $liveUrl"
    if (-not $NoBrowser) { Start-Process $liveUrl }
    if ($PauseOnError) { Start-Sleep -Seconds 1 }
    return
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
        Push-Sse
        if (Get-Command Step-Download -ErrorAction SilentlyContinue) { try { Step-Download } catch { } }
        if (Get-Command Step-Covers -ErrorAction SilentlyContinue) { try { Step-Covers } catch { } }
    }
} finally {
    foreach ($c in @($script:SseClients)) { try { $c.Stream.Close() } catch { }; try { $c.Socket.Close() } catch { } }
    $listener.Stop()
    try { Save-Ledger -Rows @($State.Ledger) -Path $LedgerPath -ForceSnapshot } catch { }
    Write-Host '控制台已停止（台账已落盘）' -ForegroundColor DarkGray
    Close-Store
}