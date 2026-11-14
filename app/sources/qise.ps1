#Requires -Version 5.1
<#
  qise100（91视频 / 九色）适配器。

  列表：/video?page=N（最新）、/video/category/hd?page=N（高清）
        <div class="video-elem"> + href="/video/viewhd/<hash>" + thumb + duration + title
  详情：/video/viewhd/<hash> 取标题/封面；/video/embed/<hash> 取真正的 m3u8
        （viewhd 页面里的 data-src 是广告位，不能直接用）
  下载：HLS（m3u8），走 ffmpeg
#>

$script:QiseBase = 'https://rfdjzz.qise100.com'
$script:QiseRanks = @{
    latest = '/video'
    hd     = '/video/category/hd'
}

function Get-QiseHttpClient {
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
    return $c
}

function Get-QiseHtml {
    <# 站点会先把完整 HTML 发完但不关连接：读流时看到 </html> 就停，不等 EOF #>
    param($Client, [string]$Url, [int]$ReadTimeoutMs = 3000)
    try {
        $resp = $Client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $ms = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 16384
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt 25) {
            $task = $stream.ReadAsync($buf, 0, $buf.Length)
            if (-not $task.Wait($ReadTimeoutMs)) { break }
            $n = $task.Result
            if ($n -le 0) { break }
            $ms.Write($buf, 0, $n)
            if ($ms.Length -gt 2000) {
                $tail = [Text.Encoding]::UTF8.GetString($ms.ToArray(), [Math]::Max(0, $ms.Length - 500), [Math]::Min(500, $ms.Length))
                if ($tail -match '</html>') { break }
            }
        }
        return [Text.Encoding]::UTF8.GetString($ms.ToArray())
    } catch { return '''' }
    finally { try { $stream.Close() } catch { }; try { $resp.Dispose() } catch { } }
}
function Get-QiseSeconds {
    param([string]$Text)
    if ($Text -match '^(\d+):(\d+):(\d+)$') { return [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3] }
    if ($Text -match '^(\d+):(\d+)$') { return [int]$Matches[1] * 60 + [int]$Matches[2] }
    return 0
}

function ConvertFrom-QiseList {
    param([string]$Html, [int]$Page)
    $out = New-Object System.Collections.ArrayList
    $seen = @{}
    foreach ($block in [regex]::Split($Html, '<div class="video-elem">')) {
        $m = [regex]::Match($block, 'href="/video/viewhd/([0-9a-f]+)"')
        if (-not $m.Success) { continue }
        $id = $m.Groups[1].Value
        if ($seen.ContainsKey($id)) { continue }
        $seen[$id] = $true

        $title = ''
        $mt = [regex]::Match($block, 'class="title[^"]*"[^>]*>([^<]*)</a>')
        if ($mt.Success) { $title = [System.Net.WebUtility]::HtmlDecode($mt.Groups[1].Value).Trim() }

        $cover = ''
        $mc = [regex]::Match($block, '<img[^>]+src="([^"]*thumb/[^"]+)"')
        if ($mc.Success) { $cover = $mc.Groups[1].Value; if ($cover.StartsWith('//')) { $cover = 'https:' + $cover } }

        $dur = ''
        $md = [regex]::Match($block, '<small class="layer">([^<]*)</small>')
        if ($md.Success) { $dur = $md.Groups[1].Value.Trim() }

        $views = ''
        $mv = [regex]::Match($block, '([\d,]+)\s*次播放')
        if ($mv.Success) { $views = $mv.Groups[1].Value -replace ',' }

        $date = ''
        $mdate = [regex]::Match($block, '(\d{4}-\d{2}-\d{2})')
        if ($mdate.Success) { $date = $mdate.Groups[1].Value }

        [void]$out.Add([pscustomobject]@{
                source_id = $id
                title     = $title
                duration  = $dur
                seconds   = (Get-QiseSeconds $dur)
                res       = ''
                views     = $views
                likes     = ''
                uploaded  = $date
                url       = ''
                page_url  = "$script:QiseBase/video/viewhd/$id"
                cover_url = $cover
                download_kind = 'hls'
                download_headers = ''
                extra     = ''
                page      = $Page
            })
    }
    return @($out)
}

function ConvertFrom-QiseDetail {
    param([string]$ViewHtml, [string]$EmbedHtml, [string]$Id)
    $title = ''
    $m = [regex]::Match($ViewHtml, 'property="og:title"\s+content="([^"]*)"')
    if ($m.Success) { $title = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value).Trim() }
    if (-not $title) {
        $m = [regex]::Match($ViewHtml, '<title>(.*?)</title>')
        if ($m.Success) { $title = ($m.Groups[1].Value -replace '\s*-\s*91.*$', '').Trim() }
    }
    $cover = ''
    $m = [regex]::Match($ViewHtml, 'thumb/(\d+)\.jpg')
    if ($m.Success) { $cover = "https://4a45b142a0.ucloud165.xyz/thumb/$($m.Groups[1].Value).jpg" }
    $m = [regex]::Match($EmbedHtml, 'data-poster="([^"]+)"')
    if ($m.Success) { $cover = $m.Groups[1].Value }

    $m3u8 = ''
    $m = [regex]::Match($EmbedHtml, 'data-src="(https?://[^"]+\.m3u8[^"]*)"')
    if ($m.Success) { $m3u8 = $m.Groups[1].Value }
    if (-not $m3u8) {
        $m = [regex]::Match($ViewHtml, 'data-src="(https?://[^"]+\.m3u8[^"]*)"')
        if ($m.Success) { $m3u8 = $m.Groups[1].Value }
    }
    if (-not $m3u8) { return $null }

    return [pscustomobject]@{
        source_id = $Id
        title     = $title
        duration  = ''
        seconds   = 0
        res       = ''
        views     = ''
        likes     = ''
        uploaded  = ''
        url       = $m3u8
        page_url  = "$script:QiseBase/video/viewhd/$Id"
        cover_url = $cover
        download_kind = 'hls'
        download_headers = (@{ Referer = "$script:QiseBase/" } | ConvertTo-Json -Compress)
        extra     = ''
    }
}

function Get-QiseDetail {
    param($Context, [string]$Id, [bool]$Hd = $true)
    if (-not $Id) { return $null }
    $client = Get-QiseHttpClient -Context $Context
    try {
        $viewPath = if ($Hd) { 'viewhd' } else { 'view' }
        try { $view = Get-QiseHtml -Client $client -Url "$script:QiseBase/video/$viewPath/$Id" } catch { $view = '' }
        try { $embed = Get-QiseHtml -Client $client -Url "$script:QiseBase/video/embed/$Id" } catch { $embed = '' }
    } finally { try { $client.Dispose() } catch { } }
    if (-not $embed -and -not $view) { return @{ error = '详情页请求失败' } }
    $d = ConvertFrom-QiseDetail -ViewHtml $view -EmbedHtml $embed -Id $Id
    if (-not $d) { return @{ error = '没有找到 m3u8（可能需要登录/VIP）' } }
    # 列表页的时长在详情页没有，尽量从 viewhd 的 JSON 里补
    if ($view -match '"duration"\s*:\s*"?(\d+)"?') {
        $sec = [int]$Matches[1]
        if ($sec -gt 0) {
            $d.seconds = $sec
            $d.duration = if ($sec -ge 3600) { '{0:D2}:{1:D2}:{2:D2}' -f [int]($sec/3600), [int](($sec%3600)/60), [int]($sec%60) } else { '{0:D2}:{1:D2}' -f [int]($sec/60), [int]($sec%60) }
        }
    }
    return $d
}

function Get-QiseCoverUrl {
    param($Context, $Row)
    if ($Row -and $Row.cover_url) { return [string]$Row.cover_url }
    $d = Get-QiseDetail -Context $Context -Id (Get-ItemNativeId $Row)
    if ($d -and -not $d.error) { return [string]$d.cover_url }
    return ''
}

function Resolve-QiseDownload {
    param($Context, $Row)
    $url = [string]$Row.url
    # 未登录/VIP 时 m3u8 只有一段 6 秒的提示片（__vnotice），不要当正片下载
    if ($url -match '^https?://') {
        try {
            $client = Get-QiseHttpClient -Context $Context -TimeoutSec 15
            try { $pl = Get-QiseHtml -Client $client -Url $url } finally { try { $client.Dispose() } catch { } }
            $segs = [regex]::Matches($pl, '#EXTINF').Count
            if ($pl -match '__vnotice' -or $segs -lt 2) {
                return @{ url = $url; mode = 'vip'; headers = @{ Referer = "$script:QiseBase/" } }
            }
        } catch { }
    }
    return @{
        url     = $url
        mode    = 'hls'
        headers = @{ Referer = "$script:QiseBase/" }
    }
}

function Invoke-QiseScrape {
    param($Context, $Options)
    $hd = if ($null -ne $Options.hd) { [bool]$Options.hd } else { $false }
    # 直接从 URL 抓：详情页抓单条，列表页抓该页
    if ($Options.url) {
        $u = [string]$Options.url
        if ($u -match '#hd0') { $hd = $false; $u = $u -replace '#hd0$', '' }
        $client = Get-QiseHttpClient -Context $Context
        try {
            $m = [regex]::Match($u, '/video/(?:viewhd|view|embed)/([0-9a-f]+)')
            if ($m.Success) {
                $startedUrl = Get-Date
                Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'details' -Done 0 -Total 1 -Started $startedUrl
                $d = Get-QiseDetail -Context $Context -Id $m.Groups[1].Value -Hd $hd
                if (-not $d -or $d.error) { throw "详情解析失败: $($d.error)" }
                $d.page_url = "$script:QiseBase/video/$(if ($hd) { 'viewhd' } else { 'view' })/$($m.Groups[1].Value)"
                $d.extra = "hd=$(if ($hd) { 1 } else { 0 })"
                $d | Add-Member -NotePropertyName page -NotePropertyValue 1 -Force
                $d | Add-Member -NotePropertyName rank -NotePropertyValue 1 -Force
                Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'done' -Done 1 -Total 1 -Started $startedUrl
                return @($d)
            }
            $html = Get-QiseHtml -Client $client -Url $u
            $items = @(ConvertFrom-QiseList -Html $html -Page 1)
            if ($Options.limit -and [int]$Options.limit -gt 0) { $items = @($items | Select-Object -First ([int]$Options.limit)) }
            $total = $items.Count; $done = 0
            $startedUrl = Get-Date
            Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'details' -Done 0 -Total $total -Started $startedUrl
            foreach ($it in $items) {
                $it.page_url = "$script:QiseBase/video/$(if ($hd) { 'viewhd' } else { 'view' })/$($it.source_id)"
                $viewHtml = Get-QiseHtml -Client $client -Url $it.page_url
                $embedHtml = Get-QiseHtml -Client $client -Url "$script:QiseBase/video/embed/$($it.source_id)"
                $d = ConvertFrom-QiseDetail -ViewHtml $viewHtml -EmbedHtml $embedHtml -Id $it.source_id
                if ($d) { foreach ($f in @('title', 'url', 'cover_url', 'download_headers')) { if ($d.$f) { $it.$f = $d.$f } } }
                $it.extra = "hd=$(if ($hd) { 1 } else { 0 })"
                $done++
                Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'details' -Done $done -Total $total -Started $startedUrl
            }
            return @($items | Where-Object { $_.url })
        } finally { try { $client.Dispose() } catch { } }
    }

    $rank = if ($Options.rank) { [string]$Options.rank } else { 'latest' }
    if (-not $script:QiseRanks.ContainsKey($rank)) { throw "不支持的榜单: $rank" }
    $pages = @($Options.pages | ForEach-Object { [int]$_ } | Sort-Object -Unique)
    if (-not $pages.Count) { $pages = @(1) }
    $threads = if ($Options.threads) { [int]$Options.threads } else { 8 }
    $limit = if ($Options.limit) { [int]$Options.limit } else { 0 }
    $progress = [string]$Options.progressFile
    $started = if ($Options.started) { [datetime]$Options.started } else { Get-Date }
    $known = @{}
    if ($Options.knownTokens) { foreach ($k in @($Options.knownTokens)) { $known[[string]$k] = $true } }

    $client = Get-QiseHttpClient -Context $Context
    try {
        $items = New-Object System.Collections.ArrayList
        $seen = @{}
        $pi = 0
        Write-SourceProgress -Path $progress -Phase 'list' -Done 0 -Total $pages.Count -Started $started
        foreach ($p in $pages) {
            $pi++
            $url = "$script:QiseBase$($script:QiseRanks[$rank])?page=$p"
            $html = $null
            try { $html = Get-QiseHtml -Client $client -Url $url } catch { continue }
            foreach ($it in @(ConvertFrom-QiseList -Html $html -Page $p)) {
                if ($seen.ContainsKey($it.source_id)) { continue }
                $seen[$it.source_id] = $true
                [void]$items.Add($it)
            }
            Write-SourceProgress -Path $progress -Phase 'list' -Done $pi -Total $pages.Count -Started $started
        }
        if ($limit -gt 0) { $items = @($items | Select-Object -First $limit) }

        # 详情页补 m3u8 / 标题 / 封面（站点响应慢且不关连接，用容错读取，逐条跑）
        $total = $items.Count
        $done = 0
        foreach ($it in $items) {
            if (-not $known.ContainsKey($it.source_id)) {
                $it.page_url = "$script:QiseBase/video/$(if ($hd) { 'viewhd' } else { 'view' })/$($it.source_id)"
                $viewHtml = Get-QiseHtml -Client $client -Url $it.page_url
                $embedHtml = Get-QiseHtml -Client $client -Url "$script:QiseBase/video/embed/$($it.source_id)"
                $d = ConvertFrom-QiseDetail -ViewHtml $viewHtml -EmbedHtml $embedHtml -Id $it.source_id
                if ($d) {
                    foreach ($f in @('title', 'url', 'cover_url', 'download_headers')) {
                        if ($d.$f) { $it.$f = $d.$f }
                    }
                }
                $it.extra = "hd=$(if ($hd) { 1 } else { 0 })"
            }
            $done++
            Write-SourceProgress -Path $progress -Phase 'details' -Done $done -Total $total -Started $started
        }
        return @($items | Where-Object { $_.url })
    } finally { try { $client.Dispose() } catch { } }
}
