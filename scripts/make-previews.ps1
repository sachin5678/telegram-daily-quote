# Creates small JPEG previews of the quote cards so they can be eyeballed
# without pulling multi-MB PNGs into the agent context.
param(
  [string]$Ids = "",
  [int]$Size = 560,
  [string]$OutDir = "C:\Users\Admin\AppData\Local\Temp\kilo\card-previews",
  [int]$Quality = 80,
  [string]$Prefix = ""
)

Add-Type -AssemblyName System.Drawing

$src = "E:\Desktop\YT\telegram-daily-quote\cards\1080"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, $Quality)

$files = if ($Ids) {
  $Ids.Split(",") | ForEach-Object { Join-Path $src ("quote-" + $_.Trim() + ".png") }
} else {
  Get-ChildItem $src -Filter "quote-*.png" | ForEach-Object { $_.FullName }
}

foreach ($f in $files) {
  if (-not (Test-Path $f)) { Write-Output ("MISSING " + $f); continue }
  $img = [System.Drawing.Image]::FromFile($f)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $Size, $Size)
  $g.Dispose()
  $out = Join-Path $OutDir ($Prefix + (Get-Item $f).BaseName + ".jpg")
  $bmp.Save($out, $codec, $ep)
  $bmp.Dispose()
  $img.Dispose()
  Write-Output ("preview " + $out + " " + [math]::Round((Get-Item $out).Length / 1024) + " KB")
}
