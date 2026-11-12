#Requires -Version 5.1
<#
.SYNOPSIS
  台账（ledger）读写、去重合并、内容目录扫描。被 console.ps1 与命令行共用。

.DESCRIPTION
  out\ledger.csv 是唯一事实来源：
    - token 是唯一键；重复抓取只更新元数据，保留 status / first_seen / sent_at / fav
    - status: new(待下载) / sent(已投迅雷) / done(已完成) / ignored(忽略)
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

function Save-Ledger {
    param($Rows, [string]$Path, [switch]$ForceSnapshot, [switch]$NoSnapshot)
    if (-not $Path) { $Path = Get-LedgerPath }

    if ($script:DbConn) {
        Save-StoreItems -Rows @($Rows)
        if (-not $NoSnapshot) { Write-CsvSnapshot -Rows @($Rows) -Path $Path -Force:$ForceSnapshot }
        return
    }

    # 没有 store 时退化为原子写 CSV（临时文件 + 替换），避免写一半损坏
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.tmp"
    @($Rows) | Select-Object $script:LedgerColumns | Export-Csv -Path $tmp -NoTypeInformation -Encoding UTF8
    Move-Item -Path $tmp -Destination $Path -Force
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
            foreach ($f in @('rank', 'page', 'duration', 'seconds', 'res', 'views', 'likes', 'uploaded', 'url', 'page_url')) {
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
                first_seen = $Stamp; last_seen = $Stamp; sent_at = ''; note = ''
                file_name = ''; file_size = ''; file_date = ''
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
            if ($Status -eq 'sent') { $r.sent_at = $stamp }
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
        if (-not $c.contentDir) { $c | Add-Member -NotePropertyName contentDir -NotePropertyValue $default.contentDir -Force }
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
    $Config | ConvertTo-Json -Depth 4 | Set-Content -Path $p -Encoding UTF8
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

    foreach ($f in @(Get-ChildItem -Path $Dir -Filter *.xltd -File -ErrorAction SilentlyContinue)) {
        [void]$partial.Add([pscustomobject]@{ name = $f.Name; size = $f.Length })
    }

    return [pscustomobject]@{ Files = $index; Partial = @($partial); Dir = $Dir; Exists = $true }
}