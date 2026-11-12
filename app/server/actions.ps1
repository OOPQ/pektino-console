#Requires -Version 5.1
# Business actions: stats, scan, jobs, fav/rate/watch, play, delete, send

function Get-Stats {
    $rows = @($State.Ledger)
    $byStatus = @{}
    foreach ($s in @('new', 'sent', 'done', 'ignored', 'failed', 'downloading')) {
        $byStatus[$s] = @($rows | Where-Object { $_.status -eq $s }).Count
    }
    $secs = 0
    foreach ($r in $rows) { if ($r.seconds) { $secs += [int]$r.seconds } }
    $today = (Get-Date).ToString('yyyy-MM-dd')
    $todayAdded = @($rows | Where-Object { $_.first_seen -like "$today*" }).Count

    $resGroups = @()
    foreach ($g in ($rows | Where-Object { $_.res } | Group-Object res | Sort-Object Count -Descending | Select-Object -First 6)) {
        $resGroups += [pscustomobject]@{ res = $g.Name; count = $g.Count }
    }

    $onDisk = @($rows | Where-Object { $_.file_name }).Count
    $bytes = 0
    foreach ($r in $rows) { if ($r.file_size) { $bytes += [double]$r.file_size } }
    $watched = @($rows | Where-Object { $_.last_play }).Count
    $orphans = @()
    if ($State.Scan) { $orphans = @($State.Scan.orphans) }

    [pscustomobject]@{
        total       = $rows.Count
        new         = $byStatus['new']
        sent        = $byStatus['sent']
        done        = $byStatus['done']
        ignored     = $byStatus['ignored']
        failed      = $byStatus['failed']
        downloading = $byStatus['downloading']
        hours       = [math]::Round($secs / 3600, 2)
        todayAdded  = $todayAdded
        byRes       = $resGroups
        ledgerPath  = $LedgerPath
        lastSeen    = (($rows | Where-Object { $_.last_seen } | Sort-Object last_seen -Descending | Select-Object -First 1).last_seen)
        busy        = $State.Busy
        downloaded  = $onDisk
        missing     = $rows.Count - $onDisk
        favorites   = @($rows | Where-Object { $_.fav -eq '1' }).Count
        coverMissing = if ($State.Scan -and $null -ne $State.Scan.coverMissing) { [int]$State.Scan.coverMissing } else { 0 }
        watched     = $watched
        # 只把"有文件且没看过"算作待看，和前端 towatch 过滤口径一致
        toWatch     = @($rows | Where-Object { $_.file_name -and -not $_.last_play }).Count
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
            # 磁盘上有文件 → 一律以文件为准（new/sent/downloading/failed/ignored 都转 done）
            if ($r.status -eq 'failed' -or $r.status -eq 'ignored' -or $r.status -eq 'new' -or $r.status -eq 'sent' -or $r.status -eq 'downloading' -or -not $r.status) {
                $r.status = 'done'
                $r.note = 'auto:file'
                $changed++
            }
        } else {
            if ($r.file_name) { $r.file_name = ''; $r.file_size = ''; $r.file_date = ''; $changed++ }
            if (-not $KeepStatus -and $r.status -eq 'done' -and $r.note -eq 'auto:file') {
                $r.status = if ($r.sent_at) { 'sent' } else { 'new' }
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

    $coverMissing = (Get-CoverMissingList).Count
    $State.Scan = [pscustomobject]@{
        coverMissing = $coverMissing
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
    if (@('new', 'sent', 'done', 'ignored', 'failed') -notcontains $Status) { return @{ ok = $false; error = "非法状态: $Status" } }
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
        # 只允许删内容目录内的文件
        $rootFull = [System.IO.Path]::GetFullPath($Config.contentDir).TrimEnd('\')
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
        }
        Write-Log 'delete' "删除文件 $deleted 个，从台账移除 $rm 条"
    } else {
        $changed = 0
        foreach ($r in $rows) {
            if ($okTokens -notcontains $r.token) { continue }
            if ($r.file_name) { $r.file_name = ''; $r.file_size = ''; $r.file_date = ''; $changed++ }
            if ($r.status -eq 'done') { $r.status = if ($r.sent_at) { 'sent' } else { 'new' }; $changed++ }
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

function Invoke-Send {
    param([string[]]$Tokens, [string]$Status = 'new', [switch]$DryRun, [switch]$Force)

    $targets = @()
    if ($Tokens -and $Tokens.Count -gt 0) {
        $targets = @($State.Ledger | Where-Object { $Tokens -contains $_.token })
    } else {
        $targets = @($State.Ledger | Where-Object { $_.status -eq $Status })
    }
    $targets = @($targets | Where-Object { $_.url })
    if (-not $Force) {
        # 已下完（done）、被忽略（ignored）或磁盘上已有文件的，一律跳过
        $targets = @($targets | Where-Object { $_.status -ne 'done' -and $_.status -ne 'ignored' -and -not $_.file_name })
    }
    if ($targets.Count -eq 0) { return @{ ok = $true; count = 0; links = @(); note = '没有需要投递的条目' } }

    $links = @()
    foreach ($t in $targets) { $links += (New-ThunderLink $t.url) }

    if ($DryRun) {
        Write-Log 'dryrun' "预览 $($targets.Count) 条（未投递）"
        return @{ ok = $true; count = $targets.Count; links = $links; dryRun = $true }
    }

    $sent = 0
    $sentTokens = @()
    $failedTokens = @()
    foreach ($t in $targets) {
        try {
            Start-Process (New-ThunderLink $t.url)
            $sent++
            $sentTokens += $t.token
        } catch {
            $failedTokens += $t.token
            Write-Log 'error' "投递失败 $($t.token): $($_.Exception.Message)"
        }
    }
    # 只把真正启动成功的标成 sent；失败项留在原状态，下次还能重投
    if ($sentTokens.Count -gt 0) { [void](Set-LedgerStatus -Rows $State.Ledger -Tokens $sentTokens -Status 'sent') }
    Save-Ledger -Rows $State.Ledger -Path $LedgerPath
    Write-Log 'send' "投递 $sent 条到迅雷（失败 $($failedTokens.Count) 条）"
    Touch-State
    return @{ ok = $true; count = $sent; failed = $failedTokens.Count; links = @(); dryRun = $false }
}

# ---------------- 内置下载器 ----------------

function Get-DownloadProcesses {
    <#  找出所有"正在下载"的进程：下载器本身 + 它起的 curl/aria2c
        不依赖 State.Download.Pid，服务重启后也能清理孤儿进程  #>
    $out = @()
    try {
        foreach ($p in @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) {
            if (-not $p.CommandLine) { continue }
            if ($p.Name -eq 'curl.exe' -and $p.CommandLine -match '\.mp4\.part') { $out += $p }
            elseif ($p.Name -eq 'aria2c.exe' -and $p.CommandLine -match '\.mp4\.part') { $out += $p }
            elseif ($p.Name -eq 'powershell.exe' -and $p.CommandLine -match 'download\.ps1') { $out += $p }
        }
    } catch { }
    return $out
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
    return $killed
}

function Get-DownloadInfo {
    <#  返回下载器的当前状态：进程是否活着 + 进度文件内容  #>
    $info = [ordered]@{ running = $false; phase = ''; total = 0; done = 0; failed = 0; bytes = 0; speed = 0; active = @(); errors = @() }
    if (Test-Path $DlProgress) {
        try {
            $p = Get-Content $DlProgress -Raw -Encoding UTF8 | ConvertFrom-Json
            foreach ($k in @('phase', 'total', 'done', 'failed', 'bytes', 'speed')) {
                if ($null -ne $p.$k) { $info[$k] = $p.$k }
            }
            if ($p.active) { $info.active = @($p.active) }
            if ($p.errors) { $info.errors = @($p.errors) }
            if ($p.items) { $info.items = @($p.items) }
        } catch { }
    }
    $alive = $false
    if ($State.Download -and $State.Download.Pid) {
        $alive = [bool](Get-Process -Id $State.Download.Pid -ErrorAction SilentlyContinue)
    }
    if (-not $alive) {
        # 服务重启后 State 丢了，但 curl 可能还在跑（孤儿）
        $alive = ((Get-DownloadProcesses).Count -gt 0)
    }
    $info.running = $alive
    $info.pid = if ($State.Download) { $State.Download.Pid } else { 0 }
    [pscustomobject]$info
}

function Start-Download {
    <#  把选中/待下载条目交给内置下载器（独立进程，支持续传与并发）  #>
    param($Tokens, [string]$Status = 'new', [int]$Limit = 0, [switch]$Force)

    if ($State.Job -and $State.Job.handle -and $State.Job.handle.State -eq 'Running') {
        return @{ ok = $false; error = '抓取任务正在运行，等它结束再下载' }
    }
    # 先清掉可能残留的孤儿下载进程，否则会一直挡住新任务
    if (-not ($State.Download -and $State.Download.Pid)) { [void](Stop-AllDownloadProcesses) }
    if (Get-DownloadInfo | ForEach-Object { $_.running }) {
        return @{ ok = $false; error = '已经有一个下载任务在跑' }
    }

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
        if ($skippedDead -gt 0 -and -not $Force) { return @{ ok = $false; error = "$skippedDead 条源地址不可达（站点下架或 CDN 边缘缺失）。内置下载器下不动，但迅雷可能有自己的缓存/CDN —— 右键「复制 thunder://」丢给它试试" } }
        return @{ ok = $false; error = '没有可下载的条目' }
    }

    $queue = @($targets | ForEach-Object { [pscustomobject]@{ token = $_.token; url = $_.url } })
    (ConvertTo-Json -InputObject $queue -Depth 4) | Set-Content -Path $DlQueue -Encoding UTF8 -Force

    $conc = if ($cfg.concurrent) { [int]$cfg.concurrent } else { 3 }
    if ($conc -lt 1 -or $conc -gt 8) { $conc = 3 }
    $proxy = if ($cfg.proxy) { [string]$cfg.proxy } else { '' }

    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $DlScript,
        '-QueueFile', $DlQueue, '-Dir', $dir, '-Concurrent', "$conc", '-ProgressFile', $DlProgress, '-CancelFile', $DlCancel)
    if ($proxy) { $argList += @('-Proxy', $proxy) }

    Remove-Item $DlProgress -Force -ErrorAction SilentlyContinue
    Remove-Item $DlCancel -Force -ErrorAction SilentlyContinue
    # 队列里的条目立刻标成 downloading，UI 与筛选都能看到
    foreach ($q in $queue) {
        $row = $State.Ledger | Where-Object { $_.token -eq $q.token } | Select-Object -First 1
        if ($row -and -not $row.file_name) { $row.status = 'downloading' }
    }
    Save-Ledger -Rows $State.Ledger -Path $LedgerPath
    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
    $State.Download = @{ Pid = $proc.Id; Started = (Get-Date).ToString('s'); Count = $queue.Count; Dir = $dir }
    Touch-State

    $proxyText = if ($proxy) { "，代理 $proxy" } else { '，代理跟随系统' }
    Write-Log 'download' "开始下载 $($queue.Count) 条（并发 $conc$proxyText）→ $dir"
    [pscustomobject]@{ ok = $true; count = $queue.Count; dir = $dir; concurrent = $conc; proxy = $proxy; skipped = $skippedDead }
}

function Revert-Downloading {
    <#  把还挂在 downloading 的条目退回 new（下载失败/取消后调用）  #>
    param([switch]$OnlyIfMissing)
    $n = 0
    foreach ($r in @($State.Ledger)) {
        if ($r.status -ne 'downloading') { continue }
        if ($OnlyIfMissing -and $r.file_name) { continue }
        $r.status = if ($r.sent_at) { 'sent' } else { 'new' }
        $n++
    }
    if ($n -gt 0) { Save-Ledger -Rows $State.Ledger -Path $LedgerPath; Touch-State }
    return $n
}

function Cancel-DownloadItems {
    <#  单条取消：把 token 写进取消文件，下载器下一轮 poll 会 kill 对应 curl  #>
    param($Tokens)
    if (-not $Tokens -or -not $Tokens.Count) { return @{ ok = $false; error = '没指定条目' } }
    $list = @($Tokens | ForEach-Object { [string]$_ })
    (ConvertTo-Json -InputObject $list -Depth 3) | Set-Content -Path $DlCancel -Encoding UTF8 -Force
    # 立刻把状态退回去，别等整个队列跑完
    foreach ($tk in $list) {
        $row = $State.Ledger | Where-Object { $_.token -eq $tk } | Select-Object -First 1
        if ($row -and -not $row.file_name) { $row.status = if ($row.sent_at) { 'sent' } else { 'new' } }
    }
    Save-Ledger -Rows $State.Ledger -Path $LedgerPath
    Touch-State
    Write-Log 'download' "取消下载 $(($list -join ', '))"
    return @{ ok = $true; count = $list.Count }
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
    [void](Apply-DeadFromProgress -RunStarted $runStarted)
    $reverted = Revert-Downloading
    Touch-State
    if ($killed -eq 0 -and $orphans -eq 0 -and $reverted -eq 0) {
        return @{ ok = $false; error = '没有正在进行的下载' }
    }
    Write-Log 'download' "下载已取消（进程 $($killed + $orphans) 个，状态回退 $reverted 条）"
    @{ ok = $true; killed = $killed + $orphans; reverted = $reverted }
}

function Step-Download {
    <#  主循环里每轮调用：进程结束后补一次扫描，运行中则节流推 SSE  #>
    if (-not $State.Download -or -not $State.Download.Pid) { return }

    $alive = [bool](Get-Process -Id $State.Download.Pid -ErrorAction SilentlyContinue)
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
    [void](Apply-DeadFromProgress -RunStarted $runStarted)
    $reverted = Revert-Downloading -OnlyIfMissing
    try { [void](Repair-PartFiles) } catch { }
    try { [void](Invoke-Scan -Silent -KeepStatus) } catch { }
    try { Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir } catch { }
    Touch-State
    Write-Log 'download' "下载进程结束（队列 $count 条，未完成退回 $reverted 条），已重新扫描目录"
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
    <#  兜底：没有任何下载进程，却还有 downloading 状态的行 → 说明是上次失败/崩溃留下的，回退  #>
    if ($State.Download -and $State.Download.Pid) { return }
    if ((Get-DownloadProcesses).Count -gt 0) { return }
    $n = Revert-Downloading
    if ($n -gt 0) { Write-Log 'download' "没有下载进程，回退 $n 条「下载中」状态" }
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

        # 每轮最多核对 10 条：核对含网络复核，太多会把主循环卡住（前端 SSE 会停）
        $dead = @($pj.items | Where-Object { $_.state -eq 'dead' } | Select-Object -First 10)
        $n = 0
        foreach ($d in $dead) {
            $row = $State.Ledger | Where-Object { $_.token -eq $d.token } | Select-Object -First 1
            if (-not $row) { continue }
            if ($row.file_name) { continue }                 # 已经有文件了，绝不改状态
            if ($row.status -ne 'downloading') { continue }  # 不是本轮队列成员

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