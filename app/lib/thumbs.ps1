#Requires -Version 5.1
<#
.SYNOPSIS
  封面缩略图：把 covers\ 里的原图（平均 79KB）缩成 120px 宽的小图（约 6~8KB）。

.DESCRIPTION
  列表页一屏 50 张封面，原图约 4MB，缩略图不到 400KB。
  用 System.Drawing（Windows 自带），无第三方依赖。

.EXAMPLE
  . .\thumbs.ps1
  Update-Thumbs -CoverDir out\covers -ThumbDir out\thumbs
#>

Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue

function New-Thumb {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Dest,
        [int]$Width = 120,
        [int]$Quality = 80
    )
    if (-not (Test-Path $Source)) { return $false }
    $dir = Split-Path $Dest -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    $img = $null; $bmp = $null; $g = $null
    try {
        $img = [System.Drawing.Image]::FromFile($Source)
        if ($img.Width -le 0 -or $img.Height -le 0) { return $false }
        $w = [Math]::Min($Width, $img.Width)
        $h = [int][Math]::Max(1, [Math]::Round($img.Height * ($w / $img.Width)))

        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($img, 0, 0, $w, $h)

        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $ps = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
        $bmp.Save($Dest, $codec, $ps)
        return $true
    } catch {
        return $false
    } finally {
        if ($g) { $g.Dispose() }
        if ($bmp) { $bmp.Dispose() }
        if ($img) { $img.Dispose() }
    }
}

function Update-Thumbs {
    param(
        [Parameter(Mandatory = $true)][string]$CoverDir,
        [Parameter(Mandatory = $true)][string]$ThumbDir,
        [int]$Width = 120,
        [int]$Quality = 80,
        [switch]$Force
    )
    $made = 0; $skip = 0; $fail = 0
    if (-not (Test-Path $CoverDir)) { return [pscustomobject]@{ made = 0; skip = 0; fail = 0 } }
    if (-not (Test-Path $ThumbDir)) { New-Item -ItemType Directory -Path $ThumbDir -Force | Out-Null }

    foreach ($f in @(Get-ChildItem -Path $CoverDir -Filter *.jpg -File)) {
        $dest = Join-Path $ThumbDir $f.Name
        if (-not $Force -and (Test-Path $dest) -and ((Get-Item $dest).LastWriteTime -ge $f.LastWriteTime)) { $skip++; continue }
        if (New-Thumb -Source $f.FullName -Dest $dest -Width $Width -Quality $Quality) { $made++ } else { $fail++ }
    }
    return [pscustomobject]@{ made = $made; skip = $skip; fail = $fail }
}
