# Resizes a raw ChatGPT image to exactly 1080x1080 into cards/1080.
param(
  [Parameter(Mandatory = $true)][string]$Src,
  [Parameter(Mandatory = $true)][int]$Id
)

Add-Type -AssemblyName System.Drawing

$dst = "E:\Desktop\YT\telegram-daily-quote\cards\1080\quote-$Id.png"
New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null

$img = [System.Drawing.Image]::FromFile($Src)
$bmp = New-Object System.Drawing.Bitmap(1080, 1080)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.DrawImage($img, 0, 0, 1080, 1080)
$g.Dispose()
$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
$img.Dispose()
Write-Output ("resized -> " + $dst + " (" + [math]::Round((Get-Item $dst).Length / 1024) + " KB)")
