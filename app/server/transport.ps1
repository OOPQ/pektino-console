#Requires -Version 5.1
# HTTP transport: responses, request parsing, SSE push

# ---------- HTTP ----------
function Send-Bytes {
    param($Stream, [byte[]]$Bytes, [string]$ContentType = 'application/json; charset=utf-8', [string]$Status = '200 OK', [hashtable]$ExtraHeaders)
    $h = [ordered]@{
        'Content-Type'   = $ContentType
        'Content-Length' = $Bytes.Length
        'Cache-Control'  = 'no-store'
        'Connection'     = 'close'
    }
    if ($ExtraHeaders) { foreach ($k in $ExtraHeaders.Keys) { $h[$k] = $ExtraHeaders[$k] } }
    $head = "HTTP/1.1 $Status`r`n"
    foreach ($k in $h.Keys) { $head += "$k`: $($h[$k])`r`n" }
    $head += "`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($head)
    try {
        $Stream.Write($hb, 0, $hb.Length)
        if ($Bytes.Length -gt 0) { $Stream.Write($Bytes, 0, $Bytes.Length) }
        $Stream.Flush()
    } catch {
        # 浏览器提前断开（刷新/关标签/超时）时不要冒泡到主循环
    }
}

function Send-Json {
    param($Stream, $Object, [string]$Status = '200 OK')
    $json = $Object | ConvertTo-Json -Depth 8 -Compress
    Send-Bytes -Stream $Stream -Bytes ([Text.Encoding]::UTF8.GetBytes($json)) -Status $Status
}

function Read-Request {
    <#
      按字节读：先读到 \r\n\r\n 拿到头，再按 Content-Length 读 body，
      最后用 UTF-8 解码 body（中文/emoji 都不会被截断或变成 ?）。
    #>
    param($Stream)

    $ms = New-Object System.IO.MemoryStream
    $buf = New-Object byte[] 4096
    $headEnd = -1
    $headText = ''

    while ($headEnd -lt 0) {
        $n = $Stream.Read($buf, 0, $buf.Length)
        if ($n -le 0) { return $null }
        $ms.Write($buf, 0, $n)
        $arr = $ms.ToArray()
        $headText = [Text.Encoding]::ASCII.GetString($arr)
        $headEnd = $headText.IndexOf("`r`n`r`n")
        if ($ms.Length -gt 65536) { break }
    }
    if ($headEnd -lt 0) { return $null }

    $all = $ms.ToArray()
    $lines = $headText.Substring(0, $headEnd) -split "`r`n"
    if (-not $lines -or -not $lines[0]) { return $null }

    $parts = $lines[0] -split ' '
    if ($parts.Count -lt 2) { return $null }
    $req = @{ Method = $parts[0]; Path = $parts[1]; Query = @{}; Headers = @{}; Body = '' }
    if ($req.Path -match '\?(.*)$') {
        $req.Path = $req.Path -replace '\?.*$', ''
        foreach ($kv in ($Matches[1] -split '&')) {
            if ($kv -match '^([^=]+)=(.*)$') { $req.Query[[uri]::UnescapeDataString($Matches[1])] = [uri]::UnescapeDataString($Matches[2]) }
        }
    }
    for ($i = 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^([^:]+):\s*(.*)$') { $req.Headers[$Matches[1].ToLower()] = $Matches[2] }
    }

    $len = 0
    if ($req.Headers['content-length']) {
        # 头可能是伪造/非数字，解析失败就当没有 body（否则整个请求会抛异常掉线）
        try { $len = [int]$req.Headers['content-length'] } catch { $len = 0 }
        if ($len -lt 0) { $len = 0 }
    }
    if ($len -gt 0 -and $len -lt 2000000) {
        $bodyStart = $headEnd + 4
        $have = [Math]::Max(0, $all.Length - $bodyStart)
        $body = New-Object byte[] $len
        $copied = [Math]::Min($have, $len)
        if ($copied -gt 0) { [Array]::Copy($all, $bodyStart, $body, 0, $copied) }
        while ($copied -lt $len) {
            $n = $Stream.Read($body, $copied, $len - $copied)
            if ($n -le 0) { break }
            $copied += $n
        }
        if ($copied -gt 0) { $req.Body = [Text.Encoding]::UTF8.GetString($body, 0, $copied) }
    }
    return $req
}

function Push-Sse {
    if ($script:SseClients.Count -eq 0) { return }
    $now = Get-Date
    foreach ($c in @($script:SseClients)) {
        try {
            if ($c.Rev -ne $State.Rev) {
                $msg = "event: state`ndata: {`"rev`":$($State.Rev)}`n`n"
                $b = [Text.Encoding]::UTF8.GetBytes($msg)
                $c.Stream.Write($b, 0, $b.Length)
                $c.Stream.Flush()
                $c.Rev = $State.Rev
                $c.Beat = $now
            } elseif (($now - $c.Beat).TotalSeconds -ge 15) {
                $b = [Text.Encoding]::UTF8.GetBytes(": ping`n`n")
                $c.Stream.Write($b, 0, $b.Length)
                $c.Stream.Flush()
                $c.Beat = $now
            }
        } catch {
            try { $c.Stream.Close() } catch { }
            try { $c.Socket.Close() } catch { }
            [void]$script:SseClients.Remove($c)
        }
    }
}
