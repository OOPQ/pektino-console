#Requires -Version 5.1
<#
  接口健壮性探测（只读为主 + 少量可控写操作）
  用法: powershell -File api-probe.ps1 -Base http://127.0.0.1:8791
#>
param([string]$Base = 'http://127.0.0.1:8791')

$ErrorActionPreference = 'Stop'
$results = New-Object System.Collections.ArrayList

function Invoke-Probe {
    param([string]$Name, [string]$Method = 'GET', [string]$Path = '/', $Body = $null, [string]$RawBody = $null, [string]$ContentType = 'application/json; charset=utf-8')
    $url = $Base.TrimEnd('/') + $Path
    $status = 0; $text = ''; $err = ''
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = $Method
        $req.Timeout = 20000
        $req.ReadWriteTimeout = 20000
        if ($Method -ne 'GET' -and $Method -ne 'HEAD') {
            $bytes = if (-not [string]::IsNullOrEmpty($RawBody)) { [Text.Encoding]::UTF8.GetBytes([string]$RawBody) }
                     elseif ($null -ne $Body) { [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 5)) }
                     else { [byte[]]@() }
            $req.ContentType = $ContentType
            $req.ContentLength = $bytes.Length
            if ($bytes.Length -gt 0) {
                $st = $req.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
            }
        }
        $resp = $req.GetResponse()
        $status = [int]$resp.StatusCode
        $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
        $text = $sr.ReadToEnd(); $sr.Close(); $resp.Close()
    } catch [System.Net.WebException] {
        $we = $_.Exception
        if ($we.Response) {
            $status = [int]$we.Response.StatusCode
            try {
                $sr = New-Object IO.StreamReader($we.Response.GetResponseStream(), [Text.Encoding]::UTF8)
                $text = $sr.ReadToEnd(); $sr.Close()
            } catch { }
        } else { $err = $we.Message }
    } catch { $err = $_.Exception.Message }

    $short = $text
    if ($short.Length -gt 160) { $short = $short.Substring(0, 160) + '…' }
    $line = '{0,-46} {1,-5} {2,-4} {3}' -f $Name, $Method, $status, ($(if ($err) { "ERR $err" } else { $short }))
    [void]$results.Add([pscustomobject]@{ name = $Name; status = $status; body = $short; err = $err })
    Write-Host $line
}

Write-Host '=== 路由 / 方法 ==='
Invoke-Probe '未知路由' GET '/api/definitely-not-a-route'
Invoke-Probe '静态目录穿越 1' GET '/static/../console.ps1'
Invoke-Probe '静态目录穿越 2' GET '/static/js/../../console.ps1'
Invoke-Probe '静态目录穿越 3' GET '/static/%2e%2e/console.ps1'
Invoke-Probe '根路径' GET '/'
Invoke-Probe '不存在的静态文件' GET '/static/nope.js'
Invoke-Probe 'PUT 不支持' PUT '/api/state'
Invoke-Probe 'HEAD 请求' HEAD '/'

Write-Host ''
Write-Host '=== 非法参数 ==='
Invoke-Probe '非法 JSON' POST '/api/mark' -RawBody '{not json'
Invoke-Probe '空对象 mark' POST '/api/mark' -Body @{}
Invoke-Probe '未知 token mark' POST '/api/mark' -Body @{ tokens = @('__not_exist__'); status = 'done' }
Invoke-Probe '非法状态 mark' POST '/api/mark' -Body @{ tokens = @('__not_exist__'); status = 'bogus' }
Invoke-Probe '未知 token rate' POST '/api/rate' -Body @{ token = '__not_exist__'; rating = 3 }
Invoke-Probe '非法评分' POST '/api/rate' -Body @{ token = '__not_exist__'; rating = 99 }
Invoke-Probe '未知 token 删除' POST '/api/delete' -Body @{ token = '__not_exist__' }
Invoke-Probe '播放穿越' POST '/api/play' -Body @{ token = '../../Windows/System32/cmd' }
Invoke-Probe '播放未知 token' POST '/api/play' -Body @{ token = '__not_exist__' }
Invoke-Probe '空下载请求' POST '/api/download' -Body @{ tokens = @() }
Invoke-Probe '下载状态参数 bogus' POST '/api/download' -Body @{ status = 'bogus' }
Invoke-Probe '取消不存在的任务' POST '/api/download/cancel' -Body @{}
Invoke-Probe '抓取页数非法' POST '/api/scrape' -Body @{ pages = -5 }
Invoke-Probe '抓取页数超大' POST '/api/scrape' -Body @{ pages = 99999 }
Invoke-Probe '配置坏类型' POST '/api/config' -Body @{ concurrent = 'abc' }

Write-Host ''
Write-Host '=== 大请求体（1MB 无效 JSON）==='
$big = 'x' * (1024 * 1024)
Invoke-Probe '1MB 非法 JSON' POST '/api/mark' -RawBody $big

Write-Host ''
Write-Host "=== 汇总：$($results.Count) 项，状态码分布 ==="
$results | Group-Object status | Sort-Object Name | ForEach-Object { "  {0} → {1} 项" -f $_.Name, $_.Count }
