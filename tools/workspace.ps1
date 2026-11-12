#Requires -Version 5.1
<#
.SYNOPSIS
  工作区（workspace）：把数据、封面、下载、日志都放在一个可整体搬移的目录里。
.DESCRIPTION
  - 所有配置存 workspace.json 里的**相对路径**，项目目录整体拷到别的盘/移动硬盘后仍然可用
  - 首次使用自动初始化目录结构；已有文件会被识别并入库
  - 也允许把某一项配成绝对路径（例如下载目录放另外一块磁盘）
.NOTES
  workspace.json 结构：
  {
    "version": 1,
    "name": "pektino",
    "dataDir":     "out",              // 相对项目根，或绝对路径
    "downloadDir": "out\\downloads",    // 相对项目根 / 相对 dataDir / 绝对路径
    "coversDir":   "out\\covers",
    "thumbsDir":   "out\\thumbs",
    "logsDir":     "out",
    "exportsDir":  "out"
  }
#>

$script:WorkspaceFile = $null
$script:WorkspaceRoot = $null   # 项目根（tools 的上级）

function Get-WorkspaceFilePath {
    param([string]$ProjectRoot)
    Join-Path $ProjectRoot 'workspace.json'
}

function Resolve-WorkspacePath {
    <#  把配置里的路径解析成绝对路径；相对路径先按项目根，再按 dataDir 兜底  #>
    param([string]$Value, [string]$ProjectRoot, [string]$DataDir)
    if (-not $Value) { return '' }
    if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
    # 相对路径统一挂在 dataDir 下，整体搬移时不会错位
    return [System.IO.Path]::GetFullPath((Join-Path $DataDir $Value))
}

function New-WorkspaceLayout {
    param([string]$ProjectRoot, [string]$DataDir)

    $cfg = [ordered]@{
        version     = 1
        name        = 'pektino'
        dataDir     = $DataDir
        downloadDir = 'downloads'
        coversDir   = 'covers'
        thumbsDir   = 'thumbs'
        logsDir     = 'logs'
        exportsDir  = 'exports'
        createdAt   = (Get-Date).ToString('s')
    }
    return $cfg
}

function Initialize-Workspace {
    <#
      初始化（或加载）工作区：
        - 有 workspace.json → 读它
        - 没有 → 在 $ProjectRoot 下创建，数据目录用 $DataDir（默认 out，兼容老版本）
        - 缺哪个子目录就补哪个
    #>
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [string]$DataDir = '',
        [switch]$Quiet
    )

    $file = Get-WorkspaceFilePath -ProjectRoot $ProjectRoot
    $cfg = $null

    if (Test-Path $file) {
        try { $cfg = Get-Content $file -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $cfg = $null }
    }

    if (-not $cfg) {
        if (-not $DataDir) {
            # 老版本数据在 tools\out：沿用；全新安装用项目下的 data\
            if (Test-Path (Join-Path $ProjectRoot 'tools\out\data.db')) { $DataDir = 'tools\out' }
            else { $DataDir = 'data' }
        }
        $cfg = [pscustomobject](New-WorkspaceLayout -ProjectRoot $ProjectRoot -DataDir $DataDir)
        ($cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $file -Encoding UTF8 -Force
        if (-not $Quiet) { Write-Host "已创建工作区配置: $file" -ForegroundColor Green }
    }

    # 命令行显式指定 dataDir：写回配置（在项目内则存相对路径，方便整体搬移）
    if ($DataDir) {
        $stored = $DataDir
        try {
            $absTarget = [System.IO.Path]::GetFullPath($(if ([System.IO.Path]::IsPathRooted($DataDir)) { $DataDir } else { Join-Path $ProjectRoot $DataDir }))
            $absRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
            if ($absTarget.StartsWith($absRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                $stored = $absTarget.Substring($absRoot.Length).TrimStart('\')
            } else { $stored = $absTarget }
        } catch { }
        if ($stored -ne $cfg.dataDir) {
            $cfg | Add-Member -NotePropertyName dataDir -NotePropertyValue $stored -Force
            ($cfg | ConvertTo-Json -Depth 4) | Set-Content -Path $file -Encoding UTF8 -Force
        }
    }

    $absData = Resolve-WorkspacePath -Value $cfg.dataDir -ProjectRoot $ProjectRoot -DataDir $ProjectRoot
    $paths = [pscustomobject]@{
        File        = $file
        Config      = $cfg
        ProjectRoot = $ProjectRoot
        DataDir     = $absData
        Database    = (Join-Path $absData 'data.db')
        LedgerCsv   = (Join-Path $absData 'ledger.csv')
        Downloads   = (Resolve-WorkspacePath -Value $cfg.downloadDir -ProjectRoot $ProjectRoot -DataDir $absData)
        Covers      = (Resolve-WorkspacePath -Value $cfg.coversDir -ProjectRoot $ProjectRoot -DataDir $absData)
        Thumbs      = (Resolve-WorkspacePath -Value $cfg.thumbsDir -ProjectRoot $ProjectRoot -DataDir $absData)
        Logs        = (Resolve-WorkspacePath -Value $cfg.logsDir -ProjectRoot $ProjectRoot -DataDir $absData)
        Exports     = (Resolve-WorkspacePath -Value $cfg.exportsDir -ProjectRoot $ProjectRoot -DataDir $absData)
    }

    foreach ($d in @($paths.DataDir, $paths.Downloads, $paths.Covers, $paths.Thumbs, $paths.Logs, $paths.Exports)) {
        if ($d -and -not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
    }

    return $paths
}

function Save-WorkspaceConfig {
    param($Paths)
    ($Paths.Config | ConvertTo-Json -Depth 4) | Set-Content -Path $Paths.File -Encoding UTF8 -Force
}

function Get-WorkspaceSummary {
    param($Paths, [string]$Downloads = '')
    if ($Downloads) { $Paths.Downloads = $Downloads }
    $files = 0; $gb = 0
    if (Test-Path $Paths.Downloads) {
        $mp4 = @(Get-ChildItem -Path $Paths.Downloads -Filter '*.mp4' -File -ErrorAction SilentlyContinue)
        $files = $mp4.Count
        $gb = [math]::Round((($mp4 | Measure-Object Length -Sum).Sum) / 1GB, 2)
    }
    $covers = 0
    if (Test-Path $Paths.Covers) { $covers = @(Get-ChildItem -Path $Paths.Covers -Filter '*.jpg' -File -ErrorAction SilentlyContinue).Count }
    $dbMB = 0
    if (Test-Path $Paths.Database) { $dbMB = [math]::Round((Get-Item $Paths.Database).Length / 1MB, 2) }
    [pscustomobject]@{
        file         = $Paths.File
        projectRoot  = $Paths.ProjectRoot
        dataDir      = $Paths.DataDir
        downloads    = $Paths.Downloads
        covers       = $Paths.Covers
        thumbs       = $Paths.Thumbs
        database     = $Paths.Database
        dbMB         = $dbMB
        videoCount   = $files
        videoGB      = $gb
        coverCount   = $covers
    }
}

function Import-WorkspaceFiles {
    <#
      识别工作区里已有的视频文件：
        - 文件名去掉扩展名当作 token（去掉 " (1)" 这类重复后缀）
        - 台账里没有的 → 补一条 done 记录（note=scan:init）
        - 台账里有的 → 不重复加，交给 Invoke-Scan 更新 file_*
      返回 @{ added = n; skipped = n }
    #>
    param($Paths)

    $added = 0; $skipped = 0
    if (-not (Test-Path $Paths.Downloads)) { return [pscustomobject]@{ added = 0; skipped = 0 } }

    $known = @{}
    foreach ($r in @($State.Ledger)) { if ($r.token) { $known[([string]$r.token).ToLower()] = $true } }

    foreach ($f in @(Get-ChildItem -Path $Paths.Downloads -Filter '*.mp4' -File -ErrorAction SilentlyContinue)) {
        $tk = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
        $tk = ($tk -replace '\s*\(\d+\)$', '').Trim()
        if (-not $tk) { continue }
        if ($known.ContainsKey($tk.ToLower())) { $skipped++; continue }

        $row = [pscustomobject]@{
            token      = $tk
            status     = 'done'
            fav        = ''
            rank       = ''
            page       = ''
            duration   = ''
            seconds    = ''
            res        = ''
            views      = ''
            likes      = ''
            uploaded   = ''
            url        = ''
            page_url   = ''
            site       = 'local'
            first_seen = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            last_seen  = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
            sent_at    = ''
            note       = 'scan:init'
            file_name  = $f.Name
            file_size  = $f.Length
            file_date  = $f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
            play_count = ''
            last_play  = ''
            rating     = ''
        }
        $State.Ledger = @($State.Ledger) + $row
        $known[$tk.ToLower()] = $true
        $added++
    }

    if ($added -gt 0) {
        Save-Ledger -Rows $State.Ledger -Path $LedgerPath
        Touch-State
        Write-Log 'workspace' "识别已有文件：新增 $added 条，跳过 $skipped 条"
    }
    return [pscustomobject]@{ added = $added; skipped = $skipped }
}