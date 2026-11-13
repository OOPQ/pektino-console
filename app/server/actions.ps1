#Requires -Version 5.1
# Business actions: stats, scan, jobs, fav/rate/watch, play, delete, send

function ConvertTo-QuotedArg {
    <#
      Start-Process -ArgumentList 会把数组元素按空格直接拼成命令行，不会自动加引号。
      路径里只要有空格（C:\Users\张三\OneDrive\文档\pektino），参数就会被拆开：
      下载器起不来、资源管理器打开错位置。所有传路径的地方都要先过这个函数。
    #>
    param([string]$Value)
    if ($null -eq $Value -or $Value -eq '') { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Get-Stats {
    <#
      /api/state 每次轮询都要算一次。以前用 7 遍 Where-Object 扫全表（O(7n)），
      台账几千行时是明显的纯开销；现在一次遍历算完。
    #>
    $rows = @($State.Ledger)
    $counts = @{ new = 0; done = 0; ignored = 0; failed = 0 }
    $resCount = @{}
    $secs = 0
    $bytes = 0.0
    $onDisk = 0
    $watched = 0
    $toWatch = 0
    $favorites = 0
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $todayAdded = 0
    $lastSeen = ''

    foreach ($r in $rows) {
        $st = [string]$r.status
        if ($counts.ContainsKey($st)) { $counts[$st]++ }
        if ($r.seconds) { $secs += [int]$r.seconds }
        if ($r.file_size) { $bytes += [double]$r.file_size }
        if ($r.file_name) {
            $onDisk++
            if (-not $r.last_play) { $toWatch++ }
        }
        if ($r.last_play) { $watched++ }
        if ($r.fav -eq '1') { $favorites++ }
        if ($r.first_seen -like "$today*") { $todayAdded++ }
        if ($r.res) {
            $k = [string]$r.res
            $resCount[$k] = 1 + [int]$resCount[$k]
        }
        # 时间格式是 yyyy-MM-dd HH:mm:ss，字符串比较等价于时间比较
        if ($r.last_seen -and ([string]$r.last_seen -gt $lastSeen)) { $lastSeen = [string]$r.last_seen }
    }

    $resGroups = @($resCount.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 6 |
        ForEach-Object { [pscustomobject]@{ res = $_.Key; count = $_.Value } })

    $orphans = @()
    if ($State.Scan) { $orphans = @($State.Scan.orphans) }

    [pscustomobject]@{
        total       = $rows.Count
        new         = $counts['new']
        done        = $counts['done']
        ignored     = $counts['ignored']
        failed      = $counts['failed']
        hours       = [math]::Round($secs / 3600, 2)
        todayAdded  = $todayAdded
        byRes       = $resGroups
        ledgerPath  = $LedgerPath
        lastSeen    = $lastSeen
        busy        = $State.Busy
        downloaded  = $onDisk
        missing     = $rows.Count - $onDisk
        favorites   = $favorites
        coverMissing = if ($State.Scan -and $null -ne $State.Scan.coverMissing) { [int]$State.Scan.coverMissing } else { 0 }
        watched     = $watched
        # 只把"有文件且没看过"算作待看，和前端 towatch 过滤口径一致
        toWatch     = $toWatch
        diskGB      = [math]::Round($bytes / 1GB, 2)
        contentDir = $Config.contentDir
        dirExists   = [bool]$State.Files.Exists
        fileCount   = @($State.Files.Files.Keys).Count
        partialCount = @($State.Files.Partial).Count
        dirGB       = if ($State.Scan) { $State.Scan.totalGB } else { 0 }
        orphans     = @($orphans | Select-Object -First 30)
        orphanCount = $orphans.Count
        lastScan    = if ($State.Scan) { $State.Scan.lastScan } else { '' }
    }
}

function Invoke-Scan {
    param([switch]$Silent, [switch]$KeepStatus)
    $idx = Get-DownloadIndex -Dir $Config.contentDir
    # 目录不可达（移动硬盘没挂载/被改名）时绝不清台账里的文件状态，
    # 否则每 10 秒一次的自动扫描会把 done 全部打回 new
    if (-not $idx.Exists) {
        if ($State.Scan) { return $State.Scan }
        return [pscustomobject]@{ ok = $true; files = 0; downloaded = 0; missing = @($State.Ledger).Count; changed = 0; partial = 0; dir = $Config.contentDir; exists = $false; orphans = @() }
    }
    $State.Files = $idx
    $changed = 0
    $found = 0
    foreach ($r in @($State.Ledger)) {
        $key = ([string]$r.token).ToLower()
        if ($key -and $idx.Files.ContainsKey($key)) {
            $f = $idx.Files[$key]
            $r.file_name = $f.name
            $r.file_size = $f.size
            $r.file_date = $f.date
            $found++
            # 磁盘上有文件 → 一律以文件为准
            if ($r.status -ne 'done') {
                $r.status = 'done'
                $r.note = 'auto:file'
                $changed++
            }
        } else {
            if ($r.file_name) { $r.file_name = ''; $r.file_size = ''; $r.file_date = ''; $changed++ }
            if (-not $KeepStatus -and $r.status -eq 'done' -and ($r.note -eq 'auto:file' -or $r.note -eq 'scan:init')) {
                $r.status = 'new'
                $r.note = ''
                $changed++
            }
        }
    }

    $ledgerKeys = @{}
    foreach ($r in @($State.Ledger)) { $ledgerKeys[([string]$r.token).ToLower()] = $true }
    $orphans = @()
    foreach ($k in @($idx.Files.Keys)) {
        if (-not $ledgerKeys.ContainsKey($k)) { $orphans += $idx.Files[$k] }
    }

    # 旧版本把死链标成 ignored，这里统一迁到 failed（可在「失败」里查看/重试）
    foreach ($r in @($State.Ledger)) {
        if ($r.status -eq 'ignored' -and ($r.note -like 'dead:*' -or $r.note -like 'unreachable*' -or $r.note -like 'removed*')) { $r.status = 'failed'; $changed++ }
        # 旧措辞迁移：dead:http:x → unreachable:http:x；removed → removed:site
        if ($r.note -like 'dead:http:*') { $r.note = 'unreachable' + $r.note.Substring(4); $changed++ }
        elseif ($r.note -eq 'removed') { $r.note = 'removed:site'; $changed++ }
    }
    if ($changed -gt 0) { Save-Ledger -Rows $State.Ledger -Path $LedgerPath; Touch-State }

    # 缺封面统计要遍历全表逐条 Test-Path；扫描本身 10 秒一次，这里 30 秒算一次就够
    $prev = $State.Scan
    $cmAt = if ($prev -and $prev.coverMissingAt) { [datetime]$prev.coverMissingAt } else { [datetime]::MinValue }
    if ($prev -and ((Get-Date) - $cmAt).TotalSeconds -lt 30) {
        $coverMissing = [int]$prev.coverMissing
        $coverMissingAt = $prev.coverMissingAt
    } else {
        $coverMissing = (Get-CoverMissingList).Count
        $coverMissingAt = (Get-Date).ToString('s')
    }
    $State.Scan = [pscustomobject]@{
        coverMissing = $coverMissing
        coverMissingAt = $coverMissingAt
        downloaded = $found
        missing    = (@($State.Ledger).Count - $found)
        changed    = $changed
        files      = @($idx.Files.Keys).Count
        partial    = @($idx.Partial).Count
        dir        = $Config.contentDir
        exists     = [bool]$idx.Exists
        totalGB    = [math]::Round((($idx.Files.Values | Measure-Object -Property size -Sum).Sum) / 1GB, 2)
        orphans    = $orphans
        lastScan   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }

    if (-not $Silent) {
        Write-Log 'scan' "扫描 $($Config.contentDir)：已下载 $found / 台账 $(@($State.Ledger).Count)，变更 $changed，孤立文件 $($orphans.Count)"
    }
    return $State.Scan
}

function Start-Scrape {
    param(
        [string]$Rank = 'daily',
        [int[]]$Pages = @(1, 2, 3),
        [int]$Limit = 0,
        [int]$Threads = 8,
        [bool]$Incremental = $true,
        [int]$FreshDays = 3
    )

    if ($State.Job) { return @{ ok = $false; error = '已有抓取任务在跑，等它结束' } }
    $dir = Split-Path $TmpCsv -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Remove-Item $ProgressFile -Force -ErrorAction SilentlyContinue
    Remove-Item $KnownFile -Force -ErrorAction SilentlyContinue

    $skipped = 0
    if ($Incremental) {
        $cutoff = (Get-Date).AddDays(-$FreshDays)
        $fresh = New-Object System.Collections.ArrayList
        foreach ($r in @($State.Ledger)) {
            if (-not $r.url) { continue }
            $ls = '' 
            try { if ($r.last_seen) { $ls = [datetime]::ParseExact($r.last_seen, 'yyyy-MM-dd HH:mm:ss', $null) } } catch { }
            if ($ls -and $ls -gt $cutoff) { [void]$fresh.Add($r.token) }
        }
        if ($fresh.Count -gt 0) { $fresh | Set-Content -Path $KnownFile -Encoding UTF8 }
        $skipped = $fresh.Count
    }

    $ps = $Pektino; $out = $TmpCsv; $prog = $ProgressFile; $cov = $CoverDir
    $thm = $ThumbDir; $kn = $KnownFile
    $job = Start-Job -ScriptBlock {
        param($ps, $rank, $pages, $limit, $out, $prog, $cov, $thm, $kn, $threads)
        $p = @{ Rank = $rank; Page = $pages; Out = $out; ProgressFile = $prog; CoverDir = $cov; ThumbDir = $thm; Threads = $threads }
        if ($limit -gt 0) { $p['Limit'] = $limit }
        if ($kn -and (Test-Path $kn)) { $p['KnownFile'] = $kn }
        & $ps @p *> $null
    } -ArgumentList $ps, $Rank, $Pages, $Limit, $out, $prog, $cov, $thm, $kn, $Threads

    $State.Job = [pscustomobject]@{
        handle  = $job
        kind    = 'scrape'
        started = Get-Date
        rank    = $Rank
        pages   = $Pages
        threads = $Threads
    }
    $ic = if ($Incremental) { "增量（跳过 $skipped 条 $FreshDays 天内已抓取的）" } else { '全量' }
    Write-Log 'scrape' "开始抓取 $Rank p$($Pages -join ',')：$ic，并发 $Threads，封面+缩略图，SQLite"
    Touch-State
    return @{ ok = $true; started = $true; incremental = $Incremental; skipped = $skipped }
}

# ---------- 业务动作 ----------
function Start-Import {
    param([string[]]$Tokens, [int]$Threads = 8)

    if ($State.Job) { return @{ ok = $false; error = '已有抓取/导入任务在跑，等它结束' } }
    $dir = Split-Path $TmpCsv -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Remove-Item $ProgressFile -Force -ErrorAction SilentlyContinue

    $script = Join-Path $Root 'cli\import.ps1'
    $dl = $Config.contentDir; $out = $TmpCsv; $prog = $ProgressFile; $cov = $CoverDir; $thm = $ThumbDir
    $job = Start-Job -ScriptBlock {
        param($script, $dl, $tokens, $out, $prog, $cov, $thm, $threads)
        $p = @{ Dir = $dl; Out = $out; CoverDir = $cov; ThumbDir = $thm; Threads = $threads; ProgressFile = $prog }
        if ($tokens -and $tokens.Count -gt 0) { $p['Tokens'] = $tokens }
        & $script @p *> $null
    } -ArgumentList $script, $dl, $Tokens, $out, $prog, $cov, $thm, $Threads

    $State.Job = [pscustomobject]@{
        handle  = $job
        kind    = 'import'
        started = Get-Date
        rank    = 'import'
        pages   = @()
        threads = $Threads
    }
    Write-Log 'import' "开始扫描本地文件入库（$dl，并发 $Threads）"
    Touch-State
    return @{ ok = $true; started = $true }
}

function Update-Job {
    if (-not $State.Job) { return }
    $j = $State.Job.handle
    if ($j.State -eq 'Running' -or $j.State -eq 'NotStarted') { return }

    $secs = [math]::Round(((Get-Date) - $State.Job.started).TotalSeconds, 1)
    $kind = $State.Job.kind
    if ($j.State -eq 'Completed') {
        if (Test-Path $TmpCsv) {
            $mergeOk = $false
            try {
                $scraped = @(Import-Csv $TmpCsv -Encoding UTF8)
                $merged = Merge-Ledger -Existing $State.Ledger -Scraped $scraped
                $State.Ledger = @($merged.Rows)
                Save-Ledger -Rows $State.Ledger -Path $LedgerPath
                [void](Invoke-Scan -Silent)
                $mergeOk = $true
                if ($kind -eq 'import') {
                    Write-Log 'import' "本地入库完成（$secs s）：新增 $($merged.Added)，更新 $($merged.Updated)，可识别 $($scraped.Count) 个文件"
                } else {
                    Write-Log 'scrape' "抓取完成（$secs s）：新增 $($merged.Added)，更新 $($merged.Updated)，共 $($scraped.Count) 条"
                }
            } catch {
                Write-Log 'error' "导入结果失败（保留 CSV 待重试）: $($_.Exception.Message)"
            }
            # 合并/落盘失败时保留抓取结果，别把整轮数据删掉
            if ($mergeOk) { Remove-Item $TmpCsv -Force -ErrorAction SilentlyContinue }
        } else {
            Write-Log 'error' "$kind 结束但没有产出 CSV"
        }
    } else {
        $detail = ''
        try { $detail = (@($j.ChildJobs[0].Error) | Select-Object -First 1).ToString() } catch { }
        Write-Log 'error' "$kind 任务失败（$($j.State)）：$detail"
    }

    Remove-Job $j -Force -ErrorAction SilentlyContinue
    $State.Job = $null
    Touch-State
}

function Stop-CurrentJob {
    if (-not $State.Job) { return @{ ok = $false; error = '当前没有在跑的任务' } }
    $kind = $State.Job.kind
    try { Stop-Job $State.Job.handle -ErrorAction SilentlyContinue } catch { }
    try { Remove-Job $State.Job.handle -Force -ErrorAction SilentlyContinue } catch { }
    $State.Job = $null
    Remove-Item $ProgressFile -Force -ErrorAction SilentlyContinue
    Write-Log 'cancel' "已取消 $kind 任务"
    Touch-State
    return @{ ok = $true; kind = $kind }
}

function Get-JobInfo {
    $prog = $null
    if (Test-Path $ProgressFile) {
        try { $prog = Get-Content $ProgressFile -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
    }
    $running = [bool]$State.Job
    $elapsed = 0
    if ($State.Job) { $elapsed = [math]::Round(((Get-Date) - $State.Job.started).TotalSeconds, 1) }
    [pscustomobject]@{
        running = $running
        elapsed = $elapsed
        rank    = if ($State.Job) { $State.Job.rank } else { '' }
        pages   = if ($State.Job) { @($State.Job.pages) } else { @() }
        progress = $prog
    }
}

# ---------- 收藏 / 本地播放 ----------
function Invoke-Fav {
    param([string[]]$Tokens, [bool]$On)
    if (-not $Tokens) { return @{ ok = $false; error = '没选条目' } }
    $changed = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        if ($Tokens -contains $r.token) { $r.fav = if ($On) { '1' } else { '' }; [void]$changed.Add($r) }
    }
    if ($changed.Count -gt 0) { Save-Ledger -Rows @($changed) -NoSnapshot; Touch-State }
    Write-Log 'fav' "$(if ($On) { '收藏' } else { '取消收藏' }) $($changed.Count) 条"
    return @{ ok = $true; count = $changed.Count; on = $On }
}

function Invoke-Mark {
    param([string[]]$Tokens, [string]$Status = 'done', [string]$Note = '')
    if (-not $Tokens) { return @{ ok = $false; error = '没选条目' } }
    if (@('new', 'done', 'ignored', 'failed') -notcontains $Status) { return @{ ok = $false; error = "非法状态: $Status" } }
    $changed = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        if ($Tokens -contains $r.token) { [void]$changed.Add($r) }
    }
    $n = Set-LedgerStatus -Rows @($changed) -Tokens $Tokens -Status $Status -Note $Note
    if ($n -gt 0) { Save-Ledger -Rows @($changed) -NoSnapshot; Touch-State }
    Write-Log 'mark' "标记 $n 条为 $Status"
    return @{ ok = $true; count = $n }
}

function Invoke-Rate {
    param([string[]]$Tokens, [int]$Value)
    if (-not $Tokens) { return @{ ok = $false; error = '没选条目' } }
    $v = [Math]::Max(0, [Math]::Min(5, $Value))
    $changed = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        if ($Tokens -notcontains $r.token) { continue }
        $r.rating = if ($v -gt 0) { [string]$v } else { '' }
        [void]$changed.Add($r)
    }
    if ($changed.Count -gt 0) { Save-Ledger -Rows @($changed) -NoSnapshot; Touch-State }
    Write-Log 'rate' "$(if ($v -gt 0) { "打 $v 星" } else { '清除评分' }) $($changed.Count) 条"
    return @{ ok = $true; count = $changed.Count; value = $v }
}

function Invoke-Watched {
    param([string[]]$Tokens, [bool]$On)
    if (-not $Tokens) { return @{ ok = $false; error = '没选条目' } }
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $changed = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        if ($Tokens -notcontains $r.token) { continue }
        if ($On) {
            if (-not $r.last_play) { $r.last_play = $stamp }
            if (-not $r.play_count -or [int]$r.play_count -lt 1) { $r.play_count = '1' }
        } else {
            $r.last_play = ''
            $r.play_count = '0'
        }
        [void]$changed.Add($r)
    }
    if ($changed.Count -gt 0) { Save-Ledger -Rows @($changed) -NoSnapshot; Touch-State }
    Write-Log 'watched' "$(if ($On) { '标记已看' } else { '标记未看' }) $($changed.Count) 条"
    return @{ ok = $true; count = $changed.Count; on = $On }
}

function Invoke-DeleteFiles {
    param([string[]]$Tokens, [switch]$Purge, [switch]$Permanent)
    if (-not $Tokens) { return @{ ok = $false; error = '没选条目' } }

    $rows = @($State.Ledger | Where-Object { $Tokens -contains $_.token })
    if ($rows.Count -eq 0) { return @{ ok = $false; error = '台账里没有这些条目' } }

    $deleted = 0
    $freed = 0
    $failed = @()
    $doneTokens = @()     # 真正删掉（或确认本来就不存在）的条目
    $missingTokens = @()  # 目录里找不到文件、但仍要清台账态的

    foreach ($r in $rows) {
        $file = Resolve-RowFile $r
        if (-not $file -or -not (Test-Path $file)) {
            # 文件不在：如果台账也没记录过文件，就当作"无文件可删"，可以清状态；
            # 记录过文件但找不到，先不动，避免目录不可达时误清
            if (-not $r.file_name) { $missingTokens += $r.token }
            else { $failed += "$($r.token): 台账记录有文件但磁盘上找不到（可能目录不可达），已跳过" }
            continue
        }
        # 只允许删内容目录内的文件；末尾必须带分隔符，
        # 否则 D:\media 会「包含」D:\media2（前缀匹配而不是目录包含）
        $rootFull = [System.IO.Path]::GetFullPath($Config.contentDir).TrimEnd('\') + '\'
        $fileFull = [System.IO.Path]::GetFullPath($file)
        if (-not $fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            $failed += "$($r.token): 不在内容目录内，已跳过"
            continue
        }
        try {
            $size = (Get-Item $file).Length
            if ($Permanent) {
                Remove-Item -LiteralPath $file -Force
            } else {
                Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction SilentlyContinue
                [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                    $file,
                    [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                    [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin)
            }
            $deleted++
            $freed += $size
            $doneTokens += $r.token
        } catch {
            $failed += "$($r.token): $($_.Exception.Message)"
        }
    }

    # 只处理"确实删掉了 / 本来就没文件"的条目；删除失败（文件被占用等）保持原状
    $okTokens = @($doneTokens + $missingTokens)
    if ($Purge) {
        $rm = 0
        if ($okTokens.Count -gt 0) {
            $rm = Remove-StoreItems -Tokens $okTokens
            $State.Ledger = @($State.Ledger | Where-Object { $okTokens -notcontains $_.token })
            # 删库不走 Save-Ledger，得手动记一次行数据版本，否则前端不会重新拉 rows
            if ($rm -gt 0) { Touch-Ledger }
        }
        Write-Log 'delete' "删除文件 $deleted 个，从台账移除 $rm 条"
    } else {
        $changed = 0
        foreach ($r in $rows) {
            if ($okTokens -notcontains $r.token) { continue }
            if ($r.file_name) { $r.file_name = ''; $r.file_size = ''; $r.file_date = ''; $changed++ }
            if ($r.status -eq 'done') { $r.status = 'new'; $changed++ }
            $r.note = 'file:deleted'
        }
        if ($changed -gt 0) { Save-Ledger -Rows $rows -NoSnapshot }
        Write-Log 'delete' "删除本地文件 $deleted 个，释放 $(Format-Size $freed)"
    }

    if ($failed.Count -gt 0) { foreach ($m in $failed) { Write-Log 'error' "删除失败 $m" } }
    Touch-State
    return @{
        ok      = $true
        deleted = $deleted
        freed   = $freed
        renamed = 0
        purged  = [bool]$Purge
        failed  = @($failed)
    }
}

function Format-Size {
    param([double]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N1} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N0} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

function Resolve-RowFile {
    param($Row)
    if (-not $Row) { return $null }
    $key = ([string]$Row.token).ToLower()
    try {
        if ($State.Files -and $State.Files.Files -and $State.Files.Files.ContainsKey($key)) {
            return $State.Files.Files[$key].file
        }
    } catch { }
    return $null
}

function Invoke-Play {
    param([string]$Token, [switch]$Reveal, [switch]$NoRecord)
    $row = @($State.Ledger | Where-Object { $_.token -eq $Token }) | Select-Object -First 1
    if (-not $row) { return @{ ok = $false; error = '台账里没有这个条目' } }
    $file = Resolve-RowFile $row
    if (-not $file -or -not (Test-Path $file)) { return @{ ok = $false; error = '本地还没有这个文件（先下载）' } }
    try {
        if ($Reveal) {
            Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$file`""
            Write-Log 'play' "资源管理器定位 $($row.token)"
        } else {
            Start-Process -FilePath $file
            if (-not $NoRecord) {
                $n = 0
                try { $n = [int]$row.play_count } catch { }
                $row.play_count = [string]($n + 1)
                $row.last_play = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
                Save-Ledger -Rows @($row) -NoSnapshot
                Touch-State
            }
            Write-Log 'play' "播放 $($row.token)（第 $($row.play_count) 次）"
        }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
    return @{ ok = $true; file = $file; name = [System.IO.Path]::GetFileName($file); plays = $row.play_count; last_play = $row.last_play }
}

# ---------------- 内置下载器 ----------------

function Get-DownloadProcesses {
    <#
      只认「本程序的下载器」，不再按名字模糊匹配：
        - powershell.exe 的命令行必须包含 cli\download.ps1 的**完整路径**
        - curl/aria2c 的命令行必须同时包含内容目录和 .mp4.part

      以前 powershell 只匹配 'download.ps1' 这个文件名，结果任何命令行里提到它的
      进程（编辑器、终端、测试脚本、甚至一段包含这串字的命令）都会被当成下载器，
      表现就是永远提示「已经有一个下载任务在跑」。
    #>
    $out = @()
    $scriptPath = [string]$DlScript
    $contentDir = [string]$Config.contentDir
    try {
        # 一次全量枚举再本地过滤：这台机器上 Get-CimInstance -Filter 单次约 300ms，
        # 三条过滤 900ms；全量枚举只要 150ms（415 个进程），反而快 6 倍。
        foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
            if (-not $p.CommandLine) { continue }
            $name = [string]$p.Name
            if ($name -eq 'powershell.exe') {
                if ($p.ProcessId -eq $PID) { continue }
                if (-not $scriptPath) { continue }
                if ($p.CommandLine.IndexOf($scriptPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $out += $p }
            } elseif ($name -eq 'curl.exe' -or $name -eq 'aria2c.exe') {
                if ($p.CommandLine -notmatch '\.mp4\.part') { continue }
                if ($contentDir -and $p.CommandLine.IndexOf($contentDir, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                $out += $p
            }
        }
    } catch { }
    return $out
}

$script:DlProbeAt = [datetime]::MinValue
$script:DlProbeAlive = $false

function Test-DownloadProcessCached {
    <#
      /api/state 每次都要回答「下载器还活着吗」，而进程探测是这条路径上最贵的一步
      （全量 CIM 枚举约 1s）。下载器是分钟级进程，15 秒缓存足够；需要精确结果时用 -Force。
    #>
    param([switch]$Force, [int]$MaxAgeSeconds = 15)

    if (-not $Force -and ((Get-Date) - $script:DlProbeAt).TotalSeconds -lt $MaxAgeSeconds) {
        return $script:DlProbeAlive
    }
    $script:DlProbeAt = Get-Date
    $script:DlProbeAlive = ((Get-DownloadProcesses).Count -gt 0)
    return $script:DlProbeAlive
}

function Reset-DownloadProbe {
    <#  刚杀完进程/刚起完进程时调用，别让 5 秒缓存给出过期答案  #>
    $script:DlProbeAt = [datetime]::MinValue
    $script:DlProbeAlive = $false
}

function Stop-AllDownloadProcesses {
    $procs = Get-DownloadProcesses
    $killed = 0
    foreach ($p in $procs) {
        if ($p.ProcessId -eq $PID) { continue }
        try {
            & taskkill.exe /PID $p.ProcessId /T /F 2>&1 | Out-Null
            $killed++
        } catch {
            try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $killed++ } catch { }
        }
    }
    if ($killed -gt 0) { Reset-DownloadProbe }
    return $killed
}

function Test-TrackedDownloader {
    <#  跟踪的下载器是否还活着：PID 与启动时间都要对得上。
        PID 会被系统复用，只比 PID 可能把别人的进程当成下载器 → 永远「已有任务在跑」。  #>
    if (-not $State.Download -or -not $State.Download.Pid) { return $false }
    $p = Get-Process -Id $State.Download.Pid -ErrorAction SilentlyContinue
    if (-not $p) { return $false }
    if ($State.Download.ProcStart) {
        try {
            if ($p.StartTime.ToString('s') -ne [string]$State.Download.ProcStart) { return $false }
        } catch { }
    }
    return $true
}

function Get-DownloadInfo {
    <#  返回下载器的当前状态：进程是否活着 + 进度文件内容 + 是否暂停  #>
    param([switch]$Fresh)
    $info = [ordered]@{ running = $false; paused = $false; phase = ''; total = 0; done = 0; failed = 0; queued = 0; pausedCount = 0; bytes = 0; speed = 0; active = @(); errors = @() }
    if (Test-Path $DlProgress) {
        try {
            $p = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($k in @('phase', 'total', 'done', 'failed', 'queued', 'pausedCount', 'bytes', 'speed')) {
                if ($null -ne $p.$k) { $info[$k] = $p.$k }
            }
            if ($null -ne $p.paused) { $info.paused = [bool]$p.paused }
            if ($p.active) { $info.active = @($p.active) }
            if ($p.errors) { $info.errors = @($p.errors) }
            if ($p.items) { $info.items = @($p.items) }
        } catch { }
    }
    $alive = Test-TrackedDownloader
    if (-not $alive -and -not $State.Download) {
        # 只有没有跟踪状态时，才需要探测孤儿进程（服务重启的情况）；探测走缓存
        $alive = Test-DownloadProcessCached -Force:$Fresh
    }
    $info.running = $alive
    $info.pid = if ($State.Download) { $State.Download.Pid } else { 0 }
    [pscustomobject]$info
}

function Start-Download {
    <#
      把选中/待下载条目交给内置下载器（独立进程，支持续传与并发）。
      如果已经有下载器在跑：新条目**追加**到它的队列里（下载器每轮 poll 追加文件），
      不再直接拒绝 —— 这就是「任务队列」语义。
    #>
    param($Tokens, [string]$Status = 'new', [int]$Limit = 0, [switch]$Force)

    # 快速路径：跟踪中的下载器直接判活，不再枚举进程（CIM 在这台机器上要 ~1s）。
    # 只有「服务重启后 State 丢失」时才需要探测孤儿进程，那一步放在启动时做一次。
    $running = Test-TrackedDownloader

    # 必须和启动时同一份配置（数据目录下的 config.json），否则下载会落到旧路径
    $cfg = Read-Config -Root $Root -DataDir $WS.DataDir -DefaultContentDir $WS.Content
    $dir = if ($cfg.contentDir) { [string]$cfg.contentDir } else { $WS.Content }
    # 配置里可能是相对路径（videos），按数据目录解析，避免落到进程当前目录
    if (-not [System.IO.Path]::IsPathRooted($dir)) {
        $dir = [System.IO.Path]::GetFullPath((Join-Path $WS.ProjectRoot $dir))
    }
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $targets = @()
    if ($Tokens) {
        $targets = @($State.Ledger | Where-Object { $_.url -and ($Tokens -contains $_.token) })
    } else {
        $targets = @($State.Ledger | Where-Object { $_.url -and -not $_.file_name -and $_.status -eq $Status })
    }
    # 失败/下架的条目：先把源地址刷新一遍（站点可能换了 CDN 路径）
    $stale = @($targets | Where-Object { $_.note -like 'dead:*' -or $_.note -like 'removed*' } | Select-Object -First 8)
    $skippedDead = 0
    if ($stale.Count -gt 0 -and -not $Force) {
        $null = Refresh-ItemUrls -Tokens @($stale | ForEach-Object { $_.token })
        # 刷新后仍下架（removed）或源仍 404/403（dead:http:*）→ 本轮跳过，别反复撞墙
        $still = @($targets | Where-Object { $_.note -like 'removed*' -or $_.note -like 'unreachable*' -or $_.note -like 'dead:http:*' })
        if ($still.Count -gt 0) {
            $skippedDead = $still.Count
            $targets = @($targets | Where-Object { $_.note -notlike 'removed*' -and $_.note -notlike 'unreachable*' -and $_.note -notlike 'dead:http:*' })
        }
    }

    if ($Limit -gt 0) { $targets = @($targets | Select-Object -First $Limit) }
    if (-not $targets.Count) {
        if ($skippedDead -gt 0 -and -not $Force) { return @{ ok = $false; error = "$skippedDead 条源地址不可达（站点下架或 CDN 边缘缺失）；可以右键「复制 URL」用外部工具再试" } }
        return @{ ok = $false; error = '没有可下载的条目' }
    }

    $queue = @($targets | ForEach-Object { [pscustomobject]@{ token = $_.token; url = $_.url } })

    # 已有下载器在跑 → 把新条目追加进它的队列（下载器每轮 poll 追加文件），不另起进程
    if ($running) {
        $pj = $null
        if (Test-Path $DlProgress) {
            try { $pj = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json } catch { }
        }
        $inRun = @{}
        if ($pj -and $pj.items) { foreach ($i in @($pj.items)) { if ($i.token) { $inRun[[string]$i.token] = $true } } }
        $add = @($queue | Where-Object { -not $inRun.ContainsKey([string]$_.token) })
        if (-not $add.Count) {
            return @{ ok = $true; appended = 0; count = 0; note = '这些条目已经在当前下载队列里' }
        }
        (ConvertTo-Json -InputObject $add -Depth 4) | Set-Content -Path $DlAdd -Encoding UTF8 -Force

        # 立刻把追加项并入进度文件，队列抽屉马上能看到（下载器下一轮 poll 会再合并一次）
        if ($pj) {
            try {
                $items = @($pj.items)
                $merged = @($items) + @($add | ForEach-Object {
                        [pscustomobject]@{ token = $_.token; state = 'queued'; bytes = 0; expected = 0; speed = 0; error = '' }
                    })
                $obj = [ordered]@{
                    running = $true; paused = [bool]$pj.paused; phase = 'download'
                    total = $merged.Count; done = [int]$pj.done; failed = [int]$pj.failed
                    queued = ([int]$pj.queued + $add.Count); pausedCount = [int]$pj.pausedCount
                    bytes = [int64]$pj.bytes; speed = $pj.speed; active = @($pj.active)
                    items = $merged; startedAt = $pj.startedAt
                }
                (ConvertTo-Json -InputObject $obj -Depth 5) | Set-Content -Path $DlProgress -Encoding UTF8 -Force
            } catch { }
        }

        Touch-State
        Write-Log 'download' "追加 $($add.Count) 条到当前下载队列"
        return @{ ok = $true; appended = $add.Count; count = $add.Count }
    }

    (ConvertTo-Json -InputObject $queue -Depth 4) | Set-Content -Path $DlQueue -Encoding UTF8 -Force

    $conc = if ($cfg.concurrent) { [int]$cfg.concurrent } else { 3 }
    if ($conc -lt 1 -or $conc -gt 16) { $conc = 3 }
    $proxy = if ($cfg.proxy) { [string]$cfg.proxy } else { '' }

    # 每个路径都单独加引号：Start-Process 只做空格拼接，路径含空格时不加引号就起不来
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (ConvertTo-QuotedArg $DlScript),
        '-QueueFile', (ConvertTo-QuotedArg $DlQueue), '-Dir', (ConvertTo-QuotedArg $dir),
        '-Concurrent', "$conc", '-ProgressFile', (ConvertTo-QuotedArg $DlProgress),
        '-CancelFile', (ConvertTo-QuotedArg $DlCancel), '-PauseFile', (ConvertTo-QuotedArg $DlPause),
        '-PauseItemsFile', (ConvertTo-QuotedArg $DlPauseItems),
        '-AddFile', (ConvertTo-QuotedArg $DlAdd))
    if ($proxy) { $argList += @('-Proxy', (ConvertTo-QuotedArg $proxy)) }

    Remove-Item $DlCancel -Force -ErrorAction SilentlyContinue
    Remove-Item $DlAdd -Force -ErrorAction SilentlyContinue
    # 上一轮可能停在「暂停」状态：新任务从运行态开始
    Remove-Item $DlPause -Force -ErrorAction SilentlyContinue
    Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue

    # 先把「已排队」写进进度文件：前端不用等下载器第一轮 poll 才看到任务。
    # 同时保留上一轮已完成的记录（完成项只由用户点「清理已完成」清除，不自动丢）。
    $history = @()
    if (Test-Path $DlProgress) {
        try {
            $old = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
            $history = @($old.items | Where-Object { $_.state -eq 'done' } | Select-Object -Last 200)
        } catch { }
    }
    $now = (Get-Date).ToString('s')
    $initItems = @(@($history) + @($queue | ForEach-Object {
                [pscustomobject]@{ token = $_.token; state = 'queued'; bytes = 0; expected = 0; speed = 0; error = '' }
            }))
    $init = [ordered]@{
        running = $true; paused = $false; phase = 'download'
        total = $initItems.Count; done = @($history).Count; failed = 0
        queued = $queue.Count; pausedCount = 0; bytes = 0; speed = 0
        active = @(); items = $initItems; startedAt = $now
    }
    (ConvertTo-Json -InputObject $init -Depth 5) | Set-Content -Path $DlProgress -Encoding UTF8 -Force

    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
    $startStamp = ''
    try { $startStamp = $proc.StartTime.ToString('s') } catch { }
    $State.Download = @{ Pid = $proc.Id; ProcStart = $startStamp; Started = $now; Count = $queue.Count; Dir = $dir }
    # 下一次 /api/state 立刻重新探测进程，而不是用 5 秒前的缓存（否则会显示「已结束」）
    Reset-DownloadProbe
    Touch-State

    $proxyText = if ($proxy) { "，代理 $proxy" } else { '，代理跟随系统' }
    Write-Log 'download' "开始下载 $($queue.Count) 条（并发 $conc$proxyText）→ $dir"
    [pscustomobject]@{ ok = $true; count = $queue.Count; dir = $dir; concurrent = $conc; proxy = $proxy; skipped = $skippedDead }
}


function Cancel-DownloadItems {
    <#  单条取消：把 token 写进取消文件，下载器下一轮 poll 会 kill 对应 curl  #>
    param($Tokens)
    if (-not $Tokens -or -not $Tokens.Count) { return @{ ok = $false; error = '没指定条目' } }
    $list = @($Tokens | ForEach-Object { [string]$_ })
    (ConvertTo-Json -InputObject $list -Depth 3) | Set-Content -Path $DlCancel -Encoding UTF8 -Force
    Touch-State
    Write-Log 'download' "取消下载 $(($list -join ', '))"
    return @{ ok = $true; count = $list.Count }
}

function Get-PausedItemList {
    if (-not (Test-Path $DlPauseItems)) { return @() }
    try {
        $raw = Get-Content $DlPauseItems -Raw -Encoding UTF8 | ConvertFrom-Json
        return @(@($raw) | ForEach-Object { [string]$_ })
    } catch { return @() }
}

function Set-DownloadPause {
    <#  暂停 / 继续。
        不传 tokens = 整体暂停（暂停所有条目）；传 tokens = 只暂停/继续这几条。
        暂停会杀掉正在跑的 curl 但保留 .part，继续时用 curl -C - 续传；
        下载器进程本身不退出，所以队列、进度、并发位都还在。  #>
    param([bool]$On, [string[]]$Tokens)

    $info = Get-DownloadInfo -Fresh
    if (-not $info.running) { return @{ ok = $false; error = '没有正在进行的下载' } }

    # 按条暂停/继续
    if ($Tokens -and $Tokens.Count -gt 0) {
        $list = @(Get-PausedItemList)
        if ($On) { $list = @(@($list) + @($Tokens) | Select-Object -Unique) }
        else { $list = @($list | Where-Object { $Tokens -notcontains $_ }) }
        (ConvertTo-Json -InputObject @($list) -Depth 3) | Set-Content -Path $DlPauseItems -Encoding UTF8 -Force
        Touch-State
        Write-Log 'download' "$(if ($On) { '暂停' } else { '继续' }) $(($Tokens -join ', '))"
        return @{ ok = $true; paused = $On; tokens = @($Tokens) }
    }

    # 整体暂停/继续
    if ($On) {
        Set-Content -Path $DlPause -Value '1' -Encoding ASCII -Force
    } else {
        Remove-Item $DlPause -Force -ErrorAction SilentlyContinue
        Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue
    }
    if ($State.Download) { $State.Download.Paused = $On }
    Touch-State
    Write-Log 'download' $(if ($On) { '下载已暂停（保留 .part，可继续）' } else { '下载已继续' })
    return @{ ok = $true; paused = $On }
}

function Stop-Download {
    <#  停止所有下载：既结束跟踪的下载器，也清掉服务重启后遗留的孤儿 curl  #>
    $killed = 0
    if ($State.Download -and $State.Download.Pid) {
        $pid2 = $State.Download.Pid
        try { & taskkill.exe /PID $pid2 /T /F 2>&1 | Out-Null; $killed++ } catch { }
        try { Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue } catch { }
    }
    $orphans = Stop-AllDownloadProcesses
    $runStarted = if ($State.Download) { $State.Download.Started } else { '' }
    $State.Download = $null
    Reset-DownloadProbe
    Remove-Item $DlPause -Force -ErrorAction SilentlyContinue
    Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue
    Remove-Item $DlAdd -Force -ErrorAction SilentlyContinue
    [void](Apply-DeadFromProgress -RunStarted $runStarted)
    Touch-State
    if ($killed -eq 0 -and $orphans -eq 0) {
        return @{ ok = $false; error = '没有正在进行的下载' }
    }
    Clean-StaleProgress
    Write-Log 'download' "下载已取消（进程 $($killed + $orphans) 个）"
    @{ ok = $true; killed = $killed + $orphans; reverted = 0 }
}

function Reset-DownloadState {
    <#  强制解除「已有任务在跑」的占用：
        杀掉经精确匹配确认属于本程序的下载器 / curl 进程，清掉跟踪状态与标记文件。
        用于误判或异常退出留下的锁。  #>
    $killed = Stop-AllDownloadProcesses
    $hadTracked = [bool]$State.Download
    $State.Download = $null
    Remove-Item $DlPause -Force -ErrorAction SilentlyContinue
    Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue
    Remove-Item $DlCancel -Force -ErrorAction SilentlyContinue
    Remove-Item $DlAdd -Force -ErrorAction SilentlyContinue
    Reset-DownloadProbe
    Clean-StaleProgress
    Touch-State
    Write-Log 'download' "强制解除下载占用（跟踪=$hadTracked，进程 $killed 个）"
    return @{ ok = $true; killed = $killed; reverted = 0; tracked = $hadTracked }
}

function Clean-StaleProgress {
    <#  进程已经不在了但进度文件还写着 running/queued（取消、崩溃留下的）：
        收尾成「只剩已完成记录」，避免队列抽屉里挂着一大堆假排队条目。  #>
    if (-not (Test-Path $DlProgress)) { return }
    try {
        $p = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
        $done = @($p.items | Where-Object { $_.state -eq 'done' })
        $others = @($p.items | Where-Object { $_.state -ne 'done' })
        if (-not $p.running -and $others.Count -eq 0) { return }
        $obj = [ordered]@{
            running = $false; paused = $false; phase = 'done'
            total = $done.Count; done = $done.Count; failed = 0
            bytes = 0; speed = 0; items = $done; updatedAt = (Get-Date).ToString('s')
        }
        (ConvertTo-Json -InputObject $obj -Depth 5) | Set-Content -Path $DlProgress -Encoding UTF8 -Force
        Touch-State
    } catch { }
}

function Clear-DownloadDone {
    <#  清理「已完成」的队列记录：只动 data\download.json，不删文件、不改台账  #>
    $info = Get-DownloadInfo -Fresh
    if ($info.running) { return @{ ok = $false; error = '下载进行中，结束后再清理' } }
    if (-not (Test-Path $DlProgress)) { return @{ ok = $true; removed = 0 } }
    try {
        $p = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
        $items = @($p.items)
        $keep = @($items | Where-Object { $_.state -ne 'done' })
        $removed = $items.Count - $keep.Count
        if ($removed -le 0) { return @{ ok = $true; removed = 0 } }
        $obj = [ordered]@{
            running = $false; paused = $false; phase = 'done'; total = $keep.Count;
            done = @($keep | Where-Object { $_.state -eq 'done' }).Count;
            failed = @($keep | Where-Object { $_.state -eq 'failed' }).Count;
            bytes = 0; speed = 0; items = @($keep); updatedAt = (Get-Date).ToString('s')
        }
        (ConvertTo-Json -InputObject $obj -Depth 5) | Set-Content -Path $DlProgress -Encoding UTF8 -Force
        Touch-State
        Write-Log 'download' "清理已完成队列记录 $removed 条（文件未动）"
        return @{ ok = $true; removed = $removed }
    } catch { return @{ ok = $false; error = $_.Exception.Message } }
}

function Step-Download {
    <#  主循环里每轮调用：进程结束后补一次扫描，运行中则节流推 SSE  #>
    if (-not $State.Download -or -not $State.Download.Pid) { return }

    $alive = Test-TrackedDownloader
    if ($alive) {
        # 每 2 秒推一次 rev，让前端拿到进度
        if (-not $State.Download.LastPush -or ((Get-Date) - [datetime]$State.Download.LastPush).TotalSeconds -ge 2) {
            $State.Download.LastPush = (Get-Date).ToString('s')
            Touch-State
        }
        return
    }

    $dir = if ($State.Download.Dir) { $State.Download.Dir } else { (Read-Config -Root $Root -DataDir $WS.DataDir -DefaultContentDir $WS.Content).contentDir }
    $count = $State.Download.Count
    $runStarted = $State.Download.Started
    $State.Download = $null
    Remove-Item $DlPause -Force -ErrorAction SilentlyContinue
    Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue
    [void](Apply-DeadFromProgress -RunStarted $runStarted)
    try { [void](Repair-PartFiles) } catch { }
    try { [void](Invoke-Scan -Silent -KeepStatus) } catch { }
    try { Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir } catch { }
    Touch-State
    Write-Log 'download' "下载进程结束（队列 $count 条），已重新扫描目录"
}

function Repair-PartFiles {
    <#
      清理孤立的 .mp4.part：
        - 同名 .mp4 已存在 → 删掉 .part
        - 大小 == 远端 Content-Length → 改名成 .mp4（这就是"下载好了还有多余后缀"的情况）
        - 两者都不满足 → 留作续传
      跳过最近 2 分钟还在写的文件，避免和正在跑的下载打架。
    #>
    param([int]$Limit = 20)

    $dir = $Config.contentDir
    if (-not $dir -or -not (Test-Path $dir)) { return [pscustomobject]@{ ok = $true; renamed = 0; deleted = 0; kept = 0 } }

    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
    if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
    $proxy = if ($Config.proxy) { [string]$Config.proxy } else { '' }
    if (-not $proxy) {
        try {
            $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
            if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
                $proxy = [string]$reg.ProxyServer
                if ($proxy -notmatch '^[a-z]+://') { $proxy = 'http://' + $proxy }
            }
        } catch { }
    }

    $renamed = 0; $deleted = 0; $kept = 0; $checked = 0
    $now = Get-Date
    foreach ($p in @(Get-ChildItem -Path $dir -Filter '*.mp4.part' -File -ErrorAction SilentlyContinue)) {
        if ($checked -ge $Limit) { break }
        if (($now - $p.LastWriteTime).TotalMinutes -lt 2) { $kept++; continue }
        $checked++
        $tk = $p.Name -replace '\.mp4\.part$', ''
        $final = Join-Path $dir ($tk + '.mp4')
        if (Test-Path $final) {
            Remove-Item $p.FullName -Force -ErrorAction SilentlyContinue
            $deleted++
            continue
        }
        $row = $State.Ledger | Where-Object { $_.token -eq $tk } | Select-Object -First 1
        if (-not $row -or -not $row.url) { $kept++; continue }
        $expected = [int64]0
        try {
            $a = @('-sS', '-I', '-L', '--max-time', '15')
            if ($proxy) { $a += @('-x', $proxy) }
            $a += $row.url
            foreach ($line in (& $curl @a 2>$null)) {
                if ($line -match '(?i)^content-length:\s*(\d+)') { $expected = [int64]$Matches[1]; break }
            }
        } catch { }
        if ($expected -gt 0 -and $p.Length -eq $expected) {
            try {
                Move-Item -Path $p.FullName -Destination $final -Force
                $renamed++
            } catch { $kept++ }
        } elseif ($expected -gt 0 -and $p.Length -gt $expected) {
            # 比远端还大：文件被写坏（重复追加/断点错位），删掉重下
            Remove-Item $p.FullName -Force -ErrorAction SilentlyContinue
            $deleted++
        } else {
            $kept++
        }
    }
    if ($renamed -gt 0 -or $deleted -gt 0) {
        try { [void](Invoke-Scan -Silent) } catch { }
        Write-Log 'download' "整理 .part：改名 $renamed，删除 $deleted，保留 $kept"
    }
    return [pscustomobject]@{ ok = $true; renamed = $renamed; deleted = $deleted; kept = $kept }
}

function Step-DownloadGuard {
    <#  兜底：进程已经没了，清掉可能残留的暂停标记  #>
    if ($State.Download -and $State.Download.Pid) { return }
    if ((Get-DownloadProcesses).Count -gt 0) { return }
    # 进程已经没了还留着暂停标记 → 清掉，避免下次误判成「暂停中」
    if (Test-Path $DlPause) { Remove-Item $DlPause -Force -ErrorAction SilentlyContinue }
    if (Test-Path $DlPauseItems) { Remove-Item $DlPauseItems -Force -ErrorAction SilentlyContinue }
}

function Apply-DeadFromProgress {
    <#  下载器确认源文件失效（403/404）的条目 → 标成 failed（不是 ignored），
        这样在「失败」筛选里能看见、能重试；且绝不覆盖已有文件的条目。  #>
    param([string]$RunStarted = '')
    try {
        if (-not (Test-Path $DlProgress)) { return 0 }
        $pj = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json

        # 进度文件必须属于本次运行（时间差 15 秒内），避免拿旧文件误判
        if ($RunStarted -and $pj.startedAt) {
            try {
                $t1 = [datetime]$RunStarted
                $t2 = [datetime]$pj.startedAt
                if ([math]::Abs(($t1 - $t2).TotalSeconds) -gt 15) { return 0 }
            } catch { }
        }

        # 主循环是单线程，而这里每条都要做「复核 + 等 1.5 秒 + 再复核」的网络请求：
        # 以前一次最多 10 条，最坏能把 SSE 和页面请求卡住半分钟以上。改成 4 条 + 6 秒预算，
        # 剩下的条目下一轮继续处理（进度文件还在，不会漏）。
        $dead = @($pj.items | Where-Object { $_.state -eq 'dead' } | Select-Object -First 4)
        $budgetMs = 6000
        $startedAt = Get-Date
        $n = 0
        foreach ($d in $dead) {
            if (((Get-Date) - $startedAt).TotalMilliseconds -gt $budgetMs) { break }
            $row = $State.Ledger | Where-Object { $_.token -eq $d.token } | Select-Object -First 1
            if (-not $row) { continue }
            if ($row.file_name) { continue }                 # 已经有文件了，绝不改状态
            if ($row.status -eq 'done' -or $row.status -eq 'ignored') { continue }

            # 本地已经有 .mp4 / .part → 还能续传，不判死
            $tk = [string]$row.token
            if (Test-Path -LiteralPath (Join-Path $Config.contentDir ($tk + '.mp4'))) { continue }
            if (Test-Path -LiteralPath (Join-Path $Config.contentDir ($tk + '.mp4.part'))) { continue }

            # 复核两次（间隔 1.5 秒），规避并发下载时的临时 403
            if (-not (Test-UrlDeadNow -Url $row.url)) { continue }
            Start-Sleep -Milliseconds 1500
            if (-not (Test-UrlDeadNow -Url $row.url)) { continue }

            $row.status = 'failed'
            $row.note = "unreachable:$($d.error)"
            $n++
        }
        if ($n -gt 0) {
            Save-Ledger -Rows $State.Ledger -Path $LedgerPath
            Write-Log 'download' "标记 $n 条下载失败（源文件 403/404，可在「失败」里重试）"
            Touch-State
        }
        return $n
    } catch { return 0 }
}

function Test-UrlDeadNow {
    <#  用 1 字节 Range GET 复核源文件是否真的失效；只有在确认 403/404/410 时才返回 $true  #>
    param([string]$Url, [string]$Error = '')
    if (-not $Url) { return $false }
    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
    if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
    $proxy = ''
    try {
        if ($Config.proxy) { $proxy = [string]$Config.proxy }
        if (-not $proxy) {
            $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
            if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
                $proxy = [string]$reg.ProxyServer
                if ($proxy -notmatch '^[a-z]+://') { $proxy = 'http://' + $proxy }
            }
        }
    } catch { }
    try {
        $a = @('-sS', '-o', 'NUL', '-w', '%{http_code}', '-r', '0-0', '--max-time', '15', '-L')
        if ($proxy) { $a += @('-x', $proxy) }
        $a += $Url
        $code = (& $curl @a 2>$null)
        $code = ([string]$code).Trim()
        return ($code -eq '403' -or $code -eq '404' -or $code -eq '410')
    } catch { return $false }
}

# ---------------- 源地址刷新 ----------------

function Get-DetailVideoInfo {
    <#  抓详情页的 JSON-LD。返回 @{url;cover} 或 $null（页面在但没有 VideoObject = 已下架） #>
    param([string]$Token)
    try { Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue } catch { }
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Config.proxy) {
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Config.proxy)
        $handler.UseProxy = $true
    }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(25)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0')
    try {
        $html = $client.GetStringAsync("https://pektino.com/zh-CN/movie/$Token").GetAwaiter().GetResult()
    } catch {
        $client.Dispose()
        return @{ error = $_.Exception.Message }
    } finally {
        try { $client.Dispose() } catch { }
    }
    foreach ($m in [regex]::Matches($html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
        try {
            $j = $m.Groups[1].Value | ConvertFrom-Json
            if ($j.'@type' -eq 'VideoObject') {
                return @{ url = [string]$j.contentUrl; cover = [string]$j.thumbnailUrl; duration = [string]$j.duration }
            }
        } catch { }
    }
    return $null
}

function Refresh-ItemUrls {
    <#  重新抓详情页，更新 contentUrl/封面；返回 refreshed/unchanged/removed/error 计数
        removed = 页面还在但已经没有视频（站点下架），重试也不会成功  #>
    param([string[]]$Tokens)

    if (-not $Tokens -or -not $Tokens.Count) { return @{ ok = $false; error = '没指定条目' } }
    # 防御：函数内部是同步 HTTP（每条超时 25 秒），一次最多 20 条，避免被批量调用拖死主循环
    if ($Tokens.Count -gt 20) { $Tokens = @($Tokens | Select-Object -First 20) }
    $refreshed = 0; $unchanged = 0; $removed = 0; $errors = 0

    foreach ($tk in $Tokens) {
        $row = $State.Ledger | Where-Object { $_.token -eq $tk } | Select-Object -First 1
        if (-not $row) { continue }
        $info = Get-DetailVideoInfo -Token $tk

        if ($null -eq $info) {
            $row.note = 'removed:site'
            $removed++
            continue
        }
        if ($info.error) { $errors++; continue }

        $newUrl = [string]$info.url
        if (-not $newUrl) { $row.note = 'removed:site'; $removed++; continue }

        if ($newUrl -ne [string]$row.url) {
            $row.url = $newUrl
            $row.note = 'refresh:url'
            $refreshed++
        } else {
            # URL 没变：再确认一次源文件是否真的还在
            $code = Get-UrlStatusCode -Url $newUrl
            if ($code -eq 200 -or $code -eq 206) {
                if ($row.note -like 'dead:*' -or $row.note -like 'unreachable*' -or $row.note -like 'removed*') { $row.note = 'url-ok' }
                $unchanged++
            } else {
                $row.note = "unreachable:http:$code"          # 源不可达：可能只是本机网络/CDN 边缘，迅雷仍可能下得动
                $unchanged++
            }
        }
    }

    Save-Ledger -Rows $State.Ledger -Path $LedgerPath
    Touch-State
    Write-Log 'refresh' "刷新源地址：更新 $refreshed，未变 $unchanged，已下架 $removed，出错 $errors"
    return @{ ok = $true; refreshed = $refreshed; unchanged = $unchanged; removed = $removed; errors = $errors }
}

function Get-UrlStatusCode {
    <#  用 1 字节 Range GET 拿 HTTP 状态码；失败返回 0  #>
    param([string]$Url)
    if (-not $Url) { return 0 }
    $curl = (Get-Command curl.exe -ErrorAction SilentlyContinue).Source
    if (-not $curl) { $curl = 'C:\Windows\System32\curl.exe' }
    $proxy = [string]$Config.proxy
    if (-not $proxy) {
        try {
            $reg = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
            if ($reg.ProxyEnable -eq 1 -and $reg.ProxyServer) {
                $proxy = [string]$reg.ProxyServer
                if ($proxy -notmatch '^[a-z]+://') { $proxy = 'http://' + $proxy }
            }
        } catch { }
    }
    try {
        $a = @('-sS', '-o', 'NUL', '-w', '%{http_code}', '-r', '0-0', '--max-time', '15', '-L')
        if ($proxy) { $a += @('-x', $proxy) }
        $a += $Url
        $code = (& $curl @a 2>$null)
        return [int]([string]$code).Trim()
    } catch { return 0 }
}
