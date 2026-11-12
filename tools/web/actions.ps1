#Requires -Version 5.1
# Business actions: stats, scan, jobs, fav/rate/watch, play, delete, send

function Get-Stats {
    $rows = @($State.Ledger)
    $byStatus = @{}
    foreach ($s in @('new', 'sent', 'done', 'ignored')) {
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
        toWatch     = $onDisk - $watched
        diskGB      = [math]::Round($bytes / 1GB, 2)
        downloadDir = $Config.downloadDir
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
    $idx = Get-DownloadIndex -Dir $Config.downloadDir
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
            # 只有 new/sent 才自动转 done；ignored（用户手动忽略）和 done 不动
            if ($r.status -eq 'new' -or $r.status -eq 'sent' -or -not $r.status) {
                $r.status = 'done'
                if (-not $r.note) { $r.note = 'auto:file' }
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

    if ($changed -gt 0) { Save-Ledger -Rows $State.Ledger -Path $LedgerPath; Touch-State }

    $coverMissing = (Get-CoverMissingList).Count
    $State.Scan = [pscustomobject]@{
        coverMissing = $coverMissing
        downloaded = $found
        missing    = (@($State.Ledger).Count - $found)
        changed    = $changed
        files      = @($idx.Files.Keys).Count
        partial    = @($idx.Partial).Count
        dir        = $Config.downloadDir
        exists     = [bool]$idx.Exists
        totalGB    = [math]::Round((($idx.Files.Values | Measure-Object -Property size -Sum).Sum) / 1GB, 2)
        orphans    = $orphans
        lastScan   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }

    if (-not $Silent) {
        Write-Log 'scan' "扫描 $($Config.downloadDir)：已下载 $found / 台账 $(@($State.Ledger).Count)，变更 $changed，孤立文件 $($orphans.Count)"
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
    Remove-Item $TmpCsv -Force -ErrorAction SilentlyContinue
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
    Remove-Item $TmpCsv -Force -ErrorAction SilentlyContinue
    Remove-Item $ProgressFile -Force -ErrorAction SilentlyContinue

    $script = Join-Path $Root 'import.ps1'
    $dl = $Config.downloadDir; $out = $TmpCsv; $prog = $ProgressFile; $cov = $CoverDir; $thm = $ThumbDir
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
            try {
                $scraped = @(Import-Csv $TmpCsv -Encoding UTF8)
                $merged = Merge-Ledger -Existing $State.Ledger -Scraped $scraped
                $State.Ledger = @($merged.Rows)
                Save-Ledger -Rows $State.Ledger -Path $LedgerPath
                [void](Invoke-Scan -Silent)
                if ($kind -eq 'import') {
                    Write-Log 'import' "本地入库完成（$secs s）：新增 $($merged.Added)，更新 $($merged.Updated)，可识别 $($scraped.Count) 个文件"
                } else {
                    Write-Log 'scrape' "抓取完成（$secs s）：新增 $($merged.Added)，更新 $($merged.Updated)，共 $($scraped.Count) 条"
                }
            } catch {
                Write-Log 'error' "导入结果失败: $($_.Exception.Message)"
            }
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
    Remove-Item $TmpCsv -Force -ErrorAction SilentlyContinue
    Touch-State
}

function Stop-CurrentJob {
    if (-not $State.Job) { return @{ ok = $false; error = '当前没有在跑的任务' } }
    $kind = $State.Job.kind
    try { Stop-Job $State.Job.handle -ErrorAction SilentlyContinue } catch { }
    try { Remove-Job $State.Job.handle -Force -ErrorAction SilentlyContinue } catch { }
    $State.Job = $null
    Remove-Item $TmpCsv -Force -ErrorAction SilentlyContinue
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
    if (@('new', 'sent', 'done', 'ignored') -notcontains $Status) { return @{ ok = $false; error = "非法状态: $Status" } }
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

    foreach ($r in $rows) {
        $file = Resolve-RowFile $r
        if (-not $file -or -not (Test-Path $file)) { continue }
        # 只允许删下载目录内的文件
        $rootFull = [System.IO.Path]::GetFullPath($Config.downloadDir).TrimEnd('\')
        $fileFull = [System.IO.Path]::GetFullPath($file)
        if (-not $fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            $failed += "$($r.token): 不在下载目录内，已跳过"
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
        } catch {
            $failed += "$($r.token): $($_.Exception.Message)"
        }
    }

    if ($Purge) {
        $rm = Remove-StoreItems -Tokens ($rows | ForEach-Object { $_.token })
        $keep = @($State.Ledger | Where-Object { $Tokens -notcontains $_.token })
        $State.Ledger = $keep
        Write-Log 'delete' "删除文件 $deleted 个，从台账移除 $rm 条"
    } else {
        $changed = 0
        foreach ($r in $rows) {
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
    foreach ($t in $targets) {
        try {
            Start-Process (New-ThunderLink $t.url)
            $sent++
        } catch {
            Write-Log 'error' "投递失败 $($t.token): $($_.Exception.Message)"
        }
    }
    [void](Set-LedgerStatus -Rows $State.Ledger -Tokens ($targets | ForEach-Object { $_.token }) -Status 'sent')
    Save-Ledger -Rows $State.Ledger -Path $LedgerPath
    Write-Log 'send' "投递 $sent 条到迅雷"
    Touch-State
    return @{ ok = $true; count = $sent; links = @(); dryRun = $false }
}

# ---------------- 内置下载器 ----------------

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
        } catch { }
    }
    $alive = $false
    if ($State.Download -and $State.Download.Pid) {
        $alive = [bool](Get-Process -Id $State.Download.Pid -ErrorAction SilentlyContinue)
    }
    $info.running = $alive
    $info.pid = if ($State.Download) { $State.Download.Pid } else { 0 }
    [pscustomobject]$info
}

function Start-Download {
    <#  把选中/待下载条目交给内置下载器（独立进程，支持续传与并发）  #>
    param($Tokens, [string]$Status = 'new', [int]$Limit = 0)

    if ($State.Job -and $State.Job.State -eq 'Running') {
        return @{ ok = $false; error = '抓取任务正在运行，等它结束再下载' }
    }
    if (Get-DownloadInfo | ForEach-Object { $_.running }) {
        return @{ ok = $false; error = '已经有一个下载任务在跑' }
    }

    $cfg = Read-Config -Root $Root
    $dir = if ($cfg.downloadDir) { [string]$cfg.downloadDir } else { 'D:\Downloads' }
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $targets = @()
    if ($Tokens) {
        $targets = @($State.Ledger | Where-Object { $_.url -and ($Tokens -contains $_.token) })
    } else {
        $targets = @($State.Ledger | Where-Object { $_.url -and -not $_.file_name -and $_.status -eq $Status })
    }
    if ($Limit -gt 0) { $targets = @($targets | Select-Object -First $Limit) }
    if (-not $targets.Count) { return @{ ok = $false; error = '没有可下载的条目' } }

    $queue = @($targets | ForEach-Object { [pscustomobject]@{ token = $_.token; url = $_.url } })
    (ConvertTo-Json -InputObject $queue -Depth 4) | Set-Content -Path $DlQueue -Encoding UTF8 -Force

    $conc = if ($cfg.concurrent) { [int]$cfg.concurrent } else { 3 }
    if ($conc -lt 1 -or $conc -gt 8) { $conc = 3 }
    $proxy = if ($cfg.proxy) { [string]$cfg.proxy } else { '' }

    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $DlScript,
        '-QueueFile', $DlQueue, '-Dir', $dir, '-Concurrent', "$conc", '-ProgressFile', $DlProgress)
    if ($proxy) { $argList += @('-Proxy', $proxy) }

    Remove-Item $DlProgress -Force -ErrorAction SilentlyContinue
    $proc = Start-Process -FilePath 'powershell.exe' -ArgumentList $argList -WindowStyle Hidden -PassThru
    $State.Download = @{ Pid = $proc.Id; Started = (Get-Date).ToString('s'); Count = $queue.Count; Dir = $dir }
    Touch-State

    $proxyText = if ($proxy) { "，代理 $proxy" } else { '，代理跟随系统' }
    Write-Log 'download' "开始下载 $($queue.Count) 条（并发 $conc$proxyText）→ $dir"
    [pscustomobject]@{ ok = $true; count = $queue.Count; dir = $dir; concurrent = $conc; proxy = $proxy }
}

function Stop-Download {
    if (-not $State.Download -or -not $State.Download.Pid) { return @{ ok = $false; error = '没有正在进行的下载' } }
    $pid2 = $State.Download.Pid
    try {
        # 连同子进程（curl）一起结束
        & taskkill.exe /PID $pid2 /T /F 2>&1 | Out-Null
    } catch { }
    try { Stop-Process -Id $pid2 -Force -ErrorAction SilentlyContinue } catch { }
    $State.Download = $null
    Touch-State
    Write-Log 'download' '下载已取消'
    @{ ok = $true }
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

    $dir = if ($State.Download.Dir) { $State.Download.Dir } else { (Read-Config -Root $Root).downloadDir }
    $count = $State.Download.Count
    $State.Download = $null
    try { [void](Invoke-Scan -Silent -KeepStatus) } catch { }
    try { Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir } catch { }
    Touch-State
    Write-Log 'download' "下载进程结束（队列 $count 条），已重新扫描目录"
}