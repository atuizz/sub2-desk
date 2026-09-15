# Downsample a real >=4K local source. No upscaling, AI generation, or source replacement.
# Example: pwsh -File scripts/prepare-wallpaper-4k.ps1 -Source packages/sub2-console/public/assets/galaxy.jpg -Destination output/wallpapers/galaxy-4k.jpg
param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$Destination,
  [ValidateRange(85,100)][int]$Quality = 94
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$destinationPath = [System.IO.Path]::GetFullPath($Destination)
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputPrefix = (Join-Path $workspacePath 'output') + [System.IO.Path]::DirectorySeparatorChar
if (!$destinationPath.StartsWith($outputPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be inside this workspace output directory.' }
if ([System.IO.Path]::GetExtension($destinationPath) -ne '.jpg') { throw 'Destination must have .jpg extension.' }
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination exists; choose a new filename. No files are overwritten.' }
$sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash
$sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
$bitmap = $null; $graphics = $null; $parameters = $null; $attributes = $null
try {
  if ($sourceImage.Width -lt 3840 -or $sourceImage.Height -lt 2160) { throw "Source is only $($sourceImage.Width)x$($sourceImage.Height). Upscaling cannot create original detail; rejected." }
  # Current sources have no EXIF rotation; fail rather than silently rotate/crop incorrectly.
  if ($sourceImage.PropertyIdList -contains 274) {
    $orientation = [BitConverter]::ToUInt16($sourceImage.GetPropertyItem(274).Value, 0)
    if ($orientation -ne 1) { throw 'Normalize EXIF orientation before processing this source.' }
  }
  $scale = [Math]::Max(3840 / $sourceImage.Width, 2160 / $sourceImage.Height)
  $cropWidth = 3840 / $scale; $cropHeight = 2160 / $scale
  $cropX = ($sourceImage.Width - $cropWidth) / 2; $cropY = ($sourceImage.Height - $cropHeight) / 2
  $bitmap = [System.Drawing.Bitmap]::new(3840,2160,[System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $attributes = [System.Drawing.Imaging.ImageAttributes]::new()
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0,0,3840,2160), [single]$cropX, [single]$cropY, [single]$cropWidth, [single]$cropHeight, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
  $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
  $parameters = [System.Drawing.Imaging.EncoderParameters]::new(1)
  $parameters.Param[0] = [System.Drawing.Imaging.EncoderParameter]::new([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($destinationPath)) | Out-Null
  $bitmap.Save($destinationPath, $encoder, $parameters)
  $manifest = [ordered]@{
    source=$sourcePath; sourceSha256=$sourceHash; sourceWidth=$sourceImage.Width; sourceHeight=$sourceImage.Height
    destination=$destinationPath; width=3840; height=2160; method='local high-quality bicubic downsample and centered cover crop; not AI-generated'
    scale=$scale; crop=@($cropX,$cropY,$cropWidth,$cropHeight); quality=$Quality
    sha256=(Get-FileHash -LiteralPath $destinationPath -Algorithm SHA256).Hash
  }
  $manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath ($destinationPath + '.json') -Encoding utf8
  $manifest | ConvertTo-Json -Depth 3
} finally {
  if ($attributes) { $attributes.Dispose() }; if ($parameters) { $parameters.Dispose() }
  if ($graphics) { $graphics.Dispose() }; if ($bitmap) { $bitmap.Dispose() }; $sourceImage.Dispose()
}
if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne $sourceHash) { throw 'Source hash changed during processing.' }
