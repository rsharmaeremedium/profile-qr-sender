# Generates the PWA PNG icons with a simple QR-style mark.
# Run from the qr-pwa folder:  powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-RoundedPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  if ($r -le 0) {
    $p.AddRectangle((New-Object System.Drawing.RectangleF($x, $y, $w, $h)))
    return $p
  }
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Draw-Icon([int]$size, [string]$path, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)

  $accent = [System.Drawing.Color]::FromArgb(79, 70, 229)
  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $radius = [float]($size * 0.22)
  if ($maskable) { $radius = 0 }
  $bg = New-RoundedPath 0 0 $size $size $radius
  $brush = New-Object System.Drawing.SolidBrush($accent)
  $g.FillPath($brush, $bg)

  # Scale the mark. Maskable icons need extra padding for the safe zone.
  $pad = if ($maskable) { $size * 0.18 } else { $size * 0.14 }
  $inner = $size - ($pad * 2)
  $unit = $inner / 21.0
  $ox = $pad
  $oy = $pad

  function Fill-Module([int]$col, [int]$row, [int]$w = 1, [int]$h = 1) {
    $g.FillRectangle($whiteBrush, [float]($ox + $col * $unit), [float]($oy + $row * $unit),
      [float]($w * $unit), [float]($h * $unit))
  }

  function Draw-Finder([int]$col, [int]$row) {
    Fill-Module $col $row 7 7
    $g.FillRectangle($brush, [float]($ox + ($col + 1) * $unit), [float]($oy + ($row + 1) * $unit),
      [float](5 * $unit), [float](5 * $unit))
    Fill-Module ($col + 2) ($row + 2) 3 3
  }

  Draw-Finder 0 0
  Draw-Finder 14 0
  Draw-Finder 0 14

  # A few modules to suggest data.
  foreach ($m in @(
    @(10, 2), @(12, 2), @(9, 4), @(11, 5), @(13, 4),
    @(2, 10), @(4, 11), @(2, 13), @(5, 9), @(6, 12),
    @(10, 10), @(12, 10), @(10, 12), @(14, 12), @(16, 10),
    @(9, 16), @(11, 14), @(13, 16), @(16, 14), @(18, 16),
    @(16, 18), @(18, 18), @(14, 19), @(10, 18), @(6, 17)
  )) {
    Fill-Module $m[0] $m[1] 1 1
  }

  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $brush.Dispose()
  $bmp.Dispose()
}

Draw-Icon 192 (Join-Path $outDir "icon-192.png") $false
Draw-Icon 512 (Join-Path $outDir "icon-512.png") $false
Draw-Icon 512 (Join-Path $outDir "maskable-512.png") $true
Draw-Icon 180 (Join-Path $outDir "apple-touch-icon.png") $false
Draw-Icon 32  (Join-Path $outDir "favicon-32.png") $false

Write-Host "Icons written to $outDir"
