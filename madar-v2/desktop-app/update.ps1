# MADAR Desktop Quick Updater & Certificate Trust Setup
$ErrorActionPreference = 'Stop'
Write-Host "=== MADAR Windows Desktop Update & Certificate Setup ===" -ForegroundColor Cyan

$serverOrigin = "https://carlos-pc.tail852ef0.ts.net"
$tempDir = [System.IO.Path]::GetTempPath()
$certPath = Join-Path $tempDir "madar-ca.cer"
$installerPath = Join-Path $tempDir "MADAR-Windows-1.0.4-Setup.exe"

# 1. Download and trust the MADAR certificate
Write-Host "1/3. Downloading MADAR ERP Security Certificate..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$serverOrigin/download/desktop/madar-ca.cer" -OutFile $certPath -UseBasicParsing

Write-Host "2/3. Registering Certificate in Windows Root Store..." -ForegroundColor Yellow
& certutil -user -addstore -f "Root" $certPath | Out-Null
Write-Host "   Certificate registered successfully." -ForegroundColor Green

# 2. Download latest installer
Write-Host "3/3. Downloading MADAR Windows 1.0.4 Installer..." -ForegroundColor Yellow
Invoke-WebRequest -Uri "$serverOrigin/download/desktop/MADAR-Windows-1.0.4-Setup.exe" -OutFile $installerPath -UseBasicParsing

Write-Host "Launching MADAR 1.0.4 Installer..." -ForegroundColor Green
Start-Process -FilePath $installerPath
