#Requires -Version 5.1
<#
.SYNOPSIS
  项目（project）：本程序的数据单元，和 IDE 里的"项目文件夹"同义。
.DESCRIPTION
  程序（app\）只读、可随时删除或升级；项目（data\ media\ cache\）独立存放，可搬家/备份。
  项目根目录**不可在界面里修改** —— 换项目等价于 IDE 的"打开另一个项目"。

  项目结构（固定约定，不可配置）：
    <project>\
      project.json     标识文件（kind=pektino-project）
      data\            数据库 / 配置 / 日志 / 导出
      media\           媒体文件（mp4）
      cache\covers\    封面缓存（可删，自动重建）
      cache\thumbs\    缩略图缓存

  最近项目记录在 %APPDATA%\pektino\projects.json（不污染程序目录）。
#>

$script:ProjectLayout = @{
    projectFile = 'project.json'
    dataDir     = 'data'
    contentDir  = 'media'
    coversDir   = 'cache\covers'
    thumbsDir   = 'cache\thumbs'
    logsDir     = 'data\logs'
    exportsDir  = 'data\exports'
}

function Get-ProjectRegistryPath {
    $dir = Join-Path $env:APPDATA 'pektino'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return (Join-Path $dir 'projects.json')
}

function Get-RecentProjects {
    $p = Get-ProjectRegistryPath
    if (-not (Test-Path $p)) { return @() }
    try {
        $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
        return @($j.recent | Where-Object { $_ })
    } catch { return @() }
}

function Get-LastProject {
    $p = Get-ProjectRegistryPath
    if (-not (Test-Path $p)) { return '' }
    try {
        $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.last) { return [string]$j.last }
    } catch { }
    return ''
}

function Save-ProjectRegistry {
    param([string]$Path)
    $recent = @(Get-RecentProjects)
    $list = @($Path) + @($recent | Where-Object { $_ -ne $Path })
    $list = @($list | Select-Object -Unique | Select-Object -First 10)
    $obj = [ordered]@{ last = $Path; recent = $list; updated = (Get-Date).ToString('s') }
    ($obj | ConvertTo-Json -Depth 3) | Set-Content -Path (Get-ProjectRegistryPath) -Encoding UTF8 -Force
}

function Get-ProjectPaths {
    param([Parameter(Mandatory = $true)][string]$Root)

    $rootAbs = [System.IO.Path]::GetFullPath($Root)
    $L = $script:ProjectLayout
    [pscustomobject]@{
        ProjectRoot = $rootAbs
        ProjectFile = (Join-Path $rootAbs $L.projectFile)
        DataDir     = (Join-Path $rootAbs $L.dataDir)
        Database    = (Join-Path $rootAbs (Join-Path $L.dataDir 'data.db'))
        LedgerCsv   = (Join-Path $rootAbs (Join-Path $L.dataDir 'ledger.csv'))
        Content     = (Join-Path $rootAbs $L.contentDir)
        Covers      = (Join-Path $rootAbs $L.coversDir)
        Thumbs      = (Join-Path $rootAbs $L.thumbsDir)
        Logs        = (Join-Path $rootAbs $L.logsDir)
        Exports     = (Join-Path $rootAbs $L.exportsDir)
    }
}

function New-Project {
    <#  在指定文件夹里初始化项目结构（已存在则只补缺）  #>
    param([Parameter(Mandatory = $true)][string]$Root)

    $paths = Get-ProjectPaths -Root $Root
    foreach ($d in @($paths.DataDir, $paths.Content, $paths.Covers, $paths.Thumbs, $paths.Logs, $paths.Exports)) {
        if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }
    if (-not (Test-Path $paths.ProjectFile)) {
        $meta = [ordered]@{ version = 1; kind = 'pektino-project'; created = (Get-Date).ToString('s') }
        ($meta | ConvertTo-Json) | Set-Content -Path $paths.ProjectFile -Encoding UTF8 -Force
    }
    Save-ProjectRegistry -Path $paths.ProjectRoot
    return $paths
}

function Test-Project {
    param([string]$Root)
    if (-not $Root -or -not (Test-Path $Root)) { return $false }
    $marker = Join-Path $Root 'project.json'
    if (Test-Path $marker) { return $true }
    # 兼容：没有标识文件但已经有 data\ 目录，认为就是项目
    return (Test-Path (Join-Path $Root 'data'))
}

function Select-ProjectInteractive {
    <#  首次运行 / -Pick：像 IDE 的欢迎页一样选一个项目  #>
    param([string]$Suggested = '')

    $recent = @(Get-RecentProjects | Where-Object { Test-Path $_ })
    Write-Host ''
    Write-Host '  选择一个项目（数据与媒体都在项目文件夹里，可随时搬家）' -ForegroundColor Cyan
    if ($recent.Count) {
        Write-Host '  最近打开：' -ForegroundColor DarkGray
        for ($i = 0; $i -lt $recent.Count; $i++) {
            Write-Host ("    [{0}] {1}" -f ($i + 1), $recent[$i])
        }
    }
    if (-not $Suggested) {
        $docs = [Environment]::GetFolderPath('MyDocuments')
        $Suggested = Join-Path $docs 'pektino-project'
    }
    Write-Host ''
    Write-Host "  输入序号选择，或直接填一个文件夹路径（回车 = 新建/打开 $Suggested）" -ForegroundColor DarkGray
    try { $ans = Read-Host '  项目' } catch { $ans = '' }

    if (-not $ans) { return $Suggested }
    if ($ans -match '^\d+$') {
        $idx = [int]$ans - 1
        if ($idx -ge 0 -and $idx -lt $recent.Count) { return $recent[$idx] }
        return $Suggested
    }
    return $ans.Trim().Trim('"')
}

function Resolve-ProjectRoot {
    <#
      决定用哪个项目：
        1. -Project 参数
        2. 最近项目（存在才用）
        3. 交互选择（-NoPrompt 时不交互，直接建默认项目）
    #>
    param(
        [string]$Path = '',
        [switch]$Pick,
        [switch]$NoPrompt
    )

    if ($Path) {
        $abs = [System.IO.Path]::GetFullPath($Path)
        return (New-Project -Root $abs)
    }

    if (-not $Pick) {
        $last = Get-LastProject
        if ($last -and (Test-Project -Root $last)) {
            return (New-Project -Root $last)
        }
        # 上次的项目被删/搬走 → 用最近列表里第一个还能用的
        foreach ($r in @(Get-RecentProjects)) {
            if ($r -and (Test-Project -Root $r)) { return (New-Project -Root $r) }
        }
        if ($NoPrompt) {
            $docs = [Environment]::GetFolderPath('MyDocuments')
            return (New-Project -Root (Join-Path $docs 'pektino-project'))
        }
    }

    $chosen = Select-ProjectInteractive
    $abs = [System.IO.Path]::GetFullPath($chosen)
    return (New-Project -Root $abs)
}

$script:ProjectSummaryCache = $null

function Get-ProjectSummary {
    <#
      /api/state 在任务运行期间每 1.2 秒被轮询一次，而这里要枚举 media\*.mp4 统计数量和体积。
      文件一多（几千个）就变成每次请求都扫一遍目录 → 缓存 10 秒，界面看不出差别。
    #>
    param($Paths, [switch]$Refresh, [int]$MaxAgeSeconds = 10)

    $cache = $script:ProjectSummaryCache
    if (-not $Refresh -and $cache -and $cache.root -eq $Paths.ProjectRoot -and
        ((Get-Date) - $cache.at).TotalSeconds -lt $MaxAgeSeconds) {
        return $cache.value
    }

    $files = 0; $gb = 0
    if (Test-Path $Paths.Content) {
        $mp4 = @(Get-ChildItem -Path $Paths.Content -Filter '*.mp4' -File -Recurse -Depth 4 -ErrorAction SilentlyContinue)
        $files = $mp4.Count
        $gb = [math]::Round((($mp4 | Measure-Object Length -Sum).Sum) / 1GB, 2)
    }
    $covers = 0
    if (Test-Path $Paths.Covers) { $covers = @(Get-ChildItem -Path $Paths.Covers -Filter '*.jpg' -File -ErrorAction SilentlyContinue).Count }
    $dbMB = 0
    if (Test-Path $Paths.Database) { $dbMB = [math]::Round((Get-Item $Paths.Database).Length / 1MB, 2) }

    $summary = [pscustomobject]@{
        root       = $Paths.ProjectRoot
        data       = $Paths.DataDir
        media      = $Paths.Content
        cache      = (Split-Path $Paths.Covers -Parent)
        database   = $Paths.Database
        dbMB       = $dbMB
        videoCount = $files
        videoGB    = $gb
        coverCount = $covers
        exists     = (Test-Path $Paths.ProjectRoot)
    }
    $script:ProjectSummaryCache = @{ root = $Paths.ProjectRoot; at = (Get-Date); value = $summary }
    return $summary
}

function Import-ProjectFiles {
    <#
      识别项目 media\ 里已有的 mp4：台账里没有的补成 done 记录。

      以前这个函数直接读写 $State / $LedgerPath —— 那是 console.ps1 作用域的变量，
      靠「点源到同一作用域」才碰巧能跑，单独调用就炸。现在改成显式契约：
        -Rows      当前台账行（不给就从库/CSV 自己读）
        -SavePath  落盘路径（给了才持久化，并在 console 里补 Touch-State / 日志）
      返回的 rows 是合并后的完整行集，调用方自己决定要不要写回 $State。
    #>
    param(
        $Paths,
        $Rows = $null,
        [string]$SavePath = ''
    )

    if ($null -eq $Rows) { $Rows = @(Read-Ledger -Path $Paths.LedgerCsv) }

    $list = New-Object System.Collections.ArrayList
    $known = @{}
    foreach ($r in @($Rows)) {
        [void]$list.Add($r)
        if ($r.token) { $known[([string]$r.token).ToLower()] = $true }
    }

    $added = 0; $skipped = 0
    if (-not (Test-Path $Paths.Content)) { return [pscustomobject]@{ added = 0; skipped = 0; rows = @($list) } }

    foreach ($f in @(Get-ChildItem -Path $Paths.Content -Filter '*.mp4' -File -Recurse -Depth 4 -ErrorAction SilentlyContinue)) {
        $tk = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        $tk = ($tk -replace '\s*\(\d+\)$', '').Trim()
        if (-not $tk) { continue }
        if ($known.ContainsKey($tk.ToLower())) { $skipped++; continue }

        $now = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        # 本地文件顺便读时长/分辨率（Shell 属性），不依赖站点
        $meta = $null
        if (Get-Command Get-LocalMediaMeta -ErrorAction SilentlyContinue) {
            try { $meta = Get-LocalMediaMeta -File $f.FullName } catch { }
        }
        $row = [pscustomobject]@{
            token = $tk; status = 'done'; fav = ''; rank = ''; page = ''
            duration = $(if ($meta) { $meta.duration } else { '' })
            seconds = $(if ($meta) { $meta.seconds } else { '' })
            res = $(if ($meta) { $meta.res } else { '' })
            views = ''; likes = ''; uploaded = ''; url = ''; page_url = ''; site = 'local'
            first_seen = $now; last_seen = $now; sent_at = ''; note = 'scan:init'
            file_name = $f.Name; file_size = $f.Length; file_date = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
            play_count = ''; last_play = ''; rating = ''
        }
        [void]$list.Add($row)
        $known[$tk.ToLower()] = $true
        $added++
    }

    if ($added -gt 0 -and $SavePath) {
        Save-Ledger -Rows @($list) -Path $SavePath
        # 启动早期调用时这两个函数可能还没加载，别让它们把已落盘的结果吞掉
        if (Get-Command Touch-State -ErrorAction SilentlyContinue) { Touch-State }
        if (Get-Command Write-Log -ErrorAction SilentlyContinue) { Write-Log 'project' "识别已有媒体：新增 $added 条，跳过 $skipped 条" }
    }
    return [pscustomobject]@{ added = $added; skipped = $skipped; rows = @($list) }
}