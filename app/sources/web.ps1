#Requires -Version 5.1
<#
  web 源：单条视频链接的通用解析，用于测试/临时入库。

  支持：
    - 直接媒体地址（.mp4 / .m3u8）
    - 普通视频页面：og:title / og:image / <video src> / <source src> / 页面里第一个 m3u8|mp4
  不保证所有站点都能解析；复杂站点请写专用适配器。
#>

function Get-WebHttpClient {
    param($Context, [int]$TimeoutSec = 25)
    Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 4
    $handler.UseProxy = $false
    if ($Context -and $Context.proxy) {
        $handler.UseProxy = $true
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Context.proxy)
    }
    $c = New-Object System.Net.Http.HttpClient($handler)
    $c.Timeout = [TimeSpan]::FromSeconds($TimeoutSec)
    $c.DefaultRequestHeaders.UserAgent.ParseAdd($(if ($Context -and $Context.ua) { $Context.ua } else { 'Mozilla/5.0' }))
    return $c
}

function Get-WebHtml {
    param($Client, [string]$Url)
    try {
        $resp = $Client.GetAsync($Url, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $stream = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $ms = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 16384
        $sw = [Diagnostics.Stopwatch]::StartNew()
        while ($sw.Elapsed.TotalSeconds -lt 20) {
            $task = $stream.ReadAsync($buf, 0, $buf.Length)
            if (-not $task.Wait(2500)) { break }
            $n = $task.Result
            if ($n -le 0) { break }
            $ms.Write($buf, 0, $n)
            if ($ms.Length -gt 2000) {
                $tail = [Text.Encoding]::UTF8.GetString($ms.ToArray(), [Math]::Max(0, $ms.Length - 500), [Math]::Min(500, $ms.Length))
                if ($tail -match '</html>') { break }
            }
        }
        return [Text.Encoding]::UTF8.GetString($ms.ToArray())
    } catch { return '' }
    finally { try { $stream.Close() } catch { }; try { $resp.Dispose() } catch { } }
}

function Get-WebId {
    param([string]$Url)
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes($Url))
    $hash = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    return $hash.Substring(0, 12)
}

function Invoke-WebScrape {
    param($Context, $Options)
    $url = [string]$Options.url
    if (-not $url) { throw 'web 源需要填一个视频页面/直链 URL' }
    $startedUrl = Get-Date
    Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'details' -Done 0 -Total 1 -Started $startedUrl
    $ctxHost = ''
    try { $ctxHost = ([uri]$url).GetLeftPart([System.UriPartial]::Authority) } catch { }

    # 直接媒体地址
    if ($url -match '\.(m3u8|mp4)(\?|$|#)') {
        $name = ''
        try { $name = [System.IO.Path]::GetFileName(([uri]$url).AbsolutePath) } catch { }
        Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'done' -Done 1 -Total 1 -Started $startedUrl
        return @([pscustomobject]@{
                source_id = (Get-WebId $url); title = $(if ($name) { $name } else { $url })
                duration = ''; seconds = 0; res = ''; views = ''; likes = ''; uploaded = ''
                url = $url; page_url = $url; cover_url = ''
                download_kind = $(if ($url -match '\.m3u8') { 'hls' } else { 'http' })
                download_headers = ''; extra = ''; page = 1; rank = 1
            })
    }

    $client = Get-WebHttpClient -Context $Context
    try { $html = Get-WebHtml -Client $client -Url $url } finally { try { $client.Dispose() } catch { } }
    if (-not $html) { throw "页面请求失败: $url" }

    $title = ''
    $m = [regex]::Match($html, 'property="og:title"\s+content="([^"]*)"')
    if ($m.Success) { $title = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value).Trim() }
    if (-not $title) { $m = [regex]::Match($html, '<title>(.*?)</title>'); if ($m.Success) { $title = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value).Trim() } }

    $cover = ''
    $m = [regex]::Match($html, 'property="og:image"\s+content="([^"]*)"')
    if ($m.Success) { $cover = $m.Groups[1].Value }

    $media = ''
    foreach ($pat in @(
            '<video[^>]+src="([^"]+)"',
            '<source[^>]+src="([^"]+)"',
            'property="og:video(?::url)?"\s+content="([^"]+)"',
            'name="twitter:player:stream"\s+content="([^"]+)"'
        )) {
        $m = [regex]::Match($html, $pat, 'Singleline')
        if ($m.Success -and $m.Groups[1].Value) { $media = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value); break }
    }
    if (-not $media) {
        $m = [regex]::Match($html, 'https?://[^"''\s<>]+\.(?:m3u8|mp4)(?:\?[^"''\s<>]*)?')
        if ($m.Success) { $media = $m.Value }
    }
    if (-not $media) { throw "页面里没有找到 m3u8/mp4: $url" }
    if ($media.StartsWith('//')) { $media = 'https:' + $media }
    elseif ($media.StartsWith('/')) { $media = $ctxHost + $media }

    Write-SourceProgress -Path ([string]$Options.progressFile) -Phase 'done' -Done 1 -Total 1 -Started $startedUrl
    return @([pscustomobject]@{
            source_id = (Get-WebId $url); title = $(if ($title) { $title } else { $url })
            duration = ''; seconds = 0; res = ''; views = ''; likes = ''; uploaded = ''
            url = $media; page_url = $url; cover_url = $cover
            download_kind = $(if ($media -match '\.m3u8') { 'hls' } else { 'http' })
            download_headers = (@{ Referer = $url } | ConvertTo-Json -Compress)
            extra = ''; page = 1; rank = 1
        })
}

function Resolve-WebDownload {
    param($Context, $Row)
    $mode = if ($Row.download_kind) { [string]$Row.download_kind } else { 'http' }
    return @{ url = [string]$Row.url; mode = $mode; headers = @{ Referer = [string]$Row.page_url } }
}
