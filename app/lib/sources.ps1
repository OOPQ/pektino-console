#Requires -Version 5.1
<#
.SYNOPSIS
  多源适配器注册表：加载 sources\sources.json，分发 scrape/detail/cover/download 调用。

.DESCRIPTION
  每个源 = sources\<key>.ps1，按约定导出函数：
    Invoke-<Pascal>Scrape   -Context <ctx> -Options <hashtable>   -> 规范化 item[]
    Get-<Pascal>Detail      -Context <ctx> -Id <native id>        -> 规范化 item / $null
    Get-<Pascal>CoverUrl    -Context <ctx> -Row <row>             -> 封面 URL
    Resolve-<Pascal>Download -Context <ctx> -Row <row>            -> @{url; mode; headers}

  规范化 item 字段（适配器返回，注册表统一补 source/token）：
    source_id, title, duration, seconds, res, views, likes, uploaded,
    url, page_url, cover_url, download_kind, download_headers, extra

  注意：适配器文件必须在**脚本顶层** dot-source（见 Get-SourceAdapterFiles），
  函数才会留在当前作用域；Initialize-Sources 只做清单/校验/缓存。
#>

$script:SourceManifest = @()
$script:SourceDefault = 'pektino'

function Get-SourceManifest {
    param([string]$Root)
    $manifest = Join-Path $Root 'sources\sources.json'
    if (-not (Test-Path -LiteralPath $manifest)) { throw "缺少源清单: $manifest" }
    $parsed = Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    $items = if ($parsed -is [System.Array]) { @($parsed) } else { @($parsed) }
    $out = New-Object System.Collections.ArrayList
    foreach ($m in $items) {
        if ($null -eq $m.key) { continue }
        $key = ([string]$m.key).ToLowerInvariant()
        if ($key -notmatch '^[a-z][a-z0-9]*$') { throw "源 key 不合法（只允许小写字母/数字）: $key" }
        $ranks = New-Object System.Collections.ArrayList
        foreach ($r in @($m.ranks)) {
            if (-not $r.key) { continue }
            [void]$ranks.Add([pscustomobject]@{
                    key   = [string]$r.key
                    label = $(if ($r.label) { [string]$r.label } else { [string]$r.key })
                    group = [string]$r.group
                    path  = [string]$r.path
                })
        }
        [void]$out.Add([pscustomobject]@{
                key          = $key
                name         = $(if ($m.name) { [string]$m.name } else { $key })
                file         = [string]$m.file
                enabled      = ($m.enabled -ne $false)
                order        = $(if ($null -ne $m.order) { [int]$m.order } else { 100 })
                capabilities = @($m.capabilities | ForEach-Object { [string]$_ })
                pascal       = (Get-Culture).TextInfo.ToTitleCase($key)
                siteUrl      = [string]$m.siteUrl
                pageSize     = $(if ($m.pageSize) { [int]$m.pageSize } else { 50 })
                supportsPages = ($m.supportsPages -ne $false)
                incremental  = ($m.incremental -ne $false)
                ranks        = @($ranks)
            })
    }
    return @($out | Sort-Object order, key)
}

function Get-SourceAdapterFiles {
    param([string]$Root)
    foreach ($s in @(Get-SourceManifest -Root $Root)) {
        if (-not $s.enabled) { continue }
        if (-not $s.file) { continue }
        Join-Path $Root ('sources\' + $s.file)
    }
}

function Initialize-Sources {
    param([string]$Root)
    $script:SourceManifest = @(Get-SourceManifest -Root $Root | Where-Object { $_.enabled })
    if (-not ($script:SourceManifest | Where-Object { $_.key -eq $script:SourceDefault })) {
        throw "源清单缺少默认源: $script:SourceDefault"
    }
    foreach ($s in $script:SourceManifest) {
        $need = @()
        if ($s.capabilities -contains 'scrape') { $need += "Invoke-$($s.pascal)Scrape" }
        if ($s.capabilities -contains 'detail') { $need += "Get-$($s.pascal)Detail" }
        if ($s.capabilities -contains 'cover') { $need += "Get-$($s.pascal)CoverUrl" }
        if ($s.capabilities -contains 'download') { $need += "Resolve-$($s.pascal)Download" }
        foreach ($fn in $need) {
            if (-not (Get-Command -Name $fn -ErrorAction SilentlyContinue)) {
                throw "源 $($s.key) 缺少必需函数: $fn（检查 $($s.file) 是否已 dot-source）"
            }
        }
    }
    return $script:SourceManifest
}

function Get-Sources {
    return @($script:SourceManifest)
}

function Get-SourceInfo {
    param([string]$Key)
    $k = ([string]$Key).ToLowerInvariant()
    return @($script:SourceManifest | Where-Object { $_.key -eq $k })[0]
}

function Get-DefaultSourceKey { return $script:SourceDefault }

function Resolve-SourceKey {
    <#  旧数据没有 source 字段时按默认源处理  #>
    param([string]$Key)
    if (-not $Key) { return $script:SourceDefault }
    $k = $Key.ToLowerInvariant()
    if ($script:SourceManifest | Where-Object { $_.key -eq $k }) { return $k }
    return $script:SourceDefault
}

function New-ItemToken {
    <#  默认源保持裸 token（兼容老数据/文件名）；其他源用 <source>@<native id>  #>
    param([string]$Source, [string]$Id)
    $src = Resolve-SourceKey $Source
    $id = [string]$Id
    if ($src -eq $script:SourceDefault) { return $id }
    return ($src + '@' + $id)
}

function Split-ItemToken {
    <#  返回 @{ source; id }；未知前缀按默认源处理  #>
    param([string]$Token)
    $t = [string]$Token
    foreach ($s in $script:SourceManifest) {
        if ($s.key -eq $script:SourceDefault) { continue }
        $prefix = "$($s.key)@"
        if ($t.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            return @{ source = $s.key; id = $t.Substring($prefix.Length) }
        }
    }
    return @{ source = $script:SourceDefault; id = $t }
}

function Get-ItemSource {
    param($Row)
    if ($Row -and $Row.source) { return (Resolve-SourceKey ([string]$Row.source)) }
    return (Resolve-SourceKey ((Split-ItemToken ([string]$Row.token)).source))
}

function Get-ItemNativeId {
    param($Row)
    if ($Row -and $Row.source_id) { return [string]$Row.source_id }
    $sp = Split-ItemToken ([string]$Row.token)
    return [string]$sp.id
}

function New-SourceContext {
    param($Config, [string]$Root)
    return [pscustomobject]@{
        proxy  = $(if ($Config) { [string]$Config.proxy } else { '' })
        qiseCookie = $(if ($Config) { [string]$Config.qiseCookie } else { '' })
        root   = $Root
        config = $Config
        ua     = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
    }
}

function Write-SourceProgress {
    param([string]$Path, [string]$Phase, [int]$Done, [int]$Total, [datetime]$Started)
    if (-not $Path) { return }
    try {
        $elapsed = ((Get-Date) - $Started).TotalSeconds
        $speed = if ($elapsed -gt 0) { [math]::Round($Done / $elapsed, 2) } else { 0 }
        $eta = if ($speed -gt 0 -and $Total -gt $Done) { [math]::Round(($Total - $Done) / $speed, 1) } else { 0 }
        $obj = [pscustomobject]@{
            phase = $Phase; done = $Done; total = $Total; elapsed = [math]::Round($elapsed, 1)
            speed = $speed; eta = $eta; at = (Get-Date -Format 'HH:mm:ss')
        }
        $dir = Split-Path $Path -Parent
        if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $obj | ConvertTo-Json -Compress | Set-Content -LiteralPath $Path -Encoding UTF8
    } catch { }
}

function Invoke-SourceScrape {
    param([string]$Key, $Context, $Options)
    $s = Get-SourceInfo $Key
    if (-not $s) { throw "未知源: $Key" }
    if ($s.capabilities -notcontains 'scrape') { throw "源 $Key 不支持抓取" }
    return @(& "Invoke-$($s.pascal)Scrape" -Context $Context -Options $Options)
}

function Get-SourceDetail {
    param([string]$Key, $Context, [string]$Id)
    $s = Get-SourceInfo $Key
    if (-not $s) { throw "未知源: $Key" }
    if ($s.capabilities -notcontains 'detail') { return $null }
    return (& "Get-$($s.pascal)Detail" -Context $Context -Id $Id)
}

function Get-SourceCoverUrl {
    param([string]$Key, $Context, $Row)
    $s = Get-SourceInfo $Key
    if (-not $s -or $s.capabilities -notcontains 'cover') { return '' }
    return (& "Get-$($s.pascal)CoverUrl" -Context $Context -Row $Row)
}

function Resolve-SourceDownload {
    param([string]$Key, $Context, $Row)
    $s = Get-SourceInfo $Key
    if (-not $s) { return @{ url = [string]$Row.url; mode = 'http'; headers = @{} } }
    if ($s.capabilities -notcontains 'download') {
        return @{ url = [string]$Row.url; mode = 'http'; headers = @{} }
    }
    return (& "Resolve-$($s.pascal)Download" -Context $Context -Row $Row)
}
