#Requires -Version 5.1
<#
  适配器模板（不会被加载：sources.json 里没有它）。

  复制为 sources\<key>.ps1，在 sources\sources.json 加一项，然后实现下面四个函数。
  函数名前缀 = key 的首字母大写，例如 key=hanime -> Invoke-HanimeScrape。
  返回值统一为规范化 item（见 docs\SOURCES.md）。
#>

function Invoke-TemplateScrape {
    param($Context, $Options)
    # $Options: rank, pages, limit, threads, pageSize, progressFile, started, knownTokens
    # 返回 item[]；source_id 用该站原生 id，不要自己拼 source 前缀。
    throw 'TODO: 实现列表 + 详情抓取'
}

function Get-TemplateDetail {
    param($Context, [string]$Id)
    # 返回单个 item；页面不存在/已下架返回 $null；网络错误返回 @{ error = '...' }
    throw 'TODO: 实现详情解析'
}

function Get-TemplateCoverUrl {
    param($Context, $Row)
    # 返回封面 URL；没有返回 ''
    return ''
}

function Resolve-TemplateDownload {
    param($Context, $Row)
    # 返回 @{ url; mode; headers }
    # mode 目前支持 'http'（curl/aria2 通用）
    # headers 用于 Referer/Cookie/User-Agent 等，会写入 download.ps1 的命令行
    return @{
        url     = [string]$Row.url
        mode    = 'http'
        headers = @{ Referer = [string]$Row.page_url }
    }
}
