#Requires -Version 5.1
<#
  Pektino 源适配器。

  站点约定：
    榜单页  /zh-CN、/zh-CN/weekly、/zh-CN/monthly、/zh-CN/all（?page=N）
    详情页  /zh-CN/movie/<token>
    详情页 JSON-LD VideoObject：name/title、contentUrl(mp4)、duration、thumbnailUrl、uploadDate、观看数
    点赞数：alt="お気に入り" 后的 <span>
#>

$script:PektinoBase = 'https://pektino.com'
$script:PektinoRankPath = @{ daily = '/zh-CN'; weekly = '/zh-CN/weekly'; monthly = '/zh-CN/monthly'; all = '/zh-CN/all' }

function Get-PektinoHttpClient {
    param($Context, [int]$TimeoutSec = 40)
    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 16
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Context -and $Context.proxy) {
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Context.proxy)
        $handler.UseProxy = $true
    }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd($(if ($Context -and $Context.ua) { $Context.ua } else { 'Mozilla/5.0' }))
    return $client
}

function Get-PektinoLdJson {
    param([string]$Html)
    $out = New-Object System.Collections.ArrayList
    foreach ($m in [regex]::Matches($Html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
        try { [void]$out.Add(($m.Groups[1].Value | ConvertFrom-Json)) } catch { }
    }
    return @($out)
}

function Format-PektinoDuration {
    param([string]$Iso)
    if ($Iso -notmatch '^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$') { return $Iso }
    $h = [int]$Matches[1]; $m = [int]$Matches[2]; $s = [int][double]$Matches[3]
    if ($h -gt 0) { return ('{0}:{1:00}:{2:00}' -f $h, $m, $s) }
    return ('{0}:{1:00}' -f $m, $s)
}

function Get-PektinoDurationSeconds {
    param([string]$Value)
    if (-not $Value) { return 0 }
    $v = $Value.Trim()
    if ($v -match '^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$') {
        return [int]([double]$Matches[1] * 3600 + [double]$Matches[2] * 60 + [double]$Matches[3])
    }
    if ($v -match '^(\d+):(\d+):(\d+(?:\.\d+)?)$') { return [int]([int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [double]$Matches[3]) }
    if ($v -match '^(\d+):(\d+(?:\.\d+)?)$') { return [int]([int]$Matches[1] * 60 + [double]$Matches[2]) }
    if ($v -match '^\d+(?:\.\d+)?$') { return [int][double]$v }
    return 0
}

function ConvertFrom-PektinoHtml {
    <#  把详情页 HTML 解析成规范化 item；无法识别返回 $null  #>
    param([string]$Html, [string]$Id)
    $vd = (Get-PektinoLdJson $Html) | Where-Object { $_.'@type' -eq 'VideoObject' } | Select-Object -First 1
    $pageUrl = "$script:PektinoBase/zh-CN/movie/$Id"
    $row = [pscustomobject]@{
        source_id     = $Id
        title         = ''
        duration      = ''
        seconds       = 0
        res           = ''
        views         = ''
        likes         = ''
        uploaded      = ''
        url           = ''
        page_url      = $pageUrl
        cover_url     = ''
        download_kind = 'http'
        download_headers = ''
        extra         = ''
    }
    if ($vd) {
        $row.title = [string]$vd.name
        $row.duration = Format-PektinoDuration ([string]$vd.duration)
        $row.seconds = Get-PektinoDurationSeconds ([string]$vd.duration)
        if (-not $row.seconds -and $row.duration) { $row.seconds = Get-PektinoDurationSeconds $row.duration }
        $row.uploaded = [string]$vd.uploadDate
        $row.cover_url = [string]$vd.thumbnailUrl
        $row.url = [string]$vd.contentUrl
        foreach ($st in @($vd.interactionStatistic)) {
            if ($st.interactionType.'@type' -eq 'WatchAction') { $row.views = [string]$st.userInteractionCount }
        }
    }
    if (-not $row.url) {
        $pat = 'https://video\.twimg\.com/[^"' + "'" + '\\ ]*?/' + [regex]::Escape($Id) + '\.mp4[^"' + "'" + '\\ ]*'
        $mm = [regex]::Match($Html, $pat)
        if ($mm.Success) { $row.url = $mm.Value }
    }
    if ($row.url -and $row.url -match '/vid/[^/]+/(\d+)x(\d+)/') {
        $row.res = "$($Matches[1])x$($Matches[2])"
    }
    if (-not $row.likes -and $Html -match 'alt="お気に入り"[^>]*/>\s*<span[^>]*>(\d+)<') {
        $row.likes = $Matches[1]
    }
    if (-not $row.url -and -not $row.cover_url) { return $null }
    return $row
}

function Get-PektinoDetail {
    param($Context, [string]$Id)
    if (-not $Id) { return $null }
    $client = Get-PektinoHttpClient -Context $Context -TimeoutSec 25
    try {
        $html = $client.GetStringAsync("$script:PektinoBase/zh-CN/movie/$Id").GetAwaiter().GetResult()
    } catch {
        return @{ error = $_.Exception.Message }
    } finally {
        try { $client.Dispose() } catch { }
    }
    return (ConvertFrom-PektinoHtml -Html $html -Id $Id)
}

function Get-PektinoCoverUrl {
    param($Context, $Row)
    if ($Row -and $Row.cover_url) { return [string]$Row.cover_url }
    $d = Get-PektinoDetail -Context $Context -Id (Get-ItemNativeId $Row)
    if ($d -and -not $d.error) { return [string]$d.cover_url }
    return ''
}

function Resolve-PektinoDownload {
    param($Context, $Row)
    return @{
        url     = [string]$Row.url
        mode    = 'http'
        headers = @{ Referer = [string]$Row.page_url }
    }
}

function Invoke-PektinoScrape {
    param($Context, $Options)

    $rank = if ($Options.rank) { [string]$Options.rank } else { 'daily' }
    $pages = @($Options.pages | ForEach-Object { [int]$_ } | Sort-Object -Unique)
    if (-not $pages.Count) { $pages = @(1) }
    $threads = if ($Options.threads) { [int]$Options.threads } else { 8 }
    $pageSize = if ($Options.pageSize) { [int]$Options.pageSize } else { 50 }
    $progress = [string]$Options.progressFile
    $started = if ($Options.started) { [datetime]$Options.started } else { Get-Date }
    $known = @{}
    if ($Options.knownTokens) { foreach ($k in @($Options.knownTokens)) { $known[[string]$k] = $true } }

    if (-not $script:PektinoRankPath.ContainsKey($rank)) { throw "不支持的榜单: $rank" }
    $client = Get-PektinoHttpClient -Context $Context
    try {
        # 1. 榜单页 -> 原生 token 列表
        $targets = New-Object System.Collections.ArrayList
        $seen = @{}
        $pi = 0
        Write-SourceProgress -Path $progress -Phase 'list' -Done 0 -Total $pages.Count -Started $started
        foreach ($p in $pages) {
            $pi++
            if ($p -lt 1) { continue }
            $url = $script:PektinoBase + $script:PektinoRankPath[$rank]
            if ($p -gt 1) { $url += "?page=$p" }
            try { $html = $client.GetStringAsync($url).GetAwaiter().GetResult() } catch { continue }
            $i = 0
            foreach ($m in [regex]::Matches($html, '/zh-CN/movie/([A-Za-z0-9_\-]+)')) {
                $tk = $m.Groups[1].Value
                if ($seen.ContainsKey($tk)) { continue }
                $seen[$tk] = $true
                $i++
                if ($i -gt $pageSize) { break }
                [void]$targets.Add([pscustomobject]@{
                        id = $tk; page = $p; rank = (($p - 1) * $pageSize + $i)
                    })
            }
            Write-SourceProgress -Path $progress -Phase 'list' -Done $pi -Total $pages.Count -Started $started
        }
        if ($targets.Count -eq 0) { throw '没能从榜单页拿到任何条目，站点结构可能变了' }
        if ($Options.limit -and [int]$Options.limit -gt 0) {
            $targets = @($targets | Select-Object -First ([int]$Options.limit))
        }

        # 2. 详情页并发
        $htmls = @{}
        $total = $targets.Count
        $done = 0
        for ($i = 0; $i -lt $total; $i += $threads) {
            $end = [Math]::Min($i + $threads - 1, $total - 1)
            $tasks = @{}
            foreach ($t in @($targets[$i..$end])) {
                if ($known.ContainsKey($t.id)) { $done++; continue }
                try { $tasks[$t.id] = $client.GetStringAsync("$script:PektinoBase/zh-CN/movie/$($t.id)") } catch { $done++ }
            }
            foreach ($tk in @($tasks.Keys)) {
                try { $htmls[$tk] = $tasks[$tk].GetAwaiter().GetResult() } catch { $htmls[$tk] = $null }
                $done++
            }
            Write-SourceProgress -Path $progress -Phase 'details' -Done $done -Total $total -Started $started
        }

        # 3. 解析
        $rows = New-Object System.Collections.ArrayList
        foreach ($t in $targets) {
            $html = $htmls[$t.id]
            $row = $null
            if ($html) { $row = ConvertFrom-PektinoHtml -Html $html -Id $t.id }
            if (-not $row) {
                $row = [pscustomobject]@{
                    source_id = $t.id; title = ''; duration = ''; seconds = 0; res = '';
                    views = ''; likes = ''; uploaded = ''; url = ''; page_url = "$script:PektinoBase/zh-CN/movie/$($t.id)";
                    cover_url = ''; download_kind = 'http'; download_headers = ''; extra = ''
                }
            }
            $row | Add-Member -NotePropertyName rank -NotePropertyValue $t.rank -Force
            $row | Add-Member -NotePropertyName page -NotePropertyValue $t.page -Force
            [void]$rows.Add($row)
        }
        return @($rows)
    } finally {
        try { $client.Dispose() } catch { }
    }
}
