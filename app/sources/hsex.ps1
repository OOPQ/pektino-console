#Requires -Version 5.1
<#
  hsex.icu 适配器。

  列表：/ 或 /index-<page>.htm
        <a href="video-<id>.htm"> + class="image" style=background-image + <var class="duration">
        + <h5><a>标题</a></h5> + "N次观看"
  详情：og:title / video:duration / <source id="video-source" src="...m3u8">
  下载：HLS（m3u8），需要 ffmpeg（下载器会明确拒绝，避免把播放列表当 mp4 存下来）
#>

$script:HsexBase = 'https://hsex.icu'
$script:HsexRankPath = @{ latest = 'list'; weekly = 'top7_list'; monthly = 'top_list'; min5 = '5min_list'; long = 'long_list' }

function Get-HsexHttpClient {
    param($Context, [int]$TimeoutSec = 30)
    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 8
    $handler.UseProxy = $false
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Context -and $Context.proxy) {
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Context.proxy)
        $handler.UseProxy = $true
    }
    $c = New-Object System.Net.Http.HttpClient($handler)
    $c.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
    $c.DefaultRequestHeaders.UserAgent.ParseAdd($(if ($Context -and $Context.ua) { $Context.ua } else { 'Mozilla/5.0' }))
    $c.DefaultRequestHeaders.Referrer = [uri]$script:HsexBase
    return $c
}

function Get-HsexDurationSeconds {
    param([string]$Text)
    if (-not $Text) { return 0 }
    if ($Text -match '^(\d+):(\d+):(\d+)$') { return [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3] }
    if ($Text -match '^(\d+):(\d+)$') { return [int]$Matches[1] * 60 + [int]$Matches[2] }
    return 0
}

function ConvertFrom-HsexList {
    param([string]$Html, [int]$Page)
    $out = New-Object System.Collections.ArrayList
    $seen = @{}
    $blocks = [regex]::Split($Html, '<div class="col-xs-6 col-md-3">')
    foreach ($b in $blocks) {
        $mh = [regex]::Match($b, '<h5><a[^>]+href="video-(\d+)\.htm"[^>]*>([^<]*)</a>')
        if (-not $mh.Success) { continue }
        $id = $mh.Groups[1].Value
        if ($seen.ContainsKey($id)) { continue }
        $seen[$id] = $true
        $mc = [regex]::Match($b, "style=""background-image:\s*url\('([^']+)'\)""")
        $md = [regex]::Match($b, '<var class="duration">([^<]*)</var>')
        $mv = [regex]::Match($b, '(\d+)次观看')
        $title = [System.Net.WebUtility]::HtmlDecode($mh.Groups[2].Value).Trim()
        $dur = if ($md.Success) { $md.Groups[1].Value.Trim() } else { '' }
        [void]$out.Add([pscustomobject]@{
                source_id = $id
                title     = $title
                duration  = $dur
                seconds   = (Get-HsexDurationSeconds $dur)
                res       = ''
                views     = $(if ($mv.Success) { $mv.Groups[1].Value } else { '' })
                likes     = ''
                uploaded  = ''
                url       = ''
                page_url  = "$script:HsexBase/video-$id.htm"
                cover_url = $(if ($mc.Success) { $mc.Groups[1].Value } else { '' })
                download_kind = 'hls'
                download_headers = ''
                extra     = ''
                page      = $Page
            })
    }
    return @($out)
}

function Get-HsexDetail {
    param($Context, [string]$Id)
    if (-not $Id) { return $null }
    $client = Get-HsexHttpClient -Context $Context
    try {
        $html = $client.GetStringAsync("$script:HsexBase/video-$Id.htm").GetAwaiter().GetResult()
    } catch {
        return @{ error = $_.Exception.Message }
    } finally { try { $client.Dispose() } catch { } }

    $m3u8 = [regex]::Match($html, '<source[^>]+id="video-source"[^>]+src="([^"]+)"')
    if (-not $m3u8.Success) {
        $m3u8 = [regex]::Match($html, '<source[^>]+src="([^"]+\.m3u8[^"]*)"')
    }
    if (-not $m3u8.Success) { return $null }

    $title = ''
    $m = [regex]::Match($html, 'property="og:title"\s+content="([^"]*)"')
    if ($m.Success) { $title = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value).Trim() }
    if (-not $title) { $m = [regex]::Match($html, '<title>(.*?)</title>'); if ($m.Success) { $title = ($m.Groups[1].Value -replace '\s*-\s*好色.*$', '').Trim() } }

    $dur = ''
    $m = [regex]::Match($html, 'property="video:duration"\s+content="([^"]+)"')
    if ($m.Success) { $dur = $m.Groups[1].Value }
    $sec = Get-HsexDurationSeconds $dur

    $views = ''
    $m = [regex]::Match($html, '观看[：:]\s*(\d+)')
    if ($m.Success) { $views = $m.Groups[1].Value }

    $cover = ''
    $m = [regex]::Match($html, 'poster="([^"]+)"')
    if ($m.Success) { $cover = $m.Groups[1].Value }
    if (-not $cover) { $m = [regex]::Match($html, 'property="og:image"\s+content="([^"]+)"'); if ($m.Success) { $cover = $m.Groups[1].Value } }

    return [pscustomobject]@{
        source_id = $Id
        title     = $title
        duration  = $dur
        seconds   = $sec
        res       = ''
        views     = $views
        likes     = ''
        uploaded  = ''
        url       = $m3u8.Groups[1].Value
        page_url  = "$script:HsexBase/video-$Id.htm"
        cover_url = $cover
        download_kind = 'hls'
        download_headers = (@{ Referer = "$script:HsexBase/" } | ConvertTo-Json -Compress)
        extra     = ''
    }
}

function Get-HsexCoverUrl {
    param($Context, $Row)
    if ($Row -and $Row.cover_url) { return [string]$Row.cover_url }
    $d = Get-HsexDetail -Context $Context -Id (Get-ItemNativeId $Row)
    if ($d -and -not $d.error) { return [string]$d.cover_url }
    return ''
}

function Resolve-HsexDownload {
    param($Context, $Row)
    return @{
        url     = [string]$Row.url
        mode    = 'hls'
        headers = @{ Referer = "$script:HsexBase/"; Origin = $script:HsexBase }
    }
}

function Invoke-HsexScrape {
    param($Context, $Options)
    $rank = if ($Options.rank) { [string]$Options.rank } else { 'latest' }
    if (-not $script:HsexRankPath.ContainsKey($rank)) { throw "不支持的榜单: $rank" }
    $pages = @($Options.pages | ForEach-Object { [int]$_ } | Sort-Object -Unique)
    if (-not $pages.Count) { $pages = @(1) }
    $threads = if ($Options.threads) { [int]$Options.threads } else { 8 }
    $limit = if ($Options.limit) { [int]$Options.limit } else { 0 }
    $progress = [string]$Options.progressFile
    $started = if ($Options.started) { [datetime]$Options.started } else { Get-Date }
    $known = @{}
    if ($Options.knownTokens) { foreach ($k in @($Options.knownTokens)) { $known[[string]$k] = $true } }

    $client = Get-HsexHttpClient -Context $Context
    try {
        $items = New-Object System.Collections.ArrayList
        $seen = @{}
        $pi = 0
        Write-SourceProgress -Path $progress -Phase 'list' -Done 0 -Total $pages.Count -Started $started
        foreach ($p in $pages) {
            $pi++
            if ($p -lt 1) { continue }
            $url = "$script:HsexBase/$($script:HsexRankPath[$rank])-$p.htm"
            $html = $null
            try { $html = $client.GetStringAsync($url).GetAwaiter().GetResult() } catch { continue }
            foreach ($it in @(ConvertFrom-HsexList -Html $html -Page $p)) {
                if ($seen.ContainsKey($it.source_id)) { continue }
                $seen[$it.source_id] = $true
                [void]$items.Add($it)
            }
            Write-SourceProgress -Path $progress -Phase 'list' -Done $pi -Total $pages.Count -Started $started
        }
        if ($limit -gt 0) { $items = @($items | Select-Object -First $limit) }

        # 详情页补 m3u8 / 精确标题 / 时长；并发执行
        $total = $items.Count
        $done = 0
        for ($i = 0; $i -lt $total; $i += $threads) {
            $end = [Math]::Min($i + $threads - 1, $total - 1)
            $tasks = @{}
            foreach ($it in @($items[$i..$end])) {
                if ($known.ContainsKey($it.source_id)) { $done++; continue }
                try { $tasks[$it.source_id] = $client.GetStringAsync($it.page_url) } catch { $done++ }
            }
            foreach ($id in @($tasks.Keys)) {
                try {
                    $html = $tasks[$id].GetAwaiter().GetResult()
                    $d = ConvertFrom-HsexDetailHtml -Html $html -Id $id
                    if ($d) {
                        $target = $items | Where-Object { $_.source_id -eq $id } | Select-Object -First 1
                        foreach ($f in @('title', 'duration', 'seconds', 'views', 'cover_url', 'url', 'download_headers')) {
                            if ($d.$f) { $target.$f = $d.$f }
                        }
                    }
                } catch { }
                $done++
            }
            Write-SourceProgress -Path $progress -Phase 'details' -Done $done -Total $total -Started $started
        }
        return @($items | Where-Object { $_.url })
    } finally { try { $client.Dispose() } catch { } }
}

function ConvertFrom-HsexDetailHtml {
    param([string]$Html, [string]$Id)
    $m3u8 = [regex]::Match($Html, '<source[^>]+id="video-source"[^>]+src="([^"]+)"')
    if (-not $m3u8.Success) { $m3u8 = [regex]::Match($Html, '<source[^>]+src="([^"]+\.m3u8[^"]*)"') }
    if (-not $m3u8.Success) { return $null }
    $title = ''
    $m = [regex]::Match($Html, 'property="og:title"\s+content="([^"]*)"')
    if ($m.Success) { $title = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value).Trim() }
    $dur = ''; $m = [regex]::Match($Html, 'property="video:duration"\s+content="([^"]+)"'); if ($m.Success) { $dur = $m.Groups[1].Value }
    $views = ''; $m = [regex]::Match($Html, '观看[：:]\s*(\d+)'); if ($m.Success) { $views = $m.Groups[1].Value }
    $cover = ''; $m = [regex]::Match($Html, 'poster="([^"]+)"'); if ($m.Success) { $cover = $m.Groups[1].Value }
    return [pscustomobject]@{
        title = $title; duration = $dur; seconds = (Get-HsexDurationSeconds $dur); views = $views;
        cover_url = $cover; url = $m3u8.Groups[1].Value
        download_headers = (@{ Referer = "$script:HsexBase/" } | ConvertTo-Json -Compress)
    }
}
