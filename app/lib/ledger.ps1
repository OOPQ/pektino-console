#Requires -Version 5.1
<#
.SYNOPSIS
  台账（ledger）读写、去重合并、内容目录扫描。被 console.ps1 与命令行共用。

.DESCRIPTION
  out\ledger.csv 是唯一事实来源：
    - token 是唯一键；重复抓取只更新元数据，保留 status / first_seen / fav
    - status: new(待下载) / sent(已投迅雷) / done(已完成) / recycled(回收站)
    - fav: '1' 表示收藏
    - 扫描内容目录时，文件名 `<token>.mp4` 命中即写入 file_name/file_size/file_date 并置 done
#>

$script:LedgerColumns = @(
    'token', 'status', 'fav', 'rank', 'page', 'duration', 'seconds', 'res', 'views', 'likes',
    'uploaded', 'url', 'page_url', 'first_seen', 'last_seen', 'sent_at', 'note',
    'file_name', 'file_size', 'file_date', 'play_count', 'last_play', 'rating'
)

# 存储层（SQLite）。ledger.ps1 只保留业务语义：合并、状态、配置、扫盘。
. (Join-Path $PSScriptRoot 'store.ps1')

function Get-LedgerPath {
    param([string]$Root = $PSScriptRoot, [string]$DataDir = '')
    if ($DataDir) { return (Join-Path $DataDir 'ledger.csv') }
    Join-Path $Root 'out\ledger.csv'
}

function Read-Ledger {
    param([string]$Path)
    if ($script:DbConn) { return @(Get-StoreItems) }
    if (-not $Path) { $Path = Get-LedgerPath }
    if (-not (Test-Path $Path)) { return @() }
    $rows = @(Import-Csv -Path $Path -Encoding UTF8)
    foreach ($r in $rows) {
        foreach ($c in $script:LedgerColumns) {
            if (-not ($r.PSObject.Properties.Name -contains $c)) {
                $r | Add-Member -NotePropertyName $c -NotePropertyValue '' -Force
            }
        }
    }
    return $rows
}

# 行数据版本号：只在「台账行真的变了」时 +1。
# /api/state 用它决定要不要把整份 rows 下发给前端 —— 下载进度这类每 2 秒一次的
# rev 变化不需要重传几千行数据。
$script:LedgerRev = 0

function Get-LedgerRev { return [int]$script:LedgerRev }

function Touch-Ledger {
    <#  台账内容发生变化时调用（绕过 Save-Ledger 的路径，例如 purge 直接删库）  #>
    $script:LedgerRev++
}

function Save-Ledger {
    param($Rows, [string]$Path, [switch]$ForceSnapshot, [switch]$NoSnapshot)
    if (-not $Path) { $Path = Get-LedgerPath }

    if ($script:DbConn) {
        Save-StoreItems -Rows @($Rows)
        Touch-Ledger
        if (-not $NoSnapshot) { Write-CsvSnapshot -Rows @($Rows) -Path $Path -Force:$ForceSnapshot }
        return
    }

    # 没有 store 时退化为原子写 CSV（临时文件 + 替换），避免写一半损坏
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.tmp"
    @($Rows) | Select-Object $script:LedgerColumns | Export-Csv -Path $tmp -NoTypeInformation -Encoding UTF8
    Move-Item -Path $tmp -Destination $Path -Force
    Touch-Ledger
}

function Merge-Ledger {
    param(
        $Existing,
        $Scraped,
        [string]$Stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    )

    $byToken = @{}
    $rows = New-Object System.Collections.ArrayList
    foreach ($r in @($Existing)) {
        if (-not $r.token) { continue }
        $byToken[$r.token] = $r
        [void]$rows.Add($r)
    }

    $added = 0
    $updated = 0
    foreach ($s in @($Scraped)) {
        if (-not $s.token) { continue }
        if ($s.url -and $s.url -notmatch '^https?://') { continue }

        # 外部 CSV 可能没 seconds，用 duration 回算
        if (-not $s.seconds -and $s.duration) {
            $sec = 0
            if ($s.duration -match '^(\d+):(\d+):(\d+)$') { $sec = [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3] }
            elseif ($s.duration -match '^(\d+):(\d+)$') { $sec = [int]$Matches[1] * 60 + [int]$Matches[2] }
            if ($sec -gt 0) { $s | Add-Member -NotePropertyName seconds -NotePropertyValue $sec -Force }
        }

        if ($byToken.ContainsKey($s.token)) {
            $t = $byToken[$s.token]
            foreach ($f in @('rank', 'page', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'url', 'page_url',
                    'title', 'cover_url', 'source', 'source_id', 'download_kind', 'download_headers', 'extra')) {
                $v = $s.$f
                if ($v) { $t.$f = $v }
            }
            $t.last_seen = $Stamp
            if (-not $t.status) { $t.status = 'new' }
            $updated++
        } else {
            $row = [pscustomobject]@{
                token = $s.token; status = 'new'; fav = ''
                rank = $s.rank; page = $s.page
                duration = $s.duration; seconds = $s.seconds
                res = $s.res; views = $s.views; likes = $s.likes
                uploaded = $s.uploaded; url = $s.url; page_url = $s.page_url
                source = $(if ($s.source) { [string]$s.source } else { 'pektino' })
                source_id = $(if ($s.source_id) { [string]$s.source_id } else { [string]$s.token })
                title = $(if ($s.title) { [string]$s.title } else { [string]$s.token })
                cover_url = [string]$s.cover_url
                download_kind = $(if ($s.download_kind) { [string]$s.download_kind } else { 'http' })
                download_headers = [string]$s.download_headers
                extra = [string]$s.extra
                first_seen = $Stamp; last_seen = $Stamp; sent_at = ''; note = ''
                file_name = ''; file_size = ''; file_date = ''
                # 这三列后面会被评分/观看/播放直接赋值，缺了会抛"属性不存在"
                play_count = ''; last_play = ''; rating = ''
            }
            $byToken[$s.token] = $row
            [void]$rows.Add($row)
            $added++
        }
    }

    return [pscustomobject]@{ Rows = @($rows); Added = $added; Updated = $updated }
}

function Set-LedgerStatus {
    param($Rows, [string[]]$Tokens, [string]$Status, [string]$Note = '')
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $n = 0
    foreach ($r in @($Rows)) {
        if ($Tokens -contains $r.token) {
            $r.status = $Status
            if ($Note) { $r.note = $Note }
            $n++
        }
    }
    return $n
}

# ---------------- 配置 ----------------

function Get-ConfigPath {
    param([string]$Root = $PSScriptRoot, [string]$DataDir = '')
    if ($DataDir) { return (Join-Path $DataDir 'config.json') }
    Join-Path $Root 'data\config.json'
}

function Read-Config {
    param([string]$Root = $PSScriptRoot, [string]$DataDir = '', [string]$DefaultContentDir = 'D:\Downloads')
    $default = [pscustomobject]@{ contentDir = $DefaultContentDir }
    $p = Get-ConfigPath -Root $Root -DataDir $DataDir
    if (-not (Test-Path $p)) { return $default }
    try {
        $c = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
        # 兼容旧配置字段（downloadDir → contentDir）
        if (-not $c.contentDir -and $c.PSObject.Properties['downloadDir'] -and $c.downloadDir) {
            $c | Add-Member -NotePropertyName contentDir -NotePropertyValue ([string]$c.downloadDir) -Force
        }
        # contentDir 不再从配置文件读：项目结构决定它，配置文件里残留的绝对路径一律忽略
        $c | Add-Member -NotePropertyName contentDir -NotePropertyValue $default.contentDir -Force
        return $c
    } catch {
        return $default
    }
}

function Save-Config {
    param($Config, [string]$Root = $PSScriptRoot, [string]$DataDir = '')
    $p = Get-ConfigPath -Root $Root -DataDir $DataDir
    $dir = Split-Path $p -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    # 只持久化真正需要记的项；contentDir 由项目结构决定，绝不能写绝对路径进配置
    $out = [ordered]@{}
    foreach ($k in @('proxy', 'concurrent', 'ffmpegPath')) {
        if ($null -ne $Config.$k) { $out[$k] = $Config.$k }
    }
    ($out | ConvertTo-Json -Depth 4) | Set-Content -Path $p -Encoding UTF8
}

# ---------------- 内容目录扫描 ----------------

function Get-DownloadIndex {
    param([string]$Dir)

    $index = @{}
    $partial = New-Object System.Collections.ArrayList
    if (-not $Dir -or -not (Test-Path $Dir)) {
        return [pscustomobject]@{ Files = $index; Partial = @(); Dir = $Dir; Exists = $false }
    }

    $files = @(Get-ChildItem -Path $Dir -Filter *.mp4 -File -Recurse -Depth 4 -ErrorAction SilentlyContinue)
    foreach ($f in $files) {
        $stem = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        $stem = $stem -replace '\s*\(\d+\)\s*$', ''
        if (-not $stem) { continue }
        $key = $stem.ToLower()
        if ($index.ContainsKey($key)) { continue }
        $index[$key] = [pscustomobject]@{
            token = $stem
            file  = $f.FullName
            name  = $f.Name
            size  = $f.Length
            date  = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
        }
    }

    # 未完成的体积也算进来：内置下载器的 .mp4.part 和迅雷的 .xltd
    foreach ($f in @(Get-ChildItem -Path $Dir -Include *.xltd,*.part -File -Recurse -Depth 4 -ErrorAction SilentlyContinue)) {
        [void]$partial.Add([pscustomobject]@{ name = $f.Name; size = $f.Length })
    }

    return [pscustomobject]@{ Files = $index; Partial = @($partial); Dir = $Dir; Exists = $true }
}

function ConvertTo-Seconds {
    <#  ISO 8601 / "6:20" / "1:02:33" / 纯数字 → 秒；无法解析返回 0 #>
    param([string]$Value)
    if (-not $Value) { return 0 }
    $v = ([string]$Value).Trim()
    if ($v -match '^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$') {
        return [int]([double]$Matches[1] * 3600 + [double]$Matches[2] * 60 + [double]$Matches[3])
    }
    if ($v -match '^(\d+):(\d+):(\d+(?:\.\d+)?)$') { return [int]([int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [double]$Matches[3]) }
    if ($v -match '^(\d+):(\d+(?:\.\d+)?)$') { return [int]([int]$Matches[1] * 60 + [double]$Matches[2]) }
    if ($v -match '^\d+(?:\.\d+)?$') { return [int][double]$v }
    return 0
}

function Repair-SourceFields {
    <#  旧库没有 source/source_id：补成默认源，保证多源逻辑有值可用  #>
    $changed = 0
    foreach ($r in @($State.Ledger)) {
        if (-not $r.source) { $r.source = 'pektino'; $changed++ }
        if (-not $r.source_id) { $r.source_id = [string]$r.token; $changed++ }
    }
    if ($changed -gt 0) { Save-Ledger -Rows @($State.Ledger) -NoSnapshot; Touch-State }
    return $changed
}

function Repair-Statuses {
    <#  旧状态迁移：sent（迅雷投递）/ downloading（下载中）已经并回 new / done；
        ignored（忽略）并入回收站 recycled  #>
    $n = 0
    foreach ($r in @($State.Ledger)) {
        if ($r.status -eq 'sent' -or $r.status -eq 'downloading') {
            $r.status = if ($r.file_name) { 'done' } else { 'new' }
            $n++
        } elseif ($r.status -eq 'ignored') {
            $r.status = 'recycled'
            $n++
        }
    }
    if ($n -gt 0) {
        Save-Ledger -Rows $State.Ledger -Path $LedgerPath
        if (Get-Command Touch-State -ErrorAction SilentlyContinue) { Touch-State }
        if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log 'ledger' "状态迁移 $n 条（sent/downloading → new/done）" }
    }
    return $n
}

function Repair-Durations {
    <#  历史数据里 seconds 存成 "0"（时长解析失败）的，用 duration 回算并写回  #>
    param([string]$LedgerPath)
    $n = 0
    foreach ($r in @($State.Ledger)) {
        $sec = 0
        if ($r.seconds) { try { $sec = [int]$r.seconds } catch { $sec = 0 } }
        if ($sec -gt 0) { continue }
        if (-not $r.duration) { continue }
        $calc = ConvertTo-Seconds $r.duration
        if ($calc -gt 0) { $r.seconds = $calc; $n++ }
    }
    if ($n -gt 0) {
        Save-Ledger -Rows $State.Ledger -Path $LedgerPath
        # 启动早期调用时 Touch-State / Write-Log 可能还没加载，别让它们把修正结果吞掉
        if (Get-Command Touch-State -ErrorAction SilentlyContinue) { Touch-State }
        if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log 'ledger' "修正时长字段 $n 条（seconds 原来是 0）" }
    }
    return $n
}