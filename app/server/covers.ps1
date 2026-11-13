# ---------------- 封面修复 ----------------

try { Add-Type -AssemblyName System.Net.Http -ErrorAction Stop } catch { }

# 从本地视频取一帧当封面：走 Windows Shell 的缩略图提供程序（和资源管理器一致），
# 不依赖 ffmpeg，也不需要联网。
try {
    if (-not ('ShellThumb' -as [type])) {
        Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class ShellThumb {
    [StructLayout(LayoutKind.Sequential)]
    public struct SIZE { public int cx; public int cy; public SIZE(int x, int y) { cx = x; cy = y; } }

    [Flags]
    public enum SIIGBF {
        RESIZETOFIT = 0x00, BIGGERSIZEOK = 0x01, MEMORYONLY = 0x02, ICONONLY = 0x04,
        THUMBNAILONLY = 0x08, INCACHEONLY = 0x10, CROPTOSQUARE = 0x20,
        WIDETHUMBNAILS = 0x40, ICONBACKGROUND = 0x80, SCALEUP = 0x100
    }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory {
        [PreserveSig] int GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object shellItem);

    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr hObject);

    public static bool Save(string path, string outPath, int width, int height) {
        object item;
        Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
        SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out item);
        var factory = (IShellItemImageFactory)item;
        IntPtr hbm;
        int hr = factory.GetImage(new SIZE(width, height), SIIGBF.THUMBNAILONLY | SIIGBF.BIGGERSIZEOK | SIIGBF.RESIZETOFIT, out hbm);
        if (hr != 0 || hbm == IntPtr.Zero) return false;
        try {
            using (var bmp = Image.FromHbitmap(hbm)) { bmp.Save(outPath, ImageFormat.Jpeg); }
        } finally { DeleteObject(hbm); }
        return true;
    }
}
'@
    }
} catch { }

function Test-SafeTokenName {
    <#  封面/缩略图文件名直接用 token：允许中文，但必须挡掉路径分隔符和 ..  #>
    param([string]$Token)
    if (-not $Token) { return $false }
    if ($Token.Length -gt 180) { return $false }
    if ($Token -match '[\\/:*?"<>|]') { return $false }
    if ($Token -match '\.\.') { return $false }
    if ($Token.Trim() -ne $Token) { return $false }
    return $true
}

function New-LocalCover {
    <#  本地有视频、但没有封面 → 用视频帧生成 cache\covers\<token>.jpg
        返回是否成功；失败不抛异常（比如文件被占用）  #>
    param([string]$Video, [string]$Dest)
    try {
        if (-not ('ShellThumb' -as [type])) { return $false }
        if (-not (Test-Path -LiteralPath $Video)) { return $false }
        $dir = Split-Path -Parent $Dest
        if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        if ([ShellThumb]::Save($Video, $Dest, 400, 600)) {
            if ((Get-Item -LiteralPath $Dest).Length -gt 1024) { return $true }
            Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
        }
    } catch { }
    return $false
}


function Get-CoverMissingList {
    <#  返回缺封面 / 封面损坏的 token 列表（跳过已标记 .missing 的）  #>
    param([int]$Limit = 0)
    $out = New-Object System.Collections.ArrayList
    foreach ($r in @($State.Ledger)) {
        $tk = [string]$r.token
        if (-not $tk) { continue }
        # 非 token 命名的本地文件（例如中文片名）不参与封面抓取
        if ($tk -notmatch '^[A-Za-z0-9_\-]+$') { continue }
        # 没有 url 的条目（本地导入/无来源）没有详情页可抓，跳过
        if (-not $r.url) { continue }
        if (Test-Path (Join-Path $CoverDir ($tk + '.missing'))) { continue }
        $f = Join-Path $CoverDir ($tk + '.jpg')
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 1024)) { continue }
        [void]$out.Add($r)
        if ($Limit -gt 0 -and $out.Count -ge $Limit) { break }
    }
    return $out
}

function Get-CoverMissingCount {
    return (Get-CoverMissingList).Count
}

function Get-LocalCoverMissingCount {
    <#  本地已有视频、但 cache\covers 里没有可用封面的条目数（自动补封面的触发条件之一）  #>
    $n = 0
    foreach ($r in @($State.Ledger)) {
        if (-not $r.file_name) { continue }
        $tk = [string]$r.token
        if (-not (Test-SafeTokenName $tk)) { continue }
        $f = Join-Path $CoverDir ($tk + '.jpg')
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 1024)) { continue }
        $n++
    }
    return $n
}

function Repair-Covers {
    <#
      补齐缺失/损坏的封面：重新取详情页的 JSON-LD thumbnailUrl，再下载图片。
      - 并发 8，限流 Limit 条，默认 40
      - 拿不到封面地址或图片 404 时写 <token>.missing 标记，避免反复重试
      - 修完顺带补缩略图
    #>
    param([int]$Limit = 40)

    if (-not (Test-Path $CoverDir)) { New-Item -ItemType Directory -Path $CoverDir -Force | Out-Null }

    # 先处理「本地有视频、没有封面」：直接抽视频帧，不联网、也不消耗抓取配额
    $localFixed = 0
    $localTried = 0
    foreach ($r in @($State.Ledger)) {
        if ($localTried -ge 60) { break }
        $tk = [string]$r.token
        if (-not (Test-SafeTokenName $tk)) { continue }
        if (-not $r.file_name) { continue }
        $dest = Join-Path $CoverDir ($tk + '.jpg')
        if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1024)) { continue }
        $file = Resolve-RowFile $r
        if (-not $file -or -not (Test-Path -LiteralPath $file)) { continue }
        $localTried++
        if (New-LocalCover -Video $file -Dest $dest) { $localFixed++ }
    }

    $candidates = Get-CoverMissingList -Limit $Limit
    if (-not $candidates.Count) {
        if ($localFixed -gt 0) {
            try { [void](Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir) } catch { }
            Touch-State
            Write-Log 'cover' "封面修复：用视频帧补 $localFixed 张（本地文件）"
        }
        return [pscustomobject]@{ ok = $true; fixed = $localFixed; local = $localFixed; failed = 0; missing = 0; scanned = $localTried }
    }

    $handler = New-Object System.Net.Http.HttpClientHandler
    $handler.MaxConnectionsPerServer = 8
    $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($Config.proxy) {
        $handler.Proxy = New-Object System.Net.WebProxy([string]$Config.proxy)
        $handler.UseProxy = $true
    }
    $client = New-Object System.Net.Http.HttpClient($handler)
    $client.Timeout = [TimeSpan]::FromSeconds(25)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')

    $fixed = 0; $failed = 0; $dead = 0
    $Threads = 8

    try {
        for ($i = 0; $i -lt $candidates.Count; $i += $Threads) {
            $end = [Math]::Min($i + $Threads - 1, $candidates.Count - 1)
            $batch = @($candidates[$i..$end])
            $tasks = @{}
            foreach ($r in $batch) {
                $tk = [string]$r.token
                $url = if ($r.page_url) { [string]$r.page_url } else { "https://pektino.com/zh-CN/movie/$tk" }
                try {
                    $tasks[$tk] = @{ page = $client.GetStringAsync($url); token = $tk; dest = (Join-Path $CoverDir ($tk + '.jpg')) }
                } catch { $failed++ }
            }
            foreach ($tk in @($tasks.Keys)) {
                $t = $tasks[$tk]
                try {
                    $html = $t.page.GetAwaiter().GetResult()
                    $coverUrl = ''
                    foreach ($m in [regex]::Matches($html, '<script type="application/ld\+json">(.*?)</script>', 'Singleline')) {
                        try {
                            $ld = $m.Groups[1].Value | ConvertFrom-Json
                            if ($ld.'@type' -eq 'VideoObject' -and $ld.thumbnailUrl) { $coverUrl = [string]$ld.thumbnailUrl; break }
                        } catch { }
                    }
                    if (-not $coverUrl) {
                        # 详情页里没有封面信息 —— 标记为无封面，别再重试
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                        continue
                    }
                    $bytes = $client.GetByteArrayAsync($coverUrl).GetAwaiter().GetResult()
                    if ($bytes.Length -gt 1024) {
                        [System.IO.File]::WriteAllBytes($t.dest, $bytes)
                        $fixed++
                    } else {
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                    }
                } catch {
                    $is404 = $false
                    try { $is404 = ($_.Exception.Message -match '404') } catch { }
                    if ($is404) {
                        Set-Content -Path (Join-Path $CoverDir ($tk + '.missing')) -Value '' -Encoding UTF8 -Force
                        $dead++
                    } else {
                        $failed++
                    }
                }
            }
        }
    } finally {
        $client.Dispose()
    }

    $fixedAll = $localFixed + $fixed
    if ($fixedAll -gt 0) {
        try { [void](Update-Thumbs -CoverDir $CoverDir -ThumbDir $ThumbDir) } catch { }
    }
    Touch-State
    $left = (Get-CoverMissingList).Count
    Write-Log 'cover' "封面修复：补 $fixedAll 张（其中视频帧 $localFixed），失败 $failed，确认无封面 $dead，仍缺 $left"
    return [pscustomobject]@{ ok = $true; fixed = $fixedAll; local = $localFixed; failed = $failed; missing = $left; scanned = ($localTried + $candidates.Count) }
}

function Step-Covers {
    <#  主循环里低频调用：空闲且缺封面时自动补一批（10 分钟最多一次）  #>
    if ($State.Job -and $State.Job.handle -and $State.Job.handle.State -eq 'Running') { return }
    if ($State.Download) { return }
    if (-not $State.Scan) { return }
    $missing = [int]$State.Scan.coverMissing
    if ($missing -le 0) { return }
    if ($State.CoverRepairAt -and ((Get-Date) - [datetime]$State.CoverRepairAt).TotalMinutes -lt 10) { return }
    $State.CoverRepairAt = (Get-Date).ToString('s')
    try { [void](Repair-Covers -Limit 15) } catch { }
}
