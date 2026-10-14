# Resizes freshly generated raw quote cards to exactly 1080x1080 (HighQualityBicubic).
# Edit $map when generating a new batch: id = raw filename in .chatgpt-webui-mcp\images.
Add-Type -AssemblyName System.Drawing

$map = @{
  59 = "chatgpt-image-1791987088283-1.png"
  60 = "chatgpt-image-1791987182215-1.png"
  61 = "chatgpt-image-1791987273066-1.png"
  62 = "chatgpt-image-1791987455257-1.png"
  63 = "chatgpt-image-1791987837261-1.png"
  64 = "chatgpt-image-1791988037330-1.png"
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
