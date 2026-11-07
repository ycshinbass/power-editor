# Deterministic 800x400 social share artwork. Run on Windows to regenerate.
Add-Type -AssemblyName System.Drawing
$bitmap=[System.Drawing.Bitmap]::new(800,400)
$graphic=[System.Drawing.Graphics]::FromImage($bitmap)
$graphic.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphic.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
function Color($hex){[System.Drawing.ColorTranslator]::FromHtml($hex)}
function Box($x,$y,$width,$height,$hex){$brush=[System.Drawing.SolidBrush]::new((Color $hex));$graphic.FillRectangle($brush,$x,$y,$width,$height);$brush.Dispose()}
function Text($value,$size,$x,$y,$hex,$bold=$false){
 $style=if($bold){[System.Drawing.FontStyle]::Bold}else{[System.Drawing.FontStyle]::Regular}
 $font=[System.Drawing.Font]::new('Malgun Gothic',$size,$style,[System.Drawing.GraphicsUnit]::Pixel)
 $brush=[System.Drawing.SolidBrush]::new((Color $hex));$graphic.DrawString($value,$font,$brush,[single]$x,[single]$y);$brush.Dispose();$font.Dispose()
}
$graphic.Clear((Color '#f1f3fa'))
Box 0 0 800 8 '#3459b8'
Box 0 0 90 8 '#c34c61'
Text '공공데이터 기반 전력·지역 브리핑' 18 36 35 '#536078'
Text '전력에디터' 52 32 78 '#1b2337' $true
Text '전력수급·기상재난·주요뉴스를 한눈에' 25 36 159 '#3459b8'
Box 40 229 228 56 '#dce5ff'
Box 286 229 228 56 '#e0e7f6'
Box 532 229 228 56 '#e2eee9'
Text '전력수급' 22 105 240 '#183877' $true
Text '기상·재난' 22 344 240 '#183877' $true
Text '전력뉴스' 22 596 240 '#32675f' $true
Text '개인 제작 비영리 운영 · 한전 공식서비스 아님' 16 38 312 '#536078'
Text 'power.suncheon-ops.workers.dev' 18 38 348 '#3459b8' $true
$bolt=[System.Drawing.PointF[]]@([System.Drawing.PointF]::new(716,56),[System.Drawing.PointF]::new(671,117),[System.Drawing.PointF]::new(704,117),[System.Drawing.PointF]::new(695,162),[System.Drawing.PointF]::new(743,95),[System.Drawing.PointF]::new(711,95))
$brush=[System.Drawing.SolidBrush]::new((Color '#c34c61'));$graphic.FillPolygon($brush,$bolt);$brush.Dispose()
$output=Join-Path $PSScriptRoot '../frontend/share-card.png'
$bitmap.Save([System.IO.Path]::GetFullPath($output),[System.Drawing.Imaging.ImageFormat]::Png)
$graphic.Dispose();$bitmap.Dispose()
Write-Output 'Created share-card.png (800x400)'
