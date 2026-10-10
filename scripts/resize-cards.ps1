# Resizes freshly generated raw quote cards to exactly 1080x1080 (HighQualityBicubic).
# Edit $map when generating a new batch: id = raw filename in .chatgpt-webui-mcp\images.
Add-Type -AssemblyName System.Drawing

$map = @{
  53 = "chatgpt-image-1791611627294-1.png"
  54 = "chatgpt-image-1791611781159-1.png"
  55 = "chatgpt-image-1791611901592-1.png"
  56 = "chatgpt-image-1791612047786-1.png"
  57 = "chatgpt-image-1791613930041-1.png"
  58 = "chatgpt-image-1791614019647-1.png"
}

$src = "C:\Users\Admin\.chatgpt-webui-mcp\images"
$dst = "E:\Desktop\YT\telegram-daily-quote\cards\1080"

foreach ($k in ($map.Keys | Sort-Object)) {
  $srcFile = Join-Path $src $map[$k]
  if (-not (Test-Path $srcFile)) { Write-Output ("MISSING " + $srcFile); continue }
  $img = [System.Drawing.Image]::FromFile($srcFile)
  $bmp = New-Object System.Drawing.Bitmap(1080, 1080)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage($img, 0, 0, 1080, 1080)
  $g.Dispose()
  $out = Join-Path $dst ("quote-" + $k + ".png")
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $img.Dispose()
  Write-Output ("resized quote-" + $k + " -> " + $out)
}
$count = (Get-ChildItem (Join-Path $dst "quote-*.png")).Count
Write-Output ("total cards in folder: " + $count)
