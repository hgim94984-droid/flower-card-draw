# =====================================================================
#  오늘의 꽃 카드뽑기 - 이미지 다시 만들기
#  원본 꽃 이미지 폴더를 골라주면
#   1) 웹에서 빠르게 뜨도록 800px JPEG 로 변환해서 images 폴더에 넣고
#   2) 카드 목록 파일(flowers.js)을 다시 만듭니다.
#  원본 파일은 건드리지 않습니다.
# =====================================================================

param(
    [string]$Src = "",
    [int]$MaxSide = 800,
    [int]$Quality = 85
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $root 'images'
$listFile = Join-Path $root 'flowers.js'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

# ---------- 1. 원본 폴더 고르기 ----------
if ([string]::IsNullOrWhiteSpace($Src)) {
    Write-Host ""
    Write-Host "원본 꽃 이미지가 들어있는 폴더를 골라주세요." -ForegroundColor Cyan
    $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
    $dlg.Description = "꽃 이미지 원본 폴더를 선택하세요"
    $dlg.ShowNewFolderButton = $false
    if ($dlg.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host "취소했습니다." -ForegroundColor Yellow
        return
    }
    $Src = $dlg.SelectedPath
}

if (-not (Test-Path $Src)) {
    Write-Host "폴더를 찾을 수 없습니다: $Src" -ForegroundColor Red
    return
}

$files = Get-ChildItem -Path $Src -File | Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|webp|bmp)$' } | Sort-Object Name
if ($files.Count -eq 0) {
    Write-Host "이미지 파일이 없습니다: $Src" -ForegroundColor Red
    return
}

Write-Host ""
Write-Host "원본 폴더 : $Src"
Write-Host "이미지 수 : $($files.Count) 장"
Write-Host "저장 위치 : $dst"
Write-Host ""

# ---------- 2. 기존 images 비우기 ----------
if (Test-Path $dst) {
    Get-ChildItem -Path $dst -File | Remove-Item -Force
} else {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
}

# ---------- 3. 변환 ----------
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$Quality)

$done = 0
$failed = @()
$i = 0

foreach ($f in $files) {
    $i++
    Write-Progress -Activity "꽃 이미지 변환 중" -Status "$i / $($files.Count)  $($f.Name)" -PercentComplete (($i / $files.Count) * 100)
    try {
        $img = [System.Drawing.Image]::FromFile($f.FullName)
        $scale = [Math]::Min(1.0, $MaxSide / [Math]::Max($img.Width, $img.Height))
        $w = [int][Math]::Round($img.Width * $scale)
        $h = [int][Math]::Round($img.Height * $scale)

        $bmp = New-Object System.Drawing.Bitmap($w, $h)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::White)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($img, 0, 0, $w, $h)
        $g.Dispose()

        # 파일명은 ASCII 로 안전하게 (card-0001.jpg)
        $outName = 'card-{0:d4}.jpg' -f $i
        $bmp.Save((Join-Path $dst $outName), $encoder, $encParams)
        $bmp.Dispose()
        $img.Dispose()
        $done++
    }
    catch {
        $failed += $f.Name
    }
}
Write-Progress -Activity "꽃 이미지 변환 중" -Completed

# ---------- 4. 목록 파일 다시 만들기 ----------
$names = Get-ChildItem -Path $dst -File -Filter *.jpg | Sort-Object Name | ForEach-Object { '  "' + $_.Name + '"' }
$body = "// 카드 이미지 목록 - tools\rebuild-images.ps1 로 자동 생성됨`r`nwindow.FLOWER_IMAGES = [`r`n" + ($names -join ",`r`n") + "`r`n];`r`n"
Set-Content -Path $listFile -Value $body -Encoding UTF8 -NoNewline

$outFiles = Get-ChildItem -Path $dst -File -Filter *.jpg
$totalMB = [math]::Round(($outFiles | Measure-Object Length -Sum).Sum / 1MB, 1)

Write-Host ""
Write-Host "=== 완료 ===" -ForegroundColor Green
Write-Host "변환 성공 : $done 장"
Write-Host "실패      : $($failed.Count) 장"
if ($failed.Count -gt 0) { Write-Host ("  - " + ($failed -join ', ')) -ForegroundColor Yellow }
Write-Host "총 용량   : $totalMB MB"
Write-Host "카드 목록 : $listFile ($($names.Count) 장)"
Write-Host ""
Write-Host "이제 index.html 을 다시 열면 새 이미지로 카드가 뽑힙니다." -ForegroundColor Cyan
