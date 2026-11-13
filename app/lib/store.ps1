#Requires -Version 5.1
<#
.SYNOPSIS
  SQLite 存储层：台账的事实来源（out\data.db），CSV 只作为导出快照。

.DESCRIPTION
  以前 ledger.csv 是唯一存储，每次改动全量重写，写一半崩溃就报废。
  现在：
    - 所有读写走 SQLite（WAL），一次事务内 upsert，崩溃不会损坏
    - CSV 变成“快照/导出”，每 30 秒或退出时原子写一次（temp + replace，保留 .bak）
    - 首次启动时自动把已有 ledger.csv 迁移进库

  对外暴露的接口保持与旧 ledger.ps1 一致，console.ps1 无需大改。
#>

$script:DbConn = $null
$script:DbPath = $null
$script:LastSnapshot = [datetime]::MinValue
# 写入计数（200 次一 checkpoint）；显式初始化，别依赖 $null + 1 的隐式行为
$script:SaveCount = 0

function Get-DbPath {
    param([string]$Root = $PSScriptRoot, [string]$DataDir = '')
    if ($DataDir) { return (Join-Path $DataDir 'data.db') }
    Join-Path $Root 'data\data.db'
}

function Initialize-Store {
    param([string]$Root = $PSScriptRoot, [string]$DataDir = '')

    $lib = Join-Path $Root 'lib\System.Data.SQLite.dll'
    if (-not ('System.Data.SQLite.SQLiteConnection' -as [type])) {
        if (-not (Test-Path $lib)) { throw "缺少 System.Data.SQLite.dll: $lib" }
        Add-Type -Path $lib
    }

    $script:DbPath = Get-DbPath -Root $Root -DataDir $DataDir
    $dir = Split-Path $script:DbPath -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $script:DbConn = New-Object System.Data.SQLite.SQLiteConnection("Data Source=$($script:DbPath);Version=3;Cache Size=8000;Journal Mode=WAL;Synchronous=NORMAL;")
    $script:DbConn.Open()

    $schema = @'
CREATE TABLE IF NOT EXISTS items (
  token      TEXT PRIMARY KEY,
  status     TEXT DEFAULT 'new',
  fav        TEXT DEFAULT '',
  rank       TEXT DEFAULT '',
  page       TEXT DEFAULT '',
  duration   TEXT DEFAULT '',
  seconds    TEXT DEFAULT '',
  res        TEXT DEFAULT '',
  views      TEXT DEFAULT '',
  likes      TEXT DEFAULT '',
  uploaded   TEXT DEFAULT '',
  url        TEXT DEFAULT '',
  page_url   TEXT DEFAULT '',
  site       TEXT DEFAULT 'pektino',
  first_seen TEXT DEFAULT '',
  last_seen  TEXT DEFAULT '',
  sent_at    TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  file_name  TEXT DEFAULT '',
  file_size  TEXT DEFAULT '',
  file_date  TEXT DEFAULT '',
  play_count TEXT DEFAULT '',
  last_play  TEXT DEFAULT '',
  rating     TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_items_fav ON items(fav);
'@
    $cmd = $script:DbConn.CreateCommand()
    $cmd.CommandText = $schema
    [void]$cmd.ExecuteNonQuery()

    # 老库补列（SQLite 没有 ADD COLUMN IF NOT EXISTS）
    $have = @{}
    $cmd.CommandText = 'PRAGMA table_info(items)'
    $r = $cmd.ExecuteReader()
    while ($r.Read()) { $have[[string]$r.GetValue(1)] = $true }
    $r.Close()
    foreach ($col in @('play_count', 'last_play', 'rating', 'fav', 'file_name', 'file_size', 'file_date')) {
        if (-not $have.ContainsKey($col)) {
            $cmd.CommandText = "ALTER TABLE items ADD COLUMN $col TEXT DEFAULT ''"
            [void]$cmd.ExecuteNonQuery()
        }
    }
    $cmd.Dispose()

    return $script:DbConn
}

function Close-Store {
    if ($script:DbConn) {
        try { Invoke-DbMaintenance -Checkpoint } catch { }
        try { $script:DbConn.Close(); $script:DbConn.Dispose() } catch { }
        $script:DbConn = $null
    }
}

function Invoke-DbMaintenance {
    <#
      -Checkpoint : 把 WAL 合并回主库并截断（否则 WAL 会一直长）
      -Backup     : 每天用 VACUUM INTO 复制一份完整快照，保留最近 3 份
    #>
    param([switch]$Checkpoint, [switch]$Backup)

    $conn = Get-StoreConnection

    if ($Checkpoint) {
        $cmd = $conn.CreateCommand()
        $cmd.CommandText = 'PRAGMA wal_checkpoint(TRUNCATE)'
        try { [void]$cmd.ExecuteNonQuery() } catch { }
        $cmd.Dispose()
    }

    if ($Backup) {
        $dir = Split-Path $script:DbPath -Parent
        $dest = Join-Path $dir ("data-{0}.db" -f (Get-Date -Format 'yyyyMMdd'))
        if (-not (Test-Path $dest)) {
            $cmd = $conn.CreateCommand()
            $cmd.CommandText = "VACUUM INTO '$($dest.Replace("'", "''"))'"
            try { [void]$cmd.ExecuteNonQuery() } catch { }
            $cmd.Dispose()
            # 只留最近 3 份
            $olds = @(Get-ChildItem -Path $dir -Filter 'data-*.db' -File | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3)
            foreach ($o in $olds) { Remove-Item $o.FullName -Force -ErrorAction SilentlyContinue }
        }
    }
}

function Get-StoreConnection {
    if (-not $script:DbConn) { throw 'store 未初始化，先调用 Initialize-Store' }
    $script:DbConn
}

function Get-StoreItems {
    $conn = Get-StoreConnection
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = 'SELECT token,status,fav,rank,page,duration,seconds,res,views,likes,uploaded,url,page_url,first_seen,last_seen,sent_at,note,file_name,file_size,file_date,play_count,last_play,rating FROM items ORDER BY CAST(rank AS INTEGER) ASC, token ASC'
    $r = $cmd.ExecuteReader()
    $rows = New-Object System.Collections.ArrayList
    while ($r.Read()) {
        $o = [pscustomobject]@{}
        for ($i = 0; $i -lt $r.FieldCount; $i++) {
            $v = if ($r.IsDBNull($i)) { '' } else { [string]$r.GetValue($i) }
            $o | Add-Member -NotePropertyName $r.GetName($i) -NotePropertyValue $v
        }
        [void]$rows.Add($o)
    }
    $r.Close(); $cmd.Dispose()
    return @($rows)
}

function Save-StoreItems {
    param($Rows)

    $conn = Get-StoreConnection
    $cols = 'token','status','fav','rank','page','duration','seconds','res','views','likes','uploaded','url','page_url','first_seen','last_seen','sent_at','note','file_name','file_size','file_date','play_count','last_play','rating'
    $sql = "INSERT OR REPLACE INTO items ($($cols -join ',')) VALUES ($(($cols | ForEach-Object { '@' + $_ }) -join ','))"

    $tx = $conn.BeginTransaction()
    try {
        $cmd = $conn.CreateCommand()
        $cmd.Transaction = $tx
        $cmd.CommandText = $sql
        foreach ($c in $cols) { [void]$cmd.Parameters.AddWithValue('@' + $c, '') }
        foreach ($row in @($Rows)) {
            if (-not $row.token) { continue }
            foreach ($c in $cols) {
                $v = $row.$c
                if ($null -eq $v) { $v = '' }
                $cmd.Parameters['@' + $c].Value = [string]$v
            }
            [void]$cmd.ExecuteNonQuery()
        }
        $tx.Commit()
        $cmd.Dispose()

        # 每 200 次写入做一次被动 checkpoint，避免 WAL 无限增长
        $script:SaveCount++
        if ($script:SaveCount % 200 -eq 0) {
            try {
                $ck = $conn.CreateCommand()
                $ck.CommandText = 'PRAGMA wal_checkpoint(PASSIVE)'
                [void]$ck.ExecuteNonQuery()
                $ck.Dispose()
            } catch { }
        }
    } catch {
        $tx.Rollback()
        throw
    } finally {
        $tx.Dispose()
    }
}

function Remove-StoreItems {
    param([string[]]$Tokens)
    if (-not $Tokens) { return 0 }
    $conn = Get-StoreConnection
    $n = 0
    $tx = $conn.BeginTransaction()
    try {
        $cmd = $conn.CreateCommand()
        $cmd.Transaction = $tx
        $cmd.CommandText = 'DELETE FROM items WHERE token = @t'
        [void]$cmd.Parameters.AddWithValue('@t', '')
        foreach ($t in $Tokens) { $cmd.Parameters['@t'].Value = $t; $n += $cmd.ExecuteNonQuery() }
        $tx.Commit(); $cmd.Dispose()
    } catch { $tx.Rollback(); throw } finally { $tx.Dispose() }
    return $n
}

function Get-StoreCount {
    $conn = Get-StoreConnection
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = 'SELECT COUNT(1) FROM items'
    $n = [int]$cmd.ExecuteScalar()
    $cmd.Dispose()
    return $n
}

# ---------------- CSV 快照（原子写 + 每日备份） ----------------

function Write-CsvSnapshot {
    param($Rows, [string]$Path, [switch]$Force)
    if (-not $Path) { return }

    $now = Get-Date
    if (-not $Force -and ($now - $script:LastSnapshot).TotalSeconds -lt 30) { return }

    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $tmp = "$Path.tmp"

    $cols = 'token','status','fav','rank','page','duration','seconds','res','views','likes','uploaded','url','page_url','first_seen','last_seen','sent_at','note','file_name','file_size','file_date','play_count','last_play','rating'
    @($Rows) | Select-Object $cols | Export-Csv -Path $tmp -NoTypeInformation -Encoding UTF8

    # 每日备份一份
    $bak = Join-Path $dir ("ledger-{0}.bak.csv" -f $now.ToString('yyyyMMdd'))
    if (-not (Test-Path $bak) -and (Test-Path $Path)) { Copy-Item $Path $bak -Force }

    Move-Item -Path $tmp -Destination $Path -Force
    $script:LastSnapshot = $now
}

function Import-CsvIntoStore {
    param([string]$CsvPath)
    if (-not (Test-Path $CsvPath)) { return 0 }
    if ((Get-StoreCount) -gt 0) { return 0 }
    $rows = @(Import-Csv -Path $CsvPath -Encoding UTF8)
    if ($rows.Count -eq 0) { return 0 }
    Save-StoreItems -Rows $rows
    return $rows.Count
}