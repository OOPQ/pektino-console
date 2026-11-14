#Requires -Version 5.1
<#
  本地媒体服务（浏览器内播放用）

  为什么不放在 console.ps1 里：主控制台是单线程循环，往浏览器灌一个几百 MB 的
  视频会把 SSE 和所有接口一起卡住。这里单独起一个进程，只服务媒体目录里的 mp4：
    - 只监听 127.0.0.1
    - 只认 <token>.mp4（token 白名单 + 目录前缀校验，防路径穿越）
    - 支持 HTTP Range（206 / Content-Range），浏览器才能拖动进度条
    - 单次响应最多 MaxChunkMB（默认 8MB），发完就关连接，避免一个长连接占住服务
    - 父进程（控制台）退出后自动结束
#>
param(
    [Parameter(Mandatory = $true)][string]$MediaDir,
    [Parameter(Mandatory = $true)][int]$Port,
    [string]$Key = '',
    [int]$ParentPid = 0,
    [string]$LogFile = '',
    [int]$MaxChunkMB = 8,
    [int]$IdleMinutes = 30
)

$ErrorActionPreference = 'Stop'
$mediaFull = [System.IO.Path]::GetFullPath($MediaDir).TrimEnd('\')
$chunkCap = [int64]$MaxChunkMB * 1MB
$startedAt = Get-Date

function Write-MLog([string]$msg) {
    if (-not $LogFile) { return }
    try {
        Add-Content -Path $LogFile -Value ("[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg) -Encoding UTF8
    } catch { }
}

function Send-Text($stream, [string]$text) {
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($text)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Read-RequestText($stream) {
    <#  读到空行为止；限 8KB / 5 秒，避免半开连接把服务拖住  #>
    $buf = New-Object byte[] 4096
    $sb = New-Object System.Text.StringBuilder
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline) {
        if ($stream.DataAvailable) {
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buf, 0, $n))
            $s = $sb.ToString()
            if ($s.Contains("`r`n`r`n")) { break }
            if ($s.Length -gt 8192) { break }
        } else {
            Start-Sleep -Milliseconds 10
        }
    }
    return $sb.ToString()
}

function Test-SafeMediaName([string]$name) {
    <#  允许中文文件名，但挡掉路径分隔符和 ..  #>
    if (-not $name) { return $false }
    if ($name -notmatch '\.mp4$') { return $false }
    if ($name.Length -gt 180) { return $false }
    if ($name -match '[\\/:*?"<>|]') { return $false }
    if ($name -match '\.\.') { return $false }
    return $true
}

function Send-Simple($stream, [int]$code, [string]$reason, [string]$body) {    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    $head = "HTTP/1.1 $code $reason`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nCache-Control: no-store`r`n`r`n"
    Send-Text $stream $head
    try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() } catch { }
}

$listener = $null
for ($i = 0; $i -lt 20; $i++) {
    try {
        $candidate = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, ($Port + $i))
        $candidate.Start()
        $listener = $candidate
        $Port = $Port + $i
        break
    } catch { try { $candidate.Stop() } catch { } }
}
if (-not $listener) { Write-MLog 'listen failed'; exit 1 }

Write-MLog "media server on 127.0.0.1:$Port dir=$mediaFull"
$lastHit = Get-Date

try {
    while ($true) {
        if ($ParentPid -gt 0 -and -not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { break }
        if (((Get-Date) - $lastHit).TotalMinutes -ge $IdleMinutes) { break }
        $ready = $false
        try { $ready = $listener.Server.Poll(500000, [System.Net.Sockets.SelectMode]::SelectRead) } catch { Start-Sleep -Milliseconds 100 }
        if (-not $ready) { continue }

        $client = $null
        try {
            $client = $listener.AcceptTcpClient()
            $client.ReceiveTimeout = 8000
            try { $client.Client.SendTimeout = 20000 } catch { }
            $stream = $client.GetStream()
            $raw = Read-RequestText $stream
            if (-not $raw) { continue }
            $lastHit = Get-Date

            $lines = $raw -split "`r`n"
            $first = $lines[0] -split ' '
            if ($first.Count -lt 2) { Send-Simple $stream 400 'Bad Request' 'bad request'; continue }
            $method = $first[0].ToUpperInvariant()
            $target = $first[1]

            $headers = @{}
            for ($li = 1; $li -lt $lines.Count; $li++) {
                if ($lines[$li] -match '^([^:]+):\s*(.*)$') { $headers[$Matches[1].ToLowerInvariant()] = $Matches[2].Trim() }
            }

            $qIndex = $target.IndexOf('?')
            $pathPart = if ($qIndex -ge 0) { $target.Substring(0, $qIndex) } else { $target }
            $queryPart = if ($qIndex -ge 0) { $target.Substring($qIndex + 1) } else { '' }
            $query = @{}
            foreach ($kv in $queryPart.Split('&')) {
                if (-not $kv) { continue }
                $eq = $kv.IndexOf('=')
                if ($eq -lt 0) { $query[$kv] = '' } else { $query[$kv.Substring(0, $eq)] = [uri]::UnescapeDataString($kv.Substring($eq + 1)) }
            }

            if ($method -ne 'GET' -and $method -ne 'HEAD') { Send-Simple $stream 405 'Method Not Allowed' 'method not allowed'; continue }
            if ($Key -and [string]$query['k'] -ne $Key) { Send-Simple $stream 403 'Forbidden' 'forbidden'; continue }

            $name = [uri]::UnescapeDataString($pathPart.TrimStart('/'))
            if (-not (Test-SafeMediaName $name)) { Send-Simple $stream 404 'Not Found' 'not found'; continue }
            $full = [System.IO.Path]::GetFullPath((Join-Path $mediaFull $name))
            if ($full -notlike ($mediaFull + '\*')) { Send-Simple $stream 403 'Forbidden' 'forbidden'; continue }
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { Send-Simple $stream 404 'Not Found' 'not found'; continue }

            $total = (Get-Item -LiteralPath $full).Length
            if ($total -le 0) { Send-Simple $stream 404 'Not Found' 'empty'; continue }

            $rangeHeader = [string]$headers['range']
            $start = [int64]0
            $end = [int64]($total - 1)
            $partial = $false
            if ($rangeHeader -match 'bytes\s*=\s*(\d*)\s*-\s*(\d*)') {
                $partial = $true
                $a = $Matches[1]
                $b = $Matches[2]
                if ($a -eq '' -and $b -ne '') {
                    $suffix = [int64]$b
                    if ($suffix -le 0) { $suffix = 1 }
                    if ($suffix -gt $total) { $suffix = $total }
                    $start = $total - $suffix
                    $end = $total - 1
                } else {
                    $start = if ($a -ne '') { [int64]$a } else { 0 }
                    $end = if ($b -ne '') { [int64]$b } else { $total - 1 }
                }
                if ($start -lt 0) { $start = 0 }
                if ($start -ge $total) {
                    Send-Text $stream "HTTP/1.1 416 Range Not Satisfiable`r`nContent-Range: bytes */$total`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
                    continue
                }
                if ($end -ge $total) { $end = $total - 1 }
                if ($end -lt $start) { $end = $total - 1 }
                # 单次响应限流：浏览器会自己接着要下一段，这样拖动不被长连接堵住
                if (($end - $start + 1) -gt $chunkCap) { $end = $start + $chunkCap - 1 }
            }

            $length = $end - $start + 1
            $status = if ($partial) { '206 Partial Content' } else { '200 OK' }
            $head = "HTTP/1.1 $status`r`nContent-Type: video/mp4`r`nAccept-Ranges: bytes`r`nContent-Length: $length`r`n"
            if ($partial) { $head += "Content-Range: bytes $start-$end/$total`r`n" }
            $head += "Cache-Control: no-store`r`nConnection: close`r`n`r`n"
            Send-Text $stream $head

            if ($method -ne 'HEAD') {
                $fs = [System.IO.File]::Open($full, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                try {
                    [void]$fs.Seek($start, [System.IO.SeekOrigin]::Begin)
                    $buf = New-Object byte[] 65536
                    $remain = $length
                    while ($remain -gt 0) {
                        $want = [Math]::Min([int64]$buf.Length, $remain)
                        $read = $fs.Read($buf, 0, [int]$want)
                        if ($read -le 0) { break }
                        $stream.Write($buf, 0, $read)
                        $remain -= $read
                    }
                    $stream.Flush()
                } finally { $fs.Dispose() }
            }
        } catch {
            Write-MLog "request error: $($_.Exception.Message)"
        } finally {
            if ($client) { try { $client.Close() } catch { } }
        }
    }
} finally {
    try { $listener.Stop() } catch { }
    Write-MLog "media server stopped (port $Port, uptime $([math]::Round(((Get-Date) - $startedAt).TotalMinutes,1)) min)"
}
